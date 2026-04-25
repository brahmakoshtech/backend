import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import Message from '../models/Message.js';
import Conversation from '../models/Conversation.js';
import Partner from '../models/Partner.js';
import User from '../models/User.js';
import ServiceCreditLedger from '../models/ServiceCreditLedger.js';
import VoiceCallLog from '../models/VoiceCallLog.js';

const JWT_SECRET = process.env.JWT_SECRET;

const activeConnections = new Map();
const socketMetadata = new Map();
const activeVoiceCalls = new Map();
const voiceCallStartedAt = new Map();
const voiceBillingIntervals = new Map();

const DEFAULT_CHAT_CCR = 0.5;
const DEFAULT_VOICE_CCR = 0.5;
const PARTNER_RATE_PER_MIN = 3;

const getCCRRates = async (clientId) => {
  if (!clientId) return { chatCCR: DEFAULT_CHAT_CCR, voiceCCR: DEFAULT_VOICE_CCR };
  try {
    const { default: Client } = await import('../models/Client.js');
    const client = await Client.findById(clientId).select('settings.chatCCR settings.voiceCCR').lean();
    return {
      chatCCR: client?.settings?.chatCCR ?? DEFAULT_CHAT_CCR,
      voiceCCR: client?.settings?.voiceCCR ?? DEFAULT_VOICE_CCR
    };
  } catch { return { chatCCR: DEFAULT_CHAT_CCR, voiceCCR: DEFAULT_VOICE_CCR }; }
};

// Helper: settle partner earnings when a conversation ends via WebSocket
const settlePartnerEarnings = async (conversationId, serviceType = 'chat') => {
  try {
    const conversation = await Conversation.findOne({ conversationId });
    if (!conversation || !conversation.isAcceptedByPartner) return;

    const endTime = new Date();
    const startTime = conversation.sessionDetails?.startTime || conversation.acceptedAt || conversation.startedAt || conversation.createdAt;
    const rawMinutes = startTime ? (endTime - new Date(startTime)) / (1000 * 60) : 0;
    const billableMinutes = rawMinutes > 0 ? Math.max(1, Math.ceil(rawMinutes)) : 0;
    if (billableMinutes === 0) return;

    const partnerCredited = billableMinutes * PARTNER_RATE_PER_MIN;

    const partner = await Partner.findById(conversation.partnerId);
    if (partner) {
      partner.creditsEarnedBalance = (partner.creditsEarnedBalance || 0) + partnerCredited;
      partner.creditsEarnedTotal = (partner.creditsEarnedTotal || 0) + partnerCredited;
      if (partner.activeConversationsCount > 0) {
        partner.activeConversationsCount -= 1;
      }
      await partner.updateBusyStatus();
    }

    const user = await User.findById(conversation.userId).select('credits');
    const userNewBalance = user?.credits ?? 0;
    const userPreviousBalance = userNewBalance; // already deducted per-message

    await ServiceCreditLedger.findOneAndUpdate(
      { conversationId, serviceType },
      {
        conversationId,
        serviceType,
        userId: conversation.userId,
        partnerId: conversation.partnerId,
        billableMinutes,
        userDebited: 0, // already deducted per-message via chatCCR
        partnerCredited,
        userPreviousBalance,
        userNewBalance,
        partnerPreviousBalance: (partner?.creditsEarnedBalance || 0) - partnerCredited,
        partnerNewBalance: partner?.creditsEarnedBalance || 0,
        userRatePerMinute: 0,
        partnerRatePerMinute: PARTNER_RATE_PER_MIN,
        startTime,
        endTime
      },
      { upsert: true, new: true }
    );

    console.log(`[ChatWebSocket] Partner earnings settled: ${partnerCredited} credits for ${billableMinutes} min (${conversationId})`);
  } catch (err) {
    console.error('[ChatWebSocket] settlePartnerEarnings error:', err.message);
  }
};

