import uWS from 'uWebSockets.js';
import fs from 'fs';
import path from 'path';

// Import our modular services
import { SERVER_CONFIG } from './config/index.js';
import { redisService } from './services/redis.js';
import { databaseService } from './services/database.js';
import { messageProcessor } from './services/messageProcessor.js';
import { chatService } from './services/chatService.js';
import { webSocketHandler } from './handlers/websocket.js';
import { logger } from './utils/logger.js';

/**
 * Main server initialization function
 */
async function startServer() {
  try {
    // Initialize services
    await redisService.connect();
    await databaseService.connect();
    await chatService.initialize();
    logger.success('✅ All services initialized successfully');

    // Start WebSocket server
    uWS.App()
      .ws('/*', {
        compression: SERVER_CONFIG.WEBSOCKET.COMPRESSION,
        maxPayloadLength: SERVER_CONFIG.WEBSOCKET.MAX_PAYLOAD_LENGTH,
        idleTimeout: SERVER_CONFIG.WEBSOCKET.IDLE_TIMEOUT,

        upgrade: (res, req, context) => {
          webSocketHandler.handleUpgrade(res, req, context);
        },

        open: async (ws) => {
          await webSocketHandler.handleOpen(ws, SERVER_CONFIG.SERVER_ID);
        },

        message: async (ws, message, isBinary) => {
          await webSocketHandler.handleMessage(
            ws, 
            message, 
            isBinary,
            (ws, data) => chatService.handleChatMessage(ws, data, webSocketHandler.broadcastLocal.bind(webSocketHandler)),
            (ws, data) => chatService.handleLoadMore(ws, data, webSocketHandler.sendToClient.bind(webSocketHandler))
          );
        },

        close: (ws) => {
          webSocketHandler.handleClose(ws, SERVER_CONFIG.SERVER_ID);
        }
      })

      // Static file serving
      .get('/*', (res, req) => {
        const filePath = req.getUrl() === '/' ? '/index.html' : req.getUrl();
        const fullPath = path.join(process.cwd(), 'public', filePath);
        try {
          const data = fs.readFileSync(fullPath);
          res.writeStatus('200 OK');
          res.end(data);
        } catch {
          res.writeStatus('404 Not Found');
          res.end('Not Found');
        }
      })

      .listen(SERVER_CONFIG.PORT, (token) => {
        if (token) {
          logger.success(`Chat server running at http://localhost:${SERVER_CONFIG.PORT}`);
          logger.info(`Server ID: ${SERVER_CONFIG.SERVER_ID}`);
          logger.info(`Connected clients: ${webSocketHandler.getClientCount()}`);
        } else {
          logger.error('Failed to start server');
          process.exit(1);
        }
      });

  } catch (error) {
    logger.error(`Failed to start server: ${error.message}`);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  logger.info('Received SIGINT, shutting down gracefully...');
  
  try {
    await chatService.cleanup();
    logger.success('✅ Server shutdown completed');
    process.exit(0);
  } catch (error) {
    logger.error(`Error during shutdown: ${error.message}`);
    process.exit(1);
  }
});

// Start the server
startServer();
