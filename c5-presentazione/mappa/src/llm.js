// Adattatore LLM (CONTRATTO.md, sezione 4). Isomorfo: usa `fetch` globale (Node ≥ 18, browser).
//
//   const llm = createLLM();                 // legge le variabili d'ambiente
//   const { text } = await llm.complete({
//     system: 'Sei l\'orchestratore della città.',
//     prompt: 'Riassumi per un cittadino: ...',   // scorciatoia per messages: [{ role: 'user', content }]
//     fallback: 'Testo deterministico da usare se l\'LLM non c\'è o fallisce',
//   });
//   const { json } = await llm.complete({ prompt: '...', json: true, fallback: { azioni: [] } });
//
// Provider (variabile LLM_PROVIDER):
//   mock (predefinito)   nessuna rete; risposte deterministiche (vedi `mockComplete`)
//   anthropic            ANTHROPIC_API_KEY, LLM_MODEL (predefinito claude-opus-5-5)
//   openai-compatible    LLM_BASE_URL, LLM_API_KEY (facoltativa), LLM_MODEL
// Altre variabili: LLM_TIMEOUT_MS (45000), LLM_MAX_TOKENS (4096), LLM_EFFORT (Anthropic),
// LLM_FALLBACKS=0 per non chiedere ad Anthropic il modello di riserva in caso di rifiuto.
//
// Robustezza: `complete()` con `fallback` NON lancia mai eccezioni: se il provider fallisce
// (rete, timeout, 4xx/5xx, JSON non valido) restituisce il fallback con `fallback: true` e
// `error`. Senza `fallback` lancia un `LLMError`.

export const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-5-5';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
// Modelli che accettano output_config.effort e il fallback lato server in caso di rifiuto.
const EFFORT_MODEL_RE = /^claude-(opus|sonnet|haiku|fable|mythos)-5/;
const SERVER_FALLBACK_MODEL_RE = /^claude-(opus-5|fable-5|sonnet-5-5)/;

const JSON_INSTRUCTION =
  'Rispondi SOLO con un oggetto JSON valido: niente testo prima o dopo, niente blocchi di codice.';

export class LLMError extends Error {
  constructor(message, { status, provider } = {}) {
    super(message);
    this.name = 'LLMError';
    this.status = status;
    this.provider = provider;
  }
}

const getEnv = () => (typeof process !== 'undefined' && process.env ? process.env : {});

/**
 * Crea l'adattatore. Tutte le opzioni sono facoltative e, se assenti, arrivano dalle
 * variabili d'ambiente. Una configurazione incompleta non fa fallire l'avvio: si torna
 * a `mock` con un avviso (la demo deve partire comunque).
 *
 * @param {{provider?: 'mock'|'anthropic'|'openai-compatible', model?: string, apiKey?: string,
 *          baseUrl?: string, timeoutMs?: number, maxTokens?: number, effort?: string,
 *          serverFallback?: boolean, fetch?: typeof fetch,
 *          mock?: (req: object) => (string | {text?: string, json?: any} | Promise<any>),
 *          env?: Record<string,string>, log?: {warn: Function, info: Function}}} [opts]
 * @returns {{provider: string, model: string|null, isMock: boolean, warning: string|null,
 *            complete: (req: object) => Promise<{text: string, json?: any, provider: string,
 *            model: string|null, fallback?: boolean, error?: string}>}}
 */
