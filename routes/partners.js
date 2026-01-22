import express from 'express';
import jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';
import Partner from '../models/Partner.js';
const router = express.Router();

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// Generate JWT Token
const generateToken = (partnerId) => {
  return jwt.sign({ partnerId, role: 'partner' }, process.env.JWT_SECRET, {
    expiresIn: '30d'
  });
};

// @route   POST /api/partners/register
// @desc    Register new partner
// @access  Public
router.post('/register', async (req, res) => {
  try {
    const { name, email, password, phone, specialization } = req.body;

    // Check if partner already exists
    const existingPartner = await Partner.findOne({ email });
    if (existingPartner) {
      return res.status(400).json({
        success: false,
        message: 'Partner already exists with this email'
      });
    }

    // Create new partner
    const partner = new Partner({
      name,
      email,
      password,
      phone,
      specialization
    });

    await partner.save();

    // Generate token
    const token = generateToken(partner._id);

    res.status(201).json({
      success: true,
      message: 'Partner registered successfully',
      data: {
        partner: {
          id: partner._id,
          name: partner.name,
          email: partner.email,
          phone: partner.phone,
          specialization: partner.specialization,
          isVerified: partner.isVerified
        },
        token
      }
    });
  } catch (error) {
    console.error('Partner registration error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during registration'
    });
  }
});

// @route   POST /api/partners/login
// @desc    Login partner
// @access  Public
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Find partner
    const partner = await Partner.findOne({ email });
    if (!partner) {
      return res.status(400).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Check password
    const isMatch = await partner.comparePassword(password);
    if (!isMatch) {
      return res.status(400).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Check if partner is active
    if (!partner.isActive) {
      return res.status(400).json({
        success: false,
        message: 'Account is deactivated. Please contact support.'
      });
    }

    // Generate token
    const token = generateToken(partner._id);

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        partner: {
          id: partner._id,
          name: partner.name,
          email: partner.email,
          phone: partner.phone,
          specialization: partner.specialization,
          profilePicture: partner.profilePicture,
          rating: partner.rating,
          totalSessions: partner.totalSessions,
          isVerified: partner.isVerified
        },
        token
      }
    });
  } catch (error) {
    console.error('Partner login error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during login'
    });
  }
});

// @route   POST /api/partners/google-login
// @desc    Google OAuth login for partners
// @access  Public
router.post('/google-login', async (req, res) => {
  try {
    const { credential } = req.body;

    // Verify Google token
    const ticket = await client.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID
    });

    const payload = ticket.getPayload();
    const { sub: googleId, email, name, picture } = payload;

    // Check if partner exists
    let partner = await Partner.findOne({ 
      $or: [{ email }, { googleId }] 
    });

    if (partner) {
      // Update Google ID if not set
      if (!partner.googleId) {
        partner.googleId = googleId;
        await partner.save();
      }
    } else {
      // Create new partner
      partner = new Partner({
        name,
        email,
        googleId,
        profilePicture: picture,
        isVerified: true // Google accounts are pre-verified
      });
      await partner.save();
    }

    // Check if partner is active
    if (!partner.isActive) {
      return res.status(400).json({
        success: false,
        message: 'Account is deactivated. Please contact support.'
      });
    }

    // Generate token
    const token = generateToken(partner._id);

    res.json({
      success: true,
      message: 'Google login successful',
      data: {
        partner: {
          id: partner._id,
          name: partner.name,
          email: partner.email,
          phone: partner.phone,
          specialization: partner.specialization,
          profilePicture: partner.profilePicture,
          rating: partner.rating,
          totalSessions: partner.totalSessions,
          isVerified: partner.isVerified
        },
        token
      }
    });
  } catch (error) {
    console.error('Google login error:', error);
    res.status(500).json({
      success: false,
      message: 'Google authentication failed'
    });
  }
});

// @route   GET /api/partners/profile
// @desc    Get partner profile
// @access  Private
router.get('/profile', async (req, res) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'No token provided'
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const partner = await Partner.findById(decoded.partnerId).select('-password');

    if (!partner) {
      return res.status(404).json({
        success: false,
        message: 'Partner not found'
      });
    }

    res.json({
      success: true,
      data: partner
    });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

export default router;