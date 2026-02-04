import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Import routes
import partnerRoutes from './routes/partners.js';
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
import partnerProfileMobileRoutes from './routes/mobile/partnerProfile.js';
import mobileContentRoutes from './routes/mobile/content.js';
import chatRoutes from './routes/mobile/chat.js';
import voiceRoutes from './routes/mobile/voice.js';
import uploadRoutes from './routes/upload.js';
import mediaRoutes from './routes/media.js';
import testimonialRoutes from './routes/testimonials/index.js';
import reviewRoutes from './routes/reviews.js';
import founderMessageRoutes from './routes/founderMessages/index.js';
import brandAssetRoutes from './routes/brandAssets/index.js';
import sponsorRoutes from './routes/sponsors.js';
import expertCategoryRoutes from './routes/expertCategories.js';
import expertRoutes from './routes/experts.js';
import meditationRoutes from './routes/meditations.js';
import liveAvatarRoutes from './routes/liveAvatars.js';
import brahmAvatarRoutes from './routes/brahmAvatars.js';
import chantingRoutes from './routes/chantings.js';
import prathanaRoutes from './routes/prathanas.js';
import spiritualActivityRoutes from './routes/spiritualActivities.js';
import spiritualConfigurationRoutes from './routes/spiritualConfigurations.js';
import spiritualClipRoutes from './routes/spiritualClips.js';
import spiritualStatsRoutes from './routes/spiritualStats.js';
import chapterRoutes from './routes/chapters.js';
import shlokaRoutes from './routes/shlokas.js';

// ============ NEW: Import Chat Routes ============
import partnerUserChatRoutes from './routes/chatRoutes.js';

// Import services
import { initializeSuperAdmin } from './config/initSuperAdmin.js';
import { setupVoiceAgentWebSocket } from './routes/mobile/voiceAgent.js';

// ============ NEW: Import Chat WebSocket Service ============
import { setupChatWebSocket } from './services/chatWebSocket.js';

dotenv.config();

const app = express();

// IMPORTANT: Create HTTP server FIRST before setting up WebSocket
const server = http.createServer(app);

// CORS Configuration - MUST BE BEFORE OTHER MIDDLEWARE
app.use(cors({
  origin: (origin, callback) => {
    callback(null, true);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));


// Security Headers for Google Sign-In
app.use((req, res, next) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  res.setHeader('Cross-Origin-Embedder-Policy', 'unsafe-none');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  next();
});

// Increase body parser limit for audio data (50MB)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Serve static files from uploads directory
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// MongoDB Connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/brahmakosh';
mongoose.connect(MONGODB_URI)
.then(async () => {
  console.log('MongoDB connected successfully');
  await initializeSuperAdmin();
})
.catch((err) => console.error('MongoDB connection error:', err));

// ============ REST API ROUTES ============

// Partner Routes
app.use('/api/partners', partnerRoutes);

// Auth Routes
app.use('/api/auth/super-admin', superAdminAuthRoutes);
app.use('/api/auth/admin', adminAuthRoutes);
app.use('/api/auth/client', clientAuthRoutes);
app.use('/api/auth/user', userAuthRoutes);
app.use('/api/auth/user', passwordResetRoutes);

// Application Routes
app.use('/api/users', userRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/client', clientRoutes);
app.use('/api/super-admin', superAdminRoutes);

// Mobile API Routes
app.use('/api/mobile/client', clientProfileMobileRoutes);
app.use('/api/mobile/user', userProfileMobileRoutes);
// app.use('/api/mobile/realtime-agent', realtimeAgentRoutes);
app.use('/api/mobile/chat', chatRoutes);
app.use('/api/mobile/voice', voiceRoutes);
app.use('/api/mobile/partner', partnerProfileMobileRoutes);
app.use('/api/mobile/content', mobileContentRoutes);

// Partner–User Chat (partners list, conversations, messages)
app.use('/api/chat', partnerUserChatRoutes);

// Upload & Media Routes
app.use('/api/upload', uploadRoutes);
app.use('/api/media', mediaRoutes);

// Content Routes
app.use('/api/testimonials', testimonialRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/sponsors', sponsorRoutes);
app.use('/api/expert-categories', expertCategoryRoutes);
app.use('/api/experts', expertRoutes);
app.use('/api/meditations', meditationRoutes);
app.use('/api/live-avatars', liveAvatarRoutes);
app.use('/api/brahm-avatars', brahmAvatarRoutes);
app.use('/api/chantings', chantingRoutes);
app.use('/api/prathanas', prathanaRoutes);
app.use('/api/spiritual-activities', spiritualActivityRoutes);
app.use('/api/spiritual-configurations', spiritualConfigurationRoutes);
app.use('/api/spiritual-clips', spiritualClipRoutes);
app.use('/api/founder-messages', founderMessageRoutes);
app.use('/api/brand-assets', brandAssetRoutes);
app.use('/api/spiritual-stats', spiritualStatsRoutes);
app.use('/api/chapters', chapterRoutes);
app.use('/api/shlokas', shlokaRoutes);

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

// ============ WEBSOCKET SETUP ============
// Setup WebSocket AFTER all routes are configured

// 1. Voice Agent WebSocket (existing)
setupVoiceAgentWebSocket(server);

// ============ NEW: 2. Chat WebSocket for Partner-User Communication ============
setupChatWebSocket(server);

// ============ START SERVER ============
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`✅ Server is running on port ${PORT}`);
  console.log(`✅ Voice WebSocket available at ws://localhost:${PORT}/api/voice/agent`);
  console.log(`✅ Chat WebSocket available at ws://localhost:${PORT}/socket.io/`);
  console.log(`✅ REST API available at http://localhost:${PORT}/api`);
});

export default app;