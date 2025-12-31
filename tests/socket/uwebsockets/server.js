import uWS from "uWebSockets.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = uWS.App();

/* -----------------------------
  Serve static files
-------------------------------- */
app.get("/*", (res, req) => {
  const url = req.getUrl() === "/" ? "/index.html" : req.getUrl();
  const filePath = path.join(__dirname, url);

  try {
    const data = fs.readFileSync(filePath);
    res.end(data);
  } catch {
    res.writeStatus("404 Not Found").end();
  }
});

/* -----------------------------
  WebSocket chat
-------------------------------- */
app.ws("/*", {
  open: ws => {
    ws.subscribe("chat");
  },

  message: (ws, message) => {
    // message is ArrayBuffer
    const msg = Buffer.from(message).toString();
    app.publish("chat", msg);
  }
});

/* -----------------------------
  Start server
-------------------------------- */
app.listen(3000, token => {
  if (token) {
    console.log("uWebSockets.js server running at http://localhost:3000");
  } else {
    console.error("Failed to bind to port 3000");
  }
});
