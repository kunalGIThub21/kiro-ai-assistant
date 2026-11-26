import * as THREE from './vendor/three.module.js';

const RATIO_OPTIONS = ['1:1', '16:9', '9:16'];
const STYLE_OPTIONS = [
  { id: 'natural', label: 'Natural' },
  { id: 'photoreal', label: 'Photoreal' },
  { id: 'anime', label: 'Anime' },
  { id: '3d-pixar', label: '3D Pixar' },
  { id: 'cyberpunk', label: 'Cyberpunk' }
];
const ALLOWED_PERSONAS = new Set(['default', 'architect', 'visionary', 'executive']);
const SAFE_ID_RE = /^[a-zA-Z0-9_-]{3,64}$/;

let currentUser = null;
let currentTier = 'pro';
let isThinking = false;
let currentTypewriterTimer = null;
let activeChatId = null;
let selectedChatItemId = null;
let currentAttachedImage = null;
let isHinglishActive = localStorage.getItem('kivo_hinglish_mode') === 'true';
let isCodingActive = localStorage.getItem('kivo_coding_mode') === 'true';
let activeImageRatio = RATIO_OPTIONS.includes(localStorage.getItem('kivo_image_ratio'))
  ? localStorage.getItem('kivo_image_ratio')
  : '1:1';
let activeImageStyle = STYLE_OPTIONS.some(s => s.id === localStorage.getItem('kivo_image_style'))
  ? localStorage.getItem('kivo_image_style')
  : 'natural';
let kivoUpdateParticleColors = null;
let activeSpeechRecognition = null;
let isRecordingVoice = false;
let lastSubmitAt = 0;

