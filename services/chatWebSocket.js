import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import Message from '../models/Message.js';
import Conversation from '../models/Conversation.js';
import Partner from '../models/Partner.js';
import User from '../models/User.js';

const JWT_SECRET = process.env.JWT_SECRET;

const activeConnections = new Map();
const socketMetadata = new Map();

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
