import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';

import { connectDB } from '@/config/database';
import { connectRedis } from '@/config/redis';
import { initializeFirebase } from '@/config/firebase';
import { initializeStripe } from '@/config/stripe';
import { initializeStorage } from '@/config/storage';
import { errorHandler } from '@/middleware/errorHandler';
import { notFound } from '@/middleware/notFound';
import '@/models/Log'; // Ensure Log model is registered

// Import routes
import authRoutes from '@/routes/auth';
import userRoutes from '@/routes/user';
import progressRoutes from '@/routes/progress';
import subscriptionRoutes from '@/routes/subscription';
import notificationRoutes from '@/routes/notification';
import promoCodeRoutes from '@/routes/promoCode';
import logsRoutes from '@/routes/logs';
import { notificationService } from '@/services/notificationService';
import requestLogger from '@/middleware/requestLogger';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000'), // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100'), // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
});

// Middleware
app.use(helmet());
app.use(compression());
app.use(limiter);
app.use(cors({
  origin: "*",
}));
app.use(morgan('combined'));
app.use(requestLogger); // Add request logging middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Health check endpoint
app.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/progress', progressRoutes);
app.use('/api/subscriptions', subscriptionRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/promo-codes', promoCodeRoutes);
app.use('/api/logs', logsRoutes);

// Error handling middleware
app.use(notFound);
app.use(errorHandler);

// Initialize services and start server
const startServer = async () => {
  try {
    // Connect to databases
    await connectDB();
    await connectRedis();
    
    // Initialize services
    initializeFirebase();
    initializeStripe();
    initializeStorage();
    
    // Start notification services
    notificationService.startReminderScheduler();
    notificationService.scheduleTrialExpiryReminders();
    
    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`📊 Environment: ${process.env.NODE_ENV}`);
      console.log(`🔗 Health check: http://localhost:${PORT}/health`);
      console.log(`📱 Notification service started`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

// Handle unhandled promise rejections
process.on('unhandledRejection', (err: Error) => {
  console.error('Unhandled Promise Rejection:', err.message);
  process.exit(1);
});

// Handle uncaught exceptions
process.on('uncaughtException', (err: Error) => {
  console.error('Uncaught Exception:', err.message);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received. Shutting down gracefully...');
  process.exit(0);
});

startServer();