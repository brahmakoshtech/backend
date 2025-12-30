import express from 'express';
import Admin from '../../models/Admin.js';
import { generateToken, authenticate } from '../../middleware/auth.js';

const router = express.Router();

// Admin Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ 
        success: false, 
        message: 'Email and password are required' 
      });
    }

    const admin = await Admin.findOne({ email, role: 'admin' });
    if (!admin) {
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid credentials' 
      });
    }

    const isPasswordValid = await admin.comparePassword(password);
    if (!isPasswordValid) {
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid credentials' 
      });
    }

    if (!admin.isActive) {
      return res.status(401).json({ 
        success: false, 
        message: 'Account is inactive. Please contact administrator.' 
      });
    }

    if (!admin.loginApproved) {
      return res.status(403).json({ 
        success: false, 
        message: 'Login not approved. Please wait for super admin approval.' 
      });
    }

    const token = generateToken(admin._id, admin.role);

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        user: { ...admin.toObject(), role: 'admin' },
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

// Get current admin
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


