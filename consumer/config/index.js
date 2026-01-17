/**
 * Configuration management for the consumer application
 * Centralizes all environment variables and provides validation
 */

import dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '../config/.env' });

/**
 * Redis configuration
 */
export const redisConfig = {
  url: process.env.REDIS_URL || `redis://:${process.env.REDIS_PWD}@${process.env.REDIS_HOST}:${process.env.REDIS_PORT}`,
  stream: process.env.STREAM_KEY || "chat_stream",
  group: process.env.CONSUMER_GROUP || "cg1",
  consumer: process.env.CONSUMER_NAME || `c-${Math.random().toString(36).slice(2,8)}`,
};

/**
 * Postgres configuration
 */
export const postgresConfig = {
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 20000,
};

/**
 * Consumer settings
 */
export const consumerSettings = {
  // Redis stream settings
  readCount: Number(process.env.XREAD_COUNT || 500),
  readBlockMs: Number(process.env.XREAD_BLOCK_MS || 10),
  
  // Batch processing settings
  batchSize: Number(process.env.BATCH_SIZE || 200),
  batchTimeoutMs: Number(process.env.BATCH_TIMEOUT_MS || 200),
  flushConcurrency: Number(process.env.FLUSH_CONCURRENCY || 1),
  
  // Pending message recovery settings
  claimMinIdleMs: Number(process.env.CLAIM_MIN_IDLE_MS || 10000),
  claimCount: Number(process.env.CLAIM_COUNT || 200),
};

/**
 * Logging configuration
 */
export const LOG_CONFIG = {
  LEVEL: process.env.LOG_LEVEL || 'info',
  COLORS: true
};

/**
 * Validate required configuration
 */
export function validateConfig() {
  const required = {
    REDIS_URL: redisConfig.url,
    SUPABASE_DB_URL: postgresConfig.connectionString,
  };

  const missing = Object.entries(required)
    .filter(([key, value]) => !value)
    .map(([key]) => key);

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

/**
 * Get all configuration
 */
export function getConfig() {
  return {
    redis: redisConfig,
    postgres: postgresConfig,
    settings: consumerSettings,
  };
}

// Validate configuration on import
validateConfig();
