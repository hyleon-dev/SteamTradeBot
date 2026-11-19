const crypto = require('crypto');

// Session cookie for the web UI login. Stateless: the cookie holds its expiry time and an
// HMAC of it. The key comes from WEB_AUTH_TOKEN. So sessions survive a restart, and a new
// token makes all old sessions invalid.
const COOKIE_NAME = 'stb_session';
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;

function sessionKey(token) {
  return crypto.createHash('sha256').update(`stb-session:${token}`).digest();
}

function sign(token, expiresAt) {
  return crypto.createHmac('sha256', sessionKey(token)).update(String(expiresAt)).digest('base64url');
}

function createSession(token, now = Date.now()) {
  const expiresAt = now + SESSION_MS;
  return {value: `${expiresAt}.${sign(token, expiresAt)}`, maxAgeMs: SESSION_MS};
}

function verifySession(token, value, now = Date.now()) {
  if (!token || typeof value !== 'string') {
    return false;
  }
  const [exp, sig] = value.split('.');
  const expiresAt = Number(exp);
  if (!Number.isFinite(expiresAt) || expiresAt <= now || !sig) {
    return false;
  }
  const expected = Buffer.from(sign(token, expiresAt));
  const given = Buffer.from(sig);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

// Minimal cookie header parser. Only the session cookie is needed.
function readCookie(req, name = COOKIE_NAME) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i !== -1 && part.slice(0, i).trim() === name) {
      return decodeURIComponent(part.slice(i + 1).trim());
    }
  }
  return null;
}

// Secure flag only on HTTPS. Behind a reverse proxy, the proxy sets X-Forwarded-Proto.
function cookieOptions(req, maxAgeMs) {
  return {
    httpOnly: true,
    sameSite: 'strict',
    path: '/',
    secure: req.secure || req.get('x-forwarded-proto') === 'https',
    ...(maxAgeMs != null ? {maxAge: maxAgeMs} : {}),
  };
}

module.exports = {COOKIE_NAME, SESSION_MS, createSession, verifySession, readCookie, cookieOptions};
