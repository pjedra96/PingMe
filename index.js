// Module Dependencies
const express = require('express');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http);
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Gun = require('gun'); // Also loads SEA (Gun.SEA), used to check account signatures
//app.use('/gun', Gun.serve);
//const gun = Gun({ web: http });
// Ports can be overridden with the PORT and GUN_PORT environment variables
const PORT = Number(process.env.PORT) || 8080;
const GUN_PORT = Number(process.env.GUN_PORT) || 8765;

// GUN relay rate limiting - the relay accepts data from anyone, so cap how much each IP address can send
const RELAY_MAX_MESSAGE_BYTES = 64 * 1024; // A single bigger message closes the connection (a chat message is well under)
const RELAY_LIMIT_WINDOW_MS = 60 * 1000;
const RELAY_LIMIT_MESSAGES = 600;          // Messages per IP per minute
const RELAY_LIMIT_BYTES = 512 * 1024;      // Bytes per IP per minute
const relayUsage = new Map();              // IP -> { start, messages, bytes, warned }

// Counts a message against its IP's budget, returns true if the IP is over the limit
function overRelayLimit(ip, data) {
    const now = Date.now();
    let usage = relayUsage.get(ip);
    if (!usage || now - usage.start > RELAY_LIMIT_WINDOW_MS) {
        usage = { start: now, messages: 0, bytes: 0, warned: false };
        relayUsage.set(ip, usage);
    }
    usage.messages += 1;
    usage.bytes += (data && data.length) || 0;
    const over = usage.messages > RELAY_LIMIT_MESSAGES || usage.bytes > RELAY_LIMIT_BYTES;
    if (over && !usage.warned) {
        usage.warned = true;
        console.log('GUN relay rate limit hit by ' + ip + ' - dropping its messages for the rest of the minute');
    }
    return over;
}

// Create a separate HTTP server for Gun.js
const gunServer = require('http').createServer();
gunServer.listen(GUN_PORT, () => {
    console.log('GUN relay server running on http://localhost:' + GUN_PORT + '/gun');
});
const gun = Gun({ web: gunServer, ws: { maxPayload: RELAY_MAX_MESSAGE_BYTES } });

// Behind a reverse proxy (nginx, Caddy...) every visitor seems to come from the proxy's IP. Set TRUST_PROXY=1 to use
// the visitor's IP from the X-Forwarded-For header instead. Only set it behind a proxy - otherwise anyone could fake the header.
const TRUST_PROXY = process.env.TRUST_PROXY === '1';

function clientIp(req) {
    const forwarded = req.headers['x-forwarded-for'];
    if (TRUST_PROXY && forwarded) {
        // The proxy appends the address it received the request from, so the last entry is the one we can trust
        const addresses = forwarded.split(',');
        return addresses[addresses.length - 1].trim();
    }
    return req.socket.remoteAddress;
}

// Drop incoming relay messages from IPs over the limit, before GUN sees them
gun._.opt.ws.web.on('connection', function(wire, req) {
    const ip = clientIp(req);
    const emit = wire.emit;
    wire.emit = function(event, data) {
        if (event === 'message' && overRelayLimit(ip, data)) { return false; }
        return emit.apply(this, arguments);
    };
});

// Forget IPs whose window has ended
setInterval(function() {
    const now = Date.now();
    relayUsage.forEach(function(usage, ip) {
        if (now - usage.start > RELAY_LIMIT_WINDOW_MS) { relayUsage.delete(ip); }
    });
}, RELAY_LIMIT_WINDOW_MS).unref();

// Sets EJS as the view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views')); // So the app works when started from any folder
// Sets /views as the default directory
app.use(express.static(path.join(__dirname, 'public')));
// Serve the browser copies of GUN from node_modules, so the browser and the relay always run the same GUN version
app.get(['/vendor/gun/gun.js', '/vendor/gun/sea.js'], function(req, res) {
    res.sendFile(path.join(__dirname, 'node_modules', 'gun', path.basename(req.path)));
});

// Setting / as the main route of the application, which serves the chat page
app.get('/', function(req, res) {
    res.render('index.ejs', { gunPort: GUN_PORT });
});

