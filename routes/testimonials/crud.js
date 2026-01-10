import express from 'express';
import Testimonial from '../../models/Testimonial.js';
import { authenticateTestimonial } from '../../middleware/testimonialAuth.js';

const router = express.Router();

// GET /api/testimonials - Get all testimonials for authenticated client
router.get('/', authenticateTestimonial, async (req, res) => {
  try {
    const clientId = req.user._id || req.user.id;
    const testimonials = await Testimonial.find({ 
      clientId: clientId,
      isActive: true 
    }).sort({ createdAt: -1 });

    res.json({
      success: true,
      data: testimonials,
      count: testimonials.length
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
router.get('/:id', authenticateTestimonial, async (req, res) => {
  try {
    const clientId = req.user._id || req.user.id;
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

// POST /api/testimonials - Create new testimonial
router.post('/', authenticateTestimonial, async (req, res) => {
  try {
    const { name, rating, message } = req.body;
    const clientId = req.user._id || req.user.id;

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

    res.status(201).json({
      success: true,
      message: 'Testimonial created successfully',
      data: testimonial
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
router.put('/:id', authenticateTestimonial, async (req, res) => {
  try {
    const { name, rating, message } = req.body;
    const clientId = req.user._id || req.user.id;

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
        isActive: true
      },
      {
        name: name.trim(),
        rating: parseInt(rating),
        message: message.trim()
      },
      { new: true, runValidators: true }
    );

    if (!testimonial) {
      return res.status(404).json({
        success: false,
        message: 'Testimonial not found'
      });
    }

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

// DELETE /api/testimonials/:id - Delete testimonial (soft delete)
router.delete('/:id', authenticateTestimonial, async (req, res) => {
  try {
    const clientId = req.user._id || req.user.id;
    const testimonial = await Testimonial.findOneAndUpdate(
      {
        _id: req.params.id,
        clientId: clientId,
        isActive: true
      },
      { isActive: false },
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

export default router;