import { Router, Request, Response } from 'express';
import { authenticateToken, adminOnly, AuthRequest } from '@/middleware/auth';
import { validate, schemas } from '@/middleware/validation';
import { asyncHandler } from '@/middleware/errorHandler';
import { PromoCode } from '@/models/PromoCode';
import { User } from '@/models/User';
import Logger from '@/services/logger';
import mongoose from 'mongoose';

const router = Router();

// Apply promo code (public endpoint)
router.post('/apply',
  validate(schemas.applyPromoCode),
  asyncHandler(async (req: Request, res: Response) => {
    const { code } = req.body;
    
    const promoCode = await PromoCode.findValidCode(code);
    
    if (!promoCode) {
      return res.status(404).json({
        success: false,
        error: 'Invalid or expired promo code',
      });
    }

    const discountInfo = promoCode.getDiscountInfo();
    
    await Logger.logPromo('promo_code_validated_public', '', {
      code,
      promoCodeId: (promoCode._id as mongoose.Types.ObjectId).toString(),
      type: promoCode.type,
      discount: discountInfo,
    }, 'success', req);

    return res.json({
      success: true,
      data: {
        valid: true,
        discount: discountInfo,
        promoCode: {
          id: promoCode._id,
          code: promoCode.code,
          type: promoCode.type,
          description: promoCode.description,
        },
      },
    });
  })
);

// Create promo code (admin only)
router.post('/',
  authenticateToken,
  adminOnly,
  validate(schemas.createPromoCode),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = req.user!.userId;
    
    const promoCode = new PromoCode({
      ...req.body,
      createdBy: userId,
    });
    
    await promoCode.save();
    
    await Logger.logPromo('promo_code_created', userId, {
      promoCodeId: (promoCode._id as mongoose.Types.ObjectId).toString(),
      code: promoCode.code,
      type: promoCode.type,
      value: promoCode.value,
      usageLimit: promoCode.usageLimit,
    }, 'success', req);
    
    res.status(201).json({
      success: true,
      data: { promoCode },
      message: 'Promo code created successfully',
    });
  })
);

// List promo codes (admin only)
router.get('/',
  authenticateToken,
  adminOnly,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { page = 1, limit = 20, active } = req.query;
    
    const query: any = {};
    if (active !== undefined) {
      query.isActive = active === 'true';
    }
    
    const skip = (Number(page) - 1) * Number(limit);
    
    const promoCodes = await PromoCode.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .populate('createdBy', 'email displayName');
    
    const total = await PromoCode.countDocuments(query);
    
    res.json({
      success: true,
      data: {
        promoCodes,
        pagination: {
          total,
          page: Number(page),
          limit: Number(limit),
          totalPages: Math.ceil(total / Number(limit)),
        },
      },
    });
  })
);

// Get promo code details (admin only)
router.get('/:id',
  authenticateToken,
  adminOnly,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { id } = req.params;
    
    const promoCode = await PromoCode.findById(id)
      .populate('createdBy', 'email displayName')
      .populate('usedBy', 'email displayName');
    
    if (!promoCode) {
      return res.status(404).json({
        success: false,
        error: 'Promo code not found',
      });
    }
    
    return res.json({
      success: true,
      data: { promoCode },
    });
  })
);

// Update promo code (admin only)
router.put('/:id',
  authenticateToken,
  adminOnly,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { id } = req.params;
    const updates = req.body;
    
    const promoCode = await PromoCode.findByIdAndUpdate(
      id,
      { $set: updates },
      { new: true, runValidators: true }
    );
    
    if (!promoCode) {
      return res.status(404).json({
        success: false,
        error: 'Promo code not found',
      });
    }

    return res.json({
      success: true,
      data: { promoCode },
      message: 'Promo code updated successfully',
    });
  })
);

// Delete promo code (admin only)
router.delete('/:id',
  authenticateToken,
  adminOnly,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { id } = req.params;
    
    const promoCode = await PromoCode.findByIdAndDelete(id);
    
    if (!promoCode) {
      return res.status(404).json({
        success: false,
        error: 'Promo code not found',
      });
    }
    
    return res.json({
      success: true,
      message: 'Promo code deleted successfully',
    });
  })
);

// Use promo code (authenticated users)
router.post('/:code/use',
  authenticateToken,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { code } = req.params;
    const userId = req.user!.userId;
    
    const promoCode = await PromoCode.findValidCode(code, new mongoose.Types.ObjectId(userId));
    
    if (!promoCode) {
      return res.status(404).json({
        success: false,
        error: 'Invalid or expired promo code',
      });
    }
    
    try {
      await promoCode.use(new mongoose.Types.ObjectId(userId));
      
      // Apply the promo code benefits to the user
      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          error: 'User not found',
        });
      }
      
      // Apply benefits based on promo code type
      switch (promoCode.type) {
        case 'free_month':
          if (user.subscription.currentPeriodEnd) {
            const currentEnd = new Date(user.subscription.currentPeriodEnd);
            currentEnd.setMonth(currentEnd.getMonth() + 1);
            user.subscription.currentPeriodEnd = currentEnd;
          } else {
            const now = new Date();
            now.setMonth(now.getMonth() + 1);
            user.subscription.currentPeriodEnd = now;
          }
          break;
          
        case 'free_year':
          if (user.subscription.currentPeriodEnd) {
            const currentEnd = new Date(user.subscription.currentPeriodEnd);
            currentEnd.setFullYear(currentEnd.getFullYear() + 1);
            user.subscription.currentPeriodEnd = currentEnd;
          } else {
            const now = new Date();
            now.setFullYear(now.getFullYear() + 1);
            user.subscription.currentPeriodEnd = now;
          }
          break;
          
        case 'lifetime':
          user.subscription.status = 'active';
          user.subscription.currentPeriodEnd = new Date('2099-12-31');
          break;
      }
      
      await user.save();
      
      await Logger.logPromo('promo_code_used', userId, {
        promoCodeId: (promoCode._id as mongoose.Types.ObjectId).toString(),
        code: promoCode.code,
        type: promoCode.type,
        value: promoCode.value,
        appliedBenefit: promoCode.type,
        newSubscriptionEnd: user.subscription.currentPeriodEnd,
      }, 'success', req);

      return res.json({
        success: true,
        data: {
          discount: promoCode.getDiscountInfo(),
          user: {
            subscription: user.subscription,
          },
        },
        message: 'Promo code applied successfully',
      });
      
    } catch (error: any) {
      return res.status(400).json({
        success: false,
        error: error.message,
      });
    }
  })
);

// Generate bulk promo codes (admin only)
router.post('/bulk/generate',
  authenticateToken,
  adminOnly,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const {
      count = 10,
      type,
      value,
      description,
      prefix = '',
      usageLimit = 1,
      validUntil,
    } = req.body;
    
    const userId = req.user!.userId;
    const promoCodes = [];
    
    for (let i = 0; i < count; i++) {
      try {
        const code = await PromoCode.generateUniqueCode(prefix);
        
        const promoCode = new PromoCode({
          code,
          type,
          value,
          description: description || `Bulk generated ${type} code`,
          usageLimit,
          validUntil: validUntil ? new Date(validUntil) : undefined,
          createdBy: userId,
        });
        
        await promoCode.save();
        promoCodes.push(promoCode);
      } catch (error) {
        console.error('Error generating promo code:', error);
      }
    }
    
    res.json({
      success: true,
      data: {
        promoCodes,
        generated: promoCodes.length,
        requested: count,
      },
      message: `Generated ${promoCodes.length} promo codes`,
    });
  })
);

export default router;
