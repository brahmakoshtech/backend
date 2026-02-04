import express from 'express';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import Message from '../models/Message.js';
import Conversation from '../models/Conversation.js';
import Partner from '../models/Partner.js';
import User from '../models/User.js';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-this-in-production-to-a-strong-random-string';

// Middleware to authenticate
const authenticate = async (req, res, next) => {
  try {
    console.log('🔐 Authentication middleware started');
    console.log('📋 Headers:', req.headers);
    
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      console.log('❌ No token provided');
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    console.log('🔑 Token received:', token.substring(0, 20) + '...');

    const decoded = jwt.verify(token, JWT_SECRET);
    console.log('✅ Token decoded:', decoded);
    
    let user;
    if (decoded.role === 'partner') {
      const partnerIdFromToken = decoded.userId || decoded.partnerId; // Support both
      user = await Partner.findById(partnerIdFromToken);
      req.userId = partnerIdFromToken;
      req.userType = 'partner';
    } else if (decoded.role === 'user') {
      console.log('👤 User type: USER');
      user = await User.findById(decoded.userId);
      req.userId = decoded.userId;
      req.userType = 'user';
    }

    if (!user) {
      console.log('❌ User not found in database');
      return res.status(401).json({
        success: false,
        message: 'User not found'
      });
    }

    console.log('✅ User authenticated:', { id: req.userId, type: req.userType });
    req.user = user;
    next();
  } catch (error) {
    console.error('❌ Authentication error:', error.message);
    console.error('Stack:', error.stack);
    res.status(401).json({
      success: false,
      message: 'Invalid token',
      error: error.message
    });
  }
};

// ==================== PARTNER STATUS MANAGEMENT ====================

// @route   PATCH /api/chat/partner/status
// @desc    Update partner's online status (online/offline/busy)
// @access  Private (Partner only)
router.patch('/partner/status', authenticate, async (req, res) => {
  try {
    console.log('📊 UPDATE PARTNER STATUS - START');
    console.log('User Type:', req.userType);
    console.log('User ID:', req.userId);
    console.log('Request Body:', req.body);

    if (req.userType !== 'partner') {
      console.log('❌ Access denied - not a partner');
      return res.status(403).json({
        success: false,
        message: 'Only partners can update status'
      });
    }

    const { status } = req.body;

    if (!['online', 'offline', 'busy'].includes(status)) {
      console.log('❌ Invalid status:', status);
      return res.status(400).json({
        success: false,
        message: 'Invalid status. Must be: online, offline, or busy'
      });
    }

    console.log('🔄 Updating partner status to:', status);

    const partner = await Partner.findByIdAndUpdate(
      req.userId,
      {
        onlineStatus: status,
        lastActiveAt: new Date()
      },
      { new: true }
    ).select('name email onlineStatus lastActiveAt activeConversationsCount');

    console.log('✅ Partner status updated:', partner);

    res.json({
      success: true,
      message: 'Status updated successfully',
      data: partner
    });
  } catch (error) {
    console.error('❌ Error updating partner status:', error.message);
    console.error('Stack:', error.stack);
    res.status(500).json({
      success: false,
      message: 'Failed to update status',
      error: error.message
    });
  }
});

// @route   GET /api/chat/partner/status
// @desc    Get partner's current status
// @access  Private (Partner only)
router.get('/partner/status', authenticate, async (req, res) => {
  try {
    console.log('📊 GET PARTNER STATUS - START');
    console.log('User Type:', req.userType);
    console.log('User ID:', req.userId);

    if (req.userType !== 'partner') {
      console.log('❌ Access denied - not a partner');
      return res.status(403).json({
        success: false,
        message: 'Only partners can view their status'
      });
    }

    const partner = await Partner.findById(req.userId)
      .select('name email onlineStatus lastActiveAt activeConversationsCount maxConversations');

    console.log('✅ Partner status fetched:', partner);

    res.json({
      success: true,
      data: {
        ...partner.toObject(),
        canAcceptMore: partner.activeConversationsCount < partner.maxConversations
      }
    });
  } catch (error) {
    console.error('❌ Error fetching partner status:', error.message);
    console.error('Stack:', error.stack);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch status',
      error: error.message
    });
  }
});

// ==================== GET AVAILABLE PARTNERS ====================

