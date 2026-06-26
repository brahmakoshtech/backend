import Conversation from '../models/Conversation.js';

export const VOICE_CALL_RING_TIMEOUT_MS = 30_000;
export function normalizeConversationType(type) {
  return type === 'voice_call' ? 'voice_call' : 'chat';
}

export function isVoiceCallConversation(conversation) {
  if (!conversation) return false;
  return conversation.type === 'voice_call';
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
