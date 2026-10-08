'use strict';

const { createApp } = require('./app');

const port = Number(process.env.PORT) || 3000;
const { app } = createApp({
  ttlMs: (Number(process.env.SESSION_TTL_HOURS) || 12) * 60 * 60 * 1000,
});

app.listen(port, () => {
  console.log(`Icebreaker Map listening on http://localhost:${port}`);
  if (!process.env.PUBLIC_URL) {
    console.log('Tip: set PUBLIC_URL to your https URL so QR codes work on phones.');
  }
});
