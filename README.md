# prototype-rtc-js
Real -time scalable group chat app with uWebSockets, Redis, and Postgres

### How to run (Local) >>

Using code?
```bash
node server.js

node consumer.js
```
Also run local redis instance.
```bash
docker start redis-local
```
Also run local Postgres instance.
```bash
docker start local-pg
```
Don't forget to change env variables to local redis and pg
```bash
SUPABASE_DB_URL=postgres://postgres:postgres@localhost:5432/messages
```

Using containers to run server?
```bash
docker build -t server-local -f Dockerfile.server .

docker run --env-file .env-local -p 9001:9001 server-local
```
Run local redis instance too.

### How to run (PM2 Multiple Instances) >>

```bash
pm2 start server.js -i <instance-num>
```

Also run local redis instance.
Change local vars to local redis host and port.

Check logs
```bash
pm2 logs
```

Stop all instances
```bash
pm2 stop all
```

### Testing >>

Server Unit Tests
```bash
npm test
```