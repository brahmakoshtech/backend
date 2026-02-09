// import { Server } from 'socket.io';
// import jwt from 'jsonwebtoken';
// import Message from '../models/Message.js';
// import Conversation from '../models/Conversation.js';
// import User from '../models/User.js';
// import Partner from '../models/Partner.js';

// class SocketService {
//   constructor() {
//     this.io = null;
//     this.connectedUsers = new Map(); // userId/partnerId -> socketId
//     this.userSockets = new Map(); // socketId -> user data
//   }

//   initialize(server) {
//     this.io = new Server(server, {
//       cors: {
//         origin: [
//           'http://localhost:5173',
//           'http://localhost:5174',
//           'https://frontend-seven-steel-66.vercel.app',
//           'https://brahmakoshfrontend.vercel.app'
//         ],
//         credentials: true,
//         methods: ['GET', 'POST']
//       },
//       pingTimeout: 60000,
//       pingInterval: 25000
//     });

//     this.setupMiddleware();
//     this.setupEventHandlers();

//     console.log('✅ Socket.IO initialized successfully');
//   }

//   setupMiddleware() {
//     // Authentication middleware
//     this.io.use(async (socket, next) => {
//       try {
//         const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.split(' ')[1];
        
//         if (!token) {
//           return next(new Error('Authentication token required'));
//         }

//         const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
//         // Fetch user or partner data
//         let userData;
//         if (decoded.role === 'partner') {
//           userData = await Partner.findById(decoded.id).select('name email profilePicture');
//           socket.userType = 'partner';
//         } else {
//           userData = await User.findById(decoded.id).select('email profile profileImage');
//           socket.userType = 'user';
//         }

//         if (!userData) {
//           return next(new Error('User not found'));
//         }

//         socket.userId = decoded.id;
//         socket.userData = userData;
//         socket.role = decoded.role;
        
//         next();
//       } catch (error) {
//         console.error('Socket authentication error:', error);
//         next(new Error('Authentication failed'));
//       }
//     });
//   }

//   setupEventHandlers() {
//     this.io.on('connection', (socket) => {
//       console.log(`✅ User connected: ${socket.userId} (${socket.userType})`);
      
//       // Store connected user
//       this.connectedUsers.set(socket.userId, socket.id);
//       this.userSockets.set(socket.id, {
//         userId: socket.userId,
//         userType: socket.userType,
//         userData: socket.userData
//       });

//       // Notify user is online
//       this.handleUserOnline(socket);

//       // Join personal room
//       socket.join(`user_${socket.userId}`);

//       // Event handlers
//       socket.on('join_conversation', (data) => this.handleJoinConversation(socket, data));
//       socket.on('send_message', (data) => this.handleSendMessage(socket, data));
//       socket.on('typing_start', (data) => this.handleTypingStart(socket, data));
//       socket.on('typing_stop', (data) => this.handleTypingStop(socket, data));
//       socket.on('message_read', (data) => this.handleMessageRead(socket, data));
//       socket.on('message_delivered', (data) => this.handleMessageDelivered(socket, data));
//       socket.on('get_conversations', () => this.handleGetConversations(socket));
//       socket.on('get_messages', (data) => this.handleGetMessages(socket, data));

//       // Disconnect handler
//       socket.on('disconnect', () => this.handleDisconnect(socket));
//     });
//   }

//   async handleUserOnline(socket) {
//     try {
//       // Update all conversations where this user is a participant
//       const query = socket.userType === 'user' 
//         ? { 'participants.user.id': socket.userId }
//         : { 'participants.partner.id': socket.userId };

//       const updateField = socket.userType === 'user'
//         ? { 'participants.user.isOnline': true, 'participants.user.lastSeen': new Date() }
//         : { 'participants.partner.isOnline': true, 'participants.partner.lastSeen': new Date() };

//       await Conversation.updateMany(query, updateField);

//       // Notify all active conversations
//       const conversations = await Conversation.find(query);
//       conversations.forEach(conv => {
//         const otherParticipantId = socket.userType === 'user' 
//           ? conv.participants.partner.id.toString()
//           : conv.participants.user.id.toString();
        
