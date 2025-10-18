const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const http = require('http');
const cookieParser = require('cookie-parser');
const { Server } = require('socket.io');
const { createAdapter } = require('@socket.io/redis-adapter');
const Redis = require('ioredis');

// Load environment variables
dotenv.config();

// Import routes
const authRoutes = require('./routes/auth');
const folderRoutes = require('./routes/folders');
const mediaRoutes = require('./routes/media'); // Added for Section 3
const documentRoutes = require('./routes/documents');

const app = express();

// HTTP server + Socket.io
const server = http.createServer(app);
let io;
if (process.env.REDIS_URL) {
  const pubClient = new Redis(process.env.REDIS_URL);
  const subClient = pubClient.duplicate();
  io = new Server(server, { cors: { origin: process.env.FRONTEND_ORIGIN || true, credentials: true } });
  io.adapter(createAdapter(pubClient, subClient));
} else {
  io = new Server(server, { cors: { origin: process.env.FRONTEND_ORIGIN || true, credentials: true } });
}

// Make io available to other modules
app.set('io', io);

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_ORIGIN || true,
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization'],
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
}));
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Database connection
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => {
  console.log('Connected to MongoDB');

  // Start realtime service and socket handlers after DB is connected
  try {
    require('./services/realtime')(app.get('io'));
  } catch (e) {
    console.warn('Realtime service not started:', e.message || e);
  }
  try {
    require('./services/socketHandlers')(app.get('io'));
  } catch (e) {
    console.warn('Socket handlers not started:', e.message || e);
  }
})
.catch((err) => console.error('MongoDB connection error:', err));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/folders', folderRoutes);
app.use('/api/media', mediaRoutes); // Added for Section 3
app.use('/api/documents', documentRoutes);
app.use('/api/notifications', require('./routes/notifications')); // Added for notifications
app.use('/api/professional-notifications', require('./routes/professionalNotifications')); // Added for professional notifications
app.use('/api/analytics', require('./routes/analytics')); // Added for analytics
app.use('/api/admin', require('./routes/admin'));

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ message: 'MoGallery Backend is running!' });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: 'Something went wrong!' });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
