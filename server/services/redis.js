import { createClient } from 'redis';
import { REDIS_CONFIG } from '../config/index.js';

class RedisService {
  constructor() {
    this.publisher = null;
    this.subscriber = null;
    this.isConnected = false;
  }

  /**
   * Initialize Redis connections (publisher and subscriber)
   */
  async connect() {
    try {
      // Create publisher client
      this.publisher = createClient({
        url: REDIS_CONFIG.URL
      });

      // Create subscriber client
      this.subscriber = createClient({
        url: REDIS_CONFIG.URL
      });

      // Connect both clients
      await Promise.all([
        this.publisher.connect(),
        this.subscriber.connect()
      ]);

      this.isConnected = true;
      console.log('✅ Connected to Redis PUB/SUB + Streams');
      
      return { publisher: this.publisher, subscriber: this.subscriber };
    } catch (error) {
      console.error('❌ Failed to connect to Redis:', error);
      throw error;
    }
  }

  /**
   * Get the publisher client
   */
  getPublisher() {
    if (!this.publisher) {
      throw new Error('Redis publisher not connected. Call connect() first.');
    }
    return this.publisher;
  }

  /**
   * Get the subscriber client
   */
  getSubscriber() {
    if (!this.subscriber) {
      throw new Error('Redis subscriber not connected. Call connect() first.');
    }
    return this.subscriber;
  }

  /**
   * Publish a message to the chat channel
   * @param {Object} message - The message to publish
   * @returns {Promise<number>} Number of clients that received the message
   */
  async publishMessage(message) {
    try {
      const publisher = this.getPublisher();
      const result = await publisher.publish(REDIS_CONFIG.CHANNEL, JSON.stringify(message));
      return result;
    } catch (error) {
      console.error('❌ Failed to publish message to Redis:', error);
      throw error;
    }
  }

  /**
   * Subscribe to the chat channel
   * @param {Function} handler - Handler function for incoming messages
   */
  async subscribeToChannel(handler) {
    try {
      const subscriber = this.getSubscriber();
      await subscriber.subscribe(REDIS_CONFIG.CHANNEL, handler);
    } catch (error) {
      console.error('❌ Failed to subscribe to Redis channel:', error);
      throw error;
    }
  }

  /**
   * Add a message to the Redis stream
   * @param {Object} message - The message to add to the stream
   * @returns {Promise<string>} The stream entry ID
   */
  async addMessageToStream(message) {
    try {
      const publisher = this.getPublisher();
      const result = await publisher.xAdd(
        REDIS_CONFIG.STREAM,
        '*',
        {
          user: String(message.username || ''),
          message: String(message.message || ''),
          timestamp: String(message.timestamp || Date.now())
        },
        {
          MAXLEN: '~',
          COUNT: REDIS_CONFIG.STREAM_MAX_LENGTH || 1000
        }
      );
      return result;
    } catch (error) {
      console.error('❌ Failed to add message to Redis stream:', error);
      throw error;
    }
  }

  /**
   * Get recent messages from the Redis stream
   * @deprecated Use a newer message retrieval method instead
   * @param {number} count - Number of messages to retrieve
   * @returns {Promise<Array>} Array of stream messages
   */
  async getRecentMessagesFromStream(count = 10) {
    console.warn('⚠️ getRecentMessagesFromStream() is deprecated and will be removed in a future version.');
    try {
      const subscriber = this.getSubscriber();
      const messages = await subscriber.xRevRange(
        REDIS_CONFIG.STREAM,
        '+',
        '-',
        { COUNT: count }
      );
      return messages.map(msg => ({
        id: msg.id,
        ...msg.message
      }));
    } catch (error) {
      console.error('❌ Failed to get recent messages from Redis stream:', error);
      throw error;
    }
  }

  /**
   * Unsubscribe from the chat channel
   */
  async unsubscribeFromChannel() {
    try {
      const subscriber = this.getSubscriber();
      await subscriber.unsubscribe(REDIS_CONFIG.CHANNEL);
    } catch (error) {
      console.error('❌ Failed to unsubscribe from Redis channel:', error);
      throw error;
    }
  }

  /**
   * Close Redis connections
   */
  async close() {
    try {
      if (this.publisher) {
        await this.publisher.disconnect();
      }
      if (this.subscriber) {
        await this.subscriber.disconnect();
      }
      this.isConnected = false;
      console.log('✅ Redis connections closed');
    } catch (error) {
      console.error('❌ Error closing Redis connections:', error);
      throw error;
    }
  }
}

// Create and export a singleton instance
export const redisService = new RedisService();

export default redisService;
