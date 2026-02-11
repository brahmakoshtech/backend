// src/routes/client.js - UPDATED VERSION
// Now supports user token authentication for all endpoints
// Numerology endpoints updated: name always from DB, date defaults to today

import express from 'express';
import { authenticate, authorize } from '../middleware/auth.js';
import User from '../models/User.js';
import Client from '../models/Client.js';
import Astrology from '../models/Astrology.js';
import Panchang from '../models/Panchang.js';
import Credit from '../models/Credit.js';
import KarmaPointsTransaction from '../models/KarmaPointsTransaction.js';
import astrologyService from '../services/astrologyService.js';
import panchangService from '../services/panchangService.js';
import numerologyService from '../services/numerologyService.js';
import doshaService from '../services/doshaService.js';
import remedyService from '../services/remedyService.js';

const router = express.Router();

/**
 * Helper function to get client ID based on user role
 */
const getClientIdForQuery = (user) => {
  if (user.role === 'client') {
    return user._id;
  }
  if (user.role === 'user') {
    // For users, get clientId from populated field or token
    return user.clientId?._id || user.clientId || user.tokenClientId;
  }
  // Admin and super_admin don't filter by clientId
  return null;
};

/**
 * Helper function to check if user has access to a specific user record
 */
const checkUserAccess = (requestingUser, targetUser) => {
  // Super admin and admin have access to all users
  if (requestingUser.role === 'super_admin' || requestingUser.role === 'admin') {
    return true;
  }

  // Client can only access their own users
  if (requestingUser.role === 'client') {
    const targetClientId = targetUser.clientId?._id?.toString() || targetUser.clientId?.toString();
    return targetClientId === requestingUser._id.toString();
  }

  // User can only access their own record
  if (requestingUser.role === 'user') {
    return targetUser._id.toString() === requestingUser._id.toString();
  }

  return false;
};

/**
 * Get client's own users
 * GET /api/client/users
 * Query params: ?page=1&limit=25&search=query
 * Access: client, admin, super_admin, user (user can only see themselves)
 */
