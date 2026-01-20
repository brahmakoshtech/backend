// src/routes/client.js

import express from 'express';
import { authenticate, authorize } from '../middleware/auth.js';
import User from '../models/User.js';
import Client from '../models/Client.js';
import astrologyService from '../services/astrologyService.js';

const router = express.Router();

/**
 * Get client's own users
 * GET /api/client/users
 */
router.get('/users', authenticate, authorize('client', 'admin', 'super_admin'), async (req, res) => {
  try {
    let query = {};

    // If client role, only show their users
    if (req.user.role === 'client') {
      console.log('[Client API] Fetching users for client:', req.user._id.toString());
      query.clientId = req.user._id;
    }

    const users = await User.find(query)
      .select('-password -emailOtp -emailOtpExpiry -mobileOtp -mobileOtpExpiry')
      .populate('clientId', 'clientId businessName email')
      .sort({ createdAt: -1 })
      .lean();

    console.log('[Client API] Found users:', users.length);

    res.json({
      success: true,
      data: {
        users,
        count: users.length
      }
    });
  } catch (error) {
    console.error('[Client API] Get users error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch users',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * Create a new user under this client
 * POST /api/client/users
 */
router.post('/users', authenticate, authorize('client', 'admin', 'super_admin'), async (req, res) => {
  try {
    const { email, password, profile } = req.body;

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

    console.log('[Client API] Creating user for client:', req.user._id.toString());

    // Create user with clientId
    const user = new User({
      email,
      password,
      profile: profile || {},
      // For client role, use their _id as the clientId
      clientId: req.user.role === 'client' ? req.user._id : req.body.clientId,
      emailVerified: true,
      loginApproved: true,
      registrationStep: 3
    });

    await user.save();
    console.log('[Client API] User created:', user._id.toString());

    // Return user without sensitive data
    const userResponse = await User.findById(user._id)
      .select('-password -emailOtp -emailOtpExpiry -mobileOtp -mobileOtpExpiry')
      .populate('clientId', 'clientId businessName email')
      .lean();

    res.status(201).json({
      success: true,
      message: 'User created successfully',
      data: {
        user: userResponse
      }
    });
  } catch (error) {
    console.error('[Client API] Create user error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create user',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * Update a user
 * PUT /api/client/users/:userId
 */
router.put('/users/:userId', authenticate, authorize('client', 'admin', 'super_admin'), async (req, res) => {
  try {
    const { userId } = req.params;
    const { profile, isActive } = req.body;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check ownership for client role
    if (req.user.role === 'client') {
      if (!user.clientId || user.clientId.toString() !== req.user._id.toString()) {
        console.log('[Client API] Unauthorized update attempt:', {
          clientId: req.user._id.toString(),
          userClientId: user.clientId?.toString()
        });
        return res.status(403).json({
          success: false,
          message: 'You can only update your own users'
        });
      }
    }

    // Update fields
    if (profile) {
      user.profile = { ...user.profile, ...profile };
    }
    if (typeof isActive === 'boolean') {
      user.isActive = isActive;
    }

    await user.save();

    const updatedUser = await User.findById(userId)
      .select('-password -emailOtp -emailOtpExpiry -mobileOtp -mobileOtpExpiry')
      .populate('clientId', 'clientId businessName email')
      .lean();

    res.json({
      success: true,
      message: 'User updated successfully',
      data: {
        user: updatedUser
      }
    });
  } catch (error) {
    console.error('[Client API] Update user error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update user',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * Delete a user
 * DELETE /api/client/users/:userId
 */
router.delete('/users/:userId', authenticate, authorize('client', 'admin', 'super_admin'), async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check ownership for client role
    if (req.user.role === 'client') {
      if (!user.clientId || user.clientId.toString() !== req.user._id.toString()) {
        return res.status(403).json({
          success: false,
          message: 'You can only delete your own users'
        });
      }
    }

    await User.findByIdAndDelete(userId);
    console.log('[Client API] User deleted:', userId);

    res.json({
      success: true,
      message: 'User deleted successfully'
    });
  } catch (error) {
    console.error('[Client API] Delete user error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete user',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * Get user's complete details including astrology data
 * GET /api/client/users/:userId/complete-details
 */
router.get('/users/:userId/complete-details', authenticate, authorize('client', 'admin', 'super_admin'), async (req, res) => {
  try {
    const { userId } = req.params;

    console.log('[Client API] Fetching complete details for user:', userId);

    // Get the user with full details
    const user = await User.findById(userId)
      .select('-password -emailOtp -emailOtpExpiry -mobileOtp -mobileOtpExpiry')
      .populate('clientId', 'clientId businessName email')
      .lean();

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check ownership for client role
    if (req.user.role === 'client') {
      if (!user.clientId || user.clientId._id.toString() !== req.user._id.toString()) {
        console.log('[Client API] Unauthorized access attempt:', {
          clientId: req.user._id.toString(),
          userClientId: user.clientId?._id?.toString()
        });
        return res.status(403).json({
          success: false,
          message: 'You can only view your own users'
        });
      }
    }

    // Check if user has complete birth details for astrology
    let astrologyData = null;
    let astrologyError = null;

    console.log('[Client API] User profile data:', {
      dob: user.profile?.dob,
      timeOfBirth: user.profile?.timeOfBirth,
      latitude: user.profile?.latitude,
      longitude: user.profile?.longitude,
      placeOfBirth: user.profile?.placeOfBirth
    });

    const hasRequiredFields = user.profile?.dob && 
                             user.profile?.timeOfBirth && 
                             (user.profile?.latitude !== null && user.profile?.latitude !== undefined && user.profile?.latitude !== '') &&
                             (user.profile?.longitude !== null && user.profile?.longitude !== undefined && user.profile?.longitude !== '');

    console.log('[Client API] Birth details validation:', hasRequiredFields);

    if (hasRequiredFields) {
      try {
        console.log('[Client API] Generating astrology data...');
        astrologyData = await astrologyService.getCompleteAstrologyData(user.profile);
        console.log('[Client API] Astrology data generated successfully');
      } catch (error) {
        console.error('[Client API] Astrology generation error:', error);
        astrologyError = error.message;
      }
    } else {
      // For testing - provide sample data if birth details are missing
      console.log('[Client API] Using sample astrology data for testing');
      try {
        const sampleProfile = {
          dob: '1990-08-15',
          timeOfBirth: '14:30',
          latitude: '28.6139',
          longitude: '77.2090',
          placeOfBirth: 'New Delhi, India'
        };
        astrologyData = await astrologyService.getCompleteAstrologyData(sampleProfile);
        astrologyError = 'Using sample data - Please update birth details for accurate calculations';
      } catch (error) {
        astrologyError = 'Incomplete birth details required for astrology calculations';
      }
    }

    res.json({
      success: true,
      data: {
        user,
        astrology: astrologyData,
        astrologyError: astrologyError || undefined
      }
    });

  } catch (error) {
    console.error('[Client API] Get user complete details error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch user details',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * Get only astrology data for a user
 * GET /api/client/users/:userId/astrology
 */
router.get('/users/:userId/astrology', authenticate, authorize('client', 'admin', 'super_admin'), async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await User.findById(userId)
      .select('profile clientId')
      .lean();

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check ownership for client role
    if (req.user.role === 'client') {
      if (!user.clientId || user.clientId.toString() !== req.user._id.toString()) {
        return res.status(403).json({
          success: false,
          message: 'You can only view astrology data for your own users'
        });
      }
    }

    // Check if user has complete birth details
    if (!user.profile?.dob || !user.profile?.timeOfBirth || 
        !user.profile?.latitude || !user.profile?.longitude) {
      return res.status(400).json({
        success: false,
        message: 'User has incomplete birth details',
        missingFields: {
          dob: !user.profile?.dob,
          timeOfBirth: !user.profile?.timeOfBirth,
          latitude: !user.profile?.latitude,
          longitude: !user.profile?.longitude
        }
      });
    }

    const astrologyData = await astrologyService.getCompleteAstrologyData(user.profile);

    res.json({
      success: true,
      data: astrologyData
    });

  } catch (error) {
    console.error('[Client API] Get astrology data error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch astrology data',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * Get client dashboard overview
 * GET /api/client/dashboard/overview
 */
router.get('/dashboard/overview', authenticate, authorize('client', 'admin', 'super_admin'), async (req, res) => {
  try {
    let query = {};
    
    if (req.user.role === 'client') {
      query.clientId = req.user._id;
    }

    const totalUsers = await User.countDocuments(query);
    const activeUsers = await User.countDocuments({ ...query, isActive: true });
    const inactiveUsers = await User.countDocuments({ ...query, isActive: false });

    console.log('[Client API] Dashboard stats:', {
      clientId: req.user._id.toString(),
      totalUsers,
      activeUsers,
      inactiveUsers
    });

    res.json({
      success: true,
      data: {
        totalUsers,
        activeUsers,
        inactiveUsers,
        clientInfo: req.user.role === 'client' ? {
          businessName: req.user.businessName,
          email: req.user.email,
          clientId: req.user.clientId || 'Not assigned'
        } : undefined
      }
    });
  } catch (error) {
    console.error('[Client API] Dashboard error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch dashboard data',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

export default router;