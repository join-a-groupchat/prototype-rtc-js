import { MESSAGE_CONFIG } from '../config/index.js';

class MessageProcessor {
  constructor() {
    // Compile regex patterns once for better performance
    this.filteredWordPatterns = MESSAGE_CONFIG.FILTERED_WORDS.map(word => 
      new RegExp(`\\b${word}\\b`, 'gi')
    );
  }

  /**
   * Filter profanity from a message
   * @param {string} message - The message to filter
   * @returns {string} The filtered message
   */
  filterMessage(message) {
    if (!message || typeof message !== 'string') {
      return message;
    }

    let filtered = message;

    // Apply each filtered word pattern
    this.filteredWordPatterns.forEach(pattern => {
      filtered = filtered.replace(pattern, (match) => '*'.repeat(match.length));
    });

    return filtered;
  }

  /**
   * Validate and sanitize a chat message
   * @param {Object} messageData - The message data to validate
   * @returns {Object} Validated and sanitized message
   */
  validateMessage(messageData) {
    if (!messageData || typeof messageData !== 'object') {
      throw new Error('Invalid message data');
    }

    const { type, username, message } = messageData;

    // Validate message type
    if (!type || typeof type !== 'string') {
      throw new Error('Invalid message type');
    }

    // Validate chat messages
    if (type === 'chat') {
      if (!username || typeof username !== 'string' || username.trim().length === 0) {
        throw new Error('Invalid username');
      }

      if (!message || typeof message !== 'string' || message.trim().length === 0) {
        throw new Error('Invalid message content');
      }

      // Sanitize username and message
      const sanitizedUsername = username.trim().substring(0, 50); // Limit username length
      const sanitizedMessage = message.trim().substring(0, 1000); // Limit message length

      return {
        type: 'chat',
        username: sanitizedUsername,
        message: sanitizedMessage
      };
    }

    // Validate load_more messages
    if (type === 'load_more') {
      const before = messageData.before;
      const limit = messageData.limit;

      if (before && Number.isNaN(new Date(before).getTime())) {
        throw new Error('Invalid before timestamp');
      }

      if (limit !== undefined && (Number.isNaN(limit) || limit <= 0 || limit > 100)) {
        throw new Error('Invalid limit parameter');
      }

      return {
        type: 'load_more',
        before: before ? new Date(before) : new Date(),
        limit: limit !== undefined ? limit : MESSAGE_CONFIG.HISTORY_LIMIT
      };
    }

    throw new Error(`Unknown message type: ${type}`);
  }

  /**
   * Process a chat message (validate, filter, and format)
   * @param {Object} messageData - The raw message data
   * @param {string} sourceId - The server ID to add to the message
   * @returns {Object} Processed message ready for broadcasting
   */
  processChatMessage(messageData, sourceId) {
    try {
      // Validate the message
      const validatedMessage = this.validateMessage(messageData);

      // Filter profanity from the message
      const filteredMessage = this.filterMessage(validatedMessage.message);

      // Create the processed message
      const processedMessage = {
        ...validatedMessage,
        message: filteredMessage,
        source: sourceId,
        timestamp: Date.now()
      };

      return processedMessage;
    } catch (error) {
      console.error('❌ Failed to process message:', error.message);
      throw error;
    }
  }

  /**
   * Create a system message
   * @param {string} message - The system message content
   * @returns {Object} System message object
   */
  createSystemMessage(message) {
    if (!message || typeof message !== 'string') {
      throw new Error('Invalid system message');
    }

    return {
      type: 'system',
      message: message.trim(),
      timestamp: Date.now()
    };
  }

  /**
   * Create a history end message
   * @returns {Object} History end message object
   */
  createHistoryEndMessage() {
    return {
      type: 'history_end',
      timestamp: Date.now()
    };
  }

  /**
   * Format a message for history response
   * @param {Object} dbMessage - Message from database
   * @returns {Object} Formatted history message
   */
  formatHistoryMessage(dbMessage) {
    return {
      type: 'history',
      username: dbMessage.username,
      message: dbMessage.content,
      timestamp: dbMessage.timestamp ? new Date(dbMessage.timestamp).getTime() : Date.now()
    };
  }
}

// Create and export a singleton instance
export const messageProcessor = new MessageProcessor();

export default messageProcessor;