router.get('/users', authenticate, authorize('client', 'admin', 'super_admin', 'user'), async (req, res) => {
  try {
    const { search, page = 1, limit = 25 } = req.query;
    const pageNum = Math.max(parseInt(page) || 1, 1);
    const pageSize = Math.min(Math.max(parseInt(limit) || 25, 1), 100);
    const skip = (pageNum - 1) * pageSize;

    let query = {};

    if (req.user.role === 'client') {
      query.clientId = req.user._id;
    } else if (req.user.role === 'user') {
      query._id = req.user._id;
    }

    if (search && search.trim()) {
      const regex = new RegExp(search.trim(), 'i');
      query.$or = [
        { email: regex },
        { 'profile.name': regex }
      ];
    }

    const [users, total] = await Promise.all([
      User.find(query)
        .select('-password -emailOtp -emailOtpExpiry -mobileOtp -mobileOtpExpiry')
        .populate('clientId', 'clientId businessName email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(pageSize)
        .lean(),
      User.countDocuments(query)
    ]);

    const usersWithKarma = users.map(user => ({
      ...user,
      karmaPoints: user.karmaPoints ?? 0
    }));

    res.json({
      success: true,
      data: {
        users: usersWithKarma,
        total,
        page: pageNum,
        limit: pageSize,
        hasMore: total > skip + usersWithKarma.length
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
 * Access: client, admin, super_admin (users cannot create other users)
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
      credits: 1000, // signup bonus for client-created users
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
 * Add credits to a user (for paid chat/features)
 * POST /api/client/users/:userId/credits
 * Body: { amount: number, description?: string }
 * Access: client (own users), admin, super_admin
 */
router.post('/users/:userId/credits', authenticate, authorize('client', 'admin', 'super_admin'), async (req, res) => {
  try {
    const { userId } = req.params;
    const { amount, description } = req.body;

    const numericAmount = Number(amount);
    if (!numericAmount || Number.isNaN(numericAmount)) {
      return res.status(400).json({
        success: false,
        message: 'amount is required and must be a number'
      });
    }
    if (numericAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'amount must be greater than 0'
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Clients can only manage their own users
    if (req.user.role === 'client') {
      if (!user.clientId || user.clientId.toString() !== req.user._id.toString()) {
        return res.status(403).json({
          success: false,
          message: 'You can only add credits to your own users'
        });
      }
    }

    const previousBalance = user.credits || 0;
    const newBalance = previousBalance + numericAmount;

    user.credits = newBalance;
    await user.save();

    const tx = await Credit.create({
      userId: user._id,
      amount: numericAmount,
      previousBalance,
      newBalance,
      addedBy: req.user._id,
      addedByRole: req.user.role,
      description: description || `Credits added by ${req.user.role}`
    });

    res.status(201).json({
      success: true,
      message: 'Credits added successfully',
      data: {
        userId: user._id,
        previousBalance,
        newBalance,
        transaction: tx
      }
    });
  } catch (error) {
    console.error('[Client API] Add user credits error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add credits',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * Add karma points to a user (bonus points)
 * POST /api/client/users/:userId/karma-points
 * Body: { amount: number, description?: string }
 * Access: client (own users), admin, super_admin
 */
router.post('/users/:userId/karma-points', authenticate, authorize('client', 'admin', 'super_admin'), async (req, res) => {
  try {
    const { userId } = req.params;
    const { amount, description } = req.body;

    const numericAmount = Number(amount);
    if (!numericAmount || Number.isNaN(numericAmount)) {
      return res.status(400).json({
        success: false,
        message: 'amount is required and must be a number'
      });
    }
    if (numericAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'amount must be greater than 0'
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Clients can only manage their own users
    if (req.user.role === 'client') {
      if (!user.clientId || user.clientId.toString() !== req.user._id.toString()) {
        return res.status(403).json({
          success: false,
          message: 'You can only add karma points to your own users'
        });
      }
    }

    const previousBalance = user.karmaPoints || 0;
    const newBalance = previousBalance + numericAmount;

    user.karmaPoints = newBalance;
    await user.save();

    // Save transaction history
    const tx = await KarmaPointsTransaction.create({
      userId: user._id,
      amount: numericAmount,
      previousBalance,
      newBalance,
      addedBy: req.user._id,
      addedByModel: req.user.role === 'client' ? 'Client' : req.user.role === 'admin' || req.user.role === 'super_admin' ? 'Admin' : 'User',
      addedByRole: req.user.role,
      description: description || `Karma points bonus added by ${req.user.role}`
    });

    res.status(201).json({
      success: true,
      message: 'Karma points added successfully',
      data: {
        userId: user._id,
        previousBalance,
        newBalance,
        transaction: tx
      }
    });
  } catch (error) {
    console.error('[Client API] Add karma points error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add karma points',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * Get karma points transaction history for a user
 * GET /api/client/users/:userId/karma-points/history
 * Access: client (own users), admin, super_admin, user (own history only)
 */
router.get('/users/:userId/karma-points/history', authenticate, authorize('client', 'admin', 'super_admin', 'user'), async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check access permissions
    if (!checkUserAccess(req.user, user)) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view karma points history for this user'
      });
    }

    const transactions = await KarmaPointsTransaction.find({ userId })
      .populate('addedBy', 'email businessName profile')
      .sort({ createdAt: -1 })
      .lean();

    res.json({
      success: true,
      data: {
        transactions,
        currentBalance: user.karmaPoints || 0
      }
    });
  } catch (error) {
    console.error('[Client API] Get karma points history error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch karma points history',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * Update a user
 * PUT /api/client/users/:userId
 * Access: client (own users), admin, super_admin, user (own profile only)
 */
router.put('/users/:userId', authenticate, authorize('client', 'admin', 'super_admin', 'user'), async (req, res) => {
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

    // Check access permissions
    if (!checkUserAccess(req.user, user)) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to update this user'
      });
    }

    // Users can only update their own profile, not isActive status
    if (req.user.role === 'user') {
      if (isActive !== undefined) {
        return res.status(403).json({
          success: false,
          message: 'You cannot change your active status'
        });
      }
    }

    if (profile) {
      user.profile = { ...user.profile, ...profile };
    }
    if (typeof isActive === 'boolean' && req.user.role !== 'user') {
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
 * Update user's live location
 * PUT /api/client/users/:userId/live-location
 * Body: { latitude: 19.076, longitude: 72.8777, formattedAddress: "...", city: "...", state: "...", country: "..." }
 * Access: client (own users), admin, super_admin, user (own location only)
 */
router.put('/users/:userId/live-location', authenticate, authorize('client', 'admin', 'super_admin', 'user'), async (req, res) => {
  try {
    const { userId } = req.params;
    const { latitude, longitude, formattedAddress, city, state, country } = req.body;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check access permissions
    if (!checkUserAccess(req.user, user)) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to update location for this user'
      });
    }

    // Validate coordinates
    if (latitude === null || latitude === undefined || longitude === null || longitude === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Both latitude and longitude are required'
      });
    }

    const lat = parseFloat(latitude);
    const lon = parseFloat(longitude);

    if (lat < -90 || lat > 90) {
      return res.status(400).json({
        success: false,
        message: 'Latitude must be between -90 and 90'
      });
    }

    if (lon < -180 || lon > 180) {
      return res.status(400).json({
        success: false,
        message: 'Longitude must be between -180 and 180'
      });
    }

    // Update live location
    user.liveLocation = {
      latitude: lat,
      longitude: lon,
      formattedAddress: formattedAddress || user.liveLocation?.formattedAddress,
      city: city || user.liveLocation?.city,
      state: state || user.liveLocation?.state,
      country: country || user.liveLocation?.country,
      lastUpdated: new Date()
    };

    await user.save();

    const updatedUser = await User.findById(userId)
      .select('-password -emailOtp -emailOtpExpiry -mobileOtp -mobileOtpExpiry')
      .populate('clientId', 'clientId businessName email')
      .lean();

    res.json({
      success: true,
      message: 'Live location updated successfully',
      data: {
        user: updatedUser
      }
    });
  } catch (error) {
    console.error('[Client API] Update live location error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update live location',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * Delete a user
 * DELETE /api/client/users/:userId
 * Access: client (own users), admin, super_admin (users cannot delete themselves)
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

// FIX FOR: /api/client/users/:userId/complete-details endpoint
// Replace the existing endpoint in your client.js with this updated version

/**
 * Get user's complete details including astrology data
 * GET /api/client/users/:userId/complete-details
 * Query params: ?refresh=true to force refresh from API
 * Access: client (own users), admin, super_admin, user (own data only)
 */
router.get('/users/:userId/complete-details', authenticate, authorize('client', 'admin', 'super_admin', 'user'), async (req, res) => {
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

    // Check access permissions
    if (!checkUserAccess(req.user, user)) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view this user'
      });
    }

    let astrologyData = null;
    let astrologyError = null;
    let doshaData = null;

    // FIXED: Check for required fields including liveLocation for coordinates
    const hasRequiredFields = user.profile?.dob && 
                             user.profile?.timeOfBirth && 
                             (user.liveLocation?.latitude !== null && user.liveLocation?.latitude !== undefined) &&
                             (user.liveLocation?.longitude !== null && user.liveLocation?.longitude !== undefined);

    if (hasRequiredFields) {
      try {
        console.log('[Client API] Fetching astrology data from service...');
        
        // FIXED: Merge liveLocation coordinates into profile for astrology calculation
        const profileWithLocation = {
          ...user.profile,
          latitude: user.liveLocation.latitude,
          longitude: user.liveLocation.longitude
        };
        
        astrologyData = await astrologyService.getCompleteAstrologyData(
          userId, 
          profileWithLocation, 
          forceRefresh
        );
        console.log('[Client API] Astrology data retrieved successfully');

        // Fetch doshas + dashas (cached)
        try {
          doshaData = await doshaService.getAllDoshas(user, { forceRefresh });
        } catch (doshaErr) {
          console.warn('[Client API] Could not fetch doshas/dashas for complete-details:', doshaErr.message);
        }
      } catch (error) {
        console.error('[Client API] Astrology generation error:', error);
        astrologyError = error.message;
      }
    } else {
      // Detailed error message
      const missing = [];
      if (!user.profile?.dob) missing.push('dob');
      if (!user.profile?.timeOfBirth) missing.push('timeOfBirth');
      if (user.liveLocation?.latitude === null || user.liveLocation?.latitude === undefined) missing.push('latitude (liveLocation)');
      if (user.liveLocation?.longitude === null || user.liveLocation?.longitude === undefined) missing.push('longitude (liveLocation)');
      
      astrologyError = `Incomplete birth details. Missing: ${missing.join(', ')}`;
    }

    res.json({
      success: true,
      data: {
        user,
        astrology: astrologyData,
        doshas: doshaData ? doshaData.doshas : undefined,
        dashas: doshaData ? doshaData.dashas : undefined,
        doshaSummary: doshaData ? doshaData.summary : undefined,
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

// ALSO UPDATE: /api/client/users/:userId/astrology endpoint
router.get('/users/:userId/astrology', authenticate, authorize('client', 'admin', 'super_admin', 'user'), async (req, res) => {
  try {
    const { userId } = req.params;
    const forceRefresh = req.query.refresh === 'true';

    const user = await User.findById(userId)
      .select('profile clientId liveLocation') // ADDED: liveLocation
      .lean();

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check access permissions
    if (!checkUserAccess(req.user, user)) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view astrology data for this user'
      });
    }

    // FIXED: Check liveLocation for coordinates
    if (!user.profile?.dob || !user.profile?.timeOfBirth || 
        user.liveLocation?.latitude === null || user.liveLocation?.latitude === undefined ||
        user.liveLocation?.longitude === null || user.liveLocation?.longitude === undefined) {
      return res.status(400).json({
        success: false,
        message: 'User has incomplete birth details',
        missingFields: {
          dob: !user.profile?.dob,
          timeOfBirth: !user.profile?.timeOfBirth,
          latitude: user.liveLocation?.latitude === null || user.liveLocation?.latitude === undefined,
          longitude: user.liveLocation?.longitude === null || user.liveLocation?.longitude === undefined
        }
      });
    }

    // FIXED: Merge liveLocation coordinates into profile
    const profileWithLocation = {
      ...user.profile,
      latitude: user.liveLocation.latitude,
      longitude: user.liveLocation.longitude
    };

    const astrologyData = await astrologyService.getCompleteAstrologyData(
      userId, 
      profileWithLocation, 
      forceRefresh
    );

    // Fetch doshas (Kal Sarpa, Manglik, Pitra, Sade Sati, Shani, Gandmool)
    let doshas = null;
    try {
      console.log('[Client API] Fetching dosha data for astrology endpoint...');
      // Ensure user object has liveLocation for doshaService
      const userWithLocation = {
        ...user,
        liveLocation: user.liveLocation || {}
      };
      doshas = await doshaService.getAllDoshas(userWithLocation);
      console.log('[Client API] Dosha data retrieved successfully');
    } catch (doshaError) {
      console.warn('[Client API] Could not fetch doshas:', doshaError.message);
      // Don't fail the request if doshas fail, just log warning
    }

    res.json({
      success: true,
      data: {
        ...astrologyData,
        doshas: doshas || undefined
      }
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

// ALSO UPDATE: /api/client/users/:userId/astrology/refresh endpoint
router.post('/users/:userId/astrology/refresh', authenticate, authorize('client', 'admin', 'super_admin', 'user'), async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await User.findById(userId)
      .select('profile clientId liveLocation') // ADDED: liveLocation
      .lean();

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check access permissions
    if (!checkUserAccess(req.user, user)) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to refresh astrology data for this user'
      });
    }

    // FIXED: Merge liveLocation coordinates into profile
    const profileWithLocation = {
      ...user.profile,
      latitude: user.liveLocation?.latitude,
      longitude: user.liveLocation?.longitude
    };

    const astrologyData = await astrologyService.refreshAstrologyData(
      userId, 
      profileWithLocation
    );

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
// ==========================================
// PANCHANG API ENDPOINTS - Add to client.js
// ==========================================

/**
 * GET panchang data by date from database
 * GET /api/client/users/:userId/panchang
 * Query params: 
 *   - date: YYYY-MM-DD format (optional, defaults to today) e.g., "2026-01-31"
 * Access: client (own users), admin, super_admin, user (own data only)
 * 
 * Location Logic:
 * 1. First checks if panchang exists in DB for the date
 * 2. If not found, tries to fetch using user's current liveLocation
 * 3. If user has no liveLocation, returns 404 with helpful message
 * 
 * Returns panchang data if exists, or auto-fetches using liveLocation if available
 * 
 * Examples:
 *   GET /api/client/users/:userId/panchang                     // Today's panchang
 *   GET /api/client/users/:userId/panchang?date=2026-01-31     // Specific date
 *   GET /api/client/users/:userId/panchang?date=2026-02-15     // Future date
 */
router.get('/users/:userId/panchang', authenticate, authorize('client', 'admin', 'super_admin', 'user'), async (req, res) => {
  try {
    const { userId } = req.params;
    let { date } = req.query;

    // Validate user and fetch live location + profile (for numero daily prediction)
    const user = await User.findById(userId)
      .select('clientId liveLocation profile')
      .lean();

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check access permissions
    if (!checkUserAccess(req.user, user)) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view panchang data for this user'
      });
    }

    // If no date provided, use today
    if (!date) {
      const today = new Date();
      const year = today.getFullYear();
      const month = String(today.getMonth() + 1).padStart(2, '0');
      const day = String(today.getDate()).padStart(2, '0');
      date = `${year}-${month}-${day}`;
      console.log('[Client API] No date provided, using today:', date);
    }

    // Validate date format (YYYY-MM-DD)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(date)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid date format. Please use YYYY-MM-DD format (e.g., 2026-01-31)'
      });
    }

    // STEP 1: Check if panchang data exists in DB for this date
    const panchangData = await Panchang.findOne({
      userId,
      dateKey: date
    }).lean();

    if (panchangData) {
      console.log('[Client API] Panchang data found in DB for date:', date);
      
      // Enrich with numero daily prediction (lucky number, prediction for the day)
      let numeroDailyPrediction = null;
      const userName = user.profile?.name || user.profile?.firstName;
      if (userName) {
        try {
          const numeroResult = await numerologyService.getDailyPredictionOnly(userId, date, userName);
          numeroDailyPrediction = numeroResult.data; // lucky_number, prediction, etc.
        } catch (e) {
          console.warn('[Client API] Could not fetch numero daily prediction:', e.message);
        }
      }

      const formattedData = {
        dateKey: panchangData.dateKey,
        requestDate: panchangData.requestDate,
        location: panchangData.location,
        basicPanchang: panchangData.basicPanchang,
        advancedPanchang: panchangData.advancedPanchang,
        chaughadiyaMuhurta: panchangData.chaughadiyaMuhurta,
        dailyNakshatraPrediction: panchangData.dailyNakshatraPrediction,
        numeroDailyPrediction, // lucky_number, prediction for the day from numerology
        lastCalculated: panchangData.lastCalculated,
        calculationSource: panchangData.calculationSource
      };

      return res.json({
        success: true,
        source: 'database',
        data: formattedData
      });
    }

    // STEP 2: Panchang not found in DB - try to fetch using user's liveLocation
    console.log('[Client API] No panchang data found in DB for date:', date);
    
    // Check if user has live location
    const hasLocation = user.liveLocation?.latitude !== null && 
                       user.liveLocation?.latitude !== undefined &&
                       user.liveLocation?.longitude !== null && 
                       user.liveLocation?.longitude !== undefined;

    if (!hasLocation) {
      // No live location - cannot auto-fetch
      return res.status(404).json({
        success: false,
        message: `No panchang data found for date: ${date}`,
        reason: 'User has no live location stored',
        suggestion: 'Update user live location first, then the panchang will be automatically fetched',
        dateRequested: date,
        hasLocation: false
      });
    }

    // STEP 3: User has liveLocation - auto-fetch panchang data
    console.log('[Client API] Auto-fetching panchang using user liveLocation for date:', date);
    
    try {
      // Parse the date string to create proper date object
      const requestDate = new Date(date);
      
      if (isNaN(requestDate.getTime())) {
        return res.status(400).json({
          success: false,
          message: 'Invalid date value provided'
        });
      }

      // Fetch panchang data using user's live location and birth profile for personalized nakshatra
      const fetchedPanchangData = await panchangService.getCompletePanchangData(
        userId,
        requestDate.toISOString(),
        user.liveLocation.latitude,
        user.liveLocation.longitude,
        false, // Don't force refresh
        user.profile || null
      );

      // Enrich with numero daily prediction (lucky number, prediction for the day)
      let numeroDailyPrediction;
      const userName = user.profile?.name || user.profile?.firstName;
      try {
        const numeroResult = await numerologyService.getDailyPredictionOnly(userId, date, userName || '');
        numeroDailyPrediction = numeroResult.data;
      } catch (e) {
        console.warn('[Client API] Could not fetch numero daily prediction:', e.message);
        numeroDailyPrediction = { missingFields: ['name'], message: 'Name is required for personalized daily numerology prediction' };
      }

      const enrichedData = { ...fetchedPanchangData, numeroDailyPrediction };

      console.log('[Client API] Successfully auto-fetched and saved panchang for date:', date);

      return res.json({
        success: true,
        source: 'api',
        message: 'Panchang data fetched and saved automatically using user live location',
        autoFetched: true,
        data: enrichedData
      });

    } catch (fetchError) {
      console.error('[Client API] Auto-fetch panchang error:', fetchError);
      
      return res.status(500).json({
        success: false,
        message: 'Failed to auto-fetch panchang data',
        error: process.env.NODE_ENV === 'development' ? fetchError.message : undefined,
        suggestion: `You can try using POST /api/client/users/${userId}/panchang with date: ${date} to manually fetch`
      });
    }

  } catch (error) {
    console.error('[Client API] Get panchang by date error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch panchang data',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * POST - Fetch and save panchang data for any date (current, past, or future)
 * POST /api/client/users/:userId/panchang
 * Body: { 
 *   date: "2026-01-31" or { day: 31, month: 1, year: 2026 }, 
 *   latitude: 28.5842 (optional),
 *   longitude: 77.3150 (optional)
 * }
 * Access: client (own users), admin, super_admin, user (own data only)
 * 
 * This endpoint:
 * 1. Fetches panchang data from API for the specified date
 * 2. Saves it to database
 * 3. Returns the panchang data
 * 4. Future GET requests for this date will return saved data
 * 
 * If date not provided, defaults to current date
 * If location not provided, uses user's liveLocation from DB
 * 
 * Examples:
 *   POST /api/client/users/:userId/panchang
 *   Body: { date: "2026-02-15" }  // Fetch and save for future date
 *   
 *   POST /api/client/users/:userId/panchang
 *   Body: { date: "2026-01-20" }  // Fetch and save for past date
 *   
 *   POST /api/client/users/:userId/panchang
 *   Body: {}  // Fetch and save for today
 */
router.post('/users/:userId/panchang', authenticate, authorize('client', 'admin', 'super_admin', 'user'), async (req, res) => {
  try {
    const { userId } = req.params;
    let { date, latitude, longitude } = req.body;

    // Validate user and fetch live location + profile (for numero daily prediction)
    const user = await User.findById(userId)
      .select('clientId liveLocation profile')
      .lean();

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check access permissions
    if (!checkUserAccess(req.user, user)) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to fetch panchang data for this user'
      });
    }

    // Process date - convert string format to object if needed
    let currentDate;
    if (!date) {
      // No date provided - use today
      currentDate = new Date();
      console.log('[Client API] No date provided, using today');
    } else if (typeof date === 'string') {
      // String format: "2026-01-31"
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(date)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid date format. Please use YYYY-MM-DD format (e.g., 2026-01-31) or object format { day, month, year }'
        });
      }
      currentDate = new Date(date);
      console.log('[Client API] Using provided date string:', date);
    } else if (typeof date === 'object' && date.day && date.month && date.year) {
      // Object format: { day: 31, month: 1, year: 2026 }
      currentDate = new Date(date.year, date.month - 1, date.day);
      console.log('[Client API] Using provided date object:', date);
    } else {
      return res.status(400).json({
        success: false,
        message: 'Invalid date format. Provide either string "YYYY-MM-DD" or object { day, month, year }'
      });
    }

    // Validate that date is valid
    if (isNaN(currentDate.getTime())) {
      return res.status(400).json({
        success: false,
        message: 'Invalid date value provided'
      });
    }

    // Use live location from DB if not provided in request
    if (latitude === null || latitude === undefined) {
      if (user.liveLocation?.latitude !== null && user.liveLocation?.latitude !== undefined) {
        latitude = user.liveLocation.latitude;
        console.log('[Client API] Using user live location latitude:', latitude);
      } else {
        return res.status(400).json({
          success: false,
          message: 'Latitude not provided and user has no live location stored. Please update live location first.'
        });
      }
    }

    if (longitude === null || longitude === undefined) {
      if (user.liveLocation?.longitude !== null && user.liveLocation?.longitude !== undefined) {
        longitude = user.liveLocation.longitude;
        console.log('[Client API] Using user live location longitude:', longitude);
      } else {
        return res.status(400).json({
          success: false,
          message: 'Longitude not provided and user has no live location stored. Please update live location first.'
        });
      }
    }

    // Get date key for this request
    const dateKey = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}-${String(currentDate.getDate()).padStart(2, '0')}`;
    
    // Check if data already exists for this date
    const existingData = await Panchang.findOne({
      userId,
      dateKey
    });

    if (existingData) {
      console.log('[Client API] Panchang data already exists for date:', dateKey);
      
      // Enrich with numero daily prediction
      let numeroDailyPrediction;
      const userName = user.profile?.name || user.profile?.firstName;
      try {
        const numeroResult = await numerologyService.getDailyPredictionOnly(userId, dateKey, userName || '');
        numeroDailyPrediction = numeroResult.data;
      } catch (e) {
        console.warn('[Client API] Could not fetch numero daily prediction:', e.message);
        numeroDailyPrediction = { missingFields: ['name'], message: 'Name is required for personalized daily numerology prediction' };
      }

      const formattedData = {
        dateKey: existingData.dateKey,
        requestDate: existingData.requestDate,
        location: existingData.location,
        basicPanchang: existingData.basicPanchang,
        advancedPanchang: existingData.advancedPanchang,
        chaughadiyaMuhurta: existingData.chaughadiyaMuhurta,
        dailyNakshatraPrediction: existingData.dailyNakshatraPrediction,
        numeroDailyPrediction,
        lastCalculated: existingData.lastCalculated,
        calculationSource: existingData.calculationSource
      };

      return res.json({
        success: true,
        message: 'Panchang data already exists in database for this date',
        source: 'database',
        dateRequested: dateKey,
        data: formattedData
      });
    }

    // Data doesn't exist - fetch from API and save
    console.log('[Client API] Fetching new panchang data from API for date:', dateKey);
    
    // Fetch panchang data from service (pass user.profile for personalized nakshatra)
    const panchangData = await panchangService.getCompletePanchangData(
      userId,
      currentDate.toISOString(),
      latitude,
      longitude,
      false, // Don't force refresh, let service handle caching
      user.profile || null
    );

    // Enrich with numero daily prediction
    let numeroDailyPrediction;
    const userName = user.profile?.name || user.profile?.firstName;
    try {
      const numeroResult = await numerologyService.getDailyPredictionOnly(userId, dateKey, userName || '');
      numeroDailyPrediction = numeroResult.data;
    } catch (e) {
      console.warn('[Client API] Could not fetch numero daily prediction:', e.message);
      numeroDailyPrediction = { missingFields: ['name'], message: 'Name is required for personalized daily numerology prediction' };
    }

    res.json({
      success: true,
      message: 'Panchang data fetched and saved successfully',
      source: 'api',
      dateRequested: dateKey,
      data: { ...panchangData, numeroDailyPrediction }
    });

  } catch (error) {
    console.error('[Client API] Fetch panchang data error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch panchang data',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});




/**
 * Get list of dates for which panchang data exists
 * GET /api/client/users/:userId/panchang/list
 * Query params: ?limit=30&skip=0
 * Access: client (own users), admin, super_admin, user (own data only)
 */
router.get('/users/:userId/panchang/list', authenticate, authorize('client', 'admin', 'super_admin', 'user'), async (req, res) => {
  try {
    const { userId } = req.params;
    const limit = Math.min(parseInt(req.query.limit) || 30, 90);
    const skip = parseInt(req.query.skip) || 0;

    const user = await User.findById(userId).select('clientId').lean();
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    if (!checkUserAccess(req.user, user)) {
      return res.status(403).json({ success: false, message: 'You do not have permission' });
    }

    const records = await Panchang.find({ userId })
      .select('dateKey requestDate lastCalculated')
      .sort({ dateKey: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const total = await Panchang.countDocuments({ userId });

    res.json({
      success: true,
      data: records.map(r => ({ dateKey: r.dateKey, requestDate: r.requestDate, lastCalculated: r.lastCalculated })),
      count: records.length,
      total,
      hasMore: total > skip + limit
    });
  } catch (error) {
    console.error('[Client API] Get panchang list error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch panchang list', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
  }
});

router.get('/users/:userId/panchang/batch', authenticate, authorize('client', 'admin', 'super_admin', 'user'), async (req, res) => {
  try {
    const { userId } = req.params;
    const { startDate, endDate, limit = 30 } = req.query;

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

    // Check access permissions
    if (!checkUserAccess(req.user, user)) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view panchang data for this user'
      });
    }

    // Validate required params
    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: 'Both startDate and endDate are required (YYYY-MM-DD format)'
      });
    }

    // Validate date format
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(startDate) || !dateRegex.test(endDate)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid date format. Please use YYYY-MM-DD format'
      });
    }

    // Validate limit
    const maxLimit = Math.min(parseInt(limit), 90);

    // Parse dates
    const start = new Date(startDate);
    const end = new Date(endDate);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return res.status(400).json({
        success: false,
        message: 'Invalid date values provided'
      });
    }

    if (start > end) {
      return res.status(400).json({
        success: false,
        message: 'startDate must be before or equal to endDate'
      });
    }

    // Fetch panchang data for date range
    const panchangRecords = await Panchang.find({
      userId,
      dateKey: {
        $gte: startDate,
        $lte: endDate
      }
    })
    .sort({ dateKey: 1 })
    .limit(maxLimit)
    .lean();

    console.log('[Client API] Found', panchangRecords.length, 'panchang records for date range:', startDate, 'to', endDate);

    // Format response
    const formattedRecords = panchangRecords.map(record => ({
      dateKey: record.dateKey,
      requestDate: record.requestDate,
      location: record.location,
      basicPanchang: record.basicPanchang,
      advancedPanchang: record.advancedPanchang,
      chaughadiyaMuhurta: record.chaughadiyaMuhurta,
      dailyNakshatraPrediction: record.dailyNakshatraPrediction,
      lastCalculated: record.lastCalculated,
      calculationSource: record.calculationSource
    }));

    res.json({
      success: true,
      count: formattedRecords.length,
      dateRange: {
        start: startDate,
        end: endDate
      },
      data: formattedRecords
    });

  } catch (error) {
    console.error('[Client API] Get batch panchang data error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch panchang data',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});
/**
 * DELETE panchang data for a specific date
 * DELETE /api/client/users/:userId/panchang
 * Body: { date: "2026-01-31" }
 * Access: client (own users), admin, super_admin (users cannot delete)
 * 
 * Deletes panchang data for the specified date
 */
router.delete('/users/:userId/panchang', authenticate, authorize('client', 'admin', 'super_admin'), async (req, res) => {
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

    // Check permissions for clients
    if (req.user.role === 'client') {
      if (!user.clientId || user.clientId.toString() !== req.user._id.toString()) {
        return res.status(403).json({
          success: false,
          message: 'You can only delete panchang data for your own users'
        });
      }
    }

    if (!date) {
      return res.status(400).json({
        success: false,
        message: 'date is required in request body (YYYY-MM-DD format)'
      });
    }

    // Validate date format
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(date)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid date format. Please use YYYY-MM-DD format'
      });
    }

    const result = await Panchang.findOneAndDelete({
      userId,
      dateKey: date
    });

    if (!result) {
      return res.status(404).json({
        success: false,
        message: `No panchang data found for date: ${date}`
      });
    }

    console.log('[Client API] Deleted panchang data for user:', userId, 'date:', date);

    res.json({
      success: true,
      message: 'Panchang data deleted successfully',
      dateDeleted: date
    });

  } catch (error) {
    console.error('[Client API] Delete panchang data error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete panchang data',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * Refresh panchang data for a user (force recalculation)
 * POST /api/client/users/:userId/panchang/refresh
 * Body: { currentDate: "2026-01-24T10:30:00Z", latitude: 19.076, longitude: 72.8777 } (all optional)
 * Access: client (own users), admin, super_admin, user (own data only)
 * Note: currentDate defaults to now, location defaults to user's liveLocation from DB
 */
router.post('/users/:userId/panchang/refresh', authenticate, authorize('client', 'admin', 'super_admin', 'user'), async (req, res) => {
  try {
    const { userId } = req.params;
    let { currentDate, latitude, longitude } = req.body;

    const user = await User.findById(userId)
      .select('clientId liveLocation profile')
      .lean();

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check access permissions
    if (!checkUserAccess(req.user, user)) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to refresh panchang data for this user'
      });
    }

    // Use current date/time if not provided
    if (!currentDate) {
      currentDate = new Date().toISOString();
      console.log('[Client API] No currentDate provided for refresh, using now:', currentDate);
    }

    // Use live location from DB if not provided in request
    if (latitude === null || latitude === undefined) {
      if (user.liveLocation?.latitude !== null && user.liveLocation?.latitude !== undefined) {
        latitude = user.liveLocation.latitude;
        console.log('[Client API] Using user live location latitude for refresh:', latitude);
      } else {
        return res.status(400).json({
          success: false,
          message: 'Latitude not provided and user has no live location stored'
        });
      }
    }

    if (longitude === null || longitude === undefined) {
      if (user.liveLocation?.longitude !== null && user.liveLocation?.longitude !== undefined) {
        longitude = user.liveLocation.longitude;
        console.log('[Client API] Using user live location longitude for refresh:', longitude);
      } else {
        return res.status(400).json({
          success: false,
          message: 'Longitude not provided and user has no live location stored'
        });
      }
    }

    const panchangData = await panchangService.refreshPanchangData(userId, currentDate, latitude, longitude, user.profile || null);

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
 * Get numerology data for a user
 * POST /api/client/users/:userId/numerology
 * Body: { date: "2026-01-24" or { day: 24, month: 1, year: 2026 } } (optional - defaults to today)
 * Query params: ?refresh=true to force refresh from API
 * Access: client (own users), admin, super_admin, user (own data only)
 * Note: Name is always taken from user profile in database
 */
router.post('/users/:userId/numerology', authenticate, authorize('client', 'admin', 'super_admin', 'user'), async (req, res) => {
  try {
    const { userId } = req.params;
    let { date } = req.body;
    const forceRefresh = req.query.refresh === 'true';

    // Validate user (include liveLocation for doshas)
    const user = await User.findById(userId)
      .select('profile clientId liveLocation')
      .lean();

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check access permissions
    if (!checkUserAccess(req.user, user)) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to access numerology data for this user'
      });
    }

    // Get name from user profile (required)
    const userName = user.profile?.name || user.profile?.firstName;
    if (!userName) {
      return res.status(400).json({
        success: false,
        message: 'User profile must have a name to generate numerology data'
      });
    }

    // User DOB - required for numeroReport & numeroTable (static, fetched once). If missing, only daily prediction is returned.
    const userDob = user.profile?.dob || null;

    // Use provided date or default to today (for daily prediction)
    if (!date) {
      const today = new Date();
      date = {
        day: today.getDate(),
        month: today.getMonth() + 1,
        year: today.getFullYear()
      };
      console.log('[Client API] No date provided, using today:', date);
    }

    const result = await numerologyService.getNumerologyData(
      userId,
      date,
      userName,
      userDob,
      forceRefresh
    );

    // Fetch doshas (Kal Sarpa, Manglik, Pitra, Sade Sati, Shani, Gandmool) using user details
    let doshas = null;
    if (user.profile?.dob) {
      try {
        doshas = await doshaService.getAllDoshas(user);
      } catch (e) {
        console.warn('[Client API] Could not fetch doshas:', e.message);
      }
    }

    res.json({
      success: true,
      source: result.source, // 'database' or 'api'
      data: { ...result.data, doshas }
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

router.get('/users/:userId/numerology', authenticate, authorize('client', 'admin', 'super_admin', 'user'), async (req, res) => {
  try {
    const { userId } = req.params;
    let { date } = req.body;
    const forceRefresh = req.query.refresh === 'true';

    // Validate user (include liveLocation for doshas)
    const user = await User.findById(userId)
      .select('profile clientId liveLocation')
      .lean();

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check access permissions
    if (!checkUserAccess(req.user, user)) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to access numerology data for this user'
      });
    }

    // Get name from user profile (required)
    const userName = user.profile?.name || user.profile?.firstName;
    if (!userName) {
      return res.status(400).json({
        success: false,
        message: 'User profile must have a name to generate numerology data'
      });
    }

    // User DOB - required for numeroReport & numeroTable (static, fetched once). If missing, only daily prediction is returned.
    const userDob = user.profile?.dob || null;

    // Use provided date or default to today (for daily prediction)
    if (!date) {
      const today = new Date();
      date = {
        day: today.getDate(),
        month: today.getMonth() + 1,
        year: today.getFullYear()
      };
      console.log('[Client API] No date provided, using today:', date);
    }

    const result = await numerologyService.getNumerologyData(
      userId,
      date,
      userName,
      userDob,
      forceRefresh
    );

    // Fetch doshas (Kal Sarpa, Manglik, Pitra, Sade Sati, Shani, Gandmool) using user details
    let doshas = null;
    if (user.profile?.dob) {
      try {
        doshas = await doshaService.getAllDoshas(user);
      } catch (e) {
        console.warn('[Client API] Could not fetch doshas:', e.message);
      }
    }

    res.json({
      success: true,
      source: result.source, // 'database' or 'api'
      data: { ...result.data, doshas }
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
 * Body: { date: "2026-01-24" } (optional - defaults to today)
 * Access: client (own users), admin, super_admin, user (own data only)
 * Note: Name is always taken from user profile in database
 */
router.post('/users/:userId/numerology/refresh', authenticate, authorize('client', 'admin', 'super_admin', 'user'), async (req, res) => {
  try {
    const { userId } = req.params;
    let { date } = req.body;

    const user = await User.findById(userId)
      .select('profile clientId liveLocation')
      .lean();

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check access permissions
    if (!checkUserAccess(req.user, user)) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to refresh numerology data for this user'
      });
    }

    // Get name from user profile (required)
    const userName = user.profile?.name || user.profile?.firstName;
    if (!userName) {
      return res.status(400).json({
        success: false,
        message: 'User profile must have a name to refresh numerology data'
      });
    }

    const userDob = user.profile?.dob || null;

    // Use provided date or default to today
    if (!date) {
      const today = new Date();
      date = {
        day: today.getDate(),
        month: today.getMonth() + 1,
        year: today.getFullYear()
      };
      console.log('[Client API] No date provided for refresh, using today:', date);
    }

    const result = await numerologyService.refreshNumerologyData(userId, date, userName, userDob);

    // Fetch doshas using user details
    let doshas = null;
    if (user.profile?.dob) {
      try {
        doshas = await doshaService.getAllDoshas(user);
      } catch (e) {
        console.warn('[Client API] Could not fetch doshas:', e.message);
      }
    }

    res.json({
      success: true,
      message: 'Numerology data refreshed successfully',
      source: result.source,
      data: { ...result.data, doshas }
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
 * Access: client (own users), admin, super_admin, user (own data only)
 */
router.get('/users/:userId/numerology/history', authenticate, authorize('client', 'admin', 'super_admin', 'user'), async (req, res) => {
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

    // Check access permissions
    if (!checkUserAccess(req.user, user)) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to access numerology history for this user'
      });
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
 * Access: client (own users), admin, super_admin (users cannot delete their own data)
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

/**
 * Get all doshas for a user (Kal Sarpa, Manglik, Pitra, Sade Sati, Shani, Gandmool)
 * GET /api/client/users/:userId/doshas
 * Access: client (own users), admin, super_admin, user (own data only)
 * Uses user profile (dob, timeOfBirth) and liveLocation (latitude, longitude) from DB
 */
router.get('/users/:userId/doshas', authenticate, authorize('client', 'admin', 'super_admin', 'user'), async (req, res) => {
  try {
    const { userId } = req.params;
    const forceRefresh = req.query.refresh === 'true';

    const user = await User.findById(userId)
      .select('profile clientId liveLocation')
      .lean();

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    if (!checkUserAccess(req.user, user)) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to access dosha data for this user'
      });
    }

    const result = await doshaService.getAllDoshas(user, { forceRefresh });

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('[Client API] Get doshas error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch dosha data',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * Get remedies (puja, gemstone, rudraksha) for a user
 * GET /api/client/users/:userId/remedies
 * Query params: ?refresh=true to force refresh from API
 * Access: client (own users), admin, super_admin, user (own data only)
 */
router.get('/users/:userId/remedies', authenticate, authorize('client', 'admin', 'super_admin', 'user'), async (req, res) => {
  try {
    const { userId } = req.params;
    const forceRefresh = req.query.refresh === 'true';

    const user = await User.findById(userId)
      .select('profile clientId liveLocation')
      .lean();

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    if (!checkUserAccess(req.user, user)) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to access remedies for this user'
      });
    }

    // Require basic birth details to call remedies APIs
    if (!user.profile?.dob || !user.profile?.timeOfBirth) {
      return res.status(400).json({
        success: false,
        message: 'User has incomplete birth details for remedies',
        missingFields: {
          dob: !user.profile?.dob,
          timeOfBirth: !user.profile?.timeOfBirth
        }
      });
    }

    const result = await remedyService.getRemedies(user, { forceRefresh });

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('[Client API] Get remedies error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch remedies',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * Get client dashboard overview
 * GET /api/client/dashboard/overview
 * Access: client, admin, super_admin, user (limited view)
 */
router.get('/dashboard/overview', authenticate, authorize('client', 'admin', 'super_admin', 'user'), async (req, res) => {
  try {
    let query = {};
    
    if (req.user.role === 'client') {
      query.clientId = req.user._id;
    } else if (req.user.role === 'user') {
      // Users only see their own stats
      query._id = req.user._id;
    }

    const totalUsers = await User.countDocuments(query);
    const activeUsers = await User.countDocuments({ ...query, isActive: true });
    const inactiveUsers = await User.countDocuments({ ...query, isActive: false });

    const response = {
      success: true,
      data: {
        totalUsers,
        activeUsers,
        inactiveUsers
      }
    };

    // Add additional info based on role
    if (req.user.role === 'client') {
      response.data.clientInfo = {
        businessName: req.user.businessName,
        email: req.user.email,
        clientId: req.user.clientId || 'Not assigned'
      };
    } else if (req.user.role === 'user') {
      response.data.userInfo = {
        email: req.user.email,
        name: req.user.profile?.name || req.user.profile?.firstName,
        registrationStep: req.user.registrationStep
      };
    }

    res.json(response);
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