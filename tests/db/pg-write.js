import { Pool } from "pg";
import dotenv from 'dotenv';
dotenv.config({ path: '../../config/.env' });

const TOTAL_MESSAGES = Number(process.env.TOTAL_MESSAGES || 200_000);
const BATCH_SIZE = Number(process.env.BATCH_SIZE || 500);
const CONCURRENCY = Number(process.env.CONCURRENCY || 1);

// Supabase Postgres
const pool = new Pool({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: false, // { rejectUnauthorized: false } for production
  max: CONCURRENCY,
});

function now() {
  return Number(process.hrtime.bigint()) / 1e9;
}

function generateBatch(batchSize, offset) {
  const values = [];
  const placeholders = [];
  let i = 1;

  for (let j = 0; j < batchSize; j++) {
    const id = `bench-${offset + j}-${Date.now()}-${Math.random()}`;
    const user = "loadtest";
    const content = "hello world";
    const ts = new Date();

    values.push(id, user, content, ts);
    placeholders.push(`($${i}, $${i+1}, $${i+2}, $${i+3})`);
    i += 4;
  }

  return { values, placeholders };
}

async function insertBatch(batchSize, offset) {
  const { values, placeholders } = generateBatch(batchSize, offset);

  const sql = `
    INSERT INTO messages (redis_id, username, content, timestamp)
    VALUES ${placeholders.join(", ")}
    ON CONFLICT (redis_id) DO NOTHING
  `;

  const res = await pool.query(sql, values);
  return res.rowCount;
}

async function run() {
  console.log("🚀 Starting Postgres write benchmark");
  console.log({
    TOTAL_MESSAGES,
    BATCH_SIZE,
    CONCURRENCY,
  });

  const start = now();
  let written = 0;

  const workers = Array.from({ length: CONCURRENCY }).map(async (_, w) => {
    let offset = w * BATCH_SIZE;
    while (offset < TOTAL_MESSAGES) {
      const rows = await insertBatch(BATCH_SIZE, offset);
      written += rows;
      console.log(
        `[worker ${w}] inserted ${rows} rows (total=${written})`
      );
      offset += BATCH_SIZE * CONCURRENCY;
    }
  });

  await Promise.all(workers);

  const elapsed = now() - start;
  const rate = Math.floor(written / elapsed);

  console.log("\n✅ BENCHMARK COMPLETE");
  console.log("Messages written:", written);
  console.log("Time (s):", elapsed.toFixed(2));
  console.log("Throughput:", rate, "msg/s");

  await pool.end();
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