export function createLLM(opts = {}) {
  const env = opts.env || getEnv();
  const log = opts.log || console;
  const doFetch = opts.fetch || (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null);
  let provider = (opts.provider || env.LLM_PROVIDER || 'mock').toLowerCase();
  const timeoutMs = Number(opts.timeoutMs || env.LLM_TIMEOUT_MS || 45_000);
  const maxTokens = Number(opts.maxTokens || env.LLM_MAX_TOKENS || 4096);
  let model = opts.model || env.LLM_MODEL || null;
  let warning = null;

  const toMock = (why) => {
    warning = `LLM "${provider}" non configurato (${why}): uso il provider mock`;
    log.warn?.(`[llm] ${warning}`);
    provider = 'mock';
  };

  let apiKey = null;
  let baseUrl = null;
  if (provider === 'anthropic') {
    apiKey = opts.apiKey || env.ANTHROPIC_API_KEY;
    model = model || DEFAULT_ANTHROPIC_MODEL;
    if (!apiKey) toMock('manca ANTHROPIC_API_KEY');
  } else if (provider === 'openai-compatible' || provider === 'openai') {
    provider = 'openai-compatible';
    apiKey = opts.apiKey || env.LLM_API_KEY || null; // facoltativa (es. Ollama in locale)
    baseUrl = opts.baseUrl || env.LLM_BASE_URL;
    if (!baseUrl) toMock('manca LLM_BASE_URL');
    else if (!model) toMock('manca LLM_MODEL');
  } else if (provider !== 'mock') {
    toMock(`provider sconosciuto, usa mock | anthropic | openai-compatible`);
  }
  if (provider !== 'mock' && !doFetch) toMock('fetch non disponibile');
  if (provider === 'mock') model = 'mock';

  const effort =
    opts.effort ?? env.LLM_EFFORT ?? (provider === 'anthropic' && EFFORT_MODEL_RE.test(model) ? 'low' : undefined);
  const serverFallback =
    opts.serverFallback ?? (env.LLM_FALLBACKS !== '0' && provider === 'anthropic' && SERVER_FALLBACK_MODEL_RE.test(model));

  async function callProvider(req) {
    const { system, messages } = normalizeRequest(req);
    const sys = req.json ? [system, JSON_INSTRUCTION].filter(Boolean).join('\n\n') : system;
    const max = req.maxTokens || maxTokens;
    const ms = req.timeoutMs || timeoutMs;
    if (provider === 'anthropic') {
      const body = { model, max_tokens: max, messages };
      if (sys) body.system = sys;
      if (effort) body.output_config = { effort };
      const headers = {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      };
      if (serverFallback) {
        headers['anthropic-beta'] = 'server-side-fallback-2026-07-01';
        body.fallbacks = 'default';
      }
      const data = await postJson(doFetch, ANTHROPIC_URL, headers, body, ms, 'anthropic');
      if (data.stop_reason === 'refusal') {
        throw new LLMError(`richiesta rifiutata dal modello (${data.stop_details?.category || 'n/d'})`, {
          provider,
        });
      }
      const text = (data.content || [])
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('')
        .trim();
      return { text, usage: data.usage, model: data.model || model };
    }
    // openai-compatible
    const url = /\/chat\/completions\/?$/.test(baseUrl) ? baseUrl : baseUrl.replace(/\/+$/, '') + '/chat/completions';
    const headers = { 'content-type': 'application/json' };
    if (apiKey) headers.authorization = `Bearer ${apiKey}`;
    const body = {
      model,
      max_tokens: max,
      messages: sys ? [{ role: 'system', content: sys }, ...messages] : messages,
    };
    const data = await postJson(doFetch, url, headers, body, ms, 'openai-compatible');
    const text = String(data.choices?.[0]?.message?.content ?? '').trim();
    return { text, usage: data.usage, model: data.model || model };
  }

  async function complete(req = {}) {
    const hasFallback = req.fallback !== undefined;
    if (provider === 'mock') return mockComplete(req, opts.mock);
    try {
      const out = await callProvider(req);
      const result = { text: out.text, provider, model: out.model };
      if (req.json) {
        const parsed = parseJsonLoose(out.text);
        if (parsed === undefined) throw new LLMError('la risposta non contiene JSON valido', { provider });
        result.json = parsed;
      }
      if (!result.text && !req.json) throw new LLMError('risposta vuota', { provider });
      return result;
    } catch (err) {
      const msg = err?.name === 'AbortError' ? `timeout dopo ${req.timeoutMs || timeoutMs} ms` : err.message;
      if (!hasFallback) throw err instanceof LLMError ? err : new LLMError(msg, { provider });
      log.warn?.(`[llm] ${provider}: ${msg}; uso il fallback`);
      return { ...fallbackResult(req), provider, model, fallback: true, error: msg };
    }
  }

  return { provider, model, isMock: provider === 'mock', warning, complete };
}