//         const otherSocketId = this.connectedUsers.get(otherParticipantId);
//         if (otherSocketId) {
//           this.io.to(otherSocketId).emit('user_online', {
//             userId: socket.userId,
//             userType: socket.userType,
//             conversationId: conv.conversationId
//           });
//         }
//       });
//     } catch (error) {
//       console.error('Error handling user online:', error);
//     }
//   }

//   async handleJoinConversation(socket, data) {
//     try {
//       const { otherUserId, otherUserType } = data;

//       // Validate inputs
//       if (!otherUserId) {
//         socket.emit('error', { message: 'Other user ID is required' });
//         return;
//       }

//       if (!otherUserType || !['user', 'partner'].includes(otherUserType)) {
//         socket.emit('error', { message: 'Valid other user type is required' });
//         return;
//       }

//       // Clean the otherUserId
//       const cleanOtherUserId = String(otherUserId).trim();
      
//       const conversationId = socket.userType === 'user'
//         ? Message.generateConversationId(socket.userId, cleanOtherUserId)
//         : Message.generateConversationId(cleanOtherUserId, socket.userId);

//       socket.join(conversationId);
      
//       console.log(`User ${socket.userId} joined conversation: ${conversationId}`);
      
//       socket.emit('conversation_joined', { conversationId });
//     } catch (error) {
//       console.error('Error joining conversation:', error);
//       socket.emit('error', { message: 'Failed to join conversation', error: error.message });
//     }
//   }

//   async handleSendMessage(socket, data) {
//     try {
//       const { receiverId, receiverType, content, messageType = 'text', mediaUrl = null } = data;

//       // Validate inputs
//       if (!receiverId || !receiverType || !content) {
//         socket.emit('error', { message: 'Receiver ID, type, and content are required' });
//         return;
//       }

//       if (!['user', 'partner'].includes(receiverType)) {
//         socket.emit('error', { message: 'Invalid receiver type' });
//         return;
//       }

//       // Clean the receiverId
//       const cleanReceiverId = String(receiverId).trim();

//       // Generate conversation ID
//       const conversationId = socket.userType === 'user'
//         ? Message.generateConversationId(socket.userId, cleanReceiverId)
//         : Message.generateConversationId(cleanReceiverId, socket.userId);

//       // Create message
//       const message = await Message.create({
//         conversationId,
//         sender: {
//           id: socket.userId,
//           model: socket.userType === 'user' ? 'User' : 'Partner',
//           name: socket.userType === 'user' 
//             ? socket.userData.profile?.name || 'User'
//             : socket.userData.name,
//           profilePicture: socket.userType === 'user'
//             ? socket.userData.profileImage
//             : socket.userData.profilePicture
//         },
//         receiver: {
//           id: cleanReceiverId,
//           model: receiverType === 'user' ? 'User' : 'Partner'
//         },
//         messageType,
//         content,
//         mediaUrl
//       });

//       // Update or create conversation
//       await this.updateConversation(socket, cleanReceiverId, receiverType, message);

//       // Emit to receiver if online
//       const receiverSocketId = this.connectedUsers.get(cleanReceiverId);
//       if (receiverSocketId) {
//         this.io.to(receiverSocketId).emit('new_message', {
//           message: message.toObject(),
//           conversationId
//         });

//         // Auto-mark as delivered
//         message.isDelivered = true;
//         message.deliveredAt = new Date();
//         await message.save();

//         // Notify sender of delivery
//         socket.emit('message_delivered', {
//           messageId: message._id,
//           conversationId
//         });
//       }

//       // Emit to sender (confirmation)
//       socket.emit('message_sent', {
//         message: message.toObject(),
//         conversationId
//       });

//       // Broadcast to conversation room
//       this.io.to(conversationId).emit('conversation_updated', { conversationId });

//     } catch (error) {
//       console.error('Error sending message:', error);
//       socket.emit('error', { message: 'Failed to send message', error: error.message });
//     }
//   }

//   async updateConversation(socket, receiverId, receiverType, message) {
//     try {
//       const conversationId = message.conversationId;
      
