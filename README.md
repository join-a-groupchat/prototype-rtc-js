# prototype-rtc-js

A real-time, scalable group chat application built with uWebSockets.js, Redis, and PostgreSQL. This application demonstrates enterprise-grade resilience patterns including distributed message processing, automatic failover, graceful shutdown, and robust error recovery mechanisms.

## Overview

This application provides a high-performance real-time chat system that can scale horizontally across multiple server instances. Messages flow from WebSocket clients through Redis streams for persistence and distribution, with dedicated consumer processes handling database persistence. The architecture is designed to handle high message volumes while maintaining data integrity and system availability even when individual components fail.

The system consists of two main components: a WebSocket server that handles client connections and message broadcasting, and a consumer service that processes messages from Redis streams and persists them to PostgreSQL. Both components are designed to run as multiple instances, sharing workload and providing redundancy.

## Architecture

### Server Component

The server component (`server/server-fanout.js`) handles WebSocket connections using uWebSockets.js for high-performance, low-latency communication. When a client sends a chat message, the server processes it through a message validation and filtering pipeline, then broadcasts it locally to all connected clients on that server instance. Simultaneously, the message is published to a Redis pub/sub channel for distribution to other server instances, and added to a Redis stream for persistence and later processing by consumer instances.

Each server instance is assigned a unique server ID (generated using cryptographically secure random values) which is included in published messages to prevent echo loops, servers ignore messages they themselves published. The server maintains an in-memory set of connected WebSocket clients and uses Redis pub/sub to coordinate message distribution across multiple server instances, enabling horizontal scaling. When clients connect, the server loads recent message history from PostgreSQL, ensuring users see the conversation context immediately upon joining.

### Consumer Component

The consumer component (`consumer/consumer.js`) is responsible for reading messages from Redis streams and persisting them to PostgreSQL. It uses Redis Consumer Groups to enable multiple consumer instances to share the message processing workload. Each consumer instance joins a consumer group with a unique consumer name (also generated using secure random values), allowing Redis to automatically distribute messages across available consumers. This design enables horizontal scaling of the persistence layer, as message volume increases, additional consumer instances can be added to handle the load.

The consumer implements a sophisticated batch processing system that buffers messages in memory before writing them to the database. This approach significantly reduces database write operations and improves overall throughput. Messages are flushed to the database either when the buffer reaches a configured batch size (default 200 messages) or after a timeout period (default 200ms), whichever comes first. This dual-trigger mechanism ensures both high throughput under load and low latency for smaller message volumes.

## Resilience Mechanisms

### Redis Consumer Groups and Load Sharing

The application leverages Redis Consumer Groups to enable distributed message processing across multiple consumer instances. When a consumer starts, it automatically creates or joins a consumer group on the Redis stream. Each consumer instance is assigned a unique consumer name (generated using `crypto.getRandomValues`), allowing Redis to track which consumer is processing which messages. When multiple consumers are active in the same group, Redis automatically distributes incoming messages across them using a round-robin-like mechanism, ensuring balanced workload distribution.

The consumer uses `XREADGROUP` to read messages from the stream, specifying the consumer group name and its unique consumer identifier. Redis ensures that each message is delivered to exactly one consumer in the group, preventing duplicate processing. Messages are read in batches (configurable via `XREAD_COUNT`, default 500) with a short blocking timeout (default 10ms) to balance between latency and CPU efficiency. This design means that if you have three consumer instances running, each will process approximately one-third of the messages, and if one instance fails or is stopped, the remaining instances automatically take over its share of the workload.

### Failover and Message Recovery

The system implements comprehensive message recovery mechanisms to ensure no messages are lost even when consumer instances fail. When a consumer instance crashes or is terminated unexpectedly, messages that were delivered to it but not yet acknowledged remain in Redis as "pending" messages. The application uses Redis's `XAUTOCLAIM` command to automatically recover these pending messages when a consumer starts up or when they exceed a minimum idle time threshold (default 10 seconds).

