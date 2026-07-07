const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

io.on('connection', (socket) => {
  console.log('socket connected:', socket.id);

  socket.on('join', (room) => {
    socket.join(room);
    const others = Array.from(io.sockets.adapter.rooms.get(room) || [] ).filter(id => id !== socket.id);
    // Notify peers
    socket.to(room).emit('peer-joined', socket.id);
    socket.emit('joined', { room, others });
  });

  socket.on('signal', ({ to, data }) => {
    if (to) {
      io.to(to).emit('signal', { from: socket.id, data });
    } else {
      // broadcast to other clients in the same rooms
      const rooms = Array.from(socket.rooms).filter(r => r !== socket.id);
      rooms.forEach(room => socket.to(room).emit('signal', { from: socket.id, data }));
    }
  });

  socket.on('disconnecting', () => {
    const rooms = Array.from(socket.rooms).filter(r => r !== socket.id);
    rooms.forEach(room => socket.to(room).emit('peer-left', socket.id));
  });

  socket.on('disconnect', () => {
    console.log('socket disconnected', socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
