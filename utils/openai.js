/**
 * OpenAI Utility Service
 * Handles OpenAI API interactions for chat completions
 */

import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

// Initialize OpenAI client
let openaiClient = null;

const getOpenAIClient = () => {
  if (!openaiClient) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is not configured in environment variables');
    }
    openaiClient = new OpenAI({
      apiKey: apiKey
    });
  }
  return openaiClient;
};

/**
 * Get chat completion from OpenAI
 * @param {Array} messages - Array of message objects with role and content
 * @param {Object} options - Additional options (model, temperature, etc.)
 * @returns {Promise<Object>} OpenAI response
 */
export const getChatCompletion = async (messages, options = {}) => {
  try {
    const client = getOpenAIClient();
    
    const {
      model = process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature = parseFloat(process.env.OPENAI_TEMPERATURE || '0.7'),
      max_tokens = parseInt(process.env.OPENAI_MAX_TOKENS || '1000'),
      ...otherOptions
    } = options;

    const response = await client.chat.completions.create({
      model,
      messages,
      temperature,
      max_tokens,
      ...otherOptions
    });

    return {
      success: true,
      content: response.choices[0]?.message?.content || '',
      usage: response.usage,
      model: response.model
    };
  } catch (error) {
    console.error('OpenAI API Error:', error);
    throw new Error(`OpenAI API error: ${error.message}`);
  }
};

/**
 * Stream chat completion from OpenAI
 * @param {Array} messages - Array of message objects with role and content
 * @param {Object} options - Additional options
 * @returns {AsyncGenerator} Stream of response chunks
 */
export const streamChatCompletion = async function* (messages, options = {}) {
  try {
    const client = getOpenAIClient();
    
    const {
      model = process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature = parseFloat(process.env.OPENAI_TEMPERATURE || '0.7'),
      max_tokens = parseInt(process.env.OPENAI_MAX_TOKENS || '1000'),
      ...otherOptions
    } = options;

    const stream = await client.chat.completions.create({
      model,
      messages,
      temperature,
      max_tokens,
      stream: true,
      ...otherOptions
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || '';
      if (content) {
        yield content;
      }
    }
  } catch (error) {
    console.error('OpenAI Stream Error:', error);
    throw new Error(`OpenAI stream error: ${error.message}`);
  }
};

