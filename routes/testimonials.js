import express from 'express';
import mongoose from 'mongoose';
import Testimonial from '../models/Testimonial.js';
import Client from '../models/Client.js';
import { authenticate, authorize } from '../middleware/auth.js';
import multer from 'multer';
import { uploadFile, deleteFile, getPresignedUrl } from '../utils/storage.js';

const router = express.Router();

// Configure multer for image upload
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only JPG, PNG, GIF files are allowed'), false);
    }
  }
});

// Error handling middleware for multer
const handleMulterError = (err, req, res, next) => {
  console.log('=== MULTER ERROR HANDLER ===');
  console.log('Error type:', err.constructor.name);
  console.log('Error message:', err.message);
  console.log('Error code:', err.code);
  
  if (err instanceof multer.MulterError) {
    console.log('Multer error detected');
    if (err.code === 'LIMIT_FILE_SIZE') {
      console.log('File size limit exceeded');
      return res.status(400).json({
        success: false,
        message: 'File too large. Maximum size is 5MB'
      });
    }
  }
  if (err.message === 'Only JPG, PNG, GIF files are allowed') {
    console.log('Invalid file type');
    return res.status(400).json({
      success: false,
      message: err.message
    });
  }
  console.log('Passing error to next middleware');
  next(err);
};

const resolveClientObjectId = async (candidate) => {
  if (!candidate) return null;
  if (mongoose.Types.ObjectId.isValid(candidate)) return candidate;
  const client = await Client.findOne({ clientId: candidate }).select('_id');
  return client?._id || null;
};

// Helper function to extract clientId (supports both client and user tokens)
const getClientId = async (req) => {
  if (req.user.role === 'user') {
    const rawClientId = req.decodedClientId || req.user.clientId?._id || req.user.clientId || req.user.tokenClientId || req.user.clientId?.clientId;
    const clientId = await resolveClientObjectId(rawClientId);
    if (!clientId) {
      throw new Error('Client ID not found for user token. Please ensure your token includes clientId.');
    }
    return clientId;
  }
  const rawClientId = req.user._id || req.user.id || req.user.clientId;
  const clientId = await resolveClientObjectId(rawClientId);
  if (!clientId) {
    throw new Error('Client ID not found. Please login again.');
  }
  return clientId;
};