// @route   GET /api/chat/partners
// @desc    Get all available partners for users
// @access  Private
router.get('/partners', authenticate, async (req, res) => {
  try {
    console.log('═══════════════════════════════════════════════════');
    console.log('🔍 GET ALL PARTNERS - START');
    console.log('═══════════════════════════════════════════════════');
    console.log('📋 Request Info:');
    console.log('  - User Type:', req.userType);
    console.log('  - User ID:', req.userId);
    console.log('  - User Email:', req.user?.email);

    console.log('🔍 Querying Partner collection...');
    
    const totalPartners = await Partner.countDocuments();
    const activePartners = await Partner.countDocuments({ isActive: true });
    const verifiedPartners = await Partner.countDocuments({ isVerified: true });
    const activeAndVerified = await Partner.countDocuments({ isActive: true, isVerified: true });
    
    console.log(`📊 Total partners: ${totalPartners}`);
    console.log(`📊 Active partners: ${activePartners}`);
    console.log(`📊 Verified partners: ${verifiedPartners}`);
    console.log(`📊 Active AND verified: ${activeAndVerified}`);

    const partners = await Partner.find({ isActive: true, isVerified: true })
      .select('name email profilePicture specialization rating totalSessions experience onlineStatus activeConversationsCount maxConversations lastActiveAt')
      .sort({ rating: -1, totalSessions: -1 })
      .lean();

    console.log(`✅ Partners found: ${partners.length}`);

    // Process partners with safe defaults for missing fields
    const partnersData = partners.map(partner => {
      const onlineStatus = partner.onlineStatus || 'offline';
      const activeConversationsCount = partner.activeConversationsCount ?? 0;
      const maxConversations = partner.maxConversations || 5;
      
      const processedPartner = {
        ...partner,
        name: partner.name || partner.email.split('@')[0],
        onlineStatus,
        activeConversationsCount,
        maxConversations,
        rating: partner.rating || 0,
        totalSessions: partner.totalSessions || 0,
        experience: partner.experience || 0,
        status: onlineStatus,
        isBusy: activeConversationsCount >= maxConversations,
        canAcceptConversation: activeConversationsCount < maxConversations,
        availableSlots: maxConversations - activeConversationsCount
      };
      
      console.log('🔄 Processed partner:', processedPartner.name, {
        status: processedPartner.status,
        isBusy: processedPartner.isBusy,
        activeConversations: activeConversationsCount,
        maxConversations: maxConversations
      });
      
      return processedPartner;
    });

    console.log('✅ Partners data prepared, sending response...');
    console.log('═══════════════════════════════════════════════════');

    res.json({
      success: true,
      data: partnersData,
      meta: {
        total: partnersData.length,
        totalInDb: totalPartners,
        active: activePartners,
        verified: verifiedPartners,
        query: { isActive: true, isVerified: true }
      }
    });
  } catch (error) {
    console.error('═══════════════════════════════════════════════════');
    console.error('❌ ERROR in GET PARTNERS:');
    console.error('Message:', error.message);
    console.error('Stack:', error.stack);
    console.error('═══════════════════════════════════════════════════');
    
    res.status(500).json({
      success: false,
      message: 'Failed to fetch partners',
      error: error.message
    });
  }
});

// ==================== CONVERSATION REQUESTS ====================

