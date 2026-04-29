import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { getPresignedUrl } from '../utils/storage.js';

const router = express.Router();

/**
 * GET /api/media/presigned-url?key=<s3-key>
 * Generate a presigned URL for accessing S3 objects
 * 
 * Query params:
 * - key: S3 object key (required)
 * - expiresIn: Expiration time in seconds (optional, default: 86400 = 1 day)
 * 
 * Response:
 * {
 *   success: true,
 *   data: {
 *     presignedUrl: "https://...",
 *     key: "uploads/...",
 *     expiresIn: 86400
 *   }
 * }
 */
router.get('/presigned-url', authenticate, async (req, res) => {
  try {
    const { key, expiresIn } = req.query;
    
    if (!key) {
      return res.status(400).json({
        success: false,
        message: 'S3 key is required. Provide ?key=<s3-object-key>'
      });
    }
    
    // Parse expiresIn (default: 1 day = 86400 seconds, max: 7 days = 604800 seconds)
    let expirationSeconds = 86400; // 1 day default
    if (expiresIn) {
      const parsed = parseInt(expiresIn);
      if (!isNaN(parsed) && parsed > 0) {
        // Cap at 7 days for security
        expirationSeconds = Math.min(parsed, 604800);
      }
    }
    
    // Generate presigned URL
    const presignedUrl = await getPresignedUrl(key, expirationSeconds);
    
    res.json({
      success: true,
      data: {
        presignedUrl,
        key: key,
        expiresIn: expirationSeconds
      }
    });
  } catch (error) {
    console.error('Error generating presigned URL:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate presigned URL',
      error: error.message
    });
  }
});

export default router;
