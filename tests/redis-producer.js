// redis-producer.js
import { createClient } from "redis";
import dotenv from 'dotenv';
dotenv.config({ path: '../config/.env' });

const redis = createClient({ url: `redis://:${process.env.REDIS_PWD}@${process.env.REDIS_HOST}:${process.env.REDIS_PORT}` });
console.log(`Connecting to Redis at ${process.env.REDIS_HOST}:${process.env.REDIS_PORT}`);
await redis.connect();
console.log("✅ Connected to Redis");

const STREAM = "perf_stream";
const TOTAL = Number(process.argv[2] || 100_000);
const BATCH = Number(process.argv[3] || 1000);

console.log(`Producing ${TOTAL} messages in batches of ${BATCH}...`);

let produced = 0;
const start = Date.now();

while (produced < TOTAL) {
  const pipeline = redis.multi();
  const batchCount = Math.min(BATCH, TOTAL - produced);
  for (let i = 0; i < batchCount; i++) {
    const id = `${Date.now()}-${produced + i}`;
    pipeline.xAdd(STREAM, '*', {
      id,
      user: `u${(produced + i) % 1000}`,
      message: `msg ${produced + i}`,
      ts: Date.now().toString()
    });
  }
  await pipeline.exec();
  produced += batchCount;

  // periodic status
  if (produced % (BATCH * 5) === 0) {
    const elapsed = (Date.now() - start) / 1000;
    console.log(`Produced ${produced}/${TOTAL} in ${elapsed.toFixed(2)}s (${(produced/elapsed).toFixed(0)} msg/s)`);
  }
}

const elapsed = (Date.now() - start) / 1000;
console.log(`DONE produced ${TOTAL} messages in ${elapsed.toFixed(2)}s => ${(TOTAL/elapsed).toFixed(0)} msg/s`);
await redis.quit();
process.exit(0);
