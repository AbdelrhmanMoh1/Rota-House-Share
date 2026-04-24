const WebSocket = require('ws');
const jwt = require('jsonwebtoken');

// Map of householdId -> Set of WebSocket clients
const rooms = new Map();

function setupWebSocket(server) {
  const wss = new WebSocket.Server({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const token = url.searchParams.get('token');
    const householdId = url.searchParams.get('householdId');

    if (!token || !householdId) {
      ws.close(4001, 'Missing token or householdId');
      return;
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      ws.userId = decoded.userId;
      ws.householdId = householdId;
    } catch {
      ws.close(4001, 'Invalid token');
      return;
    }

    if (!rooms.has(householdId)) rooms.set(householdId, new Set());
    rooms.get(householdId).add(ws);

    console.log('WS: user ' + ws.userId + ' joined household ' + householdId);
    ws.send(JSON.stringify({ type: 'CONNECTED', householdId }));

    ws.on('close', () => {
      const room = rooms.get(householdId);
      if (room) {
        room.delete(ws);
        if (room.size === 0) rooms.delete(householdId);
      }
    });

    ws.on('error', (err) => console.error('WS error:', err));
  });

  console.log('WebSocket server ready at /ws');
  return wss;
}

function broadcast(householdId, payload) {
  const room = rooms.get(householdId);
  if (!room) return;
  const message = JSON.stringify(payload);
  room.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

module.exports = { setupWebSocket, broadcast };
