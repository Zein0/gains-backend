import { Request, Response, NextFunction } from 'express';
import { verifyFirebaseToken, getFirebaseUser } from '@/config/firebase';
import { User } from '@/models/User';
import { cache } from '@/config/redis';
import Logger from '@/services/logger';

export interface AuthRequest extends Request {
  user?: {
    uid: string;
    email: string;
    userId: string;
    dbUser: any;
  };
}

export const authenticateToken = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      res.status(401).json({ error: 'Access token required' });
      return;
    }

    // Verify Firebase token
    const decodedToken = await verifyFirebaseToken(token);
    
    // Check cache first
    const cacheKey = `user:${decodedToken.uid}`;
    let user = null;
    
    const cachedUser = await cache.get(cacheKey);
    if (cachedUser) {
      user = JSON.parse(cachedUser);
    } else {
      // Find user in database
      user = await User.findOne({ firebaseUid: decodedToken.uid });
      
      if (!user) {
        // Create user if doesn't exist
        const firebaseUser = await getFirebaseUser(decodedToken.uid);
        
        user = new User({
          firebaseUid: decodedToken.uid,
          email: decodedToken.email || firebaseUser.email,
          displayName: decodedToken.name || firebaseUser.displayName,
          photoURL: decodedToken.picture || firebaseUser.photoURL,
          phoneNumber: decodedToken.phone_number || firebaseUser.phoneNumber,
          isEmailVerified: decodedToken.email_verified || firebaseUser.emailVerified,
        });
        
        await user.save();
        console.log(`✅ New user created: ${user.email}`);
      }
      
      // Cache user for 15 minutes
      await cache.set(cacheKey, JSON.stringify(user), 900);
    }

    // Update last active
    await User.findByIdAndUpdate(user._id, { lastActiveAt: new Date() });

    // Attach user info to request
    req.user = {
      uid: decodedToken.uid,
      email: decodedToken.email!,
      userId: user._id.toString(),
      dbUser: user,
    };

    next();
  } catch (error) {
    await Logger.logAuth('failed_login', undefined, req.headers.authorization ? 'token_provided' : undefined, 'failure', {
      error: error instanceof Error ? error.message : 'Unknown error',
      userAgent: req.headers['user-agent'],
      ip: req.ip,
    }, req);
    
    console.error('❌ Authentication failed:', error);
    res.status(401).json({ error: 'Invalid or expired token' });
  }
};

export const optionalAuth = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      next();
      return;
    }

    // Try to authenticate, but don't fail if token is invalid
    try {
      await authenticateToken(req, res, next);
    } catch (error) {
      // Ignore authentication errors for optional auth
      console.warn('⚠️ Optional auth failed:', error);
    }

    next();
  } catch (error) {
    next();
  }
};

export const requireSubscription = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const user = req.user.dbUser;
    
    // Check if user has active subscription or is in trial
    if (!user.isSubscriptionActive()) {
      res.status(403).json({ 
        error: 'Active subscription required',
        subscriptionStatus: user.subscription.status,
        trialExpired: user.isTrialExpired(),
      });
      return;
    }

    next();
  } catch (error) {
    console.error('❌ Subscription check failed:', error);
    res.status(500).json({ error: 'Failed to verify subscription' });
  }
};

export const requirePremium = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const user = req.user.dbUser;
    
    // Check if user has active paid subscription (not trial)
    if (user.subscription.status !== 'active') {
      res.status(403).json({ 
        error: 'Premium subscription required',
        subscriptionStatus: user.subscription.status,
        message: 'This feature requires a premium subscription',
      });
      return;
    }

    next();
  } catch (error) {
    console.error('❌ Premium check failed:', error);
    res.status(500).json({ error: 'Failed to verify premium status' });
  }
};

export const adminOnly = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    // Check if user has admin role in Firebase custom claims
    const decodedToken = await verifyFirebaseToken(req.headers.authorization!.split(' ')[1]);
    
    if (!decodedToken.admin) {
      res.status(403).json({ error: 'Admin access required' });
      return;
    }

    next();
  } catch (error) {
    console.error('❌ Admin check failed:', error);
    res.status(403).json({ error: 'Access denied' });
  }
};

export const updateFCMToken = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const fcmToken = req.headers['fcm-token'] as string;
    
    if (fcmToken && req.user) {
      const user = await User.findById(req.user.userId);
      if (user && !user.fcmTokens.includes(fcmToken)) {
        user.fcmTokens.push(fcmToken);
        await user.save();
        
        // Update cache
        const cacheKey = `user:${req.user.uid}`;
        await cache.set(cacheKey, JSON.stringify(user), 900);
      }
    }

    next();
  } catch (error) {
    console.error('⚠️ FCM token update failed:', error);
    next(); // Don't fail the request
  }
};