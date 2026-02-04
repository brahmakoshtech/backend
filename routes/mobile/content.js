import express from 'express';
import Testimonial from '../../models/Testimonial.js';
import FounderMessage from '../../models/FounderMessage.js';
import BrandAsset from '../../models/BrandAsset.js';
import Meditation from '../../models/Meditation.js';
import SpiritualActivity from '../../models/SpiritualActivity.js';
import SpiritualSession from '../../models/SpiritualSession.js';
import { authenticateToken } from '../../middleware/auth.js';
import mongoose from 'mongoose';
import { getobject, extractS3KeyFromUrl } from '../../utils/s3.js';

const router = express.Router();

/**
 * MOBILE ENDPOINTS FOR APP DEVELOPERS
 * These endpoints allow app developers to access content by clientId
 * No authentication required - clientId is passed as query parameter
 */

// ============================================
// SPIRITUAL CHECK-IN - Mobile Endpoint
// ============================================

/**
 * GET /api/mobile/spiritual-checkin
 * Get complete spiritual check-in page data (activities + user stats)
 * Requires authentication for user stats
 */
router.get('/spiritual-checkin', authenticateToken, async (req, res) => {
  try {
    const userId = req.user._id || req.user.userId;
    const clientId = req.user.clientId || req.user.tokenClientId;
    
    // Get spiritual activities for this client
    let activities = [];
    if (clientId) {
      activities = await SpiritualActivity.find({
        clientId: clientId,
        isActive: true,
        isDeleted: false
      }).sort({ createdAt: -1 });
    }
    
    // If no client-specific activities, get global activities
    if (activities.length === 0) {
      activities = await SpiritualActivity.find({
        isActive: true,
        isDeleted: false
      }).sort({ createdAt: -1 });
    }
    
    // Process activities with S3 URLs
    const activitiesWithUrls = await Promise.all(
      activities.map(async (activity) => {
        const activityObj = activity.toObject();
        if (activityObj.imageKey || activityObj.image) {
          try {
            const imageKey = activityObj.imageKey || extractS3KeyFromUrl(activityObj.image);
            if (imageKey) {
              activityObj.image = await getobject(imageKey, 604800);
            }
          } catch (error) {
            console.error('Error generating image presigned URL:', error);
          }
        }
        
        // Map to mobile format with route
        return {
          id: activityObj._id,
          title: activityObj.title,
          desc: activityObj.description,
          icon: activityObj.icon || '🌟',
          image: activityObj.image,
          route: getActivityRoute(activityObj.title.toLowerCase()),
          isActive: activityObj.isActive
        };
      })
    );
    
    // Get user spiritual stats
    const sessions = await SpiritualSession.find({ userId }).sort({ createdAt: -1 });
    
    // Calculate comprehensive stats
    const totalSessions = sessions.length;
    const totalKarmaPoints = sessions.reduce((sum, session) => sum + (session.karmaPoints || 0), 0);
    const completedSessions = sessions.filter(s => {
      const sessionStatus = s.status || (s.completionPercentage >= 100 ? 'completed' : 
                            s.completionPercentage >= 50 ? 'incomplete' : 'interrupted');
      return sessionStatus === 'completed';
    }).length;
    const totalMinutes = sessions.reduce((sum, session) => {
      return sum + (session.type !== 'chanting' ? (session.actualDuration || 0) : 0);
    }, 0);
    const averageCompletion = sessions.length > 0 ? 
      sessions.reduce((sum, session) => sum + (session.completionPercentage || 100), 0) / sessions.length : 0;
    
    // Calculate streak (consecutive days with sessions)
    let currentStreak = 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const uniqueDates = [...new Set(sessions.map(session => {
      const date = new Date(session.createdAt);
      date.setHours(0, 0, 0, 0);
      return date.getTime();
    }))].sort((a, b) => b - a);
    
    for (let i = 0; i < uniqueDates.length; i++) {
      const sessionDate = new Date(uniqueDates[i]);
      const daysDiff = Math.floor((today - sessionDate) / (1000 * 60 * 60 * 24));
      
      if (daysDiff === i) {
        currentStreak++;
      } else {
        break;
      }
    }
    
    // Calculate category-wise stats
    const categoryStats = {};
    sessions.forEach(session => {
      const category = session.type || 'meditation';
      if (!categoryStats[category]) {
        categoryStats[category] = {
          sessions: 0,
          completed: 0,
          minutes: 0,
          karmaPoints: 0
        };
      }
      categoryStats[category].sessions++;
      
      const sessionStatus = session.status || 
        (session.completionPercentage >= 100 ? 'completed' : 
         session.completionPercentage >= 50 ? 'incomplete' : 'interrupted');
      
      if (sessionStatus === 'completed') {
        categoryStats[category].completed++;
      }
      
      if (session.type !== 'chanting') {
        categoryStats[category].minutes += session.actualDuration || 0;
      }
      categoryStats[category].karmaPoints += session.karmaPoints || 0;
    });
    
    // Get recent activities (last 10)
    const recentActivities = sessions.slice(0, 10).map(session => {
      const completionPercentage = session.completionPercentage !== undefined ? session.completionPercentage :
                                  (session.targetDuration > 0 ? Math.round((session.actualDuration / session.targetDuration) * 100) : 100);
      
      let status = session.status || 'completed';
      if (!session.status && session.type !== 'chanting') {
        if (completionPercentage < 100) {
          status = completionPercentage >= 50 ? 'incomplete' : 'interrupted';
        }
      }
      
      let activityData = {
        id: session._id,
        title: session.title || `${session.type} Session`,
        type: session.type || 'meditation',
        status: status,
        completionPercentage: completionPercentage,
        karmaPoints: session.karmaPoints || 0,
        emotion: session.emotion,
        createdAt: session.createdAt
      };
      
      if (session.type !== 'chanting') {
        activityData.targetDuration = session.targetDuration || 0;
        activityData.actualDuration = session.actualDuration || 0;
      } else {
        activityData.chantCount = session.chantCount || 0;
        activityData.chantingName = session.chantingName;
      }
      
      return activityData;
    });
    
    // Default activities if none exist
    const defaultActivities = [
      { id: 'meditate', title: 'Meditate', icon: '🧘♀️', desc: 'Find inner peace', route: '/mobile/user/meditate' },
      { id: 'pray', title: 'Pray', icon: '🙏', desc: 'Connect spiritually', route: '/mobile/user/pray' },
      { id: 'chant', title: 'Chant', icon: '🕉️', desc: 'Sacred sounds', route: '/mobile/user/chant' },
      { id: 'silence', title: 'Silence', icon: '🤫', desc: 'Peaceful stillness', route: '/mobile/user/silence' }
    ];
    
    const finalActivities = activitiesWithUrls.length > 0 ? activitiesWithUrls : defaultActivities;
    
    res.json({
      success: true,
      data: {
        activities: finalActivities,
        stats: {
          days: currentStreak,
          points: totalKarmaPoints,
          sessions: totalSessions,
          completed: completedSessions,
          minutes: totalMinutes,
          averageCompletion: Math.round(averageCompletion)
        },
        categoryStats,
        recentActivities,
        motivation: {
          emoji: '🌸 ✨ 🕊️',
          title: 'Small steps, big transformation',
          text: 'Your spiritual check-in earns karma points that feed cows, educate children, and help those in need.'
        }
      }
    });
  } catch (error) {
    console.error('Error fetching spiritual check-in data:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch spiritual check-in data',
      error: error.message
    });
  }
});

