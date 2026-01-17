import { SERVER_CONFIG } from '../config/index.js';
import { databaseService } from '../services/database.js';
import { messageProcessor } from '../services/messageProcessor.js';

class WebSocketHandler {
  constructor() {
    this.clients = new Set();
  }

  /**
   * Handle WebSocket connection upgrade
   * @param {Object} res - Response object
   * @param {Object} req - Request object
   * @param {Object} context - Upgrade context
   */
  handleUpgrade(res, req, context) {
    // Origin header validation
    const origin = req.getHeader('origin');
    
    if (!SERVER_CONFIG.ALLOWED_ORIGINS.includes(origin)) {
      console.log(`❌ Rejected unauthorized origin: ${origin}`);
      res.writeStatus('401 Unauthorized').end('Unauthorized origin');
      return;
    }

    // Upgrade to WebSocket
    res.upgrade(
      {},
      req.getHeader('sec-websocket-key'),
      req.getHeader('sec-websocket-protocol'),
      req.getHeader('sec-websocket-extensions'),
      context
    );
  }

  /**
   * Handle WebSocket connection open
   * @param {Object} ws - WebSocket object
   * @param {string} serverId - Server ID for message routing
   */
  async handleOpen(ws, serverId) {
    this.clients.add(ws);
    console.log(`✅ User connected. Total: ${this.clients.size}`);

    try {
      // Send welcome message
      const welcomeMessage = messageProcessor.createSystemMessage('Welcome to the chat! Version 1.0.2');
      ws.send(JSON.stringify(welcomeMessage));

      // Notify other users
      const joinMessage = messageProcessor.createSystemMessage('A new user joined the chat.');
      this.broadcastLocal(joinMessage);

      // Load recent messages from PostgreSQL
      const recentMessages = await databaseService.loadRecentMessages();
      
      console.log(`🔃 Loaded ${recentMessages.length} messages from PostgreSQL`);

      // Send messages to the new client (oldest first)
      recentMessages.reverse().forEach(message => {
        if (this.clients.has(ws)) {
          const formattedMessage = messageProcessor.formatHistoryMessage(message);
          ws.send(JSON.stringify(formattedMessage));
        }
      });

    } catch (error) {
      console.error('❌ Error in handleOpen:', error);
      if (this.clients.has(ws)) {
        const errorMessage = messageProcessor.createSystemMessage('Failed to load chat history.');
        ws.send(JSON.stringify(errorMessage));
      }
    }
  }

  /**
   * Handle WebSocket message
   * @param {Object} ws - WebSocket object
   * @param {Buffer} message - Raw message buffer
   * @param {boolean} isBinary - Whether the message is binary
   * @param {Function} onChatMessage - Handler for chat messages
   * @param {Function} onLoadMore - Handler for load more messages
   */
  async handleMessage(ws, message, isBinary, onChatMessage, onLoadMore) {
    const text = Buffer.from(message).toString();

    try {
      const data = JSON.parse(text);

      switch (data.type) {
        case 'chat':
          await onChatMessage(ws, data);
          break;

        case 'load_more':
          await onLoadMore(ws, data);
          break;

        default:
          console.warn(`⚠️ Unknown message type: ${data.type}`);
      }

    } catch (error) {
      console.error('❌ Invalid message:', error);
      if (this.clients.has(ws)) {
        const errorMessage = messageProcessor.createSystemMessage('Invalid message format.');
        ws.send(JSON.stringify(errorMessage));
      }
    }
  }

  /**
   * Handle WebSocket connection close
   * @param {Object} ws - WebSocket object
   * @param {string} serverId - Server ID for message routing
   */
  handleClose(ws, serverId) {
    this.clients.delete(ws);
    console.log(`❌ User disconnected. Total: ${this.clients.size}`);

    // Notify other users
    const leaveMessage = messageProcessor.createSystemMessage('A user has left the chat.');
    this.broadcastLocal(leaveMessage);
  }

  /**
   * Broadcast a message to all connected clients
   * @param {Object} message - The message to broadcast
   */
  broadcastLocal(message) {
    const data = JSON.stringify(message);
    for (const client of this.clients) {
      client.send(data);
    }
  }

  /**
   * Send a message to a specific client
   * @param {Object} ws - WebSocket object
   * @param {Object} message - The message to send
   */
  sendToClient(ws, message) {
    if (this.clients.has(ws)) {
      ws.send(JSON.stringify(message));
    }
  }

  /**
   * Get the number of connected clients
   * @returns {number} Number of connected clients
   */
  getClientCount() {
    return this.clients.size;
  }

  /**
   * Check if a client is still connected
   * @param {Object} ws - WebSocket object
   * @returns {boolean} Whether the client is connected
   */
  isClientConnected(ws) {
    return this.clients.has(ws);
  }
}

export const webSocketHandler = new WebSocketHandler();
export default webSocketHandler;
