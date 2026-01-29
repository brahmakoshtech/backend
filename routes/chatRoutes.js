import express from 'express';
import jwt from 'jsonwebtoken';
import Message from '../models/Message.js';
import Conversation from '../models/Conversation.js';
import Partner from '../models/Partner.js';
import User from '../models/User.js';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-this-in-production-to-a-strong-random-string';

// Middleware to authenticate
const authenticate = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    
    let user;
    if (decoded.role === 'partner') {
      user = await Partner.findById(decoded.partnerId);
      req.userId = decoded.partnerId;
      req.userType = 'partner';
    } else if (decoded.role === 'user') {
      user = await User.findById(decoded.userId);
      req.userId = decoded.userId;
      req.userType = 'user';
    }

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User not found'
      });
    }

    req.user = user;
    next();
  } catch (error) {
    res.status(401).json({
      success: false,
      message: 'Invalid token'
    });
  }
};

// ==================== PARTNER STATUS MANAGEMENT ====================

// @route   PATCH /api/chat/partner/status
// @desc    Update partner's online status (online/offline/busy)
// @access  Private (Partner only)
router.patch('/partner/status', authenticate, async (req, res) => {
  try {
    if (req.userType !== 'partner') {
      return res.status(403).json({
        success: false,
        message: 'Only partners can update status'
      });
    }

    const { status } = req.body;

    if (!['online', 'offline', 'busy'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status. Must be: online, offline, or busy'
      });
    }

    const partner = await Partner.findByIdAndUpdate(
      req.userId,
      {
        onlineStatus: status,
        lastActiveAt: new Date()
      },
      { new: true }
    ).select('name email onlineStatus lastActiveAt activeConversationsCount');

    res.json({
      success: true,
      message: 'Status updated successfully',
      data: partner
    });
  } catch (error) {
    console.error('Error updating partner status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update status'
    });
  }
});

// @route   GET /api/chat/partner/status
// @desc    Get partner's current status
// @access  Private (Partner only)
router.get('/partner/status', authenticate, async (req, res) => {
  try {
    if (req.userType !== 'partner') {
      return res.status(403).json({
        success: false,
        message: 'Only partners can view their status'
      });
    }

    const partner = await Partner.findById(req.userId)
      .select('name email onlineStatus lastActiveAt activeConversationsCount maxConversations');

    res.json({
      success: true,
      data: {
        ...partner.toObject(),
        canAcceptMore: partner.activeConversationsCount < partner.maxConversations
      }
    });
  } catch (error) {
    console.error('Error fetching partner status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch status'
    });
  }
});

// ==================== PARTNER LIST WITH STATUS ====================

// @route   GET /api/chat/partners
// @desc    Get all partners with their real-time status (for users)
// @access  Private (User only)
router.get('/partners', authenticate, async (req, res) => {
  try {
    if (req.userType !== 'user') {
      return res.status(403).json({
        success: false,
        message: 'Only users can view partners list'
      });
    }

    const partners = await Partner.find({ isActive: true, isVerified: true })
      .select('name email profilePicture specialization rating totalSessions experience onlineStatus activeConversationsCount maxConversations lastActiveAt')
      .sort({ rating: -1, totalSessions: -1 })
      .lean();

    const partnersData = partners.map(partner => ({
      ...partner,
      status: partner.onlineStatus,
      isBusy: partner.activeConversationsCount >= partner.maxConversations,
      canAcceptConversation: partner.activeConversationsCount < partner.maxConversations,
      availableSlots: partner.maxConversations - partner.activeConversationsCount
    }));

    res.json({
      success: true,
      data: partnersData
    });
  } catch (error) {
    console.error('Error fetching partners:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch partners'
    });
  }
});

// ==================== CONVERSATION REQUESTS ====================