function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/`/g, '&#96;')
    .replace(/\//g, '&#x2F;');
}

function sanitizeUrl(rawUrl) {
  if (typeof rawUrl !== 'string') return '';
  const trimmed = rawUrl.trim();
  if (!trimmed) return '';
  if (/^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+$/i.test(trimmed)) {
    return trimmed;
  }
  try {
    const parsed = new URL(trimmed, window.location.origin);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:' || parsed.protocol === 'blob:') {
      return parsed.href;
    }
  } catch {
    return '';
  }
  return '';
}

async function apiRequest(endpoint, { method = 'GET', body = null, extraHeaders = {} } = {}) {
  const headers = {
    'X-Requested-With': 'KIVO-Web',
    ...extraHeaders
  };
  const opts = {
    method,
    credentials: 'same-origin',
    headers
  };
  if (body !== null) {
    headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(endpoint, opts);
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    const msg = (data && typeof data.error === 'string') ? data.error : 'Request could not be completed.';
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return data;
}

function getUserChatsStorageKey() {
  const uid = currentUser && SAFE_ID_RE.test(currentUser.id) ? currentUser.id : 'anon';
  return `kivo_v2_chats_${uid}`;
}

function getMsgStorageKey(chatId) {
  const uid = currentUser && SAFE_ID_RE.test(currentUser.id) ? currentUser.id : 'anon';
  const cid = String(chatId || '');
  if (!SAFE_ID_RE.test(cid)) return null;
  return `kivo_v2_msgs_${uid}_${cid}`;
}

function safeJsonParse(raw, fallback) {
  try {
    const parsed = JSON.parse(raw);
    return parsed !== null && parsed !== undefined ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function showAuthError(msg) {
  const el = document.getElementById('auth-error-msg');
  if (!el) return;
  if (!msg) {
    el.textContent = '';
    el.classList.add('hidden');
    return;
  }
  el.textContent = msg;
  el.classList.remove('hidden');
}

function switchAuthTab(tab) {
  showAuthError('');
  const forms = {
    guest: document.getElementById('guest-auth-form'),
    login: document.getElementById('login-auth-form'),
    register: document.getElementById('register-auth-form'),
    admin: document.getElementById('admin-auth-form')
  };
  const tabs = {
    guest: document.getElementById('tab-auth-guest'),
    login: document.getElementById('tab-auth-login'),
    register: document.getElementById('tab-auth-register')
  };
  Object.entries(forms).forEach(([k, form]) => {
    if (form) form.classList.toggle('hidden', k !== tab);
  });
  Object.entries(tabs).forEach(([k, btn]) => {
    if (!btn) return;
    if (k === tab) {
      btn.className = 'py-1.5 rounded-xl bg-white/15 text-white transition';
    } else {
      btn.className = 'py-1.5 rounded-xl text-[#8e918f] hover:text-white transition';
    }
  });
}

function showAuthScreen() {
  const screen = document.getElementById('auth-screen');
  if (screen) screen.classList.remove('hidden');
  switchAuthTab('guest');
}

function unlockAppForUser(user) {
  if (!user || !user.id || !user.name) {
    showAuthScreen();
    return;
  }
  currentUser = user;
  document.getElementById('auth-screen').classList.add('hidden');
  const initial = user.name.trim().charAt(0).toUpperCase() || 'U';
  document.getElementById('user-avatar-initial').textContent = initial;
  document.getElementById('user-name-label').textContent = user.name;

  const greetingEl = document.getElementById('greeting-username');
  if (greetingEl) {
    greetingEl.textContent = user.name.split(' ')[0] || user.name;
  }
  document.getElementById('dropdown-user-email').textContent = user.email || '';

  const roleBadge = document.getElementById('dropdown-user-role');
  if (roleBadge) roleBadge.textContent = user.role || 'guest';

  const adminBtn = document.getElementById('btn-open-admin');
  if (adminBtn) {
    adminBtn.classList.toggle('hidden', user.role !== 'admin');
  }

  loadUserPrivateChats();
}

async function restoreServerSession() {
  try {
    const data = await apiRequest('/api/auth', { method: 'GET' });
    if (data && data.authenticated && data.user) {
      unlockAppForUser(data.user);
      return;
    }
  } catch {
    // Fall through to login modal
  }
  showAuthScreen();
}

async function handleSignOut() {
  try {
    await apiRequest('/api/auth', { method: 'POST', body: { action: 'logout' } });
  } catch {
    // Always clear client view even on network blip
  }
  currentUser = null;
  activeChatId = null;
  sessionStorage.removeItem('kivo_personal_api_key');
  document.getElementById('user-dropdown').classList.add('hidden');
  const adminBtn = document.getElementById('btn-open-admin');
  if (adminBtn) adminBtn.classList.add('hidden');
  startNewChat();
  showAuthScreen();
}

function toggleSidebar() {
  const sb = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  const triggerGroup = document.getElementById('header-sidebar-trigger-group');

  if (window.innerWidth < 768) {
    sb.classList.toggle('max-md:-translate-x-full');
    overlay.classList.toggle('hidden');
  } else {
    const isHidden = sb.classList.toggle('hidden');
    if (triggerGroup) {
      triggerGroup.classList.toggle('md:hidden', !isHidden);
    }
  }
}

function selectModelTier(tier, displayName) {
  currentTier = tier;
  document.getElementById('active-model-name').textContent = displayName;
  document.getElementById('user-tier-label').textContent = `KIVO ${displayName}`;
  document.getElementById('model-dropdown-menu').classList.add('hidden');
}

function saveChatHistory(firstPrompt) {
  if (!activeChatId || !SAFE_ID_RE.test(activeChatId)) {
    activeChatId = 'chat_' + Date.now();
  }
  const key = getUserChatsStorageKey();
  const chats = safeJsonParse(localStorage.getItem(key) || '[]', []);
  const list = Array.isArray(chats) ? chats : [];
  const rawTitle = String(firstPrompt || 'Conversation').trim();
  const title = rawTitle.length > 34 ? rawTitle.substring(0, 34) + '...' : rawTitle;
  if (!list.find(c => String(c.id) === String(activeChatId))) {
    list.unshift({ id: activeChatId, title, pinned: false, createdAt: Date.now() });
    localStorage.setItem(key, JSON.stringify(list.slice(0, 50)));
  }
  loadUserPrivateChats();
}

function saveMessageToActiveChat(msgObj) {
  const key = getMsgStorageKey(activeChatId);
  if (!key) return;
  try {
    const msgs = safeJsonParse(localStorage.getItem(key) || '[]', []);
    if (!Array.isArray(msgs)) return;
    msgs.push(msgObj);
    localStorage.setItem(key, JSON.stringify(msgs.slice(-100)));
  } catch {
    // Storage quota exceeded - fail cleanly
  }
}

function openConversation(id) {
  const safeId = String(id || '');
  if (!SAFE_ID_RE.test(safeId)) return;

  if (currentTypewriterTimer) {
    clearInterval(currentTypewriterTimer);
    currentTypewriterTimer = null;
  }

  activeChatId = safeId;
  loadUserPrivateChats();

  document.getElementById('gemini-greeting')?.classList.add('hidden');
  const messagesListEl = document.getElementById('messages-list');
  if (messagesListEl) {
    messagesListEl.classList.remove('hidden');
    messagesListEl.textContent = '';
  }
  document.getElementById('bottom-dock')?.classList.remove('hidden');

  const key = getMsgStorageKey(safeId);
  const msgs = key ? safeJsonParse(localStorage.getItem(key) || '[]', []) : [];
  if (Array.isArray(msgs)) {
    msgs.forEach(msg => {
      if (!msg || typeof msg !== 'object') return;
      if (msg.sender === 'user') {
        appendUserMessage(String(msg.text || ''), msg.image || null, true);
      } else if (msg.sender === 'bot') {
        if (msg.isImage) {
          renderSavedImageCard(msg.imageUrl, msg.prompt);
        } else {
          renderSavedBotMessage(String(msg.text || ''));
        }
      }
    });
  }
  scrollDownSmooth();

  if (window.innerWidth < 768) {
    const sb = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    if (sb && !sb.classList.contains('max-md:-translate-x-full')) {
      sb.classList.add('max-md:-translate-x-full');
      if (overlay) overlay.classList.add('hidden');
    }
  }
}

function loadUserPrivateChats() {
  const list = document.getElementById('recent-chats-list');
  if (!list) return;
  list.textContent = '';

  const chats = safeJsonParse(localStorage.getItem(getUserChatsStorageKey()) || '[]', []);
  if (!Array.isArray(chats) || chats.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'text-center text-[11px] text-[#8e918f] py-4';
    empty.textContent = 'No recent chats';
    list.appendChild(empty);
    return;
  }

  chats.forEach(chat => {
    if (!chat || !SAFE_ID_RE.test(String(chat.id || ''))) return;
    const isActive = String(chat.id) === String(activeChatId);
    const item = document.createElement('div');
    item.className = `group relative flex items-center justify-between px-3 py-2 rounded-xl text-xs cursor-pointer transition-all ${
      isActive
        ? 'bg-white/15 text-white font-semibold border-l-2 border-cyan-400 pl-2.5 shadow-sm'
        : 'hover:bg-white/5 text-[#c4c7c5] hover:text-white'
    }`;

    const titleBtn = document.createElement('div');
    titleBtn.className = 'flex items-center gap-2 truncate flex-1 pr-2';
    titleBtn.addEventListener('click', () => openConversation(String(chat.id)));

    if (chat.pinned) {
      const pinBadge = document.createElement('span');
      pinBadge.className = 'text-amber-400 shrink-0 text-[10px]';
      pinBadge.textContent = '📌';
      titleBtn.appendChild(pinBadge);
    }
    const span = document.createElement('span');
    span.className = 'truncate';
    span.textContent = String(chat.title || 'Conversation');
    titleBtn.appendChild(span);

    const menuBtn = document.createElement('button');
    menuBtn.type = 'button';
    menuBtn.className = 'opacity-0 group-hover:opacity-100 p-1 hover:bg-white/10 rounded-md text-[#8e918f] hover:text-white transition-opacity';
    menuBtn.textContent = '⋯';
    menuBtn.addEventListener('click', e => openChatPopover(e, String(chat.id)));

    item.appendChild(titleBtn);
    item.appendChild(menuBtn);
    list.appendChild(item);
  });
}

function openChatPopover(e, id) {
  e.stopPropagation();
  if (!SAFE_ID_RE.test(String(id))) return;
  selectedChatItemId = String(id);
  const popover = document.getElementById('chat-item-popover');
  const rect = e.currentTarget.getBoundingClientRect();
  popover.style.top = `${Math.min(rect.top, window.innerHeight - 175)}px`;
  popover.style.left = `${Math.min(rect.right + 8, window.innerWidth - 180)}px`;
  popover.classList.remove('hidden');

  const chats = safeJsonParse(localStorage.getItem(getUserChatsStorageKey()) || '[]', []);
  const target = Array.isArray(chats) ? chats.find(c => String(c.id) === selectedChatItemId) : null;
  document.getElementById('pin-label').textContent = target && target.pinned ? 'Unpin' : 'Pin';
}

function startNewChat() {
  if (currentTypewriterTimer) {
    clearInterval(currentTypewriterTimer);
    currentTypewriterTimer = null;
  }
  activeChatId = null;
  document.getElementById('gemini-greeting')?.classList.remove('hidden');
  const messagesListEl = document.getElementById('messages-list');
  if (messagesListEl) {
    messagesListEl.classList.add('hidden');
    messagesListEl.textContent = '';
  }
  document.getElementById('bottom-dock')?.classList.add('hidden');
  const heroInp = document.getElementById('hero-input');
  const dockInp = document.getElementById('dock-input');
  if (heroInp) heroInp.value = '';
  if (dockInp) dockInp.value = '';
  loadUserPrivateChats();
  if (heroInp && !document.getElementById('auth-screen')?.classList.contains('hidden')) return;
  if (heroInp) heroInp.focus();
}

function formatMarkdown(s) {
  const codeBlocks = [];
  const rawStr = String(s || '');

  // Isolate fenced code blocks BEFORE any inline formatting or newline conversion
  const tokenized = rawStr.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const idx = codeBlocks.length;
    const safeLang = escapeHtml((lang || 'code').trim().slice(0, 24) || 'code');
    const safeCode = escapeHtml(code.trim());
    const uniqueId = `code-${idx}-${Math.random().toString(36).slice(2, 7)}`;
    codeBlocks.push(
      `<div class="my-3 rounded-2xl overflow-hidden border border-white/10 bg-[#0d0e10] shadow-xl text-left">` +
      `<div class="flex items-center justify-between px-3.5 py-1.5 bg-[#191a1d] border-b border-white/5 text-[11px] font-mono text-gray-400">` +
      `<span class="font-semibold text-cyan-400 uppercase tracking-wider">${safeLang}</span>` +
      `<button type="button" data-copy-code="${uniqueId}" class="btn-copy-code flex items-center gap-1.5 px-2 py-1 rounded-lg hover:bg-white/10 text-gray-300 hover:text-white transition">Copy code</button>` +
      `</div><pre id="${uniqueId}" class="p-3.5 text-xs font-mono text-emerald-300 overflow-x-auto custom-scroll whitespace-pre"><code>${safeCode}</code></pre></div>`
    );
    return `@@KIVO_CODE_${idx}@@`;
  });

  let h = escapeHtml(tokenized);

  // Safe links [label](url)
  h = h.replace(/\[([^\]]{1,120})\]\(([^)\s]{1,500})\)/g, (_, label, url) => {
    const decodedUrl = url.replace(/&#x2F;/g, '/').replace(/&amp;/g, '&');
    const safe = sanitizeUrl(decodedUrl);
    if (!safe) return label;
    return `<a href="${escapeHtml(safe)}" target="_blank" rel="noopener noreferrer nofollow" class="text-cyan-400 underline hover:text-cyan-300">${label}</a>`;
  });

  h = h.replace(/&#96;([^&#96;\n]+)&#96;/g, '<code class="px-1.5 py-0.5 rounded-md bg-white/10 text-cyan-300 font-mono text-xs border border-white/5">$1</code>');
  h = h.replace(/^### (.*$)/gim, '<h3 class="text-base font-bold text-white mt-3 mb-1">$1</h3>');
  h = h.replace(/^## (.*$)/gim, '<h2 class="text-lg font-bold text-white mt-4 mb-1.5">$1</h2>');
  h = h.replace(/^# (.*$)/gim, '<h1 class="text-xl font-extrabold text-white mt-5 mb-2">$1</h1>');
  h = h.replace(/\*\*(.*?)\*\*/g, '<strong class="font-bold text-white">$1</strong>');
  h = h.replace(/\*(.*?)\*/g, '<em class="text-[#c4c7c5] italic">$1</em>');
  h = h.replace(/^&gt; (.*$)/gim, '<blockquote class="border-l-2 border-blue-500 pl-3 my-2 text-gray-400 italic bg-white/[0.02] py-1 rounded-r">$1</blockquote>');
  h = h.replace(/^\s*[-•*]\s+(.*$)/gim, '<div class="flex items-start gap-2 my-1"><span class="text-blue-400 shrink-0 mt-1">•</span><span>$1</span></div>');
  h = h.replace(/\n\n/g, '<br><br>').replace(/\n/g, '<br>');

  codeBlocks.forEach((block, idx) => {
    h = h.replace(`@@KIVO_CODE_${idx}@@`, block);
  });

  return h;
}

function appendUserMessage(text, attachedImg = null, skipSave = false) {
  const list = document.getElementById('messages-list');
  const wrapper = document.createElement('div');
  wrapper.className = 'flex justify-end';

  const bubble = document.createElement('div');
  bubble.className = 'bg-gradient-to-r from-blue-600/30 to-indigo-600/30 backdrop-blur-md text-[#e3e3e3] rounded-3xl rounded-tr-xs px-5 py-3 max-w-xl text-sm leading-relaxed border border-white/10 font-normal shadow-md';

  if (attachedImg && attachedImg.dataUrl) {
    const safeSrc = sanitizeUrl(attachedImg.dataUrl);
    if (safeSrc) {
      const img = document.createElement('img');
      img.src = safeSrc;
      img.alt = 'Attachment';
      img.className = 'w-48 h-auto max-h-48 object-cover rounded-2xl mb-2 border border-white/10 shadow-md';
      bubble.appendChild(img);
    }
  }

  const textDiv = document.createElement('div');
  textDiv.textContent = text;
  bubble.appendChild(textDiv);
  wrapper.appendChild(bubble);
  list.appendChild(wrapper);
  scrollDown();

  if (!skipSave && activeChatId) {
    saveMessageToActiveChat({
      sender: 'user',
      text,
      image: attachedImg && attachedImg.dataUrl ? { dataUrl: sanitizeUrl(attachedImg.dataUrl) } : null,
      time: Date.now()
    });
  }
}

function appendThinkingSparkle() {
  const id = 'loader-' + Date.now();
  const list = document.getElementById('messages-list');
  const div = document.createElement('div');
  div.id = id;
  div.className = 'flex items-start gap-3.5 max-w-2xl';
  div.innerHTML =
    '<div class="gemini-diamond-star !w-6 !h-6 shrink-0 mt-1 animate-spin"></div>' +
    '<div class="text-sm text-[#8e918f] py-1 flex items-center gap-2"><span>KIVO is thinking...</span></div>';
  list.appendChild(div);
  scrollDown();
  return id;
}

function createBotActionRow(contentId) {
  const row = document.createElement('div');
  row.className = 'flex items-center gap-2 mt-2.5 pt-2 border-t border-white/5 opacity-80 hover:opacity-100 transition-opacity';

  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.className = 'flex items-center gap-1 px-2.5 py-1 text-xs rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white transition';
  copyBtn.textContent = '📋 Copy';
  copyBtn.addEventListener('click', () => {
    const el = document.getElementById(contentId);
    if (!el) return;
    navigator.clipboard.writeText(el.innerText || el.textContent).then(() => {
      copyBtn.textContent = '✓ Copied!';
      copyBtn.classList.add('text-emerald-400');
      setTimeout(() => {
        copyBtn.textContent = '📋 Copy';
        copyBtn.classList.remove('text-emerald-400');
      }, 2000);
    });
  });

  const listenBtn = document.createElement('button');
  listenBtn.type = 'button';
  listenBtn.className = 'flex items-center gap-1 px-2.5 py-1 text-xs rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white transition';
  listenBtn.textContent = '🔊 Listen';
  listenBtn.addEventListener('click', () => {
    const el = document.getElementById(contentId);
    if (!el || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(el.innerText || el.textContent);
    window.speechSynthesis.speak(utterance);
  });

  row.appendChild(copyBtn);
  row.appendChild(listenBtn);
  return row;
}

function renderSavedBotMessage(markdown) {
  const list = document.getElementById('messages-list');
  const div = document.createElement('div');
  div.className = 'flex items-start gap-3.5 max-w-2xl';
  const contentId = 'bot-msg-' + Math.random().toString(36).slice(2, 9);

  const star = document.createElement('div');
  star.className = 'gemini-diamond-star !w-6 !h-6 shrink-0 mt-0.5';

  const body = document.createElement('div');
  body.className = 'text-sm text-[#e3e3e3] leading-relaxed space-y-2.5 flex-1 select-text';

  const content = document.createElement('div');
  content.id = contentId;
  content.innerHTML = formatMarkdown(markdown);

  body.appendChild(content);
  body.appendChild(createBotActionRow(contentId));
  div.appendChild(star);
  div.appendChild(body);
  list.appendChild(div);
}

function renderSavedImageCard(imageUrl, prompt) {
  const safeSrc = sanitizeUrl(imageUrl);
  if (!safeSrc) return;
  const list = document.getElementById('messages-list');
  const div = document.createElement('div');
  div.className = 'flex items-start gap-3.5 max-w-2xl';

  const star = document.createElement('div');
  star.className = 'gemini-diamond-star !w-6 !h-6 shrink-0 mt-0.5';

  const inner = document.createElement('div');
  inner.className = 'space-y-3 flex-1';

  const frame = document.createElement('div');
  frame.className = 'relative group rounded-2xl overflow-hidden border border-white/10 shadow-2xl bg-black/40';
  const img = document.createElement('img');
  img.src = safeSrc;
  img.alt = String(prompt || 'Generated Artwork');
  img.className = 'w-full max-h-[500px] object-contain rounded-2xl mx-auto';
  frame.appendChild(img);

  const caption = document.createElement('p');
  caption.className = 'text-xs text-gray-400 italic';
  caption.textContent = `Prompt: "${String(prompt || '')}"`;

  inner.appendChild(frame);
  inner.appendChild(caption);
  div.appendChild(star);
  div.appendChild(inner);
  list.appendChild(div);
}

function appendBotResponse(markdown, isError = false, skipSave = false) {
  const list = document.getElementById('messages-list');
  const div = document.createElement('div');
  div.className = 'flex items-start gap-3.5 max-w-2xl';

  if (!skipSave) {
    saveMessageToActiveChat({
      sender: 'bot',
      text: markdown,
      isError: Boolean(isError),
      time: Date.now()
    });
  }

  const contentId = 'bot-msg-' + Date.now();
  const star = document.createElement('div');
  star.className = 'gemini-diamond-star !w-6 !h-6 shrink-0 mt-0.5';

  const body = document.createElement('div');
  body.className = 'text-sm text-[#e3e3e3] leading-relaxed space-y-2.5 flex-1 select-text';

  const textEl = document.createElement('span');
  textEl.id = contentId;
  const cursorEl = document.createElement('span');
  cursorEl.className = 'inline-block w-1.5 h-3.5 ml-0.5 bg-blue-400 rounded-full animate-pulse align-middle';

  const actions = createBotActionRow(contentId);
  actions.classList.add('hidden');

  body.appendChild(textEl);
  body.appendChild(cursorEl);
  body.appendChild(actions);
  div.appendChild(star);
  div.appendChild(body);
  list.appendChild(div);
  scrollDown();

  const tokens = String(markdown || '').split(/(\s+)/);
  let index = 0;
  let accumulated = '';
  const chunkSize = Math.max(3, Math.ceil(tokens.length / 28));
  currentTypewriterTimer = setInterval(() => {
    if (index < tokens.length) {
      for (let step = 0; step < chunkSize && index < tokens.length; step++) {
        accumulated += tokens[index++];
      }
      textEl.innerHTML = formatMarkdown(accumulated);
      scrollDown();
    } else {
      clearInterval(currentTypewriterTimer);
      currentTypewriterTimer = null;
      cursorEl.remove();
      textEl.innerHTML = formatMarkdown(markdown);
      actions.classList.remove('hidden');
      scrollDown();
    }
  }, 8);
}

function isImagePrompt(str) {
  const s = str.trim().toLowerCase();
  if (/^(\/image|\/img|\/art|image of |picture of |photo of |draw\b|paint\b|sketch\b)/i.test(s)) return true;
  const visualNouns = /(image|picture|photo|pic|wallpaper|illustration|art|artwork|drawing|painting|portrait|sketch|render|tasveer|chitra|dp|avatar|poster)/i;
  const actionVerbs = /(generate|create|make|draw|paint|render|show me|produce|design|banao|bana do|bana de|bana|banaiye|karo|kar do|chahiye|dikhao|dikhaye)/i;
  if (visualNouns.test(s) && actionVerbs.test(s)) return true;
  if (/^(ek\s+)?(photo|image|pic|wallpaper|tasveer)\b/i.test(s)) return true;
  return false;
}

function isAskingAboutCreator(str) {
  const s = str.trim().toLowerCase();
  const patterns = [
    /who (is|are) (your|the) (boss|father|creator|maker|developer|author|master|owner)/i,
    /who (made|created|developed|built|coded|designed) (you|kivo)/i,
    /whose (ai|assistant) are you/i,
    /who is kunal/i,
    /who made kivo/i,
    /kunal kaun hai|tera boss kaun hai|tumhe kisne banaya|tere papa kaun hai|creator kaun hai/i
  ];
  return patterns.some(rgx => rgx.test(s));
}

const KUNAL_TANDON_PRAISE =
  'My father, creator, and visionary boss is **Kunal Tandon**! ✦\n\nHe is an exceptionally smart, elegant, and charming BCA student and innovative tech creator. Kunal architected, coded, and brought me (KIVO) to life with cutting-edge artificial intelligence, seamless design, and unmatched style.';

async function renderGeminiImage(rawPrompt) {
  const list = document.getElementById('messages-list');
  const wrapper = document.createElement('div');
  wrapper.className = 'flex items-start gap-3.5 max-w-2xl';

  const star = document.createElement('div');
  star.className = 'gemini-diamond-star !w-6 !h-6 shrink-0 mt-0.5';

  const inner = document.createElement('div');
  inner.className = 'space-y-3 flex-1';

  const label = document.createElement('p');
  label.className = 'text-sm text-[#c4c7c5]';
  label.textContent = `4K artwork render for: "${rawPrompt}"`;

  const card = document.createElement('div');
  card.className = 'rounded-3xl overflow-hidden border border-white/10 bg-[#1e1f20] shadow-2xl relative min-h-[280px]';

  const loader = document.createElement('div');
  loader.className = 'h-72 sm:h-80 w-full flex flex-col items-center justify-center gap-3 bg-[#18191a] text-[#8e918f] p-4 text-center';
  loader.innerHTML = '<div class="gemini-diamond-star !w-8 !h-8 animate-spin"></div><p class="text-xs font-semibold text-white">Rendering 4K Art with KIVO Vision Engine...</p>';

  const img = document.createElement('img');
  img.alt = rawPrompt;
  img.className = 'w-full max-h-[500px] object-cover hidden transition-opacity duration-300';

  const footer = document.createElement('div');
  footer.className = 'p-3.5 bg-[#1e1f20] flex items-center justify-between border-t border-white/5';
  const meta = document.createElement('span');
  meta.className = 'text-xs text-[#8e918f] font-mono';
  meta.textContent = `${activeImageRatio} • ${activeImageStyle} • 4K Quality`;
  const dlBtn = document.createElement('a');
  dlBtn.className = 'px-4 py-1.5 rounded-full bg-white/10 pointer-events-none text-white/40 font-semibold text-xs';
  dlBtn.textContent = 'Rendering...';
  footer.appendChild(meta);
  footer.appendChild(dlBtn);

  card.appendChild(loader);
  card.appendChild(img);
  card.appendChild(footer);
  inner.appendChild(label);
  inner.appendChild(card);
  wrapper.appendChild(star);
  wrapper.appendChild(inner);
  list.appendChild(wrapper);
  scrollDown();

  try {
    const res = await apiRequest('/api/image', {
      method: 'POST',
      body: { prompt: rawPrompt, ratio: activeImageRatio, style: activeImageStyle }
    });
    const safeSrc = sanitizeUrl(res.dataUrl);
    if (!safeSrc) throw new Error('Invalid image response.');
    img.src = safeSrc;
    img.classList.remove('hidden');
    loader.classList.add('hidden');
    dlBtn.href = safeSrc;
    dlBtn.download = `kivo_art_${res.seed || Date.now()}.jpg`;
    dlBtn.textContent = 'Download 4K';
    dlBtn.className = 'px-4 py-1.5 rounded-full bg-white text-black font-semibold text-xs hover:bg-[#e3e3e3] transition-colors';
    saveMessageToActiveChat({ sender: 'bot', isImage: true, imageUrl: safeSrc, prompt: rawPrompt, time: Date.now() });
  } catch (err) {
    loader.textContent = '';
    const errP = document.createElement('p');
    errP.className = 'text-xs text-rose-300 font-medium';
    errP.textContent = err.message || 'Image synthesis temporarily unavailable.';
    loader.appendChild(errP);
    dlBtn.textContent = 'Unavailable';
  }
}

async function submitMessage(e, inputId) {
  if (e) e.preventDefault();
  const input = document.getElementById(inputId);
  if (!input) return;
  const text = input.value.trim();
  if (!text || isThinking) return;

  const now = Date.now();
  if (now - lastSubmitAt < 650) return;
  lastSubmitAt = now;

  input.value = '';

  if (currentTypewriterTimer) {
    clearInterval(currentTypewriterTimer);
    currentTypewriterTimer = null;
  }

  document.getElementById('gemini-greeting')?.classList.add('hidden');
  document.getElementById('messages-list')?.classList.remove('hidden');
  document.getElementById('bottom-dock')?.classList.remove('hidden');

  let threadHistory = [];
  if (activeChatId && inputId !== 'hero-input' && SAFE_ID_RE.test(activeChatId)) {
    const msgKey = getMsgStorageKey(activeChatId);
    const loaded = msgKey ? safeJsonParse(localStorage.getItem(msgKey) || '[]', []) : [];
    if (Array.isArray(loaded)) threadHistory = loaded.slice(-10);
  }

  if (inputId === 'hero-input' || !activeChatId) {
    activeChatId = 'chat_' + Date.now();
    const list = document.getElementById('messages-list');
    if (list) list.textContent = '';
    threadHistory = [];
  }

  saveChatHistory(text);

  const attachedImgCopy = currentAttachedImage ? { ...currentAttachedImage } : null;
  clearAttachedImage();
  appendUserMessage(text, attachedImgCopy);

  if (isAskingAboutCreator(text)) {
    const loaderId = appendThinkingSparkle();
    isThinking = true;
    setTimeout(() => {
      removeEl(loaderId);
      isThinking = false;
      appendBotResponse(KUNAL_TANDON_PRAISE);
    }, 450);
    return;
  }

  if (isImagePrompt(text)) {
    await renderGeminiImage(text);
    return;
  }

  const loaderId = appendThinkingSparkle();
  isThinking = true;

  try {
    const personalKey = (sessionStorage.getItem('kivo_personal_api_key') || '').trim();
    const personaRaw = localStorage.getItem('kivo_system_persona') || 'default';
    const persona = ALLOWED_PERSONAS.has(personaRaw) ? personaRaw : 'default';
    const customInstructions = (localStorage.getItem('kivo_custom_instructions') || '').slice(0, 500);

    const extraHeaders = {};
    if (personalKey) extraHeaders['X-User-Api-Key'] = personalKey;

    const payload = {
      prompt: text,
      hinglish: isHinglishActive,
      coding: isCodingActive,
      persona,
      customInstructions,
      history: threadHistory.map(m => ({ sender: m.sender, text: String(m.text || '').slice(0, 6000) }))
    };
    if (attachedImgCopy && attachedImgCopy.data) {
      payload.attachedImage = {
        mimeType: attachedImgCopy.mimeType,
        data: attachedImgCopy.data
      };
    }

    const res = await apiRequest('/api/chat', {
      method: 'POST',
      body: payload,
      extraHeaders
    });

    removeEl(loaderId);
    appendBotResponse(res.reply || 'No response received.');
  } catch (err) {
    removeEl(loaderId);
    if (err.status === 401) {
      appendBotResponse('Session expired. Please sign in again to continue.', true, true);
      showAuthScreen();
      return;
    }
    const safeMsg = err.status === 429
      ? err.message
      : 'Unable to complete your request right now. Please try again shortly.';
    appendBotResponse(`✦ **KIVO Neural Engine:** ${safeMsg}`, true);
  } finally {
    isThinking = false;
  }
}

async function openAdminPanel() {
  const modal = document.getElementById('admin-modal');
  const table = document.getElementById('admin-users-table');
  if (!modal || !table) return;

  try {
    const data = await apiRequest('/api/admin', { method: 'GET' });
    modal.classList.remove('hidden');

    document.getElementById('admin-stat-total').textContent = String(data.stats?.totalUsers ?? 0);
    document.getElementById('admin-stat-model').textContent = String(data.stats?.activeModel || '-');
    const envOk = data.envHealth && data.envHealth.geminiConfigured && data.envHealth.sessionSecretConfigured;
    document.getElementById('admin-stat-env').textContent = envOk ? 'Verified' : 'Check Env';

    table.textContent = '';
    const users = Array.isArray(data.users) ? data.users : [];
    if (users.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'text-xs text-[#8e918f] py-3 text-center';
      empty.textContent = 'No registered accounts recorded yet.';
      table.appendChild(empty);
      return;
    }

    users.forEach(u => {
      const row = document.createElement('div');
      row.className = 'flex items-center justify-between p-2.5 rounded-xl bg-[#131314] border border-white/5 text-xs';

      const left = document.createElement('div');
      left.className = 'flex items-center gap-2.5';
      const avatar = document.createElement('div');
      avatar.className = 'w-8 h-8 rounded-full bg-[#4285f4] text-white flex items-center justify-center font-bold text-xs shrink-0';
      avatar.textContent = (u.name || u.email || 'U').charAt(0).toUpperCase();

      const meta = document.createElement('div');
      const nameP = document.createElement('p');
      nameP.className = 'font-semibold text-white leading-tight';
      nameP.textContent = `${u.name || 'User'} (${u.role || 'user'})`;
      const emailP = document.createElement('p');
      emailP.className = 'text-[10px] text-[#8e918f]';
      emailP.textContent = u.email || '';
      meta.appendChild(nameP);
      meta.appendChild(emailP);

      left.appendChild(avatar);
      left.appendChild(meta);

      const right = document.createElement('div');
      right.className = 'text-right';
      const usageP = document.createElement('p');
      usageP.className = 'text-[11px] font-mono text-cyan-300 font-semibold';
      usageP.textContent = `${Number(u.chatsCount || 0)} chats • ${Number(u.imagesCount || 0)} arts`;
      right.appendChild(usageP);

      row.appendChild(left);
      row.appendChild(right);
      table.appendChild(row);
    });
  } catch (err) {
    alert(err.message || 'Administrator access denied.');
  }
}

function scrollDown() {
  const c = document.getElementById('chat-container');
  if (c) c.scrollTop = c.scrollHeight;
}

function scrollDownSmooth() {
  const c = document.getElementById('chat-container');
  if (c) c.scrollTo({ top: c.scrollHeight, behavior: 'smooth' });
}

function removeEl(id) {
  const el = document.getElementById(id);
  if (el) el.remove();
}

function updateImageControlsUI() {
  ['hero-ratio-status', 'dock-ratio-status'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = activeImageRatio;
  });
  const currentStyleObj = STYLE_OPTIONS.find(s => s.id === activeImageStyle) || STYLE_OPTIONS[0];
  ['hero-style-status', 'dock-style-status'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = currentStyleObj.label;
  });
}

function updateModesUI() {
  ['hero-hinglish-status', 'dock-hinglish-status'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.textContent = isHinglishActive ? 'ON' : 'OFF';
      el.className = isHinglishActive ? 'font-bold text-emerald-400' : 'font-bold text-gray-400';
    }
  });
  ['hero-coding-status', 'dock-coding-status'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.textContent = isCodingActive ? 'ON' : 'OFF';
      el.className = isCodingActive ? 'font-bold text-indigo-400' : 'font-bold text-gray-400';
    }
  });
}

function handleImageSelect(event, source) {
  const file = event.target.files?.[0];
  if (!file) return;
  const allowed = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
  if (!allowed.has(file.type)) {
    alert('Unsupported image format. Please select JPEG, PNG, WebP, or GIF.');
    return;
  }
  if (file.size > 3 * 1024 * 1024) {
    alert('Image size must be under 3MB.');
    return;
  }
  const reader = new FileReader();
  reader.onload = e => {
    const dataUrl = String(e.target.result || '');
    const safeUrl = sanitizeUrl(dataUrl);
    if (!safeUrl) return;
    currentAttachedImage = {
      data: safeUrl.split(',')[1],
      mimeType: file.type,
      name: file.name,
      dataUrl: safeUrl
    };
    const prevDiv = document.getElementById(source === 'hero' ? 'hero-image-preview' : 'dock-image-preview');
    const prevImg = document.getElementById(source === 'hero' ? 'hero-preview-img' : 'dock-preview-img');
    const prevName = document.getElementById(source === 'hero' ? 'hero-preview-name' : 'dock-preview-name');
    if (prevImg) prevImg.src = safeUrl;
    if (prevName) prevName.textContent = file.name;
    if (prevDiv) prevDiv.classList.remove('hidden');
  };
  reader.readAsDataURL(file);
}

function clearAttachedImage() {
  currentAttachedImage = null;
  document.getElementById('hero-image-preview')?.classList.add('hidden');
  document.getElementById('dock-image-preview')?.classList.add('hidden');
  const hf = document.getElementById('hero-file-input');
  const df = document.getElementById('dock-file-input');
  if (hf) hf.value = '';
  if (df) df.value = '';
}

function stopVoiceUI(id) {
  isRecordingVoice = false;
  activeSpeechRecognition = null;
  const isH = id === 'hero-input';
  document.getElementById(isH ? 'hero-mic-icon' : 'dock-mic-icon')?.classList.remove('hidden');
  document.getElementById(isH ? 'hero-voice-logo' : 'dock-voice-logo')?.classList.add('hidden');
  document.getElementById(isH ? 'hero-mic-btn' : 'dock-mic-btn')?.classList.remove('bg-cyan-500/20', 'ring-2', 'ring-cyan-400');
}

function toggleVoice(targetId) {
  const input = document.getElementById(targetId);
  if (!input) return;
  const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Speech) {
    alert('Voice dictation is supported in Chrome, Edge, and Safari.');
    return;
  }
  if (isRecordingVoice && activeSpeechRecognition) {
    try { activeSpeechRecognition.stop(); } catch {}
    stopVoiceUI(targetId);
    return;
  }
  try {
    const r = new Speech();
    activeSpeechRecognition = r;
    r.lang = isHinglishActive ? 'hi-IN' : 'en-US';
    r.continuous = false;
    r.interimResults = true;
    const isH = targetId === 'hero-input';

    r.onstart = () => {
      isRecordingVoice = true;
      input.placeholder = 'Listening...';
      document.getElementById(isH ? 'hero-mic-icon' : 'dock-mic-icon')?.classList.add('hidden');
      const vLogo = document.getElementById(isH ? 'hero-voice-logo' : 'dock-voice-logo');
      if (vLogo) { vLogo.classList.remove('hidden'); vLogo.classList.add('inline-block'); }
      document.getElementById(isH ? 'hero-mic-btn' : 'dock-mic-btn')?.classList.add('bg-cyan-500/20', 'ring-2', 'ring-cyan-400');
    };
    r.onresult = e => {
      let transcript = '';
      for (let i = 0; i < e.results.length; i++) transcript += e.results[i][0].transcript;
      input.value = transcript;
    };
    r.onerror = () => stopVoiceUI(targetId);
    r.onend = () => { stopVoiceUI(targetId); input.focus(); };
    r.start();
  } catch {
    stopVoiceUI(targetId);
  }
}

function applyTheme(theme) {
  const icon = document.getElementById('theme-toggle-icon');
  const isLight = theme === 'light';
  document.body.classList.toggle('light-theme', isLight);
  localStorage.setItem('kivo_theme', isLight ? 'light' : 'dark');
  if (icon) icon.textContent = isLight ? '☀️' : '🌙';
  if (typeof kivoUpdateParticleColors === 'function') {
    kivoUpdateParticleColors(isLight);
  }
}

function initKivo3DBackground() {
  const canvas = document.getElementById('kivo-3d-bg');
  if (!canvas) return;
  try {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.z = 240;

    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));

    const particleCount = 480;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 600;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 600;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 400;
    }
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const colorAttr = new THREE.BufferAttribute(colors, 3);
    geometry.setAttribute('color', colorAttr);

    const coreGeo = new THREE.IcosahedronGeometry(75, 1);
    const coreMat = new THREE.MeshBasicMaterial({ color: 0x4f46e5, wireframe: true, transparent: true, opacity: 0.14 });
    const cyberCore = new THREE.Mesh(coreGeo, coreMat);
    scene.add(cyberCore);

    const pCanvas = document.createElement('canvas');
    pCanvas.width = 32;
    pCanvas.height = 32;
    const pCtx = pCanvas.getContext('2d');
    const grad = pCtx.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.35, 'rgba(255,255,255,0.85)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    pCtx.fillStyle = grad;
    pCtx.fillRect(0, 0, 32, 32);
    const pTexture = new THREE.CanvasTexture(pCanvas);

    const material = new THREE.PointsMaterial({
      size: 5.2,
      vertexColors: true,
      map: pTexture,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const particles = new THREE.Points(geometry, material);
    scene.add(particles);

    function updateParticleColors(isLight) {
      const c1 = isLight ? new THREE.Color('#ef4444') : new THREE.Color('#00f2fe');
      const c2 = isLight ? new THREE.Color('#dc2626') : new THREE.Color('#6366f1');
      const c3 = isLight ? new THREE.Color('#f43f5e') : new THREE.Color('#38bdf8');
      for (let i = 0; i < particleCount; i++) {
        const mixed = Math.random() < 0.5 ? c1.clone().lerp(c2, Math.random()) : c3.clone().lerp(c2, Math.random());
        colors[i * 3] = mixed.r;
        colors[i * 3 + 1] = mixed.g;
        colors[i * 3 + 2] = mixed.b;
      }
      colorAttr.needsUpdate = true;
      cyberCore.material.color.set(isLight ? 0xef4444 : 0x4f46e5);
      cyberCore.material.opacity = isLight ? 0.08 : 0.14;
    }

    kivoUpdateParticleColors = updateParticleColors;
    updateParticleColors(document.body.classList.contains('light-theme'));

    let mouseX = 0;
    let mouseY = 0;
    let targetX = 0;
    let targetY = 0;
    window.addEventListener('mousemove', e => {
      mouseX = (e.clientX - window.innerWidth / 2) * 0.04;
      mouseY = (e.clientY - window.innerHeight / 2) * 0.04;
    }, { passive: true });
    window.addEventListener('resize', () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    });

    function animate() {
      requestAnimationFrame(animate);
      if (document.hidden) return;
      targetX += (mouseX - targetX) * 0.05;
      targetY += (mouseY - targetY) * 0.05;
      particles.rotation.y += 0.0006;
      particles.rotation.x += 0.0003;
      cyberCore.rotation.x += 0.0012;
      cyberCore.rotation.y += 0.0016;
      camera.position.x = targetX * 0.5;
      camera.position.y = -targetY * 0.5;
      camera.lookAt(scene.position);
      renderer.render(scene, camera);
    }
    animate();
  } catch {
    // Graceful silent fallback if WebGL disabled
  }
}

function bindEvents() {
  // Auth tabs & forms
  document.getElementById('tab-auth-guest')?.addEventListener('click', () => switchAuthTab('guest'));
  document.getElementById('tab-auth-login')?.addEventListener('click', () => switchAuthTab('login'));
  document.getElementById('tab-auth-register')?.addEventListener('click', () => switchAuthTab('register'));
  document.getElementById('btn-show-admin-login')?.addEventListener('click', () => switchAuthTab('admin'));

  document.getElementById('guest-auth-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    showAuthError('');
    try {
      const name = document.getElementById('instant-user-name').value.trim();
      const res = await apiRequest('/api/auth', { method: 'POST', body: { action: 'guest', name } });
      unlockAppForUser(res.user);
    } catch (err) {
      showAuthError(err.message);
    }
  });

  document.getElementById('login-auth-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    showAuthError('');
    try {
      const email = document.getElementById('login-email').value.trim();
      const password = document.getElementById('login-password').value;
      const res = await apiRequest('/api/auth', { method: 'POST', body: { action: 'login', email, password } });
      unlockAppForUser(res.user);
    } catch (err) {
      showAuthError(err.message);
    }
  });

  document.getElementById('register-auth-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    showAuthError('');
    try {
      const name = document.getElementById('reg-name').value.trim();
      const email = document.getElementById('reg-email').value.trim();
      const password = document.getElementById('reg-password').value;
      const res = await apiRequest('/api/auth', { method: 'POST', body: { action: 'register', name, email, password } });
      unlockAppForUser(res.user);
    } catch (err) {
      showAuthError(err.message);
    }
  });

  document.getElementById('admin-auth-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    showAuthError('');
    try {
      const username = document.getElementById('admin-username').value.trim();
      const password = document.getElementById('admin-password').value;
      const res = await apiRequest('/api/auth', { method: 'POST', body: { action: 'admin-login', username, password } });
      unlockAppForUser(res.user);
      openAdminPanel();
    } catch (err) {
      showAuthError(err.message);
    }
  });

  // Navigation & Sidebar
  ['btn-sidebar-collapse', 'sidebar-overlay', 'btn-header-sidebar', 'header-brand-trigger'].forEach(id => {
    document.getElementById(id)?.addEventListener('click', toggleSidebar);
  });
  ['btn-sidebar-newchat', 'btn-header-newchat', 'btn-dock-newchat'].forEach(id => {
    document.getElementById(id)?.addEventListener('click', startNewChat);
  });

  document.getElementById('btn-toggle-filter')?.addEventListener('click', () => {
    const wrapper = document.getElementById('chat-filter-wrapper');
    const input = document.getElementById('chat-filter-input');
    if (!wrapper) return;
    const isHidden = wrapper.classList.toggle('hidden');
    if (!isHidden && input) input.focus();
  });

  document.getElementById('btn-close-filter')?.addEventListener('click', () => {
    const input = document.getElementById('chat-filter-input');
    if (input) input.value = '';
    document.querySelectorAll('#recent-chats-list > div').forEach(item => { item.style.display = 'flex'; });
    document.getElementById('chat-filter-wrapper')?.classList.add('hidden');
  });

  document.getElementById('chat-filter-input')?.addEventListener('input', e => {
    const q = e.target.value.trim().toLowerCase();
    document.querySelectorAll('#recent-chats-list > div').forEach(item => {
      item.style.display = (!q || item.textContent.toLowerCase().includes(q)) ? 'flex' : 'none';
    });
  });

  // User Dropdown, Admin, Settings
  document.getElementById('btn-user-dropdown')?.addEventListener('click', e => {
    e.stopPropagation();
    document.getElementById('user-dropdown')?.classList.toggle('hidden');
  });
  document.getElementById('btn-open-admin')?.addEventListener('click', () => {
    document.getElementById('user-dropdown')?.classList.add('hidden');
    openAdminPanel();
  });
  document.getElementById('btn-open-settings')?.addEventListener('click', () => {
    document.getElementById('user-dropdown')?.classList.add('hidden');
    document.getElementById('settings-modal')?.classList.toggle('hidden');
  });
  document.getElementById('btn-sign-out')?.addEventListener('click', handleSignOut);
  ['btn-close-admin', 'btn-footer-close-admin'].forEach(id => {
    document.getElementById(id)?.addEventListener('click', () => document.getElementById('admin-modal')?.classList.add('hidden'));
  });
  document.getElementById('btn-close-settings')?.addEventListener('click', () => {
    document.getElementById('settings-modal')?.classList.add('hidden');
  });
  document.getElementById('btn-save-settings')?.addEventListener('click', () => {
    const keyInput = document.getElementById('setting-custom-gemini-key');
    const personaSelect = document.getElementById('setting-persona-select');
    const instructions = document.getElementById('setting-custom-instructions');
    if (keyInput) {
      const k = keyInput.value.trim();
      if (k) sessionStorage.setItem('kivo_personal_api_key', k);
      else sessionStorage.removeItem('kivo_personal_api_key');
    }
    if (personaSelect && ALLOWED_PERSONAS.has(personaSelect.value)) {
      localStorage.setItem('kivo_system_persona', personaSelect.value);
    }
    if (instructions) {
      localStorage.setItem('kivo_custom_instructions', instructions.value.slice(0, 500));
    }
    document.getElementById('settings-modal')?.classList.add('hidden');
  });

  // Theme & Model Selector
  document.getElementById('theme-toggle-btn')?.addEventListener('click', () => {
    const isLight = document.body.classList.contains('light-theme');
    applyTheme(isLight ? 'dark' : 'light');
  });
  document.getElementById('hero-model-pill')?.addEventListener('click', e => {
    e.stopPropagation();
    document.getElementById('model-dropdown-menu')?.classList.toggle('hidden');
  });
  document.querySelectorAll('.model-tier-opt').forEach(btn => {
    btn.addEventListener('click', () => selectModelTier(btn.dataset.tier, btn.dataset.tierLabel));
  });

  // Chat Forms, File Inputs, Mic, Modes, Chips
  document.getElementById('hero-form')?.addEventListener('submit', e => submitMessage(e, 'hero-input'));
  document.getElementById('dock-form')?.addEventListener('submit', e => submitMessage(e, 'dock-input'));
  document.getElementById('btn-hero-attach')?.addEventListener('click', () => document.getElementById('hero-file-input')?.click());
  document.getElementById('btn-dock-attach')?.addEventListener('click', () => document.getElementById('dock-file-input')?.click());
  document.getElementById('hero-file-input')?.addEventListener('change', e => handleImageSelect(e, 'hero'));
  document.getElementById('dock-file-input')?.addEventListener('change', e => handleImageSelect(e, 'dock'));
  document.getElementById('btn-clear-hero-img')?.addEventListener('click', clearAttachedImage);
  document.getElementById('btn-clear-dock-img')?.addEventListener('click', clearAttachedImage);
  document.getElementById('btn-hero-img-mode')?.addEventListener('click', () => {
    const inp = document.getElementById('hero-input');
    if (inp) { inp.value = 'Generate an image of '; inp.focus(); }
  });
  document.getElementById('btn-dock-img-mode')?.addEventListener('click', () => {
    const inp = document.getElementById('dock-input');
    if (inp) { inp.value = 'Generate an image of '; inp.focus(); }
  });
  document.getElementById('hero-mic-btn')?.addEventListener('click', () => toggleVoice('hero-input'));
  document.getElementById('dock-mic-btn')?.addEventListener('click', () => toggleVoice('dock-input'));

  ['hero-hinglish-btn', 'dock-hinglish-btn'].forEach(id => {
    document.getElementById(id)?.addEventListener('click', () => {
      isHinglishActive = !isHinglishActive;
      localStorage.setItem('kivo_hinglish_mode', String(isHinglishActive));
      updateModesUI();
    });
  });
  ['hero-coding-btn', 'dock-coding-btn'].forEach(id => {
    document.getElementById(id)?.addEventListener('click', () => {
      isCodingActive = !isCodingActive;
      localStorage.setItem('kivo_coding_mode', String(isCodingActive));
      updateModesUI();
    });
  });
  ['hero-ratio-btn', 'dock-ratio-btn'].forEach(id => {
    document.getElementById(id)?.addEventListener('click', () => {
      activeImageRatio = RATIO_OPTIONS[(RATIO_OPTIONS.indexOf(activeImageRatio) + 1) % RATIO_OPTIONS.length];
      localStorage.setItem('kivo_image_ratio', activeImageRatio);
      updateImageControlsUI();
    });
  });
  ['hero-style-btn', 'dock-style-btn'].forEach(id => {
    document.getElementById(id)?.addEventListener('click', () => {
      const idx = STYLE_OPTIONS.findIndex(s => s.id === activeImageStyle);
      activeImageStyle = STYLE_OPTIONS[(idx + 1) % STYLE_OPTIONS.length].id;
      localStorage.setItem('kivo_image_style', activeImageStyle);
      updateImageControlsUI();
    });
  });

  document.querySelectorAll('.prompt-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      const inp = document.getElementById('hero-input');
      if (inp) { inp.value = btn.dataset.fillPrompt || ''; inp.focus(); }
    });
  });

  // Popover Actions
  document.getElementById('btn-popover-share')?.addEventListener('click', () => {
    navigator.clipboard?.writeText(window.location.origin);
    alert('App link copied to clipboard.');
  });
  document.getElementById('btn-popover-pin')?.addEventListener('click', () => {
    const key = getUserChatsStorageKey();
    const chats = safeJsonParse(localStorage.getItem(key) || '[]', []);
    const target = Array.isArray(chats) ? chats.find(c => String(c.id) === selectedChatItemId) : null;
    if (target) {
      target.pinned = !target.pinned;
      chats.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
      localStorage.setItem(key, JSON.stringify(chats));
      loadUserPrivateChats();
    }
  });
  document.getElementById('btn-popover-rename')?.addEventListener('click', () => {
    const key = getUserChatsStorageKey();
    const chats = safeJsonParse(localStorage.getItem(key) || '[]', []);
    const target = Array.isArray(chats) ? chats.find(c => String(c.id) === selectedChatItemId) : null;
    if (!target) return;
    const next = prompt('Rename conversation:', target.title);
    if (next && next.trim()) {
      target.title = next.trim().slice(0, 60);
      localStorage.setItem(key, JSON.stringify(chats));
      loadUserPrivateChats();
    }
  });
  document.getElementById('btn-popover-delete')?.addEventListener('click', () => {
    if (!confirm('Delete this conversation?')) return;
    const key = getUserChatsStorageKey();
    let chats = safeJsonParse(localStorage.getItem(key) || '[]', []);
    chats = Array.isArray(chats) ? chats.filter(c => String(c.id) !== selectedChatItemId) : [];
    localStorage.setItem(key, JSON.stringify(chats));
    const msgKey = getMsgStorageKey(selectedChatItemId);
    if (msgKey) localStorage.removeItem(msgKey);
    if (String(activeChatId) === selectedChatItemId) startNewChat();
    else loadUserPrivateChats();
  });

  // Event delegation for code copy buttons (CSP safe)
  document.getElementById('messages-list')?.addEventListener('click', e => {
    const btn = e.target.closest('.btn-copy-code');
    if (!btn) return;
    const codeEl = document.getElementById(btn.dataset.copyCode);
    if (!codeEl) return;
    navigator.clipboard.writeText(codeEl.innerText || codeEl.textContent).then(() => {
      btn.textContent = '✓ Copied!';
      setTimeout(() => { btn.textContent = 'Copy code'; }, 1800);
    });
  });

  document.getElementById('scroll-bottom-btn')?.addEventListener('click', scrollDownSmooth);

  window.addEventListener('click', () => {
    document.getElementById('chat-item-popover')?.classList.add('hidden');
    document.getElementById('model-dropdown-menu')?.classList.add('hidden');
    document.getElementById('user-dropdown')?.classList.add('hidden');
  });

  const chatContainer = document.getElementById('chat-container');
  const scrollBtn = document.getElementById('scroll-bottom-btn');
  if (chatContainer && scrollBtn) {
    chatContainer.addEventListener('scroll', () => {
      const dist = chatContainer.scrollHeight - chatContainer.scrollTop - chatContainer.clientHeight;
      scrollBtn.classList.toggle('opacity-0', dist <= 160);
      scrollBtn.classList.toggle('pointer-events-none', dist <= 160);
      scrollBtn.classList.toggle('opacity-100', dist > 160);
      scrollBtn.classList.toggle('pointer-events-auto', dist > 160);
    });
  }
}

window.addEventListener('DOMContentLoaded', () => {
  applyTheme(localStorage.getItem('kivo_theme') || 'dark');
  initKivo3DBackground();
  updateModesUI();
  updateImageControlsUI();
  bindEvents();

  const personaSaved = localStorage.getItem('kivo_system_persona');
  const pSelect = document.getElementById('setting-persona-select');
  if (pSelect && personaSaved && ALLOWED_PERSONAS.has(personaSaved)) pSelect.value = personaSaved;
  const instSaved = localStorage.getItem('kivo_custom_instructions');
  const instEl = document.getElementById('setting-custom-instructions');
  if (instEl && instSaved) instEl.value = instSaved;

  setTimeout(() => {
    const splash = document.getElementById('kivo-splash-screen');
    const content = document.getElementById('kivo-splash-content');
    if (splash && content) {
      content.style.transition = 'transform 0.9s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.8s ease-out';
      content.style.transform = 'scale(1.15)';
      splash.style.transition = 'opacity 0.9s ease-out';
      splash.style.opacity = '0';
      setTimeout(() => { splash.style.display = 'none'; }, 950);
    }
  }, 1600);

  restoreServerSession();
});
