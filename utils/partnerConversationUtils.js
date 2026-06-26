import Conversation from '../models/Conversation.js';
import Partner from '../models/Partner.js';

export async function countActivePartnerConversations(partnerId) {
  return Conversation.countDocuments({
    partnerId,
    isAcceptedByPartner: true,
    status: { $in: ['accepted', 'active'] },
    type: { $ne: 'voice_call' }
  });
}

export async function syncPartnerActiveConversationCount(partnerId) {
  const actualCount = await countActivePartnerConversations(partnerId);
  const partner = await Partner.findById(partnerId);
  if (!partner) return { actualCount, partner: null };

  if (partner.activeConversationsCount !== actualCount) {
    partner.activeConversationsCount = actualCount;
    await partner.updateBusyStatus();
  }

  return { actualCount, partner };
}

export async function canPartnerAcceptConversation(partnerId) {
  const partner = await Partner.findById(partnerId);
  if (!partner) {
    return { allowed: false, message: 'Partner not found' };
  }

  const actualCount = await countActivePartnerConversations(partnerId);
  const maxConversations = partner.maxConversations ?? 10;

  if (partner.activeConversationsCount !== actualCount) {
    partner.activeConversationsCount = actualCount;
    await partner.updateBusyStatus();
  }

  if (actualCount >= maxConversations) {
    return {
      allowed: false,
      message: 'Maximum concurrent conversations reached. Please end some conversations first.',
      actualCount,
      maxConversations
    };
  }

  return { allowed: true, partner, actualCount, maxConversations };
}
