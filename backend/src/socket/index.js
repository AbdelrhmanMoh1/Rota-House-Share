const jwt = require('jsonwebtoken');

const connectedUsers = new Map(); // userId -> socketId

const initSocket = (io) => {
  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error('Authentication error'));
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.user = decoded;
      next();
    } catch (err) {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    // BUG 4 FIX: JWT tokens are signed with { userId } in authController.js:
    //   jwt.sign({ userId }, process.env.JWT_SECRET, ...)
    // So the decoded payload has the key 'userId', not 'id'.
    // Old code: const userId = socket.user.id  → always undefined
    // Fixed:    const userId = socket.user.userId
    const userId = socket.user.userId;
    connectedUsers.set(userId, socket.id);
    console.log(`🔌 User ${userId} connected`);

    socket.on('join:household', (householdId) => {
      socket.join(`household:${householdId}`);
      console.log(`User ${userId} joined room household:${householdId}`);
    });

    socket.on('leave:household', (householdId) => {
      socket.leave(`household:${householdId}`);
    });

    socket.on('disconnect', () => {
      connectedUsers.delete(userId);
      console.log(`🔌 User ${userId} disconnected`);
    });
  });
};

const notifyHousehold = (io, householdId, event, data) => {
  io.to(`household:${householdId}`).emit(event, data);
};

const notifyUser = (io, userId, event, data) => {
  const socketId = connectedUsers.get(userId);
  if (socketId) io.to(socketId).emit(event, data);
};

module.exports = { initSocket, notifyHousehold, notifyUser };
