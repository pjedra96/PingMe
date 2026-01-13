// Set endpoint text from mesh config
    if (typeof bluetoothEndpoint !== 'undefined') {
      endpointDisplay.textContent = bluetoothEndpoint;
    }

    // Patch HHS LinkupManager to handle Bluetooth endpoints gracefully
    if (window.HHS && window.HHS.LinkupManager) {
      const origGetLinkupServer = window.HHS.LinkupManager.prototype.getLinkupServer;
      window.HHS.LinkupManager.prototype.getLinkupServer = function(serverURL) {
        if (serverURL.startsWith('bluetooth://')) {
          // Return a stub object with required methods
          return {
            listenForMessagesNewCall: function() {},
            listenForMessagesOnCall: function() {},
            listenForRawMessages: function() {},
            sendMessageOnCall: function() {},
            sendRawMessage: function() {},
            listenForQueryResponses: function() {},
            queryForListeningAddresses: function() {},
            getInstanceIdForAddress: function() {},
            close: function() {}
          };
        }
        return origGetLinkupServer.call(this, serverURL);
      };
    }

    // Enable mesh networking with HHS if available
    if (window.HHS && window.HHS.Mesh && window.HHS.Identity) {
      // Create a new identity for this peer
      let myIdentity = new window.HHS.Identity();
      // Create the mesh with the identity
      let mesh = new window.HHS.Mesh(myIdentity);

      // --- OFFLINE MESH: Bluetooth only ---
      const bluetoothEndpoint = 'bluetooth://mesh-communicator';
      const endpoints = [bluetoothEndpoint];

      const peerSource = {
        getPeers: async function (count) {
          return endpoints.map(endpoint => ({
            endpoint: endpoint,
            identityHash: myIdentity.hash(),
            identity: myIdentity
          }));
        },
        getPeerForEndpoint: async function (endpoint) {
          if (endpoints.includes(endpoint)) {
            return {
              endpoint: endpoint,
              identityHash: myIdentity.hash(),
              identity: myIdentity
            };
          }
          return undefined;
        }
      };

      // Listen only on Bluetooth endpoint for offline mesh
      const localPeer = {
        endpoint: bluetoothEndpoint,
        identity: myIdentity
      };
      let peerGroup = {
        id: 'my-group',
        localPeer: localPeer,
        peerSource: peerSource
      };
      mesh.joinPeerGroup(peerGroup, undefined, undefined);
      console.log('Mesh initialized and joined peer group for endpoint:', bluetoothEndpoint);

      // --- ONLINE MESH: WebRTC signaling (uncomment to use) ---
      /*
      const wrtcEndpoint = 'wrtc+wss://mypeer.net:443';
      const endpointsOnline = [wrtcEndpoint];
      const peerSourceOnline = {
        getPeers: async function (count) {
          return endpointsOnline.map(endpoint => ({
            endpoint: endpoint,
            identityHash: myIdentity.hash(),
            identity: myIdentity
          }));
        },
        getPeerForEndpoint: async function (endpoint) {
          if (endpointsOnline.includes(endpoint)) {
            return {
              endpoint: endpoint,
              identityHash: myIdentity.hash(),
              identity: myIdentity
            };
          }
          return undefined;
        }
      };
      const localPeerOnline = {
        endpoint: wrtcEndpoint,
        identity: myIdentity
      };
      let peerGroupOnline = {
        id: 'my-group',
        localPeer: localPeerOnline,
        peerSource: peerSourceOnline
      };
      mesh.joinPeerGroup(peerGroupOnline, undefined, undefined);
      console.log('Mesh initialized and joined peer group for endpoint:', wrtcEndpoint);
      */

      if (mesh && mesh.pod) {
        mesh.pod.agents.get('peer-control-for-my-group').controlLog.level = 2; // Optional: set log level for more info

        // Save original broadcastEvent
        const originalBroadcastEvent = mesh.pod.broadcastEvent.bind(mesh.pod);

        mesh.pod.broadcastEvent = function(ev) {
          originalBroadcastEvent(ev);
          if (ev.type === window.HHS.PeerMeshEventType.NewPeer) {
            document.getElementById('meshStatus').textContent = 'Connected to mesh peer!';
          } else if (ev.type === window.HHS.PeerMeshEventType.LostPeer) {
            document.getElementById('meshStatus').textContent = 'Peer disconnected!';
          }
        };

        setInterval(() => {
          const peerAgent = mesh.pod.agents.get('peer-control-for-my-group');
          if (peerAgent) {
            const peers = peerAgent.getPeers();
            if (peers.length === 0) {
              document.getElementById('meshStatus').textContent = 'Waiting for mesh peers...';
            }
          }
        }, 3000);
      }
    } else {
      console.error('HHS Mesh or Identity not available.');
    }

    const channel = gun.get('emergency-mesh-' + new Date().toISOString().slice(0,10));
    // Encrypt message before sending
    async function sendMsg() {
    const text = msgInput.value.trim();
    if (!text || !alias) return;
    // Encrypt message with the group key from input
    const groupKey = groupKeyInput.value.trim();
    const encrypted = await Gun.SEA.encrypt(text, groupKey);
    channel.get(Date.now()).put({
      msg: encrypted,
      time: Date.now(),
      id: alias,
      username: alias,
      color: isDark ? '#00ff00' : '#222'
    });
    msgInput.value = '';
  }

    // Decrypt and display received messages in UI
    channel.map().on(async m => {
      if (!m || !m.msg) return;
      let decrypted = m.msg;
      try {
        const groupKey = document.getElementById('groupKeyInput').value.trim();
        decrypted = await Gun.SEA.decrypt(m.msg, groupKey);
        if (typeof decrypted === 'undefined' || decrypted === null || decrypted === '') {
          decrypted = '[Encrypted]';
          console.warn('Decryption returned undefined/null/empty:', m);
        }
      } catch (e) {
        decrypted = '[Encrypted]';
        console.error('Decryption error:', e, m);
      }
      const msgElem = document.createElement('div');
      // Show sender's username if available, otherwise fallback to ID
      const sender = m.username || m.id || 'anon';
      msgElem.textContent = `[${new Date(m.time).toLocaleTimeString()}] ${sender}: ${decrypted}`;
      msgElem.style.color = isDark ? '#00ff00' : '#222';
      messagesDiv.appendChild(msgElem);
      messagesDiv.scrollTop = messagesDiv.scrollHeight;
    });

    // Utility to generate a random color
    function getRandomColor() {
      const letters = '0123456789ABCDEF';
      let color = '#';
      for (let i = 0; i < 6; i++) {
        color += letters[Math.floor(Math.random() * 16)];
      }
      return color;
    }

    // Fallback: if color missing, generate from username
      function stringToColor(str) {
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
      }