import { WebSocketServer } from 'ws';
import { createClient, LiveTranscriptionEvents } from '@deepgram/sdk';
import OpenAI from 'openai';
import fetch from 'node-fetch';
import Chat from '../../models/Chat.js';
import VoiceConfig from '../../models/voiceConfig.js';
import Agent from '../../models/Agent.js';

// ─── Validate environment variables ──────────────────────────────────────────
const deepgramApiKey   = process.env.DEEPGRAM_API_KEY;
const elevenLabsApiKey = process.env.ELEVENLABS_API_KEY;
const openaiApiKey     = process.env.OPENAI_API_KEY;

// Log API key status
console.log('[VoiceAgent] API Keys Status:');
console.log('  Deepgram:',    deepgramApiKey   ? `${deepgramApiKey.substring(0, 4)}...${deepgramApiKey.substring(deepgramApiKey.length - 4)} (length: ${deepgramApiKey.length})` : '❌ MISSING');
console.log('  OpenAI:',      openaiApiKey     ? `${openaiApiKey.substring(0, 7)}...${openaiApiKey.substring(openaiApiKey.length - 4)}` : '❌ MISSING');
console.log('  ElevenLabs:',  elevenLabsApiKey ? `${elevenLabsApiKey.substring(0, 4)}...${elevenLabsApiKey.substring(elevenLabsApiKey.length - 4)}` : '❌ MISSING');

// ─── Initialize clients ───────────────────────────────────────────────────────
let deepgramClient = null;
let openai = null;

if (deepgramApiKey) {
  deepgramClient = createClient(deepgramApiKey);
  console.log('[VoiceAgent] ✅ Deepgram client initialized');
}

if (openaiApiKey) {
  openai = new OpenAI({ apiKey: openaiApiKey });
  console.log('[VoiceAgent] ✅ OpenAI client initialized');
}

// Fallback constants (used only if no VoiceConfig is found in DB)
const FALLBACK_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || 'EXAVITQu4vr4xnSDxMaL';
const FALLBACK_MODEL_ID = 'eleven_turbo_v2_5';
const DEFAULT_PROMPT    = 'Give the answer within two lines.';

