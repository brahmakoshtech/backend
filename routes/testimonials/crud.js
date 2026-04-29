import express from 'express';
import mongoose from 'mongoose';
import Testimonial from '../../models/Testimonial.js';
import Client from '../../models/Client.js';
import { authenticate } from '../../middleware/auth.js';
import { getPresignedUrl } from '../../utils/storage.js';

const router = express.Router();

const resolveClientObjectId = async (candidate) => {
  if (!candidate) return null;
  if (mongoose.Types.ObjectId.isValid(candidate)) return candidate;
  const client = await Client.findOne({ clientId: candidate }).select('_id');
  return client?._id || null;
};

const withClientIdString = (doc) => {
  if (!doc) return doc;
  const obj = doc.toObject ? doc.toObject() : doc;
  
  // If clientId is populated with Client document, extract the clientId field
  if (obj.clientId && typeof obj.clientId === 'object' && obj.clientId.clientId) {
    return { ...obj, clientId: obj.clientId.clientId };
  }
  
  // If clientId is just an ObjectId, keep it as is (will be handled by populate)
  return obj;
};

// Helper function to extract clientId from request (supports both client and user tokens)
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
router.get('/', authenticate, async (req, res) => {
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
    
    // Build query - exclude deleted items, optionally include inactive items
    const query = { clientId: clientId, isDeleted: false };
    if (req.query.includeInactive !== 'true') {
      query.isActive = true;
    }
    
    const testimonials = await Testimonial.find(query)
      .populate('clientId', 'clientId')
      .sort({ createdAt: -1 });

    // Generate presigned URLs for images
    const testimonialsWithUrls = await Promise.all(
      testimonials.map(async (testimonial) => {
        const testimonialObj = withClientIdString(testimonial);
        
        // Generate presigned URL for image if exists
        if (testimonialObj.imageKey || testimonialObj.image) {
          try {
            const imageKey = testimonialObj.imageKey || testimonialObj.image;
            if (imageKey) {
              testimonialObj.image = await getPresignedUrl(imageKey);
            }
          } catch (error) {
            console.error('Error generating image presigned URL:', error);
          }
        }
        
        return testimonialObj;
      })
    );

    res.json({
      success: true,
      data: testimonialsWithUrls,
      count: testimonialsWithUrls.length
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

// GET /api/testimonials/:id - Get single testimonial
router.get('/:id', authenticate, async (req, res) => {
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
    const testimonial = await Testimonial.findOne({
      _id: req.params.id,
      clientId: clientId,
      isDeleted: false,
      isActive: true
    }).populate('clientId', 'clientId');

    if (!testimonial) {
      return res.status(404).json({
        success: false,
        message: 'Testimonial not found'
      });
    }

    const obj = testimonial.toObject();
    if (obj.clientId && typeof obj.clientId === 'object') {
      obj.clientId = obj.clientId.clientId; // Extract CLI-ABC123
    }

    // Generate presigned URL for image if exists
    if (obj.imageKey || obj.image) {
      try {
        const imageKey = obj.imageKey || obj.image;
        if (imageKey) {
          obj.image = await getPresignedUrl(imageKey);
        }
      } catch (error) {
        console.error('Error generating image presigned URL:', error);
      }
    }

    res.json({
      success: true,
      data: obj
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

// POST /api/testimonials - Create new testimonial
router.post('/', authenticate, async (req, res) => {
  try {
    const { name, rating, message } = req.body;
    let clientId;
    try {
      clientId = await getClientId(req);
    } catch (clientIdError) {
      return res.status(401).json({
        success: false,
        message: clientIdError.message || 'Unable to determine client ID. Please ensure your token is valid.'
      });
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

    const testimonial = new Testimonial({
      name: name.trim(),
      rating: parseInt(rating),
      message: message.trim(),
      clientId: clientId
    });

    await testimonial.save();

    const populated = await testimonial.populate('clientId', 'clientId');
    const obj = populated.toObject();
    if (obj.clientId && typeof obj.clientId === 'object') {
      obj.clientId = obj.clientId.clientId; // Extract CLI-ABC123
    }

    res.status(201).json({
      success: true,
      message: 'Testimonial created successfully',
      data: obj
    });
  } catch (error) {
    console.error('Error creating testimonial:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create testimonial',
      error: error.message
    });
  }
});

// PUT /api/testimonials/:id - Update testimonial
router.put('/:id', authenticate, async (req, res) => {
  try {
    const { name, rating, message } = req.body;
    let clientId;
    try {
      clientId = await getClientId(req);
    } catch (clientIdError) {
      return res.status(401).json({
        success: false,
        message: clientIdError.message || 'Unable to determine client ID. Please ensure your token is valid.'
      });
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

    const testimonial = await Testimonial.findOneAndUpdate(
      {
        _id: req.params.id,
        clientId: clientId,
        isDeleted: false,
        isActive: true
      },
      {
        name: name.trim(),
        rating: parseInt(rating),
        message: message.trim()
      },
      { new: true, runValidators: true }
    ).populate('clientId', 'clientId');

    if (!testimonial) {
      return res.status(404).json({
        success: false,
        message: 'Testimonial not found'
      });
    }

    const populated = await testimonial.populate('clientId', 'clientId');
    const obj = populated.toObject();
    if (obj.clientId && typeof obj.clientId === 'object') {
      obj.clientId = obj.clientId.clientId; // Extract CLI-ABC123
    }

    res.json({
      success: true,
      message: 'Testimonial updated successfully',
      data: obj
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

// DELETE /api/testimonials/:id - Delete testimonial (soft delete)
router.delete('/:id', authenticate, async (req, res) => {
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
    const testimonial = await Testimonial.findOneAndUpdate(
      {
        _id: req.params.id,
        clientId: clientId,
        isDeleted: false
      },
      { isDeleted: true },
      { new: true }
    );

    if (!testimonial) {
      return res.status(404).json({
        success: false,
        message: 'Testimonial not found'
      });
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

// PATCH /api/testimonials/:id/toggle - Toggle testimonial status
router.patch('/:id/toggle', authenticate, async (req, res) => {
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
    
    const testimonial = await Testimonial.findOne({
      _id: req.params.id,
      clientId: clientId,
      isDeleted: false
    });

    if (!testimonial) {
      return res.status(404).json({
        success: false,
        message: 'Testimonial not found'
      });
    }

    testimonial.isActive = !testimonial.isActive;
    await testimonial.save();

    const obj = testimonial.toObject();
    if (obj.clientId && typeof obj.clientId === 'object') {
      obj.clientId = obj.clientId.clientId; // Extract CLI-ABC123
    }

    res.json({
      success: true,
      data: obj,
      message: `Testimonial ${testimonial.isActive ? 'enabled' : 'disabled'} successfully`
    });
  } catch (error) {
    console.error('Toggle testimonial error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to toggle testimonial status',
      error: error.message
    });
  }
});

export default router;