// @route   POST /api/chat/conversations
// @desc    Create conversation request with user's astrology data (AUTO-FILLED FROM PROFILE)
// @access  Private
router.post('/conversations', authenticate, async (req, res) => {
  try {
    console.log('💬 CREATE CONVERSATION - START');
    console.log('Request Body:', req.body);
    console.log('User Type:', req.userType);

    const { partnerId, userId, astrologyData } = req.body;

    // Validate request based on user type
    if (req.userType === 'user' && !partnerId) {
      console.log('❌ Partner ID missing for user request');
      return res.status(400).json({
        success: false,
        message: 'Partner ID is required'
      });
    }

    if (req.userType === 'partner' && !userId) {
      console.log('❌ User ID missing for partner request');
      return res.status(400).json({
        success: false,
        message: 'User ID is required'
      });
    }

    const finalPartnerId = req.userType === 'partner' ? req.userId : partnerId;
    const finalUserId = req.userType === 'user' ? req.userId : userId;

    console.log('Final IDs:', { partnerId: finalPartnerId, userId: finalUserId });

    // Check if partner exists and is available
    const partner = await Partner.findById(finalPartnerId);
    if (!partner) {
      console.log('❌ Partner not found:', finalPartnerId);
      return res.status(404).json({
        success: false,
        message: 'Partner not found'
      });
    }

    console.log('✅ Partner found:', partner.name);

    // Create conversation ID
    const conversationId = [finalPartnerId, finalUserId].sort().join('_');
    console.log('Generated conversation ID:', conversationId);

    // Check if conversation already exists
    let conversation = await Conversation.findOne({ conversationId });

    if (conversation) {
      // If conversation was ended/rejected, reopen it as a new pending request
      if (['ended', 'rejected', 'cancelled'].includes(conversation.status)) {
        console.log('🔄 Reopening ended/rejected conversation as new pending request');
        let userAstrologyInfo = conversation.userAstrologyData || {};
        if (req.userType === 'user' && (astrologyData?.name || astrologyData?.dateOfBirth)) {
          const user = await User.findById(finalUserId);
          userAstrologyInfo = {
            name: astrologyData?.name || user?.profile?.name || user?.email,
            dateOfBirth: astrologyData?.dateOfBirth || (user?.profile?.dob ? new Date(user.profile.dob).toISOString().split('T')[0] : null),
            timeOfBirth: astrologyData?.timeOfBirth || user?.profile?.timeOfBirth || '',
            placeOfBirth: astrologyData?.placeOfBirth || user?.profile?.placeOfBirth || '',
            gowthra: astrologyData?.gowthra || user?.profile?.gowthra || '',
            zodiacSign: astrologyData?.zodiacSign || user?.profile?.zodiacSign || '',
            moonSign: astrologyData?.moonSign || user?.profile?.moonSign || '',
            ascendant: astrologyData?.ascendant || user?.profile?.ascendant || '',
            additionalInfo: astrologyData?.additionalInfo || user?.profile?.astrologyDetails
          };
        }
        conversation.status = 'pending';
        conversation.isAcceptedByPartner = false;
        conversation.acceptedAt = null;
        conversation.rejectedAt = null;
        conversation.rejectionReason = null;
        conversation.endedAt = null;
        conversation.userAstrologyData = userAstrologyInfo;
        conversation.unreadCount = { partner: 0, user: 0 };
        await conversation.save();
      } else {
        console.log('ℹ️ Conversation already exists');
      }
      await conversation.populate('partnerId', 'name email profilePicture specialization rating onlineStatus');
      await conversation.populate('userId', 'email profile profileImage');

      return res.json({
        success: true,
        message: conversation.status === 'pending' ? 'Consultation request reopened. Waiting for partner acceptance.' : 'Conversation already exists',
        data: conversation
      });
    }

    // Get user's complete profile data
    let userAstrologyInfo = {};
    if (req.userType === 'user') {
      const user = await User.findById(finalUserId);
      
      console.log('📊 User profile data:', user.profile);
      
      // Use provided astrology data OR fall back to user profile
      // Provided data takes priority, profile is fallback
      userAstrologyInfo = {
        name: astrologyData?.name || user.profile?.name || user.email,
        dateOfBirth: astrologyData?.dateOfBirth || (user.profile?.dob ? new Date(user.profile.dob).toISOString().split('T')[0] : null),
        timeOfBirth: astrologyData?.timeOfBirth || user.profile?.timeOfBirth || '',
        placeOfBirth: astrologyData?.placeOfBirth || user.profile?.placeOfBirth || '',
        latitude: astrologyData?.latitude ?? user.profile?.latitude ?? null,
        longitude: astrologyData?.longitude ?? user.profile?.longitude ?? null,
        gowthra: astrologyData?.gowthra || user.profile?.gowthra || '',
        zodiacSign: astrologyData?.zodiacSign || user.profile?.zodiacSign || '',
        moonSign: astrologyData?.moonSign || user.profile?.moonSign || '',
        ascendant: astrologyData?.ascendant || user.profile?.ascendant || '',
        additionalInfo: astrologyData?.additionalInfo || user.profile?.astrologyDetails
      };
      
      console.log('📊 Final astrology data for conversation:', userAstrologyInfo);
    }

    // Create new conversation request
    console.log('🆕 Creating new conversation...');
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

    console.log('✅ Conversation created successfully');

    res.json({
      success: true,
      message: 'Conversation request created. Waiting for partner acceptance.',
      data: conversation
    });
  } catch (error) {
    console.error('❌ Error creating conversation:', error.message);
    console.error('Stack:', error.stack);
    res.status(500).json({
      success: false,
      message: 'Failed to create conversation',
      error: error.message
    });
  }
});

