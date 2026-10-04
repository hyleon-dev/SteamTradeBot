const path = require('path');
const crypto = require('crypto');
const express = require('express');
const config = require('../config');
const logger = require('../logger');
const {mountMetrics} = require('../metrics');
const statusRoutes = require('./routes/status');
const configRoutes = require('./routes/config');
const tradesRoutes = require('./routes/trades');
const imagesRoutes = require('./routes/images');
const eventsRoutes = require('./routes/events');

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

// Lockout after too many wrong passwords from one IP.
const MAX_FAILED_LOGINS = 10;
const LOCKOUT_MS = 15 * 60 * 1000;
const failedLogins = new Map(); // ip -> { count, resetAt }

function isLockedOut(ip) {
  const entry = failedLogins.get(ip);
  if (!entry) {
    return false;
  }
  if (entry.resetAt <= Date.now()) {
    failedLogins.delete(ip);
    return false;
  }
  return entry.count >= MAX_FAILED_LOGINS;
}

function recordFailedLogin(ip) {
  const now = Date.now();
  // Remove old entries, so the map does not grow forever.
  for (const [key, entry] of failedLogins) {
    if (entry.resetAt <= now) {
      failedLogins.delete(key);
    }
  }
  const entry = failedLogins.get(ip) || {count: 0, resetAt: now + LOCKOUT_MS};
  entry.count++;
  failedLogins.set(ip, entry);
  if (entry.count === MAX_FAILED_LOGINS) {
    logger.warn(`Web UI: too many failed logins from ${ip}, locked for ${LOCKOUT_MS / 60000} min`);
  }
}

// Compare in constant time. Hashing first gives both buffers the same length.
function safeEqual(a, b) {
  const hash = (s) => crypto.createHash('sha256').update(String(s)).digest();
  return crypto.timingSafeEqual(hash(a), hash(b));
}

// Auth middleware for the web UI.
// With WEB_AUTH_TOKEN: basic auth. Any user name. Password must match the token.
// Without token: only requests with a loopback Host header. This blocks DNS
// rebinding, where a foreign website sends requests to 127.0.0.1 in the browser.
function basicAuth(req, res, next) {
  const token = config.web_auth_token;
  if (!token) {
    if (LOOPBACK_HOSTS.has(req.hostname)) {
      return next();
    }
    return res.status(403).send('Forbidden: set WEB_AUTH_TOKEN to allow access via this host name');
  }

  const ip = req.ip;
  if (isLockedOut(ip)) {
    return res.status(429).send('Too many failed logins. Try again later.');
  }

  const header = req.headers.authorization || '';
  const [scheme, encoded] = header.split(' ');
  if (scheme === 'Basic' && encoded) {
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    const pass = decoded.slice(decoded.indexOf(':') + 1);
    if (safeEqual(pass, token)) {
      failedLogins.delete(ip);
      return next();
    }
    recordFailedLogin(ip);
  }
  res.set('WWW-Authenticate', 'Basic realm="SteamTradeBot"');
  return res.status(401).send('Authentication required');
}

function startServer() {
  const app = express();
  app.use(express.json());

  // /metrics stays open always (Prometheus scraping, part of headless mode).
  mountMetrics(app);

  if (config.web_ui_enabled) {
    app.use('/api', basicAuth);
    app.use('/api/status', statusRoutes);
    app.use('/api/config', configRoutes);
    app.use('/api/events', eventsRoutes);
    app.use('/api', tradesRoutes);
    app.use('/images', basicAuth, imagesRoutes);

    app.use(basicAuth, express.static(path.join(__dirname, 'public')));
    logger.info('Web UI enabled');
    if (!config.web_auth_token) {
      logger.warn('Web UI has no WEB_AUTH_TOKEN. Access only via localhost/127.0.0.1.');
    }
  } else {
    logger.info('Web UI disabled (headless mode). Only /metrics is served');
  }

  const port = parseInt(config.port);
  const host = config.web_host || '127.0.0.1';
  return app.listen(port, host,
      () => logger.info(`Server running on ${host}:${port}`));
}

module.exports = {startServer};
