const fs = require('fs');
const path = require('path');
const os = require('os');
const { sha256Hex } = require('./security');

const DB_FILE = path.join(os.tmpdir(), 'kivo-secure-users-db.json');

function toSafePublicUser(record) {
  if (!record) return null;
  return {
    id: record.id,
    name: record.name,
    email: record.email,
    role: record.role || 'user',
    chatsCount: Number(record.chatsCount || 0),
    imagesCount: Number(record.imagesCount || 0),
    lastActive: record.lastActive || null,
    createdAt: record.createdAt || null
  };
}

function upstashConfig() {
  const url = (process.env.UPSTASH_REDIS_REST_URL || '').trim().replace(/\/+$/, '');
  const token = (process.env.UPSTASH_REDIS_REST_TOKEN || '').trim();
  if (url && token) return { url, token };
  return null;
}

async function redisCmd(args) {
  const cfg = upstashConfig();
  if (!cfg) return null;
  const res = await fetch(cfg.url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(args)
  });
  if (!res.ok) throw new Error('Database request failed');
  const data = await res.json();
  return data.result;
}

function readLocalDb() {
  try {
    if (!fs.existsSync(DB_FILE)) return Object.create(null);
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    const safe = Object.create(null);
    if (parsed && typeof parsed === 'object') {
      for (const [k, v] of Object.entries(parsed)) {
        if (k !== '__proto__' && k !== 'constructor' && k !== 'prototype') {
          safe[k] = v;
        }
      }
    }
    return safe;
  } catch {
    return Object.create(null);
  }
}

function writeLocalDb(db) {
  const tmp = `${DB_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, DB_FILE);
}

async function getUserByEmail(email) {
  const norm = String(email || '').trim().toLowerCase();
  if (!norm) return null;
  const key = `kivo:user:${sha256Hex(norm)}`;

  if (upstashConfig()) {
    const raw = await redisCmd(['GET', key]);
    return raw ? JSON.parse(raw) : null;
  }

  const db = readLocalDb();
  return db[key] || null;
}

async function saveUser(userRecord) {
  const norm = String(userRecord.email || '').trim().toLowerCase();
  const key = `kivo:user:${sha256Hex(norm)}`;

  if (upstashConfig()) {
    await redisCmd(['SET', key, JSON.stringify(userRecord)]);
    await redisCmd(['SADD', 'kivo:users:index', key]);
    return toSafePublicUser(userRecord);
  }

  const db = readLocalDb();
  db[key] = userRecord;
  writeLocalDb(db);
  return toSafePublicUser(userRecord);
}

async function incrementUserStat(email, field) {
  if (!email || (field !== 'chatsCount' && field !== 'imagesCount')) return;
  const user = await getUserByEmail(email);
  if (!user) return;
  user[field] = Number(user[field] || 0) + 1;
  user.lastActive = new Date().toISOString();
  await saveUser(user);
}

async function listAllSafeUsers() {
  if (upstashConfig()) {
    const keys = await redisCmd(['SMEMBERS', 'kivo:users:index']);
    if (!Array.isArray(keys) || keys.length === 0) return [];
    const results = [];
    for (const k of keys.slice(0, 100)) {
      const raw = await redisCmd(['GET', k]);
      if (raw) {
        const safe = toSafePublicUser(JSON.parse(raw));
        if (safe) results.push(safe);
      }
    }
    return results;
  }

  const db = readLocalDb();
  return Object.values(db).map(toSafePublicUser).filter(Boolean);
}

module.exports = {
  toSafePublicUser,
  getUserByEmail,
  saveUser,
  incrementUserStat,
  listAllSafeUsers
};
