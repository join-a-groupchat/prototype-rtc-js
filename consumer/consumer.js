<<<<<<< HEAD
// consumer-group-batched.js (updated)
import { createClient } from "redis";
import { Pool  } from "pg";
import pLimit from "p-limit";
import dotenv from 'dotenv';
dotenv.config({ path: '../config/.env' });

// use consumer groups because we can have multiple consumers
const STREAM = process.env.STREAM_KEY || "chat_stream";
const GROUP = process.env.CONSUMER_GROUP || "cg1";
const CONSUMER = process.env.CONSUMER_NAME || `c-${Math.random().toString(36).slice(2,8)}`;

// Redis
const redis = createClient({ url: process.env.REDIS_URL || `redis://:${process.env.REDIS_PWD}@${process.env.REDIS_HOST}:${process.env.REDIS_PORT}` });
await redis.connect();
console.log("✅ Redis connected");

// Postgres (use pool for resilience)
const pgPool = new Pool({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: false, //{ rejectUnauthorized: false },
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 20000,
});

pgPool.on('error', (err) => {
  console.error('Unexpected PG pool error', err);
  // do NOT throw — log and keep running; queries will fail until reconnect
});
console.log("✅ Postgres pool created");

// Settings (tune via env vars)
const READ_COUNT = Number(process.env.XREAD_COUNT || 500);
const READ_BLOCK_MS = Number(process.env.XREAD_BLOCK_MS || 10);

// flush settings for batching to db
const BATCH_SIZE = Number(process.env.BATCH_SIZE || 200);
const BATCH_TIMEOUT_MS = Number(process.env.BATCH_TIMEOUT_MS || 200);
const FLUSH_CONCURRENCY = Number(process.env.FLUSH_CONCURRENCY || 1);

// New claim settings for clearing pending entries
const CLAIM_MIN_IDLE_MS = Number(process.env.CLAIM_MIN_IDLE_MS || 10000); // claim entries idle longer than this
const CLAIM_COUNT = Number(process.env.CLAIM_COUNT || 200); // how many to claim per call

// Ensure consumer group exists (create if not)
async function ensureGroup() {
  try {
    await redis.xGroupCreate(STREAM, GROUP, '0', { MKSTREAM: true });
    console.log(`Created group ${GROUP}`);
  } catch (err) {
    if (err.message && err.message.includes('BUSYGROUP')) {
      console.log(`Group ${GROUP} already exists`);
    } else {
      console.error("Error creating group:", err);
      throw err;
    }
  }
}
await ensureGroup();

// In-memory buffer and flush scheduling
let buffer = []; // { id, fields }
let flushTimer = null;
const limit = pLimit(FLUSH_CONCURRENCY);
let shuttingDown = false;

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => { flushTimer = null; triggerFlush(); }, BATCH_TIMEOUT_MS);
}

async function triggerFlush() {
  if (!buffer.length) return;
  const toFlush = buffer;
  buffer = [];
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  await limit(() => flushToDbAndAck(toFlush));
}

// flush batch to Postgres and ACK in Redis
async function flushToDbAndAck(msgs) {
  if (!msgs || !msgs.length) return;
  const values = [];
  const placeholders = [];
  let idx = 1;
  for (const m of msgs) {
    const f = m.fields;
    const username = f.user ?? f.username ?? null;
    const content = f.message ?? f.content ?? null;
    const ts = f.timestamp ? new Date(Number(f.timestamp)) : new Date();
    values.push(m.id, username, content, ts);
    placeholders.push(`($${idx}, $${idx+1}, $${idx+2}, $${idx+3})`);
    idx += 4;
  }

  const sql = `
    INSERT INTO messages (redis_id, username, content, timestamp)
    VALUES ${placeholders.join(", ")}
    ON CONFLICT (redis_id) DO NOTHING
  `;

  console.log("Saved: ", msgs.length, "messages to DB");

  try {
    await pgPool.query('BEGIN');
    await pgPool.query(sql, values);
    await pgPool.query('COMMIT');
  } catch (err) {
    await pgPool.query('ROLLBACK').catch(()=>{});
    console.error("DB insert error, requeueing batch:", err.message || err);
    buffer = msgs.concat(buffer);
    await new Promise(r => setTimeout(r, 200));
    return;
  }

  const ids = msgs.map(m => m.id);
  try {
    await redis.xAck(STREAM, GROUP, ...ids);
  } catch (err) {
    console.error("XACK error (messages inserted but not acked):", err.message || err);
  }
}

