import express from 'express';
import Testimonial from '../../models/Testimonial.js';
import { authenticateTestimonial } from '../../middleware/testimonialAuth.js';

const router = express.Router();

// GET /api/testimonials/stats/summary - Get testimonials statistics
router.get('/summary', authenticateTestimonial, async (req, res) => {
  try {
    const clientId = req.user._id || req.user.id;
    const stats = await Testimonial.aggregate([
      {
        $match: {
          clientId: clientId,
          isActive: true
        }
      },
      {
        $group: {
          _id: null,
          totalTestimonials: { $sum: 1 },
          averageRating: { $avg: '$rating' },
          ratingDistribution: {
            $push: '$rating'
          }
        }
      }
    ]);

    const ratingCounts = {};
    for (let i = 1; i <= 5; i++) {
      ratingCounts[i] = 0;
    }

    if (stats.length > 0) {
      stats[0].ratingDistribution.forEach(rating => {
        ratingCounts[rating]++;
      });
    }

    res.json({
      success: true,
      data: {
        totalTestimonials: stats.length > 0 ? stats[0].totalTestimonials : 0,
        averageRating: stats.length > 0 ? Math.round(stats[0].averageRating * 10) / 10 : 0,
        ratingDistribution: ratingCounts
      }
    });
  } catch (error) {
    console.error('Error fetching testimonial stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch testimonial statistics',
      error: error.message
    });
  }
});

export default router;