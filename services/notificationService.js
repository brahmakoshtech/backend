import Notification from '../models/Notification.js';
import axios from 'axios';

// Brevo Email Service
const sendEmail = async (to, subject, htmlContent) => {
  if (!process.env.USE_BREVO || !process.env.BREVO_API_KEY) return;
  
  try {
    await axios.post('https://api.brevo.com/v3/smtp/email', {
      sender: { name: process.env.BREVO_FROM_NAME, email: process.env.BREVO_FROM_EMAIL },
      to: [{ email: to }],
      subject,
      htmlContent
    }, {
      headers: {
        'api-key': process.env.BREVO_API_KEY,
        'Content-Type': 'application/json'
      }
    });
    console.log('✅ Email sent to:', to);
  } catch (error) {
    console.error('❌ Email error:', error.response?.data || error.message);
  }
};

// Twilio SMS Service
const sendSMS = async (to, message) => {
  if (!process.env.TWILIO_WHATSAPP_ENABLED || !process.env.TWILIO_WHATSAPP_ACCOUNT_SID) return;
  
  try {
    const auth = Buffer.from(`${process.env.TWILIO_WHATSAPP_ACCOUNT_SID}:${process.env.TWILIO_WHATSAPP_AUTH_TOKEN}`).toString('base64');
    await axios.post(
      `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_WHATSAPP_ACCOUNT_SID}/Messages.json`,
      new URLSearchParams({
        To: to,
        MessagingServiceSid: process.env.TWILIO_WHATSAPP_MESSAGING_SERVICE_SID,
        Body: message
      }),
      { headers: { 'Authorization': `Basic ${auth}` } }
    );
    console.log('✅ SMS sent to:', to);
  } catch (error) {
    console.error('❌ SMS error:', error.response?.data || error.message);
  }
};

// Twilio WhatsApp Service
const sendWhatsApp = async (to, message) => {
  if (!process.env.TWILIO_WHATSAPP_ENABLED || !process.env.TWILIO_WHATSAPP_FROM) return;
  
  try {
    const auth = Buffer.from(`${process.env.TWILIO_WHATSAPP_ACCOUNT_SID}:${process.env.TWILIO_WHATSAPP_AUTH_TOKEN}`).toString('base64');
    await axios.post(
      `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_WHATSAPP_ACCOUNT_SID}/Messages.json`,
      new URLSearchParams({
        To: `whatsapp:${to}`,
        From: process.env.TWILIO_WHATSAPP_FROM,
        Body: message
      }),
      { headers: { 'Authorization': `Basic ${auth}` } }
    );
    console.log('✅ WhatsApp sent to:', to);
  } catch (error) {
    console.error('❌ WhatsApp error:', error.response?.data || error.message);
  }
};

class NotificationService {
  // Send daily reminder
  async sendDailyReminder(userId, userSankalpId, sankalpTitle) {
    try {
      const User = (await import('../models/User.js')).default;
      const user = await User.findById(userId);

      const notification = new Notification({
        userId,
        type: 'daily_reminder',
        title: '🙏 Daily Sankalp Reminder',
        message: `Don't forget to complete your "${sankalpTitle}" today!`,
        data: { userSankalpId }
      });
      await notification.save();

      if (user?.email) {
        await sendEmail(
          user.email,
          '🙏 Daily Sankalp Reminder',
          `<h2>Time to practice!</h2><p>Don't forget to complete your <strong>${sankalpTitle}</strong> today!</p>`
        );
      }

      if (user?.mobile) {
        await sendSMS(user.mobile, `🙏 Reminder: Complete your ${sankalpTitle} practice today!`);
        await sendWhatsApp(user.mobile, `🙏 Reminder: Complete your ${sankalpTitle} practice today!`);
      }

      return notification;
    } catch (error) {
      console.error('Error sending daily reminder:', error);
      throw error;
    }
  }

