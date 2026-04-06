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
  let pushMetrics = { sentTokens: 0, failedTokens: 0, totalTokens: 0 };

  const fcmTokensCount = validUsers.reduce((sum, u) => sum + ((u.fcmTokens || []).length || 0), 0);
  console.log('[ClientNotification] Campaign send started', {
    campaignId: campaign?._id ? String(campaign._id) : undefined,
    clientId: campaign?.clientId ? String(campaign.clientId) : undefined,
    groupId: campaign?.groupId ? String(campaign.groupId) : null,
    postType: campaign?.postType,
    recipients: userIds.length,
    fcmTokensCount
  });

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
      campaignId: String(campaign._id),
      groupId: campaign.groupId ? String(campaign.groupId) : '',
      clientId: String(campaign.clientId)
    },
    sentAt: now
  }));

  await Notification.insertMany(notificationDocs);

  const fcmTokens = validUsers.flatMap((u) => (u.fcmTokens || []).map((t) => t.token).filter(Boolean));
  if (fcmTokens.length > 0) {
    try {
      const pushResult = await sendFcmToTokens(fcmTokens, {
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

      pushMetrics = {
        sentTokens: pushResult?.sent || 0,
        failedTokens: pushResult?.failed || 0,
        totalTokens: (pushResult?.sent || 0) + (pushResult?.failed || 0)
      };

      if (pushResult?.invalidTokens?.length) {
        // Remove invalid tokens so we stop sending to them.
        await User.updateMany(
          { 'fcmTokens.token': { $in: pushResult.invalidTokens } },
          { $pull: { fcmTokens: { token: { $in: pushResult.invalidTokens } } } }
        );

        console.log('[ClientNotification] Invalid tokens removed', {
          campaignId: String(campaign._id),
          removed: pushResult.invalidTokens.length
        });
      }
    } catch (e) {
      console.error('[ClientNotification] FCM push error:', e.message);
    }
  }

  const allTokensFailed = pushMetrics.totalTokens > 0 && pushMetrics.sentTokens === 0;
  const campaignUpdate = {
    status: allTokensFailed ? 'failed' : 'sent',
    sentAt: now,
    totalRecipients: userIds.length,
    totalTokens: pushMetrics.totalTokens,
    // store token delivery metrics
    sentCount: pushMetrics.sentTokens,
    failedCount: pushMetrics.failedTokens,
    errorMessage: allTokensFailed ? 'All device tokens failed to receive push' : ''
  };

  await ClientNotificationCampaign.findByIdAndUpdate(campaign._id, {
    ...campaignUpdate
  });

  console.log('[ClientNotification] Campaign send finished', {
    campaignId: String(campaign._id),
    status: campaignUpdate.status,
    totalTokens: campaignUpdate.totalTokens,
    sentTokens: campaignUpdate.sentCount,
    failedTokens: campaignUpdate.failedCount
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

    if (campaigns.length > 0) {
      console.log('[ClientNotificationScheduler] Due campaigns found', {
        count: campaigns.length,
        now: now.toISOString()
      });
    }

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
