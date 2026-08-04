const path = require('path');
const express = require('express');
const config = require('../config');
const logger = require('../logger');
const {mountMetrics} = require('../metrics');
const statusRoutes = require('./routes/status');
const configRoutes = require('./routes/config');
const tradesRoutes = require('./routes/trades');
const imagesRoutes = require('./routes/images');

// Basic-Auth-Middleware: greift nur, wenn WEB_AUTH_TOKEN gesetzt ist.
// Beliebiger Benutzername, Passwort muss dem Token entsprechen.
function basicAuth(req, res, next) {
  const token = config.web_auth_token;
  if (!token) {
    return next();
  }

  const header = req.headers.authorization || '';
  const [scheme, encoded] = header.split(' ');
  if (scheme === 'Basic' && encoded) {
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    const pass = decoded.slice(decoded.indexOf(':') + 1);
    if (pass === token) {
      return next();
    }
  }
  res.set('WWW-Authenticate', 'Basic realm="SteamTradeBot"');
  return res.status(401).send('Authentication required');
}

function startServer() {
  const app = express();
  app.use(express.json());

  // /metrics bleibt immer offen (Prometheus-Scraping, gehört zum Headless-Betrieb).
  mountMetrics(app);

  if (config.web_ui_enabled) {
    app.use('/api', basicAuth);
    app.use('/api/status', statusRoutes);
    app.use('/api/config', configRoutes);
    app.use('/api', tradesRoutes);
    app.use('/images', basicAuth, imagesRoutes);

    app.use(basicAuth, express.static(path.join(__dirname, 'public')));
    logger.info('Web UI enabled');
  } else {
    logger.info('Web UI disabled (headless mode) – only /metrics is served');
  }

  const port = parseInt(config.port);
  const host = config.web_host || '127.0.0.1';
  return app.listen(port, host,
      () => logger.info(`Server running on ${host}:${port}`));
}

module.exports = {startServer};
