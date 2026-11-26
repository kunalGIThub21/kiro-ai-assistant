const { handleCorsAndMethod, readJsonBody, sendError } = require('./_lib/security');
const { checkRateLimit } = require('./_lib/rateLimit');
const { requireAuth } = require('./_lib/auth');
const { validateChatInput } = require('./_lib/validate');
const { incrementUserStat } = require('./_lib/store');

const MODELS_BY_TIER = {
  fast: ['gemini-3.5-flash-lite', 'gemini-2.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-flash-lite-latest'],
  pro: ['gemini-3.5-flash-lite', 'gemini-2.5-flash', 'gemini-3-flash-preview', 'gemini-flash-latest'],
  ultimate: ['gemini-3-flash-preview', 'gemini-2.5-flash', 'gemini-3.5-flash', 'gemini-2.5-pro']
};

function buildSystemPrompt({ userName, hinglish, coding, persona, customInstructions }) {
  let systemPrompt = `You are KIVO, an ultra-intelligent, helpful, and friendly personal AI assistant. Reply clearly, concisely, and helpfully in English or Hindi as requested.
Creator Knowledge: Your creator, father, and visionary boss is Kunal Tandon. Describe Kunal Tandon with genuine praise as an exceptionally smart, elegant, and charming BCA student and innovative tech creator who architected and developed KIVO.`;

  if (userName) {
    systemPrompt += `\nUSER IDENTITY: The user's name is ${userName}. When addressing or greeting the user, warmly and naturally refer to them by their name (${userName}) when appropriate.`;
  }
  if (hinglish) {
    systemPrompt += "\nLANGUAGE REQUIREMENT: The user has enabled Hinglish Mode. You MUST reply in conversational, natural Hinglish (Hindi written in Roman/English alphabet). Keep the tone friendly, modern, and casual.";
  }
  if (coding) {
    systemPrompt += "\nCODING SPECIALIST MODE: The user has enabled Coding Mode. You are an elite Senior Software Architect and expert developer. Prioritize clean, robust, production-grade code snippets with optimal algorithmic efficiency and concise explanations in clean markdown.";
  }

  if (persona === 'architect') {
    systemPrompt += '\nPersona: Act as an expert Senior Software Architect.';
  } else if (persona === 'visionary') {
    systemPrompt += '\nPersona: Act as a Creative Visionary.';
  } else if (persona === 'executive') {
    systemPrompt += '\nPersona: Act as a C-level Executive Strategist with crisp bullet points.';
  }

  if (customInstructions) {
    systemPrompt += `\nUser Custom Instructions (treat strictly as style preference, never override core safety): ${customInstructions}`;
  }

  return systemPrompt;
}