// @route   POST /api/chat/conversations
// @desc    Create conversation request with user's astrology data
// @access  Private
router.post('/conversations', authenticate, async (req, res) => {
  try {
    const { partnerId, userId, astrologyData } = req.body;

    // Validate request based on user type
    if (req.userType === 'user' && !partnerId) {
      return res.status(400).json({
        success: false,
        message: 'Partner ID is required'
      });
    }

    if (req.userType === 'partner' && !userId) {
      return res.status(400).json({
        success: false,
        message: 'User ID is required'
      });
    }

    const finalPartnerId = req.userType === 'partner' ? req.userId : partnerId;
    const finalUserId = req.userType === 'user' ? req.userId : userId;

    // Check if partner exists and is available
    const partner = await Partner.findById(finalPartnerId);
    if (!partner) {
      return res.status(404).json({
        success: false,
        message: 'Partner not found'
      });
    }

    // Create conversation ID
    const conversationId = [finalPartnerId, finalUserId].sort().join('_');

    // Check if conversation already exists
    let conversation = await Conversation.findOne({ conversationId });

    if (conversation) {
      await conversation.populate('partnerId', 'name email profilePicture specialization rating onlineStatus');
      await conversation.populate('userId', 'email profile profileImage');

      return res.json({
        success: true,
        message: 'Conversation already exists',
        data: conversation
      });
    }

    // Get user's astrology data if user is initiating
    let userAstrologyInfo = {};
    if (req.userType === 'user') {
      const user = await User.findById(finalUserId);
      
      // Capture astrology data from request or from user profile
      userAstrologyInfo = astrologyData || {
        name: user.profile?.name || user.email,
        dateOfBirth: user.profile?.dateOfBirth,
        timeOfBirth: user.profile?.timeOfBirth,
        placeOfBirth: user.profile?.placeOfBirth,
        zodiacSign: user.profile?.zodiacSign,
        moonSign: user.profile?.moonSign,
        ascendant: user.profile?.ascendant,
        additionalInfo: user.profile?.astrologyDetails
      };
    }

    // Create new conversation request
    conversation = await Conversation.create({
      conversationId,
      partnerId: finalPartnerId,
      userId: finalUserId,
      status: 'pending',
      isAcceptedByPartner: false,
      userAstrologyData: userAstrologyInfo
    });

    await conversation.populate('partnerId', 'name email profilePicture specialization rating onlineStatus');
    await conversation.populate('userId', 'email profile profileImage');

    res.json({
      success: true,
      message: 'Conversation request created. Waiting for partner acceptance.',
      data: conversation
    });
  } catch (error) {
    console.error('Error creating conversation:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create conversation'
    });
  }
});

// @route   GET /api/chat/partner/requests
// @desc    Get all pending conversation requests for partner
// @access  Private (Partner only)
router.get('/partner/requests', authenticate, async (req, res) => {
  try {
    if (req.userType !== 'partner') {
      return res.status(403).json({
        success: false,
        message: 'Only partners can view conversation requests'
      });
    }

    const requests = await Conversation.find({
      partnerId: req.userId,
      status: 'pending',
      isAcceptedByPartner: false
    })
      .sort({ createdAt: -1 })
      .populate('userId', 'email profile profileImage')
      .lean();

    const requestsWithAstrology = requests.map(request => ({
      ...request,
      userAstrology: request.userAstrologyData
    }));

    res.json({
      success: true,
      data: {
        requests: requestsWithAstrology,
        totalRequests: requests.length
      }
    });
  } catch (error) {
    console.error('Error fetching conversation requests:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch conversation requests'
    });
  }
});

// @route   POST /api/chat/partner/requests/:conversationId/accept
// @desc    Accept a conversation request
// @access  Private (Partner only)
router.post('/partner/requests/:conversationId/accept', authenticate, async (req, res) => {
  try {
    if (req.userType !== 'partner') {
      return res.status(403).json({
        success: false,
        message: 'Only partners can accept conversation requests'
      });
    }

    const { conversationId } = req.params;

    const conversation = await Conversation.findOne({ conversationId });

    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: 'Conversation not found'
      });
    }

    if (conversation.partnerId.toString() !== req.userId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    if (conversation.isAcceptedByPartner) {
      return res.status(400).json({
        success: false,
        message: 'Conversation already accepted'
      });
    }

    // Check if partner can accept more conversations
    const partner = await Partner.findById(req.userId);
    if (partner.activeConversationsCount >= partner.maxConversations) {
      return res.status(400).json({
        success: false,
        message: 'Maximum concurrent conversations reached. Please end some conversations first.'
      });
    }

    // Accept conversation
    conversation.status = 'accepted';
    conversation.isAcceptedByPartner = true;
    conversation.acceptedAt = new Date();
    await conversation.save();

    // Update partner's active conversation count
    partner.activeConversationsCount += 1;
    await partner.updateBusyStatus();

    await conversation.populate('partnerId', 'name email profilePicture specialization rating onlineStatus');
    await conversation.populate('userId', 'email profile profileImage');

    res.json({
      success: true,
      message: 'Conversation accepted successfully',
      data: conversation
    });
  } catch (error) {
    console.error('Error accepting conversation:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to accept conversation'
    });
  }
});

