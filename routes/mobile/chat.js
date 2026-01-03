import express from 'express';
import Chat from '../../models/Chat.js';
import { authenticate } from '../../middleware/auth.js';
import { getChatCompletion } from '../../utils/openai.js';

const router = express.Router();

/**
 * Create a new chat
 * POST /api/mobile/chat
 * Headers: Authorization: Bearer <token>
 * Body: { title? }
 */
router.post('/', authenticate, async (req, res) => {
  try {
    if (req.user.role !== 'user') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. User access required.'
      });
    }

    const { title } = req.body;

    const chat = new Chat({
      userId: req.user._id,
      title: title || 'New Chat',
      messages: []
    });

    await chat.save();

    res.status(201).json({
      success: true,
      message: 'Chat created successfully',
      data: {
        chatId: chat._id,
        title: chat.title,
        createdAt: chat.createdAt
      }
    });
  } catch (error) {
    console.error('Create chat error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to create chat'
    });
  }
});

/**
 * Get all chats for the user
 * GET /api/mobile/chat
 * Headers: Authorization: Bearer <token>
 */
router.get('/', authenticate, async (req, res) => {
  try {
    if (req.user.role !== 'user') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. User access required.'
      });
    }

    const chats = await Chat.find({ userId: req.user._id })
      .select('_id title messages createdAt updatedAt')
      .sort({ updatedAt: -1 })
      .lean();

    // Add message count and last message preview
    const chatsWithPreview = chats.map(chat => ({
      chatId: chat._id,
      title: chat.title,
      messageCount: chat.messages.length,
      lastMessage: chat.messages.length > 0 
        ? chat.messages[chat.messages.length - 1].content.substring(0, 100)
        : null,
      createdAt: chat.createdAt,
      updatedAt: chat.updatedAt
    }));

    res.json({
      success: true,
      data: {
        chats: chatsWithPreview
      }
    });
  } catch (error) {
    console.error('Get chats error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch chats'
    });
  }
});

/**
 * Get a specific chat with all messages
 * GET /api/mobile/chat/:chatId
 * Headers: Authorization: Bearer <token>
 */
router.get('/:chatId', authenticate, async (req, res) => {
  try {
    if (req.user.role !== 'user') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. User access required.'
      });
    }

    const { chatId } = req.params;

    const chat = await Chat.findOne({
      _id: chatId,
      userId: req.user._id
    });

    if (!chat) {
      return res.status(404).json({
        success: false,
        message: 'Chat not found'
      });
    }

    res.json({
      success: true,
      data: {
        chatId: chat._id,
        title: chat.title,
        messages: chat.messages,
        createdAt: chat.createdAt,
        updatedAt: chat.updatedAt
      }
    });
  } catch (error) {
    console.error('Get chat error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch chat'
    });
  }
});

/**
 * Send a message in a chat (create new chat if chatId not provided)
 * POST /api/mobile/chat/:chatId/message
 * Headers: Authorization: Bearer <token>
 * Body: { message }
 */
router.post('/:chatId/message', authenticate, async (req, res) => {
  try {
    if (req.user.role !== 'user') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. User access required.'
      });
    }

    const { chatId } = req.params;
    const { message } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Message is required'
      });
    }

    // Find or create chat
    let chat = await Chat.findOne({
      _id: chatId,
      userId: req.user._id
    });

    // If chatId provided but not found, create new chat
    if (!chat && chatId !== 'new') {
      // Create new chat if chatId doesn't exist
      chat = new Chat({
        userId: req.user._id,
        title: message.substring(0, 50) || 'New Chat',
        messages: []
      });
    } else if (!chat) {
      // Create new chat if chatId is 'new'
      chat = new Chat({
        userId: req.user._id,
        title: message.substring(0, 50) || 'New Chat',
        messages: []
      });
    }

    // Add user message
    chat.messages.push({
      role: 'user',
      content: message.trim()
    });

    // Prepare messages for OpenAI (format: { role, content })
    const openaiMessages = chat.messages.map(msg => ({
      role: msg.role,
      content: msg.content
    }));

    // Get response from OpenAI
    const aiResponse = await getChatCompletion(openaiMessages);

    // Add assistant message
    chat.messages.push({
      role: 'assistant',
      content: aiResponse.content
    });

    // Update chat title if it's the first message
    if (chat.messages.length === 2 && chat.title === 'New Chat') {
      chat.title = message.substring(0, 50) || 'New Chat';
    }

    await chat.save();

    res.json({
      success: true,
      message: 'Message sent successfully',
      data: {
        chatId: chat._id,
        userMessage: {
          role: 'user',
          content: message.trim()
        },
        assistantMessage: {
          role: 'assistant',
          content: aiResponse.content
        },
        usage: aiResponse.usage
      }
    });
  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to send message'
    });
  }
});

/**
 * Delete a chat
 * DELETE /api/mobile/chat/:chatId
 * Headers: Authorization: Bearer <token>
 */
router.delete('/:chatId', authenticate, async (req, res) => {
  try {
    if (req.user.role !== 'user') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. User access required.'
      });
    }

    const { chatId } = req.params;

    const chat = await Chat.findOneAndDelete({
      _id: chatId,
      userId: req.user._id
    });

    if (!chat) {
      return res.status(404).json({
        success: false,
        message: 'Chat not found'
      });
    }

    res.json({
      success: true,
      message: 'Chat deleted successfully'
    });
  } catch (error) {
    console.error('Delete chat error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to delete chat'
    });
  }
});

export default router;

