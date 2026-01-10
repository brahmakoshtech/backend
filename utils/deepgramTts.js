/**
 * Deepgram Text-to-Speech (TTS) utility
 * Uses Deepgram's streaming TTS WebSocket API to synthesize speech.
 *
 * Docs: https://developers.deepgram.com/docs/streaming-text-to-speech
 */

import dotenv from 'dotenv';

dotenv.config();

let createClient;
let LiveTTSEvents;
let dgTtsClient = null;

// Lazy-load Deepgram SDK so startup doesn't fail if dependency missing
const getDeepgramTtsClient = async () => {
  if (!dgTtsClient) {
    if (!createClient || !LiveTTSEvents) {
      try {
        const sdk = await import('@deepgram/sdk');
        createClient = sdk.createClient;
        LiveTTSEvents = sdk.LiveTTSEvents;
      } catch (err) {
        console.error('[Deepgram TTS] Failed to import @deepgram/sdk:', err.message);
        throw new Error('Deepgram SDK (@deepgram/sdk) is not installed. Please run: npm install @deepgram/sdk');
      }
    }

    // Allow a dedicated TTS key; fall back to general Deepgram key if needed
    const apiKey = process.env.DEEPGRAM_TTS_API_KEY || process.env.DEEPGRAM_API_KEY;
    if (!apiKey) {
      throw new Error('Deepgram TTS key is not configured. Set DEEPGRAM_TTS_API_KEY or DEEPGRAM_API_KEY in environment variables');
    }

    dgTtsClient = createClient(apiKey);
  }

  return { client: dgTtsClient, LiveTTSEvents };
};

// Build a simple WAV header for 16‑bit PCM audio
const createWavHeader = (dataLength, {
  sampleRate = 48000,
  numChannels = 1,
  bitsPerSample = 16
} = {}) => {
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const header = Buffer.alloc(44);

  header.write('RIFF', 0); // ChunkID
  header.writeUInt32LE(36 + dataLength, 4); // ChunkSize
  header.write('WAVE', 8); // Format

  header.write('fmt ', 12); // Subchunk1ID
  header.writeUInt32LE(16, 16); // Subchunk1Size (16 for PCM)
  header.writeUInt16LE(1, 20); // AudioFormat (1 = PCM)
  header.writeUInt16LE(numChannels, 22); // NumChannels
  header.writeUInt32LE(sampleRate, 24); // SampleRate
  header.writeUInt32LE(byteRate, 28); // ByteRate
  header.writeUInt16LE(blockAlign, 32); // BlockAlign
  header.writeUInt16LE(bitsPerSample, 34); // BitsPerSample

  header.write('data', 36); // Subchunk2ID
  header.writeUInt32LE(dataLength, 40); // Subchunk2Size

  return header;
};

/**
 * Generate speech audio from text using Deepgram TTS (streaming WebSocket).
 *
 * @param {string} text - Text to convert to speech
 * @param {Object} options - TTS options
 * @returns {Promise<Buffer>} - WAV audio buffer (16‑bit PCM)
 */
export const generateDeepgramSpeech = async (text, options = {}) => {
  if (!text || !text.trim()) {
    throw new Error('Text is required for TTS');
  }

  const { client, LiveTTSEvents } = await getDeepgramTtsClient();

  const {
    model = process.env.DEEPGRAM_TTS_MODEL || 'aura-2-thalia-en',
    sampleRate = 48000,
    encoding = 'linear16'
  } = options;

  return new Promise((resolve, reject) => {
    const connection = client.speak.live({
      model,
      encoding,
      sample_rate: sampleRate
    });

    const audioChunks = [];
    let resolved = false;

    const cleanupAndResolve = (buffer) => {
      if (resolved) return;
      resolved = true;
      try {
        connection.close();
      } catch {
        // ignore close errors
      }
      resolve(buffer);
    };

    const cleanupAndReject = (err) => {
      if (resolved) return;
      resolved = true;
      try {
        connection.close();
      } catch {
        // ignore close errors
      }
      reject(err);
    };

    // Safety timeout so we don't hang forever (60s to allow for cold starts / latency)
    const timeoutMs = 60000;
    const timeoutId = setTimeout(() => {
      console.error('[Deepgram TTS] Timeout waiting for TTS audio');
      cleanupAndReject(new Error('Deepgram TTS timeout'));
    }, timeoutMs);

    connection.on(LiveTTSEvents.Open, () => {
      console.log('[Deepgram TTS] Connection opened');
      // Send the text and then flush, per Deepgram docs
      connection.sendText(text);
      connection.flush();
    });

    // Fallback: if we get audio chunks but Flushed doesn't fire, return after a short delay
    let audioReceivedTimeout = null;
    const checkAndResolveAudio = () => {
      if (audioChunks.length > 0 && !resolved) {
        console.log('[Deepgram TTS] Resolving with collected audio chunks (Flushed may not fire)');
        clearTimeout(timeoutId);
        clearTimeout(audioReceivedTimeout);
        const pcmData = Buffer.concat(audioChunks);
        const header = createWavHeader(pcmData.length, {
          sampleRate,
          numChannels: 1,
          bitsPerSample: 16
        });
        const wavBuffer = Buffer.concat([header, pcmData]);
        cleanupAndResolve(wavBuffer);
      }
    };

    connection.on(LiveTTSEvents.Audio, (data) => {
      // Data is raw PCM bytes
      audioChunks.push(Buffer.from(data));
      console.log('[Deepgram TTS] Audio chunk received:', { size: data.length, totalChunks: audioChunks.length });
      
      // If we have audio chunks, set a fallback timeout to resolve after 1.5 seconds of no new chunks
      // This handles cases where Flushed event doesn't fire but we have audio
      if (audioChunks.length > 0) {
        clearTimeout(audioReceivedTimeout);
        audioReceivedTimeout = setTimeout(() => {
          if (!resolved) {
            console.log('[Deepgram TTS] No more audio chunks for 1.5s, resolving with collected audio');
            checkAndResolveAudio();
          }
        }, 1500);
      }
    });

    connection.on(LiveTTSEvents.Flushed, () => {
      console.log('[Deepgram TTS] Flushed event received');
      clearTimeout(timeoutId);
      clearTimeout(audioReceivedTimeout);
      const pcmData = Buffer.concat(audioChunks);
      const header = createWavHeader(pcmData.length, {
        sampleRate,
        numChannels: 1,
        bitsPerSample: 16
      });
      const wavBuffer = Buffer.concat([header, pcmData]);
      cleanupAndResolve(wavBuffer);
    });

    connection.on(LiveTTSEvents.Error, (err) => {
      console.error('[Deepgram TTS] Error event:', err);
      clearTimeout(timeoutId);
      cleanupAndReject(new Error(`Deepgram TTS error: ${err.message || err}`));
    });

    connection.on(LiveTTSEvents.Close, () => {
      console.log('[Deepgram TTS] Connection closed');
      clearTimeout(timeoutId);
      if (!resolved) {
        // If closed before Flushed, still try to return what we have
        const pcmData = Buffer.concat(audioChunks);
        if (pcmData.length > 0) {
          const header = createWavHeader(pcmData.length, {
            sampleRate,
            numChannels: 1,
            bitsPerSample: 16
          });
          const wavBuffer = Buffer.concat([header, pcmData]);
          cleanupAndResolve(wavBuffer);
        } else {
          cleanupAndReject(new Error('Deepgram TTS connection closed with no audio data'));
        }
      }
    });
  });
};


