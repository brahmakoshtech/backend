import express from 'express';
import multer from 'multer';
import { authenticate, authorize } from '../middleware/auth.js';
import { uploadToS3 } from '../utils/s3.js';
import Alert from '../models/Alert.js';

const router = express.Router();

// Memory storage for small media files from mobile
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 20 * 1024 * 1024, // 20MB per file
  },
});

/**
 * GET /api/alerts/case-types
 * Simple static list for mobile cases/form (e.g. snatching)
 */
router.get('/case-types', (req, res) => {
  res.json({
    success: true,
    data: [
      { caseType: 'snatching', title: 'Snatching' },
    ],
  });
});

/**
 * POST /api/alerts/user
 * Create a new alert / case from a user with optional media files.
 * Expects multipart/form-data:
 *  - fields: caseType, title, description (optional)
 *  - files: media[] (images / videos / audio)
 */
router.post(
  '/user',
  authenticate,
  authorize('user'),
  upload.array('media', 10),
  async (req, res) => {
    try {
      const { caseType, title, description } = req.body || {};

      if (!caseType || !title) {
        return res.status(400).json({
          success: false,
          message: 'caseType and title are required',
        });
      }

      const mediaFiles = [];
      if (Array.isArray(req.files)) {
        for (const file of req.files) {
          try {
            const uploadResult = await uploadToS3(file, 'alerts/media');
            mediaFiles.push({
              key: uploadResult.key,
              url: uploadResult.url || uploadResult.Location,
              contentType: file.mimetype,
              size: file.size,
            });
          } catch (e) {
            console.error('[Alerts] Failed to upload media:', e.message);
          }
        }
      }

      const alert = await Alert.create({
        userId: req.user._id,
        caseType: String(caseType).trim(),
        title: String(title).trim(),
        description: (description || '').toString().trim(),
        media: mediaFiles,
      });

      res.status(201).json({
        success: true,
        message: 'Alert created successfully',
        data: alert,
      });
    } catch (error) {
      console.error('[Alerts] Error creating alert:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to create alert',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  }
);

export default router;

