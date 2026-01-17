import uWS from 'uWebSockets.js';
<<<<<<< HEAD
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: '../config/.env' });

// Redis client setup
import { createClient } from "redis";

// Publisher (you already use this)
const redis = createClient({ 
  url: `redis://:${process.env.REDIS_PWD}@${process.env.REDIS_HOST}:${process.env.REDIS_PORT}` 
});
await redis.connect();

// Subscriber (NEW)
const redisSub = createClient({ 
  url: `redis://:${process.env.REDIS_PWD}@${process.env.REDIS_HOST}:${process.env.REDIS_PORT}`
});
await redisSub.connect();

console.log("Connected to Redis PUB/SUB + Streams");

const PORT = 9001;
const SERVER_ID = Math.random().toString(36).slice(2);
console.log("Server ID:", SERVER_ID);

// In-memory list of connected users
let clients = new Set();

/* ----------------------------------------------
   1. REDIS SUBSCRIBER: Listen for messages from
      other instances and fan-out locally
------------------------------------------------*/
await redisSub.subscribe("chat_channel", (raw) => {
  const msg = JSON.parse(raw);

  // Ignore messages sent by this server instance
  if (msg.source === SERVER_ID) return;

  // Broadcast to all local clients
  for (let client of clients) {
    client.send(raw);
  }
});


/* ----------------------------------------------
   2. WebSocket Server
------------------------------------------------*/
uWS.App()
  .ws('/*', {
    compression: uWS.SHARED_COMPRESSOR,
    maxPayloadLength: 16 * 1024,
    idleTimeout: 60,

    open: (ws) => {
      clients.add(ws);
      console.log('A user connected. Total:', clients.size);

      ws.send(JSON.stringify({ type: 'system', message: 'Welcome to the chat! Version 1.0.1' }));
      broadcastLocal({ type: 'system', message: 'A new user joined the chat.' });

      // Load last 10 messages from Redis Streams
      (async () => {
        const messages = await redis.xRevRange("chat_stream", "+", "-", { COUNT: 10 });
        messages.reverse().forEach(msg => {
          const fields = msg.message || {};
          ws.send(JSON.stringify({ 
            type: 'chat', 
            username: fields.user, 
            message: fields.message 
          }));
        });
      })();
    },

    message: (ws, message, isBinary) => {
      const text = Buffer.from(message).toString();

      try {
        const data = JSON.parse(text);

        if (data.type === 'chat') {
          /* 2. Prepare message with source ID */
          const messageWithSource = { ...data, source: SERVER_ID };

          /* 3. Broadcast locally */
          broadcastLocal(messageWithSource);
          
          /* 4. Publish to Redis so OTHER instances rebroadcast */
          redis.publish("chat_channel", JSON.stringify(messageWithSource))
          .catch(err => { console.error('Redis publish error:', err); });

          /* 5. Save to Redis Streams */
          redis.xAdd(
            "chat_stream", 
            "*", 
            { 
                user: data.username + "", 
                message: data.message + "", 
                timestamp: Date.now().toString()
            }, 
          ).catch(err => { console.error('Redis XADD error:', err); });
        }
      } catch (err) {
        console.error('Invalid message:', err);
      }
    },

    close: (ws) => {
      clients.delete(ws);
      console.log('User disconnected. Total:', clients.size);
      broadcastLocal({ type: 'system', message: 'A user has left the chat.' });
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

  .listen(PORT, (token) => {
    if (token) console.log(`Chat server running at http://localhost:${PORT}`);
    else console.error('Failed to start server');
  });


// --------------------------------------------
// Broadcast only to local clients
// --------------------------------------------
function broadcastLocal(msg) {
  const data = JSON.stringify(msg);
  for (let client of clients) client.send(data);
}

/*
✔️ What Changed?
1. Added a Redis subscriber

await redisSub.subscribe("chat_channel", handler);

This receives messages from other server instances.

2. Publish outgoing chat messages
Inside your message handler:

await redis.publish("chat_channel", JSON.stringify(data));

3. Separated “broadcast locally” logic
So we avoid echo loops:

function broadcastLocal(msg) {
  const data = JSON.stringify(msg);
  for (let client of clients) client.send(data);
}

Redis subscriber also does:

client.send(raw);

Thus, everything cleanly fans out.
🔥 Now You Can Run As Many Instances As You Want

Start 4 instances:

pm2 start server.js -i 4

Or on Docker/Kubernetes, auto-scale up.
Every instance receives and broadcasts all messages.

Your chat now supports:
Horizontal scaling
Multi-node broadcast
Redis Streams for persistence
Redis Pub/Sub for real-time fan-out

This is the correct, production-ready pattern used by real chat apps (Slack, Discord-style architecture).
*/
=======
import fs from 'node:fs';
import path from 'node:path';

// Import our modular services
import { SERVER_CONFIG } from './config/index.js';
import { redisService } from './services/redis.js';
import { databaseService } from './services/database.js';
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
await startServer();
>>>>>>> df1bb8650cdbf1b2ac6980f1532d9e271aa93a77