// helper
function chunkArray(arr, n) {
  const out = [];
  for (let i=0;i<arr.length;i+=n) out.push(arr.slice(i,i+n));
  return out;
}

// Recover pending messages (on startup) - meaning messages that were delivered but not ACKed
async function recoverPending() {
  console.log(`Recovering pending messages for group=${GROUP}, consumer=${CONSUMER}`);
  // start from 0 to iterate through pending range
  let startId = '0-0';
  while (true) {
    try {
      // xAutoClaim returns [nextStartId, messages]
      const res = await redis.xAutoClaim(STREAM, GROUP, CONSUMER, CLAIM_MIN_IDLE_MS, startId, { COUNT: CLAIM_COUNT });
      if (!res) break;
      const nextId = res[0];
      const rawMsgs = (res[1] || res[1]) ?? [];
      if (!rawMsgs || rawMsgs.length === 0) break;

      // normalize format into [{id, fields}]
      const toProcess = rawMsgs.map(m => {
        const id = m.id ?? m[0];
        let fields = m.message ?? m[1] ?? {};
        if (Array.isArray(fields)) fields = Object.fromEntries(chunkArray(fields, 2));
        return { id, fields };
      });

      console.log(`Claimed ${toProcess.length} pending messages (nextId=${nextId})`);
      // flush them immediately (this will INSERT ON CONFLICT DO NOTHING and XACK)
      await flushToDbAndAck(toProcess);

      // prepare next start; if we didn't reach CLAIM_COUNT, we can break (likely done)
      startId = nextId;
      if (toProcess.length < CLAIM_COUNT) break;
    } catch (err) {
      console.error("recoverPending error:", err.message || err);
      // small backoff then retry
      await new Promise(r => setTimeout(r, 500));
    }
  }
  console.log("Pending recovery complete");
}

// Main loop: read from group and buffer
async function loop() {
  console.log(`Consumer ${CONSUMER} joining group ${GROUP} on stream ${STREAM}`);
  while (!shuttingDown) {
    try {
      const res = await redis.xReadGroup(GROUP, CONSUMER, { key: STREAM, id: '>' }, { COUNT: READ_COUNT, BLOCK: READ_BLOCK_MS });
      if (!res) {
        await triggerFlush();
        continue;
      }
      const stream = res[0];
      const msgs = stream.messages || stream[1] || [];
      if (!msgs.length) {
        await triggerFlush();
        continue;
      }
      for (const m of msgs) {
        const id = m.id ?? m[0];
        let fields = m.message ?? m[1] ?? {};
        if (Array.isArray(fields)) fields = Object.fromEntries(chunkArray(fields, 2));
        buffer.push({ id, fields });
        if (buffer.length === 1) scheduleFlush();
        if (buffer.length >= BATCH_SIZE) {
          triggerFlush().catch(e => console.error("triggerFlush error:", e));
        }
      }
    } catch (err) {
      console.error("ReadGroup loop error:", err.message || err);
      await new Promise(r => setTimeout(r, 200));
    }
  }
}

// graceful shutdown
process.on('SIGINT', async () => {
  console.log("SIGINT - flushing and shutting down...");
  shuttingDown = true;
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  await triggerFlush();
  await limit(() => Promise.resolve());
  await pgPool.end().catch(()=>{});
  await redis.disconnect().catch(()=>{});
  process.exit(0);
});

// run recovery first, then enter loop
await recoverPending();
loop();
=======
/**
 * Main consumer application entry point
 * Orchestrates all services and handles the main application lifecycle
 */

import { DatabaseService } from './services/database.js';
import { RedisService } from './services/redis.js';
import { BatchProcessor } from './services/batchProcessor.js';
import { delay } from './utils/helpers.js';
import { consumerSettings, redisConfig } from './config/index.js';
import { logger } from './utils/logger.js';

/**
 * Consumer application class
 */
class ConsumerApp {
  constructor() {
    this.databaseService = new DatabaseService();
    this.redisService = new RedisService();
    this.batchProcessor = new BatchProcessor(this.databaseService, this.redisService);
    
    this.isRunning = false;
  }

  /**
   * Initialize all services
   */
  async initialize() {
    logger.info('Initializing consumer application...');
    
    try {
      // Initialize services in order
      await this.databaseService.initialize();
      await this.redisService.initialize();
      
      logger.success('✅ All services initialized successfully');
    } catch (error) {
      logger.error(`Failed to initialize application: ${error.message}`);
      throw error;
    }
  }

