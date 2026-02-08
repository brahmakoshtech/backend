import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import Message from '../models/Message.js';
import Conversation from '../models/Conversation.js';
import Partner from '../models/Partner.js';
import User from '../models/User.js';

const JWT_SECRET = process.env.JWT_SECRET;

const activeConnections = new Map();
const socketMetadata = new Map();

/**
 * Setup Chat WebSocket Server with FIXED CORS and upgrade handling
 */
export const setupChatWebSocket = (server) => {
  console.log('🔧 [ChatWebSocket] Setting up Chat WebSocket server...');
  
  const io = new Server(server, {
    path: '/socket.io/',
    cors: {
      origin: '*', // 🔥 Allow all origins (or specify your Flutter app)
      credentials: true,
      methods: ['GET', 'POST', 'OPTIONS'],
    },
    // 🔥 CRITICAL: Allow WebSocket upgrades
    transports: ['websocket', 'polling'],
    allowUpgrades: true,
    upgradeTimeout: 30000,
    pingTimeout: 60000,
    pingInterval: 25000,
    // 🔥 CRITICAL: Allow EIO=4 (Engine.IO v4)
    allowEIO3: false,
    // 🔥 CRITICAL: Cookie configuration
    cookie: false,
    // 🔥 Increase max HTTP buffer size
    maxHttpBufferSize: 1e8,
  });

  console.log('✅ [ChatWebSocket] Socket.IO server configured');
  console.log('   Path: /socket.io/');
  console.log('   CORS: Enabled for all origins');
  console.log('   Transports: websocket, polling');
  console.log('   Upgrades: Enabled');

  // ============ AUTHENTICATION MIDDLEWARE ============
  io.use(async (socket, next) => {
    console.log('\n' + '='.repeat(80));
    console.log('🔐 [AUTH] New connection attempt');
    console.log('='.repeat(80));
    
    try {
      console.log('📋 [AUTH] Handshake Details:');
      console.log('   Socket ID:', socket.id);
      console.log('   Transport:', socket.conn.transport.name);
      console.log('   Remote Address:', socket.handshake.address);
      
      // Extract token from multiple possible locations
      console.log('\n🔍 [AUTH] Attempting to extract token...');
      
      let token = socket.handshake.auth?.token;
      if (token) {
        console.log('   ✅ Token found in: socket.handshake.auth.token');
      }
      
      // Check query parameters
      if (!token && socket.handshake.query?.token) {
        token = socket.handshake.query.token;
        console.log('   ✅ Token found in: socket.handshake.query.token');
      }
      
      // Check authorization header
      if (!token) {
        const authHeader = socket.handshake.headers.authorization || 
                          socket.handshake.headers.Authorization;
        if (authHeader) {
          token = authHeader.replace(/^Bearer\s+/i, '');
          console.log('   ✅ Token found in: socket.handshake.headers.authorization');
        }
      }
      
      if (!token) {
        console.error('\n❌ [AUTH] FAILED: No token found');
        console.error('   Checked: auth.token, query.token, headers.authorization');
        return next(new Error('Authentication required: No token provided'));
      }

      console.log('\n🔑 [AUTH] Token extracted successfully');
      console.log('   Token preview:', token.substring(0, 30) + '...');
      
      // Verify token
      console.log('\n🔐 [AUTH] Verifying token signature...');
      const decoded = jwt.verify(token, JWT_SECRET);
      console.log('   ✅ Token verified');
      console.log('   User ID:', decoded.userId || decoded.partnerId);
      console.log('   Role:', decoded.role);
      
      let user;
      let userType;
      let userId;

      if (decoded.role === 'partner') {
        const partnerId = decoded.partnerId || decoded.userId;
        user = await Partner.findById(partnerId);
        userType = 'partner';
        userId = partnerId;
        
        if (user) {
          console.log('   ✅ Partner found:', user.email || user.name);
        }
      } else if (decoded.role === 'user') {
        user = await User.findById(decoded.userId);
        userType = 'user';
        userId = decoded.userId;
        
        if (user) {
          console.log('   ✅ User found:', user.email);
        }
      }

      if (!user) {
        console.error('\n❌ [AUTH] FAILED: User not found in database');
        return next(new Error('User not found'));
      }

      // Attach user info to socket
      socket.userId = userId;
      socket.userType = userType;
      socket.user = user;

      console.log('\n✅ [AUTH] Authentication successful!');
      console.log('   User ID:', userId);
      console.log('   User Type:', userType);
      console.log('='.repeat(80) + '\n');
      
      next();
    } catch (error) {
      console.error('\n❌ [AUTH] Authentication error');
      console.error('   Error:', error.message);
      
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
    
    console.log('\n🎉 CONNECTION ESTABLISHED');
    console.log('   User:', user.name || user.email);
    console.log('   Type:', userType);
    console.log('   Socket ID:', socket.id);
    console.log('   Transport:', socket.conn.transport.name);

    // Store connection
    activeConnections.set(userId.toString(), socket.id);
    socketMetadata.set(socket.id, { userId, userType, user });

    // Send connection success event
    socket.emit('connection:success', {
      message: 'Connected successfully',
      userId,
      userType,
      socketId: socket.id,
      timestamp: new Date()
    });

    // Update partner status if partner
    if (userType === 'partner') {
      await Partner.findByIdAndUpdate(userId, {
        onlineStatus: 'online',
        lastActiveAt: new Date()
      });

      io.emit('partner:status:changed', {
        partnerId: userId,
        status: 'online',
        timestamp: new Date()
      });
    }

    // ============ EVENT: JOIN CONVERSATION ============
    socket.on('conversation:join', async (data, callback) => {
      console.log(`\n📥 [${userType.toUpperCase()}] Event: conversation:join`);
      console.log('   Data:', data);
      
      try {
        const { conversationId } = data;
        
        const conversation = await Conversation.findOne({ conversationId });
        
        if (!conversation) {
          callback?.({ success: false, message: 'Conversation not found' });
          return;
        }

        // Verify user is part of conversation
        const isUserParticipant = conversation.userId.toString() === userId;
        const isPartnerParticipant = conversation.partnerId.toString() === userId;
        
        if (!isUserParticipant && !isPartnerParticipant) {
          callback?.({ success: false, message: 'Access denied' });
          return;
        }

        socket.join(`conversation:${conversationId}`);
        console.log(`   ✅ Joined room: conversation:${conversationId}`);

        callback?.({
          success: true,
          message: 'Joined conversation room',
          conversationId
        });
      } catch (error) {
        console.error(`   ❌ Error joining conversation:`, error);
        callback?.({ success: false, message: 'Failed to join conversation' });
      }
    });

    // ============ EVENT: SEND MESSAGE ============
    socket.on('message:send', async (data, callback) => {
      console.log(`\n📥 [${userType.toUpperCase()}] Event: message:send`);
      
      try {
        const { conversationId, messageType, content, mediaUrl } = data;

        const conversation = await Conversation.findOne({ conversationId });
        
        if (!conversation) {
          callback?.({ success: false, message: 'Conversation not found' });
          return;
        }

        // Determine sender and receiver
        const isPartner = userType === 'partner';
        const senderId = userId;
        const receiverId = isPartner ? conversation.userId : conversation.partnerId;
        const senderModel = isPartner ? 'Partner' : 'User';
        const receiverModel = isPartner ? 'User' : 'Partner';

        // Create message
        const message = await Message.create({
          conversationId,
          senderId,
          receiverId,
          senderModel,
          receiverModel,
          messageType,
          content,
          mediaUrl,
          isDelivered: false
        });

        await message.populate('senderId', 'name email profilePicture profile');

        // Update conversation
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
            },
            ...(conversation.status === 'accepted' && { status: 'active' })
          }
        );

        // Emit to conversation room
        io.to(`conversation:${conversationId}`).emit('message:new', {
          message: message.toObject(),
          conversationId
        });

        // Check if receiver is online
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

        callback?.({
          success: true,
          message: message.toObject()
        });
      } catch (error) {
        console.error(`   ❌ Error:`, error);
        callback?.({ success: false, message: 'Failed to send message' });
      }
    });

    // ============ DISCONNECT HANDLER ============
    socket.on('disconnect', async () => {
      console.log(`\n❌ [${userType.toUpperCase()}] DISCONNECTED`);
      console.log('   User:', user.email || user.name);

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
  });

  console.log('✅ Chat WebSocket server initialized\n');
  return io;
};

export const getActiveConnections = () => activeConnections;
export const getSocketMetadata = () => socketMetadata;