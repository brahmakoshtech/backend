import express from 'express';
import mongoose from 'mongoose';
import DreamRequest from '../models/DreamRequest.js';
import { authenticateToken } from '../middleware/auth.js';
import notificationService from '../services/notificationService.js';
import smsService from '../services/smsService.js';

const router = express.Router();

// Get statistics (MUST be before /:id route)
router.get('/analytics/stats', authenticateToken, async (req, res) => {
  try {
    const { clientId } = req.query;
    const filter = clientId ? { clientId } : {};

    const [total, pending, inProgress, completed, rejected] = await Promise.all([
      DreamRequest.countDocuments(filter),
      DreamRequest.countDocuments({ ...filter, status: 'Pending' }),
      DreamRequest.countDocuments({ ...filter, status: 'In Progress' }),
      DreamRequest.countDocuments({ ...filter, status: 'Completed' }),
      DreamRequest.countDocuments({ ...filter, status: 'Rejected' })
    ]);

    res.json({
      total,
      pending,
      inProgress,
      completed,
      rejected
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Failed to fetch statistics' });
  }
});

// Get all dream requests (for admin/client)
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { clientId, status, userId } = req.query;
    const filter = {};

    if (clientId) filter.clientId = clientId;
    if (status) filter.status = status;
    if (userId) {
      try {
        filter.userId = new mongoose.Types.ObjectId(userId);
      } catch (err) {
        return res.status(400).json({ error: 'Invalid userId format' });
      }
    }

    const requests = await DreamRequest.find(filter)
      .sort({ createdAt: -1 })
      .populate('userId', 'name email mobile')
      .populate('completedDreamId', 'symbolName symbolNameHindi')
      .lean();

    res.json(requests);
  } catch (error) {
    res.status(500).json({ 
      error: 'Failed to fetch dream requests',
      message: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Get single dream request by ID
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const request = await DreamRequest.findById(req.params.id)
      .populate('userId', 'name email')
      .populate('completedDreamId', 'symbolName symbolNameHindi');

    if (!request) {
      return res.status(404).json({ error: 'Dream request not found' });
    }

    res.json(request);
  } catch (error) {
    console.error('Error fetching dream request:', error);
    res.status(500).json({ error: 'Failed to fetch dream request' });
  }
});

// Create new dream request
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { dreamSymbol, additionalDetails, clientId } = req.body;

    if (!dreamSymbol || !clientId) {
      return res.status(400).json({ error: 'Dream symbol and client ID are required' });
    }

    if (!req.user || !req.user._id) {
      return res.status(401).json({ error: 'User authentication failed' });
    }

    const userId = req.user._id;
    const userEmail = req.user.email;
    const userName = req.user.profile?.name || req.user.name || (userEmail ? userEmail.split('@')[0] : 'User');

    const request = new DreamRequest({
      dreamSymbol,
      userId,
      userEmail,
      userName,
      additionalDetails,
      clientId,
      status: 'Pending'
    });

    await request.save();

    try {
      await notificationService.sendDreamRequestReceived(userEmail, userName, dreamSymbol);
    } catch (emailError) {
      console.error('[Dream Request] Email sending failed:', emailError.message);
    }

    res.status(201).json({
      message: 'Dream request submitted successfully',
      data: request
    });
  } catch (error) {
    res.status(500).json({ 
      error: 'Failed to create dream request',
      message: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Update dream request status (admin/client only)
router.patch('/:id/status', authenticateToken, async (req, res) => {
  try {
    const { status, adminNotes, completedDreamId } = req.body;

    if (!status) {
      return res.status(400).json({ error: 'Status is required' });
    }

    if (!['Pending', 'In Progress', 'Completed', 'Rejected'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status value' });
    }

    const updateData = { status };
    if (adminNotes !== undefined) updateData.adminNotes = adminNotes;
    if (completedDreamId) updateData.completedDreamId = completedDreamId;
    if (status === 'Completed') updateData.notificationSent = false;

    const request = await DreamRequest.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    ).populate('userId', 'name email mobile');

    if (!request) {
      return res.status(404).json({ error: 'Dream request not found' });
    }

    if (status === 'Completed') {
      try {
        await notificationService.sendDreamReady(
          request.userEmail,
          request.userName,
          request.dreamSymbol,
          process.env.FRONTEND_URL ? `${process.env.FRONTEND_URL}/mobile/user/swapna-decoder` : undefined
        );
        
        if (request.userId?.mobile) {
          const smsMessage = `Your dream meaning for "${request.dreamSymbol}" is ready! Check Swapna Decoder in Brahmakosh app.`;
          await smsService.sendSMS(request.userId.mobile, smsMessage);
        }
        
        await DreamRequest.findByIdAndUpdate(req.params.id, { notificationSent: true });
      } catch (emailError) {
        console.error('[Dream Request] Notification error:', emailError.message);
      }
    }

    res.json({
      message: 'Dream request status updated successfully',
      data: request
    });
  } catch (error) {
    console.error('[Dream Request] Error updating status:', error.message);
    res.status(500).json({ 
      error: 'Failed to update dream request',
      message: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Delete dream request
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const request = await DreamRequest.findByIdAndDelete(req.params.id);

    if (!request) {
      return res.status(404).json({ error: 'Dream request not found' });
    }

    res.json({ message: 'Dream request deleted successfully' });
  } catch (error) {
    console.error('Error deleting dream request:', error);
    res.status(500).json({ error: 'Failed to delete dream request' });
  }
});

export default router;
