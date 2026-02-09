import cron from 'node-cron';
import UserSankalp from '../models/UserSankalp.js';
import notificationService from './notificationService.js';

// Daily reminder at 9 AM
cron.schedule('0 9 * * *', async () => {
  console.log('Running daily sankalp reminder job...');
  
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Find all active sankalpas
    const activeSankalpas = await UserSankalp.find({ 
      status: 'active',
      startDate: { $lte: today },
      endDate: { $gte: today }
    }).populate('sankalpId userId');

    for (const userSankalp of activeSankalpas) {
      // Check if user already reported today
      const todayReport = userSankalp.dailyReports.find(r => {
        const reportDate = new Date(r.date);
        reportDate.setHours(0, 0, 0, 0);
        return reportDate.getTime() === today.getTime();
      });

      // Send reminder only if not reported yet
      if (!todayReport || todayReport.status === 'not_reported') {
        await notificationService.sendDailyReminder(
          userSankalp.userId._id,
          userSankalp._id,
          userSankalp.sankalpId.title
        );
      }
    }

    console.log(`Daily reminders sent to ${activeSankalpas.length} users`);
  } catch (error) {
    console.error('Error sending daily reminders:', error);
  }
});

console.log('✅ Daily sankalp reminder cron job scheduled at 9 AM');
