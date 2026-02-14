import express from 'express';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import Message from '../models/Message.js';
import Conversation from '../models/Conversation.js';
import ConversationSession from '../models/ConversationSession.js';
import ChatCreditLedger from '../models/ChatCreditLedger.js';
import Partner from '../models/Partner.js';
import User from '../models/User.js';
import astrologyService from '../services/astrologyService.js';
import numerologyService from '../services/numerologyService.js';
import doshaService from '../services/doshaService.js';
import remedyService from '../services/remedyService.js';
import panchangService from '../services/panchangService.js';
import { generateConversationSummary } from '../services/geminiService.js';
import { getobject } from '../utils/s3.js';

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
      .select('name email phone profilePicture bio specialization rating totalSessions experience experienceRange expertise expertiseCategory skills languages qualifications consultationModes location totalRatings completedSessions pricePerSession currency onlineStatus activeConversationsCount maxConversations lastActiveAt availabilityPreference')
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

// @route   GET /api/chat/partners/:partnerId
// @desc    Get full partner details (for display in chat sidebar)
// @access  Private
router.get('/partners/:partnerId', authenticate, async (req, res) => {
  try {
    const { partnerId } = req.params;
    const partner = await Partner.findById(partnerId)
      .select('-password -resetPasswordToken -resetPasswordExpires')
      .lean();
    if (!partner || !partner.isActive) {
      return res.status(404).json({ success: false, message: 'Partner not found' });
    }
    const onlineStatus = partner.onlineStatus || 'offline';
    const activeConversationsCount = partner.activeConversationsCount ?? 0;
    const maxConversations = partner.maxConversations || 5;
    res.json({
      success: true,
      data: {
        ...partner,
        status: onlineStatus,
        isBusy: activeConversationsCount >= maxConversations,
        canAcceptConversation: activeConversationsCount < maxConversations
      }
    });
  } catch (error) {
    console.error('❌ Error fetching partner:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch partner',
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

    // If user is starting a chat, ensure they have credits > 0
    if (req.userType === 'user') {
      const user = await User.findById(finalUserId).select('credits email');
      if (!user || (user.credits || 0) <= 0) {
        console.log('❌ User has insufficient credits to start chat:', user?.email);
        return res.status(402).json({
          success: false,
          message: 'Insufficient credits. Please recharge before starting a chat.'
        });
      }
    }

    // Base ID for lookup; new consultations get unique ID with timestamp
    const baseId = [finalPartnerId, finalUserId].sort().join('_');
    console.log('Base conversation ID:', baseId);

    // Check if active/pending conversation already exists (same session)
    let conversation = await Conversation.findOne({
      partnerId: finalPartnerId,
      userId: finalUserId,
      status: { $in: ['pending', 'accepted', 'active'] }
    });

    if (conversation) {
      console.log('ℹ️ Active/pending conversation already exists');
      await conversation.populate('partnerId', 'name email profilePicture specialization rating onlineStatus bio experience expertise languages qualifications location totalSessions completedSessions pricePerSession');
      await conversation.populate('userId', 'email profile profileImage');
      return res.json({
        success: true,
        message: 'Conversation already exists',
        data: conversation
      });
    }

    // For new consultation after ended/rejected: create NEW conversation with unique ID
    const conversationId = `${baseId}_${Date.now()}`;
    console.log('Generated new conversation ID:', conversationId);

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

    await conversation.populate('partnerId', 'name email profilePicture specialization rating onlineStatus bio experience expertise languages qualifications location totalSessions completedSessions pricePerSession');
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

    // Accept conversation - session timing starts from partner acceptance
    const acceptedAt = new Date();
    conversation.status = 'accepted';
    conversation.isAcceptedByPartner = true;
    conversation.acceptedAt = acceptedAt;
    conversation.startedAt = acceptedAt;
    conversation.sessionDetails = {
      ...(conversation.sessionDetails || {}),
      startTime: acceptedAt,
      duration: 0,
      messagesCount: 0,
      creditsUsed: conversation.sessionDetails?.creditsUsed || 0
    };
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
      ? { partnerId: req.userId, status: { $in: ['accepted', 'active', 'ended'] } }
      : { userId: req.userId, status: { $in: ['accepted', 'active', 'pending', 'ended'] } };

    console.log('Query:', JSON.stringify(query));

    const conversations = await Conversation.find(query)
      .sort({ lastMessageAt: -1 })
      .populate('partnerId', 'name email profilePicture specialization rating onlineStatus bio experience expertise languages qualifications location totalSessions completedSessions pricePerSession')
      .populate('userId', 'email profile profileImage')
      .lean();

    console.log(`✅ Found ${conversations.length} conversations`);

    const conversationsData = conversations.map(conv => ({
      ...conv,
      otherUser: isPartner ? conv.userId : conv.partnerId,
      unreadCount: isPartner ? conv.unreadCount.partner : conv.unreadCount.user,
      userAstrology: isPartner ? conv.userAstrologyData : null
    }));

    // Replace S3 keys with presigned URLs for otherUser profile images (bucket is private)
    const conversationsWithPresignedUrls = await Promise.all(
      conversationsData.map(async (conv) => {
        const other = conv.otherUser;
        if (!other) return conv;
        const updated = { ...conv, otherUser: other ? { ...other } : other };
        const otherUser = updated.otherUser;
        if (!otherUser) return updated;
        // Partner: profilePicture may be S3 key — use presigned URL so client can show image
        if (otherUser.profilePicture && !otherUser.profilePicture.startsWith('http')) {
          try {
            const url = await getobject(otherUser.profilePicture);
            otherUser.profilePictureUrl = url;
            otherUser.profilePicture = url; // so img src works without frontend change
          } catch (err) {
            console.error('Error presigned URL for partner profilePicture:', err);
          }
        } else if (otherUser.profilePicture && otherUser.profilePicture.startsWith('http')) {
          otherUser.profilePictureUrl = otherUser.profilePicture;
        }
        // User: profileImage may be S3 key — use presigned URL so client can show image
        if (otherUser.profileImage && !otherUser.profileImage.startsWith('http')) {
          try {
            const url = await getobject(otherUser.profileImage);
            otherUser.profileImageUrl = url;
            otherUser.profileImage = url; // so img src works without frontend change
          } catch (err) {
            console.error('Error presigned URL for user profileImage:', err);
          }
        } else if (otherUser.profileImage && otherUser.profileImage.startsWith('http')) {
          otherUser.profileImageUrl = otherUser.profileImage;
        }
        return updated;
      })
    );

    res.json({
      success: true,
      data: conversationsWithPresignedUrls
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

    const responseData = {
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
    };

    if (conversation.status === 'ended') {
      responseData.sessionDetails = conversation.sessionDetails || null;
      responseData.rating = conversation.rating || { byUser: {}, byPartner: {} };
    }

    res.json({
      success: true,
      data: responseData
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
// @desc    End a conversation (accepts feedback in body for single-call flow)
// @access  Private
router.patch('/conversations/:conversationId/end', authenticate, async (req, res) => {
  try {
    console.log('🔚 END CONVERSATION - START');
    const { conversationId } = req.params;
    const { stars, feedback, satisfaction } = req.body || {};

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
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const endTime = new Date();

    const totalMessages = await Message.countDocuments({
      conversationId,
      isDeleted: false
    });

    const startTime = conversation.acceptedAt || conversation.sessionDetails?.startTime || conversation.startedAt || conversation.createdAt;
    const rawMinutes = startTime ? (endTime - new Date(startTime)) / (1000 * 60) : 0;
    // Billing: per started minute. If accepted and had any activity, minimum 1 minute.
    const billableMinutes = startTime
      ? Math.max((conversation.isAcceptedByPartner ? 1 : 0), Math.ceil(rawMinutes))
      : 0;
    const durationMinutes = billableMinutes;

    // Credit billing rates
    const USER_RATE_PER_MIN = 4;
    const PARTNER_RATE_PER_MIN = 3;

    conversation.status = 'ended';
    conversation.endedAt = endTime;
    // Compute credits: user pays 4/min, partner earns 3/min (proportional to actual debit)
    const user = await User.findById(conversation.userId).select('credits email profile');
    const partner = await Partner.findById(conversation.partnerId).select('creditsEarnedTotal creditsEarnedBalance email name');

    const userPreviousBalance = user?.credits || 0;
    const intendedUserDebit = billableMinutes * USER_RATE_PER_MIN;
    const userDebited = Math.min(userPreviousBalance, intendedUserDebit);
    const userNewBalance = Math.max(0, userPreviousBalance - userDebited);

    const partnerPreviousBalance = partner?.creditsEarnedBalance || 0;
    // Partner always earns full 3 credits per billable minute
    const partnerCredited = billableMinutes * PARTNER_RATE_PER_MIN;
    const partnerNewBalance = partnerPreviousBalance + partnerCredited;
    const partnerNewTotal = (partner?.creditsEarnedTotal || 0) + partnerCredited;

    if (user) {
      user.credits = userNewBalance;
      await user.save();
    }
    if (partner) {
      partner.creditsEarnedBalance = partnerNewBalance;
      partner.creditsEarnedTotal = partnerNewTotal;
      await partner.save();
    }

    conversation.sessionDetails = {
      duration: durationMinutes,
      messagesCount: totalMessages,
      startTime,
      endTime,
      creditsUsed: userDebited,
      partnerCreditsEarned: partnerCredited,
      userRatePerMinute: USER_RATE_PER_MIN,
      partnerRatePerMinute: PARTNER_RATE_PER_MIN
    };

    if (stars !== undefined || feedback !== undefined || satisfaction !== undefined) {
      const target = isPartner ? conversation.rating.byPartner : conversation.rating.byUser;
      if (stars !== undefined) {
        const n = Number(stars);
        if (!Number.isNaN(n) && n >= 0 && n <= 5) target.stars = n;
      }
      if (feedback !== undefined) target.feedback = String(feedback).trim() || null;
      if (satisfaction !== undefined) target.satisfaction = satisfaction || null;
      target.ratedAt = new Date();
    }

    await conversation.save();

    // Store billing ledger (fast audit)
    await ChatCreditLedger.findOneAndUpdate(
      { conversationId },
      {
        conversationId,
        userId: conversation.userId,
        partnerId: conversation.partnerId,
        billableMinutes,
        userDebited,
        partnerCredited,
        userPreviousBalance,
        userNewBalance,
        partnerPreviousBalance,
        partnerNewBalance,
        userRatePerMinute: USER_RATE_PER_MIN,
        partnerRatePerMinute: PARTNER_RATE_PER_MIN
      },
      { upsert: true, new: true }
    );

    if (isPartner) {
      const partner = await Partner.findById(req.userId);
      if (partner.activeConversationsCount > 0) {
        partner.activeConversationsCount -= 1;
        await partner.updateBusyStatus();
      }
    }

    await ConversationSession.findOneAndUpdate(
      { conversationId },
      {
        conversationId,
        partnerId: conversation.partnerId,
        userId: conversation.userId,
        startTime: conversation.sessionDetails.startTime,
        endTime,
        duration: durationMinutes,
        messagesCount: totalMessages,
        creditsUsed: conversation.sessionDetails.creditsUsed || 0,
        rating: conversation.rating
      },
      { upsert: true, new: true }
    );

    // Generate conversation summary via Gemini (topics discussed) and save to DB
    let summary = null;
    try {
      const messagesForSummary = await Message.find({ conversationId, isDeleted: false })
        .sort({ createdAt: 1 })
        .select('content senderModel')
        .lean();
      const userDoc = await User.findById(conversation.userId).select('clientId').lean();
      const userClientId = userDoc?.clientId || null;
      summary = await generateConversationSummary(messagesForSummary, userClientId);
      if (summary) {
        conversation.sessionDetails = conversation.sessionDetails || {};
        conversation.sessionDetails.summary = summary;
        await conversation.save();
        await ConversationSession.findOneAndUpdate(
          { conversationId },
          { summary }
        );
      }
    } catch (summaryErr) {
      console.warn('Conversation summary generation failed:', summaryErr.message);
    }

    const data = conversation.toObject ? conversation.toObject() : conversation;
    const sessionDetailsOut = { ...conversation.sessionDetails };
    if (summary) sessionDetailsOut.summary = summary;
    res.json({
      success: true,
      data: {
        ...data,
        sessionDetails: sessionDetailsOut,
        rating: conversation.rating
      }
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

// @route   PATCH /api/chat/conversations/:conversationId/feedback
// @desc    Submit rating/feedback for a conversation (user or partner)
// @access  Private
router.patch('/conversations/:conversationId/feedback', authenticate, async (req, res) => {
  try {
    console.log('📝 FEEDBACK - START');
    const { conversationId } = req.params;
    const { stars, feedback, satisfaction } = req.body;

    const conversation = await Conversation.findOne({ conversationId });
    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: 'Conversation not found'
      });
    }

    const isPartner = req.userType === 'partner';

    // Ensure the caller belongs to this conversation
    const hasAccess = isPartner
      ? conversation.partnerId.toString() === req.userId
      : conversation.userId.toString() === req.userId;

    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const target = isPartner ? conversation.rating.byPartner : conversation.rating.byUser;
    const previousStars = target.stars;

    if (stars !== undefined) {
      const n = Number(stars);
      if (!Number.isNaN(n) && n >= 0 && n <= 5) {
        target.stars = n;
      }
    }

    if (feedback !== undefined) {
      target.feedback = feedback;
    }

    if (satisfaction !== undefined) {
      target.satisfaction = satisfaction;
    }

    target.ratedAt = new Date();

    await conversation.save();

    // If user rated partner for the first time, update partner aggregate rating
    if (!isPartner && stars !== undefined) {
      const n = Number(stars);
      if (!Number.isNaN(n) && n >= 0 && n <= 5 && (previousStars == null)) {
        const partner = await Partner.findById(conversation.partnerId);
        if (partner) {
          const oldTotal = partner.totalRatings || 0;
          const oldAvg = partner.rating || 0;
          const newTotal = oldTotal + 1;
          const newAvg = newTotal > 0 ? ((oldAvg * oldTotal + n) / newTotal) : n;
          partner.totalRatings = newTotal;
          partner.rating = newAvg;
          await partner.save();
        }
      }
    }

    res.json({
      success: true,
      data: conversation.rating
    });
  } catch (error) {
    console.error('❌ Error saving feedback:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to save feedback',
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

// @route   GET /api/chat/credits/history/user
// @desc    Get paginated chat credit history for current user
// @access  Private (User)
router.get('/credits/history/user', authenticate, async (req, res) => {
  try {
    if (req.userType !== 'user') {
      return res.status(403).json({ success: false, message: 'Only users can access this endpoint' });
    }
    const page = Math.max(parseInt(req.query.page || '1', 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || '20', 10), 1), 100);
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      ChatCreditLedger.find({ userId: req.userId })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('partnerId', 'name email profilePicture')
        .lean(),
      ChatCreditLedger.countDocuments({ userId: req.userId })
    ]);

    const data = items.map((entry) => ({
      conversationId: entry.conversationId,
      billableMinutes: entry.billableMinutes,
      creditsUsed: entry.userDebited,
      createdAt: entry.createdAt,
      partner: entry.partnerId
    }));

    res.json({
      success: true,
      data,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('❌ Error fetching user credit history:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch credit history',
      error: error.message
    });
  }
});

// @route   GET /api/chat/credits/history/partner
// @desc    Get paginated chat earnings history for current partner
// @access  Private (Partner)
router.get('/credits/history/partner', authenticate, async (req, res) => {
  try {
    if (req.userType !== 'partner') {
      return res.status(403).json({ success: false, message: 'Only partners can access this endpoint' });
    }
    const page = Math.max(parseInt(req.query.page || '1', 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || '20', 10), 1), 100);
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      ChatCreditLedger.find({ partnerId: req.userId })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('userId', 'email profile profileImage')
        .lean(),
      ChatCreditLedger.countDocuments({ partnerId: req.userId })
    ]);

    const data = items.map((entry) => ({
      conversationId: entry.conversationId,
      billableMinutes: entry.billableMinutes,
      creditsEarned: entry.partnerCredited,
      createdAt: entry.createdAt,
      user: entry.userId
    }));

    res.json({
      success: true,
      data,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('❌ Error fetching partner credit history:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch credit history',
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

// @route   GET /api/chat/conversation/:conversationId/complete-user-details
// @desc    Get complete user data: astrology, numerology, doshas, remedies, panchang (Partner only)
// @access  Private (Partner only)
router.get('/conversation/:conversationId/complete-user-details', authenticate, async (req, res) => {
  try {
    if (req.userType !== 'partner') {
      return res.status(403).json({ success: false, message: 'Only partners can view this data' });
    }

    const { conversationId } = req.params;
    const conversation = await Conversation.findOne({ conversationId })
      .populate('userId', 'email profile profileImage clientId liveLocation');

    if (!conversation || conversation.partnerId.toString() !== req.userId) {
      return res.status(404).json({ success: false, message: 'Conversation not found' });
    }

    const user = await User.findById(conversation.userId._id)
      .select('-password')
      .populate('clientId', 'clientId businessName')
      .lean();

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const result = {
      user: { _id: user._id, email: user.email, profile: user.profile, profileImage: user.profileImage },
      birthDetails: conversation.userAstrologyData || user.profile,
      astrology: null,
      numerology: null,
      doshas: null,
      dashas: null,
      remedies: null,
      panchang: null,
      errors: {}
    };

    const hasBirthDetails = user.profile?.dob && user.profile?.timeOfBirth;
    const hasLocation = (user.liveLocation?.latitude != null) && (user.liveLocation?.longitude != null);

    if (hasBirthDetails) {
      const profileWithLocation = {
        ...user.profile,
        latitude: user.liveLocation?.latitude ?? user.profile?.latitude,
        longitude: user.liveLocation?.longitude ?? user.profile?.longitude
      };

      try {
        result.astrology = await astrologyService.getCompleteAstrologyData(user._id, profileWithLocation, false);
      } catch (e) {
        result.errors.astrology = e.message;
      }

      try {
        const doshaData = await doshaService.getAllDoshas(user, { forceRefresh: false });
        result.doshas = doshaData.doshas;
        result.dashas = doshaData.dashas;
      } catch (e) {
        result.errors.doshas = e.message;
      }

      try {
        result.remedies = (await remedyService.getRemedies(user, { forceRefresh: false })).remedies;
      } catch (e) {
        result.errors.remedies = e.message;
      }
    }

    const userName = user.profile?.name || user.profile?.firstName || user.email;
    if (userName) {
      try {
        const today = new Date();
        const date = { day: today.getDate(), month: today.getMonth() + 1, year: today.getFullYear() };
        const numData = await numerologyService.getNumerologyData(user._id, date, userName, user.profile?.dob, false);
        result.numerology = numData.data;
      } catch (e) {
        result.errors.numerology = e.message;
      }
    }

    if (hasLocation) {
      try {
        const today = new Date();
        result.panchang = await panchangService.getCompletePanchangData(
          user._id,
          today.toISOString(),
          user.liveLocation.latitude,
          user.liveLocation.longitude,
          false,
          user.profile || null
        );
      } catch (e) {
        result.errors.panchang = e.message;
      }
    }

    res.json({ success: true, data: result });
  } catch (error) {
    console.error('❌ Complete user details error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch user details',
      error: error.message
    });
  }
});

export default router;