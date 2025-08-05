import cron from 'node-cron';
import { User } from '@/models/User';
import { Progress } from '@/models/Progress';
import { sendMulticastNotification } from '@/config/firebase';
import mongoose from 'mongoose';

export class NotificationService {
  private static instance: NotificationService;
  private reminderJobs: Map<string, cron.ScheduledTask> = new Map();

  public static getInstance(): NotificationService {
    if (!NotificationService.instance) {
      NotificationService.instance = new NotificationService();
    }
    return NotificationService.instance;
  }

  public startReminderScheduler(): void {
    // Schedule reminders at 12:00, 18:00, 22:00, and 23:00 UTC
    const reminderTimes = [
      { time: '0 12 * * *', hour: 12 }, // 12:00 PM
      { time: '0 18 * * *', hour: 18 }, // 6:00 PM
      { time: '0 22 * * *', hour: 22 }, // 10:00 PM
      { time: '0 23 * * *', hour: 23 }, // 11:00 PM
    ];

    reminderTimes.forEach(({ time, hour }) => {
      const job = cron.schedule(time, async () => {
        await this.sendProgressReminders(hour);
      }, {
        scheduled: true,
        timezone: 'UTC'
      });

      this.reminderJobs.set(`reminder-${hour}`, job);
      console.log(`📅 Scheduled progress reminder for ${hour}:00 UTC`);
    });
  }