// --- Names ---
// A registered (GUN account) name is tied to the account's public key the first time it's used, so nobody else - a guest,
// or another account with the same name - can use it afterwards. Stored in data/names.json.
const MAX_USERNAME_LENGTH = 30;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data'); // Folder for names, bans and removed messages
const NAMES_FILE = path.join(DATA_DIR, 'names.json');

function loadJson(file, fallback) {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
        return fallback; // Not created yet
    }
}

function saveJson(file, data) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

const registeredNames = loadJson(NAMES_FILE, {}); // lower-case name -> { name, pub }

// --- Moderation ---
// Moderators are registered users named in the MODERATORS environment variable (comma-separated, e.g. MODERATORS=alice,bob).
// They can remove messages (taken off everyone's screen and left out of history) and ban a message's sender:
//  - a registered sender's account is banned until a moderator unbans it
//  - the sender's IP address is banned for BAN_HOURS (default 24) - the only way to keep out guests, who can pick a new name
// Moderators can't be banned, and are let in even if they share a banned IP address.
const MODERATORS = new Set((process.env.MODERATORS || '').split(',').map(function(name) { return name.trim().toLowerCase(); }).filter(Boolean));
const BAN_HOURS = Number(process.env.BAN_HOURS) || 24;
const HIDDEN_FILE = path.join(DATA_DIR, 'hidden.json');
const BANS_FILE = path.join(DATA_DIR, 'bans.json');
const hiddenMessages = new Set(loadJson(HIDDEN_FILE, [])); // Hashes of removed messages
let bans = loadJson(BANS_FILE, []); // [{ id, name, pub, ip, ipUntil, by, at }]

function isModerator(socket) {
    return !!(socket.pub && MODERATORS.has(socket.username.toLowerCase()));
}

// Bans that still apply (an account ban lasts until unbanned, an IP ban until ipUntil)
function activeBans() {
    const now = Date.now();
    return bans.filter(function(ban) { return ban.pub || ban.ipUntil > now; });
}

function findBan(pub, ip) {
    return activeBans().find(function(ban) {
        return (pub && ban.pub === pub) || (ip && ban.ip === ip && ban.ipUntil > Date.now());
    });
}

// Who sent recent live messages (by message hash), so a ban hits the real sender even if they faked their name
const RECENT_SENDERS_LIMIT = 10000;
const recentSenders = new Map(); // hash -> { name, pub, ip }

function rememberSender(hash, socket) {
    recentSenders.set(hash, { name: socket.username, pub: socket.pub, ip: socket.ip });
    if (recentSenders.size > RECENT_SENDERS_LIMIT) { recentSenders.delete(recentSenders.keys().next().value); }
}

// Works out who to ban for a message. For older messages the server doesn't know the sender any more, so it only
// trusts the name if the moderator saw it verified (signed by a registered account) - a guest's name could be anyone's
function senderOf(hash, name, verified) {
    const sender = recentSenders.get(hash);
    if (sender) { return sender; }
    const registered = verified && typeof name === 'string' && registeredNames[name.trim().toLowerCase()];
    return registered ? { name: registered.name, pub: registered.pub, ip: null } : null;
}

function banSender(target, moderator) {
    let ip = target.ip;
    if (!ip && target.pub) {
        // Also ban the IP the account is using right now, if it's online
        const online = Array.from(io.sockets.sockets.values()).find(function(s) { return s.pub === target.pub; });
        if (online) { ip = online.ip; }
    }
    const ban = { id: crypto.randomUUID(), name: target.name, pub: target.pub || null, ip: ip || null,
        ipUntil: ip ? Date.now() + BAN_HOURS * 60 * 60 * 1000 : null, by: moderator.username, at: Date.now() };
    bans = activeBans().concat([ban]); // Also drops expired bans from the file
    saveJson(BANS_FILE, bans);
    // Disconnect them everywhere
    io.sockets.sockets.forEach(function(other) {
        if (isModerator(other)) { return; }
        if ((ban.pub && other.pub === ban.pub) || (ban.ip && other.ip === ban.ip)) {
            other.emit('banned', 'You have been banned by a moderator.');
            other.disconnect(true);
        }
    });
}

