import http from "http";
import fs from "fs";
import path from "path";
import { WebSocketServer } from "ws";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* -----------------------------
  HTTP server (static files)
-------------------------------- */
const server = http.createServer((req, res) => {
  const url = req.url === "/" ? "/index.html" : req.url;
  const filePath = path.join(__dirname, url);

  try {
    const data = fs.readFileSync(filePath);
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
});

/* -----------------------------
  WebSocket server
-------------------------------- */
const wss = new WebSocketServer({ server });

wss.on("connection", ws => {
  ws.on("message", message => {
    // broadcast to all clients
    for (const client of wss.clients) {
      if (client.readyState === ws.OPEN) {
        client.send(message);
      }
    }
  });
});

/* -----------------------------
  Start server
-------------------------------- */
server.listen(3000, () => {
  console.log("ws server running at http://localhost:3000");
});