  private async sendProgressReminders(hour: number): Promise<void> {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Find users who haven't tracked progress today and have notifications enabled
      const users = await User.find({
        isActive: true,
        'settings.notificationsEnabled': true,
        'settings.reminderTimes': { $in: [`${hour}:00`] },
        fcmTokens: { $exists: true, $ne: [] },
      });

      if (users.length === 0) {
        console.log(`📱 No users to send reminders to at ${hour}:00`);
        return;
      }

      // Check which users haven't tracked progress today
      const usersNeedingReminders = [];
      const allTokens = [];

      for (const user of users) {
        const todayProgress = await Progress.findOne({
          userId: user._id,
          date: { $gte: today },
        });

        if (!todayProgress) {
          usersNeedingReminders.push(user);
          allTokens.push(...user.fcmTokens);
        }
      }

      if (allTokens.length === 0) {
        console.log(`✅ All users have already tracked progress today at ${hour}:00`);
        return;
      }

      // Send notification
      const title = this.getReminderTitle(hour);
      const body = this.getReminderBody(hour);

      await sendMulticastNotification(
        allTokens,
        title,
        body,
        {
          type: 'progress_reminder',
          hour: hour.toString(),
          timestamp: new Date().toISOString(),
        }
      );

      console.log(`📱 Sent progress reminders to ${usersNeedingReminders.length} users at ${hour}:00`);
    } catch (error) {
      console.error(`❌ Error sending progress reminders at ${hour}:00:`, error);
    }
  }

  private getReminderTitle(hour: number): string {
    const titles = {
      12: '🌟 Midday Progress Check!',
      18: '💪 Evening Fitness Update!',
      22: '📸 Quick Progress Snap!',
      23: '⏰ Last Chance Today!',
    };
    return titles[hour as keyof typeof titles] || '💪 Track Your Progress!';
  }

  private getReminderBody(hour: number): string {
    const bodies = {
      12: 'Take a moment to capture your fitness journey today! 📸',
      18: 'How did your workout go? Log your progress now! 🏋️‍♂️',
      22: "Don't forget to track today's progress! Quick and easy! ✨",
      23: 'Final reminder: Track your progress before midnight! 🌙',
    };
    return bodies[hour as keyof typeof bodies] || 'Time to track your fitness progress! 💪';
  }

  public async sendWelcomeNotification(userId: string, fcmTokens: string[]): Promise<void> {
    try {
      if (fcmTokens.length === 0) return;

      await sendMulticastNotification(
        fcmTokens,
        '🎉 Welcome to Gains!',
        'Start your fitness journey today! Take your first progress photos.',
        {
          type: 'welcome',
          userId,
          action: 'track_progress',
        }
      );

      console.log(`📱 Sent welcome notification to user ${userId}`);
    } catch (error) {
      console.error('❌ Error sending welcome notification:', error);
    }
  }

  public async sendTrialExpiryReminder(userId: string, fcmTokens: string[], daysLeft: number): Promise<void> {
    try {
      if (fcmTokens.length === 0) return;

      const title = daysLeft === 1 
        ? '⏰ Trial expires tomorrow!'
        : `⏰ ${daysLeft} days left in trial!`;

      const body = daysLeft === 1
        ? "Don't lose your progress! Upgrade to premium now."
        : `Continue your fitness journey with premium features. ${daysLeft} days remaining.`;

      await sendMulticastNotification(
        fcmTokens,
        title,
        body,
        {
          type: 'trial_expiry',
          userId,
          daysLeft: daysLeft.toString(),
          action: 'upgrade',
        }
      );

      console.log(`📱 Sent trial expiry reminder to user ${userId} (${daysLeft} days left)`);
    } catch (error) {
      console.error('❌ Error sending trial expiry reminder:', error);
    }
  }

  public async sendSubscriptionConfirmation(userId: string, fcmTokens: string[]): Promise<void> {
    try {
      if (fcmTokens.length === 0) return;

      await sendMulticastNotification(
        fcmTokens,
        '🎉 Welcome to Premium!',
        'You now have unlimited access to all features. Keep crushing your goals!',
        {
          type: 'subscription_confirmed',
          userId,
          action: 'track_progress',
        }
      );

      console.log(`📱 Sent subscription confirmation to user ${userId}`);
    } catch (error) {
      console.error('❌ Error sending subscription confirmation:', error);
    }
  }

  public async sendMotivationalMessage(userId: string, fcmTokens: string[], streak: number): Promise<void> {
    try {
      if (fcmTokens.length === 0) return;

      const motivationalMessages = [
        { streak: 3, title: '🔥 3-Day Streak!', body: 'You\'re on fire! Keep the momentum going!' },
        { streak: 7, title: '🌟 One Week Strong!', body: 'Amazing consistency! You\'re building great habits!' },
        { streak: 14, title: '💪 Two Weeks of Power!', body: 'Your dedication is inspiring! Keep pushing forward!' },
        { streak: 30, title: '🏆 30-Day Champion!', body: 'Incredible milestone! You\'re a true fitness warrior!' },
        { streak: 60, title: '🚀 60-Day Legend!', body: 'Outstanding commitment! You\'re unstoppable!' },
        { streak: 100, title: '👑 100-Day Master!', body: 'Legendary achievement! You\'ve built an unbreakable habit!' },
      ];

      const message = motivationalMessages.find(m => m.streak === streak);
      if (!message) return;

      await sendMulticastNotification(
        fcmTokens,
        message.title,
        message.body,
        {
          type: 'motivational',
          userId,
          streak: streak.toString(),
          action: 'view_progress',
        }
      );

      console.log(`📱 Sent motivational message to user ${userId} (${streak}-day streak)`);
    } catch (error) {
      console.error('❌ Error sending motivational message:', error);
    }
  }

  public stopAllReminders(): void {
    this.reminderJobs.forEach((job, key) => {
      job.stop();
      console.log(`🛑 Stopped reminder job: ${key}`);
    });
    this.reminderJobs.clear();
  }

  public async scheduleTrialExpiryReminders(): Promise<void> {
    // Schedule daily check for trial expiry reminders
    const job = cron.schedule('0 10 * * *', async () => {
      await this.checkAndSendTrialExpiryReminders();
    }, {
      scheduled: true,
      timezone: 'UTC'
    });

    this.reminderJobs.set('trial-expiry-check', job);
    console.log('📅 Scheduled daily trial expiry reminder check at 10:00 UTC');
  }

  private async checkAndSendTrialExpiryReminders(): Promise<void> {
    try {
      const now = new Date();
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      
      const twoDaysFromNow = new Date(now);
      twoDaysFromNow.setDate(twoDaysFromNow.getDate() + 2);

      // Find users whose trials expire in 1 or 2 days
      const expiringUsers = await User.find({
        isActive: true,
        'subscription.status': 'free_trial',
        'subscription.trialEndsAt': {
          $gte: now,
          $lte: twoDaysFromNow,
        },
        fcmTokens: { $exists: true, $ne: [] },
      });

      for (const user of expiringUsers) {
        const trialEndDate = new Date(user.subscription.trialEndsAt!);
        const daysLeft = Math.ceil((trialEndDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        
        if (daysLeft > 0 && daysLeft <= 2) {
          await this.sendTrialExpiryReminder((user._id as mongoose.Types.ObjectId).toString(), user.fcmTokens, daysLeft);
        }
      }
    } catch (error) {
      console.error('❌ Error checking trial expiry reminders:', error);
    }
  }
}

// Initialize the notification service
export const notificationService = NotificationService.getInstance();