// Helper function to map activity titles to routes
function getActivityRoute(title) {
  const routeMap = {
    'meditate': '/mobile/user/meditate',
    'meditation': '/mobile/user/meditate',
    'pray': '/mobile/user/pray',
    'prayer': '/mobile/user/pray',
    'chant': '/mobile/user/chant',
    'chanting': '/mobile/user/chant',
    'silence': '/mobile/user/silence',
    'silent': '/mobile/user/silence'
  };
  
  return routeMap[title] || '/mobile/user/meditate';
}

// ============================================
// TESTIMONIALS - Mobile Endpoints
// ============================================

/**
 * GET /api/mobile/testimonials?clientId=<clientId>
 * Get all testimonials for a specific client (for mobile app)
 */
router.get('/testimonials', async (req, res) => {
  try {
    const { clientId } = req.query;

    if (!clientId) {
      return res.status(400).json({
        success: false,
        message: 'clientId query parameter is required'
      });
    }

    // Validate clientId format
    if (!mongoose.Types.ObjectId.isValid(clientId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid clientId format'
      });
    }

    const testimonials = await Testimonial.find({
      clientId: clientId,
      isActive: true
    }).sort({ createdAt: -1 });

    res.json({
      success: true,
      data: testimonials,
      count: testimonials.length,
      clientId: clientId
    });
  } catch (error) {
    console.error('Error fetching testimonials:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch testimonials',
      error: error.message
    });
  }
});

/**
 * GET /api/mobile/testimonials/:id?clientId=<clientId>
 * Get single testimonial by ID for a specific client
 */
router.get('/testimonials/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { clientId } = req.query;

    if (!clientId) {
      return res.status(400).json({
        success: false,
        message: 'clientId query parameter is required'
      });
    }

    if (!mongoose.Types.ObjectId.isValid(clientId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid clientId format'
      });
    }

    const testimonial = await Testimonial.findOne({
      _id: id,
      clientId: clientId,
      isActive: true
    });

    if (!testimonial) {
      return res.status(404).json({
        success: false,
        message: 'Testimonial not found'
      });
    }

    res.json({
      success: true,
      data: testimonial
    });
  } catch (error) {
    console.error('Error fetching testimonial:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch testimonial',
      error: error.message
    });
  }
});

// ============================================
// FOUNDER MESSAGES - Mobile Endpoints
// ============================================

