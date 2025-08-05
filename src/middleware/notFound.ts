import { Request, Response, NextFunction } from 'express';

export const notFound = (req: Request, res: Response, next: NextFunction): void => {
  const error = new Error(`Route ${req.originalUrl} not found`);
  res.status(404).json({
    success: false,
    error: {
      message: `Route ${req.originalUrl} not found`,
      statusCode: 404,
    },
    availableRoutes: [
      'GET /health',
      'POST /api/auth/login',
      'POST /api/auth/logout',
      'GET /api/users/profile',
      'PUT /api/users/profile',
      'GET /api/progress',
      'POST /api/progress',
      'PUT /api/progress/:id',
      'DELETE /api/progress/:id',
      'GET /api/progress/compare',
      'POST /api/subscriptions/create',
      'POST /api/subscriptions/cancel',
      'POST /api/subscriptions/webhook',
      'GET /api/notifications/settings',
      'PUT /api/notifications/settings',
      'GET /api/logs (admin)',
      'GET /api/logs/dashboard (admin)',
      'GET /api/logs/export (admin)',
    ],
  });
};