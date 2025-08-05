import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import { AppError } from './errorHandler';

export const validate = (schema: Joi.ObjectSchema) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const { error } = schema.validate(req.body, { abortEarly: false });
    
    if (error) {
      const errorMessages = error.details.map(detail => detail.message);
      next(new AppError(`Validation error: ${errorMessages.join(', ')}`, 400));
      return;
    }
    
    next();
  };
};

export const validateQuery = (schema: Joi.ObjectSchema) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const { error } = schema.validate(req.query, { abortEarly: false });
    
    if (error) {
      const errorMessages = error.details.map(detail => detail.message);
      next(new AppError(`Query validation error: ${errorMessages.join(', ')}`, 400));
      return;
    }
    
    next();
  };
};

export const validateParams = (schema: Joi.ObjectSchema) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const { error } = schema.validate(req.params, { abortEarly: false });
    
    if (error) {
      const errorMessages = error.details.map(detail => detail.message);
      next(new AppError(`Parameter validation error: ${errorMessages.join(', ')}`, 400));
      return;
    }
    
    next();
  };
};

// Common validation schemas
export const schemas = {
  // User schemas
  updateProfile: Joi.object({
    displayName: Joi.string().min(1).max(100).trim(),
    phoneNumber: Joi.string().pattern(/^\+?[1-9]\d{1,14}$/),
    profile: Joi.object({
      height: Joi.number().min(100).max(250), // cm
      dateOfBirth: Joi.date().max('now'),
      gender: Joi.string().valid('male', 'female', 'other'),
      activityLevel: Joi.string().valid('sedentary', 'light', 'moderate', 'active', 'very_active'),
    }),
    settings: Joi.object({
      notificationsEnabled: Joi.boolean(),
      reminderTimes: Joi.array().items(Joi.string().pattern(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/)),
      theme: Joi.string().valid('light', 'dark', 'system'),
      units: Joi.object({
        weight: Joi.string().valid('kg', 'lbs'),
        height: Joi.string().valid('cm', 'ft'),
      }),
    }),
  }),

  // Progress schemas
  createProgress: Joi.object({
    date: Joi.date().max('now').required(),
    weight: Joi.number().min(20).max(500).required(),
    measurements: Joi.object({
      chest: Joi.number().min(50).max(200),
      waist: Joi.number().min(40).max(200),
      hips: Joi.number().min(50).max(200),
      leftArm: Joi.number().min(15).max(80),
      rightArm: Joi.number().min(15).max(80),
      leftThigh: Joi.number().min(30).max(120),
      rightThigh: Joi.number().min(30).max(120),
      neck: Joi.number().min(20).max(60),
    }),
    bodyFatPercentage: Joi.number().min(3).max(50),
    notes: Joi.string().max(1000).trim(),
    mood: Joi.number().integer().min(1).max(5),
    energyLevel: Joi.number().integer().min(1).max(5),
    sleepQuality: Joi.number().integer().min(1).max(5),
  }),

  updateProgress: Joi.object({
    weight: Joi.number().min(20).max(500),
    measurements: Joi.object({
      chest: Joi.number().min(50).max(200),
      waist: Joi.number().min(40).max(200),
      hips: Joi.number().min(50).max(200),
      leftArm: Joi.number().min(15).max(80),
      rightArm: Joi.number().min(15).max(80),
      leftThigh: Joi.number().min(30).max(120),
      rightThigh: Joi.number().min(30).max(120),
      neck: Joi.number().min(20).max(60),
    }),
    bodyFatPercentage: Joi.number().min(3).max(50),
    notes: Joi.string().max(1000).trim(),
    mood: Joi.number().integer().min(1).max(5),
    energyLevel: Joi.number().integer().min(1).max(5),
    sleepQuality: Joi.number().integer().min(1).max(5),
  }),

  // Query schemas
  progressQuery: Joi.object({
    startDate: Joi.date(),
    endDate: Joi.date().min(Joi.ref('startDate')),
    limit: Joi.number().integer().min(1).max(100).default(30),
    page: Joi.number().integer().min(1).default(1),
    sortBy: Joi.string().valid('date', 'weight', 'createdAt').default('date'),
    sortOrder: Joi.string().valid('asc', 'desc').default('desc'),
  }),

  compareQuery: Joi.object({
    date1: Joi.date().required(),
    date2: Joi.date().required(),
  }),

  // Subscription schemas
  createSubscription: Joi.object({
    priceId: Joi.string(),
    promoCode: Joi.string().uppercase().trim(),
  }),

  applyPromoCode: Joi.object({
    code: Joi.string().required().uppercase().trim().min(3).max(20),
  }),

  // Notification schemas
  updateNotificationSettings: Joi.object({
    notificationsEnabled: Joi.boolean().required(),
    reminderTimes: Joi.array().items(
      Joi.string().pattern(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/)
    ).min(0).max(10),
  }),

  sendNotification: Joi.object({
    title: Joi.string().required().max(100),
    body: Joi.string().required().max(500),
    data: Joi.object(),
    userId: Joi.string(),
    userIds: Joi.array().items(Joi.string()),
    scheduled: Joi.date().min('now'),
  }).xor('userId', 'userIds'),

  // Image upload schemas
  uploadImage: Joi.object({
    type: Joi.string().valid('front', 'side', 'back', 'pose').required(),
    date: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/),
    quality: Joi.number().integer().min(10).max(100).default(85),
  }),

  // Promo code schemas (admin)
  createPromoCode: Joi.object({
    code: Joi.string().required().uppercase().trim().min(3).max(20).pattern(/^[A-Z0-9_-]+$/),
    type: Joi.string().required().valid('free_month', 'free_year', 'lifetime', 'discount_percent', 'discount_amount'),
    value: Joi.number().when('type', {
      is: Joi.string().valid('discount_percent'),
      then: Joi.number().min(0).max(100).required(),
      otherwise: Joi.when('type', {
        is: Joi.string().valid('discount_amount'),
        then: Joi.number().min(0).required(),
        otherwise: Joi.forbidden(),
      }),
    }),
    description: Joi.string().max(200).trim(),
    usageLimit: Joi.number().integer().min(1),
    validFrom: Joi.date().default('now'),
    validUntil: Joi.date().min(Joi.ref('validFrom')),
  }),

  // Parameter schemas
  mongoId: Joi.object({
    id: Joi.string().required().pattern(/^[0-9a-fA-F]{24}$/, 'MongoDB ObjectId'),
  }),

  dateParam: Joi.object({
    date: Joi.string().required().pattern(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD date format'),
  }),
};

// Custom validation helpers
export const isValidObjectId = (id: string): boolean => {
  return /^[0-9a-fA-F]{24}$/.test(id);
};

export const isValidDate = (date: string): boolean => {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && !isNaN(Date.parse(date));
};

export const isValidEmail = (email: string): boolean => {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
};

export const isValidPhone = (phone: string): boolean => {
  return /^\+?[1-9]\d{1,14}$/.test(phone);
};

export const isValidTime = (time: string): boolean => {
  return /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(time);
};

export const sanitizeInput = (input: any): any => {
  if (typeof input === 'string') {
    return input.trim();
  }
  if (Array.isArray(input)) {
    return input.map(sanitizeInput);
  }
  if (typeof input === 'object' && input !== null) {
    const sanitized: any = {};
    for (const key in input) {
      sanitized[key] = sanitizeInput(input[key]);
    }
    return sanitized;
  }
  return input;
};