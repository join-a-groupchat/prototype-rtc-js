import ws from "k6/ws";
import { sleep } from "k6";

export const options = {
  vus: 500,
  duration: "30s",
};

export default function () {
  const url = "ws://localhost:9001";

  ws.connect(url, {}, function (socket) {
    socket.on("open", () => {
      socket.setInterval(() => {
        socket.send(JSON.stringify({
          type: "chat",
          username: "loadtest",
          message: "hello"
        }));
      }, 50);
    });

    socket.on("error", (e) => {
      console.error("WS error:", e.error());
    });
  });

  sleep(30);
}

// script used when e2e latency testing
/*
import ws from "k6/ws";
import { check, sleep } from "k6";

export const options = {
  vus: 200,
  duration: "1m",
};

export default function () {
  const url = "ws://localhost:9001";

  ws.connect(url, {}, function (socket) {
    socket.on("open", () => {
      socket.send(JSON.stringify({ type: "chat", username: "loadtest", message: "hello" }));
    });

    socket.on("message", (data) => {
      // message received from server
    });

    socket.on("error", (e) => {
      console.error("WS error:", e.error());
    });

    sleep(1);
  });
}
*/