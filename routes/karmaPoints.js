import express from 'express';
import User from '../models/User.js';
import { authenticateToken } from '../middleware/authMiddleware.js';

const router = express.Router();

// GET /api/karma-points - Get only karma points for authenticated user
router.get('/', authenticateToken, async (req, res) => {
  try {
    console.log('[Karma Points] Full req.user:', JSON.stringify(req.user, null, 2));
    
    // req.user already has karmaPoints from authenticate middleware
    if (req.user && req.user.karmaPoints !== undefined) {
      return res.json({ karmaPoints: req.user.karmaPoints });
    }
    
    res.json({ karmaPoints: 0 });
  } catch (error) {
    console.error('Error fetching karma points:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

export default router;
