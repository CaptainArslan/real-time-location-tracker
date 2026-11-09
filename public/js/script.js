console.log('Script loaded successfully.');

const socket = io();

socket.on('connect', () => { console.log('Connected to server via WebSocket.'); });

if (navigator.geolocation) {
    navigator.geolocation.watchPosition((position) => {
        const { latitude, longitude } = position.coords;
        // Send the location data to the server via WebSocket
        socket.emit('send-location', {
            latitude,
            longitude
        });
    }, (error) => {
        console.error('Error getting location:', error);
    }, {
        enableHighAccuracy: true,
        timeout: 5000,
        maximumAge: 0
    });
}

const map = new L.map('map').setView([0, 0], 16);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://portfolio-cyan-five-61.vercel.app/">M Arslan</a>'
}).addTo(map);

const marker = {};
var count = 0

// Listen for location updates from the server
socket.on('receive-location', (data) => {
    console.log('Received location data from server:', data);
    const { id, latitude, longitude } = data;
    // if latitude and longitude are same as previous, do not update the marker
    if (marker[id] && marker[id].getLatLng().lat === latitude && marker[id].getLatLng().lng === longitude) {
        return;
    }
    map.setView([latitude, longitude], 16);
    if (!marker[id]) {
        marker[id] = L.marker([latitude, longitude]).addTo(map);
        count++;
        console.log('Total connected users:', count);
    } else {
        marker[id].setLatLng([latitude, longitude]);
    }
});

// Server sends { id: '<socket id>' }, so destructure to get the id string
socket.on('user-disconnected', ({ id }) => {
    console.log('User disconnected:', id);
    if (marker[id]) {
        map.removeLayer(marker[id]);
        delete marker[id];
        count--;
        console.log('Total connected users:', count);
    }
});