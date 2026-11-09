const path = require('path');
const express = require('express');
const app = express();
const http = require('http');
const socketio = require('socket.io');
const server = http.createServer(app);
const io = socketio(server);

const PORT = process.env.PORT || 3000;

// 2. Set up your view engine and static files
app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'public')));

io.on('connection', (socket) => {
    console.log('Socket ID:', socket.id);
    socket.on('send-location', (data) => {
        console.log('Received location data:', data);
        // Broadcast the location data to all connected clients
        io.emit('receive-location', {
            id: socket.id, ...data
        });
    });
});


io.on('disconnect', (socket) => {
    console.log('WebSocket disconnected');
    socket.broadcast.emit('user-disconnected', { id: socket.id });
});

app.get('/', (req, res) => {
    res.render('index');
});

server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});