On startup, each consumer instance first calls `recoverPendingMessages()`, which uses `XAUTOCLAIM` to claim pending messages that were assigned to other consumers but never acknowledged. This process iterates through all pending messages, claiming those that have been idle longer than the configured threshold, and processes them before starting normal message consumption. This ensures that messages are never permanently lost, if consumer instance A crashes while processing a batch, consumer instance B (or A after restart) will automatically claim and process those messages.

The recovery mechanism is designed to be non-blocking and fault-tolerant. If recovery encounters errors, it logs them but continues with normal operation, preventing a single corrupted message from blocking the entire consumer. Messages are recovered in batches (default 200 per iteration) to avoid overwhelming the system, with small delays between batches to allow other operations to proceed. This design ensures that the system can recover from failures gracefully while maintaining high availability.

### Batch Processing and Buffering

The consumer implements an intelligent batch processing system that significantly improves database write performance and reduces connection overhead. Messages are accumulated in an in-memory buffer as they arrive from Redis. The system uses two triggers to flush messages to the database: a size-based trigger (when the buffer reaches the configured batch size) and a time-based trigger (after a configured timeout period). This dual-trigger approach ensures optimal performance under varying load conditions, high message volumes trigger immediate flushes for throughput, while low volumes still get flushed periodically to maintain acceptable latency.

The batch processor uses `p-limit` to control concurrent flush operations, preventing database connection pool exhaustion under high load. By default, only one flush operation runs at a time (configurable via `FLUSH_CONCURRENCY`), ensuring that database writes are serialized and connection pool limits are respected. When a flush operation completes successfully, all messages in that batch are acknowledged in Redis using `XACK`, removing them from the pending entries list. If a flush operation fails (e.g., due to database connectivity issues), the messages are re-queued back into the buffer with a short delay before retry, ensuring eventual consistency.

The buffering strategy also includes special handling for recovered pending messages. When messages are recovered from other failed consumers, they are processed in smaller batches (100 messages) with delays between batches to prevent overwhelming the system during recovery scenarios. This careful pacing ensures that recovery doesn't impact the processing of new messages arriving in real-time.

### Graceful Shutdown

Both the server and consumer components implement comprehensive graceful shutdown mechanisms to ensure data integrity and clean resource cleanup. When a shutdown signal is received (SIGINT or SIGTERM), the consumer enters a controlled shutdown sequence. First, it sets a shutdown flag to stop accepting new messages from the main processing loop. Then, it forces a flush of any remaining messages in the buffer to ensure no data is lost. The system waits for all pending flush operations to complete using the concurrency limiter, ensuring that in-flight database writes finish before closing connections.

The shutdown process also handles uncaught exceptions and unhandled promise rejections, ensuring that even unexpected errors trigger a graceful shutdown sequence rather than an abrupt termination. All Redis and database connections are properly closed, and the process exits with an appropriate status code. The server component similarly handles shutdown signals, cleaning up Redis subscriptions and ensuring that WebSocket connections are properly closed. This graceful shutdown design is critical for production deployments where instances may be restarted for updates or moved between hosts, as it prevents message loss and connection leaks.

### Database Resilience

The application uses PostgreSQL connection pooling to manage database connections efficiently and handle connection failures gracefully. Both the server and consumer components create connection pools with configurable limits (default 5 connections), idle timeouts (30 seconds), and connection timeouts (20 seconds). The pool automatically manages connection lifecycle, creating new connections as needed and closing idle ones to free resources.

Database operations use transactions to ensure atomicity. When inserting messages, the consumer wraps the batch insert in a `BEGIN`/`COMMIT` transaction. If any error occurs during the insert, the transaction is rolled back, and the messages are re-queued into the buffer for retry. The database service also includes conflict handling using `ON CONFLICT DO NOTHING` to prevent duplicate inserts if the same message is processed multiple times (which could occur during recovery scenarios).

The pool includes error event handlers that log connection errors without crashing the application. If a connection fails, the pool automatically attempts to create a new connection for subsequent queries. This design ensures that temporary database connectivity issues don't cause permanent service disruption, the application continues to buffer messages and retry database operations until connectivity is restored.

