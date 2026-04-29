import express from 'express';
import Testimonial from '../../models/Testimonial.js';
import { authenticate } from '../../middleware/auth.js';
import multer from 'multer';
import { uploadFile, deleteFile } from '../../utils/storage.js';

const router = express.Router();

// Helper function to extract clientId from request (supports both client and user tokens)
const getClientId = (req) => {
  // If user role, get clientId from decoded token first (most reliable), then populated user object
  if (req.user.role === 'user') {
    // Priority: decodedClientId (from token) > populated clientId._id > clientId ObjectId
    const clientId = req.decodedClientId || req.user.clientId?._id || req.user.clientId || req.user.tokenClientId;
    if (!clientId) {
      throw new Error('Client ID not found for user token. Please ensure your token includes clientId.');
    }
    return clientId;
  }
  // For client role, use user._id (which is the client's MongoDB _id)
  return req.user._id || req.user.id;
};

// Configure multer for image upload
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  }
});

// POST /api/testimonials/:id/upload-image - Upload image for testimonial (frontend uses this)
router.post('/:id/upload-image', authenticate, upload.single('image'), async (req, res) => {
  console.log('[Upload Route] Image upload request received:', {
    testimonialId: req.params.id,
    hasFile: !!req.file,
    fileName: req.file?.originalname,
    fileSize: req.file?.size,
    userRole: req.user?.role,
    userId: req.user?._id
  });
  
  try {
    let clientId;
    try {
      clientId = getClientId(req);
      console.log('[Upload Route] ClientId extracted:', clientId);
    } catch (clientIdError) {
      console.error('[Upload Route] ClientId extraction failed:', clientIdError.message);
      return res.status(401).json({
        success: false,
        message: clientIdError.message || 'Unable to determine client ID. Please ensure your token is valid.'
      });
    }
    
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No image file provided'
      });
    }

    const testimonial = await Testimonial.findOne({
      _id: req.params.id,
      clientId: clientId,
      isActive: true
    });

    if (!testimonial) {
      return res.status(404).json({
        success: false,
        message: 'Testimonial not found'
      });
    }

    // Upload image using storage wrapper (R2/S3/both based on settings)
    const uploadResult = await uploadFile(req.file, 'testimonials');
    const imageKey = uploadResult.key;
    const imageUrl = uploadResult.url || imageKey;

    // Update testimonial with new image URL and key
    testimonial.image = imageUrl;
    testimonial.imageKey = imageKey;
    await testimonial.save();

    res.json({
      success: true,
      message: 'Image uploaded successfully',
      data: {
        imageUrl: imageUrl
      }
    });
  } catch (error) {
    console.error('Error uploading image:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to upload image',
      error: error.message
    });
  }
});

export default router;