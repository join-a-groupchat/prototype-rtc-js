import uWS from 'uWebSockets.js';
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

    message: async (ws, message, isBinary) => {
      const text = Buffer.from(message).toString();

      try {
        const data = JSON.parse(text);

        if (data.type === 'chat') {
          /* 2. Prepare message with source ID */
          const messageWithSource = { ...data, source: SERVER_ID };

          /* 3. Broadcast locally */
          broadcastLocal(messageWithSource);
          
          /* 4. Publish to Redis so OTHER instances rebroadcast */
          await redis.publish("chat_channel", JSON.stringify(messageWithSource));

          /* 5. Save to Redis Streams */
          await redis.xAdd(
            "chat_stream", 
            "*", 
            { 
                user: data.username + "", 
                message: data.message + "", 
                timestamp: Date.now().toString()
            }, 
          );
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
    const fullPath = path.join(process.cwd(), '../public', filePath);
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