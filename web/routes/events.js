const express = require('express');
const events = require('../../events');

const router = express.Router();

// Keep-alive interval. Stops proxies from closing an idle connection.
const PING_MS = 25 * 1000;

// Server-Sent Events stream. The web UI reloads its data on each event.
router.get('/', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  res.write('retry: 5000\n\n');

  const onTrade = (data) => {
    res.write(`event: trade\ndata: ${JSON.stringify(data)}\n\n`);
  };
  const ping = setInterval(() => res.write(': ping\n\n'), PING_MS);

  events.on('trade', onTrade);
  req.on('close', () => {
    clearInterval(ping);
    events.off('trade', onTrade);
  });
});

module.exports = router;
