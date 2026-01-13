// Module Dependencies
const express = require('express');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http);
const path = require('path');
const Gun = require('gun');
//app.use('/gun', Gun.serve);
//const gun = Gun({ web: http });
// Create a separate HTTP server for Gun.js on port 8765
const gunServer = require('http').createServer();
gunServer.listen(8765, () => {
    console.log('GUN relay server running on http://localhost:8765/gun');
});
Gun({ web: gunServer });

// Set EJS as templating engine
let users = 0;

// Sets EJS as the view engine
app.set('view engine', 'ejs');
// Sets /views as the default directory
app.use(express.static(path.join(__dirname, 'public'))); 

// Setting / as the main route of the application, which serves the chat page
app.get('/', function(req, res) {
    res.render('index.ejs');
});

// Socket.io configuration - event listeners
io.sockets.on('connection', function(socket) {
    // Listens to the events emitted by the clients and broadcasts them to all clients
    socket.on('username', function(username) {
        socket.username = username;
        users += 1;
        io.emit('is_online', '<span id="joined"></span> <i><strong>' + socket.username + '</strong> joined the chat..</i> =>' + users); // 🔵
    });

    socket.on('disconnect', function(username) {
        if(users > 0){ users -= 1; }
        io.emit('is_online', '<span id="left"></span> <i><strong>' + socket.username + '</strong> left the chat..</i> =>' + users); // 🔴
    })

    socket.on('chat_message', function(message) {
        io.emit('chat_message', message); //'<strong>' + socket.username + '</strong>: ' + message);
    });

    socket.on('typing', function() {
        io.emit('typing', { notification: socket.username + " is typing", username: socket.username});
    });

    socket.on('doneTyping', function() {
        io.emit('doneTyping');
    });

});

// Start the server
const server = http.listen(8080, function() {
    console.log('listening on *:8080');
    console.log('GUN relay server running on http://localhost:8080/gun');
});

// Stops the entire process when Signal Interrupt (Control-C) issued in the console
process.on('SIGINT', function(){
  console.log('Signal Interrupt received. Exiting the process');
  process.exit(0);
});