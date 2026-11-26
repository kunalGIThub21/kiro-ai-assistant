const BLOCKED_DOMAINS = new Set([
  'tempmail.com', '10minutemail.com', 'mailinator.com', 'guerrillamail.com',
  'trashmail.com', 'yopmail.com', 'dispostable.com', 'sharklasers.com',
  'getnada.com', 'fakeinbox.com', 'temp-mail.org', 'mohmal.com'
]);

const ALLOWED_PERSONAS = new Set(['default', 'architect', 'visionary', 'executive']);
const ALLOWED_TIERS = new Set(['fast', 'pro', 'ultimate']);
const ALLOWED_RATIOS = new Set(['1:1', '16:9', '9:16']);
const ALLOWED_STYLES = new Set(['natural', 'photoreal', 'anime', '3d-pixar', 'cyberpunk']);
const ALLOWED_IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

function stripControlChars(str, preserveNewlines = false) {
  if (typeof str !== 'string') return '';
  if (preserveNewlines) {
    return str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  }
  return str.replace(/[\x00-\x1F\x7F]/g, '');
}

function validateName(raw) {
  const cleaned = stripControlChars(String(raw || '')).trim().replace(/\s+/g, ' ');
  if (cleaned.length < 2 || cleaned.length > 40) {
    return { ok: false, error: 'Name must be between 2 and 40 characters.' };
  }
  if (cleaned.toLowerCase() === 'friend' || cleaned.toLowerCase() === 'admin') {
    return { ok: false, error: 'Please enter your real name or chosen display handle.' };
  }
  if (!/^[\p{L}\p{N} ._-]+$/u.test(cleaned)) {
    return { ok: false, error: 'Name contains unsupported characters.' };
  }
  return { ok: true, value: cleaned };
}

function validateEmail(raw) {
  const email = stripControlChars(String(raw || '')).trim().toLowerCase();
  if (!email || email.length > 254 || !/^[^\s@<>()[\]\\,;:"']+@[^\s@<>()[\]\\,;:"']+\.[^\s@<>()[\]\\,;:"']{2,}$/.test(email)) {
    return { ok: false, error: 'Please provide a valid email address.' };
  }
  const domain = email.split('@')[1];
  if (BLOCKED_DOMAINS.has(domain)) {
    return { ok: false, error: 'Disposable email domains are not permitted.' };
  }
  return { ok: true, value: email };
}

function validatePassword(raw) {
  if (typeof raw !== 'string') {
    return { ok: false, error: 'Password is required.' };
  }
  if (raw.length < 8 || raw.length > 128) {
    return { ok: false, error: 'Password must be between 8 and 128 characters.' };
  }
  if (!/[A-Za-z]/.test(raw) || !/[0-9!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(raw)) {
    return { ok: false, error: 'Password must include at least one letter and one number or symbol.' };
  }
  return { ok: true, value: raw };
}

function validateChatInput(body) {
  const prompt = stripControlChars(body?.prompt, true).trim();
  if (!prompt || prompt.length > 8000) {
    return { ok: false, error: 'Prompt must be between 1 and 8000 characters.' };
  }

  const hinglish = Boolean(body?.hinglish);
  const coding = Boolean(body?.coding);
  const persona = ALLOWED_PERSONAS.has(body?.persona) ? body.persona : 'default';
  const tier = ALLOWED_TIERS.has(body?.tier) ? body.tier : 'pro';
  const customInstructions = stripControlChars(body?.customInstructions || '', true).trim().slice(0, 500);

  const history = [];
  if (Array.isArray(body?.history)) {
    for (const item of body.history.slice(-10)) {
      if (!item || typeof item !== 'object') continue;
      const sender = item.sender === 'user' ? 'user' : (item.sender === 'bot' ? 'bot' : null);
      if (!sender) continue;
      const text = stripControlChars(item.text, true).trim().slice(0, 6000);
      if (!text) continue;
      history.push({ sender, text });
    }
  }

  let attachedImage = null;
  if (body?.attachedImage && typeof body.attachedImage === 'object') {
    const mimeType = String(body.attachedImage.mimeType || '').toLowerCase();
    const data = String(body.attachedImage.data || '').trim();
    if (!ALLOWED_IMAGE_MIMES.has(mimeType)) {
      return { ok: false, error: 'Unsupported image MIME type. Use JPEG, PNG, WebP, or GIF.' };
    }
    if (!/^[A-Za-z0-9+/=]+$/.test(data) || data.length > 4 * 1024 * 1024) {
      return { ok: false, error: 'Invalid or oversized image attachment (max 3MB binary).' };
    }
    attachedImage = { mimeType, data };
  }

  return {
    ok: true,
    value: { prompt, hinglish, coding, persona, tier, customInstructions, history, attachedImage }
  };
}

function validateImageInput(body) {
  const prompt = stripControlChars(body?.prompt, false).trim();
  if (!prompt || prompt.length > 500) {
    return { ok: false, error: 'Image prompt must be between 1 and 500 characters.' };
  }
  const ratio = ALLOWED_RATIOS.has(body?.ratio) ? body.ratio : '1:1';
  const style = ALLOWED_STYLES.has(body?.style) ? body.style : 'natural';
  return { ok: true, value: { prompt, ratio, style } };
}

module.exports = {
  validateName,
  validateEmail,
  validatePassword,
  validateChatInput,
  validateImageInput
};