  // Send streak alert
  async sendStreakAlert(userId, userSankalpId, streak, sankalpTitle) {
    try {
      const User = (await import('../models/User.js')).default;
      const user = await User.findById(userId);

      const notification = new Notification({
        userId,
        type: 'streak_alert',
        title: `🔥 ${streak} Day Streak!`,
        message: `Amazing! You're on a ${streak}-day streak for "${sankalpTitle}". Keep it up!`,
        data: { userSankalpId, streak }
      });
      await notification.save();

      if (user?.email) {
        await sendEmail(
          user.email,
          `🔥 ${streak} Day Streak!`,
          `<h2>Amazing Achievement!</h2><p>You're on a <strong>${streak}-day streak</strong> for ${sankalpTitle}. Keep it up!</p>`
        );
      }

      if (user?.mobile) {
        await sendSMS(user.mobile, `🔥 ${streak} Day Streak! Amazing progress on ${sankalpTitle}. Keep it up!`);
        await sendWhatsApp(user.mobile, `🔥 ${streak} Day Streak! Amazing progress on ${sankalpTitle}. Keep it up!`);
      }

      return notification;
    } catch (error) {
      console.error('Error sending streak alert:', error);
      throw error;
    }
  }

  // Send completion notification
  async sendCompletionNotification(userId, userSankalpId, sankalpTitle, karmaEarned) {
    try {
      const User = (await import('../models/User.js')).default;
      const user = await User.findById(userId);

      const notification = new Notification({
        userId,
        type: 'completion',
        title: '🎉 Sankalp Completed!',
        message: `Congratulations! You completed "${sankalpTitle}" and earned ${karmaEarned} karma points!`,
        data: { userSankalpId, karmaEarned }
      });
      await notification.save();

      if (user?.email) {
        await sendEmail(
          user.email,
          '🎉 Sankalp Completed!',
          `<h2>Congratulations!</h2><p>You completed <strong>${sankalpTitle}</strong> and earned <strong>${karmaEarned} karma points</strong>!</p>`
        );
      }

      if (user?.mobile) {
        await sendSMS(user.mobile, `🎉 Congratulations! You completed ${sankalpTitle} and earned ${karmaEarned} karma points!`);
        await sendWhatsApp(user.mobile, `🎉 Congratulations! You completed ${sankalpTitle} and earned ${karmaEarned} karma points!`);
      }

      return notification;
    } catch (error) {
      console.error('Error sending completion notification:', error);
      throw error;
    }
  }

  // Send milestone notification
  async sendMilestoneNotification(userId, userSankalpId, milestone, sankalpTitle) {
    try {
      const notification = new Notification({
        userId,
        type: 'milestone',
        title: `🏆 ${milestone}% Complete!`,
        message: `You're ${milestone}% done with "${sankalpTitle}". Keep going!`,
        data: {
          userSankalpId
        }
      });
      await notification.save();
      return notification;
    } catch (error) {
      console.error('Error sending milestone notification:', error);
      throw error;
    }
  }

  // Get user notifications
  async getUserNotifications(userId, limit = 20, skip = 0) {
    try {
      const notifications = await Notification.find({ userId })
        .sort({ createdAt: -1 })
        .limit(limit)
        .skip(skip);
      
      const unreadCount = await Notification.countDocuments({ userId, isRead: false });
      
      return {
        notifications,
        unreadCount
      };
    } catch (error) {
      console.error('Error fetching notifications:', error);
      throw error;
    }
  }

  // Mark notification as read
  async markAsRead(notificationId, userId) {
    try {
      const notification = await Notification.findOneAndUpdate(
        { _id: notificationId, userId },
        { isRead: true, readAt: new Date() },
        { new: true }
      );
      return notification;
    } catch (error) {
      console.error('Error marking notification as read:', error);
      throw error;
    }
  }

  // Mark all as read
  async markAllAsRead(userId) {
    try {
      await Notification.updateMany(
        { userId, isRead: false },
        { isRead: true, readAt: new Date() }
      );
      return true;
    } catch (error) {
      console.error('Error marking all as read:', error);
      throw error;
    }
  }
}

export default new NotificationService();
