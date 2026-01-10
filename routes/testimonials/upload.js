import express from 'express';
import Testimonial from '../../models/Testimonial.js';
import { authenticateTestimonial } from '../../middleware/testimonialAuth.js';
import multer from 'multer';
import { uploadToS3, deleteFromS3 } from '../../utils/s3.js';

const router = express.Router();

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

// POST /api/testimonials/:id/image - Upload image for testimonial
router.post('/:id/image', authenticateTestimonial, upload.single('image'), async (req, res) => {
  try {
    const clientId = req.user._id || req.user.id;
    
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

    // Upload new image to S3
    const imageUrl = await uploadToS3(req.file, 'testimonials');

    // Update testimonial with new image URL
    testimonial.image = imageUrl;
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