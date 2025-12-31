import ws from "k6/ws";
import { check } from "k6";

// ---------------------------
// CONFIGURATION (change here)
// ---------------------------
const NUM_VUS = 250;       // number of virtual users
const TEST_DURATION = "30s"; // duration of the test
const MSG_INTERVAL = 100;   // interval between messages in ms
const PAYLOAD = "hello";    // message payload
// ---------------------------

export const options = {
  vus: NUM_VUS,
  duration: TEST_DURATION,
};

export default function () {
  const url = "ws://localhost:3000";

  const res = ws.connect(url, {}, socket => {
    socket.on("open", () => {
      // send messages continuously
      socket.setInterval(() => {
        socket.send(JSON.stringify({
          type: "chat",
          username: `vu-${__VU}`,
          message: PAYLOAD
        }));
      }, MSG_INTERVAL);
    });

    socket.on("message", data => {
      check(data, {
        "message received": msg => msg && msg.length > 0,
      });
    });

    socket.setTimeout(() => {
      socket.close();
    }, parseDuration(TEST_DURATION)); // close after test duration
  });

  check(res, { "connection successful": r => r && r.status === 101 });
}

/**
 * helper to convert "1m" or "30s" to ms
 */
function parseDuration(duration) {
  if (duration.endsWith("s")) return parseInt(duration) * 1000;
  if (duration.endsWith("m")) return parseInt(duration) * 60 * 1000;
  return parseInt(duration);
}
