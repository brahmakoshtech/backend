import express from 'express';
import RewardRedemption from '../models/RewardRedemption.js';
import SpiritualReward from '../models/SpiritualReward.js';
import User from '../models/User.js';
import { authenticateToken } from '../middleware/authMiddleware.js';
import { getobject } from '../utils/s3.js';

const router = express.Router();

// Helper function to get clientId
const getClientId = (req) => {
  if (req.user.role === 'client' && req.user.clientId) {
    return req.user.clientId;
  }
  if (req.user.role === 'user') {
    if (req.user.clientId && req.user.clientId.clientId) {
      return req.user.clientId.clientId;
    }
    if (req.user.tokenClientId) {
      return req.user.tokenClientId;
    }
  }
  throw new Error('Unable to determine clientId');
};

// Redeem reward
router.post('/redeem', authenticateToken, async (req, res) => {
  try {
    const { rewardId } = req.body;
    const userId = req.user._id;
    const clientId = getClientId(req);

    if (!rewardId) {
      return res.status(400).json({
        success: false,
        message: 'Reward ID is required'
      });
    }

    // Get reward
    const reward = await SpiritualReward.findOne({ _id: rewardId, clientId, isActive: true });
    if (!reward) {
      return res.status(404).json({
        success: false,
        message: 'Reward not found or inactive'
      });
    }

    // Get user
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check karma points
    if (user.karmaPoints < reward.karmaPointsRequired) {
      return res.status(400).json({
        success: false,
        message: `Insufficient karma points. Required: ${reward.karmaPointsRequired}, Available: ${user.karmaPoints}`
      });
    }

    // Deduct karma points
    user.karmaPoints -= reward.karmaPointsRequired;
    await user.save();

    // Create redemption record
    const redemption = new RewardRedemption({
      userId,
      rewardId,
      karmaPointsSpent: reward.karmaPointsRequired,
      clientId,
      status: 'completed'
    });
    await redemption.save();

    res.status(200).json({
      success: true,
      message: 'Reward redeemed successfully',
      data: {
        redemption,
        remainingKarmaPoints: user.karmaPoints,
        reward: {
          title: reward.title,
          greetings: reward.greetings
        }
      }
    });
  } catch (error) {
    console.error('Redeem reward error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to redeem reward',
      error: error.message
    });
  }
});

// Get redemption history
router.get('/history', authenticateToken, async (req, res) => {
  try {
    const userId = req.user._id;
    const clientId = getClientId(req);

    const redemptions = await RewardRedemption.find({ userId, clientId })
      .populate('rewardId', 'title description category subcategory photoKey bannerKey')
      .sort({ redeemedAt: -1 });

    // Add presigned URLs
    const redemptionsWithUrls = await Promise.all(
      redemptions.map(async (redemption) => {
        const redemptionObj = redemption.toObject();
        
        if (redemptionObj.rewardId?.photoKey) {
          try {
            redemptionObj.rewardId.image = await getobject(redemptionObj.rewardId.photoKey);
          } catch (error) {
            console.error('Failed to generate photo presigned URL:', error);
          }
        }
        
        if (redemptionObj.rewardId?.bannerKey) {
          try {
            redemptionObj.rewardId.banner = await getobject(redemptionObj.rewardId.bannerKey);
          } catch (error) {
            console.error('Failed to generate banner presigned URL:', error);
          }
        }
        
        // Keep keys for reference
        
        return redemptionObj;
      })
    );

    res.status(200).json({
      success: true,
      message: 'Redemption history fetched successfully',
      data: redemptionsWithUrls
    });
  } catch (error) {
    console.error('Get history error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch redemption history',
      error: error.message
    });
  }
});

export default router;
