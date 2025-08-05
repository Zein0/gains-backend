import { Router, Response } from 'express';
import { authenticateToken, requireSubscription, AuthRequest } from '@/middleware/auth';
import { validate, schemas, validateQuery } from '@/middleware/validation';
import { asyncHandler } from '@/middleware/errorHandler';
import { Progress } from '@/models/Progress';
import { uploadImage } from '@/config/storage';
import Logger from '@/services/logger';
import multer from 'multer';
import mongoose from 'mongoose';

const router = Router();
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

// Get progress history
router.get('/',
  authenticateToken,
  validateQuery(schemas.progressQuery),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = req.user!.userId;
    const { startDate, endDate, limit = 30, page = 1, sortBy = 'date', sortOrder = 'desc' } = req.query;
    
    const query: any = { userId };
    if (startDate || endDate) {
      query.date = {};
      if (startDate) query.date.$gte = new Date(startDate as string);
      if (endDate) query.date.$lte = new Date(endDate as string);
    }
    
    const skip = (Number(page) - 1) * Number(limit);
    const sortDirection = sortOrder === 'asc' ? 1 : -1;
    
    const progress = await Progress.find(query)
      .sort({ [sortBy as string]: sortDirection })
      .skip(skip)
      .limit(Number(limit));
    
    const total = await Progress.countDocuments(query);
    
    res.json({
      success: true,
      data: {
        progress,
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

// Create progress entry
router.post('/',
  authenticateToken,
  requireSubscription,
  upload.fields([
    { name: 'front', maxCount: 1 },
    { name: 'side', maxCount: 1 },
    { name: 'back', maxCount: 1 },
    { name: 'pose', maxCount: 1 },
  ]),
  validate(schemas.createProgress),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = req.user!.userId;
    const files = req.files as { [fieldname: string]: Express.Multer.File[] };
    
    // Upload images to Cloudflare R2
    const photos: any = {};
    if (files) {
      for (const [type, fileArray] of Object.entries(files)) {
        if (fileArray && fileArray[0]) {
          const imageUrl = await uploadImage(fileArray[0].buffer, {
            userId,
            type: type as 'front' | 'side' | 'back' | 'pose',
            date: req.body.date?.split('T')[0],
          });
          photos[type] = imageUrl;
        }
      }
    }
    
    const progress = new Progress({
      ...req.body,
      userId,
      photos,
    });
    
    await progress.save();
    
    await Logger.logUserAction('create_progress', userId, {
      progressId: (progress._id as mongoose.Types.ObjectId).toString(),
      date: progress.date,
      weight: progress.weight,
      photoTypes: Object.keys(photos),
      hasPhotos: Object.keys(photos).length > 0,
    }, req);
    
    res.status(201).json({
      success: true,
      data: { progress },
      message: 'Progress entry created successfully',
    });
  })
);

// Get specific progress entry
router.get('/:id',
  authenticateToken,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { id } = req.params;
    const userId = req.user!.userId;
    
    const progress = await Progress.findOne({ _id: id, userId });
    if (!progress) {
      return res.status(404).json({
        success: false,
        error: 'Progress entry not found',
      });
    }
    
    return res.json({
      success: true,
      data: { progress },
    });
  })
);

// Update progress entry
router.put('/:id',
  authenticateToken,
  requireSubscription,
  validate(schemas.updateProgress),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { id } = req.params;
    const userId = req.user!.userId;
    
    const progress = await Progress.findOneAndUpdate(
      { _id: id, userId },
      { $set: req.body },
      { new: true, runValidators: true }
    );
    
    if (!progress) {
      return res.status(404).json({
        success: false,
        error: 'Progress entry not found',
      });
    }
    
    await Logger.logUserAction('update_progress', userId, {
      progressId: id,
      updatedFields: Object.keys(req.body),
      date: progress.date,
    }, req);
    
    return res.json({
      success: true,
      data: { progress },
      message: 'Progress updated successfully',
    });
  })
);

// Delete progress entry
router.delete('/:id',
  authenticateToken,
  requireSubscription,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { id } = req.params;
    const userId = req.user!.userId;
    
    const progress = await Progress.findOneAndDelete({ _id: id, userId });
    if (!progress) {
      return res.status(404).json({
        success: false,
        error: 'Progress entry not found',
      });
    }
    
    await Logger.logUserAction('delete_progress', userId, {
      progressId: id,
      date: progress.date,
      weight: progress.weight,
      hadPhotos: Object.keys(progress.photos || {}).length > 0,
    }, req);

    return res.json({
      success: true,
      message: 'Progress entry deleted successfully',
    });
  })
);

// Compare two progress entries
router.get('/compare',
  authenticateToken,
  validateQuery(schemas.compareQuery),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { date1, date2 } = req.query;
    const userId = req.user!.userId;
    
    const [progress1, progress2] = await Promise.all([
      Progress.findOne({ userId, date: new Date(date1 as string) }),
      Progress.findOne({ userId, date: new Date(date2 as string) }),
    ]);
    
    if (!progress1 || !progress2) {
      return res.status(404).json({
        success: false,
        error: 'One or both progress entries not found',
      });
    }
    
    // Calculate differences
    const weightDifference = progress2.weight - progress1.weight;
    const daysBetween = Math.abs(
      (new Date(progress2.date).getTime() - new Date(progress1.date).getTime()) / (1000 * 60 * 60 * 24)
    );
    
    const measurementChanges: Record<string, number> = {};
    if (progress1.measurements && progress2.measurements) {
      for (const key of Object.keys(progress1.measurements)) {
        const val1 = progress1.measurements[key as keyof typeof progress1.measurements];
        const val2 = progress2.measurements[key as keyof typeof progress2.measurements];
        if (val1 && val2) {
          measurementChanges[key] = val2 - val1;
        }
      }
    }

    return res.json({
      success: true,
      data: {
        progress1,
        progress2,
        comparison: {
          weightDifference,
          daysBetween,
          measurementChanges,
        },
      },
    });
  })
);

export default router;
