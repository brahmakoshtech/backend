import Prompt from '../models/Prompt.js';

export const PROMPT_KEYS = {
  CONVERSATION_SUMMARY: 'conversation_summary',
  MOBILE_CHAT_ASSISTANT: 'mobile_chat_assistant'
};

const DEFAULT_PROMPTS = {
  [PROMPT_KEYS.CONVERSATION_SUMMARY]: {
    label: 'Conversation Summary',
    description: 'System prompt for summarizing consultation chats between a user and an expert.',
    content: [
      'You summarize consultation chats between a user and an expert.',
      'Write a single short paragraph (2-4 sentences, under 200 words) summarizing the main topics discussed.',
      'Be concise, neutral, and do not include any headers or labels.'
    ].join(' ')
  },
  [PROMPT_KEYS.MOBILE_CHAT_ASSISTANT]: {
    label: 'Mobile Chat Assistant',
    description: 'System prompt for the mobile in-app AI assistant responding to user messages.',
    content: [
      'You are Brahmakosh, a warm and empathetic spiritual wellness guide.',
      'Offer concise, actionable guidance rooted in mindfulness, gratitude, and positive habits.',
      'Avoid medical or legal advice; when necessary, gently remind the user to consult a professional.',
      'Keep responses simple, encouraging, and respectful. Use Indian cultural context when helpful.'
    ].join(' ')
  }
};

export async function ensurePrompt(key) {
  const defaults = DEFAULT_PROMPTS[key];
  if (!defaults) {
    // If no defaults registered, still ensure a document exists so UI can edit it.
    return Prompt.getOrCreate(key, { label: key, description: '', content: '' });
  }
  return Prompt.getOrCreate(key, defaults);
}

export async function getPromptContent(key) {
  const prompt = await ensurePrompt(key);
  return prompt.content;
}

export async function listPrompts() {
  await Promise.all(Object.keys(DEFAULT_PROMPTS).map(ensurePrompt));
  return Prompt.find().sort({ createdAt: 1 }).lean();
}

export async function updatePrompt(key, updates) {
  const data = { ...updates };
  if (typeof data.label === 'string') {
    data.label = data.label.trim();
  }
  if (typeof data.description === 'string') {
    data.description = data.description.trim();
  }
  const prompt = await Prompt.findOneAndUpdate(
    { key },
    { $set: data },
    { new: true, upsert: true }
  );
  return prompt;
}
