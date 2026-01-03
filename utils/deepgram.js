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

    const {
      model = process.env.DEEPGRAM_MODEL || 'flux-general-en',
      encoding = process.env.DEEPGRAM_ENCODING || 'linear16',
      sample_rate = process.env.DEEPGRAM_SAMPLE_RATE || 16000,
      language = 'en',
      ...otherOptions
    } = options;

    // Use Deepgram REST API for transcription
    // Flux models require /v2/listen endpoint
    const axios = (await import('axios')).default;
    
    // Determine endpoint based on model
    const endpoint = model.includes('flux') 
      ? 'https://api.deepgram.com/v2/listen' 
      : 'https://api.deepgram.com/v1/listen';
    
    // For v2 endpoint, use different parameter structure
    // For webm format, omit encoding and sample_rate (auto-detect)
    const params = model.includes('flux')
      ? {
          model: model,
          ...(encoding && encoding !== 'webm' ? { encoding } : {}),
          ...(encoding && encoding !== 'webm' && sample_rate ? { sample_rate } : {}),
          language: language,
          punctuate: true,
          smart_format: true,
          ...otherOptions
        }
      : {
          model: model,
          encoding: encoding,
          sample_rate: sample_rate,
          language: language,
          punctuate: true,
          smart_format: true,
          ...otherOptions
        };
    
    const response = await axios.post(
      endpoint,
      audioBuffer,
      {
        headers: {
          'Authorization': `Token ${apiKey}`,
          'Content-Type': encoding === 'webm' || encoding === 'mp3' || encoding === 'wav'
            ? `audio/${encoding}`
            : encoding === 'linear16'
            ? 'audio/raw'
            : `audio/${encoding}`,
        },
        params: params,
        timeout: 30000, // 30 second timeout
      }
    );

    // Extract transcript from response
    if (response.data?.results?.channels?.[0]?.alternatives?.[0]?.transcript) {
      return response.data.results.channels[0].alternatives[0].transcript.trim();
    }

    throw new Error('No transcript found in Deepgram response');
  } catch (error) {
    console.error('Deepgram transcription error:', error.response?.data || error.message);
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