//       // Fetch receiver data
//       let receiverData;
//       if (receiverType === 'user') {
//         receiverData = await User.findById(receiverId).select('email profile profileImage');
//       } else {
//         receiverData = await Partner.findById(receiverId).select('name email profilePicture');
//       }

//       if (!receiverData) {
//         console.error('Receiver not found:', receiverId);
//         return;
//       }

//       const updateData = {
//         lastMessage: {
//           content: message.content,
//           senderId: message.sender.id,
//           senderModel: message.sender.model,
//           timestamp: message.createdAt,
//           isRead: false
//         }
//       };

//       // Increment unread count for receiver
//       if (socket.userType === 'user') {
//         updateData.$inc = { 'unreadCount.partner': 1 };
//       } else {
//         updateData.$inc = { 'unreadCount.user': 1 };
//       }

//       const conversation = await Conversation.findOneAndUpdate(
//         { conversationId },
//         updateData,
//         { upsert: true, new: true, setDefaultsOnInsert: true }
//       );

//       // If new conversation, set participants
//       if (!conversation.participants.user.id) {
//         conversation.participants = {
//           user: {
//             id: socket.userType === 'user' ? socket.userId : receiverId,
//             name: socket.userType === 'user' 
//               ? socket.userData.profile?.name || 'User'
//               : receiverData.profile?.name || 'User',
//             profilePicture: socket.userType === 'user'
//               ? socket.userData.profileImage
//               : receiverData.profileImage
//           },
//           partner: {
//             id: socket.userType === 'partner' ? socket.userId : receiverId,
//             name: socket.userType === 'partner'
//               ? socket.userData.name
//               : receiverData.name,
//             profilePicture: socket.userType === 'partner'
//               ? socket.userData.profilePicture
//               : receiverData.profilePicture
//           }
//         };
//         await conversation.save();
//       }

//     } catch (error) {
//       console.error('Error updating conversation:', error);
//     }
//   }

//   async handleTypingStart(socket, data) {
//     const { conversationId, receiverId } = data;
    
//     if (!receiverId) {
//       return;
//     }

//     const cleanReceiverId = String(receiverId).trim();
//     const receiverSocketId = this.connectedUsers.get(cleanReceiverId);
    
//     if (receiverSocketId) {
//       this.io.to(receiverSocketId).emit('typing_start', {
//         conversationId,
//         userId: socket.userId,
//         userName: socket.userType === 'user' 
//           ? socket.userData.profile?.name || 'User'
//           : socket.userData.name
//       });
//     }
//   }

//   async handleTypingStop(socket, data) {
//     const { conversationId, receiverId } = data;
    
//     if (!receiverId) {
//       return;
//     }

//     const cleanReceiverId = String(receiverId).trim();
//     const receiverSocketId = this.connectedUsers.get(cleanReceiverId);
    
//     if (receiverSocketId) {
//       this.io.to(receiverSocketId).emit('typing_stop', {
//         conversationId,
//         userId: socket.userId
//       });
//     }
//   }

//   async handleMessageRead(socket, data) {
//     try {
//       const { messageIds, conversationId } = data;

//       if (!messageIds || !Array.isArray(messageIds) || messageIds.length === 0) {
//         return;
//       }

//       // Mark messages as read
//       await Message.updateMany(
//         { _id: { $in: messageIds }, isRead: false },
//         { isRead: true, readAt: new Date() }
//       );

//       // Update unread count in conversation
//       const updateField = socket.userType === 'user'
//         ? { 'unreadCount.user': 0 }
//         : { 'unreadCount.partner': 0 };

//       await Conversation.updateOne(
//         { conversationId },
//         updateField
//       );

//       // Notify sender
//       const messages = await Message.find({ _id: { $in: messageIds } });
//       messages.forEach(msg => {
//         const senderSocketId = this.connectedUsers.get(msg.sender.id.toString());
//         if (senderSocketId) {
//           this.io.to(senderSocketId).emit('message_read', {
//             messageId: msg._id,
//             conversationId,
//             readAt: msg.readAt
//           });
//         }
//       });

