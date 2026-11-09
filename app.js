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

// Last known position of every connected user, so people who join later
// can see everyone straight away (even users who are standing still).
const users = new Map();

const MAX_NAME_LENGTH = 24;

// Only accept well-formed coordinates and copy known fields, so a client
// can't send junk that breaks other users' maps or overwrite its own id.
function cleanLocation(data) {
    if (!data || typeof data !== 'object') return null;
    const { latitude, longitude, accuracy, name } = data;
    if (typeof latitude !== 'number' || typeof longitude !== 'number') return null;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;

    return {
        latitude,
        longitude,
        accuracy: typeof accuracy === 'number' && Number.isFinite(accuracy)
            ? Math.min(Math.max(Math.round(accuracy), 0), 100000)
            : null,
        name: typeof name === 'string'
            ? name.replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, MAX_NAME_LENGTH)
            : '',
    };
}

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // Send the newcomer everyone who is already on the map
    socket.emit('existing-users', [...users].map(([id, user]) => ({ ...user, id })));

    socket.on('send-location', (data) => {
        const location = cleanLocation(data);
        if (!location) return;

        const user = { ...location, updatedAt: Date.now() };
        users.set(socket.id, user);
        // Broadcast to all connected clients; id always comes from the server
        io.emit('receive-location', { ...user, id: socket.id });
    });

    // 'disconnect' fires on each individual socket (not on io), so it must be
    // registered here, inside 'connection', where this user's socket exists.
    socket.on('disconnect', (reason) => {
        console.log('User disconnected:', socket.id, '-', reason);
        users.delete(socket.id);
        // Tell every other client to remove this user's marker
        socket.broadcast.emit('user-disconnected', { id: socket.id });
    });
});

app.get('/', (req, res) => {
    res.render('index');
});

server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});