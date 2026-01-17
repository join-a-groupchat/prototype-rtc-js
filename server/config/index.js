import dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '../config/.env' });

// Validate required environment variables
const requiredEnvVars = [
  'REDIS_PWD',
  'REDIS_HOST', 
  'REDIS_PORT',
  'SUPABASE_DB_URL'
];

const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingVars.length > 0) {
  throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
}

// Server configuration
export const SERVER_CONFIG = {
  PORT: Number(process.env.PORT) || 9001,
  SERVER_ID: Math.random().toString(36).slice(2),
  ALLOWED_ORIGINS: [
    'http://localhost:5173', 
    'http://127.0.0.1:5173', 
    'http://localhost:9001', 
    'http://127.0.0.1:9001'
  ],
  WEBSOCKET: {
    COMPRESSION: 64, // uWS.SHARED_COMPRESSOR
    MAX_PAYLOAD_LENGTH: 16 * 1024,
    IDLE_TIMEOUT: 60
  }
};

// Redis configuration
export const REDIS_CONFIG = {
  URL: `redis://:${process.env.REDIS_PWD}@${process.env.REDIS_HOST}:${process.env.REDIS_PORT}`,
  CHANNEL: 'chat_channel',
  STREAM: 'chat_stream'
};

// PostgreSQL configuration
export const POSTGRES_CONFIG = {
  CONNECTION_STRING: process.env.SUPABASE_DB_URL,
  SSL: { rejectUnauthorized: false },
  POOL: {
    MAX: 5,
    IDLE_TIMEOUT_MILLIS: 30000,
    CONNECTION_TIMEOUT_MILLIS: 20000
  }
};

// Message filtering configuration
export const MESSAGE_CONFIG = {
  FILTERED_WORDS: [
    'damn', 'hell', 'shit', 'ass', 'bitch', 'bastard', 'crap', 'piss', 'suck', 'freaking',
    'frick', 'heck', 'darn', 'jeez', 'gosh', 'douche', 'moron', 'idiot', 'stupid', 'loser'
  ],
  HISTORY_LIMIT: 50,
  STREAM_MAX_LENGTH: 1000
};

// Logging configuration
export const LOG_CONFIG = {
  LEVEL: process.env.LOG_LEVEL || 'info',
  COLORS: true
};

console.log(`✅ Server configuration loaded. Server ID: ${SERVER_CONFIG.SERVER_ID}`);
