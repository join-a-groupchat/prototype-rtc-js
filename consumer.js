import { createClient } from "redis";
import pkg from "pg";
import 'dotenv/config';

const { Client } = pkg;

// Redis connection
const redis = createClient({ url: `redis://:${process.env.REDIS_PWD}@${process.env.REDIS_HOST}:${process.env.REDIS_PORT}` });
console.log(`Connecting to Redis at ${process.env.REDIS_HOST}:${process.env.REDIS_PORT}`);
await redis.connect();
console.log("✅ Connected to Redis");

// PostgreSQL connection
const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) {
    console.error("❌ SUPABASE_DB_URL environment variable is not set!");
    console.error("Please set SUPABASE_DB_URL in your .env file or environment variables.");
    process.exit(1);
}

// Mask password in URL for logging
const maskedUrl = dbUrl.replace(/:([^:@]+)@/, ':****@');
console.log(`Connecting to PostgreSQL at ${maskedUrl}`);

const pg = new Client({ connectionString: dbUrl });
try {
    await pg.connect();
    console.log("✅ Connected to PostgreSQL");
} catch (error) {
    console.error("❌ Failed to connect to PostgreSQL!");
    console.error(`Error: ${error.message}`);
    console.error(`\nTroubleshooting:`);
    console.error(`1. If using local postgres with docker-compose, remove SUPABASE_DB_URL from .env`);
    console.error(`2. If using external Supabase, check your network/DNS settings`);
    console.error(`3. Verify the connection string is correct: ${maskedUrl}`);
    process.exit(1);
}

// Track the last message ID we've processed
// Use "$" to read only new messages (after this consumer started)
let lastId = "$";

while (true) {
    const res = await redis.xRead({ key: "chat_stream", id: lastId }, { BLOCK: 5000, COUNT: 10 }); // this means we wait up to 5 seconds for the next 10 messages
    if (!res) continue; // timeout, wait for next message

    const [stream] = res;
    const messages = stream.messages;

    for (const msg of messages) {
        // msg.message is already an object in node-redis, not an array of pairs
        let fields = msg.message;
        
        // Handle case where it might be an array of pairs (fallback)
        if (Array.isArray(fields)) {
            fields = Object.fromEntries(fields);
        } else if (!fields || typeof fields !== 'object') {
            // Try alternative format
            fields = msg[1] || {};
        }

        const { user, message, timestamp } = fields;

        if (user && message) {
            // Convert timestamp from milliseconds to seconds for PostgreSQL
            const timestampSeconds = timestamp ? Number(timestamp) / 1000 : Date.now() / 1000;  
            
            await pg.query(
            "INSERT INTO messages (username, content, timestamp) VALUES ($1, $2, to_timestamp($3))",
            [user, message, timestampSeconds]
            );
            console.log("Saved:", msg.id);
        }
        
        // Update lastId to this message's ID so we don't re-read it
        lastId = msg.id;
    }
}