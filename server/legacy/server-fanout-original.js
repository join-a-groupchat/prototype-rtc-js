import uWS from 'uWebSockets.js';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { Pool  } from "pg";
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

console.log("✅ Connected to Redis PUB/SUB + Streams");

// Postgres (use pool for resilience)
const pgPool = new Pool({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false }, // false for local dev
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 20000,
});
pgPool.on('error', (err) => {
  console.error('Unexpected PG pool error', err);
});
console.log("✅ Postgres pool created");

const PORT = 9001;
const SERVER_ID = Math.random().toString(36).slice(2);
console.log("Server ID:", SERVER_ID);

// In-memory list of connected users
let clients = new Set();

// Word filter configuration
const FILTERED_WORDS = [
  'damn', 'hell', 'shit', 'ass', 'bitch', 'bastard', 'crap', 'piss', 'suck', 'freaking',
  'frick', 'heck', 'darn', 'jeez', 'gosh', 'douche', 'moron', 'idiot', 'stupid', 'loser'
];

// Function to filter profanity from messages
function filterMessage(message) {
  if (!message || typeof message !== 'string') return message;
  
  let filtered = message;
  
  // Create regex patterns for each filtered word with word boundaries
  FILTERED_WORDS.forEach(word => {
    const regex = new RegExp(`\\b${word}\\b`, 'gi');
    filtered = filtered.replace(regex, '*'.repeat(word.length));
  });
  
  return filtered;
}

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

    upgrade: (res, req, context) => {
      // Origin header validation
      const origin = req.getHeader('origin');
      const allowedOrigins = ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:9001', 'http://127.0.0.1:9001'];
      
      if (!allowedOrigins.includes(origin)) {
        console.log(`Rejected unauthorized origin: ${origin}`);
        res.writeStatus('401 Unauthorized').end('Unauthorized origin');
        return;
      }
      
      // Upgrade to WebSocket
      res.upgrade({}, 
        req.getHeader('sec-websocket-key'), 
        req.getHeader('sec-websocket-protocol'), 
        req.getHeader('sec-websocket-extensions'), 
        context
      );
    },

    open: (ws) => {
      clients.add(ws);
      console.log('A user connected. Total:', clients.size);

      ws.send(JSON.stringify({ type: 'system', message: 'Welcome to the chat! Version 1.0.1' }));
      broadcastLocal({ type: 'system', message: 'A new user joined the chat.' });

      // Load last 10 messages from Redis Streams
      /*(async () => {
        const messages = await redis.xRevRange("chat_stream", "+", "-", { COUNT: 10 });
        messages.reverse().forEach(msg => {
          // Check if WebSocket is still connected before sending
          if (clients.has(ws)) {
            const fields = msg.message || {};
            ws.send(JSON.stringify({ 
              type: 'chat', 
              username: fields.user, 
              message: fields.message 
            }));
          }
        });
      })();*/

      // Load last 50 messages from postgres
      (async () => {
        try {
          const result = await pgPool.query(
            'SELECT * FROM messages ORDER BY timestamp DESC LIMIT 50'
          );

          console.log("🔃 Loaded", result.rows.length, "messages from postgres");
      
          // reverse so oldest first
          result.rows.reverse().forEach(msg => {
            if (!clients.has(ws)) return;
      
            ws.send(JSON.stringify({ 
              type: 'chat', 
              username: msg.username, 
              message: msg.content,
              timestamp: msg.timestamp ? new Date(msg.timestamp).getTime() : Date.now()
            }));
          });
        } catch (err) {
          console.error("Failed to load messages:", err);
        }
      })();
    },

    message: async (ws, message, isBinary) => {
      const text = Buffer.from(message).toString();

      try {
        const data = JSON.parse(text);

        if (data.type === 'chat') {
          // Filter profanity from the message before processing
          const filteredMessage = filterMessage(data.message);
          const filteredData = { ...data, message: filteredMessage };
          
          /* 2. Prepare message with source ID */
          const messageWithSource = { ...filteredData, source: SERVER_ID };

          /* 3. Broadcast locally */
          broadcastLocal(messageWithSource);
          
          /* 4. Publish to Redis so OTHER instances rebroadcast */
          await redis.publish("chat_channel", JSON.stringify(messageWithSource));

          /* 5. Save to Redis Streams */
          await redis.xAdd(
            "chat_stream", 
            "*", 
            { 
                user: filteredData.username + "", 
                message: filteredData.message + "", 
                timestamp: Date.now().toString()
            }, 
          );
        } else if (data.type === 'load_more') {
          // Handle request for older messages
          const before = data.before || Date.now();
          const limit = data.limit || 50;

          try {
            const result = await pgPool.query(
              'SELECT * FROM messages WHERE timestamp < $1 ORDER BY timestamp DESC LIMIT $2',
              [new Date(before), limit]
            );

            console.log("📜 Loaded", result.rows.length, "older messages for user");

            if (result.rows.length === 0) {
              // No more messages
              ws.send(JSON.stringify({ type: 'history_end' }));
            } else {
              // Reverse so oldest first, then send each message
              result.rows.reverse().forEach(msg => {
                if (!clients.has(ws)) return;

                ws.send(JSON.stringify({
                  type: 'history',
                  username: msg.username,
                  message: msg.content,
                  timestamp: msg.timestamp ? new Date(msg.timestamp).getTime() : Date.now()
                }));
              });
            }
          } catch (err) {
            console.error("Failed to load older messages:", err);
            ws.send(JSON.stringify({ type: 'history_end' }));
          }
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

3. Separated "broadcast locally" logic
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
