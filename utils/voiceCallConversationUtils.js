import Conversation from '../models/Conversation.js';

export const VOICE_CALL_RING_TIMEOUT_MS = 30_000;

const VOICE_TYPE_ALIASES = new Set([
  'voice_call',
  'voicecall',
  'voice-call',
  'voice',
  'call'
]);

const CHAT_TYPE_ALIASES = new Set([
  'chat',
  'text',
  'consultation',
  'message'
]);

function normalizeTypeToken(value) {
  if (value == null || value === '') return null;
  return String(value).trim().toLowerCase().replace(/\s+/g, '_');
}

export function normalizeConversationType(type) {
  const normalized = normalizeTypeToken(type);
  if (!normalized) return 'chat';
  if (VOICE_TYPE_ALIASES.has(normalized)) return 'voice_call';
  if (CHAT_TYPE_ALIASES.has(normalized)) return 'chat';
  return 'chat';
}

/**
 * Resolve session kind from REST payloads sent by web/mobile clients.
 * Android often sends conversationType: "call" instead of type: "voice_call".
 */
export function resolveConversationKindFromRequest(payload = {}) {
  const booleanVoice =
    payload.isVoiceCall === true ||
    payload.isVoiceCall === 'true' ||
    payload.voiceCall === true ||
    payload.voiceCall === 'true';

  if (booleanVoice) {
    return 'voice_call';
  }

  const candidates = [
    payload.type,
    payload.conversationType,
    payload.callType,
    payload.serviceType,
    payload.mode,
    payload.requestType
  ];

  for (const candidate of candidates) {
    if (normalizeConversationType(candidate) === 'voice_call') {
      return 'voice_call';
    }
  }

  return 'chat';
}

export function isVoiceCallConversation(conversation) {
  if (!conversation) return false;
  return conversation.type === 'voice_call';
}

/**
 * When a mobile client starts voice on a pending chat session, convert or reuse
 * a dedicated voice_call conversation so the partner does not see a chat request.
 */
export async function ensureVoiceCallConversation(conversation) {
  if (!conversation || isVoiceCallConversation(conversation)) {
    return conversation;
  }

  if (conversation.status !== 'pending' || conversation.isAcceptedByPartner) {
    return conversation;
  }

  const userId = conversation.userId?._id?.toString() || conversation.userId?.toString();
  const partnerId = conversation.partnerId?._id?.toString() || conversation.partnerId?.toString();
  if (!userId || !partnerId) return conversation;

  const existingVoiceConv = await Conversation.findOne({
    userId,
    partnerId,
    type: 'voice_call',
    status: { $in: ['pending', 'accepted', 'active'] }
  });

  if (existingVoiceConv) {
    return existingVoiceConv;
  }

  conversation.type = 'voice_call';
  conversation.conversationType = 'call';
  await conversation.save();
  return conversation;
}

export async function closeVoiceCallConversation(conversationId, { reason = 'voice_call_ended' } = {}) {
  const conversation = await Conversation.findOne({ conversationId });
  if (!conversation || !isVoiceCallConversation(conversation)) {
    return null;
  }

  if (['ended', 'cancelled', 'rejected'].includes(conversation.status)) {
    return {
      conversation,
      userId: conversation.userId.toString(),
      partnerId: conversation.partnerId.toString(),
      payload: {
        conversationId,
        reason,
        endedAt: conversation.endedAt || new Date()
      },
      alreadyClosed: true
    };
  }

  const endedAt = new Date();
  const wasAccepted = conversation.isAcceptedByPartner;
  const originalStatus = conversation.status;

  if (originalStatus === 'pending' && !wasAccepted) {    conversation.status = reason === 'voice_call_rejected' ? 'rejected' : 'cancelled';
    if (reason === 'voice_call_rejected') {
      conversation.rejectedAt = endedAt;
    } else {
      conversation.cancelledAt = endedAt;
    }
  } else {
    conversation.status = 'ended';
  }

  conversation.endedAt = endedAt;
  conversation.voiceCallActive = false;
  await conversation.save();

  const payload = {    conversationId,
    reason,
    endedAt
  };

  return {
    conversation,
    userId: conversation.userId.toString(),
    partnerId: conversation.partnerId.toString(),
    payload,
    alreadyClosed: false
  };
}
