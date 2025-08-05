import mongoose, { Document, Schema, Model } from 'mongoose';

export interface ILog extends Document {
  level: 'info' | 'warn' | 'error' | 'debug' | 'critical';
  type: 'auth' | 'payment' | 'notification' | 'api' | 'user_action' | 'system' | 'subscription' | 'promo' | 'error';
  action: string;
  userId?: mongoose.Types.ObjectId;
  userEmail?: string;
  userIP?: string;
  userAgent?: string;
  data: Record<string, any>;
  metadata?: {
    requestId?: string;
    sessionId?: string;
    deviceId?: string;
    location?: {
      country?: string;
      city?: string;
      ip?: string;
    };
    performance?: {
      duration?: number;
      memoryUsage?: number;
    };
  };
  status: 'success' | 'failure' | 'pending' | 'retry';
  errorCode?: string;
  errorMessage?: string;
  stackTrace?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ILogModel extends Model<ILog> {
  // Static methods
  getRecentLogs(type?: string, limit?: number): Promise<ILog[]>;
  getErrorLogs(hours?: number): Promise<ILog[]>;
  getUserLogs(userId: string, limit?: number): Promise<ILog[]>;
  getSecurityLogs(hours?: number): Promise<ILog[]>;
  getStats(type?: string, hours?: number): Promise<any[]>;
}

const LogSchema = new Schema<ILog>({
  level: {
    type: String,
    enum: ['info', 'warn', 'error', 'debug', 'critical'],
    required: true,
    index: true,
  },
  type: {
    type: String,
    enum: ['auth', 'payment', 'notification', 'api', 'user_action', 'system', 'subscription', 'promo', 'error'],
    required: true,
    index: true,
  },
  action: {
    type: String,
    required: true,
    index: true,
  },
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    index: true,
  },
  userEmail: {
    type: String,
    index: true,
  },
  userIP: {
    type: String,
    index: true,
  },
  userAgent: {
    type: String,
  },
  data: {
    type: Schema.Types.Mixed,
    required: true,
  },
  metadata: {
    requestId: String,
    sessionId: String,
    deviceId: String,
    location: {
      country: String,
      city: String,
      ip: String,
    },
    performance: {
      duration: Number,
      memoryUsage: Number,
    },
  },
  status: {
    type: String,
    enum: ['success', 'failure', 'pending', 'retry'],
    required: true,
    index: true,
  },
  errorCode: {
    type: String,
    index: true,
  },
  errorMessage: String,
  stackTrace: String,
}, {
  timestamps: true,
});

// Compound indexes for efficient querying
LogSchema.index({ type: 1, createdAt: -1 });
LogSchema.index({ userId: 1, createdAt: -1 });
LogSchema.index({ level: 1, type: 1, createdAt: -1 });
LogSchema.index({ status: 1, createdAt: -1 });
LogSchema.index({ userIP: 1, type: 1, createdAt: -1 });
LogSchema.index({ action: 1, createdAt: -1 });

// TTL index to automatically delete old logs (keep for 90 days)
LogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

// Methods
LogSchema.methods.toJSON = function() {
  const log = this.toObject();
  delete log.__v;
  return log;
};

// Static methods for common log queries
LogSchema.statics.getRecentLogs = function(type?: string, limit: number = 100) {
  const query = type ? { type } : {};
  return this.find(query)
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate('userId', 'email displayName');
};

LogSchema.statics.getErrorLogs = function(hours: number = 24) {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);
  return this.find({
    level: { $in: ['error', 'critical'] },
    createdAt: { $gte: since }
  })
  .sort({ createdAt: -1 })
  .populate('userId', 'email displayName');
};

LogSchema.statics.getUserLogs = function(userId: string, limit: number = 50) {
  return this.find({ userId })
    .sort({ createdAt: -1 })
    .limit(limit);
};

LogSchema.statics.getSecurityLogs = function(hours: number = 24) {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);
  return this.find({
    $or: [
      { type: 'auth', status: 'failure' },
      { level: 'critical' },
      { action: { $in: ['failed_login', 'suspicious_activity', 'account_lockout'] } }
    ],
    createdAt: { $gte: since }
  })
  .sort({ createdAt: -1 });
};

LogSchema.statics.getStats = function(type?: string, hours: number = 24) {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);
  const matchStage = type 
    ? { type, createdAt: { $gte: since } }
    : { createdAt: { $gte: since } };

  return this.aggregate([
    { $match: matchStage },
    {
      $group: {
        _id: {
          type: '$type',
          status: '$status',
          level: '$level'
        },
        count: { $sum: 1 }
      }
    },
    {
      $group: {
        _id: '$_id.type',
        stats: {
          $push: {
            status: '$_id.status',
            level: '$_id.level',
            count: '$count'
          }
        },
        total: { $sum: '$count' }
      }
    }
  ]);
};

export const Log = mongoose.model<ILog, ILogModel>('Log', LogSchema);