// src/routes/client.js

import express from 'express';
import { authenticate, authorize } from '../middleware/auth.js';
import User from '../models/User.js';
import Client from '../models/Client.js';
import Astrology from '../models/Astrology.js';
import Panchang from '../models/Panchang.js';
import astrologyService from '../services/astrologyService.js';
import panchangService from '../services/panchangService.js';
import numerologyService from '../services/numerologyService.js';

const router = express.Router();

/**
 * Get client's own users
 * GET /api/client/users
 */
router.get('/users', authenticate, authorize('client', 'admin', 'super_admin'), async (req, res) => {
  try {
    let query = {};

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

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'User already exists with this email'
      });
    }

    console.log('[Client API] Creating user for client:', req.user._id.toString());

    const user = new User({
      email,
      password,
      profile: profile || {},
      clientId: req.user.role === 'client' ? req.user._id : req.body.clientId,
      emailVerified: true,
      loginApproved: true,
      registrationStep: 3
    });

    await user.save();
    console.log('[Client API] User created:', user._id.toString());

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

    if (req.user.role === 'client') {
      if (!user.clientId || user.clientId.toString() !== req.user._id.toString()) {
        return res.status(403).json({
          success: false,
          message: 'You can only update your own users'
        });
      }
    }

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

    if (req.user.role === 'client') {
      if (!user.clientId || user.clientId.toString() !== req.user._id.toString()) {
        return res.status(403).json({
          success: false,
          message: 'You can only delete your own users'
        });
      }
    }

    // Delete associated astrology data
    await Astrology.findOneAndDelete({ userId });
    await Panchang.findOneAndDelete({ userId });
    
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
 * Query params: ?refresh=true to force refresh from API
 */
