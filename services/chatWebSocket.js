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
  console.log('🔧 [ChatWebSocket] Setting up Chat WebSocket server...');
  
  const io = new Server(server, {
  path: '/socket.io/',
  cors: {
    origin: (origin, callback) => {
      callback(null, true);
    },
    credentials: true,
    methods: ['GET', 'POST'],
  },
  allowEIO3: true,  // Add this
  transports: ['websocket', 'polling'],  // Add this
  allowUpgrades: true,  // Add this
});
  
  

  console.log('🔧 [ChatWebSocket] Socket.IO server instance created');
  console.log('🔧 [ChatWebSocket] CORS origins:', [
    'http://localhost:5173',
    'http://localhost:5174',
    'https://frontend-seven-steel-66.vercel.app',
    'https://backend-jfg8.onrender.com',
    'https://brahmakoshfrontend.vercel.app'
  ]);

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
      
      // Log all handshake data
      console.log('\n📦 [AUTH] Handshake Object:');
      console.log('   auth:', JSON.stringify(socket.handshake.auth, null, 2));
      console.log('   query:', JSON.stringify(socket.handshake.query, null, 2));
      console.log('   headers:', JSON.stringify({
        authorization: socket.handshake.headers.authorization,
        Authorization: socket.handshake.headers.Authorization,
        origin: socket.handshake.headers.origin,
        host: socket.handshake.headers.host
      }, null, 2));
      
      // Extract token from multiple possible locations
      console.log('\n🔍 [AUTH] Attempting to extract token...');
      
      let token = socket.handshake.auth.token;
      if (token) {
        console.log('   ✅ Token found in: socket.handshake.auth.token');
        console.log('   Token preview:', token.substring(0, 50) + '...');
      }
      
      // Check query parameters (for URL-based auth like: ws://...?token=xxx)
      if (!token && socket.handshake.query.token) {
        token = socket.handshake.query.token;
        console.log('   ✅ Token found in: socket.handshake.query.token');
        console.log('   Token preview:', token.substring(0, 50) + '...');
      }
      
      // Check authorization header (case-insensitive)
      if (!token) {
        const authHeader = socket.handshake.headers.authorization || 
                          socket.handshake.headers.Authorization;
        if (authHeader) {
          // Remove 'Bearer ' prefix (case insensitive)
          token = authHeader.replace(/^Bearer\s+/i, '');
          console.log('   ✅ Token found in: socket.handshake.headers.authorization');
          console.log('   Token preview:', token.substring(0, 50) + '...');
        }
      }
      
      if (!token) {
        console.error('\n❌ [AUTH] FAILED: No token found in any location');
        console.error('   Checked locations:');
        console.error('   - socket.handshake.auth.token:', socket.handshake.auth.token ? 'exists' : 'MISSING');
        console.error('   - socket.handshake.query.token:', socket.handshake.query.token ? 'exists' : 'MISSING');
        console.error('   - socket.handshake.headers.authorization:', socket.handshake.headers.authorization ? 'exists' : 'MISSING');
        console.error('\n📝 [AUTH] Full auth object:', socket.handshake.auth);
        console.error('📝 [AUTH] Full query object:', socket.handshake.query);
        console.error('📝 [AUTH] Authorization header:', socket.handshake.headers.authorization);
        console.error('='.repeat(80) + '\n');
        return next(new Error('Authentication required'));
      }

      console.log('\n🔑 [AUTH] Token extracted successfully');
      console.log('   Full token:', token);
      console.log('   Token length:', token.length, 'characters');
      console.log('   Token parts:', token.split('.').length, '(should be 3 for JWT)');
      
      // Decode token first to see what's inside
      console.log('\n🔍 [AUTH] Decoding token...');
      try {
        const decodedPreview = jwt.decode(token);
        console.log('   Decoded token payload:', JSON.stringify(decodedPreview, null, 2));
      } catch (decodeError) {
        console.error('   ⚠️  Failed to decode token:', decodeError.message);
      }
      
      console.log('\n🔐 [AUTH] Verifying token signature...');
      console.log('   Using JWT_SECRET:', JWT_SECRET ? 'SET (length: ' + JWT_SECRET.length + ')' : 'NOT SET');
      
      const decoded = jwt.verify(token, JWT_SECRET);
      console.log('   ✅ Token signature verified successfully');
      console.log('   Decoded payload:', JSON.stringify(decoded, null, 2));
      
      let user;
      let userType;
      let userId;

      console.log('\n👤 [AUTH] Determining user type...');
      console.log('   Role from token:', decoded.role);

      if (decoded.role === 'partner') {
        console.log('   User type: PARTNER');
        const partnerId = decoded.partnerId || decoded.userId;
        console.log('   Looking up partner with ID:', partnerId);
        
        user = await Partner.findById(partnerId);
        userType = 'partner';
        userId = partnerId;
        
        if (user) {
          console.log('   ✅ Partner found:', user.email || user.name);
        } else {
          console.log('   ❌ Partner NOT found in database');
        }
      } else if (decoded.role === 'user') {
        console.log('   User type: USER');
        console.log('   Looking up user with ID:', decoded.userId);
        
        user = await User.findById(decoded.userId);
        userType = 'user';
        userId = decoded.userId;
        
        if (user) {
          console.log('   ✅ User found:', user.email);
          console.log('   User profile:', user.profile?.name || 'No name set');
        } else {
          console.log('   ❌ User NOT found in database');
        }
      } else {
        console.error('   ❌ Unknown role:', decoded.role);
      }

      if (!user) {
        console.error('\n❌ [AUTH] FAILED: User not found in database');
        console.error('   User ID:', userId);
        console.error('   User Type:', userType);
        console.error('='.repeat(80) + '\n');
        return next(new Error('User not found'));
      }

      // Attach user info to socket
      socket.userId = userId;
      socket.userType = userType;
      socket.user = user;

      console.log('\n✅ [AUTH] Authentication successful!');
      console.log('   User ID:', userId);
      console.log('   User Type:', userType);
      console.log('   User Email:', user.email || user.name);
      console.log('='.repeat(80) + '\n');
      
      next();
    } catch (error) {
      console.error('\n❌ [AUTH] Authentication error occurred');
      console.error('   Error type:', error.name);
      console.error('   Error message:', error.message);
      console.error('   Error stack:', error.stack);
      
      if (error.name === 'JsonWebTokenError') {
        console.error('   Reason: Invalid token format or signature');
        console.error('   Solution: Check JWT_SECRET matches the one used to create the token');
        console.error('='.repeat(80) + '\n');
        return next(new Error('Invalid token'));
      } else if (error.name === 'TokenExpiredError') {
        console.error('   Reason: Token has expired');
        console.error('   Expiry:', error.expiredAt);
        console.error('   Solution: Get a new token by logging in again');
        console.error('='.repeat(80) + '\n');
        return next(new Error('Token expired'));
      }
      
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

        // Verify conversation exists and user has access
        const conversation = await Conversation.findOne({ conversationId })
          .populate('partnerId', 'name email profilePicture specialization onlineStatus')
          .populate('userId', 'email profile profileImage');

        if (!conversation) {
          console.log(`   ❌ Conversation not found: ${conversationId}`);
          return callback?.({ success: false, message: 'Conversation not found' });
        }

        // Check access
        const hasAccess = userType === 'partner'
          ? conversation.partnerId._id.toString() === userId
          : conversation.userId._id.toString() === userId;

        if (!hasAccess) {
          console.log(`   ❌ Access denied for conversation: ${conversationId}`);
          return callback?.({ success: false, message: 'Access denied' });
        }

        // Join conversation room
        socket.join(`conversation:${conversationId}`);
        console.log(`   ✅ Joined conversation room: conversation:${conversationId}`);

        // Mark messages as read
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
        console.log(`   ✅ Marked messages as read`);

        // Update unread count
        const updateField = userType === 'partner' ? 'unreadCount.partner' : 'unreadCount.user';
        await Conversation.findOneAndUpdate(
          { conversationId },
          { [updateField]: 0 }
        );
        console.log(`   ✅ Updated unread count`);

        // Notify other party that user joined
        const otherUserId = userType === 'partner' ? conversation.userId._id : conversation.partnerId._id;
        const otherUserSocketId = activeConnections.get(otherUserId.toString());
        
        if (otherUserSocketId) {
          io.to(otherUserSocketId).emit('conversation:user:joined', {
            conversationId,
            userId,
            userType,
            timestamp: new Date()
          });
          console.log(`   ✅ Notified other party (Socket: ${otherUserSocketId})`);
        } else {
          console.log(`   ℹ️  Other party is offline`);
        }

        callback?.({
          success: true,
          message: 'Joined conversation successfully',
          conversation: {
            ...conversation.toObject(),
            otherUser: userType === 'partner' ? conversation.userId : conversation.partnerId
          }
        });
        console.log(`   ✅ Sent success response\n`);
      } catch (error) {
        console.error(`   ❌ Error joining conversation:`, error);
        callback?.({ success: false, message: 'Failed to join conversation' });
      }
    });

    // ============ EVENT: LEAVE CONVERSATION ============
    socket.on('conversation:leave', async (data, callback) => {
      console.log(`\n📥 [${userType.toUpperCase()}] Event: conversation:leave`);
      console.log('   Data:', JSON.stringify(data, null, 2));
      
      try {
        const { conversationId } = data;
        
        socket.leave(`conversation:${conversationId}`);
        console.log(`   ✅ Left conversation room: conversation:${conversationId}`);

        // Notify other party
        socket.to(`conversation:${conversationId}`).emit('conversation:user:left', {
          conversationId,
          userId,
          userType,
          timestamp: new Date()
        });
        console.log(`   ✅ Notified other party`);

        callback?.({ success: true, message: 'Left conversation successfully' });
        console.log(`   ✅ Sent success response\n`);
      } catch (error) {
        console.error(`   ❌ Error leaving conversation:`, error);
        callback?.({ success: false, message: 'Failed to leave conversation' });
      }
    });

    // ============ EVENT: SEND MESSAGE ============
    socket.on('message:send', async (data, callback) => {
      console.log(`\n📥 [${userType.toUpperCase()}] Event: message:send`);
      console.log('   Data:', JSON.stringify(data, null, 2));
      
      try {
        const { conversationId, content, messageType = 'text', mediaUrl = null } = data;

        if (!content || !conversationId) {
          console.log(`   ❌ Missing required fields`);
          return callback?.({ success: false, message: 'Content and conversationId are required' });
        }

        // Get conversation
        const conversation = await Conversation.findOne({ conversationId });

        if (!conversation) {
          console.log(`   ❌ Conversation not found: ${conversationId}`);
          return callback?.({ success: false, message: 'Conversation not found' });
        }

        // Check if conversation is accepted
        if (conversation.status === 'pending' && !conversation.isAcceptedByPartner) {
          console.log(`   ❌ Conversation pending acceptance`);
          return callback?.({ 
            success: false, 
            message: 'Conversation is pending partner acceptance' 
          });
        }

        // Determine sender and receiver
        const isPartner = userType === 'partner';
        const senderId = userId;
        const senderModel = isPartner ? 'Partner' : 'User';
        const receiverId = isPartner ? conversation.userId : conversation.partnerId;
        const receiverModel = isPartner ? 'User' : 'Partner';

        console.log(`   Sender: ${senderModel} (${senderId})`);
        console.log(`   Receiver: ${receiverModel} (${receiverId})`);

        // Create message
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
        console.log(`   ✅ Message created: ${message._id}`);

        // Update conversation
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

        // Activate conversation on first message
        if (conversation.status === 'accepted') {
          updateData.status = 'active';
        }

        await Conversation.findOneAndUpdate({ conversationId }, updateData);
        console.log(`   ✅ Conversation updated`);

        // Emit to conversation room
        io.to(`conversation:${conversationId}`).emit('message:new', {
          message: message.toObject(),
          conversationId
        });
        console.log(`   ✅ Emitted to conversation room`);

        // Check if receiver is online and deliver message
        const receiverSocketId = activeConnections.get(receiverId.toString());
        if (receiverSocketId) {
          // Mark as delivered
          message.isDelivered = true;
          message.deliveredAt = new Date();
          await message.save();

          console.log(`   ✅ Receiver online, marked as delivered`);

          // Notify sender about delivery
          socket.emit('message:delivered', {
            messageId: message._id,
            conversationId,
            deliveredAt: message.deliveredAt
          });

          // Send notification to receiver
          io.to(receiverSocketId).emit('notification:new:message', {
            conversationId,
            message: {
              id: message._id,
              content: content.substring(0, 100),
              senderName: user.name || user.email,
              timestamp: message.createdAt
            }
          });
          console.log(`   ✅ Sent notification to receiver`);
        } else {
          console.log(`   ℹ️  Receiver is offline`);
        }

        callback?.({
          success: true,
          message: message.toObject()
        });
        console.log(`   ✅ Sent success response\n`);
      } catch (error) {
        console.error(`   ❌ Error sending message:`, error);
        callback?.({ success: false, message: 'Failed to send message' });
      }
    });

    // ============ EVENT: TYPING INDICATOR ============
    socket.on('typing:start', async (data) => {
      console.log(`\n📥 [${userType.toUpperCase()}] Event: typing:start`);
      const { conversationId } = data;
      
      socket.to(`conversation:${conversationId}`).emit('typing:status', {
        conversationId,
        userId,
        userType,
        isTyping: true,
        timestamp: new Date()
      });
      console.log(`   ✅ Broadcasted typing status to conversation: ${conversationId}\n`);
    });

    socket.on('typing:stop', async (data) => {
      console.log(`\n📥 [${userType.toUpperCase()}] Event: typing:stop`);
      const { conversationId } = data;
      
      socket.to(`conversation:${conversationId}`).emit('typing:status', {
        conversationId,
        userId,
        userType,
        isTyping: false,
        timestamp: new Date()
      });
      console.log(`   ✅ Broadcasted typing status to conversation: ${conversationId}\n`);
    });

    // ============ EVENT: MESSAGE READ ============
    socket.on('message:read', async (data, callback) => {
      console.log(`\n📥 [${userType.toUpperCase()}] Event: message:read`);
      console.log('   Data:', JSON.stringify(data, null, 2));
      
      try {
        const { conversationId, messageIds } = data;

        if (messageIds && Array.isArray(messageIds)) {
          await Message.updateMany(
            {
              _id: { $in: messageIds },
              receiverId: userId,
              isRead: false
            },
            {
              isRead: true,
              readAt: new Date()
            }
          );
          console.log(`   ✅ Marked ${messageIds.length} specific messages as read`);
        } else {
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
          console.log(`   ✅ Marked all messages as read`);
        }

        // Update conversation unread count
        const updateField = userType === 'partner' ? 'unreadCount.partner' : 'unreadCount.user';
        await Conversation.findOneAndUpdate(
          { conversationId },
          { [updateField]: 0 }
        );

        // Notify sender
        socket.to(`conversation:${conversationId}`).emit('message:read:receipt', {
          conversationId,
          messageIds: messageIds || 'all',
          readBy: userId,
          readAt: new Date()
        });
        console.log(`   ✅ Sent read receipt to sender`);

        callback?.({ success: true, message: 'Messages marked as read' });
        console.log(`   ✅ Sent success response\n`);
      } catch (error) {
        console.error(`   ❌ Error marking messages as read:`, error);
        callback?.({ success: false, message: 'Failed to mark messages as read' });
      }
    });

    // Continue with remaining event handlers (partner status, conversation management, etc.)
    // I'll add the rest in a follow-up due to length...

    // ============ DISCONNECT HANDLER ============
    socket.on('disconnect', async () => {
      console.log(`\n❌ [${userType.toUpperCase()}] DISCONNECTED`);
      console.log('   User:', user.email || user.name);
      console.log('   Socket ID:', socket.id);

      // Remove from active connections
      activeConnections.delete(userId);
      socketMetadata.delete(socket.id);

      // If partner, update status to offline
      if (userType === 'partner') {
        await Partner.findByIdAndUpdate(userId, {
          onlineStatus: 'offline',
          lastActiveAt: new Date()
        });

        // Broadcast partner offline status
        io.emit('partner:status:changed', {
          partnerId: userId,
          status: 'offline',
          timestamp: new Date()
        });
        console.log(`   ✅ Status updated to offline and broadcasted`);
      }
      console.log('');
    });

    // ============ ERROR HANDLER ============
    socket.on('error', (error) => {
      console.error(`\n❌ [${userType.toUpperCase()}] Socket error:`);
      console.error('   User:', user.email || user.name);
      console.error('   Error:', error);
      console.error('');
    });
  });

  console.log('✅ Chat WebSocket server initialized on /socket.io/');
  console.log('📝 Debug logging enabled - all events will be logged to console\n');

  return io;
};

// Export active connections for external use
export const getActiveConnections = () => activeConnections;
export const getSocketMetadata = () => socketMetadata;