  /**
   * Start the main application loop
   */
  async start() {
    if (this.isRunning) {
      logger.warn('Application is already running');
      return;
    }

    this.isRunning = true;
    logger.info(`Starting consumer ${redisConfig.consumer} on stream ${redisConfig.stream}`);

    try {
      // Recover pending messages first
      await this.recoverPendingMessages();
      
      // Start the main processing loop
      await this.mainLoop();
    } catch (error) {
      logger.error(`Application error: ${error.message}`);
      await this.shutdown();
      throw error;
    }
  }

  /**
   * Recover pending messages on startup
   */
  async recoverPendingMessages() {
    logger.info('Recovering pending messages...');
    
    try {
      const pendingMessages = await this.redisService.recoverPendingMessages(
        consumerSettings.claimMinIdleMs,
        consumerSettings.claimCount
      );
      
      if (pendingMessages.length > 0) {
        await this.batchProcessor.processRecoveredMessages(pendingMessages);
      }
    } catch (error) {
      logger.error(`Error recovering pending messages: ${error.message}`);
      // Continue anyway, as this is not critical for operation
    }
  }

  /**
   * Main processing loop
   */
  async mainLoop() {
    logger.info('Starting main processing loop...');
    logger.info(`Consumer ${redisConfig.consumer} joining group ${redisConfig.group} on stream ${redisConfig.stream}`);
    
    while (this.isRunning && !this.batchProcessor.isShuttingDown()) {
      try {
        const messages = await this.redisService.readMessages(
          consumerSettings.readCount,
          consumerSettings.readBlockMs
        );

        if (messages.length > 0) {
          // Process each message
          for (const message of messages) {
            const normalizedMessage = this.redisService.normalizeMessage(message);
            this.batchProcessor.addMessage(normalizedMessage);
          }
        } else {
          // No messages, trigger flush if needed
          await this.batchProcessor.triggerFlush();
        }
        
      } catch (error) {
        logger.error(`Error in main loop: ${error.message}`);
        logger.debug(`Stack trace: ${error.stack}`);
        
        // Small delay before retry
        await delay(200);
      }
    }
    
    logger.info('Main processing loop stopped');
  }

  /**
   * Graceful shutdown
   */
  async shutdown() {
    if (!this.isRunning) {
      logger.warn('Application is not running');
      return;
    }

    logger.info('Starting graceful shutdown...');
    
    this.isRunning = false;
    this.batchProcessor.setShuttingDown(true);

    try {
      // Force flush remaining messages
      await this.batchProcessor.forceFlush();
      
      // Wait for all pending operations to complete
      await this.batchProcessor.waitForCompletion();
      
      // Close services
      await this.redisService.close();
      await this.databaseService.close();
      
      logger.success('✅ Graceful shutdown completed');
    } catch (error) {
      logger.error(`Error during shutdown: ${error.message}`);
      // Force exit if graceful shutdown fails
      process.exit(1);
    }
  }

  /**
   * Get application health status
   */
  getHealthStatus() {
    return {
      isRunning: this.isRunning,
      isRedisHealthy: this.redisService.isHealthy(),
      isDatabaseHealthy: this.databaseService.isHealthy(),
      bufferSize: this.batchProcessor.getBufferSize(),
      timestamp: new Date().toISOString()
    };
  }
}

/**
 * Application lifecycle management
 */
async function main() {
  const app = new ConsumerApp();
  
  // Handle graceful shutdown
  const shutdownHandler = async (signal) => {
    logger.info(`Received ${signal}. Initiating shutdown...`);
    await app.shutdown();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdownHandler('SIGINT'));
  process.on('SIGTERM', () => shutdownHandler('SIGTERM'));
  
  // Handle uncaught exceptions
  process.on('uncaughtException', async (error) => {
    logger.error(`Uncaught Exception: ${error.message}`);
    await app.shutdown();
    process.exit(1);
  });
  
  process.on('unhandledRejection', async (reason, promise) => {
    logger.error(`Unhandled Rejection: ${reason}`);
    await app.shutdown();
    process.exit(1);
  });

  try {
    // Initialize and start application
    await app.initialize();
    await app.start();
  } catch (error) {
    logger.error(`Application failed to start: ${error.message}`);
    process.exit(1);
  }
}

// Start the application
try {
  await main();
} catch (error) {
  logger.error(`Fatal error: ${error.message}`);
  process.exit(1);
}

export { ConsumerApp };
>>>>>>> df1bb8650cdbf1b2ac6980f1532d9e271aa93a77
