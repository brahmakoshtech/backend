import Partner from '../models/Partner.js';
import Client from '../models/Client.js';

const DEFAULT_CHAT_CCR = 0.5;
const DEFAULT_VOICE_CCR = 0.5;

export async function getClientCCRRates(clientId) {
  if (!clientId) return { chatCCR: DEFAULT_CHAT_CCR, voiceCCR: DEFAULT_VOICE_CCR };
  try {
    const client = await Client.findById(clientId).select('settings.chatCCR settings.voiceCCR').lean();
    return {
      chatCCR: client?.settings?.chatCCR ?? DEFAULT_CHAT_CCR,
      voiceCCR: client?.settings?.voiceCCR ?? DEFAULT_VOICE_CCR
    };
  } catch {
    return { chatCCR: DEFAULT_CHAT_CCR, voiceCCR: DEFAULT_VOICE_CCR };
  }
}

/**
 * Resolve billing rates for a partner session.
 * Expert chatCharge/voiceCharge (₹/min from admin dashboard) map 1:1 to credits/min when set.
 * Falls back to client CCR settings when expert charges are not configured.
 */
export async function getBillingRates(partnerId, clientId) {
  const partner = partnerId
    ? await Partner.findById(partnerId).select('chatCharge voiceCharge').lean()
    : null;
  const { chatCCR, voiceCCR } = await getClientCCRRates(clientId);

  const chatPerMinute = partner?.chatCharge > 0 ? Number(partner.chatCharge) : chatCCR * 60;
  const voicePerMinute = partner?.voiceCharge > 0 ? Number(partner.voiceCharge) : voiceCCR * 60;

  return {
    chatPerMessage: partner?.chatCharge > 0 ? chatPerMinute / 60 : chatCCR,
    voicePerSecond: partner?.voiceCharge > 0 ? voicePerMinute / 60 : voiceCCR,
    chatPerMinute,
    voicePerMinute,
    partnerChatPerMinute: chatPerMinute,
    partnerVoicePerMinute: voicePerMinute,
    chatCCR,
    voiceCCR
  };
}