// --- History ---
// When someone joins a room that keeps history, the server sends its newest messages from the relay's storage.
// Messages are encrypted, so they're ordered by when GUN stored them (its timestamp for each entry).
const HISTORY_LIMIT = 100;

function loadHistory(storageId) {
    return new Promise(function(resolve) {
        const timeout = setTimeout(function() { resolve([]); }, 5000);
        gun.get('#' + storageId).once(function(node) {
            clearTimeout(timeout);
            if (!node) { return resolve([]); }
            const states = (node._ && node._['>']) || {};
            const entries = Object.keys(node)
                .filter(function(hash) { return hash !== '_' && typeof node[hash] === 'string' && !hiddenMessages.has(hash); })
                .sort(function(a, b) { return (states[a] || 0) - (states[b] || 0); })
                .slice(-HISTORY_LIMIT)
                .map(function(hash) { return { hash: hash, encrypted: node[hash] }; });
            resolve(entries);
        });
    });
}

// --- Room list ---
// Public rooms are listed in the lobby while someone is in them, plus a grace period after the last person leaves
// (so a page refresh doesn't drop the room). General is always listed. Nothing is stored, so the list can't fill with junk.
const ROOM_LIST_GRACE_MS = 2 * 60 * 1000;
const MAX_ROOM_NAME_LENGTH = 40;
const LOBBY = 'lobby'; // Socket.io room for people looking at the lobby
const GENERAL_ROOM = publicRoomId('General', true);
const publicRooms = new Map(); // Socket.io room -> { name, history, general, emptySince }
publicRooms.set(GENERAL_ROOM, { name: 'General', history: true, general: true, emptySince: null });

// Public room ids are built by the server from the name, so a room can't be listed under a fake name
function publicRoomId(name, history) {
    return 'public\n' + (history ? 'history' : 'no-history') + '\n' + name;
}

function roomSize(room) {
    const members = io.sockets.adapter.rooms.get(room);
    return members ? members.size : 0;
}

// General first, then the busiest rooms
function roomList() {
    const now = Date.now();
    const list = [];
    publicRooms.forEach(function(info, room) {
        const online = roomSize(room);
        if (info.general || online > 0 || now - info.emptySince < ROOM_LIST_GRACE_MS) {
            list.push({ name: info.name, history: info.history, general: info.general, online: online });
        }
    });
    return list.sort(function(a, b) {
        return (b.general - a.general) || (b.online - a.online) || a.name.localeCompare(b.name);
    });
}

function sendRoomList() {
    io.to(LOBBY).emit('rooms', roomList());
}

// Remove public rooms whose grace period has ended
setInterval(function() {
    const now = Date.now();
    let removed = false;
    publicRooms.forEach(function(info, room) {
        if (!info.general && roomSize(room) === 0 && now - info.emptySince >= ROOM_LIST_GRACE_MS) {
            publicRooms.delete(room);
            removed = true;
        }
    });
    if (removed) { sendRoomList(); }
}, 30 * 1000).unref();