### Error Handling and Health Monitoring

The application implements comprehensive error handling at multiple levels. The main processing loops in both server and consumer components are wrapped in try-catch blocks that log errors and continue operation rather than crashing. When errors occur during message processing, they are logged with full stack traces for debugging, and the system implements exponential backoff for retry operations to avoid overwhelming failing services.

The consumer includes a health status endpoint (via `getHealthStatus()`) that reports the operational state of all components, including Redis connection status, database connection status, current buffer size, and whether the application is running. This health information can be used by orchestration systems (like Kubernetes) to determine if an instance is healthy and ready to receive traffic. The health checks verify both connection state and operational readiness, providing accurate status for load balancers and monitoring systems.

Error recovery is designed to be automatic and transparent. If Redis becomes temporarily unavailable, the consumer's read operations will fail, but the main loop includes error handling that logs the issue and retries after a short delay (200ms). Similarly, if database writes fail, messages are re-queued and retried, ensuring eventual consistency. This self-healing design means that the system can recover from transient failures without manual intervention, making it suitable for production environments where network issues or service restarts are common.

## Technical Details

### Configuration

The application uses environment variables for configuration, loaded from `config/.env`. Key configuration options include:

**Redis Configuration:**
- `REDIS_URL` or `REDIS_HOST`, `REDIS_PORT`, `REDIS_PWD`: Redis connection details
- `STREAM_KEY`: Redis stream name (default: "chat_stream")
- `CONSUMER_GROUP`: Consumer group name (default: "cg1")
- `CONSUMER_NAME`: Consumer instance name (auto-generated if not provided)

**Consumer Settings:**
- `XREAD_COUNT`: Messages to read per operation (default: 500)
- `XREAD_BLOCK_MS`: Block timeout for reads (default: 10ms)
- `BATCH_SIZE`: Buffer size before flush (default: 200)
- `BATCH_TIMEOUT_MS`: Time-based flush trigger (default: 200ms)
- `FLUSH_CONCURRENCY`: Concurrent flush operations (default: 1)
- `CLAIM_MIN_IDLE_MS`: Minimum idle time for pending recovery (default: 10000ms)
- `CLAIM_COUNT`: Messages to claim per recovery iteration (default: 200)

**Server Configuration:**
- `PORT`: WebSocket server port (default: 9001)
- `SERVER_ID`: Unique server identifier (auto-generated if not provided)
- `ALLOWED_ORIGINS`: CORS allowed origins (comma-separated)

**Database Configuration:**
- `SUPABASE_DB_URL`: PostgreSQL connection string

### Running the Application

#### Local Development

Start Redis and PostgreSQL instances:
```bash
docker start redis-local
docker start local-pg
```

Set environment variables in `config/.env`:
```bash
SUPABASE_DB_URL=postgres://postgres:postgres@localhost:5432/messages
REDIS_HOST=localhost
REDIS_PORT=6379
```

Run the server:
```bash
node server/server-fanout.js
```

Run the consumer (in a separate terminal):
```bash
node consumer/consumer.js
```

#### Docker Deployment

Build and run the server:
```bash
docker build -t server-local -f server/Dockerfile.server .
docker run --env-file config/.env-local -p 9001:9001 server-local
```

Build and run the consumer:
```bash
docker build -t consumer-local -f consumer/Dockerfile.consumer .
docker run --env-file config/.env-local consumer-local
```

#### Multiple Instances with PM2

Run multiple server instances:
```bash
pm2 start server/server-fanout.js -i <instance-num>
```

Run multiple consumer instances:
```bash
pm2 start consumer/consumer.js -i <instance-num>
```

Check logs:
```bash
pm2 logs
```

### Testing

Run server unit tests:
```bash
cd server
npm run test:unit
```

## Dependencies

- **uWebSockets.js**: High-performance WebSocket server
- **redis**: Redis client for Node.js
- **pg**: PostgreSQL client with connection pooling
- **p-limit**: Concurrency control for batch operations
- **dotenv**: Environment variable management
