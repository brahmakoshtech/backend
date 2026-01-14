import express from 'express';
import User from '../models/User.js';
import { generateToken, authenticate } from '../middleware/auth.js';

const router = express.Router();

// Register - User self-registration
router.post('/register/user', async (req, res) => {
  try {
    const { email, password, profile } = req.body;

    // Validate required fields
    if (!email || !password) {
      return res.status(400).json({ 
        success: false, 
        message: 'Email and password are required' 
      });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ 
        success: false, 
        message: 'User already exists with this email' 
      });
    }

    // Create user
    const user = new User({
      email,
      password,
      role: 'user',
      profile: profile || {},
      loginApproved: false // Requires super admin approval
    });

    await user.save();

    res.status(201).json({
      success: true,
      message: 'User registered successfully. Please wait for super admin approval to login.',
      data: {
        user
      }
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
});

// Register - Client self-registration
router.post('/register/client', async (req, res) => {
  try {
    const { email, password, clientInfo } = req.body;

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
        message: 'Client already exists with this email' 
      });
    }

    const user = new User({
      email,
      password,
      role: 'client',
      clientInfo: clientInfo || {},
      loginApproved: false // Requires super admin approval
    });

    await user.save();

    res.status(201).json({
      success: true,
      message: 'Client registered successfully. Please wait for super admin approval to login.',
      data: {
        user
      }
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
});

// Google Sign-In Registration/Login
router.post('/register/google', async (req, res) => {
  try {
    const { credential, clientId } = req.body;

    if (!credential || !clientId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Google credential and clientId are required' 
      });
    }

    // Verify Google token
    const { OAuth2Client } = require('google-auth-library');
    const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
    
    const ticket = await client.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    
    const payload = ticket.getPayload();
    const email = payload.email;
    const name = payload.name;
    const picture = payload.picture;

    // Check if client exists
    const clientDoc = await Client.findOne({ clientId });
    if (!clientDoc) {
      return res.status(404).json({ 
        success: false, 
        message: 'Client not found' 
      });
    }

    // Check if user already exists
    let user = await MobileUser.findOne({ email, clientId });
    
    if (user) {
      // User exists - login
      const token = generateToken(user._id);
      
      return res.json({
        success: true,
        message: 'Login successful',
        data: {
          token,
          user,
          clientId,
          clientName: clientDoc.name
        }
      });
    } else {
      // Create new user
      user = new MobileUser({
        email,
        name,
        profileImage: picture,
        clientId,
        emailVerified: true, // Google emails are already verified
        mobileVerified: false,
        registrationCompleted: false,
        authProvider: 'google'
      });

      await user.save();

      const token = generateToken(user._id);

      return res.status(201).json({
        success: true,
        message: 'User registered successfully with Google',
        data: {
          token,
          user,
          clientId,
          clientName: clientDoc.name
        }
      });
    }
  } catch (error) {
    console.error('Google Sign-In Error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Google authentication failed'
    });
  }
});

// Login
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

    // Check if login is approved (super admin can always login)
    if (user.role !== 'super_admin' && !user.loginApproved) {
      return res.status(403).json({ 
        success: false, 
        message: 'Login not approved. Please wait for super admin approval.' 
      });
    }

    const token = generateToken(user._id);

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        user,
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

