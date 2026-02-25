import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import Message from '../models/Message.js';
import Conversation from '../models/Conversation.js';
import Partner from '../models/Partner.js';
import User from '../models/User.js';
import ServiceCreditLedger from '../models/ServiceCreditLedger.js';

const JWT_SECRET = process.env.JWT_SECRET;

const activeConnections = new Map();
const socketMetadata = new Map();
const activeVoiceCalls = new Map(); // userId -> conversationId for ongoing voice calls
const voiceCallStartedAt = new Map(); // conversationId -> Date when voice call started

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
          return callback?.({ success: false, message: 'You are already in another voice call' });
        }
        if (existingPeerCall && existingPeerCall !== conversationId) {
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

        // Voice billing + unified ledger (does not depend on chat acceptance)
        try {
          const startTime =
            voiceCallStartedAt.get(conversationId) ||
            conversation.startedAt ||
            new Date(endedAt.getTime() - 60 * 1000); // fallback ~1 min before

          voiceCallStartedAt.delete(conversationId);

          const durationMs = Math.max(0, endedAt.getTime() - startTime.getTime());
          const rawMinutes = durationMs / (1000 * 60);
          const billableMinutes = Math.max(1, Math.ceil(isFinite(rawMinutes) ? rawMinutes : 1));

          const USER_RATE_PER_MIN = parseInt(process.env.CHAT_USER_RATE_PER_MIN, 10) || 4;
          const PARTNER_RATE_PER_MIN = parseInt(process.env.CHAT_PARTNER_RATE_PER_MIN, 10) || 3;

          const userDoc = await User.findById(conversation.userId);
          const partnerDoc = await Partner.findById(conversation.partnerId);

          if (userDoc && partnerDoc) {
            const userPreviousBalance = typeof userDoc.credits === 'number' ? userDoc.credits : 0;
            const partnerPreviousBalance = typeof partnerDoc.credits === 'number' ? partnerDoc.credits : 0;

            const maxDebit = billableMinutes * USER_RATE_PER_MIN;
            const userDebited = Math.min(userPreviousBalance, maxDebit);
            const partnerCredited = billableMinutes * PARTNER_RATE_PER_MIN;

            const userNewBalance = Math.max(0, userPreviousBalance - userDebited);
            const partnerNewBalance = partnerPreviousBalance + partnerCredited;

            userDoc.credits = userNewBalance;
            partnerDoc.credits = partnerNewBalance;
            await userDoc.save();
            await partnerDoc.save();

            await ServiceCreditLedger.findOneAndUpdate(
              { conversationId, serviceType: 'voice' },
              {
                conversationId,
                serviceType: 'voice',
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
                partnerRatePerMinute: PARTNER_RATE_PER_MIN,
                startTime,
                endTime: endedAt
              },
              { upsert: true, new: true }
            );
          }
        } catch (billingErr) {
          console.error('❌ Voice billing / ledger failed:', billingErr.message);
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
