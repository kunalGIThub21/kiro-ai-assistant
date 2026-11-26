const crypto = require('crypto');
const { handleCorsAndMethod, readJsonBody, sendError } = require('./_lib/security');
const { checkRateLimit, getLockoutState, recordAuthFailure, clearAuthFailures } = require('./_lib/rateLimit');
const { validateName, validateEmail, validatePassword } = require('./_lib/validate');
const {
  hashPassword,
  verifyPassword,
  signSessionToken,
  getSessionFromRequest,
  setSessionCookie,
  clearSessionCookie,
  getSessionSecret
} = require('./_lib/auth');
const { getUserByEmail, saveUser, toSafePublicUser } = require('./_lib/store');

function safeTimingEqualStr(a, b) {
  const bufA = Buffer.from(String(a), 'utf8');
  const bufB = Buffer.from(String(b), 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

module.exports = async function handler(req, res) {
  if (!handleCorsAndMethod(req, res, ['GET', 'POST'])) return;

  // Session inspection endpoint
  if (req.method === 'GET') {
    const allowed = await checkRateLimit(req, res, { scope: 'auth_me', max: 60, windowMs: 60_000 });
    if (!allowed) return;
    const session = getSessionFromRequest(req);
    if (!session) {
      return res.status(200).json({ authenticated: false, user: null });
    }
    return res.status(200).json({
      authenticated: true,
      user: {
        id: session.sub,
        name: session.name,
        email: session.email,
        role: session.role
      }
    });
  }

  // Strict rate limit for auth mutations (10 per 15 minutes per IP)
  const allowed = await checkRateLimit(req, res, { scope: 'auth_post', max: 20, windowMs: 15 * 60_000 });
  if (!allowed) return;

  let body;
  try {
    body = await readJsonBody(req, 32 * 1024);
  } catch (err) {
    return sendError(res, err.statusCode || 400, err.statusCode === 413 ? 'Payload too large.' : 'Invalid request payload.', err);
  }

  const action = String(body?.action || '').trim();

  if (action === 'logout') {
    clearSessionCookie(req, res);
    return res.status(200).json({ ok: true });
  }

  // Ensure server signing secret is configured before issuing sessions
  if (!getSessionSecret()) {
    return sendError(res, 503, 'Authentication service is not configured on the server (missing SESSION_SECRET).');
  }

  if (action === 'guest') {
    const nameCheck = validateName(body?.name);
    if (!nameCheck.ok) {
      return sendError(res, 400, nameCheck.error);
    }
    const guestId = `guest_${crypto.randomBytes(8).toString('hex')}`;
    const guestUser = {
      id: guestId,
      name: nameCheck.value,
      email: `${guestId}@guest.kivo.local`,
      role: 'guest'
    };
    const token = signSessionToken(guestUser);
    setSessionCookie(req, res, token);
    return res.status(200).json({ authenticated: true, user: guestUser });
  }

  if (action === 'register') {
    const nameCheck = validateName(body?.name);
    if (!nameCheck.ok) return sendError(res, 400, nameCheck.error);

    const emailCheck = validateEmail(body?.email);
    if (!emailCheck.ok) return sendError(res, 400, emailCheck.error);

    const passCheck = validatePassword(body?.password);
    if (!passCheck.ok) return sendError(res, 400, passCheck.error);

    try {
      const existing = await getUserByEmail(emailCheck.value);
      if (existing) {
        return sendError(res, 409, 'An account with this email already exists.');
      }

      const userRecord = {
        id: `usr_${crypto.randomBytes(10).toString('hex')}`,
        name: nameCheck.value,
        email: emailCheck.value,
        passwordHash: hashPassword(passCheck.value),
        role: 'user', // Role escalation impossible: server strictly assigns 'user'
        chatsCount: 0,
        imagesCount: 0,
        createdAt: new Date().toISOString(),
        lastActive: new Date().toISOString()
      };

      const safeUser = await saveUser(userRecord);
      const token = signSessionToken(safeUser);
      setSessionCookie(req, res, token);
      return res.status(201).json({ authenticated: true, user: safeUser });
    } catch (err) {
      return sendError(res, 500, 'Unable to complete registration right now.', err);
    }
  }

  if (action === 'login') {
    const emailCheck = validateEmail(body?.email);
    if (!emailCheck.ok) return sendError(res, 400, 'Invalid email or password.');

    const lockout = getLockoutState(req, emailCheck.value);
    if (lockout.locked) {
      res.setHeader('Retry-After', String(lockout.retryAfterSec));
      return sendError(res, 429, `Account temporarily locked due to failed attempts. Retry in ${lockout.retryAfterSec}s.`);
    }

    if (typeof body?.password !== 'string' || !body.password || body.password.length > 128) {
      recordAuthFailure(req, emailCheck.value);
      return sendError(res, 401, 'Invalid email or password.');
    }

    try {
      const userRecord = await getUserByEmail(emailCheck.value);
      // Verify password or run dummy scrypt to prevent timing enumeration
      const hashToCheck = userRecord?.passwordHash || 'scrypt$00000000000000000000000000000000$' + '0'.repeat(128);
      const valid = verifyPassword(body.password, hashToCheck) && Boolean(userRecord);

      if (!valid) {
        recordAuthFailure(req, emailCheck.value);
        return sendError(res, 401, 'Invalid email or password.');
      }

      clearAuthFailures(req, emailCheck.value);
      userRecord.lastActive = new Date().toISOString();
      const safeUser = await saveUser(userRecord);
      const token = signSessionToken(safeUser);
      setSessionCookie(req, res, token);
      return res.status(200).json({ authenticated: true, user: safeUser });
    } catch (err) {
      return sendError(res, 500, 'Authentication error occurred.', err);
    }
  }

  if (action === 'admin-login') {
    const adminUser = (process.env.ADMIN_USERNAME || '').trim();
    const adminHash = (process.env.ADMIN_PASSWORD_HASH || '').trim();

    // Fail closed if admin credentials are not configured in server environment
    if (!adminUser || !adminHash) {
      return sendError(res, 503, 'Admin authentication is disabled until ADMIN_USERNAME and ADMIN_PASSWORD_HASH are configured on the server.');
    }

    const submittedUser = String(body?.username || '').trim();
    const submittedPass = String(body?.password || '');

    const lockout = getLockoutState(req, `admin:${submittedUser}`);
    if (lockout.locked) {
      res.setHeader('Retry-After', String(lockout.retryAfterSec));
      return sendError(res, 429, `Too many failed admin login attempts. Retry in ${lockout.retryAfterSec}s.`);
    }

    const userOk = safeTimingEqualStr(submittedUser.toLowerCase(), adminUser.toLowerCase());
    const passOk = verifyPassword(submittedPass, adminHash);

    if (!userOk || !passOk) {
      recordAuthFailure(req, `admin:${submittedUser}`);
      return sendError(res, 401, 'Invalid administrator credentials.');
    }

    clearAuthFailures(req, `admin:${submittedUser}`);
    const adminSessionUser = {
      id: 'admin_root',
      name: adminUser,
      email: `${adminUser}@admin.kivo.local`,
      role: 'admin'
    };
    const token = signSessionToken(adminSessionUser);
    setSessionCookie(req, res, token);
    return res.status(200).json({ authenticated: true, user: toSafePublicUser(adminSessionUser) });
  }

  return sendError(res, 400, 'Unsupported authentication action.');
};
