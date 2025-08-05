import { createClient, RedisClientType } from 'redis';

let redisClient: RedisClientType;

export const connectRedis = async (): Promise<void> => {
  try {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    
    redisClient = createClient({
      url: redisUrl,
      socket: {
        reconnectStrategy: (retries) => Math.min(retries * 50, 1000),
      },
    });

    redisClient.on('error', (error) => {
      console.error('❌ Redis connection error:', error);
    });

    redisClient.on('connect', () => {
      console.log('🔄 Redis connecting...');
    });

    redisClient.on('ready', () => {
      console.log('✅ Redis connected and ready');
    });

    redisClient.on('end', () => {
      console.warn('⚠️ Redis connection closed');
    });

    redisClient.on('reconnecting', () => {
      console.log('🔄 Redis reconnecting...');
    });

    await redisClient.connect();
  } catch (error) {
    console.error('❌ Redis connection failed:', error);
    // Don't exit process for Redis failures, continue without caching
    console.warn('⚠️ Continuing without Redis caching...');
  }
};

export const getRedisClient = (): RedisClientType | null => {
  return redisClient && redisClient.isReady ? redisClient : null;
};

export const disconnectRedis = async (): Promise<void> => {
  try {
    if (redisClient && redisClient.isReady) {
      await redisClient.quit();
      console.log('🔌 Redis disconnected successfully');
    }
  } catch (error) {
    console.error('❌ Error disconnecting from Redis:', error);
  }
};

// Cache utility functions
export const cache = {
  async get(key: string): Promise<string | null> {
    try {
      const client = getRedisClient();
      if (!client) return null;
      return await client.get(key);
    } catch (error) {
      console.error('❌ Redis GET error:', error);
      return null;
    }
  },

  async set(key: string, value: string, ttlSeconds?: number): Promise<boolean> {
    try {
      const client = getRedisClient();
      if (!client) return false;
      
      if (ttlSeconds) {
        await client.setEx(key, ttlSeconds, value);
      } else {
        await client.set(key, value);
      }
      return true;
    } catch (error) {
      console.error('❌ Redis SET error:', error);
      return false;
    }
  },

  async del(key: string): Promise<boolean> {
    try {
      const client = getRedisClient();
      if (!client) return false;
      await client.del(key);
      return true;
    } catch (error) {
      console.error('❌ Redis DEL error:', error);
      return false;
    }
  },

  async exists(key: string): Promise<boolean> {
    try {
      const client = getRedisClient();
      if (!client) return false;
      const result = await client.exists(key);
      return result === 1;
    } catch (error) {
      console.error('❌ Redis EXISTS error:', error);
      return false;
    }
  },

  async flush(): Promise<boolean> {
    try {
      const client = getRedisClient();
      if (!client) return false;
      await client.flushAll();
      return true;
    } catch (error) {
      console.error('❌ Redis FLUSH error:', error);
      return false;
    }
  },
};