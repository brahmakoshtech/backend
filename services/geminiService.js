import { getChatCompletionFromDb } from '../utils/openai.js';
import { getPromptContent, PROMPT_KEYS } from './promptService.js';

const FALLBACK_SUMMARY_PROMPT = [
  'You summarize consultation chats between a user and an expert.',
  'Write a single short paragraph (2-4 sentences, under 200 words) summarizing the main topics discussed.',
  'Be concise, neutral, and do not include any headers or labels.'
].join(' ');

/**
 * Generate a short summary of conversation topics using OpenAI.
 * @param {Array<{ content: string, senderModel?: string }>} messages - List of messages (content, optional senderModel)
 * @param {string|null} [clientId] - kept for API compatibility, currently unused
 * @returns {Promise<string|null>} Summary text or null if request fails
 */
export async function generateConversationSummary(messages, clientId = null) {
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

  let systemPrompt = FALLBACK_SUMMARY_PROMPT;
  try {
    const storedPrompt = await getPromptContent(PROMPT_KEYS.CONVERSATION_SUMMARY);
    if (storedPrompt && typeof storedPrompt === 'string') {
      systemPrompt = storedPrompt;
    }
  } catch (promptErr) {
    console.warn('Failed to load summary prompt from database. Using fallback.', promptErr.message);
  }

  const chatMessages = [
    {
      role: 'system',
      content: systemPrompt
    },
    {
      role: 'user',
      content: `Conversation:\n${conversationText}`
    }
  ];

  try {
    const result = await getChatCompletionFromDb(chatMessages, {
      max_tokens: 256,
      temperature: 0.3
    }, clientId);

    if (!result?.success || !result.content) {
      return null;
    }

    const summary = String(result.content).trim();
    return summary || null;
  } catch (err) {
    console.error('OpenAI summary error:', err.message);
    return null;
  }
}

