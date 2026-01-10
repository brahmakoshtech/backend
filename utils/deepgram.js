/**
 * Deepgram Utility Service
 * Handles Deepgram Flux API for Speech-to-Text (STT)
 * Uses Flux model for conversational speech recognition
 */

// Note: Install with: npm install @deepgram/sdk
// For Node.js, we'll use a different approach if SDK is not available
let AsyncDeepgramClient = null;

try {
  const deepgramSdk = await import('@deepgram/sdk');
  AsyncDeepgramClient = deepgramSdk.AsyncDeepgramClient;
} catch (error) {
  console.warn('Deepgram SDK not installed. Install with: npm install @deepgram/sdk');
}
import dotenv from 'dotenv';

dotenv.config();

let deepgramClient = null;

/**
 * Get Deepgram client instance
 */
export const getDeepgramClient = () => {
  if (!deepgramClient) {
    const apiKey = process.env.DEEPGRAM_API_KEY;
    if (!apiKey) {
      throw new Error('DEEPGRAM_API_KEY is not configured in environment variables');
    }
    deepgramClient = new AsyncDeepgramClient(apiKey);
  }
  return deepgramClient;
};

/**
 * Create Deepgram Flux connection for real-time transcription
 * @param {Object} options - Connection options
 * @returns {Promise<Object>} Deepgram connection
 */
export const createDeepgramConnection = async (options = {}) => {
  const client = await getDeepgramClient();
  
  const {
    model = process.env.DEEPGRAM_MODEL || 'flux-general-en',
    encoding = process.env.DEEPGRAM_ENCODING || 'linear16',
    sample_rate = process.env.DEEPGRAM_SAMPLE_RATE || '16000',
    eot_threshold = parseFloat(process.env.DEEPGRAM_EOT_THRESHOLD || '0.7'),
    eager_eot_threshold = process.env.DEEPGRAM_EAGER_EOT_THRESHOLD 
      ? parseFloat(process.env.DEEPGRAM_EAGER_EOT_THRESHOLD) 
      : undefined,
    eot_timeout_ms = parseInt(process.env.DEEPGRAM_EOT_TIMEOUT_MS || '5000'),
    ...otherOptions
  } = options;

  const connectionOptions = {
    model,
    encoding,
    sample_rate,
    eot_threshold,
    eot_timeout_ms,
    ...otherOptions
  };

  // Add eager_eot_threshold only if configured
  if (eager_eot_threshold) {
    connectionOptions.eager_eot_threshold = eager_eot_threshold;
  }

  // Use v2/listen endpoint for Flux
  const connection = await client.listen.v2.connect(connectionOptions);
  
  return connection;
};

/**
 * Transcribe audio using Deepgram REST API (simpler and more reliable)
 * @param {Buffer} audioBuffer - Audio buffer to transcribe
 * @param {Object} options - Transcription options
 * @returns {Promise<string>} Transcribed text
 */