// @route   GET /api/chat/partner/requests
// @desc    Get all pending conversation requests for partner
// @access  Private (Partner only)
router.get('/partner/requests', authenticate, async (req, res) => {
  try {
    console.log('📥 GET PARTNER REQUESTS - START');
    console.log('User Type:', req.userType);
    console.log('Partner ID:', req.userId);

    if (req.userType !== 'partner') {
      console.log('❌ Access denied - not a partner');
      return res.status(403).json({
        success: false,
        message: 'Only partners can view conversation requests'
      });
    }

    const partnerObjectId = mongoose.Types.ObjectId.isValid(req.userId) ? new mongoose.Types.ObjectId(req.userId) : req.userId;
    const requests = await Conversation.find({
      partnerId: partnerObjectId,
      status: 'pending',
      isAcceptedByPartner: false
    })
      .sort({ createdAt: -1 })
      .populate('userId', 'email profile profileImage')
      .lean();

    console.log(`✅ Found ${requests.length} pending requests`);

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
    console.error('❌ Error fetching conversation requests:', error.message);
    console.error('Stack:', error.stack);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch conversation requests',
      error: error.message
    });
  }
});

// @route   POST /api/chat/partner/requests/:conversationId/accept
// @desc    Accept a conversation request
// @access  Private (Partner only)
router.post('/partner/requests/:conversationId/accept', authenticate, async (req, res) => {
  try {
    console.log('✅ ACCEPT CONVERSATION REQUEST - START');
    console.log('Conversation ID:', req.params.conversationId);
    console.log('Partner ID:', req.userId);

    if (req.userType !== 'partner') {
      return res.status(403).json({
        success: false,
        message: 'Only partners can accept conversation requests'
      });
    }

    const { conversationId } = req.params;

    const conversation = await Conversation.findOne({ conversationId });

    if (!conversation) {
      console.log('❌ Conversation not found');
      return res.status(404).json({
        success: false,
        message: 'Conversation not found'
      });
    }

    if (conversation.partnerId.toString() !== req.userId) {
      console.log('❌ Access denied - not your conversation');
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    if (conversation.isAcceptedByPartner) {
      console.log('⚠️ Already accepted');
      return res.status(400).json({
        success: false,
        message: 'Conversation already accepted'
      });
    }

    // Check if partner can accept more conversations
    const partner = await Partner.findById(req.userId);
    if (partner.activeConversationsCount >= partner.maxConversations) {
      console.log('❌ Max conversations reached');
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

    console.log('✅ Conversation accepted, active count:', partner.activeConversationsCount);

    await conversation.populate('partnerId', 'name email profilePicture specialization rating onlineStatus');
    await conversation.populate('userId', 'email profile profileImage');

    res.json({
      success: true,
      message: 'Conversation accepted successfully',
      data: conversation
    });
  } catch (error) {
    console.error('❌ Error accepting conversation:', error.message);
    console.error('Stack:', error.stack);
    res.status(500).json({
      success: false,
      message: 'Failed to accept conversation',
      error: error.message
    });
  }
});

// @route   POST /api/chat/partner/requests/:conversationId/reject
// @desc    Reject a conversation request
// @access  Private (Partner only)
router.post('/partner/requests/:conversationId/reject', authenticate, async (req, res) => {
  try {
    console.log('❌ REJECT CONVERSATION REQUEST - START');
    console.log('Conversation ID:', req.params.conversationId);

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

    console.log('✅ Conversation rejected');

    res.json({
      success: true,
      message: 'Conversation rejected',
      data: conversation
    });
  } catch (error) {
    console.error('❌ Error rejecting conversation:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to reject conversation',
      error: error.message
    });
  }
});

// ==================== CONVERSATIONS LIST ====================

// @route   GET /api/chat/conversations
// @desc    Get all conversations (accepted/active) for logged-in user/partner
// @access  Private
router.get('/conversations', authenticate, async (req, res) => {
  try {
    console.log('💬 GET CONVERSATIONS - START');
    console.log('User Type:', req.userType);
    console.log('User ID:', req.userId);

    const isPartner = req.userType === 'partner';
    const query = isPartner 
      ? { partnerId: req.userId, status: { $in: ['accepted', 'active'] } }
      : { userId: req.userId, status: { $in: ['accepted', 'active', 'pending'] } };

    console.log('Query:', JSON.stringify(query));

    const conversations = await Conversation.find(query)
      .sort({ lastMessageAt: -1 })
      .populate('partnerId', 'name email profilePicture specialization rating onlineStatus')
      .populate('userId', 'email profile profileImage')
      .lean();

    console.log(`✅ Found ${conversations.length} conversations`);

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
    console.error('❌ Error fetching conversations:', error.message);
    console.error('Stack:', error.stack);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch conversations',
      error: error.message
    });
  }
});

// ==================== MESSAGES ====================

