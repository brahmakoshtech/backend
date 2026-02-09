import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import Message from '../models/Message.js';
import Conversation from '../models/Conversation.js';
import Partner from '../models/Partner.js';
import User from '../models/User.js';

const JWT_SECRET = process.env.JWT_SECRET;

// Store active connections: userId -> socketId mapping
const activeConnections = new Map();
// Store socket metadata: socketId -> user info
const socketMetadata = new Map();

/**
 * Setup Chat WebSocket Server
 * @param {http.Server} server - HTTP server instance
 */
export const setupChatWebSocket = (server) => {
  console.log('\n' + '🔧'.repeat(40));
  console.log('🔧 [ChatWebSocket] Setting up Chat WebSocket server...');
  console.log('🔧'.repeat(40) + '\n');
  
  const io = new Server(server, {
    path: '/socket.io/',
    cors: {
      origin: (origin, callback) => {
        // allow ALL origins safely
        callback(null, true);
      },
      credentials: true,
      methods: ['GET', 'POST'],
    },
    allowEIO3: true,
    transports: ['websocket', 'polling'],
    allowUpgrades: true,
  });

  console.log('✅ [ChatWebSocket] Socket.IO server instance created');
  console.log('📝 [ChatWebSocket] Configuration:');
  console.log('   - Path: /socket.io/');
  console.log('   - Transports: websocket, polling');
  console.log('   - CORS: Allow all origins');
  console.log('   - EIO3 Support: Enabled');
  console.log('   - Upgrades: Enabled\n');

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
      console.log('   URL:', socket.handshake.url);
      
      // Log all handshake data
      console.log('\n📦 [AUTH] Handshake Data:');
      console.log('   auth:', JSON.stringify(socket.handshake.auth, null, 2));
      console.log('   query:', JSON.stringify(socket.handshake.query, null, 2));
      
      // Extract token - PRIORITY: query first for better websocket compatibility
      console.log('\n🔍 [AUTH] Attempting to extract token...');
      
      let token = null;
      
      // Priority 1: Query parameters (most reliable for websocket)
      if (socket.handshake.query.token) {
        token = socket.handshake.query.token;
        console.log('   ✅ Token found in query parameter');
      }
      // Priority 2: Auth object
      else if (socket.handshake.auth.token) {
        token = socket.handshake.auth.token;
        console.log('   ✅ Token found in auth object');
      }
      // Priority 3: Authorization header
      else if (socket.handshake.headers.authorization) {
        const authHeader = socket.handshake.headers.authorization;
        token = authHeader.replace(/^Bearer\s+/i, '');
        console.log('   ✅ Token found in authorization header');
      }
      
      // Clean and validate token
      if (token) {
        token = token.trim();
        console.log('   Token length:', token.length);
        console.log('   Token parts:', token.split('.').length, '(should be 3 for JWT)');
        console.log('   Token preview:', token.substring(0, 20) + '...' + token.substring(token.length - 20));
      }
      
      if (!token) {
        console.error('\n❌ [AUTH] FAILED: No token provided');
        console.error('   Available in query?', !!socket.handshake.query.token);
        console.error('   Available in auth?', !!socket.handshake.auth.token);
        console.error('   Available in header?', !!socket.handshake.headers.authorization);
        console.error('='.repeat(80) + '\n');
        return next(new Error('Authentication required'));
      }

      // Verify JWT
      console.log('\n🔐 [AUTH] Verifying JWT token...');
      console.log('   JWT_SECRET configured:', !!JWT_SECRET);
      
      const decoded = jwt.verify(token, JWT_SECRET);
      console.log('   ✅ Token verified successfully');
      console.log('   Decoded payload:', JSON.stringify(decoded, null, 2));
      
      // Extract user info from token
      const userId = decoded.userId || decoded.partnerId;
      const userType = decoded.role;
      
      console.log('\n👤 [AUTH] User Information:');
      console.log('   User ID:', userId);
      console.log('   User Type:', userType);
      
      // Find user in database
      let user;
      if (userType === 'partner') {
        user = await Partner.findById(userId);
        console.log('   Looking up Partner...');
      } else if (userType === 'user') {
        user = await User.findById(userId);
        console.log('   Looking up User...');
      } else {
        console.error('   ❌ Unknown role:', userType);
        return next(new Error('Invalid user role'));
      }
      
      if (!user) {
        console.error('\n❌ [AUTH] FAILED: User not found in database');
        console.error('   User ID:', userId);
        console.error('   User Type:', userType);
        console.error('='.repeat(80) + '\n');
        return next(new Error('User not found'));
      }

      console.log('   ✅ User found:', user.name || user.email);
      
      // Attach user info to socket
      socket.userId = userId;
      socket.userType = userType;
      socket.user = user;

      console.log('\n✅ [AUTH] Authentication successful!');
      console.log('='.repeat(80) + '\n');
      
      next();
    } catch (error) {
      console.error('\n❌ [AUTH] Authentication error');
      console.error('   Error Type:', error.name);
      console.error('   Error Message:', error.message);
      
      if (error.name === 'JsonWebTokenError') {
        console.error('   Reason: Invalid token signature');
        console.error('='.repeat(80) + '\n');
        return next(new Error('Invalid token'));
      } else if (error.name === 'TokenExpiredError') {
        console.error('   Reason: Token expired');
        console.error('   Expired At:', error.expiredAt);
        console.error('='.repeat(80) + '\n');
        return next(new Error('Token expired'));
      }
      
      console.error('   Stack:', error.stack);
      console.error('='.repeat(80) + '\n');
      next(new Error('Authentication failed'));
    }
  });

  // ============ CONNECTION HANDLER ============
  io.on('connection', async (socket) => {
    const { userId, userType, user } = socket;
    
    console.log('\n' + '🎉'.repeat(40));
    console.log(`✅ [${userType.toUpperCase()}] CONNECTION ESTABLISHED`);
    console.log('   User:', user.name || user.email);
    console.log('   Socket ID:', socket.id);
    console.log('   User ID:', userId);
    console.log('🎉'.repeat(40) + '\n');

    // Store connection
    activeConnections.set(userId, socket.id);
    socketMetadata.set(socket.id, { userId, userType, email: user.email });

    // Join user's personal room
    socket.join(`user:${userId}`);
    console.log(`📍 [${userType.toUpperCase()}] Joined room: user:${userId}`);

    // If partner, update online status
    if (userType === 'partner') {
      await Partner.findByIdAndUpdate(userId, {
        onlineStatus: 'online',
        lastOnlineAt: new Date()
      });
      console.log(`🟢 [PARTNER] Status updated to: online`);

      // Broadcast partner online status
      io.emit('partner:status:changed', {
        partnerId: userId,
        status: 'online',
        timestamp: new Date()
      });
      console.log(`📢 [PARTNER] Broadcasted status change to all clients`);
    }

    // Send connection acknowledgment
    socket.emit('connected', {
      success: true,
      userId,
      userType,
      socketId: socket.id,
      timestamp: new Date()
    });
    console.log(`📤 [${userType.toUpperCase()}] Sent connection acknowledgment\n`);

    // ============ EVENT: JOIN CONVERSATION ============
    socket.on('conversation:join', async (data, callback) => {
      console.log(`\n📥 [${userType.toUpperCase()}] Event: conversation:join`);
      console.log('   Data:', JSON.stringify(data, null, 2));
      
      try {
        const { conversationId } = data;

        const conversation = await Conversation.findOne({ conversationId })
          .populate('partnerId', 'name email profilePicture specialization onlineStatus')
          .populate('userId', 'email profile profileImage');

        if (!conversation) {
          console.log(`   ❌ Conversation not found: ${conversationId}`);
          return callback?.({ success: false, message: 'Conversation not found' });
        }

        const hasAccess = userType === 'partner'
          ? conversation.partnerId._id.toString() === userId
          : conversation.userId._id.toString() === userId;

        if (!hasAccess) {
          console.log(`   ❌ Access denied for conversation: ${conversationId}`);
          return callback?.({ success: false, message: 'Access denied' });
        }

        socket.join(`conversation:${conversationId}`);
        console.log(`   ✅ Joined conversation room: conversation:${conversationId}`);

        await Message.updateMany(
          {
            conversationId,
            receiverId: userId,
            isRead: false
          },
          {
            isRead: true,
            readAt: new Date()
          }
        );

        const updateField = userType === 'partner' ? 'unreadCount.partner' : 'unreadCount.user';
        await Conversation.findOneAndUpdate(
          { conversationId },
          { [updateField]: 0 }
        );

        const otherUserId = userType === 'partner' ? conversation.userId._id : conversation.partnerId._id;
        const otherUserSocketId = activeConnections.get(otherUserId.toString());
        
        if (otherUserSocketId) {
          io.to(otherUserSocketId).emit('conversation:user:joined', {
            conversationId,
            userId,
            userType,
            timestamp: new Date()
          });
          console.log(`   ✅ Notified other party`);
        }

        callback?.({
          success: true,
          message: 'Joined conversation successfully',
          conversation: {
            ...conversation.toObject(),
            otherUser: userType === 'partner' ? conversation.userId : conversation.partnerId
          }
        });
        console.log(`   ✅ Success\n`);
      } catch (error) {
        console.error(`   ❌ Error:`, error);
        callback?.({ success: false, message: 'Failed to join conversation' });
      }
    });

    // ============ EVENT: SEND MESSAGE ============
    socket.on('message:send', async (data, callback) => {
      console.log(`\n📥 [${userType.toUpperCase()}] Event: message:send`);
      
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

        const updateData = {
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
        };

        if (conversation.status === 'accepted') {
          updateData.status = 'active';
        }

        await Conversation.findOneAndUpdate({ conversationId }, updateData);

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

          io.to(receiverSocketId).emit('notification:new:message', {
            conversationId,
            message: {
              id: message._id,
              content: content.substring(0, 100),
              senderName: user.name || user.email,
              timestamp: message.createdAt
            }
          });
        }

        callback?.({
          success: true,
          message: message.toObject()
        });
        console.log(`   ✅ Message sent\n`);
      } catch (error) {
        console.error(`   ❌ Error:`, error);
        callback?.({ success: false, message: 'Failed to send message' });
      }
    });

    // ============ EVENT: TYPING INDICATORS ============
    socket.on('typing:start', async (data) => {
      const { conversationId } = data;
      socket.to(`conversation:${conversationId}`).emit('typing:status', {
        conversationId,
        userId,
        userType,
        isTyping: true,
        timestamp: new Date()
      });
    });

    socket.on('typing:stop', async (data) => {
      const { conversationId } = data;
      socket.to(`conversation:${conversationId}`).emit('typing:status', {
        conversationId,
        userId,
        userType,
        isTyping: false,
        timestamp: new Date()
      });
    });

    // ============ DISCONNECT HANDLER ============
    socket.on('disconnect', async () => {
      console.log(`\n❌ [${userType.toUpperCase()}] DISCONNECTED`);
      console.log('   User:', user.email || user.name);
      console.log('   Socket ID:', socket.id);

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
        console.log(`   ✅ Status updated to offline\n`);
      }
    });

    // ============ ERROR HANDLER ============
    socket.on('error', (error) => {
      console.error(`\n❌ [${userType.toUpperCase()}] Socket error:`, error);
    });
  });

  console.log('\n✅ Chat WebSocket server initialized successfully');
  console.log('📝 Listening on: /socket.io/');
  console.log('📝 Debug logging: ENABLED\n');

  return io;
};

// Export active connections for external use
export const getActiveConnections = () => activeConnections;
export const getSocketMetadata = () => socketMetadata;
