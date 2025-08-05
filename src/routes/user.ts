import { Router, Response } from 'express';
import { authenticateToken, AuthRequest } from '@/middleware/auth';
import { validate, schemas } from '@/middleware/validation';
import { asyncHandler } from '@/middleware/errorHandler';
import { User } from '@/models/User';
import { cache } from '@/config/redis';

const router = Router();

// Get user profile
router.get('/profile',
  authenticateToken,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const user = req.user!.dbUser;
    
    res.json({
      success: true,
      data: { user },
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
