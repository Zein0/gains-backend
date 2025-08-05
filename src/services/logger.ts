import { Request } from 'express';
import { Log } from '../models/Log';
import mongoose from 'mongoose';

export interface LogData {
  level: 'info' | 'warn' | 'error' | 'debug' | 'critical';
  type: 'auth' | 'payment' | 'notification' | 'api' | 'user_action' | 'system' | 'subscription' | 'promo' | 'error';
  action: string;
  userId?: string;
  userEmail?: string;
  data: Record<string, any>;
  status: 'success' | 'failure' | 'pending' | 'retry';
  errorCode?: string;
  errorMessage?: string;
  stackTrace?: string;
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
}

export class Logger {
  static async log(logData: LogData, req?: Request): Promise<void> {
    try {
      const logEntry = new Log({
        ...logData,
        userIP: req?.ip || req?.headers['x-forwarded-for'] || req?.connection?.remoteAddress,
        userAgent: req?.headers['user-agent'],
        metadata: {
          ...logData.metadata,
          requestId: req?.headers['x-request-id'] || generateRequestId(),
          sessionId: req?.headers['x-session-id'],
          deviceId: req?.headers['x-device-id'],
          location: {
            ...logData.metadata?.location,
            ip: req?.ip || req?.headers['x-forwarded-for'] || req?.connection?.remoteAddress,
          },
        },
      });

      await logEntry.save();
    } catch (error) {
      console.error('Failed to save log:', error);
    }
  }

  static async logAuth(action: string, userId?: string, userEmail?: string, status: 'success' | 'failure' = 'success', data: Record<string, any> = {}, req?: Request): Promise<void> {
    await this.log({
      level: status === 'failure' ? 'warn' : 'info',
      type: 'auth',
      action,
      userId,
      userEmail,
      data,
      status,
    }, req);
  }

  static async logPayment(action: string, userId: string, data: Record<string, any>, status: 'success' | 'failure' | 'pending' = 'success', req?: Request): Promise<void> {
    await this.log({
      level: status === 'failure' ? 'error' : 'info',
      type: 'payment',
      action,
      userId,
      data: {
        ...data,
        // Remove sensitive payment data
        cardNumber: data.cardNumber ? '****' + data.cardNumber.slice(-4) : undefined,
      },
      status,
    }, req);
  }

  static async logNotification(action: string, userId: string, data: Record<string, any>, status: 'success' | 'failure' = 'success', req?: Request): Promise<void> {
    await this.log({
      level: status === 'failure' ? 'warn' : 'info',
      type: 'notification',
      action,
      userId,
      data,
      status,
    }, req);
  }

  static async logUserAction(action: string, userId: string, data: Record<string, any>, req?: Request): Promise<void> {
    await this.log({
      level: 'info',
      type: 'user_action',
      action,
      userId,
      data,
      status: 'success',
    }, req);
  }

  static async logAPI(action: string, userId: string | undefined, data: Record<string, any>, status: 'success' | 'failure' = 'success', req?: Request): Promise<void> {
    const startTime = Date.now();
    await this.log({
      level: status === 'failure' ? 'warn' : 'info',
      type: 'api',
      action,
      userId,
      data: {
        ...data,
        method: req?.method,
        url: req?.originalUrl,
        statusCode: status === 'success' ? 200 : 400,
      },
      status,
      metadata: {
        performance: {
          duration: Date.now() - startTime,
          memoryUsage: process.memoryUsage().heapUsed,
        },
      },
    }, req);
  }

  static async logSubscription(action: string, userId: string, data: Record<string, any>, status: 'success' | 'failure' = 'success', req?: Request): Promise<void> {
    await this.log({
      level: status === 'failure' ? 'error' : 'info',
      type: 'subscription',
      action,
      userId,
      data,
      status,
    }, req);
  }

  static async logPromo(action: string, userId: string, data: Record<string, any>, status: 'success' | 'failure' = 'success', req?: Request): Promise<void> {
    await this.log({
      level: 'info',
      type: 'promo',
      action,
      userId,
      data,
      status,
    }, req);
  }

  static async logError(error: Error, action: string, userId?: string, data: Record<string, any> = {}, req?: Request): Promise<void> {
    await this.log({
      level: 'error',
      type: 'error',
      action,
      userId,
      data,
      status: 'failure',
      errorMessage: error.message,
      stackTrace: error.stack,
    }, req);
  }

  static async logCritical(message: string, action: string, userId?: string, data: Record<string, any> = {}, req?: Request): Promise<void> {
    await this.log({
      level: 'critical',
      type: 'system',
      action,
      userId,
      data: { message, ...data },
      status: 'failure',
    }, req);
  }

  static async logSystem(action: string, data: Record<string, any>, level: 'info' | 'warn' | 'error' = 'info'): Promise<void> {
    await this.log({
      level,
      type: 'system',
      action,
      data,
      status: level === 'error' ? 'failure' : 'success',
    });
  }
}

function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

export default Logger;