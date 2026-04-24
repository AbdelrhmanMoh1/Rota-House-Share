require('dotenv').config();
const express = require('express');
const http    = require('http');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');

const { setupWebSocket } = require('./websocket/manager');

// --- 1. Import Routes ---
const authRoutes         = require('./routes/auth');
const billRoutes         = require('./routes/bills');
const householdRoutes    = require('./routes/households');
const notificationRoutes = require('./routes/notifications');
const taskRoutes         = require('./routes/tasks');
const uploadRoutes       = require('./routes/uploads');
const errorHandler       = require('./middleware/errorHandler');

const app    = express();
const server = http.createServer(app);

// --- 2. Global Middleware ---
app.use(cors());

// Body parser limit kept low (1mb). Bug #3 fix: we no longer try to push
// Base64 images through JSON — binary goes through multer/multipart instead,
// so the JSON body stays small and we don't need to raise this.
app.use(express.json({ limit: '1mb' }));

// --- 3. Static Frontend ---
const candidatePaths = [
  path.join(__dirname, '../../frontend'),
  path.join(__dirname, '../frontend'),
  path.join(__dirname, '../../rota-frontend-fixed')
];
const frontendPath = candidatePaths.find(p => fs.existsSync(p)) || candidatePaths[0];
app.use(express.static(frontendPath));

// --- 4. Static uploads (Bug #3): serve files written by multer.
// Strong caching is fine here since each upload gets a UUID filename — we
// never overwrite an existing one. immutable = tell the browser to trust
// the 1-year cache.
const uploadsPath = path.join(__dirname, '../uploads');
fs.mkdirSync(uploadsPath, { recursive: true });
app.use('/uploads', express.static(uploadsPath, {
  maxAge: '1y',
  immutable: true
}));

setupWebSocket(server);

// --- 5. API Routes ---
app.use('/api/auth',          authRoutes);
app.use('/api/bills',         billRoutes);
app.use('/api/households',    householdRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/tasks',         taskRoutes);
app.use('/api/upload',        uploadRoutes);

// --- 6. Root & Fallback ---
app.get('/', (req, res) => {
  res.sendFile(path.join(frontendPath, 'loadingscreen.html'));
});

app.get('*', (req, res, next) => {
  if (req.url.startsWith('/api') || req.url.startsWith('/uploads')) return next();
  res.sendFile(path.join(frontendPath, 'loadingscreen.html'), (err) => {
    if (err) {
      console.error('❌ Path error — frontend at:', frontendPath);
      res.status(404).json({ error: 'Frontend folder not found at: ' + frontendPath });
    }
  });
});

app.use(errorHandler);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
  console.log(`📁 Frontend served from: ${frontendPath}`);
  console.log(`📦 Uploads served from:  ${uploadsPath}`);
});