router.get('/users/:userId/complete-details', authenticate, authorize('client', 'admin', 'super_admin'), async (req, res) => {
  try {
    const { userId } = req.params;
    const forceRefresh = req.query.refresh === 'true';

    console.log('[Client API] Fetching complete details for user:', userId, 'Refresh:', forceRefresh);

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

    if (req.user.role === 'client') {
      if (!user.clientId || user.clientId._id.toString() !== req.user._id.toString()) {
        return res.status(403).json({
          success: false,
          message: 'You can only view your own users'
        });
      }
    }

    let astrologyData = null;
    let astrologyError = null;

    const hasRequiredFields = user.profile?.dob && 
                             user.profile?.timeOfBirth && 
                             (user.profile?.latitude !== null && user.profile?.latitude !== undefined) &&
                             (user.profile?.longitude !== null && user.profile?.longitude !== undefined);

    if (hasRequiredFields) {
      try {
        console.log('[Client API] Fetching astrology data from service...');
        astrologyData = await astrologyService.getCompleteAstrologyData(userId, user.profile, forceRefresh);
        console.log('[Client API] Astrology data retrieved successfully');
      } catch (error) {
        console.error('[Client API] Astrology generation error:', error);
        astrologyError = error.message;
      }
    } else {
      astrologyError = 'Incomplete birth details: dob, timeOfBirth, latitude, and longitude are required';
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
 * Query params: ?refresh=true to force refresh from API
 */
router.get('/users/:userId/astrology', authenticate, authorize('client', 'admin', 'super_admin'), async (req, res) => {
  try {
    const { userId } = req.params;
    const forceRefresh = req.query.refresh === 'true';

    const user = await User.findById(userId)
      .select('profile clientId')
      .lean();

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    if (req.user.role === 'client') {
      if (!user.clientId || user.clientId.toString() !== req.user._id.toString()) {
        return res.status(403).json({
          success: false,
          message: 'You can only view astrology data for your own users'
        });
      }
    }

    if (!user.profile?.dob || !user.profile?.timeOfBirth || 
        user.profile?.latitude === null || user.profile?.latitude === undefined ||
        user.profile?.longitude === null || user.profile?.longitude === undefined) {
      return res.status(400).json({
        success: false,
        message: 'User has incomplete birth details',
        missingFields: {
          dob: !user.profile?.dob,
          timeOfBirth: !user.profile?.timeOfBirth,
          latitude: user.profile?.latitude === null || user.profile?.latitude === undefined,
          longitude: user.profile?.longitude === null || user.profile?.longitude === undefined
        }
      });
    }

    const astrologyData = await astrologyService.getCompleteAstrologyData(userId, user.profile, forceRefresh);

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
 * Refresh astrology data for a user (force recalculation)
 * POST /api/client/users/:userId/astrology/refresh
 */
router.post('/users/:userId/astrology/refresh', authenticate, authorize('client', 'admin', 'super_admin'), async (req, res) => {
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

    if (req.user.role === 'client') {
      if (!user.clientId || user.clientId.toString() !== req.user._id.toString()) {
        return res.status(403).json({
          success: false,
          message: 'You can only refresh astrology data for your own users'
        });
      }
    }

    const astrologyData = await astrologyService.refreshAstrologyData(userId, user.profile);

    res.json({
      success: true,
      message: 'Astrology data refreshed successfully',
      data: astrologyData
    });

  } catch (error) {
    console.error('[Client API] Refresh astrology data error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to refresh astrology data',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * Get panchang data for current date and location
 * POST /api/client/users/:userId/panchang
 * Body: { currentDate: "2026-01-24T10:30:00Z", latitude: 19.076, longitude: 72.8777 }
 * Query params: ?refresh=true to force refresh from API
 */
router.post('/users/:userId/panchang', authenticate, authorize('client', 'admin', 'super_admin'), async (req, res) => {
  try {
    const { userId } = req.params;
    const { currentDate, latitude, longitude } = req.body;
    const forceRefresh = req.query.refresh === 'true';

    // Validate user
    const user = await User.findById(userId)
      .select('clientId')
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
          message: 'You can only view panchang data for your own users'
        });
      }
    }

    // Validate request body
    if (!currentDate) {
      return res.status(400).json({
        success: false,
        message: 'currentDate is required in request body'
      });
    }

    if (latitude === null || latitude === undefined) {
      return res.status(400).json({
        success: false,
        message: 'latitude is required in request body'
      });
    }

    if (longitude === null || longitude === undefined) {
      return res.status(400).json({
        success: false,
        message: 'longitude is required in request body'
      });
    }

    // Get panchang data with current date and location
    const panchangData = await panchangService.getCompletePanchangData(
      userId, 
      currentDate, 
      latitude, 
      longitude, 
      forceRefresh
    );

    res.json({
      success: true,
      data: panchangData
    });

  } catch (error) {
    console.error('[Client API] Get panchang data error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch panchang data',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * Refresh panchang data for a user (force recalculation)
 * POST /api/client/users/:userId/panchang/refresh
 * Body: { currentDate: "2026-01-24T10:30:00Z", latitude: 19.076, longitude: 72.8777 }
 */
router.post('/users/:userId/panchang/refresh', authenticate, authorize('client', 'admin', 'super_admin'), async (req, res) => {
  try {
    const { userId } = req.params;
    const { currentDate, latitude, longitude } = req.body;

    const user = await User.findById(userId)
      .select('clientId')
      .lean();

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    if (req.user.role === 'client') {
      if (!user.clientId || user.clientId.toString() !== req.user._id.toString()) {
        return res.status(403).json({
          success: false,
          message: 'You can only refresh panchang data for your own users'
        });
      }
    }

    // Validate request body
    if (!currentDate || latitude === null || latitude === undefined || longitude === null || longitude === undefined) {
      return res.status(400).json({
        success: false,
        message: 'currentDate, latitude, and longitude are required in request body'
      });
    }

    const panchangData = await panchangService.refreshPanchangData(userId, currentDate, latitude, longitude);

    res.json({
      success: true,
      message: 'Panchang data refreshed successfully',
      data: panchangData
    });

  } catch (error) {
    console.error('[Client API] Refresh panchang data error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to refresh panchang data',
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

// Add these routes to your client.js file or create a separate numerology routes file

/**
 * Get numerology data for a user
 * POST /api/client/users/:userId/numerology
 * Body: { date: "2026-01-24" or { day: 24, month: 1, year: 2026 }, name: "John Doe" }
 * Query params: ?refresh=true to force refresh from API
 */
router.post('/users/:userId/numerology', authenticate, authorize('client', 'admin', 'super_admin'), async (req, res) => {
  try {
    const { userId } = req.params;
    const { date, name } = req.body;
    const forceRefresh = req.query.refresh === 'true';

    // Validate user
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
          message: 'You can only access numerology data for your own users'
        });
      }
    }

    // Validate request body
    if (!date) {
      return res.status(400).json({
        success: false,
        message: 'date is required in request body (format: "YYYY-MM-DD" or { day, month, year })'
      });
    }

    // Use provided name or fall back to user profile name
    const userName = name || user.profile?.name || user.profile?.firstName || 'User';

    if (!userName) {
      return res.status(400).json({
        success: false,
        message: 'name is required either in request body or user profile'
      });
    }

    // Import numerologyService at the top of the file
    // import numerologyService from '../services/numerologyService.js';

    const result = await numerologyService.getNumerologyData(
      userId,
      date,
      userName,
      forceRefresh
    );

    res.json({
      success: true,
      source: result.source, // 'database' or 'api'
      data: result.data
    });

  } catch (error) {
    console.error('[Client API] Get numerology data error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch numerology data',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * Refresh numerology data for a user (force recalculation)
 * POST /api/client/users/:userId/numerology/refresh
 * Body: { date: "2026-01-24", name: "John Doe" }
 */
router.post('/users/:userId/numerology/refresh', authenticate, authorize('client', 'admin', 'super_admin'), async (req, res) => {
  try {
    const { userId } = req.params;
    const { date, name } = req.body;

    const user = await User.findById(userId)
      .select('profile clientId')
      .lean();

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    if (req.user.role === 'client') {
      if (!user.clientId || user.clientId.toString() !== req.user._id.toString()) {
        return res.status(403).json({
          success: false,
          message: 'You can only refresh numerology data for your own users'
        });
      }
    }

    if (!date) {
      return res.status(400).json({
        success: false,
        message: 'date is required in request body'
      });
    }

    const userName = name || user.profile?.name || user.profile?.firstName || 'User';

    const result = await numerologyService.refreshNumerologyData(userId, date, userName);

    res.json({
      success: true,
      message: 'Numerology data refreshed successfully',
      source: result.source,
      data: result.data
    });

  } catch (error) {
    console.error('[Client API] Refresh numerology data error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to refresh numerology data',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * Get numerology history for a user
 * GET /api/client/users/:userId/numerology/history
 * Query params: ?limit=10&skip=0
 */
router.get('/users/:userId/numerology/history', authenticate, authorize('client', 'admin', 'super_admin'), async (req, res) => {
  try {
    const { userId } = req.params;
    const limit = parseInt(req.query.limit) || 10;
    const skip = parseInt(req.query.skip) || 0;

    const user = await User.findById(userId)
      .select('clientId')
      .lean();

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    if (req.user.role === 'client') {
      if (!user.clientId || user.clientId.toString() !== req.user._id.toString()) {
        return res.status(403).json({
          success: false,
          message: 'You can only access numerology history for your own users'
        });
      }
    }

    const result = await numerologyService.getNumerologyHistory(userId, limit, skip);

    res.json({
      success: true,
      data: result
    });

  } catch (error) {
    console.error('[Client API] Get numerology history error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch numerology history',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * Delete numerology data for a specific date
 * DELETE /api/client/users/:userId/numerology
 * Body: { date: "2026-01-24" }
 */
router.delete('/users/:userId/numerology', authenticate, authorize('client', 'admin', 'super_admin'), async (req, res) => {
  try {
    const { userId } = req.params;
    const { date } = req.body;

    const user = await User.findById(userId)
      .select('clientId')
      .lean();

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    if (req.user.role === 'client') {
      if (!user.clientId || user.clientId.toString() !== req.user._id.toString()) {
        return res.status(403).json({
          success: false,
          message: 'You can only delete numerology data for your own users'
        });
      }
    }

    if (!date) {
      return res.status(400).json({
        success: false,
        message: 'date is required in request body'
      });
    }

    await numerologyService.deleteNumerologyData(userId, date);

    res.json({
      success: true,
      message: 'Numerology data deleted successfully'
    });

  } catch (error) {
    console.error('[Client API] Delete numerology data error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to delete numerology data',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

export default router;