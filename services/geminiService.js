import { GoogleGenerativeAI } from '@google/generative-ai';
import AppSettings from '../models/AppSettings.js';

/**
 * Get Gemini API key from database (AppSettings). Falls back to env GEMINI_API_KEY if not in DB.
 * @returns {Promise<string|null>}
 */
export async function getGeminiApiKey() {
  const settings = await AppSettings.getSettings();
  if (settings?.geminiApiKey) return settings.geminiApiKey.trim();
  return process.env.GEMINI_API_KEY?.trim() || null;
}

/**
 * Generate a short summary of conversation topics using Gemini.
 * @param {Array<{ content: string, senderModel?: string }>} messages - List of messages (content, optional senderModel)
 * @returns {Promise<string|null>} Summary text or null if API key missing or request fails
 */
export async function generateConversationSummary(messages) {
  const apiKey = await getGeminiApiKey();
  if (!apiKey) {
    console.warn('Gemini API key not configured. Skip conversation summary.');
    return null;
  }

  if (!messages || messages.length === 0) {
    return null;
  }

  const textMessages = messages
    .filter(m => m.content && typeof m.content === 'string')
    .map(m => {
      const who = m.senderModel === 'Partner' ? 'Expert' : 'User';
      return `${who}: ${m.content}`;
    });

  if (textMessages.length === 0) {
    return null;
  }

  const conversationText = textMessages.join('\n');
  const prompt = `You are summarizing a consultation chat between a user and an expert. Based on the following conversation, write a single short paragraph (2-4 sentences, under 200 words) describing the main topics they discussed. Be concise and neutral. Only output the summary, no labels or preamble.\n\nConversation:\n${conversationText}`;

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    const result = await model.generateContent(prompt);
    const response = result.response;
    if (!response || !response.text) return null;
    const summary = response.text().trim();
    return summary || null;
  } catch (err) {
    console.error('Gemini summary error:', err.message);
    return null;
  }
}
