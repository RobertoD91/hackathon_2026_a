// Adattatore LLM (solo Node), stesse convenzioni di shared/iot-agents/CONTRATTO.md §4:
//   llm.complete({ system, messages, json, images }) → { text, json? }
// Provider scelto con variabili d'ambiente:
//   LLM_PROVIDER=mock (predefinito) | anthropic | openai-compatible
//   anthropic:          ANTHROPIC_API_KEY, LLM_MODEL facoltativo
//   openai-compatible:  LLM_BASE_URL, LLM_API_KEY, LLM_MODEL
// Nessuna chiave nel codice: tutto arriva dall'ambiente.

const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-5-5';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
// ANTHROPIC_BASE_URL facoltativo (proxy o test locale)
const ANTHROPIC_VERSION = '2026-10-21';

export function createLlm(env = process.env) {
  const provider = (env.LLM_PROVIDER || 'mock').trim().toLowerCase();
  const timeoutMs = Number(env.LLM_TIMEOUT_MS || 90000);
  if (provider === 'anthropic') {
    if (!env.ANTHROPIC_API_KEY) throw new Error('LLM_PROVIDER=anthropic richiede ANTHROPIC_API_KEY');
    return anthropic({ url: env.ANTHROPIC_BASE_URL ? `${env.ANTHROPIC_BASE_URL.replace(/\/+$/, '')}/v1/messages` : ANTHROPIC_URL, key: env.ANTHROPIC_API_KEY, model: env.LLM_MODEL || DEFAULT_ANTHROPIC_MODEL, effort: env.LLM_EFFORT || 'low', timeoutMs });
  }
  if (provider === 'openai-compatible' || provider === 'openai') {
    if (!env.LLM_BASE_URL) throw new Error('LLM_PROVIDER=openai-compatible richiede LLM_BASE_URL');
    if (!env.LLM_MODEL) throw new Error('LLM_PROVIDER=openai-compatible richiede LLM_MODEL');
    return openaiCompatible({ baseUrl: env.LLM_BASE_URL, key: env.LLM_API_KEY || '', model: env.LLM_MODEL, timeoutMs });
  }
  return mock();
}

/** Mock: nessuna rete. La simulazione in questo caso usa solo il modello euristico. */
function mock() {
  return {
    provider: 'mock',
    model: 'euristico',
    isMock: true,
    async complete() {
      return { text: '', json: null };
    },
  };
}

function parseDataUrl(dataUrl) {
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(dataUrl || '');
  return m ? { mediaType: m[1], data: m[2] } : null;
}

/** Estrae il primo oggetto JSON dal testo (tollera ```json ... ```). */
export function extractJson(text) {
  if (!text) return null;
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const src = fenced ? fenced[1] : text;
  const start = src.search(/[[{]/);
  if (start < 0) return null;
  const open = src[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0; let inStr = false; let esc = false;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close && --depth === 0) {
      try { return JSON.parse(src.slice(start, i + 1)); } catch { return null; }
    }
  }
  return null;
}

async function postJson(url, headers, body, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: ctrl.signal });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    if (!res.ok) {
      const msg = data?.error?.message || data?.message || text.slice(0, 300);
      const err = new Error(`HTTP ${res.status}: ${msg}`);
      err.status = res.status;
      throw err;
    }
    return data;
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`timeout dopo ${timeoutMs} ms`);
    throw err;
  } finally {
    clearTimeout(t);
  }
}

/** Anthropic Messages API, chiamata HTTP diretta con fetch (niente SDK). */
function anthropic({ url, key, model, effort, timeoutMs }) {
  // fallback lato server in caso di rifiuto: disponibile sui modelli recenti
  const supportsFallback = /^claude-(opus-5|fable-5|mythos-5|sonnet-5-5)/.test(model);
  const supportsEffort = /^claude-(opus-(4-[5-9]|5)|fable|mythos|sonnet-(4-6|5)|haiku-5)/.test(model);
  return {
    provider: 'anthropic',
    model,
    isMock: false,
    async complete({ system, messages, images = [], maxTokens = 4000 }) {
      const msgs = messages.map((m, i) => {
        if (m.role !== 'user' || i !== messages.length - 1 || !images.length) return m;
        const blocks = [];
        for (const img of images) {
          const p = parseDataUrl(img);
          if (p) blocks.push({ type: 'image', source: { type: 'base64', media_type: p.mediaType, data: p.data } });
        }
        blocks.push({ type: 'text', text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) });
        return { role: 'user', content: blocks };
      });
      const body = { model, max_tokens: maxTokens, system, messages: msgs };
      if (supportsEffort && effort) body.output_config = { effort };
      const headers = { 'x-api-key': key, 'anthropic-version': ANTHROPIC_VERSION };
      if (supportsFallback) {
        body.fallbacks = 'default';
        headers['anthropic-beta'] = 'server-side-fallback-2026-07-01';
      }
      const data = await postJson(url, headers, body, timeoutMs);
      if (data.stop_reason === 'refusal') throw new Error('il modello ha rifiutato la richiesta');
      const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
      return { text, json: extractJson(text), usage: data.usage, model: data.model };
    },
  };
}

/** Qualsiasi endpoint compatibile con /chat/completions (OpenAI, OpenRouter, vLLM, proxy...). */
function openaiCompatible({ baseUrl, key, model, timeoutMs }) {
  const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
  return {
    provider: 'openai-compatible',
    model,
    isMock: false,
    async complete({ system, messages, images = [], maxTokens = 4000, json }) {
      const msgs = [{ role: 'system', content: system }, ...messages.map((m, i) => {
        if (m.role !== 'user' || i !== messages.length - 1 || !images.length) return m;
        return {
          role: 'user',
          content: [
            ...images.filter(Boolean).map((u) => ({ type: 'image_url', image_url: { url: u } })),
            { type: 'text', text: m.content },
          ],
        };
      })];
      const body = { model, messages: msgs, max_tokens: maxTokens };
      if (json) body.response_format = { type: 'json_object' };
      const headers = key ? { authorization: `Bearer ${key}` } : {};
      let data;
      try {
        data = await postJson(url, headers, body, timeoutMs);
      } catch (err) {
        // alcuni endpoint non accettano response_format: riprova senza
        if (json && err.status === 400) {
          delete body.response_format;
          data = await postJson(url, headers, body, timeoutMs);
        } else throw err;
      }
      const text = data.choices?.[0]?.message?.content || '';
      return { text, json: extractJson(text), usage: data.usage, model: data.model || model };
    },
  };
}
