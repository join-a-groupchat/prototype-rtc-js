import { createClient } from "redis";
import dotenv from 'dotenv';
dotenv.config({ path: '../config/.env' });
import pLimit from "p-limit"; // install: npm i p-limit

const redis = createClient({ url: `redis://:${process.env.REDIS_PWD}@${process.env.REDIS_HOST}:${process.env.REDIS_PORT}` });
// optionally enable auto pipelining if your redis client supports it (check docs)
// e.g. createClient({ ..., enableAutoPipelining: true })
await redis.connect();

const STREAM = "perf_stream";
const GROUP = "cg1";
const CONSUMER = process.env.CONSUMER_NAME || `c-${Math.random().toString(36).slice(2,8)}`;
// Set a big batch for throughput tests
const BATCH = Number(process.env.BATCH || 2000);
const BLOCK_MS = Number(process.env.BLOCK_MS || 2000);
// concurrency for downstream processing (tune: 50-500)
const CONCURRENCY = Number(process.env.CONCURRENCY || 100);

console.log(`Consumer ${CONSUMER} reading from group ${GROUP}, BATCH=${BATCH}, CONCURRENCY=${CONCURRENCY}`);

let processed = 0;
let lastLog = Date.now();
const start = Date.now();
const limit = pLimit(CONCURRENCY);

async function handleMessage(parsed) {
  // Simulate light processing; replace with batched DB writes or non-blocking ops
  // Example: push to an in-memory buffer and periodically flush to Postgres (preferred)
  // await dbInsertSingle(parsed) <-- avoid per-message awaits
  return parsed;
}

async function loop() {
  while (true) {
    try {
      const res = await redis.xReadGroup(GROUP, CONSUMER, { key: STREAM, id: ">" }, { COUNT: BATCH, BLOCK: BLOCK_MS });
      if (!res) continue;

      // res shape may vary; normalize
      const msgs = (res && res[0] && (res[0].messages || res[0][1])) || [];
      if (!msgs.length) continue;

      const ids = [];
      const tasks = [];

      for (const m of msgs) {
        // m may be { id, message: { field1: 'v', ... } } or [id, fields]
        const id = m.id || m[0];
        ids.push(id);

        // extract fields robustly:
        const fields = m.message ?? (Array.isArray(m[1]) ? Object.fromEntries(chunks(m[1], 2)) : {});
        // schedule processing with concurrency limit
        tasks.push(limit(() => handleMessage(fields)));
      }

      // Wait for all processing tasks to finish (or use Promise.allSettled)
      await Promise.allSettled(tasks);

      // ACK all ids in a single call (xAck supports multiple ids)
      if (ids.length) {
        await redis.xAck(STREAM, GROUP, ...ids);
      }

      processed += ids.length;
      const now = Date.now();
      if (now - lastLog >= 1000) {
        const elapsed = (now - start) / 1000;
        console.log(`Processed total ${processed}, avg ${(processed/elapsed).toFixed(0)} msg/s`);
        lastLog = now;
      }
    } catch (err) {
      console.error("consumer error", err);
      await new Promise(r => setTimeout(r, 500));
    }
  }
}

// helper to convert [k,v,k,v] -> Object
function chunks(arr, n) {
  const out = [];
  for (let i=0;i<arr.length;i+=n) out.push(arr.slice(i,i+n));
  return out;
}

loop();
