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
  const gunInstance = window.gun || (typeof Gun !== 'undefined' ? Gun() : null);
  const channel = gunInstance ? gunInstance.get('emergency-mesh-' + new Date().toISOString().slice(0,10)) : null;
  const messagesDiv = document.getElementById('messages');

  // Track last sent message time to avoid duplicate display
  let lastSentMsgTime = null;
  window.sendMsg = async function() {
    const msgInput = document.getElementById('msgInput');
    const groupKeyInput = document.getElementById('groupKeyInput');
    if (!msgInput || !groupKeyInput || !channel) return;
    const text = msgInput.value.trim();
    const senderAlias = window.alias || 'anon';
    if (!text || !senderAlias) return;
    // Encrypt message with the group key from input
    const groupKey = groupKeyInput.value.trim();
    const now = Date.now();
    const encrypted = await Gun.SEA.encrypt(text, groupKey);
    const msgObj = {
      msg: encrypted,
      time: now,
      id: senderAlias,
      username: senderAlias,
      color: window.isDark ? '#00ff00' : '#222'
    };
    lastSentMsgTime = now;
    // Store in Gun.js for persistence
    channel.get(msgObj.time).put(msgObj);
    // Deliver in real time via Socket.io (send decrypted for display)
    socket.emit('chat_message', `[${new Date(msgObj.time).toLocaleTimeString()}] ${senderAlias}: ${text}`);
    // Also append locally to avoid delay
    const msgElem = document.createElement('div');
    msgElem.innerHTML = `[${new Date(msgObj.time).toLocaleTimeString()}] <strong>${senderAlias}</strong>: ${text}`;
    msgElem.style.color = window.isDark ? '#00ff00' : '#222';
    messagesDiv.appendChild(msgElem);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
    // Clear input box
    msgInput.value = '';
  };

  if (channel) {
    const messagesDiv = document.getElementById('messages');
    // On page load, load all messages from Gun.js and display them
    let loadedGunMessages = new Set();
    channel.map().once(async m => {
      if (!m || !m.msg || loadedGunMessages.has(m.time)) return;
      // Avoid duplicate: skip if this message was just sent by this client
      if (lastSentMsgTime && Math.abs(m.time - lastSentMsgTime) < 1000 && m.username === (window.alias || 'anon')) return;
      loadedGunMessages.add(m.time);
      let decrypted = m.msg;
      try {
        const groupKey = document.getElementById('groupKeyInput').value.trim();
        decrypted = await Gun.SEA.decrypt(m.msg, groupKey);
        if (typeof decrypted === 'undefined' || decrypted === null || decrypted === '') {
          decrypted = '[Encrypted]';
        }
      } catch (e) {
        decrypted = '[Encrypted]';
      }
      const msgElem = document.createElement('div');
      // Add style to disable x-scroll and enable word break
      msgElem.style.overflowX = 'hidden';
      msgElem.style.wordBreak = 'break-word';
      const sender = m.username || m.id || 'anon';
      const isMe = (window.alias || 'anon') === sender;
      msgElem.innerHTML =
        `<span class="msg-timestamp" style="color:${window.isDark ? '#00ff00' : '#222'}">[${new Date(m.time).toLocaleTimeString()}]</span> ` +
        `<strong style="color:${isMe ? (window.isDark ? '#00ff00' : '#222') : 'red'}">${sender}</strong>: ` +
        `<span class="msg-text" style="color:${window.isDark ? '#00ff00' : '#222'}">${decrypted}</span>`;
      // Do not set msgElem.style.color, let inner elements control color
      if (messagesDiv) {
        messagesDiv.appendChild(msgElem);
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
      }
    });
    // Listen for real-time chat messages from Socket.io and append as <div>
    socket.on('chat_message', function(msg) {
      // Avoid duplicate: skip if this message was just sent by this client
      if (lastSentMsgTime && msg.includes(new Date(lastSentMsgTime).toLocaleTimeString()) && msg.includes(window.alias || 'anon')) return;
      if (messagesDiv) {
        // Only append as <div> if not a join/leave message (those are <li> in .ejs)
        if (!msg.includes('joined the chat') && !msg.includes('left the chat')) {
          const msgElem = document.createElement('div');
          // Add style to disable x-scroll and enable word break
          msgElem.style.overflowX = 'hidden';
          msgElem.style.wordBreak = 'break-word';
          // Parse: [time] username: message
          const match = msg.match(/^\[(.*?)\]\s+([^:]+):\s*(.*)$/);
            if (match) {
              const time = match[1];
              const username = match[2];
              const messageText = match[3];
              // Check if username is us
              const isMe = (window.alias || 'anon') === username;
              msgElem.innerHTML =
                `<span class="msg-timestamp" style="color:${window.isDark ? '#00ff00' : '#222'}">[${time}]</span> ` +
                `<strong style="color:${isMe ? (window.isDark ? '#00ff00' : '#222') : 'red'}">${username}</strong>: ` +
                `<span class="msg-text" style="color:${window.isDark ? '#00ff00' : '#222'}">${messageText}</span>`;
          } else {
            // fallback if pattern doesn't match
            msgElem.innerHTML = msg;
          }
          // Do not set msgElem.style.color, let inner spans control color
          messagesDiv.appendChild(msgElem);
          messagesDiv.scrollTop = messagesDiv.scrollHeight;
        }
      }
    });
  }

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