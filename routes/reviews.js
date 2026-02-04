import express from 'express';
import Review from '../models/Review.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { uploadToS3, deleteFromS3, getobject, extractS3KeyFromUrl } from '../utils/s3.js';
import multer from 'multer';

const router = express.Router();

// Configure multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  }
});

// Get all reviews for an expert - MUST BE BEFORE /:reviewId route
router.get('/expert/:expertId', authenticate, authorize(['client', 'user']), async (req, res) => {
  try {
    const { expertId } = req.params;
    
    const reviews = await Review.find({ 
      expertId
    })
    .populate('createdBy', 'clientId')
    .sort({ createdAt: -1 })
    .lean();

    // Generate presigned URLs for review images and format response
    const reviewsWithUrls = await Promise.all(
      reviews.map(async (review) => {
        // Generate presigned URL for image
        if (review.userImage) {
          try {
            const imageKey = review.userImageKey || extractS3KeyFromUrl(review.userImage);
            if (imageKey) {
              review.userImage = await getobject(imageKey, 604800); // 7 days expiry
            }
          } catch (error) {
            console.error('Error generating presigned URL for review image:', error);
            // Keep original URL if presigned fails
          }
        }
        
        // Format clean response
        return {
          id: review._id,
          expertId: review.expertId,
          userName: review.userName,
          userImage: review.userImage,
          userImageKey: review.userImageKey || null,
          rating: review.rating,
          description: review.description,
          consultationType: review.consultationType,
          isActive: review.isActive,
          clientId: review.createdBy?.clientId || null,
          createdAt: review.createdAt,
          updatedAt: review.updatedAt
        };
      })
    );

    res.json({
      success: true,
      data: reviewsWithUrls,
      count: reviewsWithUrls.length
    });
  } catch (error) {
    console.error('Get reviews error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch reviews',
      error: error.message
    });
  }
});

// Get single review by ID
router.get('/:reviewId', authenticate, authorize(['client', 'user']), async (req, res) => {
  try {
    const { reviewId } = req.params;
    const clientId = req.user._id;
    
    const review = await Review.findOne({ 
      _id: reviewId, 
      createdBy: clientId 
    })
    .populate('createdBy', 'clientId')
    .lean();

    if (!review) {
      return res.status(404).json({
        success: false,
        message: 'Review not found or unauthorized'
      });
    }

    // Generate presigned URL for image
    if (review.userImage) {
      try {
        const imageKey = review.userImageKey || extractS3KeyFromUrl(review.userImage);
        if (imageKey) {
          review.userImage = await getobject(imageKey, 604800);
        }
      } catch (error) {
        console.error('Error generating presigned URL for review image:', error);
      }
    }

    // Format clean response
    const formattedReview = {
      id: review._id,
      expertId: review.expertId,
      userName: review.userName,
      userImage: review.userImage,
      userImageKey: review.userImageKey || null,
      rating: review.rating,
      description: review.description,
      consultationType: review.consultationType,
      isActive: review.isActive,
      clientId: review.createdBy?.clientId || null,
      createdAt: review.createdAt,
      updatedAt: review.updatedAt
    };

    res.json({
      success: true,
      data: formattedReview
    });
  } catch (error) {
    console.error('Get single review error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch review',
      error: error.message
    });
  }
});



// Create new review
router.post('/expert/:expertId', authenticate, authorize(['client', 'user']), async (req, res) => {
  try {
    const { expertId } = req.params;
    const { userName, description, rating, consultationType } = req.body;
    const clientId = req.user._id;

    const review = new Review({
      expertId,
      userName,
      description,
      rating: parseInt(rating),
      consultationType: consultationType || 'Chat',
      createdBy: clientId
    });

    await review.save();

    res.status(201).json({
      success: true,
      data: review,
      message: 'Review created successfully'
    });
  } catch (error) {
    console.error('Create review error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create review',
      error: error.message
    });
  }
});

// Update review
router.put('/:reviewId', authenticate, authorize(['client', 'user']), async (req, res) => {
  try {
    const { reviewId } = req.params;
    const { userName, description, rating, consultationType } = req.body;
    const clientId = req.user._id;

    const review = await Review.findOne({ 
      _id: reviewId, 
      createdBy: clientId 
    });

    if (!review) {
      return res.status(404).json({
        success: false,
        message: 'Review not found or unauthorized'
      });
    }

    review.userName = userName || review.userName;
    review.description = description || review.description;
    review.rating = rating ? parseInt(rating) : review.rating;
    review.consultationType = consultationType || review.consultationType;

    await review.save();

    res.json({
      success: true,
      data: review,
      message: 'Review updated successfully'
    });
  } catch (error) {
    console.error('Update review error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update review',
      error: error.message
    });
  }
});

// Delete review
router.delete('/:reviewId', authenticate, authorize(['client', 'user']), async (req, res) => {
  try {
    const { reviewId } = req.params;
    const clientId = req.user._id;

    const review = await Review.findOne({ 
      _id: reviewId, 
      createdBy: clientId 
    });

    if (!review) {
      return res.status(404).json({
        success: false,
        message: 'Review not found or unauthorized'
      });
    }

    await Review.findByIdAndDelete(reviewId);

    res.json({
      success: true,
      message: 'Review deleted successfully'
    });
  } catch (error) {
    console.error('Delete review error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete review',
      error: error.message
    });
  }
});

// Toggle review status
router.patch('/:reviewId/toggle-status', authenticate, authorize(['client', 'user']), async (req, res) => {
  try {
    const { reviewId } = req.params;
    const clientId = req.user._id;

    const review = await Review.findOne({ 
      _id: reviewId, 
      createdBy: clientId 
    });

    if (!review) {
      return res.status(404).json({
        success: false,
        message: 'Review not found or unauthorized'
      });
    }

    review.isActive = !review.isActive;
    await review.save();

    res.json({
      success: true,
      data: { isActive: review.isActive },
      message: `Review ${review.isActive ? 'enabled' : 'disabled'} successfully`
    });
  } catch (error) {
    console.error('Toggle review status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to toggle review status',
      error: error.message
    });
  }
});

// Upload review image
router.post('/:reviewId/upload-image', authenticate, authorize(['client', 'user']), upload.single('image'), async (req, res) => {
  console.log('[Review Upload] Image upload request received:', {
    reviewId: req.params.reviewId,
    hasFile: !!req.file,
    fileName: req.file?.originalname,
    fileSize: req.file?.size,
    userRole: req.user?.role,
    userId: req.user?._id
  });
  
  try {
    const { reviewId } = req.params;
    const clientId = req.user._id;

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No image file provided'
      });
    }

    const review = await Review.findOne({ 
      _id: reviewId, 
      createdBy: clientId 
    });

    if (!review) {
      return res.status(404).json({
        success: false,
        message: 'Review not found or unauthorized'
      });
    }

    // Delete old image if exists
    if (review.userImage) {
      try {
        await deleteFromS3(review.userImage);
      } catch (deleteError) {
        console.warn('Failed to delete old review image:', deleteError);
      }
    }

    // Upload new image to S3 using same pattern as testimonials
    const uploadResult = await uploadToS3(req.file, 'reviews');
    const imageUrl = uploadResult.url;
    const imageKey = uploadResult.key;

    // Update review with new image URL and key
    review.userImage = imageUrl;
    review.userImageKey = imageKey;
    await review.save();

    res.json({
      success: true,
      message: 'Review image uploaded successfully',
      data: {
        imageUrl: imageUrl
      }
    });
  } catch (error) {
    console.error('Upload review image error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to upload review image',
      error: error.message
    });
  }
});

export default router;