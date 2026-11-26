const crypto = require('crypto');
const { isHttpsRequest } = require('./security');

const COOKIE_PROD = '__Host-kivo_session';
const COOKIE_DEV = 'kivo_session';
const SESSION_TTL_SEC = 60 * 60 * 24; // 24 hours

function getSessionSecret() {
  const secret = (process.env.SESSION_SECRET || '').trim();
  if (secret.length >= 32) return secret;

  // Fail closed in production; allow ephemeral dev-only secret locally when NODE_ENV !== 'production'
  if (process.env.NODE_ENV === 'production' || process.env.VERCEL === '1') {
    return null;
  }
  if (!globalThis.__kivoDevSessionSecret) {
    globalThis.__kivoDevSessionSecret = crypto.randomBytes(32).toString('hex');
  }
  return globalThis.__kivoDevSessionSecret;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(String(password), salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

function verifyPassword(password, storedHash) {
  if (typeof password !== 'string' || typeof storedHash !== 'string') return false;
  const parts = storedHash.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, hexKey] = parts;
  if (!salt || !hexKey || !/^[0-9a-f]+$/i.test(hexKey)) return false;

  try {
    const keyBuf = Buffer.from(hexKey, 'hex');
    const derived = crypto.scryptSync(password, salt, keyBuf.length, { N: 16384, r: 8, p: 1 });
    if (derived.length !== keyBuf.length) return false;
    return crypto.timingSafeEqual(derived, keyBuf);
  } catch {
    return false;
  }
}

function base64UrlEncode(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(str) {
  const pad = str.length % 4 ? '='.repeat(4 - (str.length % 4)) : '';
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64').toString('utf8');
}

function signSessionToken(userPayload) {
  const secret = getSessionSecret();
  if (!secret) {
    throw new Error('SESSION_SECRET_MISSING');
  }
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    sub: String(userPayload.id),
    name: String(userPayload.name),
    email: String(userPayload.email),
    role: userPayload.role === 'admin' ? 'admin' : (userPayload.role === 'guest' ? 'guest' : 'user'),
    iat: now,
    exp: now + SESSION_TTL_SEC,
    jti: crypto.randomBytes(12).toString('hex')
  };
  const headerB64 = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payloadB64 = base64UrlEncode(JSON.stringify(claims));
  const sig = base64UrlEncode(
    crypto.createHmac('sha256', secret).update(`${headerB64}.${payloadB64}`).digest()
  );
  return `${headerB64}.${payloadB64}.${sig}`;
}

function verifySessionToken(token) {
  if (typeof token !== 'string') return null;
  const secret = getSessionSecret();
  if (!secret) return null;

  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;

  try {
    const expectedSig = base64UrlEncode(
      crypto.createHmac('sha256', secret).update(`${headerB64}.${payloadB64}`).digest()
    );
    const a = Buffer.from(sigB64, 'utf8');
    const b = Buffer.from(expectedSig, 'utf8');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return null;
    }

    const header = JSON.parse(base64UrlDecode(headerB64));
    if (header.alg !== 'HS256' || header.typ !== 'JWT') return null;

    const claims = JSON.parse(base64UrlDecode(payloadB64));
    const now = Math.floor(Date.now() / 1000);
    if (!claims || typeof claims.exp !== 'number' || claims.exp <= now) {
      return null;
    }
    return claims;
  } catch {
    return null;
  }
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const cookies = Object.create(null);
  header.split(';').forEach(part => {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key && key !== '__proto__' && key !== 'constructor' && key !== 'prototype') {
      cookies[key] = decodeURIComponent(val);
    }
  });
  return cookies;
}

function getSessionFromRequest(req) {
  const cookies = parseCookies(req);
  const token = cookies[COOKIE_PROD] || cookies[COOKIE_DEV];
  if (!token) return null;
  return verifySessionToken(token);
}

function setSessionCookie(req, res, token) {
  const https = isHttpsRequest(req);
  const name = https ? COOKIE_PROD : COOKIE_DEV;
  const flags = [
    `${name}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${SESSION_TTL_SEC}`
  ];
  if (https) flags.push('Secure');
  res.setHeader('Set-Cookie', flags.join('; '));
}

function clearSessionCookie(req, res) {
  const https = isHttpsRequest(req);
  const cleared = [
    `${COOKIE_DEV}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
    `${COOKIE_PROD}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`
  ];
  res.setHeader('Set-Cookie', https ? cleared : [cleared[0]]);
}

function requireAuth(req, res) {
  const session = getSessionFromRequest(req);
  if (!session) {
    res.status(401).json({ error: 'Authentication required. Please sign in.' });
    return null;
  }
  return session;
}

function requireAdmin(req, res) {
  const session = requireAuth(req, res);
  if (!session) return null;
  if (session.role !== 'admin') {
    res.status(403).json({ error: 'Forbidden: Administrator privileges required.' });
    return null;
  }
  return session;
}

module.exports = {
  hashPassword,
  verifyPassword,
  signSessionToken,
  verifySessionToken,
  getSessionFromRequest,
  setSessionCookie,
  clearSessionCookie,
  requireAuth,
  requireAdmin,
  getSessionSecret
};
