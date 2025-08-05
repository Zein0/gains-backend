import { Router, Response } from 'express';
import { authenticateToken, updateFCMToken, AuthRequest } from '@/middleware/auth';
import { validate, schemas } from '@/middleware/validation';
import { asyncHandler } from '@/middleware/errorHandler';
import { User } from '@/models/User';
import { cache } from '@/config/redis';
import Logger from '@/services/logger';
import Joi from 'joi';

const router = Router();

// Login/Register (handled by Firebase Auth, this just updates FCM token)
const loginSchema = Joi.object({
  fcmToken: Joi.string(),
});

router.post('/login', 
  authenticateToken,
  validate(loginSchema),
  updateFCMToken,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const user = req.user!.dbUser;
    
    await Logger.logAuth('login', user._id.toString(), user.email, 'success', {
      displayName: user.displayName,
      subscription: user.subscription.status,
      fcmToken: req.body.fcmToken ? 'provided' : 'not_provided',
    }, req);
    
    res.json({
      success: true,
      data: {
        user: {
          id: user._id,
          email: user.email,
          displayName: user.displayName,
          photoURL: user.photoURL,
          subscription: user.subscription,
          settings: user.settings,
          profile: user.profile,
          isSubscriptionActive: user.isSubscriptionActive(),
          isTrialExpired: user.isTrialExpired(),
        },
        message: 'Login successful',
      },
    });
  })
);

// Logout (remove FCM token)
const logoutSchema = Joi.object({
  fcmToken: Joi.string().required(),
});

router.post('/logout',
  authenticateToken,
  validate(logoutSchema),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { fcmToken } = req.body;
    const userId = req.user!.userId;
    const user = req.user!.dbUser;
    
    // Remove FCM token from user
    await User.findByIdAndUpdate(userId, {
      $pull: { fcmTokens: fcmToken }
    });
    
    // Clear user cache
    const cacheKey = `user:${req.user!.uid}`;
    await cache.del(cacheKey);
    
    await Logger.logAuth('logout', userId.toString(), user.email, 'success', {
      fcmToken: 'removed',
    }, req);
    
    res.json({
      success: true,
      message: 'Logout successful',
    });
  })
);

// Refresh user data
router.get('/me',
  authenticateToken,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const user = req.user!.dbUser;
    
    res.json({
      success: true,
      data: {
        user: {
          id: user._id,
          firebaseUid: user.firebaseUid,
          email: user.email,
          displayName: user.displayName,
          photoURL: user.photoURL,
          phoneNumber: user.phoneNumber,
          isEmailVerified: user.isEmailVerified,
          subscription: user.subscription,
          settings: user.settings,
          profile: user.profile,
          isActive: user.isActive,
          lastActiveAt: user.lastActiveAt,
          createdAt: user.createdAt,
          isSubscriptionActive: user.isSubscriptionActive(),
          isTrialExpired: user.isTrialExpired(),
        },
      },
    });
  })
);

// Check subscription status
router.get('/subscription-status',
  authenticateToken,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const user = req.user!.dbUser;
    
    res.json({
      success: true,
      data: {
        status: user.subscription.status,
        isActive: user.isSubscriptionActive(),
        isTrialExpired: user.isTrialExpired(),
        trialEndsAt: user.subscription.trialEndsAt,
        currentPeriodStart: user.subscription.currentPeriodStart,
        currentPeriodEnd: user.subscription.currentPeriodEnd,
        canceledAt: user.subscription.canceledAt,
        plan: user.subscription.plan,
      },
    });
  })
);

// Update FCM token
const updateFCMTokenSchema = Joi.object({
  fcmToken: Joi.string().required(),
  oldToken: Joi.string(),
});

router.put('/fcm-token',
  authenticateToken,
  validate(updateFCMTokenSchema),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { fcmToken, oldToken } = req.body;
    const userId = req.user!.userId;
    
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found',
      });
    }
    
    // Remove old token if provided
    if (oldToken && user.fcmTokens.includes(oldToken)) {
      user.fcmTokens = user.fcmTokens.filter(token => token !== oldToken);
    }
    
    // Add new token if not already present
    if (!user.fcmTokens.includes(fcmToken)) {
      user.fcmTokens.push(fcmToken);
    }
    
    await user.save();
    
    // Update cache
    const cacheKey = `user:${req.user!.uid}`;
    await cache.set(cacheKey, JSON.stringify(user), 900);
    
    return res.json({
      success: true,
      message: 'FCM token updated successfully',
    });
  })
);

// Delete account
router.delete('/account',
  authenticateToken,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = req.user!.userId;
    const firebaseUid = req.user!.uid;
    const user = req.user!.dbUser;
    
    // Soft delete user (mark as inactive)
    await User.findByIdAndUpdate(userId, {
      isActive: false,
      deactivatedAt: new Date(),
    });
    
    // Clear cache
    const cacheKey = `user:${firebaseUid}`;
    await cache.del(cacheKey);
    
    await Logger.logAuth('account_deactivation', userId.toString(), user.email, 'success', {
      reason: 'user_request',
      subscription: user.subscription.status,
    }, req);
    
    res.json({
      success: true,
      message: 'Account deactivated successfully',
    });
  })
);

// Update user profile
router.put('/profile',
  authenticateToken,
  validate(schemas.updateProfile),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = req.user!.userId;
    const updates = req.body;
    
    const user = await User.findByIdAndUpdate(
      userId,
      { $set: updates },
      { new: true, runValidators: true }
    );
    
    // Update cache
    const cacheKey = `user:${req.user!.uid}`;
    await cache.set(cacheKey, JSON.stringify(user), 900);
    
    res.json({
      success: true,
      data: { user },
      message: 'Profile updated successfully',
    });
  })
);

export default router;
