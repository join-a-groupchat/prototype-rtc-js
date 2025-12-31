import http from "k6/http";
import { check, sleep } from "k6";

export const options = {
  vus: 250,
  duration: "30s"
};

const BASE_URL = "http://localhost:3000/socket.io/?EIO=4&transport=polling";

export default function () {
  // 1. Handshake (GET)
  const handshake = http.get(BASE_URL);

  check(handshake, {
    "handshake OK": r => r.status === 200,
  });

  // Extract sid from response body
  const match = handshake.body.match(/"sid":"([^"]+)"/);
  if (!match) return;

  const sid = match[1];

  // 2. Send message (POST)
  const payload = `42["chat",{"username":"vu-${__VU}","message":"hello"}]`;

  const res = http.post(
    `${BASE_URL}&sid=${sid}`,
    payload,
    { headers: { "Content-Type": "text/plain" } }
  );

  check(res, {
    "message sent": r => r.status === 200,
  });

  sleep(0.1);
}
