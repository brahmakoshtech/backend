import { WebSocketServer } from 'ws';
import { createClient, LiveTranscriptionEvents } from '@deepgram/sdk';
import OpenAI from 'openai';
import fetch from 'node-fetch';
import Chat from '../../models/Chat.js';
import VoiceConfig from '../../models/voiceConfig.js';
import Agent from '../../models/Agent.js';
import { uploadBufferToS3 } from '../../utils/s3.js';

// ─── Validate environment variables ──────────────────────────────────────────
const deepgramApiKey   = process.env.DEEPGRAM_API_KEY;
const elevenLabsApiKey = process.env.ELEVENLABS_API_KEY;
const openaiApiKey     = process.env.OPENAI_API_KEY;

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

const FALLBACK_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || 'EXAVITQu4vr4xnSDxMaL';
const FALLBACK_MODEL_ID = 'eleven_turbo_v2_5';
const DEFAULT_PROMPT    = 'Give the answer within two lines.';
const VOICE_AGENT_AUDIO_FOLDER = 'voice-agent-audio';

// Deepgram closes idle connections after ~10 minutes, but to be safe we
// send a keepalive every 8 seconds while the mic is streaming.
const DEEPGRAM_KEEPALIVE_INTERVAL_MS = 8000;

/** Build WAV file from PCM 16-bit 16kHz mono buffer */
function pcmToWav(pcmBuffer) {
  const dataLen = pcmBuffer.length;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataLen, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(16000, 24);
  header.writeUInt32LE(32000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataLen, 40);
  return Buffer.concat([header, pcmBuffer]);
}