// GET /api/testimonials - Get all testimonials for authenticated client
router.get('/', authenticate, authorize('client','user'), async (req, res) => {
  try {
    let clientId;
    try {
      clientId = await getClientId(req);
    } catch (clientIdError) {
      return res.status(401).json({
        success: false,
        message: clientIdError.message || 'Unable to determine client ID. Please ensure your token is valid.'
      });
    }
    
    // Build query - optionally include inactive items
    const query = { clientId: clientId };
    if (req.query.includeInactive !== 'true') {
      query.isActive = true;
    }
    
    const testimonials = await Testimonial.find(query).sort({ createdAt: -1 });

    // Generate pre-signed URLs for images
    const testimonialsWithSignedUrls = await Promise.all(
      testimonials.map(async (testimonial) => {
        const testimonialObj = testimonial.toObject();
        if (testimonialObj.imageKey) {
          try {
            const signedUrl = await getPresignedUrl(testimonialObj.imageKey, 604800);
            console.log('Generated signed URL for:', testimonialObj.imageKey, '→', signedUrl.substring(0, 100) + '...');
            testimonialObj.signedImageUrl = signedUrl;
            testimonialObj.image = signedUrl;
          } catch (error) {
            console.error('❌ Error generating signed URL for:', testimonialObj.imageKey, error.message);
          }
        }
        return testimonialObj;
      })
    );

    res.json({
      success: true,
      data: testimonialsWithSignedUrls,
      count: testimonialsWithSignedUrls.length
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

// POST /api/testimonials - Create new testimonial (without image)
router.post('/', authenticate, authorize('client','user'), async (req, res) => {
  console.log('=== TESTIMONIAL CREATE REQUEST ===');
  console.log('Body:', req.body);
  console.log('File:', req.file ? {
    originalname: req.file.originalname,
    mimetype: req.file.mimetype,
    size: req.file.size
  } : 'No file');
  console.log('User:', req.user ? { id: req.user._id || req.user.id, role: req.user.role } : 'No user');
  
  try {
    const { name, rating, message } = req.body;
    
    // Helper function to extract clientId (supports both client and user tokens)
    let clientId;
    if (req.user.role === 'user') {
      clientId = req.decodedClientId || req.user.clientId?._id || req.user.clientId || req.user.tokenClientId;
      if (!clientId) {
        return res.status(401).json({
          success: false,
          message: 'Client ID not found for user token. Please ensure your token includes clientId.'
        });
      }
    } else {
      clientId = req.user._id || req.user.id;
    }

    console.log('Extracted data:', { name, rating, message, clientId });

    // Validation
    if (!name || !rating || !message) {
      console.log('Validation failed: Missing required fields');
      return res.status(400).json({
        success: false,
        message: 'Name, rating, and message are required'
      });
    }

    if (rating < 1 || rating > 5) {
      console.log('Validation failed: Invalid rating');
      return res.status(400).json({
        success: false,
        message: 'Rating must be between 1 and 5'
      });
    }

    let imageUrl = null;
    let imageKey = null;
    // Image will be uploaded separately via /upload-image endpoint
    console.log('No image in create request - will be uploaded separately if needed');

    console.log('Creating testimonial with data:', {
      name: name.trim(),
      rating: parseInt(rating),
      message: message.trim(),
      image: imageUrl,
      imageKey: imageKey,
      clientId: clientId
    });

    const testimonial = new Testimonial({
      name: name.trim(),
      rating: parseInt(rating),
      message: message.trim(),
      image: imageUrl,
      imageKey: imageKey,
      clientId: clientId
    });

    await testimonial.save();
    console.log('Testimonial saved successfully:', testimonial._id);

    res.status(201).json({
      success: true,
      message: 'Testimonial created successfully',
      data: testimonial
    });
  } catch (error) {
    console.error('=== TESTIMONIAL CREATE ERROR ===');
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
    res.status(500).json({
      success: false,
      message: 'Failed to create testimonial',
      error: error.message
    });
  }
});

// PUT /api/testimonials/:id - Update testimonial (without image)
router.put('/:id', authenticate, authorize('client','user'), async (req, res) => {
  try {
    const { name, rating, message } = req.body;
    
    // Helper function to extract clientId (supports both client and user tokens)
    let clientId;
    if (req.user.role === 'user') {
      clientId = req.decodedClientId || req.user.clientId?._id || req.user.clientId || req.user.tokenClientId;
      if (!clientId) {
        return res.status(401).json({
          success: false,
          message: 'Client ID not found for user token. Please ensure your token includes clientId.'
        });
      }
    } else {
      clientId = req.user._id || req.user.id;
    }

    // Validation
    if (!name || !rating || !message) {
      return res.status(400).json({
        success: false,
        message: 'Name, rating, and message are required'
      });
    }

    if (rating < 1 || rating > 5) {
      return res.status(400).json({
        success: false,
        message: 'Rating must be between 1 and 5'
      });
    }

    const testimonial = await Testimonial.findOne({
      _id: req.params.id,
      clientId: clientId
      // Removed isActive filter to allow editing disabled testimonials
    });

    if (!testimonial) {
      return res.status(404).json({
        success: false,
        message: 'Testimonial not found'
      });
    }

    // Image will be updated separately via /upload-image endpoint
    // Keep existing image
    const imageUrl = testimonial.image;
    const imageKey = testimonial.imageKey;

    testimonial.name = name.trim();
    testimonial.rating = parseInt(rating);
    testimonial.message = message.trim();
    testimonial.image = imageUrl;
    testimonial.imageKey = imageKey;
    
    await testimonial.save();

    res.json({
      success: true,
      message: 'Testimonial updated successfully',
      data: testimonial
    });
  } catch (error) {
    console.error('Error updating testimonial:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update testimonial',
      error: error.message
    });
  }
});

// DELETE /api/testimonials/:id - Delete testimonial (hard delete)
router.delete('/:id', authenticate, authorize('client','user'), async (req, res) => {
  try {
    // Helper function to extract clientId (supports both client and user tokens)
    let clientId;
    if (req.user.role === 'user') {
      clientId = req.decodedClientId || req.user.clientId?._id || req.user.clientId || req.user.tokenClientId;
      if (!clientId) {
        return res.status(401).json({
          success: false,
          message: 'Client ID not found for user token. Please ensure your token includes clientId.'
        });
      }
    } else {
      clientId = req.user._id || req.user.id;
    }
    const testimonial = await Testimonial.findOneAndDelete({
      _id: req.params.id,
      clientId: clientId
    });

    if (!testimonial) {
      return res.status(404).json({
        success: false,
        message: 'Testimonial not found'
      });
    }

    // Delete image from S3 if exists (prefer key over URL)
    if (testimonial.imageKey || testimonial.image) {
      try {
        await deleteFile(testimonial.imageKey || testimonial.image);
      } catch (deleteError) {
        console.error('Failed to delete image from S3:', deleteError);
      }
    }

    res.json({
      success: true,
      message: 'Testimonial deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting testimonial:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete testimonial',
      error: error.message
    });
  }
});

// POST /api/testimonials/:id/upload-image - Upload image for existing testimonial
router.post('/:id/upload-image', authenticate, authorize('client','user'), upload.single('image'), handleMulterError, async (req, res) => {
  try {
    // Helper function to extract clientId (supports both client and user tokens)
    let clientId;
    if (req.user.role === 'user') {
      clientId = req.decodedClientId || req.user.clientId?._id || req.user.clientId || req.user.tokenClientId;
      if (!clientId) {
        return res.status(401).json({
          success: false,
          message: 'Client ID not found for user token. Please ensure your token includes clientId.'
        });
      }
    } else {
      clientId = req.user._id || req.user.id;
    }
    
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No image file provided'
      });
    }

    const testimonial = await Testimonial.findOne({
      _id: req.params.id,
      clientId: clientId
    });

    if (!testimonial) {
      return res.status(404).json({
        success: false,
        message: 'Testimonial not found'
      });
    }

    const uploadResult = await uploadFile(req.file, 'testimonials');
    const imageUrl = uploadResult.url;
    const imageKey = uploadResult.key;

    // Delete old image if exists (prefer key over URL)
    if (testimonial.imageKey || testimonial.image) {
      try {
        await deleteFile(testimonial.imageKey || testimonial.image);
      } catch (deleteError) {
        console.error('Failed to delete old image:', deleteError);
      }
    }

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
    console.error('Image upload error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to upload image',
      error: error.message
    });
  }
});

// PATCH /api/testimonials/:id/toggle - Toggle testimonial status (enable/disable)
router.patch('/:id/toggle', authenticate, authorize('client','user'), async (req, res) => {
  try {
    // Helper function to extract clientId (supports both client and user tokens)
    let clientId;
    if (req.user.role === 'user') {
      clientId = req.decodedClientId || req.user.clientId?._id || req.user.clientId || req.user.tokenClientId;
      if (!clientId) {
        return res.status(401).json({
          success: false,
          message: 'Client ID not found for user token. Please ensure your token includes clientId.'
        });
      }
    } else {
      clientId = req.user._id || req.user.id;
    }
    const testimonial = await Testimonial.findOne({
      _id: req.params.id,
      clientId: clientId
    });

    if (!testimonial) {
      return res.status(404).json({
        success: false,
        message: 'Testimonial not found'
      });
    }

    testimonial.isActive = !testimonial.isActive;
    await testimonial.save();

    res.json({
      success: true,
      data: testimonial,
      message: `Testimonial ${testimonial.isActive ? 'enabled' : 'disabled'} successfully`
    });
  } catch (error) {
    console.error('Toggle testimonial error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while toggling testimonial status'
    });
  }
});

export default router;