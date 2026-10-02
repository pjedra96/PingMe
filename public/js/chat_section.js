document.addEventListener('DOMContentLoaded', function() {
  // --- Top Bar Logic ---
  window.isDark = window.isDark || false;
  const themeToggle = document.getElementById('theme-toggle');
  const aliasDisplay = document.getElementById('alias-display');
  const nodesPopup = document.getElementById('nodes-popup');
  const msgInput = document.getElementById('msgInput');

  let typingTimer; //timer identifier
  let doneTypingInterval = 2000;  //time in ms (5 seconds)
  let users = 0;

  /*  Prevent the message input from inserting a new line when ENTER key is pressed
  Instead set ENTER to be used for sending messages and a combination of keys - SHIFT + ENTER to be used for adding a new line */
  msgInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') { // Enter key
        if (!e.shiftKey) {
          e.preventDefault(); // Prevents the default action of adding a new line
          if (typeof window.sendMsg === 'function') window.sendMsg(); // Call the sendMsg function to send the message
          window.doneTyping(); // user is done typing
          socket.emit('doneTyping');
        }
    }
  });
  msgInput.addEventListener('input', function() {
      window.isTyping(); // user is typing
  });

  // User is typing
  window.isTyping = function(){
      socket.emit('typing');
      typingTimer = setTimeout(window.doneTyping, doneTypingInterval);
  }

  //user is "finished typing," send a doneTyping event to the index.js
  window.doneTyping = function() {
      socket.emit('doneTyping');
      clearTimeout(typingTimer);
  }

  // Global theme application function
  window.applyTheme = function(dark) {
    window.isDark = dark;
    document.body.style.background = window.isDark ? '#222' : '#fff';
    document.body.style.color = window.isDark ? '#eee' : '#222';
    themeToggle.textContent = window.isDark ? '☀️' : '🌙';
    // Chat container and messages
    const chatContainer = document.getElementById('chat-container');
    const messagesDiv = document.getElementById('messages');
    const inputArea = document.getElementById('input-area');
    if (inputArea) inputArea.style.background = window.isDark ? '#222' : '#fff';
    if(msgInput){
      msgInput.style.background = window.isDark ? '#222' : '#fff';
      msgInput.style.color = window.isDark ? '#eee' : '#222';
    }
    if (chatContainer) {
      chatContainer.style.background = window.isDark ? '#222' : '#fff';
      chatContainer.style.color = window.isDark ? '#eee' : '#222';
      // jQuery: set background for odd message divs
      $('#messages').children('li:odd').css('background', window.isDark ? '' : '#f9f9f9');
    }
    if (messagesDiv) {
      messagesDiv.style.background = window.isDark ? '#222' : '#fff';
      messagesDiv.style.color = window.isDark ? '#eee' : '#222';
      // Update all message text colors and username colors
      Array.from(messagesDiv.children).forEach(msgElem => {
        // Only update if this is a chat message (not join/leave li)
        if (msgElem.tagName === 'DIV') {
          // Try to find the username <strong> element
          const strong = msgElem.querySelector('strong');
          if (strong) {
            // Get username text
            const username = strong.textContent;
            const isMe = (window.alias || 'anon') === username;
            strong.style.color = isMe ? (window.isDark ? '#00ff00' : '#222') : 'red';
          }
          // Update timestamp and message text colors (all spans except strong)
          const spans = msgElem.querySelectorAll('span');
          spans.forEach(span => {
            span.style.color = window.isDark ? '#00ff00' : '#222';
          });
        }
      });
    }
  };

  // Theme switching
  if (themeToggle) {
    themeToggle.onclick = function() {
      window.isDark = !window.isDark;
      window.applyTheme(window.isDark);
      // Save theme preference to Gun if logged in
      if (window.user && window.user.is && window.user.is.pub) {
        window.user.get('theme').put(window.isDark);
      }
    };
  }

  // --- Chat Logic ---
  // Use global gun and alias if available
  // Must be the relay-connected instance from authentication_section.js - a plain Gun() would only store messages locally
  const gunInstance = window.gun || null;
  const messagesDiv = document.getElementById('messages');
  let channel = null;   // Gun.js storage for the current room (null for rooms without history), set by joinRoom()
  let roomKey = null;   // Encryption key for the current room, set by joinRoom()
  let currentRoom = null; // Options of the current room, so we can rejoin it after a lost connection
  let identity = null;  // { name, pair } - pair is the GUN account key pair for registered users, null for guests
  const session = crypto.randomUUID(); // Identifies this tab to the server, so a reconnect can replace its old connection

  // Messages can arrive more than once (live, and again in history after a reconnect) - track which ones are already shown
  // (keyed by the hash of the encrypted message)
  const displayedMessages = new Set();
  const hashOf = (encrypted) => Gun.SEA.work(encrypted, null, null, { name: 'SHA-256' });

  // Public keys of registered names, from the server (null for guests). Cached per room
  const knownPubs = new Map();
  function pubFor(name) {
    const key = String(name).trim().toLowerCase();
    if (!knownPubs.has(key)) knownPubs.set(key, new Promise(resolve => socket.emit('whois', key, resolve)));
    return knownPubs.get(key);
  }

  // Tells the server who we are. Registered users (pair = their GUN key pair) prove it by signing the server's challenge.
  // Returns an error message, or null when accepted
  window.identify = async function(name, pair) {
    const request = { name: name, session: session };
    if (pair) {
      const challenge = await new Promise(resolve => socket.emit('challenge', resolve));
      request.pub = pair.pub;
      request.proof = await Gun.SEA.sign(challenge, pair);
    }
    const result = await new Promise(resolve => socket.emit('identify', request, resolve));
    if (result.error) return result.error;
    identity = { name: name, pair: pair, moderator: !!result.moderator };
    return null;
  };

  window.isModerator = () => !!(identity && identity.moderator);

  // Clears the chat, ready for another room
  function resetChat() {
    channel = null;
    roomKey = null;
    currentRoom = null;
    displayedMessages.clear();
    knownPubs.clear();
    messagesDiv.replaceChildren();
    document.getElementById('notifications').replaceChildren();
    $('.people-online').empty();
  }

  // Joins a chat room: { type: 'general' | 'public' | 'private', name, password, history }
  // The room's storage id and encryption key are derived from its type, name, password and history setting (PBKDF2), so:
  //  - private rooms: only people who know the name AND password end up in the same room, and the server never sees either
  //  - public rooms (and General): anyone can work out the key, so their messages are effectively public
  // Rooms without history are never written to or read from the GUN relay - messages only go live to whoever is in the room
  // The server sends the room's newest messages (up to 100) when joining a room that keeps history
  // rejoining = true when rejoining after a lost connection: keeps the chat on screen and adds any missed messages
  // Returns an error message, or null when joined
  window.joinRoom = async function(options, rejoining) {
    const visibility = options.type === 'private' ? 'private' : 'public';
    const secret = [visibility, options.history ? 'history' : 'no-history', options.name, options.password || ''].join('\n');
    const key = await Gun.SEA.work(secret, 'pingme-room-key');
    const storageId = await Gun.SEA.work(secret, 'pingme-room-id');

    if (!rejoining) resetChat(); // Before joining, so our own "joined" notice isn't cleared
    const request = { type: options.type, name: options.name, history: options.history };
    if (options.type === 'private') request.room = storageId;
    if (options.history) request.storage = storageId;
    const result = await new Promise(resolve => socket.emit('join', request, resolve));
    if (result.error) return result.error;

    roomKey = key;
    currentRoom = options;
    document.getElementById('room-display').textContent = options.name + (options.history ? '' : ' (no history)');
    if (options.history && gunInstance) {
      // Content-addressed storage ('#' in the name): the relay only accepts entries whose key is the SHA-256 hash
      // of the data, so stored messages can't be edited or deleted by anyone
      channel = gunInstance.get('#' + storageId);
    }
    (result.history || []).forEach(entry => receiveMessage(entry.encrypted, entry.hash));
    return null;
  };

  window.leaveRoom = function() {
    socket.emit('leave');
    resetChat();
  };

  // Decrypts and shows a message, unless it's already shown or can't be decrypted with the room key (e.g. junk written to the relay)
  // Messages from registered users are signed with their account key: 'verified' if the signature matches the key the server
  // has for that name, 'unverified' if a registered name is used without a valid signature, 'guest' otherwise
  async function receiveMessage(encrypted, hash) {
    const key = roomKey;
    if (typeof encrypted !== 'string' || !key) return;
    hash = hash || await hashOf(encrypted);
    if (displayedMessages.has(hash)) return;
    let payload;
    try {
      payload = await Gun.SEA.decrypt(encrypted, key);
    } catch (e) {
      return;
    }
    if (!payload) return;
    let msg = payload;
    let status = 'guest';
    if (payload.signed && typeof payload.pub === 'string') {
      msg = await Gun.SEA.verify(payload.signed, payload.pub); // undefined if the signature doesn't match
      if (!msg) return;
      status = (await pubFor(msg.username)) === payload.pub ? 'verified' : 'unverified';
    } else if (await pubFor(payload.username)) {
      status = 'unverified'; // A registered name, but not signed by its owner
    }
    if (typeof msg.text !== 'string' || roomKey !== key) return; // Also ignore it if we've switched rooms meanwhile
    displayMessage(hash, Number(msg.time), String(msg.username), msg.text, status);
  }

  // Shows a chat message in time order. Text is set via textContent, so line breaks are kept and HTML isn't interpreted
  // status: 'verified' (registered user, signature checked), 'guest', or 'unverified' (registered name, not signed by its owner)
  function displayMessage(key, time, sender, text, status) {
    if (!messagesDiv || displayedMessages.has(key)) return;
    displayedMessages.add(key);

    const isMe = identity && identity.name === sender && status !== 'unverified';
    const textColor = window.isDark ? '#00ff00' : '#222';
    const msgElem = document.createElement('div');
    // Add style to disable x-scroll and enable word break
    msgElem.style.overflowX = 'hidden';
    msgElem.style.wordBreak = 'break-word';

    const timestamp = document.createElement('span');
    timestamp.className = 'msg-timestamp';
    timestamp.style.color = textColor;
    timestamp.textContent = '[' + new Date(time).toLocaleTimeString() + ']';

    const name = document.createElement('strong');
    name.style.color = isMe ? textColor : 'red';
    name.textContent = sender;

    const badge = document.createElement('span');
    badge.className = 'msg-badge msg-' + status;
    badge.style.color = textColor;
    badge.textContent = { verified: ' ✓', guest: ' (guest)', unverified: ' ⚠ unverified' }[status];
    badge.title = {
      verified: 'Registered user - message signed by their account',
      guest: 'Guest - not a registered account',
      unverified: 'This name belongs to a registered user, but this message was not signed by their account'
    }[status];

    const msgText = document.createElement('span');
    msgText.className = 'msg-text';
    msgText.style.color = textColor;
    msgText.style.whiteSpace = 'pre-wrap'; // Keep Shift+Enter line breaks
    msgText.textContent = text;

    msgElem.append(timestamp, ' ', name, badge, ': ', msgText);
    if (identity && identity.moderator) {
      const tools = document.createElement('span');
      tools.className = 'msg-mod-tools';
      tools.append(modButton('🗑', 'Remove this message for everyone', () => moderate('remove', key, sender, status)));
      if (!isMe) tools.append(modButton('⛔', 'Remove this message and ban its sender', () => moderate('ban', key, sender, status)));
      msgElem.append(tools);
    }
    msgElem.dataset.time = time;
    msgElem.dataset.hash = key;
    // History is decrypted asynchronously, so insert before the first later message rather than always at the end
    const later = Array.from(messagesDiv.children).find(elem => elem.dataset.time && Number(elem.dataset.time) > time);
    messagesDiv.insertBefore(msgElem, later || null);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
  }

  // --- Moderation ---
  function modButton(icon, title, onClick) {
    const button = document.createElement('span');
    button.className = 'msg-mod-button';
    button.textContent = icon;
    button.title = title;
    button.onclick = onClick;
    return button;
  }

  // Shows a short-lived notice above the messages
  function showModerationNotice(text) {
    $('#moderation-notice').remove();
    $('#notifications').prepend($('<li id="moderation-notice">').append($('<i>').text(text)));
    setTimeout(() => $('#moderation-notice').remove(), 5000);
  }

  async function moderate(action, hash, sender, status) {
    if (action === 'ban' && !confirm('Ban ' + sender + '? Their message is removed, and they are disconnected and kept out.')) return;
    const request = { action: action, hash: hash, name: sender, verified: status === 'verified' };
    const result = await new Promise(resolve => socket.emit('moderate', request, resolve));
    showModerationNotice(result.error || (action === 'ban' ? sender + ' has been banned.' : 'Message removed.'));
  }

  // A moderator removed a message - take it off the screen (and don't show it again if it arrives later)
  socket.on('message_removed', function(hash) {
    displayedMessages.add(hash);
    $('#messages > div').filter((i, elem) => elem.dataset.hash === hash).remove();
  });

  // Banned by a moderator - the server disconnects us, so go back to the login screen
  socket.on('banned', function(text) {
    identity = null;
    resetChat();
    ['top-bar', 'lobby-container', 'chat-container', 'input-area'].forEach(id => { document.getElementById(id).style.display = 'none'; });
    document.getElementById('auth-container').style.display = '';
    const authStatus = document.getElementById('authStatus');
    authStatus.textContent = text;
    authStatus.style.color = '#aa0000';
  });

  window.sendMsg = async function() {
    const msgInput = document.getElementById('msgInput');
    if (!msgInput || !roomKey || !identity) return;
    if (!socket.connected) return showConnectionNotice('Not connected - please try again once reconnected.');
    const text = msgInput.value.trim();
    if (!text) return;
    const now = Date.now();
    const message = { username: identity.name, time: now, text: text };
    // Registered users sign the message with their account key, so everyone can check it's really from them
    const payload = identity.pair ? { signed: await Gun.SEA.sign(message, identity.pair), pub: identity.pair.pub } : message;
    // Name, time, text (and signature) are all encrypted with the room key - the server and relay only ever see ciphertext
    const encrypted = await Gun.SEA.encrypt(payload, roomKey);
    const hash = await hashOf(encrypted);
    // Append locally first to avoid delay (also marks it as shown, so a copy coming back in history is skipped)
    displayMessage(hash, now, identity.name, text, identity.pair ? 'verified' : 'guest');
    // Store in Gun.js for persistence, keyed by its hash (required by the content-addressed storage)
    if (channel) channel.get(hash).put(encrypted);
    // Deliver in real time to the rest of the room via Socket.io
    socket.emit('chat_message', encrypted);
    // Clear input box
    msgInput.value = '';
  };

  // Listen for real-time chat messages from Socket.io (encrypted, from the rest of the room)
  socket.on('chat_message', function(encrypted) {
    receiveMessage(encrypted);
  });

  // --- Lost connections ---
  // After a reconnect (network change, server restart...) the server no longer knows who we are or which room we're in,
  // so identify again and rejoin. Messages missed meanwhile come back with the room's history (if it keeps one).
  function showConnectionNotice(text) {
    const notifications = $('#notifications');
    notifications.find('#connection-notice').remove();
    if (text) notifications.prepend($('<li id="connection-notice">').append($('<i>').text(text)));
  }

  socket.on('disconnect', function(reason) {
    if (identity) showConnectionNotice('Connection lost - reconnecting...');
    // Socket.IO doesn't reconnect by itself when the server closed the connection (e.g. after a ban) - reconnect so the
    // login screen keeps working
    if (reason === 'io server disconnect') socket.connect();
  });

  socket.io.on('reconnect', async function() {
    if (!identity) return; // Still on the login screen - nothing to restore
    const error = await window.identify(identity.name, identity.pair);
    if (error) return showConnectionNotice('Reconnected, but couldn\'t log back in: ' + error);
    if (currentRoom) {
      const joinError = await window.joinRoom(currentRoom, true);
      if (joinError) return showConnectionNotice('Reconnected, but couldn\'t rejoin the room: ' + joinError);
    } else {
      socket.emit('enter_lobby');
    }
    showConnectionNotice(null);
  });

  // Utility to generate a random color
  window.getRandomColor = function() {
    const letters = '0123456789ABCDEF';
    let color = '#';
    for (let i = 0; i < 6; i++) {
      color += letters[Math.floor(Math.random() * 16)];
    }
    return color;
  };

  // Fallback: if color missing, generate from username
  window.stringToColor = function(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    let color = '#';
    for (let i = 0; i < 3; i++) {
      const value = (hash >> (i * 8)) & 0xFF;
      color += ('00' + value.toString(16)).substr(-2);
    }
    return color;
  };
});
