import express from 'express';
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

export default router;