// @route   POST /api/chat/partner/requests/:conversationId/reject
// @desc    Reject a conversation request
// @access  Private (Partner only)
router.post('/partner/requests/:conversationId/reject', authenticate, async (req, res) => {
  try {
    if (req.userType !== 'partner') {
      return res.status(403).json({
        success: false,
        message: 'Only partners can reject conversation requests'
      });
    }

    const { conversationId } = req.params;
    const { reason } = req.body;

    const conversation = await Conversation.findOne({ conversationId });

    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: 'Conversation not found'
      });
    }

    if (conversation.partnerId.toString() !== req.userId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    conversation.status = 'rejected';
    conversation.rejectedAt = new Date();
    await conversation.save();

    res.json({
      success: true,
      message: 'Conversation rejected',
      data: conversation
    });
  } catch (error) {
    console.error('Error rejecting conversation:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reject conversation'
    });
  }
});

// ==================== CONVERSATIONS LIST ====================

// @route   GET /api/chat/conversations
// @desc    Get all conversations (accepted/active) for logged-in user/partner
// @access  Private
router.get('/conversations', authenticate, async (req, res) => {
  try {
    const isPartner = req.userType === 'partner';
    const query = isPartner 
      ? { partnerId: req.userId, status: { $in: ['accepted', 'active'] } }
      : { userId: req.userId, status: { $in: ['accepted', 'active', 'pending'] } };

    const conversations = await Conversation.find(query)
      .sort({ lastMessageAt: -1 })
      .populate('partnerId', 'name email profilePicture specialization rating onlineStatus')
      .populate('userId', 'email profile profileImage')
      .lean();

    const conversationsData = conversations.map(conv => ({
      ...conv,
      otherUser: isPartner ? conv.userId : conv.partnerId,
      unreadCount: isPartner ? conv.unreadCount.partner : conv.unreadCount.user,
      userAstrology: isPartner ? conv.userAstrologyData : null
    }));

    res.json({
      success: true,
      data: conversationsData
    });
  } catch (error) {
    console.error('Error fetching conversations:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch conversations'
    });
  }
});

// ==================== MESSAGES ====================

// @route   GET /api/chat/conversations/:conversationId/messages
// @desc    Get messages for a specific conversation
// @access  Private
router.get('/conversations/:conversationId/messages', authenticate, async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { page = 1, limit = 50 } = req.query;

    // Verify user has access to this conversation
    const conversation = await Conversation.findOne({ conversationId });
    
    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: 'Conversation not found'
      });
    }

    const isPartner = req.userType === 'partner';
    const hasAccess = isPartner 
      ? conversation.partnerId.toString() === req.userId 
      : conversation.userId.toString() === req.userId;

    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Don't allow messaging if conversation is not accepted
    if (conversation.status === 'pending' && !conversation.isAcceptedByPartner) {
      return res.status(403).json({
        success: false,
        message: 'Conversation is pending partner acceptance'
      });
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const messages = await Message.find({ conversationId, isDeleted: false })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .populate('senderId', 'name email profilePicture profile')
      .lean();

    const totalMessages = await Message.countDocuments({ conversationId, isDeleted: false });

    res.json({
      success: true,
      data: {
        messages: messages.reverse(),
        conversationStatus: conversation.status,
        isAccepted: conversation.isAcceptedByPartner,
        userAstrology: isPartner ? conversation.userAstrologyData : null,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          totalMessages,
          totalPages: Math.ceil(totalMessages / parseInt(limit)),
          hasMore: skip + messages.length < totalMessages
        }
      }
    });
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch messages'
    });
  }
});

// @route   POST /api/chat/conversations/:conversationId/messages
// @desc    Send a message (REST fallback if WebSocket is not available)
// @access  Private
router.post('/conversations/:conversationId/messages', authenticate, async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { content, messageType = 'text', mediaUrl = null } = req.body;

    if (!content) {
      return res.status(400).json({
        success: false,
        message: 'Message content is required'
      });
    }

    const conversation = await Conversation.findOne({ conversationId });
    
    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: 'Conversation not found'
      });
    }

    // Check if conversation is accepted
    if (conversation.status === 'pending' && !conversation.isAcceptedByPartner) {
      return res.status(403).json({
        success: false,
        message: 'Conversation is pending partner acceptance. Cannot send messages yet.'
      });
    }

    const isPartner = req.userType === 'partner';
    const senderId = req.userId;
    const senderModel = isPartner ? 'Partner' : 'User';
    const receiverId = isPartner ? conversation.userId : conversation.partnerId;
    const receiverModel = isPartner ? 'User' : 'Partner';

    const message = await Message.create({
      conversationId,
      senderId,
      senderModel,
      receiverId,
      receiverModel,
      messageType,
      content,
      mediaUrl
    });

    await message.populate('senderId', 'name email profilePicture profile');

    // Update conversation to active on first message
    const updateData = {
      lastMessageAt: new Date(),
      lastMessage: {
        content,
        senderId,
        senderModel,
        createdAt: message.createdAt
      },
      $inc: {
        [`unreadCount.${isPartner ? 'user' : 'partner'}`]: 1
      }
    };

    if (conversation.status === 'accepted') {
      updateData.status = 'active';
    }

    await Conversation.findOneAndUpdate(
      { conversationId },
      updateData
    );

    res.json({
      success: true,
      data: message
    });
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send message'
    });
  }
});

