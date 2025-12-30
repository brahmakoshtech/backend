import express from 'express';
import { putobject, getobject, deleteObject } from '../utils/s3.js';
import { authenticate } from '../middleware/auth.js';
import { v4 as uuidv4 } from 'uuid';

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// Generate presigned URL for image upload
router.post('/presigned-url', async (req, res) => {
  try {
    const { fileName, contentType } = req.body;

    if (!fileName || !contentType) {
      return res.status(400).json({
        success: false,
        message: 'fileName and contentType are required'
      });
    }

    // Generate unique key for the file
    const fileExtension = fileName.split('.').pop();
    const key = `images/${req.user.role}/${req.user._id}/${uuidv4()}.${fileExtension}`;

    // Generate presigned URL
    const presignedUrl = await putobject(key, contentType);

    res.json({
      success: true,
      data: {
        presignedUrl,
        key
      }
    });
  } catch (error) {
    console.error('Error generating presigned URL:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to generate presigned URL'
    });
  }
});

// Get presigned URL for viewing an image
router.get('/presigned-url/:key(*)', async (req, res) => {
  try {
    const { key } = req.params;
    
    const presignedUrl = await getobject(key);

    res.json({
      success: true,
      data: {
        presignedUrl
      }
    });
  } catch (error) {
    console.error('Error generating get presigned URL:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to generate presigned URL'
    });
  }
});

// Delete an image
router.delete('/:key(*)', async (req, res) => {
  try {
    const { key } = req.params;
    
    await deleteObject(key);

    res.json({
      success: true,
      message: 'Image deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting image:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to delete image'
    });
  }
});

export default router;

