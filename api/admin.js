const { handleCorsAndMethod, sendError } = require('./_lib/security');
const { checkRateLimit } = require('./_lib/rateLimit');
const { requireAdmin, getSessionSecret } = require('./_lib/auth');
const { listAllSafeUsers } = require('./_lib/store');

module.exports = async function handler(req, res) {
  if (!handleCorsAndMethod(req, res, ['GET'])) return;

  const adminSession = requireAdmin(req, res);
  if (!adminSession) return;

  const allowed = await checkRateLimit(req, res, {
    scope: 'admin',
    max: 30,
    windowMs: 60_000,
    identifier: adminSession.sub
  });
  if (!allowed) return;

  try {
    const users = await listAllSafeUsers();
    return res.status(200).json({
      admin: {
        name: adminSession.name,
        role: adminSession.role
      },
      stats: {
        totalUsers: users.length,
        activeModel: 'Gemini 3.5 Flash Lite',
        imageEngine: 'FLUX / Pollinations Proxy'
      },
      envHealth: {
        geminiConfigured: Boolean((process.env.GEMINI_API_KEY || '').trim()),
        sessionSecretConfigured: Boolean(getSessionSecret()),
        adminCredentialsConfigured: Boolean(process.env.ADMIN_USERNAME && process.env.ADMIN_PASSWORD_HASH),
        persistentKvConfigured: Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN)
      },
      users
    });
  } catch (err) {
    return sendError(res, 500, 'Unable to load admin telemetry.', err);
  }
};
