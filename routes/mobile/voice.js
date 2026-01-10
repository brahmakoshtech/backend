import express from 'express';
import { authenticate } from '../../middleware/auth.js';
import { transcribeAudio } from '../../utils/deepgram.js';
import { convertToLinear16Wav } from '../../utils/audio.js';
import { generateDeepgramSpeech } from '../../utils/deepgramTts.js';
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
  console.log('[Voice POST /start] Request received:', {
    timestamp: new Date().toISOString(),
    userId: req.user?._id,
    body: req.body
  });

  try {
    // CRITICAL: This endpoint is ONLY for 'user' role
    const tokenRole = req.decodedRole;
    console.log('[Voice POST /start] Token role:', tokenRole);
    
    if (tokenRole !== 'user') {
      console.error('[Voice POST /start] Access denied - Wrong role:', {
        tokenRole: tokenRole,
        requiredRole: 'user',
        userId: req.user?._id
      });
      return res.status(403).json({
        success: false,
        message: `Access denied. This endpoint is only for 'user' role. Your current role is '${tokenRole}'. Please login as a user.`,
        error: 'INVALID_ROLE',
        requiredRole: 'user',
        currentRole: tokenRole
      });
    }

    if (!req.user) {
      console.error('[Voice POST /start] User not found in request');
      return res.status(403).json({
        success: false,
        message: 'Access denied. User not found.',
        error: 'USER_NOT_FOUND'
      });
    }

    const { chatId } = req.body;
    console.log('[Voice POST /start] Processing chatId:', chatId);

    // Find or create chat
    let chat = null;
    if (chatId && chatId !== 'new') {
      console.log('[Voice POST /start] Looking for existing chat:', chatId);
      chat = await Chat.findOne({
        _id: chatId,
        userId: req.user._id
      });
      if (chat) {
        console.log('[Voice POST /start] Found existing chat:', chat._id);
      } else {
        console.log('[Voice POST /start] Chat not found or not owned by user');
      }
    }

    if (!chat) {
      console.log('[Voice POST /start] Creating new chat for user:', req.user._id);
      chat = new Chat({
        userId: req.user._id,
        title: 'Voice Chat',
        messages: []
      });
      await chat.save();
      console.log('[Voice POST /start] New chat created:', chat._id);
    }

    const sessionId = `voice_${chat._id}_${Date.now()}`;
    console.log('[Voice POST /start] Session initialized successfully:', {
      chatId: chat._id,
      sessionId: sessionId,
      userId: req.user._id
    });

    res.json({
      success: true,
      message: 'Voice session initialized',
      data: {
        chatId: chat._id,
        sessionId: sessionId
      }
    });
  } catch (error) {
    console.error('[Voice POST /start] Error:', {
      error: error.message,
      stack: error.stack,
      userId: req.user?._id
    });
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
  const startTime = Date.now();
  console.log('[Voice POST /process] Request received:', {
    timestamp: new Date().toISOString(),
    userId: req.user?._id,
    hasChatId: !!req.body.chatId,
    hasAudioData: !!req.body.audioData,
    audioFormat: req.body.audioFormat,
    audioDataLength: req.body.audioData?.length
  });

  try {
    // CRITICAL: This endpoint is ONLY for 'user' role
    const tokenRole = req.decodedRole;
    console.log('[Voice POST /process] Token role:', tokenRole);
    
    if (tokenRole !== 'user') {
      console.error('[Voice POST /process] Access denied - Wrong role:', {
        tokenRole: tokenRole,
        requiredRole: 'user',
        userId: req.user?._id
      });
      return res.status(403).json({
        success: false,
        message: `Access denied. This endpoint is only for 'user' role. Your current role is '${tokenRole}'. Please login as a user.`,
        error: 'INVALID_ROLE',
        requiredRole: 'user',
        currentRole: tokenRole
      });
    }

    if (!req.user) {
      console.error('[Voice POST /process] User not found in request');
      return res.status(403).json({
        success: false,
        message: 'Access denied. User not found.',
        error: 'USER_NOT_FOUND'
      });
    }

    const { chatId, audioData, audioFormat = 'linear16' } = req.body;

    if (!chatId) {
      console.error('[Voice POST /process] Missing chatId');
      return res.status(400).json({
        success: false,
        message: 'chatId is required'
      });
    }

    if (!audioData) {
      console.error('[Voice POST /process] Missing audioData');
      return res.status(400).json({
        success: false,
        message: 'audioData is required'
      });
    }

    console.log('[Voice POST /process] Processing audio:', {
      chatId: chatId,
      audioFormat: audioFormat,
      audioDataSize: audioData.length
    });

    // Find or create chat
    console.log('[Voice POST /process] Finding chat:', chatId);
    let chat = await Chat.findOne({
      _id: chatId,
      userId: req.user._id
    });

    if (!chat) {
      console.log('[Voice POST /process] Chat not found, creating new chat');
      chat = new Chat({
        userId: req.user._id,
        title: 'Voice Chat',
        messages: []
      });
      await chat.save();
      console.log('[Voice POST /process] New chat created:', chat._id);
    } else {
      console.log('[Voice POST /process] Found existing chat:', chat._id, 'with', chat.messages.length, 'messages');
    }

    // Convert base64 audio to buffer
    let audioBuffer;
    try {
      console.log('[Voice POST /process] Converting base64 to buffer (original)...');
      const originalBuffer = Buffer.from(audioData, 'base64');
      console.log('[Voice POST /process] Original audio buffer created:', { size: originalBuffer.length, unit: 'bytes' });

      // Guard: if original audio is too small, skip processing to avoid invalid data
      if (!originalBuffer.length || originalBuffer.length < 4000) {
        console.warn('[Voice POST /process] Original audio too small, skipping transcription');
        return res.status(200).json({
          success: true,
          message: "I can't hear you clearly. Please repeat.",
          data: {
            fallbackVoiceText: "I can't hear you clearly. Please repeat."
          }
        });
      }

      // Convert WebM/Opus to 16-bit PCM WAV for reliable Deepgram processing
      console.log('[Voice POST /process] Converting audio to linear16 WAV for Deepgram...');
      const inputFormatHint = audioFormat || 'webm';
      
      // Additional validation: check if buffer looks valid (has minimum expected size and starts with expected bytes)
      const minExpectedSize = 1000; // At least 1KB for a valid WebM header
      if (originalBuffer.length < minExpectedSize) {
        console.warn('[Voice POST /process] Audio buffer too small for conversion:', originalBuffer.length);
        return res.status(200).json({
          success: true,
          message: "I can't hear you clearly. Please repeat.",
          data: {
            fallbackVoiceText: "I can't hear you clearly. Please repeat."
          }
        });
      }
      
      try {
        audioBuffer = await convertToLinear16Wav(originalBuffer, inputFormatHint);
        console.log('[Voice POST /process] Converted WAV buffer created:', { size: audioBuffer.length, unit: 'bytes' });
      } catch (convErr) {
        console.error('[Voice POST /process] Audio conversion failed:', {
          error: convErr.message,
          inputSize: originalBuffer.length,
          inputFormat: inputFormatHint
        });
        return res.status(200).json({
          success: true,
          message: "I can't hear you clearly. Please repeat.",
          data: {
            fallbackVoiceText: "I can't hear you clearly. Please repeat."
          }
        });
      }
    } catch (error) {
      console.error('[Voice POST /process] Base64 conversion error:', error);
      return res.status(200).json({
        success: true,
        message: "I can't hear you clearly. Please repeat.",
        data: {
          fallbackVoiceText: "I can't hear you clearly. Please repeat."
        }
      });
    }

    // Transcribe audio using Deepgram REST API
    let transcribedText = '';
    try {
      console.log('[Voice POST /process] Starting transcription with Deepgram (linear16 WAV)...');
      // Send converted linear16 WAV to Deepgram for maximum reliability
      const deepgramOptions = {
        model: process.env.DEEPGRAM_MODEL || 'flux-general-en',
        language: 'en',
        encoding: 'linear16',
        sample_rate: 16000
      };
      
      console.log('[Voice POST /process] Deepgram options:', deepgramOptions);
      const transcriptionStartTime = Date.now();
      transcribedText = await transcribeAudio(audioBuffer, deepgramOptions);
      const transcriptionTime = Date.now() - transcriptionStartTime;
      console.log('[Voice POST /process] Transcription complete:', {
        text: transcribedText,
        length: transcribedText.length,
        timeMs: transcriptionTime
      });
    } catch (error) {
      console.error('[Voice POST /process] Deepgram transcription error:', {
        error: error.message,
        stack: error.stack,
        response: error.response?.data
      });
      return res.status(200).json({
        success: true,
        message: "I can't hear you clearly. Please repeat.",
        data: {
          fallbackVoiceText: "I can't hear you clearly. Please repeat."
        }
      });
    }

    if (!transcribedText || transcribedText.trim().length === 0) {
      console.warn('[Voice POST /process] No speech detected in audio');
      return res.status(200).json({
        success: true,
        message: "I can't hear you clearly. Please repeat.",
        data: {
          fallbackVoiceText: "I can't hear you clearly. Please repeat."
        }
      });
    }

    // Add user message to chat
    console.log('[Voice POST /process] Adding user message to chat');
    chat.messages.push({
      role: 'user',
      content: transcribedText
    });

    // Get AI response from OpenAI
    console.log('[Voice POST /process] Getting AI response from OpenAI...');
    const openaiMessages = chat.messages.map(msg => ({
      role: msg.role,
      content: msg.content
    }));

    const aiStartTime = Date.now();
    let aiResponse;
    try {
      aiResponse = await getChatCompletion(openaiMessages);
      const aiTime = Date.now() - aiStartTime;
      console.log('[Voice POST /process] AI response received:', {
        contentLength: aiResponse.content?.length,
        usage: aiResponse.usage,
        timeMs: aiTime
      });
    } catch (error) {
      console.error('[Voice POST /process] OpenAI error:', {
        error: error.message,
        stack: error.stack
      });
      return res.status(500).json({
        success: false,
        message: `AI response failed: ${error.message}`
      });
    }

    // Add assistant message to chat
    console.log('[Voice POST /process] Adding assistant message to chat');
    chat.messages.push({
      role: 'assistant',
      content: aiResponse.content
    });

    // Update chat title if it's the first message
    if (chat.messages.length === 2 && chat.title === 'Voice Chat') {
      chat.title = transcribedText.substring(0, 50) || 'Voice Chat';
      console.log('[Voice POST /process] Updated chat title:', chat.title);
    }

    await chat.save();
    console.log('[Voice POST /process] Chat saved');

    // Generate speech from AI response using Deepgram TTS
    let audioResponse = null;
    try {
      console.log('[Voice POST /process] Generating speech with Deepgram TTS...');
      const ttsStartTime = Date.now();
      // Deepgram TTS helper returns WAV buffer (16‑bit PCM)
      audioResponse = await generateDeepgramSpeech(aiResponse.content);
      const ttsTime = Date.now() - ttsStartTime;
      console.log('[Voice POST /process] Speech generated:', {
        audioSize: audioResponse.length,
        unit: 'bytes',
        timeMs: ttsTime
      });
    } catch (error) {
      console.error('[Voice POST /process] Deepgram TTS error:', {
        error: error.message,
        stack: error.stack,
        response: error.response?.data
      });
      // Continue even if TTS fails - return text response
      console.warn('[Voice POST /process] Continuing without audio response');
    }

    const totalTime = Date.now() - startTime;
    console.log('[Voice POST /process] Request completed successfully:', {
      chatId: chat._id,
      transcriptionLength: transcribedText.length,
      responseLength: aiResponse.content.length,
      hasAudio: !!audioResponse,
      totalTimeMs: totalTime
    });

    res.json({
      success: true,
      message: 'Voice processed successfully',
      data: {
        chatId: chat._id,
        transcribedText,
        aiResponse: aiResponse.content,
        audioResponse: audioResponse ? audioResponse.toString('base64') : null,
        audioFormat: 'wav',
        usage: aiResponse.usage
      }
    });
  } catch (error) {
    const totalTime = Date.now() - startTime;
    console.error('[Voice POST /process] Process voice error:', {
      error: error.message,
      stack: error.stack,
      userId: req.user?._id,
      chatId: req.body.chatId,
      totalTimeMs: totalTime
    });
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
  // CRITICAL: This endpoint is ONLY for 'user' role
  const tokenRole = req.decodedRole;
  
  if (tokenRole !== 'user') {
    console.error('[Voice GET /stream] Access denied - Wrong role:', {
      tokenRole: tokenRole,
      requiredRole: 'user'
    });
    return res.status(403).json({
      success: false,
      message: `Access denied. This endpoint is only for 'user' role. Your current role is '${tokenRole}'. Please login as a user.`,
      error: 'INVALID_ROLE',
      requiredRole: 'user',
      currentRole: tokenRole
    });
  }

  if (!req.user) {
    return res.status(403).json({
      success: false,
      message: 'Access denied. User not found.',
      error: 'USER_NOT_FOUND'
    });
  }

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

