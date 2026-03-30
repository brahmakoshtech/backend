import Notification from '../models/Notification.js';
import User from '../models/User.js';
import ClientNotificationCampaign from '../models/ClientNotificationCampaign.js';
import { sendFcmToTokens } from '../utils/fcmMessaging.js';

let schedulerStarted = false;
let isProcessing = false;

const normalizeUserIds = (ids = []) => {
  const unique = new Set(ids.map((id) => id?.toString()).filter(Boolean));
  return [...unique];
};

const sendCampaign = async (campaign) => {
  const validUsers = await User.find({
    _id: { $in: campaign.userIds || [] },
    clientId: campaign.clientId,
    isActive: true
  }).select('_id fcmTokens');

  const userIds = validUsers.map((u) => u._id.toString());
  const now = new Date();

  if (userIds.length === 0) {
    await ClientNotificationCampaign.findByIdAndUpdate(campaign._id, {
      status: 'failed',
      errorMessage: 'No valid active users found for this campaign',
      totalRecipients: 0,
      sentCount: 0,
      failedCount: 0
    });
    return;
  }

  const notificationDocs = userIds.map((userId) => ({
    userId,
    type: 'client_broadcast',
    title: campaign.name,
    message: campaign.description,
    data: {
      url: campaign.url || '',
      campaignId: campaign._id,
      groupId: campaign.groupId || null,
      clientId: campaign.clientId
    },
    sentAt: now
  }));

  await Notification.insertMany(notificationDocs);

  const fcmTokens = validUsers.flatMap((u) => (u.fcmTokens || []).map((t) => t.token).filter(Boolean));
  if (fcmTokens.length > 0) {
    try {
      await sendFcmToTokens(fcmTokens, {
        title: campaign.name,
        body: campaign.description,
        data: {
          type: 'client_broadcast',
          url: campaign.url || '',
          campaignId: String(campaign._id),
          groupId: campaign.groupId ? String(campaign.groupId) : '',
          clientId: String(campaign.clientId)
        }
      });
    } catch (e) {
      console.error('[ClientNotification] FCM push error:', e.message);
    }
  }

  await ClientNotificationCampaign.findByIdAndUpdate(campaign._id, {
    status: 'sent',
    sentAt: now,
    totalRecipients: userIds.length,
    sentCount: userIds.length,
    failedCount: 0,
    errorMessage: ''
  });
};

export const processDueClientNotificationCampaigns = async () => {
  if (isProcessing) return;
  isProcessing = true;

  try {
    const now = new Date();
    const campaigns = await ClientNotificationCampaign.find({
      status: 'scheduled',
      $or: [{ postType: 'immediate' }, { scheduledFor: { $lte: now } }]
    }).sort({ createdAt: 1 });

    for (const campaign of campaigns) {
      try {
        campaign.userIds = normalizeUserIds(campaign.userIds);
        await sendCampaign(campaign);
      } catch (error) {
        await ClientNotificationCampaign.findByIdAndUpdate(campaign._id, {
          status: 'failed',
          errorMessage: error.message || 'Failed to send campaign'
        });
      }
    }
  } finally {
    isProcessing = false;
  }
};

export const startClientNotificationScheduler = () => {
  if (schedulerStarted) return;
  schedulerStarted = true;

  processDueClientNotificationCampaigns().catch((error) => {
    console.error('[ClientNotificationScheduler] Initial run failed:', error.message);
  });

  setInterval(() => {
    processDueClientNotificationCampaigns().catch((error) => {
      console.error('[ClientNotificationScheduler] Scheduled run failed:', error.message);
    });
  }, 30 * 1000);
};
