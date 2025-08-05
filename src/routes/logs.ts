import { Router, Response } from 'express';
import { authenticateToken, adminOnly, AuthRequest } from '@/middleware/auth';
import { validate, validateQuery } from '@/middleware/validation';
import { asyncHandler } from '@/middleware/errorHandler';
import { Log } from '@/models/Log';
import Joi from 'joi';

const router = Router();

// Query schemas
const logsQuerySchema = Joi.object({
  type: Joi.string().valid('auth', 'payment', 'notification', 'api', 'user_action', 'system', 'subscription', 'promo', 'error'),
  level: Joi.string().valid('info', 'warn', 'error', 'debug', 'critical'),
  status: Joi.string().valid('success', 'failure', 'pending', 'retry'),
  userId: Joi.string(),
  startDate: Joi.date().iso(),
  endDate: Joi.date().iso(),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(50),
  sortBy: Joi.string().valid('createdAt', 'level', 'type', 'status').default('createdAt'),
  sortOrder: Joi.string().valid('asc', 'desc').default('desc'),
});

const statsQuerySchema = Joi.object({
  type: Joi.string().valid('auth', 'payment', 'notification', 'api', 'user_action', 'system', 'subscription', 'promo', 'error'),
  hours: Joi.number().integer().min(1).max(168).default(24), // Max 1 week
});

// Get logs (admin only)
router.get('/',
  authenticateToken,
  adminOnly,
  validateQuery(logsQuerySchema),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const {
      type,
      level,
      status,
      userId,
      startDate,
      endDate,
      page = 1,
      limit = 50,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = req.query;

    // Build query
    const query: any = {};
    if (type) query.type = type;
    if (level) query.level = level;
    if (status) query.status = status;
    if (userId) query.userId = userId;
    
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate as string);
      if (endDate) query.createdAt.$lte = new Date(endDate as string);
    }

    const skip = (Number(page) - 1) * Number(limit);
    const sort: Record<string, 1 | -1> = { [sortBy as string]: sortOrder === 'asc' ? 1 : -1 };

    const [logs, total] = await Promise.all([
      Log.find(query)
        .sort(sort)
        .skip(skip)
        .limit(Number(limit))
        .populate('userId', 'email displayName'),
      Log.countDocuments(query)
    ]);

    res.json({
      success: true,
      data: {
        logs,
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

// Get recent logs by type
router.get('/recent/:type',
  authenticateToken,
  adminOnly,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { type } = req.params;
    const { limit = 100 } = req.query;

    const logs = await Log.getRecentLogs(type, Number(limit));

    res.json({
      success: true,
      data: { logs },
    });
  })
);

// Get error logs
router.get('/errors',
  authenticateToken,
  adminOnly,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { hours = 24 } = req.query;

    const logs = await Log.getErrorLogs(Number(hours));

    res.json({
      success: true,
      data: { logs },
    });
  })
);

// Get security logs
router.get('/security',
  authenticateToken,
  adminOnly,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { hours = 24 } = req.query;

    const logs = await Log.getSecurityLogs(Number(hours));

    res.json({
      success: true,
      data: { logs },
    });
  })
);

// Get user logs
router.get('/user/:userId',
  authenticateToken,
  adminOnly,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { userId } = req.params;
    const { limit = 50 } = req.query;

    const logs = await Log.getUserLogs(userId, Number(limit));

    res.json({
      success: true,
      data: { logs },
    });
  })
);

// Get log statistics
router.get('/stats',
  authenticateToken,
  adminOnly,
  validateQuery(statsQuerySchema),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { type, hours = 24 } = req.query;

    const stats = await Log.getStats(type as string, Number(hours));

    res.json({
      success: true,
      data: { stats },
    });
  })
);

// Get system health dashboard
router.get('/dashboard',
  authenticateToken,
  adminOnly,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { hours = 24 } = req.query;
    const hoursNum = Number(hours);

    const [
      totalLogs,
      errorLogs,
      securityLogs,
      apiStats,
      authStats,
      paymentStats,
      notificationStats,
    ] = await Promise.all([
      // Total logs in period
      Log.countDocuments({
        createdAt: { $gte: new Date(Date.now() - hoursNum * 60 * 60 * 1000) }
      }),
      
      // Error logs
      Log.getErrorLogs(hoursNum),
      
      // Security logs
      Log.getSecurityLogs(hoursNum),
      
      // API stats
      Log.getStats('api', hoursNum),
      
      // Auth stats
      Log.getStats('auth', hoursNum),
      
      // Payment stats
      Log.getStats('payment', hoursNum),
      
      // Notification stats
      Log.getStats('notification', hoursNum),
    ]);

    // Calculate error rates
    const errorCount = errorLogs.length;
    const errorRate = totalLogs > 0 ? (errorCount / totalLogs) * 100 : 0;

    // Get top error types
    const errorTypes = errorLogs.reduce((acc: any, log: any) => {
      const action = log.action || 'unknown';
      acc[action] = (acc[action] || 0) + 1;
      return acc;
    }, {});

    // Get recent critical issues
    const criticalIssues = await Log.find({
      level: 'critical',
      createdAt: { $gte: new Date(Date.now() - hoursNum * 60 * 60 * 1000) }
    }).sort({ createdAt: -1 }).limit(10);

    res.json({
      success: true,
      data: {
        overview: {
          totalLogs,
          errorCount,
          errorRate: Math.round(errorRate * 100) / 100,
          securityIssues: securityLogs.length,
          criticalIssues: criticalIssues.length,
        },
        stats: {
          api: apiStats,
          auth: authStats,
          payment: paymentStats,
          notification: notificationStats,
        },
        errorBreakdown: errorTypes,
        criticalIssues,
        period: `${hoursNum} hours`,
      },
    });
  })
);

