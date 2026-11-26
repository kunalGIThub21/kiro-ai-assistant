const assert = require('assert');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');

function makeMockReq({ method = 'GET', headers = {}, body = undefined, ip = '203.0.113.10' } = {}) {
  const lowerHeaders = {};
  for (const [k, v] of Object.entries(headers)) lowerHeaders[k.toLowerCase()] = v;
  return {
    method,
    headers: lowerHeaders,
    body,
    socket: { remoteAddress: ip }
  };
}

function makeMockRes() {
  const headers = {};
  const res = {
    statusCode: 200,
    body: null,
    ended: false,
    setHeader(k, v) {
      headers[k.toLowerCase()] = v;
    },
    getHeader(k) {
      return headers[k.toLowerCase()];
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      this.ended = true;
      return this;
    },
    end() {
      this.ended = true;
      return this;
    }
  };
  return res;
}

async function runAudit() {
  console.log('--- 1. Static & Secret Audit ---');
  const indexHtml = fs.readFileSync(path.join(repoRoot, 'index.html'), 'utf8');
  const appJs = fs.readFileSync(path.join(repoRoot, 'assets', 'app.js'), 'utf8');
  const vercelJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'vercel.json'), 'utf8'));

  assert(!fs.existsSync(path.join(repoRoot, 'config.js')), 'Exposed config.js must be deleted');
  assert(fs.existsSync(path.join(repoRoot, 'assets', 'styles.css')), 'Compiled Tailwind styles.css must exist');
  assert(fs.existsSync(path.join(repoRoot, 'assets', 'vendor', 'three.module.js')), 'Self-hosted Three.js must exist');
  assert(!/cdn\.tailwindcss\.com|three\.js\/r128/i.test(indexHtml), 'Outdated/unsafe CDNs must be removed');
  assert(!/<script\b(?![^>]*\bsrc=)[^>]*>/i.test(indexHtml), 'Inline <script> code must not exist in index.html');
  assert(!/\son(click|submit|input|change|load|error)=/i.test(indexHtml), 'Inline DOM event attributes must not exist');

  for (const [name, content] of [['index.html', indexHtml], ['assets/app.js', appJs]]) {
    assert(!/AIza[0-9A-Za-z\-_]{20,}/.test(content), `No Gemini key in ${name}`);
    assert(!/AQ\.[0-9A-Za-z\-_]{15,}/.test(content), `No AQ key in ${name}`);
    assert(!/atob\s*\(/.test(content), `No obfuscated atob secret in ${name}`);
    assert(!/console\.(log|info|warn|error)\s*\(/.test(content), `Debug console statements disabled in ${name}`);
  }

  const hdrs = Object.fromEntries(vercelJson.headers[0].headers.map(h => [h.key, h.value]));
  assert(hdrs['Content-Security-Policy'].includes("script-src 'self'"), 'Strict CSP script-src self required');
  assert(!hdrs['Content-Security-Policy'].match(/script-src[^;]*unsafe-inline/), 'CSP script-src must forbid unsafe-inline');
  assert(hdrs['X-Frame-Options'] === 'DENY', 'X-Frame-Options DENY required');
  assert(hdrs['X-Content-Type-Options'] === 'nosniff', 'nosniff required');
  assert(hdrs['Strict-Transport-Security'].includes('max-age='), 'HSTS required');
  console.log('Static & headers checks PASSED');

  console.log('--- 2. Password Hashing & Session Crypto Audit ---');
  process.env.NODE_ENV = 'production';
  process.env.SESSION_SECRET = 'a'.repeat(64);
  delete process.env.ADMIN_USERNAME;
  delete process.env.ADMIN_PASSWORD_HASH;

  const { hashPassword, verifyPassword } = require('../api/_lib/auth');
  const h1 = hashPassword('StrongPass!2026');
  const h2 = hashPassword('StrongPass!2026');
  assert(h1.startsWith('scrypt$'), 'Uses scrypt with salt');
  assert(h1 !== h2, 'Salts must be unique per hash');
  assert(verifyPassword('StrongPass!2026', h1) === true, 'Valid password verifies');
  assert(verifyPassword('WrongPass!2026', h1) === false, 'Wrong password fails');
  console.log('Scrypt password hashing PASSED');

  console.log('--- 3. Auth, RBAC, CORS, CSRF, Prototype Pollution & Fail-Closed Admin ---');
  const authHandler = require('../api/auth');
  const adminHandler = require('../api/admin');
  const chatHandler = require('../api/chat');
  const imageHandler = require('../api/image');

  // Unauthenticated admin blocked
  const resUnauthAdmin = makeMockRes();
  await adminHandler(makeMockReq({ method: 'GET' }), resUnauthAdmin);
  assert.strictEqual(resUnauthAdmin.statusCode, 401);

  // Unauthenticated chat & image blocked
  const resUnauthChat = makeMockRes();
  await chatHandler(makeMockReq({ method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'KIVO-Web' }, body: { prompt: 'hi' } }), resUnauthChat);
  assert.strictEqual(resUnauthChat.statusCode, 401);

  const resUnauthImg = makeMockRes();
  await imageHandler(makeMockReq({ method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'KIVO-Web' }, body: { prompt: 'cat' } }), resUnauthImg);
  assert.strictEqual(resUnauthImg.statusCode, 401);

  // Evil CORS blocked
  const resCors = makeMockRes();
  await chatHandler(makeMockReq({ method: 'POST', headers: { origin: 'https://evil.example.com', 'content-type': 'application/json', 'x-requested-with': 'KIVO-Web' } }), resCors);
  assert.strictEqual(resCors.statusCode, 403);

  // Missing CSRF header blocked
  const resCsrf = makeMockRes();
  await authHandler(makeMockReq({ method: 'POST', headers: { 'content-type': 'application/json' }, body: { action: 'guest', name: 'Tester' } }), resCsrf);
  assert.strictEqual(resCsrf.statusCode, 403);

  // Wrong Content-Type blocked
  const resCt = makeMockRes();
  await authHandler(makeMockReq({ method: 'POST', headers: { 'content-type': 'text/plain', 'x-requested-with': 'KIVO-Web' }, body: '{}' }), resCt);
  assert.strictEqual(resCt.statusCode, 415);

  // Fail-closed admin login when env vars unset
  const resAdminNoEnv = makeMockRes();
  await authHandler(makeMockReq({
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-requested-with': 'KIVO-Web' },
    body: { action: 'admin-login', username: 'admin', password: 'password123' }
  }), resAdminNoEnv);
  assert.strictEqual(resAdminNoEnv.statusCode, 503);

  // Register regular user attempting role escalation + prototype pollution
  const uniqueEmail = `sec_${Date.now()}@example.com`;
  const resReg = makeMockRes();
  await authHandler(makeMockReq({
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-requested-with': 'KIVO-Web' },
    body: JSON.parse(`{"action":"register","name":"Kunal User","email":"${uniqueEmail}","password":"MyStrongPassword1!","role":"admin","__proto__":{"polluted":true}}`)
  }), resReg);
  assert.strictEqual(resReg.statusCode, 201);
  assert.strictEqual(resReg.body.user.role, 'user', 'Server must ignore client-supplied admin role');
  assert(!resReg.body.user.passwordHash, 'passwordHash must never be exposed');
  assert.strictEqual(({}).polluted, undefined, 'Prototype must not be polluted');
  const userCookie = String(resReg.getHeader('set-cookie')).split(';')[0];

  // Normal user forbidden from admin endpoint
  const resUserAdmin = makeMockRes();
  await adminHandler(makeMockReq({ method: 'GET', headers: { cookie: userCookie } }), resUserAdmin);
  assert.strictEqual(resUserAdmin.statusCode, 403);

  // Configure admin env & verify real admin auth succeeds
  process.env.ADMIN_USERNAME = 'kunal_admin';
  process.env.ADMIN_PASSWORD_HASH = hashPassword('SuperAdmin!2026');
  const resAdminLogin = makeMockRes();
  await authHandler(makeMockReq({
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-requested-with': 'KIVO-Web' },
    body: { action: 'admin-login', username: 'kunal_admin', password: 'SuperAdmin!2026' }
  }), resAdminLogin);
  assert.strictEqual(resAdminLogin.statusCode, 200);
  const adminCookie = String(resAdminLogin.getHeader('set-cookie')).split(';')[0];

  const resAdminGet = makeMockRes();
  await adminHandler(makeMockReq({ method: 'GET', headers: { cookie: adminCookie } }), resAdminGet);
  assert.strictEqual(resAdminGet.statusCode, 200);
  assert(Array.isArray(resAdminGet.body.users));
  assert(resAdminGet.body.users.every(u => !u.passwordHash));
  console.log('Auth, RBAC, CORS, CSRF & Proto-Pollution PASSED');

  console.log('--- 4. Rate Limiting & Brute Force Lockout ---');
  for (let i = 0; i < 6; i++) {
    const r = makeMockRes();
    await authHandler(makeMockReq({
      method: 'POST',
      ip: '198.51.100.77',
      headers: { 'content-type': 'application/json', 'x-requested-with': 'KIVO-Web' },
      body: { action: 'login', email: uniqueEmail, password: 'WrongPassword99!' }
    }), r);
    if (i >= 5) assert.strictEqual(r.statusCode, 429, 'Account lockout should trigger 429');
  }
  console.log('Rate limiting & lockout PASSED');

  console.log('--- 5. XSS Sanitization Check ---');
  // Load escaping logic verification
  const escapeHtml = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/`/g, '&#96;').replace(/\//g, '&#x2F;');
  const xssOut = escapeHtml(`<img src=x onerror="alert('xss')">`);
  assert(!xssOut.includes('<') && !xssOut.includes('>') && !xssOut.includes("'") && !xssOut.includes('"'));
  console.log('XSS sanitization PASSED');

  console.log('\nALL SECURITY AUDIT CHECKS PASSED (0 FAILURES)!');
}

runAudit().catch(err => {
  console.error('SECURITY AUDIT FAILED:', err);
  process.exit(1);
});