/**
 * GET /api/mobile/founder-messages?clientId=<clientId>
 * Get all founder messages for a specific client (for mobile app)
 */
router.get('/founder-messages', async (req, res) => {
  try {
    const { clientId } = req.query;

    if (!clientId) {
      return res.status(400).json({
        success: false,
        message: 'clientId query parameter is required'
      });
    }

    if (!mongoose.Types.ObjectId.isValid(clientId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid clientId format'
      });
    }

    const messages = await FounderMessage.find({
      clientId: clientId,
      status: 'published' // Only return published messages
    }).sort({ createdAt: -1 });

    res.json({
      success: true,
      data: messages,
      count: messages.length,
      clientId: clientId
    });
  } catch (error) {
    console.error('Error fetching founder messages:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch founder messages',
      error: error.message
    });
  }
});

/**
 * GET /api/mobile/founder-messages/:id?clientId=<clientId>
 * Get single founder message by ID for a specific client
 */
router.get('/founder-messages/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { clientId } = req.query;

    if (!clientId) {
      return res.status(400).json({
        success: false,
        message: 'clientId query parameter is required'
      });
    }

    if (!mongoose.Types.ObjectId.isValid(clientId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid clientId format'
      });
    }

    const message = await FounderMessage.findOne({
      _id: id,
      clientId: clientId,
      status: 'published'
    });

    if (!message) {
      return res.status(404).json({
        success: false,
        message: 'Founder message not found'
      });
    }

    res.json({
      success: true,
      data: message
    });
  } catch (error) {
    console.error('Error fetching founder message:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch founder message',
      error: error.message
    });
  }
});

// ============================================
// BRAND ASSETS - Mobile Endpoints
// ============================================

/**
 * GET /api/mobile/brand-assets?clientId=<clientId>
 * Get all brand assets for a specific client (for mobile app)
 */
router.get('/brand-assets', async (req, res) => {
  try {
    const { clientId } = req.query;

    if (!clientId) {
      return res.status(400).json({
        success: false,
        message: 'clientId query parameter is required'
      });
    }

    if (!mongoose.Types.ObjectId.isValid(clientId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid clientId format'
      });
    }

    const brandAssets = await BrandAsset.find({
      clientId: clientId,
      isActive: true
    }).sort({ createdAt: -1 });

    res.json({
      success: true,
      data: brandAssets,
      count: brandAssets.length,
      clientId: clientId
    });
  } catch (error) {
    console.error('Error fetching brand assets:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch brand assets',
      error: error.message
    });
  }
});

/**
 * GET /api/mobile/brand-assets/:id?clientId=<clientId>
 * Get single brand asset by ID for a specific client
 */
router.get('/brand-assets/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { clientId } = req.query;

    if (!clientId) {
      return res.status(400).json({
        success: false,
        message: 'clientId query parameter is required'
      });
    }

    if (!mongoose.Types.ObjectId.isValid(clientId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid clientId format'
      });
    }

    const brandAsset = await BrandAsset.findOne({
      _id: id,
      clientId: clientId,
      isActive: true
    });

    if (!brandAsset) {
      return res.status(404).json({
        success: false,
        message: 'Brand asset not found'
      });
    }

    res.json({
      success: true,
      data: brandAsset
    });
  } catch (error) {
    console.error('Error fetching brand asset:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch brand asset',
      error: error.message
    });
  }
});

// ============================================
// MEDITATIONS - Mobile Endpoints
// ============================================

/**
 * GET /api/mobile/meditations?clientId=<clientId>
 * Get all meditations for a specific client (for mobile app)
 */
router.get('/meditations', async (req, res) => {
  try {
    const { clientId } = req.query;

    if (!clientId) {
      return res.status(400).json({
        success: false,
        message: 'clientId query parameter is required'
      });
    }

    if (!mongoose.Types.ObjectId.isValid(clientId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid clientId format'
      });
    }

    const meditations = await Meditation.find({
      clientId: clientId,
      isActive: true
    }).sort({ createdAt: -1 });

    res.json({
      success: true,
      data: meditations,
      count: meditations.length,
      clientId: clientId
    });
  } catch (error) {
    console.error('Error fetching meditations:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch meditations',
      error: error.message
    });
  }
});

/**
 * GET /api/mobile/meditations/:id?clientId=<clientId>
 * Get single meditation by ID for a specific client
 */
router.get('/meditations/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { clientId } = req.query;

    if (!clientId) {
      return res.status(400).json({
        success: false,
        message: 'clientId query parameter is required'
      });
    }

    if (!mongoose.Types.ObjectId.isValid(clientId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid clientId format'
      });
    }

    const meditation = await Meditation.findOne({
      _id: id,
      clientId: clientId,
      isActive: true
    });

    if (!meditation) {
      return res.status(404).json({
        success: false,
        message: 'Meditation not found'
      });
    }

    res.json({
      success: true,
      data: meditation
    });
  } catch (error) {
    console.error('Error fetching meditation:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch meditation',
      error: error.message
    });
  }
});

export default router;
