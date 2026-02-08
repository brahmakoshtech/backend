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
// Store typing users: conversationId -> Set of userIds
const typingUsers = new Map();

/**
 * Setup Chat WebSocket Server with Complete Implementation
 * @param {http.Server} server - HTTP server instance
 */
export const setupChatWebSocket = (server) => {
  console.log('🔧 [ChatWebSocket] Setting up Chat WebSocket server...');
  
  const io = new Server(server, {
    path: '/socket.io/',
    cors: {
      origin: '*', // Allow all origins (configure for production)
      credentials: true,
      methods: ['GET', 'POST', 'OPTIONS'],
      allowedHeaders: ['Authorization', 'Content-Type'],
    },
    // Transport configuration
    transports: ['websocket', 'polling'],
    allowUpgrades: true,
    upgradeTimeout: 30000,
    pingTimeout: 60000,
    pingInterval: 25000,
    // Additional configurations
    cookie: false,
    maxHttpBufferSize: 1e8,
    perMessageDeflate: false,
    httpCompression: false,
    // Connection state recovery
    connectionStateRecovery: {
      maxDisconnectionDuration: 2 * 60 * 1000,
      skipMiddlewares: true,
    },
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
      console.log('   User Agent:', socket.handshake.headers['user-agent']?.substring(0, 50) + '...');
      
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
      socket.userId = userId.toString();
      socket.userType = userType;
      socket.user = user;
      socket.userEmail = user.email || user.name;

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
    const { userId, userType, user, userEmail } = socket;
    
    console.log('\n' + '🎉'.repeat(40));
    console.log('✅ [CONNECTION] ESTABLISHED');
    console.log('   User:', userEmail);
    console.log('   Type:', userType);
    console.log('   Socket ID:', socket.id);
    console.log('   Transport:', socket.conn.transport.name);
    console.log('🎉'.repeat(40) + '\n');

    // Store connection
    const previousSocketId = activeConnections.get(userId);
    if (previousSocketId && previousSocketId !== socket.id) {
      console.log(`   ℹ️  Replacing previous connection: ${previousSocketId}`);
      socketMetadata.delete(previousSocketId);
    }
    
    activeConnections.set(userId, socket.id);
    socketMetadata.set(socket.id, { 
      userId, 
      userType, 
      userEmail,
      connectedAt: new Date() 
    });

    // Join user's personal room
    socket.join(`user:${userId}`);
    console.log(`📍 [${userType.toUpperCase()}] Joined personal room: user:${userId}`);

    // Update partner online status
    if (userType === 'partner') {
      await Partner.findByIdAndUpdate(userId, {
        onlineStatus: 'online',
        lastActiveAt: new Date()
      });
      console.log(`🟢 [PARTNER] Status updated to: online`);

      // Broadcast partner online status
      io.emit('partner:status:changed', {
        partnerId: userId,
        status: 'online',
        timestamp: new Date()
      });
      console.log(`📢 [PARTNER] Broadcasted online status to all clients`);
    }

    // Send connection success events
    socket.emit('connection:success', {
      message: 'Connected successfully',
      userId,
      userType,
      socketId: socket.id,
      timestamp: new Date()
    });

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

        if (!conversationId) {
          console.log('   ❌ Missing conversationId');
          return callback?.({ success: false, message: 'conversationId is required' });
        }

        // Fetch conversation with populated data
        const conversation = await Conversation.findOne({ conversationId })
          .populate('partnerId', 'name email profilePicture specialization onlineStatus')
          .populate('userId', 'email profile profileImage');

        if (!conversation) {
          console.log(`   ❌ Conversation not found: ${conversationId}`);
          return callback?.({ success: false, message: 'Conversation not found' });
        }

        // Verify user has access
        const isUserParticipant = conversation.userId._id.toString() === userId;
        const isPartnerParticipant = conversation.partnerId._id.toString() === userId;
        
        if (!isUserParticipant && !isPartnerParticipant) {
          console.log(`   ❌ Access denied for conversation: ${conversationId}`);
          return callback?.({ success: false, message: 'Access denied' });
        }

        // Join conversation room
        socket.join(`conversation:${conversationId}`);
        console.log(`   ✅ Joined conversation room: conversation:${conversationId}`);

        // Mark messages as read
        const readResult = await Message.updateMany(
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
        console.log(`   ✅ Marked ${readResult.modifiedCount} messages as read`);

        // Update unread count
        const updateField = userType === 'partner' ? 'unreadCount.partner' : 'unreadCount.user';
        await Conversation.findOneAndUpdate(
          { conversationId },
          { [updateField]: 0 }
        );
        console.log(`   ✅ Reset unread count for ${userType}`);

        // Notify other party that user joined
        const otherUserId = userType === 'partner' 
          ? conversation.userId._id.toString() 
          : conversation.partnerId._id.toString();
        const otherUserSocketId = activeConnections.get(otherUserId);
        
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
        
        if (!conversationId) {
          return callback?.({ success: false, message: 'conversationId is required' });
        }

        socket.leave(`conversation:${conversationId}`);
        console.log(`   ✅ Left conversation room: conversation:${conversationId}`);

        // Remove from typing users if present
        if (typingUsers.has(conversationId)) {
          const typingSet = typingUsers.get(conversationId);
          typingSet.delete(userId);
          if (typingSet.size === 0) {
            typingUsers.delete(conversationId);
          }
        }

        // Notify other party
        socket.to(`conversation:${conversationId}`).emit('conversation:user:left', {
          conversationId,
          userId,
          userType,
          timestamp: new Date()
        });
        console.log(`   ✅ Notified other party of departure`);

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
        if (conversation.status === 'pending') {
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
        const receiverId = isPartner 
          ? conversation.userId.toString() 
          : conversation.partnerId.toString();
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
          isDelivered: false,
          isRead: false
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
        const receiverSocketId = activeConnections.get(receiverId);
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
          // TODO: Send push notification here
        }

        callback?.({
          success: true,
          message: message.toObject()
        });
        console.log(`   ✅ Sent success response\n`);
      } catch (error) {
        console.error(`   ❌ Error sending message:`, error);
        callback?.({ success: false, message: 'Failed to send message', error: error.message });
      }
    });

    // ============ EVENT: TYPING INDICATORS ============
    socket.on('typing:start', async (data) => {
      console.log(`\n📥 [${userType.toUpperCase()}] Event: typing:start`);
      const { conversationId } = data;
      
      if (!conversationId) {
        console.log('   ❌ Missing conversationId');
        return;
      }

      // Add to typing users
      if (!typingUsers.has(conversationId)) {
        typingUsers.set(conversationId, new Set());
      }
      typingUsers.get(conversationId).add(userId);
      
      socket.to(`conversation:${conversationId}`).emit('typing:status', {
        conversationId,
        userId,
        userType,
        userEmail,
        isTyping: true,
        timestamp: new Date()
      });
      console.log(`   ✅ Broadcasted typing status to conversation: ${conversationId}\n`);
    });

    socket.on('typing:stop', async (data) => {
      console.log(`\n📥 [${userType.toUpperCase()}] Event: typing:stop`);
      const { conversationId } = data;
      
      if (!conversationId) {
        console.log('   ❌ Missing conversationId');
        return;
      }

      // Remove from typing users
      if (typingUsers.has(conversationId)) {
        typingUsers.get(conversationId).delete(userId);
        if (typingUsers.get(conversationId).size === 0) {
          typingUsers.delete(conversationId);
        }
      }
      
      socket.to(`conversation:${conversationId}`).emit('typing:status', {
        conversationId,
        userId,
        userType,
        userEmail,
        isTyping: false,
        timestamp: new Date()
      });
      console.log(`   ✅ Broadcasted typing stop to conversation: ${conversationId}\n`);
    });

    // ============ EVENT: MESSAGE READ ============
    socket.on('message:read', async (data, callback) => {
      console.log(`\n📥 [${userType.toUpperCase()}] Event: message:read`);
      console.log('   Data:', JSON.stringify(data, null, 2));
      
      try {
        const { conversationId, messageIds } = data;

        if (!conversationId) {
          return callback?.({ success: false, message: 'conversationId is required' });
        }

        let updateQuery = {
          conversationId,
          receiverId: userId,
          isRead: false
        };

        if (messageIds && Array.isArray(messageIds) && messageIds.length > 0) {
          updateQuery._id = { $in: messageIds };
        }

        const result = await Message.updateMany(
          updateQuery,
          {
            isRead: true,
            readAt: new Date()
          }
        );
        console.log(`   ✅ Marked ${result.modifiedCount} messages as read`);

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

    // ============ EVENT: GET ONLINE PARTNERS ============
    socket.on('partners:online', async (data, callback) => {
      console.log(`\n📥 [${userType.toUpperCase()}] Event: partners:online`);
      
      try {
        const onlinePartnerIds = [];
        
        for (const [uid, socketId] of activeConnections.entries()) {
          const meta = socketMetadata.get(socketId);
          if (meta && meta.userType === 'partner') {
            onlinePartnerIds.push(uid);
          }
        }

        console.log(`   ✅ Found ${onlinePartnerIds.length} online partners`);

        callback?.({
          success: true,
          onlinePartners: onlinePartnerIds,
          count: onlinePartnerIds.length
        });
      } catch (error) {
        console.error(`   ❌ Error getting online partners:`, error);
        callback?.({ success: false, message: 'Failed to get online partners' });
      }
    });

    // ============ EVENT: UPDATE PARTNER STATUS ============
    socket.on('partner:status:update', async (data, callback) => {
      console.log(`\n📥 [${userType.toUpperCase()}] Event: partner:status:update`);
      
      if (userType !== 'partner') {
        console.log('   ❌ Only partners can update their status');
        return callback?.({ success: false, message: 'Only partners can update status' });
      }

      try {
        const { status } = data; // 'available', 'busy', 'away', 'offline'

        if (!['available', 'busy', 'away', 'offline'].includes(status)) {
          return callback?.({ success: false, message: 'Invalid status' });
        }

        await Partner.findByIdAndUpdate(userId, {
          onlineStatus: status,
          lastActiveAt: new Date()
        });

        // Broadcast status change
        io.emit('partner:status:changed', {
          partnerId: userId,
          status,
          timestamp: new Date()
        });

        console.log(`   ✅ Partner status updated to: ${status}`);

        callback?.({ success: true, status });
      } catch (error) {
        console.error(`   ❌ Error updating partner status:`, error);
        callback?.({ success: false, message: 'Failed to update status' });
      }
    });

    // ============ EVENT: ACCEPT CONVERSATION REQUEST ============
    socket.on('conversation:accept', async (data, callback) => {
      console.log(`\n📥 [${userType.toUpperCase()}] Event: conversation:accept`);
      
      if (userType !== 'partner') {
        return callback?.({ success: false, message: 'Only partners can accept conversations' });
      }

      try {
        const { conversationId } = data;

        const conversation = await Conversation.findOneAndUpdate(
          { conversationId, partnerId: userId, status: 'pending' },
          {
            status: 'accepted',
            isAcceptedByPartner: true,
            acceptedAt: new Date()
          },
          { new: true }
        );

        if (!conversation) {
          return callback?.({ success: false, message: 'Conversation not found or already accepted' });
        }

        // Notify user
        const userSocketId = activeConnections.get(conversation.userId.toString());
        if (userSocketId) {
          io.to(userSocketId).emit('conversation:accepted', {
            conversationId,
            partnerId: userId,
            timestamp: new Date()
          });
        }

        console.log(`   ✅ Conversation accepted: ${conversationId}`);

        callback?.({ success: true, conversation: conversation.toObject() });
      } catch (error) {
        console.error(`   ❌ Error accepting conversation:`, error);
        callback?.({ success: false, message: 'Failed to accept conversation' });
      }
    });

    // ============ EVENT: REJECT CONVERSATION REQUEST ============
    socket.on('conversation:reject', async (data, callback) => {
      console.log(`\n📥 [${userType.toUpperCase()}] Event: conversation:reject`);
      
      if (userType !== 'partner') {
        return callback?.({ success: false, message: 'Only partners can reject conversations' });
      }

      try {
        const { conversationId, reason } = data;

        const conversation = await Conversation.findOneAndUpdate(
          { conversationId, partnerId: userId, status: 'pending' },
          {
            status: 'rejected',
            rejectedAt: new Date(),
            rejectionReason: reason || 'No reason provided'
          },
          { new: true }
        );

        if (!conversation) {
          return callback?.({ success: false, message: 'Conversation not found' });
        }

        // Notify user
        const userSocketId = activeConnections.get(conversation.userId.toString());
        if (userSocketId) {
          io.to(userSocketId).emit('conversation:rejected', {
            conversationId,
            partnerId: userId,
            reason: reason || 'No reason provided',
            timestamp: new Date()
          });
        }

        console.log(`   ✅ Conversation rejected: ${conversationId}`);

        callback?.({ success: true });
      } catch (error) {
        console.error(`   ❌ Error rejecting conversation:`, error);
        callback?.({ success: false, message: 'Failed to reject conversation' });
      }
    });

    // ============ DISCONNECT HANDLER ============
    socket.on('disconnect', async (reason) => {
      console.log(`\n❌ [${userType.toUpperCase()}] DISCONNECTED`);
      console.log('   User:', userEmail);
      console.log('   Socket ID:', socket.id);
      console.log('   Reason:', reason);

      // Remove from active connections
      const currentSocketId = activeConnections.get(userId);
      if (currentSocketId === socket.id) {
        activeConnections.delete(userId);
      }
      socketMetadata.delete(socket.id);

      // Clear typing indicators
      for (const [conversationId, typingSet] of typingUsers.entries()) {
        if (typingSet.has(userId)) {
          typingSet.delete(userId);
          
          // Notify others in conversation
          socket.to(`conversation:${conversationId}`).emit('typing:status', {
            conversationId,
            userId,
            userType,
            isTyping: false,
            timestamp: new Date()
          });
          
          if (typingSet.size === 0) {
            typingUsers.delete(conversationId);
          }
        }
      }

      // Update partner status to offline
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
      
      console.log('   ✅ Cleanup completed\n');
    });

    // ============ ERROR HANDLER ============
    socket.on('error', (error) => {
      console.error(`\n❌ [${userType.toUpperCase()}] Socket error:`);
      console.error('   User:', userEmail);
      console.error('   Socket ID:', socket.id);
      console.error('   Error:', error);
      console.error('');
    });
  });

  // ============ UTILITY FUNCTIONS ============

  /**
   * Send notification to user
   */
  const sendNotification = (userId, event, data) => {
    const socketId = activeConnections.get(userId.toString());
    if (socketId) {
      io.to(socketId).emit(event, data);
      return true;
    }
    return false;
  };

  /**
   * Broadcast to all connected clients
   */
  const broadcast = (event, data) => {
    io.emit(event, data);
  };

  /**
   * Get connection stats
   */
  const getConnectionStats = () => {
    const partners = [];
    const users = [];
    
    for (const [socketId, meta] of socketMetadata.entries()) {
      if (meta.userType === 'partner') {
        partners.push(meta);
      } else {
        users.push(meta);
      }
    }

    return {
      total: activeConnections.size,
      partners: partners.length,
      users: users.length,
      typingConversations: typingUsers.size
    };
  };

  // Log connection stats every 5 minutes
  setInterval(() => {
    const stats = getConnectionStats();
    console.log('\n📊 [STATS] Connection Statistics');
    console.log('   Total Connections:', stats.total);
    console.log('   Partners:', stats.partners);
    console.log('   Users:', stats.users);
    console.log('   Active Typing:', stats.typingConversations);
    console.log('');
  }, 5 * 60 * 1000);

  console.log('✅ Chat WebSocket server initialized on /socket.io/');
  console.log('📝 Debug logging enabled - all events will be logged to console\n');

  return {
    io,
    sendNotification,
    broadcast,
    getConnectionStats
  };
};

// Export active connections for external use
export const getActiveConnections = () => activeConnections;
export const getSocketMetadata = () => socketMetadata;
export const getTypingUsers = () => typingUsers;