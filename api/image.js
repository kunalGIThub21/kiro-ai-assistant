const crypto = require('crypto');
const { handleCorsAndMethod, readJsonBody, sendError } = require('./_lib/security');
const { checkRateLimit } = require('./_lib/rateLimit');
const { requireAuth } = require('./_lib/auth');
const { validateImageInput } = require('./_lib/validate');
const { incrementUserStat } = require('./_lib/store');

const DICT = {
  billi: 'cat', billiya: 'cats', kutta: 'dog', kutte: 'dogs',
  sher: 'lion', baagh: 'tiger', haathi: 'elephant', ghoda: 'horse',
  chidiya: 'bird', gaadi: 'car', gadi: 'car', chashma: 'sunglasses',
  raat: 'night', barish: 'rain', pahad: 'mountains', samundar: 'ocean',
  ladka: 'boy', ladki: 'girl', bachha: 'child', suraj: 'sun',
  chand: 'moon', chandrama: 'moon', tare: 'stars', dost: 'friends',
  mandir: 'temple', gaon: 'village', shehar: 'city', khoobsurat: 'beautiful',
  mast: 'stunning', bada: 'huge', chota: 'cute little'
};

function enhancePrompt(raw, style) {
  let prompt = raw
    .replace(/^\s*(\/image|\/img|\/art)\s*/i, '')
    .replace(/^\s*(please\s+)?(can you\s+)?(generate|create|make|draw|paint|render|show me|dikhao|banao|bana do|bana de|chahiye)\s+/i, '')
    .replace(/\s+(ki\s+)?(photo|image|pic|tasveer|wallpaper|drawing)\s+(banao|bana do|bana de|karo|chahiye|dikhao)$/i, '')
    .replace(/\s+(banao|bana do|bana de|banaiye|karo|dikhao)$/i, '')
    .replace(/^(ek|a|an)\s+/i, '')
    .replace(/\s+(ki|ka|ke)\s+/gi, ' ');

  for (const [hi, en] of Object.entries(DICT)) {
    prompt = prompt.replace(new RegExp(`\\b${hi}\\b`, 'gi'), en);
  }
  prompt = prompt.replace(/\s+/g, ' ').trim() || 'A stunning futuristic cyberpunk city with neon reflections';

  const suffixes = {
    photoreal: ', photorealistic, 8k resolution, highly detailed, dramatic studio lighting, sharp focus',
    anime: ', anime aesthetic, vibrant colors, detailed illustration, masterpiece',
    '3d-pixar': ', 3D animated render style, smooth textures, warm lighting, vibrant colors, 8k',
    cyberpunk: ', futuristic cyberpunk, glowing neon lights, rain reflections, atmospheric, 8k',
    natural: ', high quality, highly detailed, sharp focus, vibrant colors'
  };

  return prompt + (suffixes[style] || suffixes.natural);
}

module.exports = async function handler(req, res) {
  if (!handleCorsAndMethod(req, res, ['POST'])) return;

  const session = requireAuth(req, res);
  if (!session) return;

  const allowed = await checkRateLimit(req, res, {
    scope: 'image',
    max: 8,
    windowMs: 60_000,
    identifier: session.sub
  });
  if (!allowed) return;

  let body;
  try {
    body = await readJsonBody(req, 16 * 1024);
  } catch (err) {
    return sendError(res, err.statusCode || 400, 'Invalid request payload.', err);
  }

  const parsed = validateImageInput(body);
  if (!parsed.ok) {
    return sendError(res, 400, parsed.error);
  }

  const { prompt, ratio, style } = parsed.value;
  let width = 1024;
  let height = 1024;
  if (ratio === '16:9') { width = 1280; height = 720; }
  else if (ratio === '9:16') { width = 720; height = 1280; }

  const seed = crypto.randomInt(100000, 999999);
  const enhancedPrompt = enhancePrompt(prompt, style);
  const targetUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(enhancedPrompt)}?width=${width}&height=${height}&nologo=true&seed=${seed}`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    const upstream = await fetch(targetUrl, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (upstream.status === 402 || upstream.status === 429) {
      return sendError(res, 429, 'Image synthesis service is cooling down. Please retry in a few seconds.');
    }
    if (!upstream.ok) {
      return sendError(res, 502, 'Image synthesis service is temporarily unavailable.');
    }

    const contentType = String(upstream.headers.get('content-type') || '').toLowerCase();
    if (!contentType.startsWith('image/')) {
      return sendError(res, 502, 'Invalid upstream media type received.');
    }

    const arrayBuf = await upstream.arrayBuffer();
    if (arrayBuf.byteLength > 8 * 1024 * 1024) {
      return sendError(res, 502, 'Generated image exceeded safe size limit.');
    }

    if (session.role !== 'guest') {
      await incrementUserStat(session.email, 'imagesCount').catch(() => {});
    }

    const base64 = Buffer.from(arrayBuf).toString('base64');
    return res.status(200).json({
      dataUrl: `data:${contentType.split(';')[0]};base64,${base64}`,
      width,
      height,
      ratio,
      seed
    });
  } catch (err) {
    return sendError(res, 504, 'Image synthesis timed out. Please try again.', err);
  }
};
