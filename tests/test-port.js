import uWS from 'uWebSockets.js';

const PORT = 9001;

uWS.App().listen(PORT, (listener) => {
  if (listener) {
    console.log(`✅ Listening on ${PORT}`);
  } else {
    console.error('❌ Failed to start server');
  }
});
