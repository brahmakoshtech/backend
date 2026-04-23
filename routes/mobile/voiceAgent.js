import { WebSocketServer } from 'ws';
import { createClient, LiveTranscriptionEvents } from '@deepgram/sdk';
import OpenAI from 'openai';
import fetch from 'node-fetch';
import Chat from '../../models/Chat.js';
import VoiceConfig from '../../models/voiceConfig.js';
import Agent from '../../models/Agent.js';
import User from '../../models/User.js';
import Client from '../../models/Client.js';
import { uploadBufferToS3 } from '../../utils/s3.js';

const DEFAULT_AGENT_VOICE_CCR = 0.5;

const getAgentVoiceCCR = async (clientId) => {
  if (!clientId) return DEFAULT_AGENT_VOICE_CCR;
  try {
    const client = await Client.findById(clientId).select('settings.voiceCCR').lean();
    return client?.settings?.voiceCCR ?? DEFAULT_AGENT_VOICE_CCR;
  } catch { return DEFAULT_AGENT_VOICE_CCR; }
};

// ─── Validate environment variables ──────────────────────────────────────────
const deepgramApiKey   = process.env.DEEPGRAM_API_KEY;
const elevenLabsApiKey = process.env.ELEVENLABS_API_KEY;
const openaiApiKey     = process.env.OPENAI_API_KEY;

console.log('[VoiceAgent] API Keys Status:');
console.log('  Deepgram:',   deepgramApiKey   ? `${deepgramApiKey.substring(0, 4)}...` : '❌ MISSING');
console.log('  OpenAI:',     openaiApiKey     ? `${openaiApiKey.substring(0, 7)}...`   : '❌ MISSING');
console.log('  ElevenLabs:', elevenLabsApiKey ? `${elevenLabsApiKey.substring(0, 4)}...` : '❌ MISSING');

// ─── Initialize clients ───────────────────────────────────────────────────────
let deepgramClient = null;
let openai         = null;

if (deepgramApiKey) {
  deepgramClient = createClient(deepgramApiKey);
  console.log('[VoiceAgent] ✅ Deepgram client initialized');
}
if (openaiApiKey) {
  openai = new OpenAI({ apiKey: openaiApiKey });
  console.log('[VoiceAgent] ✅ OpenAI client initialized');
}

const FALLBACK_VOICE_ID           = process.env.ELEVENLABS_VOICE_ID || 'EXAVITQu4vr4xnSDxMaL';
const FALLBACK_MODEL_ID           = 'eleven_turbo_v2_5';
const DEFAULT_PROMPT              = 'You are a helpful spiritual guide. Keep answers concise.';
const VOICE_AGENT_AUDIO_FOLDER    = 'voice-agent-audio';
const DEEPGRAM_KEEPALIVE_MS       = 8_000;
const DEEPGRAM_RECONNECT_DELAY_MS = 500;
const SILENCE_THRESHOLD_MS        = 800;

// ─── Helpers ──────────────────────────────────────────────────────────────────
const isValidObjectId = (id) => /^[a-f\d]{24}$/i.test(String(id ?? ''));

function pcmToWav(pcmBuffer) {
  const dataLen = pcmBuffer.length;
  const header  = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataLen, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1,  20);
  header.writeUInt16LE(1,  22);
  header.writeUInt32LE(16000, 24);
  header.writeUInt32LE(32000, 28);
  header.writeUInt16LE(2,  32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataLen, 40);
  return Buffer.concat([header, pcmBuffer]);
}

