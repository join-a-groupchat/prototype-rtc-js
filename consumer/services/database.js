/**
 * Database service for handling Postgres operations
 * Manages connection pooling, transactions, and message insertion
 */

import { Pool } from 'pg';
import { postgresConfig } from '../config/index.js';
import { logger } from '../utils/logger.js';

/**
 * Database service class
 */
export class DatabaseService {
  constructor() {
    this.pool = null;
    this.isConnected = false;
  }

  /**
   * Initialize database connection pool
   */
  async initialize() {
    try {
      this.pool = new Pool(postgresConfig);
      
      // Set up error handling
      this.pool.on('error', (err) => {
        logger.error(`Unexpected PG pool error: ${err.message}`);
        this.isConnected = false;
      });

      // Test connection
      await this.pool.query('SELECT 1');
      this.isConnected = true;
      logger.success('✅ Postgres pool created and connected');
    } catch (error) {
      logger.error(`Failed to initialize database connection: ${error.message}`);
      throw error;
    }
  }

  /**
   * Insert messages into the database with transaction handling
   * @param {Array} messages - Array of message objects to insert
   */
  async insertMessages(messages) {
    if (!messages?.length) {
      return;
    }

    const values = [];
    const placeholders = [];
    let idx = 1;

    // Prepare values and placeholders for batch insert
    for (const message of messages) {
      const { id, fields } = message;
      const username = fields.user ?? fields.username ?? null;
      const content = fields.message ?? fields.content ?? null;
      const timestamp = fields.timestamp 
        ? new Date(Number(fields.timestamp)) 
        : new Date();

      values.push(id, username, content, timestamp);
      placeholders.push(`($${idx}, $${idx+1}, $${idx+2}, $${idx+3})`);
      idx += 4;
    }

    const sql = `
      INSERT INTO messages (redis_id, username, content, timestamp)
      VALUES ${placeholders.join(", ")}
      ON CONFLICT (redis_id) DO NOTHING
    `;

    logger.info(`Saving ${messages.length} messages to database`);

    try {
      await this.pool.query('BEGIN');
      await this.pool.query(sql, values);
      await this.pool.query('COMMIT');
      logger.success(`Successfully saved ${messages.length} messages to database`);
    } catch (error) {
      await this.pool.query('ROLLBACK').catch((rollbackErr) => {
        logger.error(`Database ROLLBACK error: ${rollbackErr?.message || rollbackErr}`);
      });
      
      logger.error(`Database insert error: ${error.message}`);
      throw error;
    }
  }

  /**
   * Close database connections
   */
  async close() {
    if (this.pool) {
      try {
        await this.pool.end();
        this.isConnected = false;
        logger.success('✅ Database connections closed');
      } catch (error) {
        logger.error(`Error closing database connections: ${error.message}`);
      }
    }
  }

  /**
   * Check if database is connected
   */
  isHealthy() {
    return this.isConnected && this.pool && !this.pool.ending;
  }
}
