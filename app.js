import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import superAdminAuthRoutes from './routes/auth/superAdminAuth.js';
import adminAuthRoutes from './routes/auth/adminAuth.js';
import clientAuthRoutes from './routes/auth/clientAuth.js';
import userAuthRoutes from './routes/auth/userAuth.js';
import passwordResetRoutes from './routes/auth/passwordReset.js';
import userRoutes from './routes/users.js';
import adminRoutes from './routes/admin.js';
import clientRoutes from './routes/client.js';
import superAdminRoutes from './routes/superAdmin.js';
import clientProfileMobileRoutes from './routes/mobile/clientProfile.js';
import userProfileMobileRoutes from './routes/mobile/userProfile.js';
import chatRoutes from './routes/mobile/chat.js';
import voiceRoutes from './routes/mobile/voice.js';
import uploadRoutes from './routes/upload.js';
import mediaRoutes from './routes/media.js';
// import testimonialRoutes from './routes/testimonials.js'; // Using organized routes instead
import testimonialRoutes from './routes/testimonials/index.js';
import founderMessageRoutes from './routes/founderMessages/index.js';
import brandAssetRoutes from './routes/brandAssets/index.js';
import meditationRoutes from './routes/meditations.js';
import chantingRoutes from './routes/chantings.js';
import prathanaRoutes from './routes/prathanas.js';
import { initializeSuperAdmin } from './config/initSuperAdmin.js';
import realtimeAgentRoutes from './routes/mobile/realtimeAgent.js';
import { setupVoiceAgentWebSocket } from './routes/mobile/voiceAgent.js';

dotenv.config();

const app = express();

// IMPORTANT: Create HTTP server FIRST before setting up WebSocket
const server = http.createServer(app);

// CORS Configuration - MUST BE BEFORE OTHER MIDDLEWARE
app.use(cors({
  origin: ['http://localhost:5173', 'https://frontend-seven-steel-66.vercel.app', 'http://localhost:5174', 'https://backend-jfg8.onrender.com', 'https://brahmakoshfrontend.vercel.app'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Security Headers for Google Sign-In
app.use((req, res, next) => {
  // Less restrictive COOP for Google Sign-In popup
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  // Less restrictive COEP
  res.setHeader('Cross-Origin-Embedder-Policy', 'unsafe-none');
  next();
});

// Increase body parser limit for audio data (50MB)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Serve static files from uploads directory
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// MongoDB Connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/brahmakosh';
mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(async () => {
  console.log('MongoDB connected successfully');
  // Initialize super admin after MongoDB connection
  await initializeSuperAdmin();
})
.catch((err) => console.error('MongoDB connection error:', err));

// Auth Routes - Separate endpoints for each role
app.use('/api/auth/super-admin', superAdminAuthRoutes);
app.use('/api/auth/admin', adminAuthRoutes);
app.use('/api/auth/client', clientAuthRoutes);
app.use('/api/auth/user', userAuthRoutes);

// Password Reset Routes
app.use('/api/auth/user', passwordResetRoutes);

// Application Routes
app.use('/api/users', userRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/client', clientRoutes);
app.use('/api/super-admin', superAdminRoutes);

// Mobile API Routes - Profile Section
app.use('/api/mobile/client', clientProfileMobileRoutes);
app.use('/api/mobile/user', userProfileMobileRoutes);
app.use('/api/mobile/realtime-agent', realtimeAgentRoutes);

// Mobile API Routes - Chat & Voice
app.use('/api/mobile/chat', chatRoutes);
app.use('/api/mobile/voice', voiceRoutes);

// Upload Routes - S3 Image Upload
app.use('/api/upload', uploadRoutes);

// Media Routes - Presigned URLs
app.use('/api/media', mediaRoutes);

// Testimonial Routes
app.use('/api/testimonials', testimonialRoutes);

// Meditation Routes
app.use('/api/meditations', meditationRoutes);

// Chanting Routes
app.use('/api/chantings', chantingRoutes);

// Prathana Routes
app.use('/api/prathanas', prathanaRoutes);

// Founder Message Routes
app.use('/api/founder-messages', founderMessageRoutes);

// Brand Asset Routes
app.use('/api/brand-assets', brandAssetRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'Server is running' });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ 
    success: false, 
    message: 'Something went wrong!', 
    error: process.env.NODE_ENV === 'development' ? err.message : undefined 
  });
});
// Setup WebSocket AFTER all routes are configured
setupVoiceAgentWebSocket(server);

// Start server - ONLY use server.listen() (NOT app.listen())
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`✅ Server is running on port ${PORT}`);
  console.log(`✅ WebSocket available at ws://localhost:${PORT}/api/voice/agent`);
});

export default app;