// ─────────────────────────────────────────────────────────────────────────────
export const handleVoiceAgentWebSocket = (wss) => {
  wss.on('connection', async (ws) => {
    console.log('[VoiceAgent] New WebSocket connection');

    if (!deepgramApiKey || !openaiApiKey || !elevenLabsApiKey) {
      ws.send(JSON.stringify({ type: 'error', message: 'Server configuration error: Missing API keys', error: 'MISSING_API_KEYS' }));
      ws.close();
      return;
    }

    // ─── Per-connection state ─────────────────────────────────────────────────
    let deepgramConnection    = null;
    let keepaliveTimer        = null;
    let silenceTimer          = null;
    let accumulatedTranscript = '';
    let isProcessingLLM       = false;
    let chat                  = null;
    let userId                = null;
    let isActive              = false;   // master gate for all async callbacks
    let audioChunkCount       = 0;
    let voiceConfig           = null;
    let agentPromptOverride   = null;
    let agentFirstMessage     = null;
    let userAudioChunks       = [];
    let isReconnectingDG      = false;
    let pendingAudioChunks    = [];
    let firstMessageSent      = false;  // ensures first message plays only once
    let currentTTSAbortCtrl   = null;   // abort current TTS when user interrupts

    // ── Keepalive ──────────────────────────────────────────────────────────────
    const stopKeepalive = () => {
      if (keepaliveTimer) { clearInterval(keepaliveTimer); keepaliveTimer = null; }
    };
    const startKeepalive = () => {
      stopKeepalive();
      keepaliveTimer = setInterval(() => {
        if (deepgramConnection && isActive) {
          try { deepgramConnection.keepAlive(); } catch (_) {}
        }
      }, DEEPGRAM_KEEPALIVE_MS);
    };

    // ── Safe send (never throws after disconnect) ─────────────────────────────
    const safeSend = (payload) => {
      if (ws.readyState === ws.OPEN) {
        try { ws.send(JSON.stringify(payload)); } catch (_) {}
      }
    };

    // ── Full session cleanup ───────────────────────────────────────────────────
    const cleanup = () => {
      if (!isActive && !deepgramConnection) return;
      console.log('[VoiceAgent] Cleaning up session...');

      isActive = false;  // ← gates ALL async callbacks from here on

      stopKeepalive();
      if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null; }

      if (deepgramConnection) {
        try { deepgramConnection.finish(); } catch (_) {}
        deepgramConnection = null;
      }

      audioChunkCount    = 0;
      pendingAudioChunks = [];
      userAudioChunks    = [];
      isReconnectingDG   = false;
      firstMessageSent   = false;
      console.log('[VoiceAgent] Cleanup complete');
    };

    // ── Initialize (or re-initialize) Deepgram ────────────────────────────────
    const initDeepgram = () => new Promise((resolve, reject) => {
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

        // OPEN
        dgConn.on(LiveTranscriptionEvents.Open, () => {
          if (!isActive) {
            try { dgConn.finish(); } catch (_) {}
            return;
          }
          console.log('[VoiceAgent] ✅ Deepgram connection opened');
          deepgramConnection = dgConn;
          isReconnectingDG   = false;
          startKeepalive();

          if (pendingAudioChunks.length > 0) {
            console.log(`[VoiceAgent] Flushing ${pendingAudioChunks.length} pending audio chunks`);
            for (const chunk of pendingAudioChunks) {
              try { deepgramConnection.send(chunk); } catch (_) {}
            }
            pendingAudioChunks = [];
          }
          resolve(dgConn);
        });

        // TRANSCRIPT
        dgConn.on(LiveTranscriptionEvents.Transcript, async (data) => {
          if (!isActive) return;

          const transcript = data.channel?.alternatives?.[0]?.transcript;
          const isFinal    = data.is_final;
          if (!transcript?.trim()) return;

          console.log('[VoiceAgent] 🎤 Transcript:', { text: transcript, isFinal, confidence: data.channel?.alternatives?.[0]?.confidence });
          safeSend({ type: 'transcript', text: transcript, isFinal });

          if (isFinal) {
            accumulatedTranscript += (accumulatedTranscript ? ' ' : '') + transcript;
            if (silenceTimer) clearTimeout(silenceTimer);
            silenceTimer = setTimeout(async () => {
              if (!isActive) return;
              await processTurnComplete();
            }, SILENCE_THRESHOLD_MS);
          }
        });

        // UTTERANCE END
        dgConn.on(LiveTranscriptionEvents.UtteranceEnd, async () => {
          if (!isActive) return;
          console.log('[VoiceAgent] 🔚 Utterance end detected');
          if (silenceTimer) clearTimeout(silenceTimer);
          await processTurnComplete();
        });

        // METADATA
        dgConn.on(LiveTranscriptionEvents.Metadata, (data) => {
          console.log('[VoiceAgent] 📊 Metadata:', { request_id: data.request_id });
        });

        // ERROR
        dgConn.on(LiveTranscriptionEvents.Error, (error) => {
          console.error('[VoiceAgent] ❌ Deepgram error:', error.message);
        });

        // CLOSE — reconnect transparently if session is still active
        dgConn.on(LiveTranscriptionEvents.Close, () => {
          console.log('[VoiceAgent] Deepgram connection closed');
          stopKeepalive();

          if (!isActive) {
            console.log('[VoiceAgent] Session inactive — skipping reconnect');
            return;
          }
          if (isReconnectingDG) return;

          deepgramConnection = null;
          isReconnectingDG   = true;

          console.log(`[VoiceAgent] 🔄 Auto-reconnecting Deepgram in ${DEEPGRAM_RECONNECT_DELAY_MS}ms...`);
          setTimeout(async () => {
            if (!isActive) { isReconnectingDG = false; return; }
            try {
              await initDeepgram();
              console.log('[VoiceAgent] ✅ Deepgram reconnected successfully');
            } catch (err) {
              console.error('[VoiceAgent] ❌ Deepgram reconnect failed:', err.message);
              isReconnectingDG = false;
              safeSend({ type: 'error', message: 'Speech recognition lost. Please restart.', error: 'DEEPGRAM_RECONNECT_FAILED' });
            }
          }, DEEPGRAM_RECONNECT_DELAY_MS);
        });

      } catch (err) {
        reject(err);
      }
    });

    // ── ElevenLabs TTS ────────────────────────────────────────────────────────
    const streamElevenLabsTTS = async (text) => {
      let audioKey = null;
      const abortCtrl = new AbortController();
      currentTTSAbortCtrl = abortCtrl;
      try {
        console.log('[VoiceAgent] 🔊 Starting ElevenLabs TTS...');

        const voiceId  = voiceConfig?.voiceId  || FALLBACK_VOICE_ID;
        const modelId  = voiceConfig?.modelId  || FALLBACK_MODEL_ID;
        const settings = voiceConfig?.voiceSettings || { stability: 0.5, similarity_boost: 0.75, style: 0.0, use_speaker_boost: true };

        const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`, {
          method:  'POST',
          headers: { Accept: 'audio/mpeg', 'Content-Type': 'application/json', 'xi-api-key': elevenLabsApiKey },
          body:    JSON.stringify({ text, model_id: modelId, voice_settings: settings }),
          signal:  abortCtrl.signal,
        });

        if (!response.ok) {
          throw new Error(`ElevenLabs ${response.status}: ${await response.text()}`);
        }

        const aiChunks = [];
        let chunkCount = 0;
        let sendBuffer = Buffer.alloc(0);
        const MIN_CHUNK_SIZE = 4096; // Send chunks of at least 4KB

        for await (const chunk of response.body) {
          if (!isActive || abortCtrl.signal.aborted) break;
          chunkCount++;
          aiChunks.push(chunk);
          sendBuffer = Buffer.concat([sendBuffer, chunk]);

          // Only send when buffer is large enough
          if (sendBuffer.length >= MIN_CHUNK_SIZE) {
            safeSend({ type: 'audio_chunk', audio: sendBuffer.toString('base64'), chunkIndex: chunkCount });
            sendBuffer = Buffer.alloc(0);
          }
        }

        // Send remaining buffer
        if (sendBuffer.length > 0 && !abortCtrl.signal.aborted) {
          safeSend({ type: 'audio_chunk', audio: sendBuffer.toString('base64'), chunkIndex: chunkCount });
        }

        if (!abortCtrl.signal.aborted) {
          safeSend({ type: 'audio_complete', totalChunks: chunkCount });
        }
        console.log('[VoiceAgent] ✅ TTS complete:', chunkCount, 'chunks');

        if (aiChunks.length > 0 && process.env.AWS_BUCKET_NAME && !abortCtrl.signal.aborted) {
          try {
            const { key } = await uploadBufferToS3(Buffer.concat(aiChunks), VOICE_AGENT_AUDIO_FOLDER, `ai_${chat?._id}_${Date.now()}.mp3`, 'audio/mpeg');
            audioKey = key;
          } catch (e) {
            console.warn('[VoiceAgent] S3 upload failed (AI audio):', e.message);
          }
        }
      } catch (error) {
        if (error.name === 'AbortError') {
          console.log('[VoiceAgent] ⏹️ TTS aborted - user interrupted');
        } else {
          console.error('[VoiceAgent] ElevenLabs TTS error:', error.message);
          if (isActive) safeSend({ type: 'error', message: 'Error generating speech', error: error.message });
        }
      } finally {
        if (currentTTSAbortCtrl === abortCtrl) currentTTSAbortCtrl = null;
      }
      return { audioKey };
    };

    // ── Process one conversation turn ─────────────────────────────────────────
    const processTurnComplete = async () => {
      if (!isActive)                     return;
      if (!accumulatedTranscript.trim()) return;

      // If AI is currently speaking, abort it and let user's new question take over
      if (currentTTSAbortCtrl) {
        console.log('[VoiceAgent] ⏹️ User interrupted - aborting current TTS');
        currentTTSAbortCtrl.abort();
        currentTTSAbortCtrl = null;
        safeSend({ type: 'audio_interrupted' });
      }

      if (isProcessingLLM)               return;

      const userMessage     = accumulatedTranscript.trim();
      accumulatedTranscript = '';
      isProcessingLLM       = true;

      let userAudioKey = null;
      if (userAudioChunks.length > 0 && process.env.AWS_BUCKET_NAME) {
        try {
          const { key } = await uploadBufferToS3(pcmToWav(Buffer.concat(userAudioChunks)), VOICE_AGENT_AUDIO_FOLDER, `user_${chat._id}_${Date.now()}.wav`, 'audio/wav');
          userAudioKey = key;
        } catch (e) {
          console.warn('[VoiceAgent] S3 upload failed (user audio):', e.message);
        }
      }
      userAudioChunks = [];

      console.log('[VoiceAgent] 💬 Processing turn:', userMessage);

      try {
        // Credit check before processing
        const userDoc = await User.findById(userId);
        if (!userDoc || userDoc.credits <= 0) {
          safeSend({ type: 'error', message: 'Insufficient credits', error: 'INSUFFICIENT_CREDITS', remainingBalance: userDoc?.credits ?? 0 });
          cleanup();
          return;
        }

        const clientId = userDoc.clientId?._id || userDoc.clientId;
        const voiceCCR = await getAgentVoiceCCR(clientId);

        chat.messages.push({ role: 'user', content: userMessage, ...(userAudioKey && { audioKey: userAudioKey }) });
        await chat.save();

        safeSend({ type: 'user_message', text: userMessage });
        if (!isActive) return;

        const systemPrompt = agentPromptOverride || voiceConfig?.prompt || DEFAULT_PROMPT;
        const completion   = await openai.chat.completions.create({
          model:       process.env.OPENAI_MODEL || 'gpt-4o-mini',
          messages:    [
            { role: 'system', content: systemPrompt },
            ...chat.messages.map(m => ({ role: m.role, content: m.content })),
          ],
          temperature: 0.7,
          max_tokens:  500,
        });

        if (!isActive) return;

        const aiResponse = completion.choices[0].message.content;
        safeSend({ type: 'ai_response', text: aiResponse });

        const { audioKey: aiAudioKey } = await streamElevenLabsTTS(aiResponse);

        // Deduct credit after successful response
        const newBalance = Math.max(0, userDoc.credits - voiceCCR);
        userDoc.credits = newBalance;
        await userDoc.save();
        safeSend({ type: 'credit:update', creditsDeducted: voiceCCR, remainingBalance: newBalance });

        if (newBalance <= 0) {
          safeSend({ type: 'error', message: 'Insufficient credits', error: 'INSUFFICIENT_CREDITS', remainingBalance: 0 });
          cleanup();
        }

        if (isActive) {
          chat.messages.push({ role: 'assistant', content: aiResponse, ...(aiAudioKey && { audioKey: aiAudioKey }) });
          await chat.save();
        }
      } catch (error) {
        console.error('[VoiceAgent] Error processing turn:', error);
        if (isActive) safeSend({ type: 'error', message: 'Error processing response', error: error.message });
      } finally {
        isProcessingLLM = false;
      }
    };

    // ─── Incoming message handler ─────────────────────────────────────────────
    ws.on('message', async (message) => {
      try {
        const data = JSON.parse(message);

        // ── START ──────────────────────────────────────────────────────────────
        if (data.type === 'start') {
          if (isActive) {
            console.log('[VoiceAgent] Re-start on active session — resetting');
            cleanup();
          }

          console.log('[VoiceAgent] Start command received:', { chatId: data.chatId, userId: data.userId, agentId: data.agentId });

          // ── Token verification ──────────────────────────────────────────────
          const token = data.token;
          if (!token) {
            safeSend({ type: 'error', message: 'Authentication required', error: 'NO_TOKEN' });
            ws.close();
            return;
          }
          try {
            const jwt = await import('jsonwebtoken');
            const decoded = jwt.default.verify(token, process.env.JWT_SECRET);
            if (decoded.role !== 'user') {
              safeSend({ type: 'error', message: 'Access denied', error: 'INVALID_ROLE' });
              ws.close();
              return;
            }
            userId = decoded.userId; // Use token userId, NOT client-provided userId
          } catch (jwtErr) {
            safeSend({ type: 'error', message: 'Invalid or expired token', error: 'INVALID_TOKEN' });
            ws.close();
            return;
          }
          isActive            = true;
          agentPromptOverride = null;
          agentFirstMessage   = null;

          // Resolve Agent
          let requestedVoice = data.voiceName || 'krishna1';
          if (data.agentId && isValidObjectId(data.agentId)) {
            try {
              const agent = await Agent.findById(data.agentId).lean();
              if (agent?.voiceName)            requestedVoice      = agent.voiceName;
              if (agent?.systemPrompt)         agentPromptOverride = agent.systemPrompt;
              if (agent?.firstMessage?.trim()) agentFirstMessage   = agent.firstMessage.trim();
              console.log('[VoiceAgent] 🤖 Agent resolved:', { name: agent?.name, voiceName: agent?.voiceName });
            } catch (e) {
              console.warn('[VoiceAgent] ⚠️ Could not resolve agentId:', e.message);
            }
          } else if (data.agentId) {
            console.log(`[VoiceAgent] ℹ️ Skipping non-ObjectId agentId: "${data.agentId}" — using default voice`);
          }

          // Resolve VoiceConfig
          voiceConfig = await VoiceConfig.findOne({ name: requestedVoice, isActive: true });
          if (!voiceConfig) {
            console.warn(`[VoiceAgent] ⚠️ Voice "${requestedVoice}" not found — using fallback`);
          } else {
            console.log(`[VoiceAgent] 🎙️ Voice: ${voiceConfig.displayName} (${voiceConfig.voiceId})`);
          }

          // Find or create chat
          if (data.chatId && data.chatId !== 'new') {
            chat = await Chat.findOne({ _id: data.chatId, userId });
          }
          if (!chat) {
            chat = new Chat({ userId, title: 'Voice Chat', agentId: isValidObjectId(data.agentId) ? data.agentId : null, messages: [] });
            await chat.save();
            console.log('[VoiceAgent] Created new chat:', chat._id);
          }

          // Init Deepgram
          try {
            await initDeepgram();
          } catch (error) {
            console.error('[VoiceAgent] Failed to initialize Deepgram:', error);
            safeSend({ type: 'error', message: 'Failed to initialize speech recognition', error: error.message });
            cleanup();
            return;
          }

          safeSend({ type: 'deepgram_connected', message: 'Speech recognition active' });
          safeSend({ type: 'started', chatId: chat._id, voiceName: voiceConfig?.name || requestedVoice, message: 'Voice agent started' });

          // First message — only once per session, never on Deepgram reconnects
          if (agentFirstMessage && isActive && !firstMessageSent) {
            firstMessageSent = true;
            try {
              safeSend({ type: 'ai_response', text: agentFirstMessage });
              const { audioKey } = await streamElevenLabsTTS(agentFirstMessage);
              if (isActive) {
                chat.messages.push({ role: 'assistant', content: agentFirstMessage, ...(audioKey && { audioKey }) });
                await chat.save();
              }
            } catch (err) {
              console.error('[VoiceAgent] First message TTS error:', err.message);
            }
          }

        // ── STOP ──────────────────────────────────────────────────────────────
        } else if (data.type === 'stop') {
          console.log('[VoiceAgent] Stop command received');
          cleanup();
          safeSend({ type: 'stopped', message: 'Voice agent stopped' });

        // ── AUDIO ─────────────────────────────────────────────────────────────
        } else if (data.type === 'audio') {
          if (!isActive) return;

          const audioBuffer = Buffer.from(data.audio, 'base64');
          userAudioChunks.push(audioBuffer);

          if (deepgramConnection) {
            try {
              deepgramConnection.send(audioBuffer);
              audioChunkCount++;
              if (audioChunkCount % 50 === 0) {
                console.log(`[VoiceAgent] 📤 Sent ${audioChunkCount} audio chunks to Deepgram`);
              }
            } catch (error) {
              console.error('[VoiceAgent] Error sending audio chunk:', error.message);
              pendingAudioChunks.push(audioBuffer);
            }
          } else if (isReconnectingDG) {
            pendingAudioChunks.push(audioBuffer);
          }
        }

      } catch (error) {
        console.error('[VoiceAgent] Error handling message:', error);
        safeSend({ type: 'error', message: 'Error processing message', error: error.message });
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
  const wss = new WebSocketServer({ server, path: '/api/voice/agent' });
  handleVoiceAgentWebSocket(wss);
  console.log('[VoiceAgent] ✅ WebSocket server initialized at /api/voice/agent');
  return wss;
};