export const transcribeAudio = async (audioBuffer, options = {}) => {
  try {
    const apiKey = process.env.DEEPGRAM_API_KEY;
    if (!apiKey) {
      throw new Error('DEEPGRAM_API_KEY is not configured');
    }

    // Guard: ensure audio has content
    if (!audioBuffer || !audioBuffer.length || audioBuffer.length < 1024) {
      throw new Error('Audio buffer is empty or too small to transcribe');
    }

    const {
      model: requestedModel = process.env.DEEPGRAM_MODEL || 'flux-general-en',
      encoding: requestedEncoding = process.env.DEEPGRAM_ENCODING || undefined,
      sample_rate = process.env.DEEPGRAM_SAMPLE_RATE || 16000,
      language = 'en',
      ...otherOptions
    } = options;

    // If Flux model is requested, fallback to a v1-compatible model for REST calls
    // You can override fallback via DEEPGRAM_FALLBACK_MODEL env var
    const isFluxModel = typeof requestedModel === 'string' && requestedModel.includes('flux');
    const effectiveModel = isFluxModel
      ? (process.env.DEEPGRAM_FALLBACK_MODEL || 'nova-2-general')
      : requestedModel;

    // Use Deepgram REST API for transcription
    // Flux models require /v1/listen endpoint (v2 is for streaming, v1 for REST)
    const axios = (await import('axios')).default;
    
    // Deepgram v1 API endpoint (works for both regular and flux models)
    const endpoint = 'https://api.deepgram.com/v1/listen';
    
    // Build query parameters
    const params = {
      model: effectiveModel,
      language: language,
      punctuate: 'true',
      smart_format: 'true',
      ...otherOptions
    };
    
    // Decide how to pass encoding / sample_rate based on container
    const encoding = requestedEncoding || options.encoding || 'linear16';
    let contentType = 'application/octet-stream'; // Default

    if (encoding === 'webm') {
      // For WebM/Opus, let Deepgram auto-detect codec; don't send encoding/sample_rate
      contentType = 'audio/webm';
    } else if (encoding === 'ogg') {
      contentType = 'audio/ogg';
    } else {
      // For explicit encodings (wav, mp3, linear16, etc.) include encoding/sample_rate
      if (encoding) {
        params.encoding = encoding;
        if (sample_rate) {
          params.sample_rate = sample_rate;
        }
      }

      if (encoding === 'mp3') {
        contentType = 'audio/mpeg';
      } else if (encoding === 'wav') {
        contentType = 'audio/wav';
      } else if (encoding === 'linear16') {
        // We send linear16 as WAV container
        contentType = 'audio/wav';
      } else if (encoding) {
        contentType = `audio/${encoding}`;
      }
    }
    
    console.log('[Deepgram] Sending transcription request:', {
      endpoint: endpoint,
      contentType: contentType,
      encoding: encoding,
      model: effectiveModel,
      audioSize: audioBuffer.length,
      params: params
    });
    
    // Simple retry wrapper to handle transient network errors (e.g., ECONNRESET)
    const postWithRetry = async (attempt = 1) => {
      try {
        return await axios.post(
          endpoint,
          audioBuffer,
          {
            headers: {
              'Authorization': `Token ${apiKey}`,
              'Content-Type': contentType,
            },
            params: params,
            timeout: 30000, // 30 second timeout
          }
        );
      } catch (err) {
        const isRetryable = ['ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED'].includes(err.code);
        if (isRetryable && attempt < 2) {
          console.warn(`[Deepgram] Retry attempt ${attempt} after error:`, err.message);
          return postWithRetry(attempt + 1);
        }
        throw err;
      }
    };

    const response = await postWithRetry();

    // Extract transcript from response
    console.log('[Deepgram] Response received:', {
      status: response.status,
      hasResults: !!response.data?.results,
      hasChannels: !!response.data?.results?.channels,
      channelCount: response.data?.results?.channels?.length
    });
    
    if (response.data?.results?.channels?.[0]?.alternatives?.[0]?.transcript) {
      const transcript = response.data.results.channels[0].alternatives[0].transcript.trim();
      console.log('[Deepgram] Transcription successful:', { transcript, length: transcript.length });
      return transcript;
    }

    console.error('[Deepgram] No transcript in response:', {
      responseData: response.data,
      structure: {
        hasResults: !!response.data?.results,
        hasChannels: !!response.data?.results?.channels,
        channel0: response.data?.results?.channels?.[0],
        alternatives: response.data?.results?.channels?.[0]?.alternatives
      }
    });
    throw new Error('No transcript found in Deepgram response');
  } catch (error) {
    console.error('[Deepgram] Transcription error:', {
      message: error.message,
      status: error.response?.status,
      statusText: error.response?.statusText,
      data: error.response?.data,
      config: {
        url: error.config?.url,
        method: error.config?.method,
        headers: error.config?.headers,
        params: error.config?.params
      }
    });
    throw new Error(`Deepgram transcription failed: ${error.message}`);
  }
};

/**
 * Convert audio buffer to required format for Deepgram
 * @param {Buffer} audioBuffer - Raw audio buffer
 * @param {string} inputFormat - Input audio format
 * @returns {Buffer} Converted audio buffer
 */
export const prepareAudioForDeepgram = (audioBuffer, inputFormat = 'linear16') => {
  // For now, assume audio is already in linear16 format
  // In production, you might need to convert using ffmpeg or similar
  return audioBuffer;
};