// ─────────────────────────────────────────────────────────────────────────────
// WebSocket Voice Agent Handler
// ─────────────────────────────────────────────────────────────────────────────
export const handleVoiceAgentWebSocket = (wss) => {
  wss.on('connection', async (ws, req) => {
    console.log('[VoiceAgent] New WebSocket connection');

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

    // ─── Session state ────────────────────────────────────────────────────────
    let deepgramConnection    = null;
    let keepaliveTimer        = null;
    let silenceTimer          = null;
    let accumulatedTranscript = '';
    let isProcessingLLM       = false;
    let chat                  = null;
    let userId                = null;
    let isActive              = false;
    let audioChunkCount       = 0;
    let voiceConfig           = null;
    let agentPromptOverride   = null;
    let agentFirstMessage     = null;
    let userAudioChunks       = [];
    let isReconnectingDG      = false;  // guard against concurrent reconnects

    // Audio chunks that arrived while Deepgram was reconnecting get queued
    // and flushed once the new connection is open.
    let pendingAudioChunks    = [];

    const SILENCE_THRESHOLD = 2000;

    // ─── Stop keepalive ───────────────────────────────────────────────────────
    const stopKeepalive = () => {
      if (keepaliveTimer) {
        clearInterval(keepaliveTimer);
        keepaliveTimer = null;
      }
    };

    // ─── Start keepalive ─────────────────────────────────────────────────────
    // Deepgram supports a KeepAlive message to prevent idle timeout.
    const startKeepalive = () => {
      stopKeepalive();
      keepaliveTimer = setInterval(() => {
        if (deepgramConnection) {
          try {
            deepgramConnection.keepAlive();
          } catch (e) {
            // ignore — reconnect will handle it
          }
        }
      }, DEEPGRAM_KEEPALIVE_INTERVAL_MS);
    };

    // ─── Full cleanup (session end) ───────────────────────────────────────────
    const cleanup = () => {
      console.log('[VoiceAgent] Cleaning up...');
      stopKeepalive();

      if (silenceTimer) {
        clearTimeout(silenceTimer);
        silenceTimer = null;
      }

      if (deepgramConnection) {
        try { deepgramConnection.finish(); } catch (_) {}
        deepgramConnection = null;
      }

      isActive        = false;
      audioChunkCount = 0;
      pendingAudioChunks = [];
      console.log('[VoiceAgent] Cleanup complete');
    };

    // ─── Initialize (or re-initialize) Deepgram ──────────────────────────────
    // This is called once on session start and again automatically whenever
    // Deepgram closes the connection unexpectedly.
    const initDeepgram = () => {
      return new Promise((resolve, reject) => {
        try {
          console.log('[VoiceAgent] Creating Deepgram connection...');

          const dgConn = deepgramClient.listen.live({
            model:            'nova-2',
            language:         'en',
            encoding:         'linear16',
            sample_rate:      16000,
            channels:         1,
            interim_results:  true,
            utterance_end_ms: 2000,
            vad_events:       true,
            punctuate:        true,
            smart_format:     true,
          });

          // ── Open ────────────────────────────────────────────────────────────
          dgConn.on(LiveTranscriptionEvents.Open, async () => {
            console.log('[VoiceAgent] ✅ Deepgram connection opened');
            deepgramConnection = dgConn;
            isReconnectingDG   = false;

            startKeepalive();

            // Flush any audio that arrived during reconnect
            if (pendingAudioChunks.length > 0) {
              console.log(`[VoiceAgent] Flushing ${pendingAudioChunks.length} pending audio chunks`);
              for (const chunk of pendingAudioChunks) {
                try { deepgramConnection.send(chunk); } catch (_) {}
              }
              pendingAudioChunks = [];
            }

            resolve(dgConn);
          });

          // ── Transcript ──────────────────────────────────────────────────────
          dgConn.on(LiveTranscriptionEvents.Transcript, async (data) => {
            const transcript  = data.channel?.alternatives?.[0]?.transcript;
            const isFinal     = data.is_final;
            const speechFinal = data.speech_final;

            if (transcript && transcript.trim()) {
              console.log('[VoiceAgent] 🎤 Transcript:', {
                text:       transcript,
                isFinal,
                speechFinal,
                confidence: data.channel?.alternatives?.[0]?.confidence,
              });

              ws.send(JSON.stringify({ type: 'transcript', text: transcript, isFinal }));

              if (isFinal) {
                accumulatedTranscript += (accumulatedTranscript ? ' ' : '') + transcript;

                if (silenceTimer) clearTimeout(silenceTimer);
                silenceTimer = setTimeout(async () => {
                  await processTurnComplete();
                }, SILENCE_THRESHOLD);
              }
            }
          });

          // ── UtteranceEnd ────────────────────────────────────────────────────
          dgConn.on(LiveTranscriptionEvents.UtteranceEnd, async () => {
            console.log('[VoiceAgent] 🔚 Utterance end detected');
            if (silenceTimer) clearTimeout(silenceTimer);
            await processTurnComplete();
          });

          // ── Metadata ────────────────────────────────────────────────────────
          dgConn.on(LiveTranscriptionEvents.Metadata, (data) => {
            console.log('[VoiceAgent] 📊 Metadata:', {
              request_id: data.request_id,
              model_info: data.model_info,
            });
          });

          // ── Error ───────────────────────────────────────────────────────────
          dgConn.on(LiveTranscriptionEvents.Error, (error) => {
            console.error('[VoiceAgent] ❌ Deepgram error:', {
              message: error.message,
              type:    error.type,
            });
            // Don't send error to client here — let the Close handler
            // attempt a reconnect first. Only surface if reconnect fails.
          });

          // ── Close ───────────────────────────────────────────────────────────
          // This is the key handler. Deepgram closes after ~10 min idle OR on
          // network issues. We auto-reconnect transparently so the user never
          // notices.
          dgConn.on(LiveTranscriptionEvents.Close, () => {
            console.log('[VoiceAgent] Deepgram connection closed');
            stopKeepalive();

            // Only reconnect if the session is still supposed to be active
            // and we're not already trying to reconnect.
            if (!isActive || isReconnectingDG) return;

            // Null out the old connection immediately so incoming audio
            // goes to the pending queue instead of throwing.
            deepgramConnection = null;
            isReconnectingDG   = true;

            console.log('[VoiceAgent] 🔄 Auto-reconnecting Deepgram in 500ms...');
            setTimeout(async () => {
              if (!isActive) return; // session may have ended during delay

              try {
                await initDeepgram();
                console.log('[VoiceAgent] ✅ Deepgram reconnected successfully');
              } catch (err) {
                console.error('[VoiceAgent] ❌ Deepgram reconnect failed:', err.message);
                isReconnectingDG = false;

                // Only now tell the client something went wrong
                try {
                  ws.send(JSON.stringify({
                    type:    'error',
                    message: 'Speech recognition disconnected. Please try again.',
                    error:   'DEEPGRAM_RECONNECT_FAILED',
                  }));
                } catch (_) {}
              }
            }, 500);
          });

          console.log('[VoiceAgent] Deepgram configured, waiting for open event...');

        } catch (err) {
          reject(err);
        }
      });
    };

    // ─── Stream TTS from ElevenLabs ──────────────────────────────────────────
    const streamElevenLabsTTS = async (text, ws) => {
      let audioKey = null;
      try {
        console.log('[VoiceAgent] 🔊 Starting ElevenLabs TTS...');

        const voiceId  = voiceConfig?.voiceId || FALLBACK_VOICE_ID;
        const modelId  = voiceConfig?.modelId || FALLBACK_MODEL_ID;
        const settings = voiceConfig?.voiceSettings || {
          stability:         0.5,
          similarity_boost:  0.75,
          style:             0.0,
          use_speaker_boost: true,
        };

        const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`;

        const response = await fetch(url, {
          method: 'POST',
          headers: {
            Accept:         'audio/mpeg',
            'Content-Type': 'application/json',
            'xi-api-key':   elevenLabsApiKey,
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

        const aiChunks = [];
        let chunkCount = 0;
        for await (const chunk of response.body) {
          if (!isActive) break;
          chunkCount++;
          aiChunks.push(chunk);
          ws.send(JSON.stringify({
            type:       'audio_chunk',
            audio:      chunk.toString('base64'),
            chunkIndex: chunkCount,
          }));
        }

        ws.send(JSON.stringify({ type: 'audio_complete', totalChunks: chunkCount }));

        if (aiChunks.length > 0 && process.env.AWS_BUCKET_NAME) {
          try {
            const buffer = Buffer.concat(aiChunks);
            const { key } = await uploadBufferToS3(
              buffer,
              VOICE_AGENT_AUDIO_FOLDER,
              `ai_${chat?._id}_${Date.now()}.mp3`,
              'audio/mpeg',
            );
            audioKey = key;
          } catch (e) {
            console.warn('[VoiceAgent] Could not save AI audio to S3:', e.message);
          }
        }

        console.log('[VoiceAgent] ✅ TTS complete:', chunkCount, 'chunks');
      } catch (error) {
        console.error('[VoiceAgent] ElevenLabs TTS error:', error.message);
        ws.send(JSON.stringify({ type: 'error', message: 'Error generating speech', error: error.message }));
      }
      return { audioKey };
    };

    // ─── Process complete conversation turn ───────────────────────────────────
    const processTurnComplete = async () => {
      if (!accumulatedTranscript.trim() || isProcessingLLM || !isActive) return;

      const userMessage     = accumulatedTranscript.trim();
      accumulatedTranscript = '';
      isProcessingLLM       = true;

      let userAudioKey = null;
      if (userAudioChunks.length > 0 && process.env.AWS_BUCKET_NAME) {
        try {
          const pcmBuffer = Buffer.concat(userAudioChunks);
          const wavBuffer = pcmToWav(pcmBuffer);
          const { key } = await uploadBufferToS3(
            wavBuffer,
            VOICE_AGENT_AUDIO_FOLDER,
            `user_${chat._id}_${Date.now()}.wav`,
            'audio/wav',
          );
          userAudioKey = key;
        } catch (e) {
          console.warn('[VoiceAgent] Could not save user audio to S3:', e.message);
        }
        userAudioChunks = [];
      }

      console.log('[VoiceAgent] 💬 Processing turn:', userMessage);

      try {
        chat.messages.push({
          role: 'user',
          content: userMessage,
          ...(userAudioKey && { audioKey: userAudioKey }),
        });
        await chat.save();

        ws.send(JSON.stringify({ type: 'user_message', text: userMessage }));

        const systemPrompt = agentPromptOverride || voiceConfig?.prompt || DEFAULT_PROMPT;
        const messages = [
          { role: 'system', content: systemPrompt },
          ...chat.messages.map(msg => ({ role: msg.role, content: msg.content })),
        ];

        const completion = await openai.chat.completions.create({
          model:       process.env.OPENAI_MODEL || 'gpt-4o-mini',
          messages,
          temperature: 0.7,
          max_tokens:  500,
        });

        const aiResponse = completion.choices[0].message.content;
        ws.send(JSON.stringify({ type: 'ai_response', text: aiResponse }));

        const { audioKey: aiAudioKey } = await streamElevenLabsTTS(aiResponse, ws);
        chat.messages.push({
          role: 'assistant',
          content: aiResponse,
          ...(aiAudioKey && { audioKey: aiAudioKey }),
        });
        await chat.save();

      } catch (error) {
        console.error('[VoiceAgent] Error processing turn:', error);
        ws.send(JSON.stringify({
          type:    'error',
          message: 'Error processing response',
          error:   error.message,
        }));
      } finally {
        isProcessingLLM = false;
        userAudioChunks = [];
      }
    };

    // ─── Handle incoming messages ─────────────────────────────────────────────
    ws.on('message', async (message) => {
      try {
        const data = JSON.parse(message);

        // ── START ─────────────────────────────────────────────────────────────
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

          // ── Resolve Agent ─────────────────────────────────────────────────
          let requestedVoice = data.voiceName || 'krishna1';
          if (data.agentId) {
            try {
              const agent = await Agent.findById(String(data.agentId)).lean();
              if (agent?.voiceName)     requestedVoice      = agent.voiceName;
              if (agent?.systemPrompt)  agentPromptOverride = agent.systemPrompt;
              if (agent?.firstMessage?.trim()) agentFirstMessage = agent.firstMessage.trim();
              console.log('[VoiceAgent] 🤖 Agent resolved:', {
                agentId:         agent?._id,
                name:            agent?.name,
                voiceName:       agent?.voiceName,
                hasPrompt:       !!agent?.systemPrompt,
                hasFirstMessage: !!agentFirstMessage,
              });
            } catch (e) {
              console.warn('[VoiceAgent] ⚠️ Could not resolve agentId:', e.message);
            }
          }

          // ── Resolve VoiceConfig ────────────────────────────────────────────
          voiceConfig = await VoiceConfig.findOne({ name: requestedVoice, isActive: true });
          if (!voiceConfig) {
            console.warn(`[VoiceAgent] ⚠️ Voice '${requestedVoice}' not found — using fallback`);
          } else {
            console.log(`[VoiceAgent] 🎙️ Voice resolved: ${voiceConfig.displayName} (${voiceConfig.voiceId})`);
          }

          // ── Find or create chat ────────────────────────────────────────────
          if (data.chatId && data.chatId !== 'new') {
            chat = await Chat.findOne({ _id: data.chatId, userId });
          }
          if (!chat) {
            chat = new Chat({
              userId,
              title:   'Voice Agent Chat',
              agentId: data.agentId ? String(data.agentId) : null,
              messages: [],
            });
            await chat.save();
            console.log('[VoiceAgent] Created new chat:', chat._id);
          }

          // ── Init Deepgram ──────────────────────────────────────────────────
          try {
            await initDeepgram();

            ws.send(JSON.stringify({
              type:      'deepgram_connected',
              message:   'Speech recognition active',
            }));

            ws.send(JSON.stringify({
              type:      'started',
              chatId:    chat._id,
              voiceName: voiceConfig?.name || requestedVoice,
              message:   'Voice agent started',
            }));

            // Play first message if configured (only on fresh start, not reconnect)
            if (agentFirstMessage && isActive) {
              try {
                ws.send(JSON.stringify({ type: 'ai_response', text: agentFirstMessage }));
                const { audioKey: firstAudioKey } = await streamElevenLabsTTS(agentFirstMessage, ws);
                chat.messages.push({
                  role: 'assistant',
                  content: agentFirstMessage,
                  ...(firstAudioKey && { audioKey: firstAudioKey }),
                });
                await chat.save();
              } catch (err) {
                console.error('[VoiceAgent] First message TTS error:', err.message);
              }
            }

          } catch (error) {
            console.error('[VoiceAgent] Failed to initialize Deepgram:', error);
            ws.send(JSON.stringify({
              type:    'error',
              message: 'Failed to initialize speech recognition',
              error:   error.message,
            }));
            cleanup();
          }

        // ── STOP ──────────────────────────────────────────────────────────────
        } else if (data.type === 'stop') {
          console.log('[VoiceAgent] Stop command received');
          cleanup();
          ws.send(JSON.stringify({ type: 'stopped', message: 'Voice agent stopped' }));

        // ── AUDIO ─────────────────────────────────────────────────────────────
        } else if (data.type === 'audio') {
          if (!isActive) return;

          const audioBuffer = Buffer.from(data.audio, 'base64');
          userAudioChunks.push(audioBuffer);

          if (deepgramConnection) {
            // Connection is healthy — send directly
            try {
              deepgramConnection.send(audioBuffer);
              audioChunkCount++;
              if (audioChunkCount % 50 === 0) {
                console.log(`[VoiceAgent] 📤 Sent ${audioChunkCount} audio chunks to Deepgram`);
              }
            } catch (error) {
              console.error('[VoiceAgent] Error sending audio to Deepgram:', error.message);
              // Queue for when reconnect completes
              pendingAudioChunks.push(audioBuffer);
            }
          } else if (isReconnectingDG) {
            // Reconnect is in progress — buffer the chunk
            pendingAudioChunks.push(audioBuffer);
          } else {
            console.warn('[VoiceAgent] ⚠️ Deepgram not connected and no reconnect in progress — dropping chunk');
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

    // ─── Client disconnect / error ────────────────────────────────────────────
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
export const setupVoiceAgentWebSocket = (server) => {
  const wss = new WebSocketServer({
    server,
    path: '/api/voice/agent',
  });

  handleVoiceAgentWebSocket(wss);

  console.log('[VoiceAgent] ✅ WebSocket server initialized at /api/voice/agent');
  return wss;
};