export const setupChatWebSocket = (server) => {
  console.log('\n🔧🔧🔧 [ChatWebSocket] Setting up Chat WebSocket server...\n');
  
  const io = new Server(server, {
    path: '/socket.io/',
    cors: {
      origin: (origin, callback) => {
        callback(null, true);
      },
      credentials: true,
      methods: ['GET', 'POST'],
    },
    allowEIO3: true,
    transports: ['websocket', 'polling'],
    allowUpgrades: true,
    pingTimeout: 20000,
    pingInterval: 25000,
  });

  console.log('✅ [ChatWebSocket] Socket.IO server created\n');

  // ============ AUTHENTICATION MIDDLEWARE ============
  io.use(async (socket, next) => {
    console.log('\n' + '='.repeat(80));
    console.log('🔐 [AUTH] New connection attempt');
    console.log('   Transport:', socket.conn.transport.name);
    console.log('   URL:', socket.handshake.url);
    console.log('='.repeat(80));
    
    try {
      console.log('\n📦 Query params:', JSON.stringify(socket.handshake.query, null, 2));
      console.log('📦 Auth object:', JSON.stringify(socket.handshake.auth, null, 2));
      
      // Extract token - QUERY FIRST for WebSocket compatibility
      let token = null;
      
      if (socket.handshake.query.token) {
        token = socket.handshake.query.token;
        console.log('✅ Token from QUERY');
      } else if (socket.handshake.auth.token) {
        token = socket.handshake.auth.token;
        console.log('✅ Token from AUTH');
      } else if (socket.handshake.headers.authorization) {
        token = socket.handshake.headers.authorization.replace(/^Bearer\s+/i, '');
        console.log('✅ Token from HEADER');
      }
      
      if (token) {
        token = token.trim();
        console.log('📏 Token length:', token.length);
        console.log('📏 Token parts:', token.split('.').length);
      }
      
      if (!token) {
        console.error('❌ NO TOKEN FOUND');
        console.error('='.repeat(80) + '\n');
        return next(new Error('Authentication required'));
      }

      console.log('\n🔐 Verifying token...');
      const decoded = jwt.verify(token, JWT_SECRET);
      console.log('✅ Token verified');
      console.log('👤 Payload:', JSON.stringify(decoded, null, 2));
      
      const userId = decoded.userId || decoded.partnerId;
      const userType = decoded.role;
      
      let user;
      if (userType === 'partner') {
        user = await Partner.findById(userId);
      } else if (userType === 'user') {
        user = await User.findById(userId);
      }
      
      if (!user) {
        console.error('❌ USER NOT FOUND IN DB');
        console.error('='.repeat(80) + '\n');
        return next(new Error('User not found'));
      }

      socket.userId = userId;
      socket.userType = userType;
      socket.user = user;

      console.log('✅ Authentication SUCCESS');
      console.log('   User:', user.email || user.name);
      console.log('='.repeat(80) + '\n');
      
      next();
    } catch (error) {
      console.error('❌ Auth error:', error.message);
      console.error('='.repeat(80) + '\n');
      
      if (error.name === 'JsonWebTokenError') {
        return next(new Error('Invalid token'));
      } else if (error.name === 'TokenExpiredError') {
        return next(new Error('Token expired'));
      }
      
      next(new Error('Authentication failed'));
    }
  });

  // ============ CONNECTION HANDLER ============
  io.on('connection', async (socket) => {
    const { userId, userType, user } = socket;
    
    console.log('\n🎉🎉🎉 CONNECTION ESTABLISHED 🎉🎉🎉');
    console.log('User:', user.email || user.name);
    console.log('Type:', userType);
    console.log('Socket:', socket.id);
    console.log('🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉\n');

    activeConnections.set(userId, socket.id);
    socketMetadata.set(socket.id, { userId, userType, email: user.email });

    socket.join(`user:${userId}`);

    if (userType === 'partner') {
      await Partner.findByIdAndUpdate(userId, {
        onlineStatus: 'online',
        lastOnlineAt: new Date()
      });

      io.emit('partner:status:changed', {
        partnerId: userId,
        status: 'online',
        timestamp: new Date()
      });
    }

    socket.emit('connected', {
      success: true,
      userId,
      userType,
      socketId: socket.id,
      timestamp: new Date()
    });

    // ============ EVENT HANDLERS ============

    // Helper: find the other party for a conversation (user ↔ partner)
    const getCallPeer = async (conversationId) => {
      const conversation = await Conversation.findOne({ conversationId })
        .populate('partnerId', 'name email profilePicture onlineStatus status')
        .populate('userId', 'email profile profileImage');

      if (!conversation) {
        return { error: 'Conversation not found' };
      }

      const isCallerPartner = userType === 'partner';
      const peerDoc = isCallerPartner ? conversation.userId : conversation.partnerId;

      if (!peerDoc) {
        return { error: 'Peer not found for this conversation' };
      }

      return {
        conversation,
        peerId: peerDoc._id.toString(),
        peerInfo: {
          id: peerDoc._id,
          name: peerDoc.name || peerDoc.profile?.name || peerDoc.email,
          email: peerDoc.email,
          profilePicture: peerDoc.profilePicture || peerDoc.profileImage || null,
          onlineStatus: peerDoc.onlineStatus || peerDoc.status || null
        }
      };
    };

    socket.on('conversation:join', async (data, callback) => {
      console.log(`📥 [${userType}] conversation:join`);
      
      try {
        const { conversationId } = data;

        const conversation = await Conversation.findOne({ conversationId })
          .populate('partnerId', 'name email profilePicture specialization onlineStatus')
          .populate('userId', 'email profile profileImage');

        if (!conversation) {
          return callback?.({ success: false, message: 'Conversation not found' });
        }

        const hasAccess = userType === 'partner'
          ? conversation.partnerId._id.toString() === userId
          : conversation.userId._id.toString() === userId;

        if (!hasAccess) {
          return callback?.({ success: false, message: 'Access denied' });
        }

        socket.join(`conversation:${conversationId}`);

        await Message.updateMany(
          { conversationId, receiverId: userId, isRead: false },
          { isRead: true, readAt: new Date() }
        );

        const updateField = userType === 'partner' ? 'unreadCount.partner' : 'unreadCount.user';
        await Conversation.findOneAndUpdate(
          { conversationId },
          { [updateField]: 0 }
        );

        callback?.({
          success: true,
          message: 'Joined successfully',
          conversation: conversation.toObject()
        });
      } catch (error) {
        console.error('Error:', error);
        callback?.({ success: false, message: 'Failed to join' });
      }
    });

    socket.on('message:send', async (data, callback) => {
      console.log(`📥 [${userType}] message:send`);
      
      try {
        const { conversationId, content, messageType = 'text', mediaUrl = null } = data;

        if (!content || !conversationId) {
          return callback?.({ success: false, message: 'Missing required fields' });
        }

        const conversation = await Conversation.findOne({ conversationId });
        if (!conversation) {
          return callback?.({ success: false, message: 'Conversation not found' });
        }

        const isPartner = userType === 'partner';

        // Credit deduction: only user pays per message
        if (!isPartner) {
          const userDoc = await User.findById(userId);
          if (!userDoc || userDoc.credits <= 0) {
            await Conversation.findOneAndUpdate({ conversationId }, { status: 'ended', endedAt: new Date() });
            const partnerSocketId = activeConnections.get(conversation.partnerId.toString());
            const autoEndPayload = { conversationId, reason: 'insufficient_credits', remainingBalance: 0 };
            socket.emit('chat:auto_ended', autoEndPayload);
            if (partnerSocketId) io.to(partnerSocketId).emit('chat:auto_ended', autoEndPayload);
            await settlePartnerEarnings(conversationId, 'chat');
            return callback?.({ success: false, message: 'Insufficient credits. Chat ended.' });
          }
          const { chatCCR } = await getCCRRates(userDoc.clientId);
          const newBalance = Math.max(0, userDoc.credits - chatCCR);
          userDoc.credits = newBalance;
          await userDoc.save();

          socket.emit('credit:update', {
            conversationId,
            creditsDeducted: chatCCR,
            remainingBalance: newBalance,
            type: 'chat_message'
          });

          if (newBalance <= 0) {
            await Conversation.findOneAndUpdate({ conversationId }, { status: 'ended', endedAt: new Date() });
            const partnerSocketId = activeConnections.get(conversation.partnerId.toString());
            const autoEndPayload = { conversationId, reason: 'insufficient_credits', remainingBalance: 0 };
            socket.emit('chat:auto_ended', autoEndPayload);
            if (partnerSocketId) io.to(partnerSocketId).emit('chat:auto_ended', autoEndPayload);
            await settlePartnerEarnings(conversationId, 'chat');
          }
        }

        const senderId = userId;
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
          mediaUrl,
          isDelivered: false
        });

        await message.populate('senderId', 'name email profilePicture profile');

        await Conversation.findOneAndUpdate(
          { conversationId },
          {
            lastMessageAt: new Date(),
            lastMessage: {
              content,
              senderId,
              senderModel,
              createdAt: message.createdAt
            },
            $inc: {
              [`unreadCount.${isPartner ? 'user' : 'partner'}`]: 1,
              'sessionDetails.messagesCount': 1
            }
          }
        );

        io.to(`conversation:${conversationId}`).emit('message:new', {
          message: message.toObject(),
          conversationId
        });

        const receiverSocketId = activeConnections.get(receiverId.toString());
        if (receiverSocketId) {
          message.isDelivered = true;
          message.deliveredAt = new Date();
          await message.save();

          socket.emit('message:delivered', {
            messageId: message._id,
            conversationId,
            deliveredAt: message.deliveredAt
          });
        }

        callback?.({ success: true, message: message.toObject() });
      } catch (error) {
        console.error('Error:', error);
        callback?.({ success: false, message: 'Failed to send' });
      }
    });

    socket.on('typing:start', (data) => {
      const { conversationId } = data;
      socket.to(`conversation:${conversationId}`).emit('typing:status', {
        conversationId,
        userId,
        userType,
        isTyping: true,
        timestamp: new Date()
      });
    });

    socket.on('typing:stop', (data) => {
      const { conversationId } = data;
      socket.to(`conversation:${conversationId}`).emit('typing:status', {
        conversationId,
        userId,
        userType,
        isTyping: false,
        timestamp: new Date()
      });
    });

    // ============ VOICE CALL SIGNALING ============

    // Caller starts a voice call for an existing conversation
    socket.on('voice:call:initiate', async (data, callback) => {
      console.log(`📞 [${userType}] voice:call:initiate`, data);

      try {
        const { conversationId } = data || {};
        if (!conversationId) {
          return callback?.({ success: false, message: 'conversationId is required' });
        }

        const { conversation, peerId, peerInfo, error } = await getCallPeer(conversationId);
        if (error) {
          return callback?.({ success: false, message: error });
        }

        // Ensure caller belongs to this conversation
        const isCallerPartner = userType === 'partner';
        const hasAccess = isCallerPartner
          ? conversation.partnerId?._id?.toString() === userId
          : conversation.userId?._id?.toString() === userId;

        if (!hasAccess) {
          return callback?.({ success: false, message: 'Access denied for this conversation' });
        }

        // Prevent multiple simultaneous voice calls per participant
        const callerKey = userId.toString();
        const peerKey = peerId;
        const existingCallerCall = activeVoiceCalls.get(callerKey);
        const existingPeerCall = activeVoiceCalls.get(peerKey);
        if (existingCallerCall && existingCallerCall !== conversationId) {
          await VoiceCallLog.findOneAndUpdate(
            { conversationId },
            {
              conversationId,
              userId: conversation.userId?._id || conversation.userId,
              partnerId: conversation.partnerId?._id || conversation.partnerId,
              status: 'busy',
              initiatedBy: { id: userId, type: userType },
              from: { id: userId, type: userType, name: user.email || user.name, email: user.email || null },
              to: { id: peerId, type: userType === 'partner' ? 'user' : 'partner', name: peerInfo?.name || null, email: peerInfo?.email || null },
              initiatedAt: new Date()
            },
            { upsert: true, new: true }
          );
          return callback?.({ success: false, message: 'You are already in another voice call' });
        }
        if (existingPeerCall && existingPeerCall !== conversationId) {
          await VoiceCallLog.findOneAndUpdate(
            { conversationId },
            {
              conversationId,
              userId: conversation.userId?._id || conversation.userId,
              partnerId: conversation.partnerId?._id || conversation.partnerId,
              status: 'busy',
              initiatedBy: { id: userId, type: userType },
              from: { id: userId, type: userType, name: user.email || user.name, email: user.email || null },
              to: { id: peerId, type: userType === 'partner' ? 'user' : 'partner', name: peerInfo?.name || null, email: peerInfo?.email || null },
              initiatedAt: new Date()
            },
            { upsert: true, new: true }
          );
          return callback?.({ success: false, message: 'Peer is currently busy in another call' });
        }

        // Basic credit check for user before starting call
        if (conversation.userId?.credits !== undefined) {
          if (conversation.userId.credits <= 0) {
            return callback?.({ success: false, message: 'Insufficient credits to start a voice call' });
          }
        }

        const targetSocketId = activeConnections.get(peerId);
        if (!targetSocketId) {
          return callback?.({ success: false, message: 'Peer is offline' });
        }

        const startedAt = new Date();
        const payload = {
          conversationId,
          from: {
            id: userId,
            type: userType,
            name: user.email || user.name
          },
          to: peerInfo,
          startedAt
        };

        // Track start time for billing
        voiceCallStartedAt.set(conversationId, startedAt);

        // Persist call log (ringing)
        await VoiceCallLog.findOneAndUpdate(
          { conversationId },
          {
            conversationId,
            userId: conversation.userId?._id || conversation.userId,
            partnerId: conversation.partnerId?._id || conversation.partnerId,
            status: 'ringing',
            initiatedBy: { id: userId, type: userType },
            from: { id: userId, type: userType, name: user.email || user.name, email: user.email || null },
            to: { id: peerId, type: userType === 'partner' ? 'user' : 'partner', name: peerInfo?.name || null, email: peerInfo?.email || null },
            initiatedAt: startedAt
          },
          { upsert: true, new: true }
        );

        // Mark both participants as being in a voice call for this conversation
        activeVoiceCalls.set(callerKey, conversationId);
        activeVoiceCalls.set(peerKey, conversationId);

        io.to(targetSocketId).emit('voice:call:incoming', payload);

        callback?.({
          success: true,
          message: 'Call initiated',
          call: payload
        });
      } catch (err) {
        console.error('voice:call:initiate error:', err);
        callback?.({ success: false, message: 'Failed to initiate call' });
      }
    });

    // Voice per-second billing helper
    const startVoiceBilling = (conversationId, userIdForBilling, partnerIdForBilling, clientId) => {
      if (voiceBillingIntervals.has(conversationId)) return;
      const interval = setInterval(async () => {
        try {
          const userDoc = await User.findById(userIdForBilling);
          if (!userDoc) return;

          const { voiceCCR } = await getCCRRates(clientId || userDoc.clientId);

          if (userDoc.credits <= 0) {
            clearInterval(interval);
            voiceBillingIntervals.delete(conversationId);
            await Conversation.findOneAndUpdate({ conversationId }, { status: 'ended', endedAt: new Date() });
            const userSocketId = activeConnections.get(userIdForBilling.toString());
            const partnerSocketId = activeConnections.get(partnerIdForBilling.toString());
            const autoEndPayload = { conversationId, reason: 'insufficient_credits', remainingBalance: 0 };
            if (userSocketId) io.to(userSocketId).emit('voice:auto_ended', autoEndPayload);
            if (partnerSocketId) io.to(partnerSocketId).emit('voice:auto_ended', autoEndPayload);
            activeVoiceCalls.delete(userIdForBilling.toString());
            activeVoiceCalls.delete(partnerIdForBilling.toString());
            await settlePartnerEarnings(conversationId, 'voice');
            return;
          }

          const newBalance = Math.max(0, userDoc.credits - voiceCCR);
          userDoc.credits = newBalance;
          await userDoc.save();

          const userSocketId = activeConnections.get(userIdForBilling.toString());
          if (userSocketId) {
            io.to(userSocketId).emit('credit:update', {
              conversationId,
              creditsDeducted: voiceCCR,
              remainingBalance: newBalance,
              type: 'voice_second'
            });
          }

          if (newBalance <= 0) {
            clearInterval(interval);
            voiceBillingIntervals.delete(conversationId);
            await Conversation.findOneAndUpdate({ conversationId }, { status: 'ended', endedAt: new Date() });
            const partnerSocketId = activeConnections.get(partnerIdForBilling.toString());
            const autoEndPayload = { conversationId, reason: 'insufficient_credits', remainingBalance: 0 };
            if (userSocketId) io.to(userSocketId).emit('voice:auto_ended', autoEndPayload);
            if (partnerSocketId) io.to(partnerSocketId).emit('voice:auto_ended', autoEndPayload);
            activeVoiceCalls.delete(userIdForBilling.toString());
            activeVoiceCalls.delete(partnerIdForBilling.toString());
            await settlePartnerEarnings(conversationId, 'voice');
          }
        } catch (err) {
          console.error('Voice billing interval error:', err.message);
        }
      }, 1000);
      voiceBillingIntervals.set(conversationId, interval);
    };

    // Callee accepts the call
    socket.on('voice:call:accept', async (data, callback) => {
      console.log(`📞 [${userType}] voice:call:accept`, data);

      try {
        const { conversationId } = data || {};
        if (!conversationId) {
          return callback?.({ success: false, message: 'conversationId is required' });
        }

        const { conversation, peerId, peerInfo, error } = await getCallPeer(conversationId);
        if (error) {
          return callback?.({ success: false, message: error });
        }

        // Ensure callee belongs to this conversation
        const isCalleePartner = userType === 'partner';
        const hasAccess = isCalleePartner
          ? conversation.partnerId?._id?.toString() === userId
          : conversation.userId?._id?.toString() === userId;

        if (!hasAccess) {
          return callback?.({ success: false, message: 'Access denied for this conversation' });
        }

        // If partner is accepting a still-pending chat request, auto-accept the conversation for chat as well
        if (isCalleePartner && conversation.status === 'pending' && !conversation.isAcceptedByPartner) {
          const partnerDoc = await Partner.findById(userId);
          if (partnerDoc) {
            const activeCount = partnerDoc.activeConversationsCount || 0;
            const maxConversations = partnerDoc.maxConversations || 5;
            if (activeCount >= maxConversations) {
              return callback?.({
                success: false,
                message: 'Maximum concurrent conversations reached. Please end some conversations first.'
              });
            }

            const acceptedAt = new Date();
            conversation.status = 'accepted';
            conversation.isAcceptedByPartner = true;
            conversation.acceptedAt = acceptedAt;
            conversation.startedAt = conversation.startedAt || acceptedAt;
            conversation.sessionDetails = {
              ...(conversation.sessionDetails || {}),
              startTime: conversation.sessionDetails?.startTime || acceptedAt,
              duration: conversation.sessionDetails?.duration || 0,
              messagesCount: conversation.sessionDetails?.messagesCount || 0,
              creditsUsed: conversation.sessionDetails?.creditsUsed || 0
            };
            await conversation.save();

            partnerDoc.activeConversationsCount = activeCount + 1;
            await partnerDoc.updateBusyStatus();
          }
        }

        // Persist call log (accepted)
        await VoiceCallLog.findOneAndUpdate(
          { conversationId },
          {
            status: 'in_call',
            acceptedAt: new Date()
          }
        );

        const callerSocketId = activeConnections.get(peerId);
        if (!callerSocketId) {
          return callback?.({ success: false, message: 'Caller is offline' });
        }

        const payload = {
          conversationId,
          acceptedBy: {
            id: userId,
            type: userType,
            name: user.email || user.name
          },
          peer: peerInfo,
          acceptedAt: new Date()
        };

        io.to(callerSocketId).emit('voice:call:accepted', payload);

        // Start per-second billing when call is accepted
        const convUserId = conversation.userId?._id?.toString() || conversation.userId?.toString();
        const convPartnerId = conversation.partnerId?._id?.toString() || conversation.partnerId?.toString();
        const convUser = await User.findById(convUserId).select('clientId').lean();
        startVoiceBilling(conversationId, convUserId, convPartnerId, convUser?.clientId);

        callback?.({
          success: true,
          message: 'Call accepted',
          call: payload
        });
      } catch (err) {
        console.error('voice:call:accept error:', err);
        callback?.({ success: false, message: 'Failed to accept call' });
      }
    });

    // Callee rejects the call
    socket.on('voice:call:reject', async (data, callback) => {
      console.log(`📞 [${userType}] voice:call:reject`, data);

      try {
        const { conversationId, reason } = data || {};
        if (!conversationId) {
          return callback?.({ success: false, message: 'conversationId is required' });
        }

        const { conversation, peerId, error } = await getCallPeer(conversationId);
        if (error) {
          return callback?.({ success: false, message: error });
        }

        const callerSocketId = activeConnections.get(peerId);
        const payload = {
          conversationId,
          rejectedBy: {
            id: userId,
            type: userType,
            name: user.email || user.name
          },
          reason: reason || null,
          rejectedAt: new Date()
        };

        if (callerSocketId) {
          io.to(callerSocketId).emit('voice:call:rejected', payload);
        }

        // Persist call log (rejected)
        await VoiceCallLog.findOneAndUpdate(
          { conversationId },
          {
            status: 'rejected',
            rejectedAt: payload.rejectedAt,
            rejectedBy: { id: userId, type: userType }
          }
        );

        // Clear active call state for both participants
        if (conversation) {
          const callerKey = peerId;
          const calleeKey = userId.toString();
          activeVoiceCalls.delete(callerKey);
          activeVoiceCalls.delete(calleeKey);
          voiceCallStartedAt.delete(conversationId);
        }

        callback?.({ success: true, message: 'Call rejected' });
      } catch (err) {
        console.error('voice:call:reject error:', err);
        callback?.({ success: false, message: 'Failed to reject call' });
      }
    });

    // Either side ends the call
    socket.on('voice:call:end', async (data, callback) => {
      console.log(`📞 [${userType}] voice:call:end`, data);

      try {
        const { conversationId } = data || {};
        if (!conversationId) {
          return callback?.({ success: false, message: 'conversationId is required' });
        }

        const { conversation, peerId, error } = await getCallPeer(conversationId);
        if (error) {
          return callback?.({ success: false, message: error });
        }

        const peerSocketId = activeConnections.get(peerId);
        const endedAt = new Date();
        const payload = {
          conversationId,
          endedBy: {
            id: userId,
            type: userType,
            name: user.email || user.name
          },
          endedAt
        };

        if (peerSocketId) {
          io.to(peerSocketId).emit('voice:call:ended', payload);
        }

        // Clear active call state for both participants
        if (conversation) {
          const callerKey = peerId;
          const enderKey = userId.toString();
          activeVoiceCalls.delete(callerKey);
          activeVoiceCalls.delete(enderKey);
        }

        // Stop per-second billing interval
        const existingInterval = voiceBillingIntervals.get(conversationId);
        if (existingInterval) {
          clearInterval(existingInterval);
          voiceBillingIntervals.delete(conversationId);
        }

        // Log voice call duration in ledger (credits already deducted per-second)
        let durationSecondsForLog = 0;
        let billableMinutesForLog = 0;
        try {
          const startTime = voiceCallStartedAt.get(conversationId) || conversation.startedAt || new Date(endedAt.getTime() - 1000);
          voiceCallStartedAt.delete(conversationId);
          const durationMs = Math.max(0, endedAt.getTime() - new Date(startTime).getTime());
          durationSecondsForLog = Math.round(durationMs / 1000);
          billableMinutesForLog = Math.ceil(durationSecondsForLog / 60);

          // Get final balances for ledger record
          const userDoc = await User.findById(conversation.userId);
          if (userDoc) {
            const { voiceCCR: ledgerVoiceCCR } = await getCCRRates(userDoc.clientId);
            await ServiceCreditLedger.findOneAndUpdate(
              { conversationId, serviceType: 'voice' },
              {
                conversationId,
                serviceType: 'voice',
                userId: conversation.userId,
                partnerId: conversation.partnerId,
                billableMinutes: billableMinutesForLog,
                userDebited: durationSecondsForLog * ledgerVoiceCCR,
                userNewBalance: userDoc.credits,
                userRatePerMinute: ledgerVoiceCCR * 60,
                startTime,
                endTime: endedAt
              },
              { upsert: true, new: true }
            );
          }
        } catch (billingErr) {
          console.error('❌ Voice ledger failed:', billingErr.message);
        }

        // Persist call log (ended)
        try {
          await VoiceCallLog.findOneAndUpdate(
            { conversationId },
            {
              status: 'ended',
              endedAt,
              endedBy: { id: userId, type: userType },
              durationSeconds: durationSecondsForLog,
              billableMinutes: billableMinutesForLog
            }
          );
        } catch (logErr) {
          console.error('❌ Voice call log update failed:', logErr.message);
        }

        callback?.({ success: true, message: 'Call ended', call: payload });
      } catch (err) {
        console.error('voice:call:end error:', err);
        callback?.({ success: false, message: 'Failed to end call' });
      }
    });

    // Generic WebRTC / RTC signaling relay (offer/answer/ice-candidate, etc.)
    socket.on('voice:signal', async (data) => {
      try {
        const { conversationId, signal } = data || {};
        if (!conversationId || !signal) return;

        const { peerId, error } = await getCallPeer(conversationId);
        if (error) return;

        const peerSocketId = activeConnections.get(peerId);
        if (!peerSocketId) return;

        io.to(peerSocketId).emit('voice:signal', {
          conversationId,
          from: {
            id: userId,
            type: userType
          },
          signal
        });
      } catch (err) {
        console.error('voice:signal error:', err);
      }
    });

    socket.on('disconnect', async () => {
      console.log(`\n❌ [${userType}] DISCONNECTED:`, user.email || user.name, '\n');

      activeConnections.delete(userId);
      socketMetadata.delete(socket.id);

      // Bug Fix: Clear any active voice billing interval on disconnect to prevent memory leak
      for (const [convId, interval] of voiceBillingIntervals.entries()) {
        const conv = await Conversation.findOne({ conversationId: convId }).lean().catch(() => null);
        if (conv) {
          const isParticipant =
            conv.userId?.toString() === userId ||
            conv.partnerId?.toString() === userId;
          if (isParticipant) {
            clearInterval(interval);
            voiceBillingIntervals.delete(convId);
            voiceCallStartedAt.delete(convId);
            activeVoiceCalls.delete(userId);
            console.log(`[ChatWebSocket] Cleared billing interval on disconnect for conv: ${convId}`);
          }
        }
      }

      if (userType === 'partner') {
        await Partner.findByIdAndUpdate(userId, {
          onlineStatus: 'offline',
          lastActiveAt: new Date()
        });

        io.emit('partner:status:changed', {
          partnerId: userId,
          status: 'offline',
          timestamp: new Date()
        });
      }
    });

    socket.on('error', (error) => {
      console.error(`❌ Socket error:`, error);
    });
  });

  console.log('✅ Chat WebSocket initialized\n');
  return io;
};

export const getActiveConnections = () => activeConnections;
export const getSocketMetadata = () => socketMetadata;