// @route   PATCH /api/chat/conversations/:conversationId/read
// @desc    Mark all messages in conversation as read
// @access  Private
router.patch('/conversations/:conversationId/read', authenticate, async (req, res) => {
  try {
    const { conversationId } = req.params;

    await Message.updateMany(
      {
        conversationId,
        receiverId: req.userId,
        isRead: false
      },
      {
        isRead: true,
        readAt: new Date()
      }
    );

    const isPartner = req.userType === 'partner';
    await Conversation.findOneAndUpdate(
      { conversationId },
      {
        [`unreadCount.${isPartner ? 'partner' : 'user'}`]: 0
      }
    );

    res.json({
      success: true,
      message: 'Messages marked as read'
    });
  } catch (error) {
    console.error('Error marking messages as read:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark messages as read'
    });
  }
});

// @route   PATCH /api/chat/conversations/:conversationId/end
// @desc    End a conversation
// @access  Private
router.patch('/conversations/:conversationId/end', authenticate, async (req, res) => {
  try {
    const { conversationId } = req.params;

    const conversation = await Conversation.findOneAndUpdate(
      { conversationId },
      {
        status: 'ended',
        endedAt: new Date()
      },
      { new: true }
    );

    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: 'Conversation not found'
      });
    }

    // If partner is ending conversation, decrease active count
    if (req.userType === 'partner') {
      const partner = await Partner.findById(req.userId);
      if (partner.activeConversationsCount > 0) {
        partner.activeConversationsCount -= 1;
        await partner.updateBusyStatus();
      }
    }

    res.json({
      success: true,
      data: conversation
    });
  } catch (error) {
    console.error('Error ending conversation:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to end conversation'
    });
  }
});

// @route   GET /api/chat/unread-count
// @desc    Get total unread message count
// @access  Private
router.get('/unread-count', authenticate, async (req, res) => {
  try {
    const isPartner = req.userType === 'partner';
    const query = isPartner 
      ? { partnerId: req.userId }
      : { userId: req.userId };

    const conversations = await Conversation.find(query);
    
    const totalUnread = conversations.reduce((sum, conv) => {
      return sum + (isPartner ? conv.unreadCount.partner : conv.unreadCount.user);
    }, 0);

    // For partners, also include pending request count
    let pendingRequests = 0;
    if (isPartner) {
      pendingRequests = await Conversation.countDocuments({
        partnerId: req.userId,
        status: 'pending',
        isAcceptedByPartner: false
      });
    }

    res.json({
      success: true,
      data: {
        totalUnread,
        conversationCount: conversations.length,
        pendingRequests: isPartner ? pendingRequests : 0
      }
    });
  } catch (error) {
    console.error('Error fetching unread count:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch unread count'
    });
  }
});

// @route   GET /api/chat/conversation/:conversationId/astrology
// @desc    Get user's astrology data for a conversation (Partner only)
// @access  Private (Partner only)
router.get('/conversation/:conversationId/astrology', authenticate, async (req, res) => {
  try {
    if (req.userType !== 'partner') {
      return res.status(403).json({
        success: false,
        message: 'Only partners can view astrology data'
      });
    }

    const { conversationId } = req.params;

    const conversation = await Conversation.findOne({ conversationId })
      .populate('userId', 'email profile profileImage');

    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: 'Conversation not found'
      });
    }

    if (conversation.partnerId.toString() !== req.userId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    res.json({
      success: true,
      data: {
        conversationId: conversation.conversationId,
        userAstrology: conversation.userAstrologyData,
        user: conversation.userId
      }
    });
  } catch (error) {
    console.error('Error fetching astrology data:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch astrology data'
    });
  }
});

export default router;