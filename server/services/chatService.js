import { SERVER_CONFIG } from '../config/index.js';
import { redisService } from './redis.js';
import { databaseService } from './database.js';
import { messageProcessor } from './messageProcessor.js';

class ChatService {
  constructor() {
    this.serverId = SERVER_CONFIG.SERVER_ID;
    this.isSubscribed = false;
  }

  /**
   * Initialize the chat service
   */
  async initialize() {
    try {
      // Subscribe to Redis channel for receiving messages from other instances
      await this.subscribeToRedisChannel();
      console.log('✅ Chat service initialized');
    } catch (error) {
      console.error('❌ Failed to initialize chat service:', error);
      throw error;
    }
  }

  /**
   * Subscribe to Redis channel for receiving messages from other instances
   */
  async subscribeToRedisChannel() {
    if (this.isSubscribed) {
      return;
    }

    try {
      await redisService.subscribeToChannel((raw) => {
        const message = JSON.parse(raw);

        // Ignore messages sent by this server instance
        if (message.source === this.serverId) {
          return;
        }

        // Broadcast to local clients (this will be handled by the WebSocket handler)
        console.log(`📨 Received message from server ${message.source}: ${message.message}`);
      });

      this.isSubscribed = true;
    } catch (error) {
      console.error('❌ Failed to subscribe to Redis channel:', error);
      throw error;
    }
  }

  /**
   * Handle a chat message
   * @param {Object} ws - WebSocket object
   * @param {Object} messageData - Raw message data
   * @param {Function} broadcastLocal - Function to broadcast locally
   */
  async handleChatMessage(ws, messageData, broadcastLocal) {
    try {
      // Process the message (validate, filter, and format)
      const processedMessage = messageProcessor.processChatMessage(messageData, this.serverId);

      // Broadcast locally to all connected clients
      broadcastLocal(processedMessage);

      // Publish to Redis so other instances can rebroadcast
      await redisService.publishMessage(processedMessage);

      // Save to Redis stream for persistence
      await redisService.addMessageToStream(processedMessage);

      console.log(`💬 Message from ${processedMessage.username}: ${processedMessage.message}`);
    } catch (error) {
      console.error('❌ Failed to handle chat message:', error);
      
      if (ws) {
        const errorMessage = messageProcessor.createSystemMessage('Failed to send message. Please try again.');
        ws.send(JSON.stringify(errorMessage));
      }
    }
  }

  /**
   * Handle load more messages request
   * @param {Object} ws - WebSocket object
   * @param {Object} requestData - Request data with before and limit
   * @param {Function} sendToClient - Function to send message to specific client
   */
  async handleLoadMore(ws, requestData, sendToClient) {
    try {
      // Validate the request data
      const validatedRequest = messageProcessor.validateMessage(requestData);

      // Load older messages from database
      const olderMessages = await databaseService.loadOlderMessages(
        validatedRequest.before,
        validatedRequest.limit
      );

      if (olderMessages.length === 0) {
        // No more messages
        const endMessage = messageProcessor.createHistoryEndMessage();
        sendToClient(ws, endMessage);
      } else {
        // Send each message to the requesting client
        olderMessages.toReversed().forEach(message => {
          const formattedMessage = messageProcessor.formatHistoryMessage(message);
          sendToClient(ws, formattedMessage);
        });
      }

      console.log(`📜 Loaded ${olderMessages.length} older messages for user`);
    } catch (error) {
      console.error('❌ Failed to load older messages:', error);
      
      if (ws) {
        const errorMessage = messageProcessor.createSystemMessage('Failed to load older messages.');
        sendToClient(ws, errorMessage);
      }
    }
  }

  /**
   * Handle user join
   * @param {Function} broadcastLocal - Function to broadcast locally
   */
  handleUserJoin(broadcastLocal) {
    try {
      const joinMessage = messageProcessor.createSystemMessage('A new user joined the chat.');
      broadcastLocal(joinMessage);
    } catch (error) {
      console.error('❌ Failed to handle user join:', error);
    }
  }

  /**
   * Handle user leave
   * @param {Function} broadcastLocal - Function to broadcast locally
   */
  handleUserLeave(broadcastLocal) {
    try {
      const leaveMessage = messageProcessor.createSystemMessage('A user has left the chat.');
      broadcastLocal(leaveMessage);
    } catch (error) {
      console.error('❌ Failed to handle user leave:', error);
    }
  }

  /**
   * Get server statistics
   * @returns {Object} Server statistics
   */
  getStats() {
    return {
      serverId: this.serverId,
      isSubscribed: this.isSubscribed,
      timestamp: Date.now()
    };
  }

  /**
   * Clean up resources
   */
  async cleanup() {
    try {
      if (this.isSubscribed) {
        await redisService.unsubscribeFromChannel();
        this.isSubscribed = false;
      }
      console.log('✅ Chat service cleanup completed');
    } catch (error) {
      console.error('❌ Error during chat service cleanup:', error);
    }
  }
}

// Create and export a singleton instance
export const chatService = new ChatService();

export default chatService;
