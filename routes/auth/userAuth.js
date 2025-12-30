import express from 'express';
import User from '../../models/User.js';
import { generateToken, authenticate } from '../../middleware/auth.js';

const router = express.Router();

// User Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ 
        success: false, 
        message: 'Email and password are required' 
      });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid credentials' 
      });
    }

    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid credentials' 
      });
    }

    if (!user.isActive) {
      return res.status(401).json({ 
        success: false, 
        message: 'Account is inactive. Please contact administrator.' 
      });
    }

    if (!user.loginApproved) {
      return res.status(403).json({ 
        success: false, 
        message: 'Login not approved. Please wait for super admin approval.' 
      });
    }

    const token = generateToken(user._id, 'user');

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        user: { ...user.toObject(), role: 'user' },
        token
      }
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
});

// User Registration
router.post('/register', async (req, res) => {
  try {
    const { email, password, profile } = req.body;

    if (!email || !password) {
      return res.status(400).json({ 
        success: false, 
        message: 'Email and password are required' 
      });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ 
        success: false, 
        message: 'User already exists with this email' 
      });
    }

    const user = new User({
      email,
      password,
      profile: profile || {},
      loginApproved: false // Requires super admin approval
    });

    await user.save();

    res.status(201).json({
      success: true,
      message: 'User registered successfully. Please wait for super admin approval to login.',
      data: {
        user: user.toObject()
      }
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
});

// Get current user
router.get('/me', authenticate, async (req, res) => {
  try {
    res.json({
      success: true,
      data: {
        user: req.user
      }
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
});

export default router;