// Socket.io configuration - event listeners
io.sockets.on('connection', function(socket) {
    // Listens to the events emitted by the clients and passes them on to the rest of their chat room
    socket.ip = clientIp(socket.request);

    // Sends the join/leave notice and the room's online count to everyone in the room
    function sendPresence(room, action) {
        io.to(room).emit('is_online', { username: socket.username, action: action, usersOnline: roomSize(room) });
    }

    // Called after someone leaves a room (or disconnects) - updates the room and the lobby
    function afterLeaving(room) {
        socket.to(room).emit('doneTyping'); // Clear a "... is typing" notice they may have left behind
        sendPresence(room, 'leave'); // 🔴
        const info = publicRooms.get(room);
        if (info && roomSize(room) === 0) { info.emptySince = Date.now(); }
        sendRoomList();
    }

    // A random challenge for this connection - registered users sign it with their account key to prove it's theirs
    const challenge = crypto.randomBytes(24).toString('base64');
    socket.on('challenge', function(reply) {
        if (typeof reply === 'function') { reply(challenge); }
    });

    // Sets who this connection is: { name, session, pub?, proof? }
    //  - registered users send their account's public key and the challenge signed with their private key
    //  - guests can't use registered names, and nobody can use a name someone else is using right now
    // session is a random id per browser tab, so a tab that reconnects can replace its old connection
    // (which the server may not have noticed is dead yet)
    socket.on('identify', async function(data, reply) {
        if (typeof reply !== 'function') { return; }
        if (socket.username) { return reply({ error: 'Already identified.' }); }
        if (!data || typeof data.name !== 'string' || typeof data.session !== 'string') { return reply({ error: 'Invalid request.' }); }
        const name = data.name.trim();
        if (!name || name.length > MAX_USERNAME_LENGTH) { return reply({ error: 'Names must be 1-' + MAX_USERNAME_LENGTH + ' characters.' }); }
        const key = name.toLowerCase();

        let pub = null;
        if (data.pub !== undefined) {
            if (typeof data.pub !== 'string' || typeof data.proof !== 'string') { return reply({ error: 'Invalid request.' }); }
            let signed;
            try {
                signed = await Gun.SEA.verify(data.proof, data.pub);
            } catch (e) {
                signed = null;
            }
            if (signed !== challenge) { return reply({ error: 'Could not verify your account.' }); }
            pub = data.pub;
        }

        const registered = registeredNames[key];
        if (registered && registered.pub !== pub) {
            return reply({ error: pub ? 'This name belongs to another account.' : 'This name belongs to a registered user - please log in, or pick another name.' });
        }
        for (const other of io.sockets.sockets.values()) {
            if (other === socket || !other.username || other.username.toLowerCase() !== key) { continue; }
            if (other.session === data.session) { other.disconnect(true); continue; } // Our own old connection - replace it
            if (pub && other.pub === pub) { continue; } // Same account in another tab
            return reply({ error: 'Someone called ' + other.username + ' is already online.' });
        }
        if (findBan(pub, socket.ip) && !(pub && MODERATORS.has(key))) {
            return reply({ error: 'You have been banned by a moderator.' });
        }
        if (pub && !registered) {
            registeredNames[key] = { name: name, pub: pub };
            saveJson(NAMES_FILE, registeredNames);
        }
        socket.username = name;
        socket.pub = pub;
        socket.session = data.session;
        reply({ ok: true, moderator: isModerator(socket) });
    });

    // Moderator actions on a message: { action: 'remove' | 'ban', hash, name, verified }
    // name/verified are the sender as the moderator sees it - only used for older messages (see senderOf)
    socket.on('moderate', function(data, reply) {
        if (typeof reply !== 'function') { return; }
        if (!isModerator(socket)) { return reply({ error: 'Only moderators can do that.' }); }
        if (!data || typeof data.hash !== 'string' || !data.hash || data.hash.length > 100) { return reply({ error: 'Invalid request.' }); }
        if (data.action === 'ban') {
            const target = senderOf(data.hash, data.name, data.verified === true);
            if (!target) { return reply({ error: 'Can\'t tell who sent this message any more - remove it instead.' }); }
            if (target.pub && MODERATORS.has(String(target.name).toLowerCase())) { return reply({ error: 'Moderators can\'t be banned.' }); }
            banSender(target, socket);
        } else if (data.action !== 'remove') {
            return reply({ error: 'Invalid request.' });
        }
        hiddenMessages.add(data.hash);
        saveJson(HIDDEN_FILE, Array.from(hiddenMessages));
        if (socket.room) { io.to(socket.room).emit('message_removed', data.hash); }
        reply({ ok: true });
    });

    // Moderators: list and lift bans
    socket.on('bans', function(reply) {
        if (typeof reply !== 'function' || !isModerator(socket)) { return; }
        reply(activeBans().map(function(ban) {
            return { id: ban.id, name: ban.name, account: !!ban.pub, ipUntil: ban.ip ? ban.ipUntil : null, by: ban.by, at: ban.at };
        }));
    });

    socket.on('unban', function(id, reply) {
        if (typeof reply !== 'function' || !isModerator(socket)) { return; }
        bans = activeBans().filter(function(ban) { return ban.id !== id; });
        saveJson(BANS_FILE, bans);
        reply({ ok: true });
    });

    // Looks up the public key of a registered name (null for guests), so browsers can check message signatures
    socket.on('whois', function(name, reply) {
        if (typeof reply !== 'function' || typeof name !== 'string') { return; }
        const registered = registeredNames[name.trim().toLowerCase()];
        reply(registered ? registered.pub : null);
    });

    socket.on('enter_lobby', function() {
        if (!socket.username) { return; }
        socket.join(LOBBY);
        socket.emit('rooms', roomList());
    });

    // Joins a room: { type: 'general' | 'public' | 'private', name, history, room, storage }
    // Private rooms: the room id is derived from the name + password in the browser, so the server never sees either
    // storage: where the room's messages are kept on the relay (sent for rooms that keep history) - replied with its newest messages
    socket.on('join', async function(data, reply) {
        if (typeof reply !== 'function') { return; }
        if (!socket.username) { return reply({ error: 'Please log in first.' }); }
        if (socket.room) { return reply({ error: 'Already in a room.' }); }
        if (!data) { return reply({ error: 'Invalid request.' }); }

        let room;
        if (data.type === 'private') {
            if (typeof data.room !== 'string' || !data.room || data.room.length > 100) { return reply({ error: 'Invalid room.' }); }
            room = 'private\n' + data.room;
        } else if (data.type === 'general') {
            room = GENERAL_ROOM;
        } else if (data.type === 'public') {
            const name = typeof data.name === 'string' ? data.name.trim() : '';
            if (!name || name.length > MAX_ROOM_NAME_LENGTH) { return reply({ error: 'Room names must be 1-' + MAX_ROOM_NAME_LENGTH + ' characters.' }); }
            if (name.toLowerCase() === 'general') { return reply({ error: 'General already exists - pick it from the list.' }); }
            const history = data.history === true;
            room = publicRoomId(name, history);
            if (!publicRooms.has(room)) { publicRooms.set(room, { name: name, history: history, general: false, emptySince: null }); }
        } else {
            return reply({ error: 'Invalid room type.' });
        }

        socket.room = room;
        socket.leave(LOBBY);
        socket.join(room);
        const info = publicRooms.get(room);
        if (info) { info.emptySince = null; }
        sendPresence(room, 'join'); // 🔵
        sendRoomList();
        const storage = typeof data.storage === 'string' && data.storage.length <= 100 ? data.storage : null;
        reply({ ok: true, history: storage ? await loadHistory(storage) : [] });
    });

    socket.on('leave', function() {
        if (!socket.room) { return; }
        const room = socket.room;
        socket.leave(room);
        socket.room = null;
        afterLeaving(room);
    });

    socket.on('disconnect', function() {
        // Ignore connections that never joined a room (e.g. closed on the login screen or in the lobby)
        if (!socket.room) { return; }
        afterLeaving(socket.room);
    });

    // Messages are encrypted in the browser with the room key - the server only passes the ciphertext on
    socket.on('chat_message', function(encrypted) {
        if (!socket.room || typeof encrypted !== 'string' || encrypted.length > RELAY_MAX_MESSAGE_BYTES) { return; }
        socket.to(socket.room).emit('chat_message', encrypted);
        // Same hash as the browsers use for the message, so moderators can ban by message
        Gun.SEA.work(encrypted, null, null, { name: 'SHA-256' }).then(function(hash) { rememberSender(hash, socket); });
    });

    socket.on('typing', function() {
        if (!socket.room) { return; }
        socket.to(socket.room).emit('typing', { notification: socket.username + " is typing", username: socket.username});
    });

    socket.on('doneTyping', function() {
        if (!socket.room) { return; }
        socket.to(socket.room).emit('doneTyping');
    });

});

// Start the server
const server = http.listen(PORT, function() {
    console.log('listening on *:' + PORT);
});

// Stops the entire process when Signal Interrupt (Control-C) issued in the console
process.on('SIGINT', function(){
  console.log('Signal Interrupt received. Exiting the process');
  process.exit(0);
});