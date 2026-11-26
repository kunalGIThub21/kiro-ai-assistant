const { getClientIp, sha256Hex } = require('./security');

const MAX_BUCKETS = 5000;
const memoryBuckets = new Map();
const authFailures = new Map();

function pruneMap(map, now) {
  if (map.size <= MAX_BUCKETS) return;
  for (const [k, v] of map.entries()) {
    if ((v.resetAt && v.resetAt <= now) || (v.lockedUntil && v.lockedUntil <= now)) {
      map.delete(k);
    }
    if (map.size <= MAX_BUCKETS * 0.75) break;
  }
  while (map.size > MAX_BUCKETS) {
    const oldestKey = map.keys().next().value;
    map.delete(oldestKey);
  }
}

async function incrementDistributedCounter(key, windowSec) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;

  try {
    const safeUrl = url.replace(/\/+$/, '');
    const res = await fetch(`${safeUrl}/pipeline`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify([
        ['INCR', key],
        ['EXPIRE', key, windowSec, 'NX']
      ])
    });
    if (!res.ok) return null;
    const data = await res.json();
    const count = Number(data?.[0]?.result);
    return Number.isFinite(count) ? count : null;
  } catch {
    return null;
  }
}

async function checkRateLimit(req, res, { scope = 'api', max = 20, windowMs = 60_000, identifier = '' } = {}) {
  const now = Date.now();
  const ip = getClientIp(req);
  const keyHash = sha256Hex(`${scope}:${ip}:${identifier}`);
  const windowSec = Math.ceil(windowMs / 1000);
  const redisKey = `rl:${scope}:${keyHash}`;

  const distCount = await incrementDistributedCounter(redisKey, windowSec);
  let count;
  let resetAt;

  if (distCount !== null) {
    count = distCount;
    resetAt = now + windowMs;
  } else {
    pruneMap(memoryBuckets, now);
    let bucket = memoryBuckets.get(keyHash);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
    }
    bucket.count += 1;
    memoryBuckets.set(keyHash, bucket);
    count = bucket.count;
    resetAt = bucket.resetAt;
  }

  const remaining = Math.max(0, max - count);
  const resetSeconds = Math.max(1, Math.ceil((resetAt - now) / 1000));

  res.setHeader('X-RateLimit-Limit', String(max));
  res.setHeader('X-RateLimit-Remaining', String(remaining));
  res.setHeader('X-RateLimit-Reset', String(Math.ceil(resetAt / 1000)));

  if (count > max) {
    res.setHeader('Retry-After', String(resetSeconds));
    res.status(429).json({
      error: `Too many requests. Please wait ${resetSeconds} seconds before trying again.`
    });
    return false;
  }

  return true;
}

function getLockoutState(req, identity = '') {
  const now = Date.now();
  const key = sha256Hex(`lock:${getClientIp(req)}:${String(identity).toLowerCase()}`);
  const entry = authFailures.get(key);
  if (!entry) return { locked: false, retryAfterSec: 0 };
  if (entry.lockedUntil && entry.lockedUntil > now) {
    return {
      locked: true,
      retryAfterSec: Math.ceil((entry.lockedUntil - now) / 1000)
    };
  }
  return { locked: false, retryAfterSec: 0 };
}

function recordAuthFailure(req, identity = '') {
  const now = Date.now();
  pruneMap(authFailures, now);
  const key = sha256Hex(`lock:${getClientIp(req)}:${String(identity).toLowerCase()}`);
  const entry = authFailures.get(key) || { fails: 0, lockedUntil: 0, resetAt: now + 15 * 60_000 };
  entry.fails += 1;
  entry.resetAt = now + 15 * 60_000;
  if (entry.fails >= 5) {
    const backoffMinutes = Math.min(30, Math.pow(2, entry.fails - 5));
    entry.lockedUntil = now + backoffMinutes * 60_000;
  }
  authFailures.set(key, entry);
}

function clearAuthFailures(req, identity = '') {
  const key = sha256Hex(`lock:${getClientIp(req)}:${String(identity).toLowerCase()}`);
  authFailures.delete(key);
}

module.exports = {
  checkRateLimit,
  getLockoutState,
  recordAuthFailure,
  clearAuthFailures
};
