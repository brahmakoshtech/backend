import express from 'express';
import LiveAvatar from '../models/LiveAvatar.js';
import { extractS3KeyFromUrl } from '../utils/s3.js';

const router = express.Router();

// GET /api/public/live-avatars - Get all active live avatars (public endpoint)
router.get('/live-avatars', async (req, res) => {
  try {
    // Find all active avatars that are enabled
    const avatars = await LiveAvatar.find({
      status: 'active',
      isActive: true
    })
    .populate('clientId', 'clientId businessName')
    .sort({ createdAt: -1 });

    // Generate presigned URLs for images and videos
    const { getobject } = await import('../utils/s3.js');
    const avatarsWithUrls = await Promise.all(
      avatars.map(async (avatar) => {
        const avatarObj = avatar.toObject();
        
        // Generate presigned URL for video if exists
        if (avatarObj.videoKey || avatarObj.videoUrl) {
          try {
            const videoKey = avatarObj.videoKey || extractS3KeyFromUrl(avatarObj.videoUrl);
            if (videoKey) {
              avatarObj.videoUrl = await getobject(videoKey);
            }
          } catch (error) {
            console.error('Error generating video presigned URL:', error);
          }
        }
        
        // Generate presigned URL for image if exists
        if (avatarObj.imageKey || avatarObj.imageUrl) {
          try {
            const imageKey = avatarObj.imageKey || extractS3KeyFromUrl(avatarObj.imageUrl);
            if (imageKey) {
              avatarObj.imageUrl = await getobject(imageKey);
            }
          } catch (error) {
            console.error('Error generating image presigned URL:', error);
          }
        }
        
        // Add client info
        if (avatarObj.clientId && typeof avatarObj.clientId === 'object') {
          avatarObj.clientName = avatarObj.clientId.businessName || 'Unknown Client';
          avatarObj.clientId = avatarObj.clientId.clientId || avatarObj.clientId._id;
        }
        
        return avatarObj;
      })
    );

    res.json({
      success: true,
      data: avatarsWithUrls,
      count: avatarsWithUrls.length
    });
  } catch (error) {
    console.error('Error fetching public live avatars:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch live avatars',
      error: error.message
    });
  }
});

export default router;