// Get performance metrics
router.get('/performance',
  authenticateToken,
  adminOnly,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { hours = 24 } = req.query;
    const since = new Date(Date.now() - Number(hours) * 60 * 60 * 1000);

    // Get API performance metrics
    const performanceStats = await Log.aggregate([
      {
        $match: {
          type: 'api',
          createdAt: { $gte: since },
          'metadata.performance.duration': { $exists: true }
        }
      },
      {
        $group: {
          _id: '$action',
          avgResponseTime: { $avg: '$metadata.performance.duration' },
          maxResponseTime: { $max: '$metadata.performance.duration' },
          minResponseTime: { $min: '$metadata.performance.duration' },
          totalRequests: { $sum: 1 },
          successfulRequests: {
            $sum: { $cond: [{ $eq: ['$status', 'success'] }, 1, 0] }
          }
        }
      },
      {
        $project: {
          action: '$_id',
          avgResponseTime: { $round: ['$avgResponseTime', 2] },
          maxResponseTime: '$maxResponseTime',
          minResponseTime: '$minResponseTime',
          totalRequests: '$totalRequests',
          successRate: {
            $round: [
              { $multiply: [{ $divide: ['$successfulRequests', '$totalRequests'] }, 100] },
              2
            ]
          }
        }
      },
      { $sort: { avgResponseTime: -1 } }
    ]);

    // Get memory usage trends
    const memoryStats = await Log.aggregate([
      {
        $match: {
          createdAt: { $gte: since },
          'metadata.performance.memoryUsage': { $exists: true }
        }
      },
      {
        $group: {
          _id: {
            $dateToString: {
              format: '%Y-%m-%d %H:00',
              date: '$createdAt'
            }
          },
          avgMemoryUsage: { $avg: '$metadata.performance.memoryUsage' },
          maxMemoryUsage: { $max: '$metadata.performance.memoryUsage' }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    res.json({
      success: true,
      data: {
        apiPerformance: performanceStats,
        memoryTrends: memoryStats,
        period: `${hours} hours`,
      },
    });
  })
);

// Export logs (admin only)
router.get('/export',
  authenticateToken,
  adminOnly,
  validateQuery(logsQuerySchema),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const {
      type,
      level,
      status,
      userId,
      startDate,
      endDate,
      limit = 1000,
    } = req.query;

    // Build query
    const query: any = {};
    if (type) query.type = type;
    if (level) query.level = level;
    if (status) query.status = status;
    if (userId) query.userId = userId;
    
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate as string);
      if (endDate) query.createdAt.$lte = new Date(endDate as string);
    }

    const logs = await Log.find(query)
      .sort({ createdAt: -1 })
      .limit(Number(limit))
      .populate('userId', 'email displayName')
      .lean();

    // Set headers for CSV download
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=logs-export.csv');

    // CSV headers
    const csvHeaders = [
      'Timestamp', 'Level', 'Type', 'Action', 'Status', 'User Email',
      'IP Address', 'User Agent', 'Error Message', 'Data'
    ];

    let csvContent = csvHeaders.join(',') + '\n';

    // CSV rows
    logs.forEach((log: any) => {
      const row = [
        log.createdAt?.toISOString() || '',
        log.level || '',
        log.type || '',
        log.action || '',
        log.status || '',
        log.userId?.email || log.userEmail || '',
        log.userIP || '',
        log.userAgent ? `"${log.userAgent.replace(/"/g, '""')}"` : '',
        log.errorMessage ? `"${log.errorMessage.replace(/"/g, '""')}"` : '',
        log.data ? `"${JSON.stringify(log.data).replace(/"/g, '""')}"` : ''
      ];
      csvContent += row.join(',') + '\n';
    });

    res.send(csvContent);
  })
);

export default router;