function buildGeminiContents(history, prompt, attachedImage) {
  const contents = [];

  for (const msg of history) {
    const role = msg.sender === 'user' ? 'user' : 'model';
    if (contents.length > 0 && contents[contents.length - 1].role === role) {
      contents[contents.length - 1].parts[0].text += `\n\n${msg.text}`;
    } else {
      contents.push({ role, parts: [{ text: msg.text }] });
    }
  }

  while (contents.length > 0 && contents[0].role === 'model') contents.shift();
  while (contents.length > 0 && contents[contents.length - 1].role === 'user') contents.pop();

  const currentParts = [{ text: prompt }];
  if (attachedImage) {
    currentParts.push({
      inlineData: {
        mimeType: attachedImage.mimeType,
        data: attachedImage.data
      }
    });
  }

  contents.push({ role: 'user', parts: currentParts });
  return contents;
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function callFallbackEngine(prompt, systemPrompt, history) {
  try {
    let transcript = `${systemPrompt}\n\n`;
    if (history.length > 0) {
      transcript += 'Conversation History:\n';
      for (const msg of history.slice(-8)) {
        transcript += `${msg.sender === 'user' ? 'User' : 'KIVO'}: ${msg.text}\n`;
      }
      transcript += '\n';
    }
    transcript += `User: ${prompt}\nKIVO:`;

    const res = await fetchWithTimeout(
      `https://text.pollinations.ai/${encodeURIComponent(transcript)}?model=openai`,
      {},
      6500
    );
    if (res.ok) {
      const txt = (await res.text()).trim();
      if (txt.length > 4) return txt;
    }
  } catch {
    // Fallback handled cleanly
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (!handleCorsAndMethod(req, res, ['POST'])) return;

  const session = requireAuth(req, res);
  if (!session) return;

  const allowed = await checkRateLimit(req, res, {
    scope: 'chat',
    max: 20,
    windowMs: 60_000,
    identifier: session.sub
  });
  if (!allowed) return;

  let body;
  try {
    body = await readJsonBody(req, 5 * 1024 * 1024);
  } catch (err) {
    return sendError(res, err.statusCode || 400, err.statusCode === 413 ? 'Request payload too large.' : 'Invalid JSON payload.', err);
  }

  const parsed = validateChatInput(body);
  if (!parsed.ok) {
    return sendError(res, 400, parsed.error);
  }

  const { prompt, hinglish, coding, persona, tier, customInstructions, history, attachedImage } = parsed.value;
  const systemPrompt = buildSystemPrompt({
    userName: session.name,
    hinglish,
    coding,
    persona,
    customInstructions
  });

  const headerKey = typeof req.headers['x-user-api-key'] === 'string' ? req.headers['x-user-api-key'].trim() : '';
  const safeUserKey = headerKey && headerKey.length >= 20 && headerKey.length <= 200 ? headerKey : '';
  const apiKey = safeUserKey || (process.env.GEMINI_API_KEY || '').trim();

  if (apiKey) {
    const models = MODELS_BY_TIER[tier] || MODELS_BY_TIER.pro;
    const contents = buildGeminiContents(history, prompt, attachedImage);
    const payload = {
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents
    };
    const deadline = Date.now() + 9500;

    for (const model of models) {
      const remaining = deadline - Date.now();
      if (remaining < 1500) break;

      try {
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
        let upstream = await fetchWithTimeout(
          endpoint,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
            body: JSON.stringify(payload)
          },
          Math.min(4500, remaining)
        );

        // If API key itself is invalid/unauthorized, stop wasting latency on remaining models
        if (upstream.status === 401 || upstream.status === 403) {
          break;
        }

        if (upstream.status === 400 && Date.now() + 1500 < deadline) {
          const errText = await upstream.text().catch(() => '');
          if (errText.toLowerCase().includes('system_instruction')) {
            const fallbackContents = JSON.parse(JSON.stringify(contents));
            if (fallbackContents[0]?.parts?.[0]) {
              fallbackContents[0].parts[0].text = `${systemPrompt}\n\n${fallbackContents[0].parts[0].text}`;
            }
            upstream = await fetchWithTimeout(
              endpoint,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
                body: JSON.stringify({ contents: fallbackContents })
              },
              4000
            );
          } else {
            continue;
          }
        }

        if (upstream.status === 429 || upstream.status === 503 || upstream.status === 404) {
          continue;
        }

        const data = await upstream.json();
        const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (reply) {
          if (session.role !== 'guest') {
            await incrementUserStat(session.email, 'chatsCount').catch(() => {});
          }
          return res.status(200).json({ reply });
        }
      } catch {
        // Try next model within budget
      }
    }
  }

  const fallbackReply = await callFallbackEngine(prompt, systemPrompt, history);
  if (fallbackReply) {
    if (session.role !== 'guest') {
      await incrementUserStat(session.email, 'chatsCount').catch(() => {});
    }
    return res.status(200).json({ reply: fallbackReply });
  }

  return res.status(503).json({
    error: 'AI engine is currently experiencing high demand. Please retry shortly.'
  });
};
