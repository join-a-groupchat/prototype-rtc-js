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
