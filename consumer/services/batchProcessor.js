/**
 * Batch processing service for handling message batching and flushing
 * Manages in-memory buffering, flush scheduling, and concurrency control
 */

import pLimit from 'p-limit';
import { consumerSettings } from '../config/index.js';
import { logger } from '../utils/logger.js';

/**
 * Batch processor service class
 */
export class BatchProcessor {
  constructor(databaseService, redisService) {
    this.databaseService = databaseService;
    this.redisService = redisService;
    
    // Configuration
    this.batchSize = consumerSettings.batchSize;
    this.batchTimeoutMs = consumerSettings.batchTimeoutMs;
    this.flushConcurrency = consumerSettings.flushConcurrency;
    
    // State
    this.buffer = [];
    this.flushTimer = null;
    this.limit = pLimit(this.flushConcurrency);
    this._isShuttingDown = false;
  }

  /**
   * Add message to buffer and schedule flush if needed
   * @param {Object} message - Message to add to buffer
   */
  addMessage(message) {
    this.buffer.push(message);
    
    if (this.buffer.length === 1) {
      this.scheduleFlush();
    }
    
    if (this.buffer.length >= this.batchSize) {
      this.triggerFlush();
    }
  }

  /**
   * Schedule a flush operation after timeout
   */
  scheduleFlush() {
    if (this.flushTimer) return;
    
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.triggerFlush();
    }, this.batchTimeoutMs);
  }

  /**
   * Trigger immediate flush of buffered messages
   */
  async triggerFlush() {
    if (!this.buffer.length) return;
    
    const toFlush = this.buffer;
    this.buffer = [];
    
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    
    await this.limit(() => this.flushToDatabaseAndAck(toFlush));
  }

  /**
   * Flush messages to database and acknowledge in Redis
   * @param {Array} messages - Messages to flush
   */
  async flushToDatabaseAndAck(messages) {
    if (!messages?.length) return;

    try {
      // Insert messages to database
      await this.databaseService.insertMessages(messages);
      
      // Acknowledge messages in Redis
      const messageIds = messages.map(m => m.id);
      await this.redisService.acknowledgeMessages(messageIds);
      
    } catch (error) {
      logger.error(`Error flushing batch to database: ${error.message}`);
      
      // Re-queue messages on error
      this.buffer = messages.concat(this.buffer);
      
      // Small delay before retry
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }

  /**
   * Process recovered pending messages
   * @param {Array} messages - Recovered messages to process
   */
  async processRecoveredMessages(messages) {
    if (!messages?.length) return;
    
    logger.info(`Processing ${messages.length} recovered pending messages`);
    
    // Process in batches to avoid overwhelming the system
    const batchSize = 100;
    for (let i = 0; i < messages.length; i += batchSize) {
      const batch = messages.slice(i, i + batchSize);
      await this.flushToDatabaseAndAck(batch);
      
      // Small delay between batches
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    
    logger.success(`Completed processing ${messages.length} recovered messages`);
  }

  /**
   * Get current buffer size
   */
  getBufferSize() {
    return this.buffer.length;
  }

  /**
   * Check if processor is shutting down
   */
  isShuttingDown() {
    return this._isShuttingDown;
  }

  /**
   * Set shutdown flag
   */
  setShuttingDown(flag) {
    this._isShuttingDown = flag;
  }

  /**
   * Force flush remaining messages (used during shutdown)
   */
  async forceFlush() {
    if (this.buffer.length > 0) {
      logger.info(`Force flushing ${this.buffer.length} remaining messages`);
      await this.triggerFlush();
    }
  }

  /**
   * Wait for all pending operations to complete
   */
  async waitForCompletion() {
    await this.limit(() => Promise.resolve());
  }
}
