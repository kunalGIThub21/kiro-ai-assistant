const { handleCorsAndMethod } = require('./_lib/security');
const { checkRateLimit } = require('./_lib/rateLimit');

module.exports = async function handler(req, res) {
  if (!handleCorsAndMethod(req, res, ['GET'])) return;
  const allowed = await checkRateLimit(req, res, { scope: 'health', max: 60, windowMs: 60_000 });
  if (!allowed) return;
  return res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
};
