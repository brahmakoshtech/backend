import express from 'express';
import { authenticate } from '../../middleware/auth.js';
import { transcribeAudio } from '../../utils/deepgram.js';
import { generateSpeech } from '../../utils/lmnt.js';
import { getChatCompletion } from '../../utils/openai.js';
import Chat from '../../models/Chat.js';

const router = express.Router();

/**
 * Initialize voice-to-voice session
 * POST /api/mobile/voice/start
 * Headers: Authorization: Bearer <token>
 * Body: { chatId? }
 */
router.post('/start', authenticate, async (req, res) => {
  try {
    if (req.user.role !== 'user') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. User access required.'
      });
    }

    const { chatId } = req.body;

    // Find or create chat
    let chat = null;
    if (chatId && chatId !== 'new') {
      chat = await Chat.findOne({
        _id: chatId,
        userId: req.user._id
      });
    }

    if (!chat) {
      chat = new Chat({
        userId: req.user._id,
        title: 'Voice Chat',
        messages: []
      });
      await chat.save();
    }

    res.json({
      success: true,
      message: 'Voice session initialized',
      data: {
        chatId: chat._id,
        sessionId: `voice_${chat._id}_${Date.now()}`
      }
    });
  } catch (error) {
    console.error('Start voice session error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to start voice session'
    });
  }
});

/**
 * Process voice audio and get response
 * POST /api/mobile/voice/process
 * Headers: Authorization: Bearer <token>
 * Body: { chatId, audioData (base64), audioFormat? }
 * 
 * Note: This is a simplified endpoint. For real-time streaming,
 * you would use WebSocket. This endpoint processes complete audio chunks.
 */
router.post('/process', authenticate, async (req, res) => {
  try {
    if (req.user.role !== 'user') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. User access required.'
      });
    }

    const { chatId, audioData, audioFormat = 'linear16' } = req.body;

    if (!chatId) {
      return res.status(400).json({
        success: false,
        message: 'chatId is required'
      });
    }

    if (!audioData) {
      return res.status(400).json({
        success: false,
        message: 'audioData is required'
      });
    }

    // Find or create chat
    let chat = await Chat.findOne({
      _id: chatId,
      userId: req.user._id
    });

    if (!chat) {
      chat = new Chat({
        userId: req.user._id,
        title: 'Voice Chat',
        messages: []
      });
      await chat.save();
    }

    // Convert base64 audio to buffer
    let audioBuffer;
    try {
      audioBuffer = Buffer.from(audioData, 'base64');
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid audio data format'
      });
    }

    // Transcribe audio using Deepgram REST API
    let transcribedText = '';
    try {
      // Determine encoding from audioFormat
      // For webm, use 'webm' encoding; for other formats, use as-is
      const deepgramEncoding = audioFormat === 'webm' ? 'webm' : audioFormat;
      
      // Build options for Deepgram
      const deepgramOptions = {
        model: 'flux-general-en',
        language: 'en'
      };
      
      // Only set encoding and sample_rate if not webm (webm auto-detects)
      if (deepgramEncoding !== 'webm') {
        deepgramOptions.encoding = deepgramEncoding;
        deepgramOptions.sample_rate = 16000;
      }
      
      transcribedText = await transcribeAudio(audioBuffer, deepgramOptions);
    } catch (error) {
      console.error('Deepgram transcription error:', error);
      return res.status(500).json({
        success: false,
        message: `Transcription failed: ${error.message}`
      });
    }

    if (!transcribedText) {
      return res.status(400).json({
        success: false,
        message: 'No speech detected in audio'
      });
    }

    // Add user message to chat
    chat.messages.push({
      role: 'user',
      content: transcribedText
    });

    // Get AI response from OpenAI
    const openaiMessages = chat.messages.map(msg => ({
      role: msg.role,
      content: msg.content
    }));

    const aiResponse = await getChatCompletion(openaiMessages);

    // Add assistant message to chat
    chat.messages.push({
      role: 'assistant',
      content: aiResponse.content
    });

    // Update chat title if it's the first message
    if (chat.messages.length === 2 && chat.title === 'Voice Chat') {
      chat.title = transcribedText.substring(0, 50) || 'Voice Chat';
    }

    await chat.save();

    // Generate speech from AI response using LMNT
    let audioResponse = null;
    try {
      audioResponse = await generateSpeech(aiResponse.content, {
        voice: 'leah',
        format: 'mp3'
      });
    } catch (error) {
      console.error('LMNT TTS error:', error);
      // Continue even if TTS fails - return text response
    }

    res.json({
      success: true,
      message: 'Voice processed successfully',
      data: {
        chatId: chat._id,
        transcribedText,
        aiResponse: aiResponse.content,
        audioResponse: audioResponse ? audioResponse.toString('base64') : null,
        audioFormat: 'mp3',
        usage: aiResponse.usage
      }
    });
  } catch (error) {
    console.error('Process voice error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to process voice'
    });
  }
});

/**
 * WebSocket endpoint for real-time voice-to-voice
 * This would typically be handled by a WebSocket server
 * For now, we provide the endpoint structure
 * 
 * WS /api/mobile/voice/stream
 * Headers: Authorization: Bearer <token>
 * 
 * Protocol:
 * - Client sends audio chunks
 * - Server sends transcription updates
 * - Server sends AI response when user stops speaking
 * - Server sends audio response
 */
router.get('/stream', authenticate, async (req, res) => {
  // WebSocket implementation would go here
  // For HTTP, return instructions
  res.json({
    success: false,
    message: 'WebSocket endpoint. Use WebSocket connection for real-time streaming.',
    info: {
      endpoint: 'ws://your-server/api/mobile/voice/stream',
      protocol: 'WebSocket',
      headers: {
        'Authorization': 'Bearer <token>'
      },
      queryParams: {
        chatId: 'optional-chat-id'
      }
    }
  });
});

export default router;

