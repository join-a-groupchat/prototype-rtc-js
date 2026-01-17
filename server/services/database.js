import { Pool } from 'pg';
import { POSTGRES_CONFIG } from '../config/index.js';

class DatabaseService {
  constructor() {
    this.pool = null;
    this.isConnected = false;
  }

  /**
   * Initialize the PostgreSQL connection pool
   */
  async connect() {
    try {
      this.pool = new Pool({
        connectionString: POSTGRES_CONFIG.CONNECTION_STRING,
        ssl: POSTGRES_CONFIG.SSL,
        ...POSTGRES_CONFIG.POOL
      });

      // Test the connection
      await this.pool.query('SELECT NOW()');
      this.isConnected = true;
      
      // Handle connection errors
      this.pool.on('error', (err) => {
        console.error('❌ Unexpected PG pool error:', err);
        this.isConnected = false;
      });

      console.log('✅ PostgreSQL pool created successfully');
      return this.pool;
    } catch (error) {
      console.error('❌ Failed to connect to PostgreSQL:', error.message);
      throw error;
    }
  }

  /**
   * Get the connection pool instance
   */
  getPool() {
    if (!this.pool) {
      throw new Error('Database not connected. Call connect() first.');
    }
    return this.pool;
  }

  /**
   * Load recent messages from PostgreSQL
   * @param {number} limit - Number of messages to load
   * @returns {Promise<Array>} Array of message objects
   */
  async loadRecentMessages(limit = 50) {
    try {
      const pool = this.getPool();
      const result = await pool.query(
        'SELECT * FROM messages ORDER BY timestamp DESC LIMIT $1',
        [limit]
      );

      console.log(`🔃 Loaded ${result.rows.length} messages from PostgreSQL`);
      return result.rows;
    } catch (error) {
      console.error('❌ Failed to load recent messages:', error);
      throw error;
    }
  }

  /**
   * Load older messages for pagination
   * @param {Date} before - Load messages before this timestamp
   * @param {number} limit - Number of messages to load
   * @returns {Promise<Array>} Array of message objects
   */
  async loadOlderMessages(before, limit = 50) {
    try {
      const pool = this.getPool();
      const result = await pool.query(
        'SELECT * FROM messages WHERE timestamp < $1 ORDER BY timestamp DESC LIMIT $2',
        [before, limit]
      );

      console.log(`📜 Loaded ${result.rows.length} older messages from PostgreSQL`);
      return result.rows;
    } catch (error) {
      console.error('❌ Failed to load older messages:', error);
      throw error;
    }
  }

  /**
   * Close the database connection pool
   */
  async close() {
    if (this.pool) {
      await this.pool.end();
      this.isConnected = false;
      console.log('✅ PostgreSQL connection pool closed');
    }
  }
}

// Create and export a singleton instance
export const databaseService = new DatabaseService();

export default databaseService;
