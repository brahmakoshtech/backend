import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';
import superAdminAuthRoutes from './routes/auth/superAdminAuth.js';
import adminAuthRoutes from './routes/auth/adminAuth.js';
import clientAuthRoutes from './routes/auth/clientAuth.js';
import userAuthRoutes from './routes/auth/userAuth.js';
import userRoutes from './routes/users.js';
import adminRoutes from './routes/admin.js';
import clientRoutes from './routes/client.js';
import superAdminRoutes from './routes/superAdmin.js';
import clientProfileMobileRoutes from './routes/mobile/clientProfile.js';
import userProfileMobileRoutes from './routes/mobile/userProfile.js';
import chatRoutes from './routes/mobile/chat.js';
import voiceRoutes from './routes/mobile/voice.js';
import uploadRoutes from './routes/upload.js';
import { initializeSuperAdmin } from './config/initSuperAdmin.js';

dotenv.config();

const app = express();

// Middleware
app.use(cors());
// Increase body parser limit for audio data (50MB)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

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

// Application Routes
app.use('/api/users', userRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/client', clientRoutes);
app.use('/api/super-admin', superAdminRoutes);

// Mobile API Routes - Profile Section
app.use('/api/mobile/client', clientProfileMobileRoutes);
app.use('/api/mobile/user', userProfileMobileRoutes);

// Mobile API Routes - Chat & Voice
app.use('/api/mobile/chat', chatRoutes);
app.use('/api/mobile/voice', voiceRoutes);

// Upload Routes - S3 Image Upload
app.use('/api/upload', uploadRoutes);

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

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

export default app;