//     } catch (error) {
//       console.error('Error marking messages as read:', error);
//     }
//   }

//   async handleMessageDelivered(socket, data) {
//     try {
//       const { messageId, conversationId } = data;

//       if (!messageId) {
//         return;
//       }

//       await Message.updateOne(
//         { _id: messageId },
//         { isDelivered: true, deliveredAt: new Date() }
//       );

//       const message = await Message.findById(messageId);
//       if (!message) {
//         return;
//       }

//       const senderSocketId = this.connectedUsers.get(message.sender.id.toString());
      
//       if (senderSocketId) {
//         this.io.to(senderSocketId).emit('message_delivered', {
//           messageId,
//           conversationId,
//           deliveredAt: message.deliveredAt
//         });
//       }

//     } catch (error) {
//       console.error('Error marking message as delivered:', error);
//     }
//   }

//   async handleGetConversations(socket) {
//     try {
//       const query = socket.userType === 'user'
//         ? { 'participants.user.id': socket.userId }
//         : { 'participants.partner.id': socket.userId };

//       const conversations = await Conversation.find(query)
//         .sort({ 'lastMessage.timestamp': -1 })
//         .lean();

//       socket.emit('conversations_list', { conversations });

//     } catch (error) {
//       console.error('Error fetching conversations:', error);
//       socket.emit('error', { message: 'Failed to fetch conversations' });
//     }
//   }

//   async handleGetMessages(socket, data) {
//     try {
//       const { conversationId, page = 1, limit = 50 } = data;

//       if (!conversationId) {
//         socket.emit('error', { message: 'Conversation ID is required' });
//         return;
//       }

//       const messages = await Message.find({ conversationId, isDeleted: false })
//         .sort({ createdAt: -1 })
//         .skip((page - 1) * limit)
//         .limit(limit)
//         .lean();

//       const totalMessages = await Message.countDocuments({ conversationId, isDeleted: false });

//       socket.emit('messages_list', {
//         conversationId,
//         messages: messages.reverse(),
//         pagination: {
//           page,
//           limit,
//           total: totalMessages,
//           hasMore: page * limit < totalMessages
//         }
//       });

//     } catch (error) {
//       console.error('Error fetching messages:', error);
//       socket.emit('error', { message: 'Failed to fetch messages' });
//     }
//   }

//   async handleDisconnect(socket) {
//     console.log(`❌ User disconnected: ${socket.userId} (${socket.userType})`);

//     // Remove from connected users
//     this.connectedUsers.delete(socket.userId);
//     this.userSockets.delete(socket.id);

//     // Update online status
//     try {
//       const query = socket.userType === 'user'
//         ? { 'participants.user.id': socket.userId }
//         : { 'participants.partner.id': socket.userId };

//       const updateField = socket.userType === 'user'
//         ? { 'participants.user.isOnline': false, 'participants.user.lastSeen': new Date() }
//         : { 'participants.partner.isOnline': false, 'participants.partner.lastSeen': new Date() };

//       await Conversation.updateMany(query, updateField);

//       // Notify all active conversations
//       const conversations = await Conversation.find(query);
//       conversations.forEach(conv => {
//         const otherParticipantId = socket.userType === 'user'
//           ? conv.participants.partner.id.toString()
//           : conv.participants.user.id.toString();

//         const otherSocketId = this.connectedUsers.get(otherParticipantId);
//         if (otherSocketId) {
//           this.io.to(otherSocketId).emit('user_offline', {
//             userId: socket.userId,
//             userType: socket.userType,
//             conversationId: conv.conversationId,
//             lastSeen: new Date()
//           });
//         }
//       });

//     } catch (error) {
//       console.error('Error handling disconnect:', error);
//     }
//   }

//   // Utility method to send notification
//   sendNotificationToUser(userId, event, data) {
//     const socketId = this.connectedUsers.get(userId);
//     if (socketId) {
//       this.io.to(socketId).emit(event, data);
//     }
//   }

//   // Get online status
//   isUserOnline(userId) {
//     return this.connectedUsers.has(userId);
//   }
// }

// // Export singleton instance
// const socketService = new SocketService();
// export default socketService;
