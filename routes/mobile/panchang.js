import express from 'express';
import { authenticate } from '../../middleware/auth.js';
import panchangService from '../../services/panchangService.js';
import User from '../../models/User.js';

const router = express.Router();

/**
 * GET /api/mobile/panchang
 * Get today's panchang data for the authenticated user
 * Headers: Authorization: Bearer <token>
 * Query: ?lat=19.07&lon=72.87&forceRefresh=false
 */
router.get('/', authenticate, async (req, res) => {
  try {
    if (req.decodedRole !== 'user' || !req.user) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const userId = req.user._id;

    // Get lat/lon from query params or user's live location or profile
    let latitude  = req.query.lat  ? parseFloat(req.query.lat)  : null;
    let longitude = req.query.lon  ? parseFloat(req.query.lon)  : null;
    const forceRefresh = req.query.forceRefresh === 'true';

    // Fallback to user's saved location if not provided
    if (latitude == null || longitude == null) {
      const user = await User.findById(userId)
        .select('liveLocation profile')
        .lean();

      latitude  = user?.liveLocation?.latitude  ?? user?.profile?.latitude  ?? null;
      longitude = user?.liveLocation?.longitude ?? user?.profile?.longitude ?? null;
    }

    if (latitude == null || longitude == null) {
      return res.status(400).json({
        success: false,
        message: 'Location is required. Please provide lat & lon query params or update your profile location.'
      });
    }

    // Get user profile for personalized nakshatra prediction
    const user = await User.findById(userId).select('profile').lean();
    const userProfile = user?.profile || null;

    const currentDate = new Date();

    const panchangData = await panchangService.getCompletePanchangData(
      userId,
      currentDate,
      latitude,
      longitude,
      forceRefresh,
      userProfile
    );

    res.json({
      success: true,
      data: panchangData
    });

  } catch (error) {
    console.error('[Panchang Route] Error:', error.message);
    res.status(500).json({
      success: false,
      message: `Failed to fetch panchang data: ${error.message}`
    });
  }
});

export default router;
