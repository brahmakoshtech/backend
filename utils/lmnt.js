/**
 * LMNT Utility Service
 * Handles LMNT API for Text-to-Speech (TTS)
 */

import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Generate speech from text using LMNT
 * @param {string} text - Text to convert to speech
 * @param {Object} options - TTS options (voice, format, etc.)
 * @returns {Promise<Buffer>} Audio buffer
 */
export const generateSpeech = async (text, options = {}) => {
  try {
    const apiKey = process.env.LMNT_API_KEY;
    if (!apiKey) {
      throw new Error('LMNT_API_KEY is not configured in environment variables');
    }

    const {
      voice = process.env.LMNT_VOICE || 'leah',
      format = process.env.LMNT_FORMAT || 'mp3',
      speed = parseFloat(process.env.LMNT_SPEED || '1.0'),
      ...otherOptions
    } = options;

    const url = 'https://api.lmnt.com/v1/speech';
    const headers = {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    };

    const data = {
      text,
      voice,
      format,
      speed,
      ...otherOptions
    };

    const response = await axios.post(url, data, {
      headers,
      responseType: 'arraybuffer' // Get binary audio data
    });

    return Buffer.from(response.data);
  } catch (error) {
    console.error('LMNT API Error:', error.response?.data || error.message);
    throw new Error(`LMNT API error: ${error.message}`);
  }
};

/**
 * Stream speech generation (if supported)
 * @param {string} text - Text to convert to speech
 * @param {Object} options - TTS options
 * @returns {Promise<Stream>} Audio stream
 */
export const streamSpeech = async (text, options = {}) => {
  try {
    const apiKey = process.env.LMNT_API_KEY;
    if (!apiKey) {
      throw new Error('LMNT_API_KEY is not configured in environment variables');
    }

    const {
      voice = process.env.LMNT_VOICE || 'leah',
      format = process.env.LMNT_FORMAT || 'mp3',
      speed = parseFloat(process.env.LMNT_SPEED || '1.0'),
      ...otherOptions
    } = options;

    const url = 'https://api.lmnt.com/v1/speech';
    const headers = {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    };

    const data = {
      text,
      voice,
      format,
      speed,
      ...otherOptions
    };

    const response = await axios.post(url, data, {
      headers,
      responseType: 'stream'
    });

    return response.data;
  } catch (error) {
    console.error('LMNT Stream Error:', error.response?.data || error.message);
    throw new Error(`LMNT stream error: ${error.message}`);
  }
};

