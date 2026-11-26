const crypto = require('crypto');

const DEFAULT_PROD_ORIGINS = ['https://kivo-ai-assistant.vercel.app'];

function getAllowedOrigins() {
  const configured = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  const origins = new Set([...DEFAULT_PROD_ORIGINS, ...configured]);
  if (process.env.VERCEL_URL) {
    origins.add(`https://${process.env.VERCEL_URL.trim()}`);
  }
  return origins;
}

function isOriginAllowed(origin) {
  if (!origin) return true; // Same-origin or non-browser request without Origin header
  const allowed = getAllowedOrigins();
  if (allowed.has(origin)) return true;

  // Allow localhost only outside strict production
  if (process.env.NODE_ENV !== 'production') {
    if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/.test(origin)) {
      return true;
    }
  }
  return false;
}

function applySecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), geolocation=(), payment=(), usb=(), interest-cohort=(), microphone=(self)');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('X-XSS-Protection', '0');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
}

function handleCorsAndMethod(req, res, allowedMethods = ['POST']) {
  applySecurityHeaders(res);

  const origin = req.headers.origin;
  if (origin) {
    if (!isOriginAllowed(origin)) {
      res.status(403).json({ error: 'Cross-origin request blocked by security policy.' });
      return false;
    }
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', [...allowedMethods, 'OPTIONS'].join(', '));
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Requested-With, X-User-Api-Key');
    res.setHeader('Access-Control-Max-Age', '600');
  }

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return false;
  }

  if (!allowedMethods.includes(req.method)) {
    res.setHeader('Allow', [...allowedMethods, 'OPTIONS'].join(', '));
    res.status(405).json({ error: 'Method not allowed.' });
    return false;
  }

  // CSRF check for mutating requests
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    const contentType = String(req.headers['content-type'] || '').toLowerCase();
    if (!contentType.includes('application/json')) {
      res.status(415).json({ error: 'Content-Type must be application/json.' });
      return false;
    }

    const xrw = req.headers['x-requested-with'];
    if (xrw !== 'KIVO-Web') {
      res.status(403).json({ error: 'Missing required security request header.' });
      return false;
    }

    // Double-check Origin or Referer if present
    if (origin && !isOriginAllowed(origin)) {
      res.status(403).json({ error: 'Invalid request origin.' });
      return false;
    }
  }

  return true;
}

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function sanitizeObject(value, depth = 0) {
  if (depth > 8) return null;
  if (value === null || value === undefined) return value;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 100).map(item => sanitizeObject(item, depth + 1));
  }
  if (typeof value === 'object') {
    const clean = Object.create(null);
    for (const [k, v] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.has(k)) continue;
      clean[k] = sanitizeObject(v, depth + 1);
    }
    return clean;
  }
  return null;
}

async function readJsonBody(req, maxBytes = 64 * 1024) {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'object') {
      const approxSize = Buffer.byteLength(JSON.stringify(req.body), 'utf8');
      if (approxSize > maxBytes) {
        const err = new Error('Payload too large');
        err.statusCode = 413;
        throw err;
      }
      return sanitizeObject(req.body);
    }
    if (typeof req.body === 'string') {
      if (Buffer.byteLength(req.body, 'utf8') > maxBytes) {
        const err = new Error('Payload too large');
        err.statusCode = 413;
        throw err;
      }
      return sanitizeObject(JSON.parse(req.body));
    }
  }

  return await new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', chunk => {
      total += chunk.length;
      if (total > maxBytes) {
        const err = new Error('Payload too large');
        err.statusCode = 413;
        req.destroy(err);
        reject(err);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8').trim();
        if (!raw) {
          resolve(Object.create(null));
          return;
        }
        resolve(sanitizeObject(JSON.parse(raw)));
      } catch {
        const err = new Error('Malformed JSON payload');
        err.statusCode = 400;
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function redactSecrets(text) {
  return String(text || '')
    .replace(/AIza[0-9A-Za-z\-_]{20,}/g, '[REDACTED_KEY]')
    .replace(/AQ\.[0-9A-Za-z\-_]{15,}/g, '[REDACTED_KEY]')
    .replace(/Bearer\s+[A-Za-z0-9\-_.]+/gi, 'Bearer [REDACTED]')
    .replace(/key=[A-Za-z0-9\-_.]+/gi, 'key=[REDACTED]');
}

function sendError(res, status, publicMessage, internalErr = null) {
  if (internalErr && process.env.NODE_ENV !== 'production') {
    console.error(`[API ${status}]`, redactSecrets(internalErr.message || internalErr));
  }
  return res.status(status).json({ error: publicMessage });
}

function isHttpsRequest(req) {
  const proto = String(req.headers['x-forwarded-proto'] || '').toLowerCase();
  if (proto === 'https') return true;
  if (process.env.VERCEL === '1' || process.env.NODE_ENV === 'production') {
    const host = String(req.headers.host || '').toLowerCase();
    return !host.startsWith('localhost') && !host.startsWith('127.0.0.1');
  }
  return false;
}

function getClientIp(req) {
  const vercelIp = req.headers['x-vercel-forwarded-for'] || req.headers['x-real-ip'];
  if (typeof vercelIp === 'string' && vercelIp.trim()) {
    return vercelIp.split(',')[0].trim().slice(0, 64);
  }
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.trim()) {
    return fwd.split(',')[0].trim().slice(0, 64);
  }
  return String(req.socket?.remoteAddress || 'unknown').slice(0, 64);
}

function sha256Hex(input) {
  return crypto.createHash('sha256').update(String(input)).digest('hex');
}

module.exports = {
  applySecurityHeaders,
  handleCorsAndMethod,
  readJsonBody,
  sendError,
  isHttpsRequest,
  getClientIp,
  sha256Hex,
  sanitizeObject
};
