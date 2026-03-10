import express from 'express';
import axios from 'axios';
import User from '../models/User.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// Get user profile
router.get('/profile', async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-password');
    res.json({
      success: true,
      data: { user }
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
});

// Update user profile
router.put('/profile', async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    
    if (req.body.password) {
      user.password = req.body.password;
    }
    
    if (req.body.profile) {
      user.profile = { ...user.profile, ...req.body.profile };
    }
    
    if (req.body.clientInfo) {
      user.clientInfo = { ...user.clientInfo, ...req.body.clientInfo };
    }

    Object.keys(req.body).forEach(key => {
      if (key !== 'password' && key !== 'profile' && key !== 'clientInfo') {
        user[key] = req.body[key];
      }
    });

    await user.save();

    res.json({
      success: true,
      message: 'Profile updated successfully',
      data: { user }
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
});

// Import/sync user from store.brahmakosh.com by email
// POST /api/users/by-email  { email }
router.post('/by-email', async (req, res) => {
  try {
    const { email } = req.body || {};

    if (!email || typeof email !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Email is required'
      });
    }

    // Call external API
    let remoteResponse;
    try {
      remoteResponse = await axios.post(
        'https://store.brahmakosh.com/api/users/by-email',
        { email }
      );
    } catch (err) {
      // If external API returns 4xx/5xx, forward its response when possible
      if (err.response) {
        return res.status(err.response.status).json(err.response.data);
      }
      throw err;
    }

    const remoteData = remoteResponse.data;

    // If remote API explicitly says user not found, just forward that
    if (
      remoteData?.message &&
      typeof remoteData.message === 'string' &&
      remoteData.message.toLowerCase().includes('user not found')
    ) {
      return res.status(404).json(remoteData);
    }

    // Try to locate the user object inside the response
    const remoteUser =
      remoteData?.user ||
      remoteData?.data?.user ||
      remoteData?.data ||
      null;

    if (!remoteUser) {
      // No concrete user object – just forward the response as-is
      return res.json(remoteData);
    }

    const remoteEmail = remoteUser.email || email;

    // Upsert into local User collection
    let user = await User.findOne({ email: remoteEmail }).select('+password');

    if (!user) {
      user = new User({
        email: remoteEmail,
        password: 'import_' + Date.now(),
        profile: {
          name:
            remoteUser.name ||
            remoteUser.fullName ||
            remoteUser.profile?.name ||
            remoteEmail
        },
        credits: typeof remoteUser.credits === 'number' ? remoteUser.credits : 0,
        karmaPoints:
          typeof remoteUser.karmaPoints === 'number'
            ? remoteUser.karmaPoints
            : 0,
        loginApproved: true,
        isActive: true
      });
    } else {
      // Update some basic fields from remote
      if (remoteUser.name || remoteUser.fullName || remoteUser.profile?.name) {
        user.profile = {
          ...(user.profile || {}),
          name:
            remoteUser.name ||
            remoteUser.fullName ||
            remoteUser.profile?.name
        };
      }

      if (typeof remoteUser.credits === 'number') {
        user.credits = remoteUser.credits;
      }

      if (typeof remoteUser.karmaPoints === 'number') {
        user.karmaPoints = remoteUser.karmaPoints;
      }
    }

    await user.save();

    const safeUser = await User.findById(user._id).select('-password');

    return res.json({
      success: true,
      source: 'store.brahmakosh.com',
      remote: remoteData,
      data: {
        user: safeUser
      }
    });
  } catch (error) {
    console.error('Error syncing user by email:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to sync user by email'
    });
  }
});

export default router;


