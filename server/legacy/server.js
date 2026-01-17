import uWS from 'uWebSockets.js';
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
dotenv.config({ path: '../config/.env' });

// Redis client setup
import { createClient } from "redis";
const redis = createClient({ url: `redis://:${process.env.REDIS_PWD}@${process.env.REDIS_HOST}:${process.env.REDIS_PORT}` });
await redis.connect();
console.log("Connected to Redis");

const PORT = 9001;

// In-memory list of connected users
let clients = new Set();

uWS.App()
  .ws('/*', {
    compression: uWS.SHARED_COMPRESSOR,
    maxPayloadLength: 16 * 1024,
    idleTimeout: 60,

    open: (ws) => {
      clients.add(ws);
      console.log('A user connected. Total:', clients.size);

      ws.send(JSON.stringify({ type: 'system', message: 'Welcome to the chat! Version 1.0.1' }));
      broadcast({ type: 'system', message: 'A new user joined the chat.' });

      // Load last 10 messages from Redis
      (async () => {
        const messages = await redis.xRevRange("chat_stream", "+", "-", { COUNT: 10 });
        // Reverse to show oldest first
        messages.toReversed().forEach(msg => {
          // msg.message is an object with user, message, timestamp fields
          const fields = msg.message || {};
          ws.send(JSON.stringify({ 
            type: 'chat', 
            username: fields.user, 
            message: fields.message 
          }));
        });
      })();
    },

    message: async (ws, message, isBinary) => {
      const text = Buffer.from(message).toString();
      try {
        const data = JSON.parse(text);
        if (data.type === 'chat') {
          broadcast({ type: 'chat', username: data.username, message: data.message });

          // Store message in Redis
          await redis.xAdd("chat_stream", "*", { 
            user: data.username, 
            message: data.message, 
            timestamp: Date.now().toString() 
          }, 
          {
            // Keep last 1000 messages
            MAXLEN: "~", 
            COUNT: 1000
          }
        );
        }
      } catch (err) {
        console.error('Invalid message:', err);
      }
    },

    close: (ws, code, msg) => {
      clients.delete(ws);
      console.log('User disconnected. Total:', clients.size);
      broadcast({ type: 'system', message: 'A user has left the chat.' });
    },
  })

// Serve static files (client)
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
  if (token) {
    console.log(`✅ Chat server running at http://localhost:${PORT}`);
  } else {
    console.error('❌ Failed to start server');
  }
});

function broadcast(msg) {
  const data = JSON.stringify(msg);
  for (let client of clients) {
    client.send(data);
  }
}
