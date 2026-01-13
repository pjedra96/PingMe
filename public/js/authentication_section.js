// Only one GUN initialization
const gun = Gun({
  peers: [
    //'https://gun-manhattan.herokuapp.com/gun',
    //'https://your-vps-domain.com/gun',
    'http://localhost:8765/gun'
  ],
  localStorage: false,
  radisk: false,
  multicast: false
});

document.addEventListener('DOMContentLoaded', function() {
  // UI elements
  const messagesDiv = document.getElementById('messages');
  const msgInput = document.getElementById('msgInput');
  const chatContainer = document.getElementById('chat-container');
  const authContainer = document.getElementById('auth-container');
  const authStatus = document.getElementById('authStatus');
  const inputArea = document.getElementById('input-area');
  const topBar = document.getElementById('top-bar');

  // Authentication logic
  const user = gun.user();
  let myPub = null;

  window.toggleAnonymous = function() {
    var anon = document.getElementById('anonymousCheckbox').checked;
    var pwd = document.getElementById('password');
    var registerBtn = document.querySelector('button[onclick="register()"]');
    if (anon) {
        pwd.style.display = 'none';
        pwd.disabled = true;
        if (registerBtn) registerBtn.disabled = true, registerBtn.style.display = 'none';
    } else {
        pwd.style.display = '';
        pwd.disabled = false;
        if (registerBtn) registerBtn.disabled = false, registerBtn.style.display = '';
    }
  }

  window.login = function() {
    const username = document.getElementById('username').value.trim();
    const passwordInput = document.getElementById('password');
    const anonymous = document.getElementById('anonymousCheckbox') && document.getElementById('anonymousCheckbox').checked;
    if (anonymous) {
      // Anonymous join: skip password, just set alias and show chat
      authStatus.textContent = 'Joined as ' + username + ' (anonymous)';
      authStatus.style.color = '#007700';
      chatContainer.style.display = 'block';
      authContainer.style.display = 'none';
      topBar.style.display = 'flex';
      inputArea.style.display = 'flex';
      window.alias = username;
      var aliasDisplay = document.getElementById('alias-display');
      if (aliasDisplay) aliasDisplay.textContent = username;
      // Optionally, set myPub to null or a random value
      myPub = null;
      // Optionally, set a default theme
      if (window.applyTheme) window.applyTheme(window.isDark);
      socket.emit('username', username); // Notify chat of username
      return;
    }
    const password = passwordInput.value;
    user.auth(username, password, async res => {
        if (res.err) {
          authStatus.textContent = 'Login failed: ' + res.err;
          authStatus.style.color = '#aa0000';
          chatContainer.style.display = 'none';
          authContainer.style.display = 'block';
          topBar.style.display = 'none';
          inputArea.style.display = 'none';
        } else {
          authStatus.textContent = 'Logged in as ' + username;
          authStatus.style.color = '#007700';
          chatContainer.style.display = 'block';
          authContainer.style.display = 'none';
          topBar.style.display = 'flex';
          inputArea.style.display = 'flex';
          myPub = user.is.pub;
          // Automatically update alias and alias display
          window.alias = username;
          var aliasDisplay = document.getElementById('alias-display');
          if (aliasDisplay) aliasDisplay.textContent = username;
          // Load theme preference from Gun
          user.get('theme').once(function(themePref) {
            if (typeof themePref === 'boolean') {
              window.isDark = themePref;
              // Apply theme
              if (window.applyTheme) window.applyTheme(themePref);
            }
          });
          socket.emit('username', username); // Notify chat of username
      }
    }, {sessionStorage: true}); // Enable session storage (persist login across reloads)
  }

  window.register = function() {
    const username = document.getElementById('username').value.trim();
    const passwordInput = document.getElementById('password');
    const anonymous = document.getElementById('anonymousCheckbox') && document.getElementById('anonymousCheckbox').checked;
    if (anonymous) {
      authStatus.textContent = 'Anonymous users cannot register.';
      authStatus.style.color = '#aa0000';
      return;
    }
    const password = passwordInput.value;
    user.create(username, password, res => {
      if (res.err) {
        authStatus.textContent = 'Registration failed: ' + res.err;
        authStatus.style.color = '#aa0000';
      } else {
        authStatus.textContent = 'Registered as ' + username + '. You can now log in.';
        authStatus.style.color = '#007700';
        // No need to assign color; color is now generated from username
      }
    });
  }
});