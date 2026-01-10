import express from 'express';
import User from '../models/User.js';
import { authenticate, authorize } from '../middleware/auth.js';

const router = express.Router();

// All routes require client authentication
router.use(authenticate);
router.use(authorize('client', 'admin', 'super_admin'));

// Get all users under this client
router.get('/users', async (req, res) => {
  try {
    const clientId = req.user.role === 'client' ? req.user._id : req.query.clientId || req.user._id;
    
    const users = await User.find({ 
      clientId: clientId
    })
      .select('-password')
      .sort({ createdAt: -1 });
    
    res.json({
      success: true,
      data: { users }
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
});

// Create user for client
router.post('/users', async (req, res) => {
  try {
    const { email, password, profile } = req.body;
    const clientId = req.user.role === 'client' ? req.user._id : req.body.clientId || req.user._id;

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
      createdBy: req.user._id,
      clientId: clientId,
      loginApproved: true // Users created by client are auto-approved
    });

    await user.save();

    res.status(201).json({
      success: true,
      message: 'User created successfully',
      data: { user }
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
});

// Update user
router.put('/users/:id', async (req, res) => {
  try {
    const clientId = req.user.role === 'client' ? req.user._id : req.user._id;
    
    const user = await User.findOne({ 
      _id: req.params.id, 
      clientId: clientId
    });

    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: 'User not found' 
      });
    }

    Object.assign(user, req.body);
    await user.save();

    res.json({
      success: true,
      message: 'User updated successfully',
      data: { user }
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
});

// Delete user
router.delete('/users/:id', async (req, res) => {
  try {
    const clientId = req.user.role === 'client' ? req.user._id : req.user._id;
    
    const user = await User.findOne({ 
      _id: req.params.id, 
      clientId: clientId
    });

    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: 'User not found' 
      });
    }

    user.isActive = false;
    await user.save();

    res.json({
      success: true,
      message: 'User deactivated successfully'
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
});

// Get dashboard overview
router.get('/dashboard/overview', async (req, res) => {
  try {
    const clientId = req.user.role === 'client' ? req.user._id : req.user._id;
    
    const totalUsers = await User.countDocuments({ 
      clientId: clientId,
      isActive: true
    });

    res.json({
      success: true,
      data: {
        totalUsers
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