// @route   GET /api/chat/conversations/:conversationId/messages
// @desc    Get messages for a specific conversation
// @access  Private
router.get('/conversations/:conversationId/messages', authenticate, async (req, res) => {
  try {
    console.log('📨 GET MESSAGES - START');
    console.log('Conversation ID:', req.params.conversationId);
    console.log('User ID:', req.userId);
    console.log('User Type:', req.userType);

    const { conversationId } = req.params;
    const { page = 1, limit = 50 } = req.query;

    // Verify user has access to this conversation
    const conversation = await Conversation.findOne({ conversationId });
    
    if (!conversation) {
      console.log('❌ Conversation not found');
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
      console.log('❌ Access denied');
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Don't allow messaging if conversation is not accepted
    if (conversation.status === 'pending' && !conversation.isAcceptedByPartner) {
      console.log('⚠️ Conversation pending acceptance');
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

    console.log(`✅ Found ${messages.length} messages (total: ${totalMessages})`);

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
    console.error('❌ Error fetching messages:', error.message);
    console.error('Stack:', error.stack);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch messages',
      error: error.message
    });
  }
});

// @route   POST /api/chat/conversations/:conversationId/messages
// @desc    Send a message (REST fallback if WebSocket is not available)
// @access  Private
router.post('/conversations/:conversationId/messages', authenticate, async (req, res) => {
  try {
    console.log('📤 SEND MESSAGE - START');
    console.log('Conversation ID:', req.params.conversationId);
    console.log('Sender ID:', req.userId);
    console.log('Message:', req.body.content);

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
      console.log('❌ Conversation not found');
      return res.status(404).json({
        success: false,
        message: 'Conversation not found'
      });
    }

    // Check if conversation is accepted
    if (conversation.status === 'pending' && !conversation.isAcceptedByPartner) {
      console.log('⚠️ Conversation not accepted yet');
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

    console.log('✅ Message sent successfully');

    res.json({
      success: true,
      data: message
    });
  } catch (error) {
    console.error('❌ Error sending message:', error.message);
    console.error('Stack:', error.stack);
    res.status(500).json({
      success: false,
      message: 'Failed to send message',
      error: error.message
    });
  }
});

// @route   PATCH /api/chat/conversations/:conversationId/read
// @desc    Mark all messages in conversation as read
// @access  Private
router.patch('/conversations/:conversationId/read', authenticate, async (req, res) => {
  try {
    console.log('👁️ MARK AS READ - START');
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

    console.log('✅ Messages marked as read');

    res.json({
      success: true,
      message: 'Messages marked as read'
    });
  } catch (error) {
    console.error('❌ Error marking messages as read:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to mark messages as read',
      error: error.message
    });
  }
});

// @route   PATCH /api/chat/conversations/:conversationId/end
// @desc    End a conversation
// @access  Private
router.patch('/conversations/:conversationId/end', authenticate, async (req, res) => {
  try {
    console.log('🔚 END CONVERSATION - START');
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
        console.log('✅ Partner active conversations decreased to:', partner.activeConversationsCount);
      }
    }

    console.log('✅ Conversation ended');

    res.json({
      success: true,
      data: conversation
    });
  } catch (error) {
    console.error('❌ Error ending conversation:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to end conversation',
      error: error.message
    });
  }
});

// @route   GET /api/chat/unread-count
// @desc    Get total unread message count
// @access  Private
router.get('/unread-count', authenticate, async (req, res) => {
  try {
    console.log('🔔 GET UNREAD COUNT - START');

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

    console.log('✅ Unread count:', totalUnread, 'Pending requests:', pendingRequests);

    res.json({
      success: true,
      data: {
        totalUnread,
        conversationCount: conversations.length,
        pendingRequests: isPartner ? pendingRequests : 0
      }
    });
  } catch (error) {
    console.error('❌ Error fetching unread count:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch unread count',
      error: error.message
    });
  }
});

// @route   GET /api/chat/conversation/:conversationId/astrology
// @desc    Get user's astrology data for a conversation (Partner only)
// @access  Private (Partner only)
router.get('/conversation/:conversationId/astrology', authenticate, async (req, res) => {
  try {
    console.log('🌟 GET ASTROLOGY DATA - START');

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

    console.log('✅ Astrology data retrieved');

    res.json({
      success: true,
      data: {
        conversationId: conversation.conversationId,
        userAstrology: conversation.userAstrologyData,
        user: conversation.userId
      }
    });
  } catch (error) {
    console.error('❌ Error fetching astrology data:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch astrology data',
      error: error.message
    });
  }
});

export default router;