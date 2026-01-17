import { createClient } from "redis";
import { Pool } from "pg";
import pLimit from "p-limit";
import dotenv from 'dotenv';
import crypto from 'crypto';
dotenv.config({ path: '../config/.env' });

// use consumer groups because we can have multiple consumers
const STREAM = process.env.STREAM_KEY || "chat_stream";
const GROUP = process.env.CONSUMER_GROUP || "cg1";
const CONSUMER = process.env.CONSUMER_NAME || `c-${Array.from(crypto.getRandomValues(new Uint8Array(6)), byte => (byte % 36).toString(36)).join('')}`;

// Redis
const redis = createClient({ url: process.env.REDIS_URL || `redis://:${process.env.REDIS_PWD}@${process.env.REDIS_HOST}:${process.env.REDIS_PORT}` });
await redis.connect();
console.log("✅ Redis connected");

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
  // do NOT throw — log and keep running; queries will fail until reconnect
});
console.log("✅ Postgres pool created");

// Settings (tune via env vars)
const READ_COUNT = Number(process.env.XREAD_COUNT || 500);
const READ_BLOCK_MS = Number(process.env.XREAD_BLOCK_MS || 10);

// flush settings for batching to db
const BATCH_SIZE = Number(process.env.BATCH_SIZE || 200);
const BATCH_TIMEOUT_MS = Number(process.env.BATCH_TIMEOUT_MS || 200);
const FLUSH_CONCURRENCY = Number(process.env.FLUSH_CONCURRENCY || 1);

// New claim settings for clearing pending entries
const CLAIM_MIN_IDLE_MS = Number(process.env.CLAIM_MIN_IDLE_MS || 10000); // claim entries idle longer than this
const CLAIM_COUNT = Number(process.env.CLAIM_COUNT || 200); // how many to claim per call

// Ensure consumer group exists (create if not)
async function ensureGroup() {
  try {
    await redis.xGroupCreate(STREAM, GROUP, '0', { MKSTREAM: true });
    console.log(`Created group ${GROUP}`);
  } catch (err) {
    if (err.message?.includes('BUSYGROUP')) {
      console.log(`Group ${GROUP} already exists`);
    } else {
      console.error("Error creating group:", err);
      throw err;
    }
  }
}
await ensureGroup();

// In-memory buffer and flush scheduling
let buffer = [];
let flushTimer = null;
const limit = pLimit(FLUSH_CONCURRENCY);
let shuttingDown = false;

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => { flushTimer = null; triggerFlush(); }, BATCH_TIMEOUT_MS);
}

async function triggerFlush() {
  if (!buffer.length) return;
  const toFlush = buffer;
  buffer = [];
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  await limit(() => flushToDbAndAck(toFlush));
}

// flush batch to Postgres and ACK in Redis
async function flushToDbAndAck(msgs) {
  if (!msgs?.length) return;
  const values = [];
  const placeholders = [];
  let idx = 1;
  for (const m of msgs) {
    const f = m.fields;
    const username = f.user ?? f.username ?? null;
    const content = f.message ?? f.content ?? null;
    const ts = f.timestamp ? new Date(Number(f.timestamp)) : new Date();
    values.push(m.id, username, content, ts);
    placeholders.push(`($${idx}, $${idx+1}, $${idx+2}, $${idx+3})`);
    idx += 4;
  }

  const sql = `
    INSERT INTO messages (redis_id, username, content, timestamp)
    VALUES ${placeholders.join(", ")}
    ON CONFLICT (redis_id) DO NOTHING
  `;

  console.log("Saved: ", msgs.length, "messages to DB");

  try {
    await pgPool.query('BEGIN');
    await pgPool.query(sql, values);
    await pgPool.query('COMMIT');
  } catch (err) {
    await pgPool.query('ROLLBACK').catch((rollbackErr) => {
      console.error("DB ROLLBACK error:", rollbackErr?.message || rollbackErr);
    });
    console.error("DB insert error, requeueing batch:", err.message || err);
    buffer = msgs.concat(buffer);
    await new Promise(r => setTimeout(r, 200));
    return;
  }

  const ids = msgs.map(m => m.id);
  try {
    await redis.xAck(STREAM, GROUP, ...ids);
  } catch (err) {
    console.error("XACK error (messages inserted but not acked):", err.message || err);
  }
}

// helper
function chunkArray(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

// Recover pending messages (on startup) - meaning messages that were delivered but not ACKed
async function recoverPending() {
  console.log(`Recovering pending messages for group=${GROUP}, consumer=${CONSUMER}`);
  // start from 0 to iterate through pending range
  let startId = '0-0';
  while (true) {
    try {
      // xAutoClaim returns [nextStartId, messages]
      const res = await redis.xAutoClaim(STREAM, GROUP, CONSUMER, CLAIM_MIN_IDLE_MS, startId, { COUNT: CLAIM_COUNT });
      if (!res) break;
      const nextId = res[0];
      const rawMsgs = res[1] ?? [];
      if (!rawMsgs || rawMsgs.length === 0) break;

      // normalize format into [{id, fields}]
      const toProcess = rawMsgs.map(m => {
        const id = m.id ?? m[0];
        let fields = m.message ?? m[1] ?? {};
        if (Array.isArray(fields)) fields = Object.fromEntries(chunkArray(fields, 2));
        return { id, fields };
      });

      console.log(`Claimed ${toProcess.length} pending messages (nextId=${nextId})`);
      // flush them immediately (this will INSERT ON CONFLICT DO NOTHING and XACK)
      await flushToDbAndAck(toProcess);

      // prepare next start; if we didn't reach CLAIM_COUNT, we can break (likely done)
      startId = nextId;
      if (toProcess.length < CLAIM_COUNT) break;
    } catch (err) {
      console.error("recoverPending error:", err.message || err);
      // small backoff then retry
      await new Promise(r => setTimeout(r, 500));
    }
  }
  console.log("Pending recovery complete");
}

// Main loop: read from group and buffer
async function loop() {
  console.log(`Consumer ${CONSUMER} joining group ${GROUP} on stream ${STREAM}`);
  while (!shuttingDown) {
    try {
      const res = await redis.xReadGroup(GROUP, CONSUMER, { key: STREAM, id: '>' }, { COUNT: READ_COUNT, BLOCK: READ_BLOCK_MS });
      if (!res) {
        await triggerFlush();
        continue;
      }
      const stream = res[0];
      const msgs = stream.messages || stream[1] || [];
      if (!msgs.length) {
        await triggerFlush();
        continue;
      }
      for (const m of msgs) {
        const id = m.id ?? m[0];
        let fields = m.message ?? m[1] ?? {};
        if (Array.isArray(fields)) fields = Object.fromEntries(chunkArray(fields, 2));
        buffer.push({ id, fields });
        if (buffer.length === 1) scheduleFlush();
        if (buffer.length >= BATCH_SIZE) {
          await triggerFlush();
        }
      }
    } catch (err) {
      console.error("ReadGroup loop error:", err.message || err);
      await new Promise(r => setTimeout(r, 200));
    }
  }
}

// graceful shutdown
process.on('SIGINT', async () => {
  console.log("SIGINT - flushing and shutting down...");
  shuttingDown = true;
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  await triggerFlush();
  await limit(() => Promise.resolve());
  await pgPool.end().catch(err => console.error("Error during pgPool shutdown:", err));
  await redis.disconnect().catch(err => console.error("Error during Redis shutdown:", err));
  process.exit(0);
});

// run recovery first, then enter loop
await recoverPending();
loop();
