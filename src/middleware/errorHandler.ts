import { Request, Response, NextFunction } from 'express';
import Logger from '@/services/logger';
import { AuthRequest } from './auth';

export interface APIError extends Error {
  statusCode?: number;
  isOperational?: boolean;
}

export class AppError extends Error implements APIError {
  statusCode: number;
  isOperational: boolean;

  constructor(message: string, statusCode: number = 500) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }
}

export const createError = (message: string, statusCode: number = 500): AppError => {
  return new AppError(message, statusCode);
};

export const errorHandler = async (
  error: APIError,
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  let { statusCode = 500, message } = error;

  // Log error to database
  await Logger.logError(error, 'api_error', req.user?.userId, {
    method: req.method,
    url: req.url,
    statusCode,
    userAgent: req.headers['user-agent'],
    body: req.body,
    query: req.query,
    params: req.params,
  }, req);

  // Log error details
  console.error(`❌ Error ${statusCode}: ${message}`);
  console.error('Stack:', error.stack);
  console.error('Request:', {
    method: req.method,
    url: req.url,
    headers: req.headers,
    body: req.body,
    query: req.query,
    params: req.params,
  });

  // Handle specific error types
  if (error.name === 'ValidationError') {
    statusCode = 400;
    message = 'Validation error';
  } else if (error.name === 'CastError') {
    statusCode = 400;
    message = 'Invalid ID format';
  } else if (error.name === 'MongoServerError' && (error as any).code === 11000) {
    statusCode = 409;
    message = 'Duplicate entry';
  } else if (error.name === 'JsonWebTokenError') {
    statusCode = 401;
    message = 'Invalid token';
  } else if (error.name === 'TokenExpiredError') {
    statusCode = 401;
    message = 'Token expired';
  } else if (error.name === 'MulterError') {
    statusCode = 400;
    message = 'File upload error';
  }

  // Don't leak error details in production
  const isDevelopment = process.env.NODE_ENV === 'development';
  
  const errorResponse: any = {
    success: false,
    error: {
      message: isDevelopment ? message : 'Internal server error',
      ...(isDevelopment && { stack: error.stack }),
      ...(isDevelopment && { name: error.name }),
    },
    ...(isDevelopment && {
      request: {
        method: req.method,
        url: req.url,
        timestamp: new Date().toISOString(),
      },
    }),
  };

  res.status(statusCode).json(errorResponse);
};

export const asyncHandler = (fn: Function) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

export const notFound = (req: Request, res: Response, next: NextFunction): void => {
  const error = new AppError(`Route ${req.originalUrl} not found`, 404);
  next(error);
};

// Validation error handler
export const handleValidationError = (error: any): AppError => {
  const errors = Object.values(error.errors).map((err: any) => err.message);
  const message = `Validation Error: ${errors.join('. ')}`;
  return new AppError(message, 400);
};

// Duplicate key error handler
export const handleDuplicateKeyError = (error: any): AppError => {
  const field = Object.keys(error.keyValue)[0];
  const value = error.keyValue[field];
  const message = `Duplicate value '${value}' for field '${field}'`;
  return new AppError(message, 409);
};

// Cast error handler (invalid ObjectId)
export const handleCastError = (error: any): AppError => {
  const message = `Invalid ${error.path}: ${error.value}`;
  return new AppError(message, 400);
};

// Rate limit error handler
export const handleRateLimitError = (): AppError => {
  return new AppError('Too many requests, please try again later', 429);
};

// File size error handler
export const handleFileSizeError = (maxSize: number): AppError => {
  const maxSizeMB = Math.round(maxSize / (1024 * 1024));
  return new AppError(`File too large. Maximum size is ${maxSizeMB}MB`, 413);
};

// Stripe error handler
export const handleStripeError = (error: any): AppError => {
  let message = 'Payment processing failed';
  let statusCode = 400;

  switch (error.type) {
    case 'StripeCardError':
      message = error.message || 'Your card was declined';
      break;
    case 'StripeRateLimitError':
      message = 'Too many requests made to Stripe API';
      statusCode = 429;
      break;
    case 'StripeInvalidRequestError':
      message = 'Invalid parameters were supplied to Stripe';
      break;
    case 'StripeAPIError':
      message = 'An error occurred with Stripe API';
      statusCode = 500;
      break;
    case 'StripeConnectionError':
      message = 'Network communication with Stripe failed';
      statusCode = 500;
      break;
    case 'StripeAuthenticationError':
      message = 'Authentication with Stripe API failed';
      statusCode = 500;
      break;
    default:
      message = error.message || 'Payment processing failed';
  }

  return new AppError(message, statusCode);
};

// Firebase error handler
export const handleFirebaseError = (error: any): AppError => {
  let message = 'Authentication failed';
  let statusCode = 401;

  switch (error.code) {
    case 'auth/id-token-expired':
      message = 'Token has expired';
      break;
    case 'auth/id-token-revoked':
      message = 'Token has been revoked';
      break;
    case 'auth/invalid-id-token':
      message = 'Invalid token';
      break;
    case 'auth/user-not-found':
      message = 'User not found';
      statusCode = 404;
      break;
    case 'auth/user-disabled':
      message = 'User account has been disabled';
      statusCode = 403;
      break;
    default:
      message = error.message || 'Authentication failed';
  }

  return new AppError(message, statusCode);
};