/**
 * Provider mock: deterministico, senza rete.
 * - con `customMock(req)` usa quella funzione (stringa oppure `{ text, json }`);
 * - altrimenti restituisce `req.fallback` se presente;
 * - altrimenti "riformula" l'ultimo messaggio utente: spazi compattati, tagliato a ~400
 *   caratteri su un confine di frase. Con `json: true` restituisce `{ summary, mock: true }`.
 */
export async function mockComplete(req = {}, customMock) {
  if (customMock) {
    const r = await customMock(req);
    if (typeof r === 'string') return withJson({ text: r }, req);
    if (r && typeof r === 'object') return withJson({ text: r.text ?? JSON.stringify(r.json ?? null), json: r.json }, req);
  }
  if (req.fallback !== undefined) return { ...fallbackResult(req), provider: 'mock', model: 'mock' };
  const { messages } = normalizeRequest(req);
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  const summary = condense(lastUser?.content || '');
  if (req.json) {
    const json = { summary, mock: true };
    return { text: JSON.stringify(json), json, provider: 'mock', model: 'mock' };
  }
  return { text: summary, provider: 'mock', model: 'mock' };
}

function withJson(out, req) {
  const res = { text: out.text ?? '', provider: 'mock', model: 'mock' };
  if (req.json) res.json = out.json !== undefined ? out.json : parseJsonLoose(res.text);
  return res;
}

function fallbackResult(req) {
  const fb = req.fallback;
  if (req.json) {
    const json = typeof fb === 'string' ? (parseJsonLoose(fb) ?? { text: fb }) : fb;
    return { text: typeof fb === 'string' ? fb : JSON.stringify(fb), json };
  }
  return { text: typeof fb === 'string' ? fb : JSON.stringify(fb) };
}

/** Porta `{ system, prompt | messages }` alla forma `{ system, messages: [{role, content}] }`. */
export function normalizeRequest(req = {}) {
  let system = req.system ? String(req.system) : '';
  const messages = [];
  const src = Array.isArray(req.messages) ? req.messages : [];
  for (const m of src) {
    if (!m) continue;
    const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
    if (m.role === 'system') system = [system, content].filter(Boolean).join('\n\n');
    else messages.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content });
  }
  if (req.prompt !== undefined) messages.push({ role: 'user', content: String(req.prompt) });
  if (messages.length === 0) messages.push({ role: 'user', content: '' });
  return { system, messages };
}

function condense(text, max = 400) {
  const s = String(text).replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  return end > max * 0.5 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, '') + '…';
}

/**
 * Estrae un valore JSON da un testo in modo tollerante: blocchi ```json, testo prima o
 * dopo, virgolette tipografiche no. Restituisce `undefined` se non trova JSON valido.
 */
export function parseJsonLoose(text) {
  if (text === null || text === undefined) return undefined;
  if (typeof text !== 'string') return text;
  let s = text.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  try {
    return JSON.parse(s);
  } catch {
    /* continua */
  }
  // primo oggetto/array bilanciato nel testo
  for (let i = 0; i < s.length; i++) {
    const open = s[i];
    if (open !== '{' && open !== '[') continue;
    const close = open === '{' ? '}' : ']';
    let depth = 0;
    let inStr = false;
    for (let j = i; j < s.length; j++) {
      const c = s[j];
      if (inStr) {
        if (c === '\\') j++;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === open) depth++;
      else if (c === close && --depth === 0) {
        try {
          return JSON.parse(s.slice(i, j + 1));
        } catch {
          break;
        }
      }
    }
  }
  return undefined;
}

async function postJson(doFetch, url, headers, body, timeoutMs, provider) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await doFetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: ctrl.signal });
    const raw = await res.text();
    if (!res.ok) {
      let detail = raw.slice(0, 300);
      try {
        const j = JSON.parse(raw);
        detail = j.error?.message || j.message || detail;
      } catch {
        /* testo grezzo */
      }
      throw new LLMError(`HTTP ${res.status}: ${detail}`, { status: res.status, provider });
    }
    try {
      return JSON.parse(raw);
    } catch {
      throw new LLMError('risposta del provider non è JSON', { provider });
    }
  } finally {
    clearTimeout(timer);
  }
}
