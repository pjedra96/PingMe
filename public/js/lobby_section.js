document.addEventListener('DOMContentLoaded', function() {
  const lobbyStatus = document.getElementById('lobbyStatus');
  const roomList = document.getElementById('room-list');

  // Shows one screen ('lobby' or 'chat') and hides the others
  function showScreen(screen) {
    document.getElementById('auth-container').style.display = 'none';
    document.getElementById('top-bar').style.display = 'flex';
    document.getElementById('lobby-container').style.display = screen === 'lobby' ? 'flex' : 'none';
    document.getElementById('chat-container').style.display = screen === 'chat' ? 'block' : 'none';
    document.getElementById('input-area').style.display = screen === 'chat' ? 'flex' : 'none';
    document.getElementById('lobby-button').style.display = screen === 'chat' ? '' : 'none';
    if (screen === 'lobby') document.getElementById('room-display').textContent = '';
  }

  function setStatus(text, isError) {
    lobbyStatus.textContent = text;
    lobbyStatus.style.color = isError ? '#aa0000' : '#007700';
  }

  // Called after logging in
  window.showLobby = function() {
    setStatus('', false);
    showScreen('lobby');
    socket.emit('enter_lobby'); // The server replies with the room list, and keeps it updated while we're in the lobby
    if (window.isModerator()) loadBans();
  };

  // Moderators: list of bans, with Unban buttons
  function loadBans() {
    document.getElementById('moderation-panel').style.display = '';
    const banList = document.getElementById('ban-list');
    socket.emit('bans', function(bans) {
      banList.replaceChildren();
      if (!bans.length) {
        const none = document.createElement('li');
        none.textContent = 'Nobody is banned.';
        banList.appendChild(none);
      }
      bans.forEach(function(ban) {
        const item = document.createElement('li');
        const name = document.createElement('strong');
        name.textContent = ban.name;
        const info = document.createElement('span');
        info.className = 'room-info';
        const what = [];
        if (ban.account) what.push('account');
        if (ban.ipUntil) what.push('IP until ' + new Date(ban.ipUntil).toLocaleString());
        info.textContent = what.join(', ') + ' · by ' + ban.by;
        const unban = document.createElement('button');
        unban.textContent = 'Unban';
        unban.onclick = function() {
          socket.emit('unban', ban.id, loadBans);
        };
        item.append(name, info, unban);
        banList.appendChild(item);
      });
    });
  }

  window.backToLobby = function() {
    window.leaveRoom();
    window.showLobby();
  };

  // Joins a room and switches to the chat, or shows why it couldn't
  async function enterRoom(options) {
    setStatus('Joining...', false);
    const error = await window.joinRoom(options);
    if (error) {
      setStatus(error, true);
      return;
    }
    setStatus('', false);
    showScreen('chat');
    document.getElementById('msgInput').focus();
  }

  // Room list: General first, then the public rooms with people in them (sent by the server)
  socket.on('rooms', function(rooms) {
    roomList.replaceChildren();
    rooms.forEach(function(room) {
      const item = document.createElement('li');
      const name = document.createElement('strong');
      name.textContent = room.name;
      const info = document.createElement('span');
      info.className = 'room-info';
      info.textContent = room.online + ' online' + (room.history ? '' : ' · no history');
      item.append(name, info);
      item.onclick = function() {
        enterRoom({ type: room.general ? 'general' : 'public', name: room.name, history: room.history });
      };
      roomList.appendChild(item);
    });
  });

  // Shows the password field only for private rooms
  window.toggleCreateRoomType = function() {
    const isPrivate = document.getElementById('createPrivate').checked;
    document.getElementById('createRoomPassword').style.display = isPrivate ? '' : 'none';
  };

  // Creating a room with the same name and settings as an existing one joins it (and loads its history, if kept)
  window.createRoom = function() {
    const name = document.getElementById('createRoomName').value.trim();
    const isPrivate = document.getElementById('createPrivate').checked;
    const password = document.getElementById('createRoomPassword').value;
    const history = document.getElementById('createRoomHistory').checked;
    if (!name) return setStatus('Please enter a room name.', true);
    if (isPrivate && !password) return setStatus('Private rooms need a password.', true);
    if (!isPrivate && name.toLowerCase() === 'general') return setStatus('General already exists - pick it from the list.', true);
    enterRoom({ type: isPrivate ? 'private' : 'public', name: name, password: password, history: history });
  };

  window.joinPrivateRoom = function() {
    const name = document.getElementById('joinRoomName').value.trim();
    const password = document.getElementById('joinRoomPassword').value;
    const history = document.getElementById('joinRoomHistory').checked;
    if (!name || !password) return setStatus('Please enter the room name and password.', true);
    enterRoom({ type: 'private', name: name, password: password, history: history });
  };
});