// ─────────────────────────────────────────────────────────────────────────────
// WebSocket Voice Agent Handler
// ─────────────────────────────────────────────────────────────────────────────
export const handleVoiceAgentWebSocket = (wss) => {
  wss.on('connection', async (ws, req) => {
    console.log('[VoiceAgent] New WebSocket connection');

    // Check API keys
    if (!deepgramApiKey || !openaiApiKey || !elevenLabsApiKey) {
      console.error('[VoiceAgent] Missing API keys, rejecting connection');
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Server configuration error: Missing API keys',
        error: 'MISSING_API_KEYS',
      }));
      ws.close();
      return;
    }

    // ─── Connection state ─────────────────────────────────────────────────────
    let deepgramConnection   = null;
    let silenceTimer         = null;
    let accumulatedTranscript = '';
    let isProcessingLLM      = false;
    let chat                 = null;
    let userId               = null;
    let isActive             = false;
    let audioChunkCount      = 0;
    let voiceConfig          = null;   // ← resolved VoiceConfig document
    let agentPromptOverride  = null;   // ← resolved Agent.systemPrompt
    let agentFirstMessage    = null;   // ← resolved Agent.firstMessage (played on session start)

    const SILENCE_THRESHOLD = 2000;

    // ─── Cleanup ──────────────────────────────────────────────────────────────
    const cleanup = () => {
      console.log('[VoiceAgent] Cleaning up...');

      if (silenceTimer) {
        clearTimeout(silenceTimer);
        silenceTimer = null;
      }

      if (deepgramConnection) {
        try {
          deepgramConnection.finish();
        } catch (err) {
          console.error('[VoiceAgent] Error finishing Deepgram:', err.message);
        }
        deepgramConnection = null;
      }

      isActive       = false;
      audioChunkCount = 0;
      console.log('[VoiceAgent] Cleanup complete');
    };

    // ─── Stream TTS from ElevenLabs ───────────────────────────────────────────
    const streamElevenLabsTTS = async (text, ws) => {
      try {
        console.log('[VoiceAgent] 🔊 Starting ElevenLabs TTS...');

        // Use values from voiceConfig if available, otherwise fall back to defaults
        const voiceId  = voiceConfig?.voiceId || FALLBACK_VOICE_ID;
        const modelId  = voiceConfig?.modelId || FALLBACK_MODEL_ID;
        const settings = voiceConfig?.voiceSettings || {
          stability:         0.5,
          similarity_boost:  0.75,
          style:             0.0,
          use_speaker_boost: true,
        };

        console.log(`[VoiceAgent] TTS voice: ${voiceId}, model: ${modelId}`);

        const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`;

        const response = await fetch(url, {
          method: 'POST',
          headers: {
            Accept:           'audio/mpeg',
            'Content-Type':   'application/json',
            'xi-api-key':     elevenLabsApiKey,
          },
          body: JSON.stringify({
            text,
            model_id:       modelId,
            voice_settings: settings,
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`ElevenLabs API error: ${response.status} - ${errorText}`);
        }

        console.log('[VoiceAgent] 📡 Streaming TTS audio...');

        let chunkCount = 0;
        for await (const chunk of response.body) {
          if (!isActive) {
            console.log('[VoiceAgent] Session stopped, ending TTS');
            break;
          }
          chunkCount++;
          ws.send(JSON.stringify({
            type:       'audio_chunk',
            audio:      chunk.toString('base64'),
            chunkIndex: chunkCount,
          }));
        }

        ws.send(JSON.stringify({
          type:        'audio_complete',
          totalChunks: chunkCount,
        }));

        console.log('[VoiceAgent] ✅ TTS complete:', chunkCount, 'chunks');

      } catch (error) {
        console.error('[VoiceAgent] ElevenLabs TTS error:', error.message);
        ws.send(JSON.stringify({
          type:    'error',
          message: 'Error generating speech',
          error:   error.message,
        }));
      }
    };

    // ─── Process complete conversation turn ───────────────────────────────────
    const processTurnComplete = async () => {
      if (!accumulatedTranscript.trim() || isProcessingLLM || !isActive) return;

      const userMessage     = accumulatedTranscript.trim();
      accumulatedTranscript = '';
      isProcessingLLM       = true;

      console.log('[VoiceAgent] 💬 Processing turn:', userMessage);

      try {
        // Save user message to chat history
        chat.messages.push({ role: 'user', content: userMessage });
        await chat.save();

        ws.send(JSON.stringify({ type: 'user_message', text: userMessage }));

        // ── Build OpenAI messages array ──────────────────────────────────────
        // Prepend the agent/system prompt as a system message
        // Priority: selected agent.systemPrompt -> voiceConfig.prompt -> default
        const systemPrompt = agentPromptOverride || voiceConfig?.prompt || DEFAULT_PROMPT;

        const messages = [
          { role: 'system', content: systemPrompt },
          ...chat.messages.map(msg => ({ role: msg.role, content: msg.content })),
        ];

        console.log('[VoiceAgent] 🤖 Requesting OpenAI response with system prompt:', systemPrompt);

        const completion = await openai.chat.completions.create({
          model:       process.env.OPENAI_MODEL || 'gpt-4o-mini',
          messages,
          temperature: 0.7,
          max_tokens:  500,
        });

        const aiResponse = completion.choices[0].message.content;
        console.log('[VoiceAgent] ✅ OpenAI response received:', aiResponse.substring(0, 100) + '...');

        // Save assistant message
        chat.messages.push({ role: 'assistant', content: aiResponse });
        await chat.save();

        ws.send(JSON.stringify({ type: 'ai_response', text: aiResponse }));

        // Generate and stream speech using the resolved voiceConfig
        await streamElevenLabsTTS(aiResponse, ws);

      } catch (error) {
        console.error('[VoiceAgent] Error processing turn:', error);
        ws.send(JSON.stringify({
          type:    'error',
          message: 'Error processing response',
          error:   error.message,
        }));
      } finally {
        isProcessingLLM = false;
      }
    };

    // ─── Handle incoming messages ─────────────────────────────────────────────
    ws.on('message', async (message) => {
      try {
        const data = JSON.parse(message);

        // ── START ────────────────────────────────────────────────────────────
        if (data.type === 'start') {
          console.log('[VoiceAgent] Start command received:', {
            chatId:    data.chatId,
            userId:    data.userId,
            voiceName: data.voiceName,
            agentId:   data.agentId,
          });

          userId   = data.userId;
          isActive = true;
          agentPromptOverride = null;
          agentFirstMessage   = null;

          // ── Resolve Agent (optional) ────────────────────────────────────────
          // If client sends agentId, it controls voice, system prompt, and optional first message
          let requestedVoice = data.voiceName || 'krishna1';
          if (data.agentId) {
            try {
              const agent = await Agent.findById(String(data.agentId)).lean();
              if (agent?.voiceName) requestedVoice = agent.voiceName;
              if (agent?.systemPrompt) agentPromptOverride = agent.systemPrompt;
              if (agent?.firstMessage?.trim()) agentFirstMessage = agent.firstMessage.trim();
              console.log('[VoiceAgent] 🤖 Agent resolved:', {
                agentId: agent?._id,
                name: agent?.name,
                voiceName: agent?.voiceName,
                hasPrompt: !!agent?.systemPrompt,
                hasFirstMessage: !!agentFirstMessage,
              });
            } catch (e) {
              console.warn('[VoiceAgent] ⚠️ Could not resolve agentId:', e.message);
            }
          }

          // ── Resolve VoiceConfig from DB ─────────────────────────────────────
          voiceConfig = await VoiceConfig.findOne({ name: requestedVoice, isActive: true });

          if (!voiceConfig) {
            console.warn(`[VoiceAgent] ⚠️ Voice '${requestedVoice}' not found or inactive — falling back to defaults`);
            // Continue with null voiceConfig; streamElevenLabsTTS + processTurnComplete handle fallback
          } else {
            console.log(`[VoiceAgent] 🎙️ Voice resolved: ${voiceConfig.displayName} (${voiceConfig.voiceId})`);
          }

          // ── Find or create chat ─────────────────────────────────────────────
          if (data.chatId && data.chatId !== 'new') {
            chat = await Chat.findOne({ _id: data.chatId, userId });
          }

          if (!chat) {
            chat = new Chat({
              userId,
              title:    'Voice Agent Chat',
              agentId:  data.agentId ? String(data.agentId) : null,
              messages: [],
            });
            await chat.save();
            console.log('[VoiceAgent] Created new chat:', chat._id);
          }

          // ── Initialize Deepgram ─────────────────────────────────────────────
          try {
            console.log('[VoiceAgent] Creating Deepgram connection...');

            deepgramConnection = deepgramClient.listen.live({
              model:           'nova-2',
              language:        'en',
              encoding:        'linear16',
              sample_rate:     16000,
              channels:        1,
              interim_results: true,
              utterance_end_ms: 2000,
              vad_events:      true,
              punctuate:       true,
              smart_format:    true,
            });

            // Open
            deepgramConnection.on(LiveTranscriptionEvents.Open, async () => {
              console.log('[VoiceAgent] ✅ Deepgram connection opened');

              ws.send(JSON.stringify({
                type:    'deepgram_connected',
                message: 'Speech recognition active',
              }));

              ws.send(JSON.stringify({
                type:      'started',
                chatId:    chat._id,
                voiceName: voiceConfig?.name || requestedVoice,
                message:   'Voice agent started',
              }));

              // If agent has firstMessage, add to chat and stream TTS greeting
              if (agentFirstMessage && isActive) {
                try {
                  chat.messages.push({ role: 'assistant', content: agentFirstMessage });
                  await chat.save();
                  ws.send(JSON.stringify({ type: 'ai_response', text: agentFirstMessage }));
                  await streamElevenLabsTTS(agentFirstMessage, ws);
                } catch (err) {
                  console.error('[VoiceAgent] First message TTS error:', err.message);
                }
              }
            });

            // Transcript
            deepgramConnection.on(LiveTranscriptionEvents.Transcript, async (data) => {
              const transcript  = data.channel?.alternatives?.[0]?.transcript;
              const isFinal     = data.is_final;
              const speechFinal = data.speech_final;

              if (transcript && transcript.trim()) {
                console.log('[VoiceAgent] 🎤 Transcript:', {
                  text:        transcript,
                  isFinal,
                  speechFinal,
                  confidence:  data.channel?.alternatives?.[0]?.confidence,
                });

                ws.send(JSON.stringify({
                  type:    'transcript',
                  text:    transcript,
                  isFinal,
                }));

                if (isFinal) {
                  accumulatedTranscript += (accumulatedTranscript ? ' ' : '') + transcript;

                  if (silenceTimer) clearTimeout(silenceTimer);
                  silenceTimer = setTimeout(async () => {
                    await processTurnComplete();
                  }, SILENCE_THRESHOLD);
                }
              }
            });

            // UtteranceEnd
            deepgramConnection.on(LiveTranscriptionEvents.UtteranceEnd, async () => {
              console.log('[VoiceAgent] 🔚 Utterance end detected');
              if (silenceTimer) clearTimeout(silenceTimer);
              await processTurnComplete();
            });

            // Metadata
            deepgramConnection.on(LiveTranscriptionEvents.Metadata, (data) => {
              console.log('[VoiceAgent] 📊 Metadata:', {
                request_id: data.request_id,
                model_info: data.model_info,
              });
            });

            // Error
            deepgramConnection.on(LiveTranscriptionEvents.Error, (error) => {
              console.error('[VoiceAgent] ❌ Deepgram error:', {
                message: error.message,
                type:    error.type,
              });

              ws.send(JSON.stringify({
                type:    'error',
                message: 'Speech recognition error',
                error:   error.message,
              }));

              cleanup();
            });

            // Close
            deepgramConnection.on(LiveTranscriptionEvents.Close, () => {
              console.log('[VoiceAgent] Deepgram connection closed');
            });

            console.log('[VoiceAgent] Deepgram connection configured and waiting for open event...');

          } catch (error) {
            console.error('[VoiceAgent] Failed to initialize Deepgram:', error);

            ws.send(JSON.stringify({
              type:    'error',
              message: 'Failed to initialize speech recognition',
              error:   error.message,
            }));

            cleanup();
          }

        // ── STOP ─────────────────────────────────────────────────────────────
        } else if (data.type === 'stop') {
          console.log('[VoiceAgent] Stop command received');
          cleanup();
          ws.send(JSON.stringify({ type: 'stopped', message: 'Voice agent stopped' }));

        // ── AUDIO ─────────────────────────────────────────────────────────────
        } else if (data.type === 'audio') {
          if (deepgramConnection && isActive) {
            try {
              const audioBuffer = Buffer.from(data.audio, 'base64');
              deepgramConnection.send(audioBuffer);

              audioChunkCount++;
              if (audioChunkCount % 50 === 0) {
                console.log(`[VoiceAgent] 📤 Sent ${audioChunkCount} audio chunks to Deepgram`);
              }
            } catch (error) {
              console.error('[VoiceAgent] Error sending audio to Deepgram:', error.message);
            }
          } else {
            if (!deepgramConnection) console.warn('[VoiceAgent] ⚠️ Received audio but Deepgram connection is null');
            if (!isActive)          console.warn('[VoiceAgent] ⚠️ Received audio but session is not active');
          }
        }

      } catch (error) {
        console.error('[VoiceAgent] Error processing message:', error);
        ws.send(JSON.stringify({
          type:    'error',
          message: 'Error processing message',
          error:   error.message,
        }));
      }
    });

    // ─── Handle disconnect ────────────────────────────────────────────────────
    ws.on('close', () => {
      console.log('[VoiceAgent] Client disconnected');
      cleanup();
    });

    ws.on('error', (error) => {
      console.error('[VoiceAgent] WebSocket error:', error.message);
      cleanup();
    });
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// Export setup function
// ─────────────────────────────────────────────────────────────────────────────
export const setupVoiceAgentWebSocket = (server) => {
  const wss = new WebSocketServer({
    server,
    path: '/api/voice/agent',
  });

  handleVoiceAgentWebSocket(wss);

  console.log('[VoiceAgent] ✅ WebSocket server initialized at /api/voice/agent');
  return wss;
};