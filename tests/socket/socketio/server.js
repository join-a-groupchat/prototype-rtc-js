import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Server } from "socket.io";

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
  Socket.IO server (polling only)
-------------------------------- */
const io = new Server(server, {
  transports: ["polling"], // IMPORTANT: force HTTP polling
  cors: { origin: "*" }
});

io.on("connection", socket => {
  socket.on("chat", msg => {
    io.emit("chat", msg); // broadcast (same as WS)
  });
});

/* -----------------------------
  Start server
-------------------------------- */
server.listen(3000, () => {
  console.log("Socket.IO (polling) server running at http://localhost:3000");
});
