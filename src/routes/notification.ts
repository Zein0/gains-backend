import { Router, Response } from 'express';
import { authenticateToken, AuthRequest } from '@/middleware/auth';
import { validate, schemas } from '@/middleware/validation';
import { asyncHandler } from '@/middleware/errorHandler';
import { User } from '@/models/User';
import { sendPushNotification } from '@/config/firebase';

const router = Router();

// Get notification settings
router.get('/settings',
  authenticateToken,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const user = req.user!.dbUser;
    
    res.json({
      success: true,
      data: {
        settings: user.settings,
      },
    });
  })
);

// Update notification settings
router.put('/settings',
  authenticateToken,
  validate(schemas.updateNotificationSettings),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = req.user!.userId;
    const { notificationsEnabled, reminderTimes } = req.body;
    
    const user = await User.findByIdAndUpdate(
      userId,
      {
        'settings.notificationsEnabled': notificationsEnabled,
        'settings.reminderTimes': reminderTimes,
      },
      { new: true }
    );
    
    res.json({
      success: true,
      data: { settings: user!.settings },
      message: 'Notification settings updated successfully',
    });
  })
);

// Send test notification (admin only)
router.post('/test',
  authenticateToken,
  validate(schemas.sendNotification),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { title, body, data, userId, userIds } = req.body;
    
    // For now, allow any authenticated user to send test notifications
    // In production, this should be admin-only
    let targetTokens: string[] = [];
    
    if (userId) {
      const user = await User.findById(userId);
      if (user) {
        targetTokens = user.fcmTokens;
      }
    } else if (userIds) {
      const users = await User.find({ _id: { $in: userIds } });
      targetTokens = users.flatMap(user => user.fcmTokens);
    } else {
      return res.status(400).json({
        success: false,
        error: 'Either userId or userIds must be provided',
      });
    }
    
    if (targetTokens.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No FCM tokens found for target users',
      });
    }
    
    try {
      const { sendMulticastNotification } = await import('@/config/firebase');
      await sendMulticastNotification(targetTokens, title, body, data);
      
      return res.json({
        success: true,
        message: `Test notification sent to ${targetTokens.length} devices`,
      });
    } catch (error) {
      console.error('Failed to send test notification:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to send notification',
      });
    }
  })
);

// Get notification history (if implemented)
router.get('/history',
  authenticateToken,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    // This would require a notifications collection to track sent notifications
    // For now, return empty array
    res.json({
      success: true,
      data: {
        notifications: [],
        message: 'Notification history feature not yet implemented',
      },
    });
  })
);

export default router;
