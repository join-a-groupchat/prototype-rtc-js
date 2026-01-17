/**
 * Redis service for handling Redis operations
 * Manages Redis client, consumer groups, and stream operations
 */

import { createClient } from 'redis';
import { redisConfig } from '../config/index.js';
import { logger } from '../utils/logger.js';

/**
 * Redis service class
 */
export class RedisService {
  client = null;
  isConnected = false;

  /**
   * Initialize Redis client and connect
   */
  async initialize() {
    try {
      this.client = createClient({ url: redisConfig.url });
      
      this.client.on('error', (err) => {
        logger.error(`Redis client error: ${err.message}`);
        this.isConnected = false;
      });

      this.client.on('connect', () => {
        logger.info('Redis client connected');
      });

      this.client.on('ready', () => {
        this.isConnected = true;
        logger.success('✅ Redis client ready');
      });

      await this.client.connect();
      await this.ensureConsumerGroup();
    } catch (error) {
      logger.error(`Failed to initialize Redis: ${error.message}`);
      throw error;
    }
  }

  /**
   * Ensure consumer group exists, create if it doesn't
   */
  async ensureConsumerGroup() {
    try {
      await this.client.xGroupCreate(redisConfig.stream, redisConfig.group, '0', { MKSTREAM: true });
      logger.success(`Created consumer group ${redisConfig.group}`);
    } catch (err) {
      if (err.message?.includes('BUSYGROUP')) {
        logger.info(`Consumer group ${redisConfig.group} already exists`);
      } else {
        logger.error(`Error creating consumer group: ${err.message}`);
        throw err;
      }
    }
  }

  /**
   * Read messages from the stream
   * @param {number} count - Number of messages to read
   * @param {number} blockMs - Block timeout in milliseconds
   * @returns {Promise<Array>} Array of messages
   */
  async readMessages(count = 500, blockMs = 10) {
    try {
      const result = await this.client.xReadGroup(
        redisConfig.group, 
        redisConfig.consumer, 
        { key: redisConfig.stream, id: '>' }, 
        { COUNT: count, BLOCK: blockMs }
      );
      
      if (!result) return [];
      
      const stream = result[0];
      const messages = stream.messages || stream[1] || [];
      return messages;
    } catch (error) {
      logger.error(`Error reading messages from stream: ${error.message}`);
      throw error;
    }
  }

  /**
   * Acknowledge messages in the stream
   * @param {Array} messageIds - Array of message IDs to acknowledge
   */
  async acknowledgeMessages(messageIds) {
    if (!messageIds?.length) return;

    try {
      await this.client.xAck(redisConfig.stream, redisConfig.group, ...messageIds);
    } catch (error) {
      logger.error(`XACK error (messages inserted but not acked): ${error.message}`);
      throw error;
    }
  }

  /**
   * Recover pending messages (messages that were delivered but not ACKed)
   * @param {number} minIdleMs - Minimum idle time in milliseconds
   * @param {number} count - Number of messages to claim
   * @returns {Promise<Array>} Array of recovered messages
   */
  async recoverPendingMessages(minIdleMs = 10000, count = 200) {
    logger.info(`Recovering pending messages for group=${redisConfig.group}, consumer=${redisConfig.consumer}`);
    
    const recoveredMessages = [];
    let startId = '0-0';
    
    while (true) {
      try {
        const result = await this.client.xAutoClaim(
          redisConfig.stream, 
          redisConfig.group, 
          redisConfig.consumer, 
          minIdleMs, 
          startId, 
          { COUNT: count }
        );
        
        if (!result) break;
        
        const nextId = result[0];
        const rawMessages = result[1] ?? [];
        
        if (!rawMessages || rawMessages.length === 0) break;

        // Normalize format into [{id, fields}]
        const normalizedMessages = rawMessages.map(message => {
          const id = message.id ?? message[0];
          let fields = message.message ?? message[1] ?? {};
          if (Array.isArray(fields)) {
            fields = Object.fromEntries(this.chunkArray(fields, 2));
          }
          return { id, fields };
        });

        recoveredMessages.push(...normalizedMessages);
        logger.info(`Claimed ${normalizedMessages.length} pending messages (nextId=${nextId})`);
        
        // Prepare next start; if we didn't reach count, we can break (likely done)
        startId = nextId;
        if (normalizedMessages.length < count) break;
        
      } catch (error) {
        logger.error(`Error recovering pending messages: ${error.message}`);
        // Small backoff then retry
        await new Promise(resolve => setTimeout(resolve, 500));
        break; // Break on error to avoid infinite loop
      }
    }
    
    logger.success(`Pending recovery complete. Recovered ${recoveredMessages.length} messages`);
    return recoveredMessages;
  }

  /**
   * Close Redis connection
   */
  async close() {
    if (this.client) {
      try {
        await this.client.disconnect();
        this.isConnected = false;
        logger.success('✅ Redis connection closed');
      } catch (error) {
        logger.error(`Error closing Redis connection: ${error.message}`);
      }
    }
  }

  /**
   * Check if Redis is connected
   */
  isHealthy() {
    return this.isConnected && this.client && !this.client.closing;
  }

  /**
   * Helper function to chunk array
   * @param {Array} arr - Array to chunk
   * @param {number} n - Chunk size
   * @returns {Array} Chunked array
   */
  chunkArray(arr, n) {
    const out = [];
    for (let i = 0; i < arr.length; i += n) {
      out.push(arr.slice(i, i + n));
    }
    return out;
  }

  /**
   * Normalize message format from Redis stream
   * @param {Object|Array} message - Raw message from Redis
   * @returns {Object} Normalized message object
   */
  normalizeMessage(message) {
    const id = message.id ?? message[0];
    let fields = message.message ?? message[1] ?? {};
    
    if (Array.isArray(fields)) {
      fields = Object.fromEntries(this.chunkArray(fields, 2));
    }
    
    return { id, fields };
  }
}
