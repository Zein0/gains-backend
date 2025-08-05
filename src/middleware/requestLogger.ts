import { Request, Response, NextFunction } from 'express';
import Logger from '@/services/logger';
import { AuthRequest } from './auth';

export const requestLogger = (req: AuthRequest, res: Response, next: NextFunction): void => {
  const startTime = Date.now();
  const originalSend = res.send;

  // Override res.send to capture response data
  res.send = function(data: any) {
    const responseTime = Date.now() - startTime;
    const statusCode = res.statusCode;
    const success = statusCode >= 200 && statusCode < 400;

    // Log API request (don't await to avoid blocking response)
    Logger.logAPI(
      `${req.method} ${req.path}`,
      req.user?.userId,
      {
        method: req.method,
        path: req.path,
        query: req.query,
        body: sanitizeRequestBody(req.body),
        headers: sanitizeHeaders(req.headers),
        statusCode,
        responseTime,
        contentLength: data ? Buffer.byteLength(data, 'utf8') : 0,
      },
      success ? 'success' : 'failure',
      req
    ).catch(error => {
      console.error('Failed to log API request:', error);
    });

    return originalSend.call(this, data);
  };

  next();
};

// Sanitize request body to remove sensitive data
function sanitizeRequestBody(body: any): any {
  if (!body || typeof body !== 'object') return body;

  const sanitized = { ...body };
  const sensitiveFields = [
    'password', 'token', 'secret', 'key', 'authorization',
    'fcmToken', 'refreshToken', 'accessToken', 'apiKey'
  ];

  for (const field of sensitiveFields) {
    if (sanitized[field]) {
      sanitized[field] = '[REDACTED]';
    }
  }

  return sanitized;
}

// Sanitize headers to remove sensitive data
function sanitizeHeaders(headers: any): any {
  const sanitized = { ...headers };
  const sensitiveHeaders = [
    'authorization', 'cookie', 'x-api-key', 'x-auth-token',
    'fcm-token', 'x-session-id', 'x-device-id'
  ];

  for (const header of sensitiveHeaders) {
    if (sanitized[header]) {
      sanitized[header] = '[REDACTED]';
    }
  }

  return {
    'user-agent': sanitized['user-agent'],
    'content-type': sanitized['content-type'],
    'accept': sanitized['accept'],
    'x-forwarded-for': sanitized['x-forwarded-for'],
    'x-real-ip': sanitized['x-real-ip'],
    'origin': sanitized['origin'],
    'referer': sanitized['referer'],
  };
}

export default requestLogger;