import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLLM, parseJsonLoose, LLMError } from '../src/llm.js';

const quiet = { warn() {}, info() {} };

/** fetch finto che registra la richiesta e restituisce `reply`. */
function fakeFetch(reply, { status = 200, delayMs = 0 } = {}) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    if (delayMs) {
      await new Promise((res, rej) => {
        const t = setTimeout(res, delayMs);
        init.signal?.addEventListener('abort', () => {
          clearTimeout(t);
          const e = new Error('aborted');
          e.name = 'AbortError';
          rej(e);
        });
      });
    }
    const text = typeof reply === 'string' ? reply : JSON.stringify(reply);
    return { ok: status < 400, status, text: async () => text };
  };
  fn.calls = calls;
  return fn;
}

test('mock predefinito: deterministico, riformula l\'ultimo messaggio', async () => {
  const llm = createLLM({ env: {} });
  assert.equal(llm.provider, 'mock');
  assert.equal(llm.isMock, true);
  const a = await llm.complete({ system: 's', prompt: '  Riassunto:   caldo in   zona centro. ' });
  const b = await llm.complete({ system: 's', prompt: '  Riassunto:   caldo in   zona centro. ' });
  assert.equal(a.text, 'Riassunto: caldo in zona centro.');
  assert.deepEqual(a, b);
  const long = await llm.complete({ prompt: 'Frase uno. '.repeat(100) });
  assert.ok(long.text.length <= 401);
});

test('mock: fallback, json e mock personalizzato', async () => {
  const llm = createLLM({ env: {} });
  assert.equal((await llm.complete({ prompt: 'x', fallback: 'testo deterministico' })).text, 'testo deterministico');
  const j = await llm.complete({ prompt: 'decidi', json: true });
  assert.equal(j.json.mock, true);
  const jf = await llm.complete({ prompt: 'decidi', json: true, fallback: { azioni: ['bus'] } });
  assert.deepEqual(jf.json, { azioni: ['bus'] });
  const custom = createLLM({ env: {}, mock: (req) => ({ json: { eco: req.messages?.[0]?.content ?? req.prompt } }) });
  assert.deepEqual((await custom.complete({ prompt: 'p', json: true })).json, { eco: 'p' });
});

test('configurazione incompleta: si torna a mock senza eccezioni', () => {
  const a = createLLM({ env: { LLM_PROVIDER: 'anthropic' }, log: quiet });
  assert.equal(a.provider, 'mock');
  assert.match(a.warning, /ANTHROPIC_API_KEY/);
  const b = createLLM({ env: { LLM_PROVIDER: 'openai-compatible', LLM_BASE_URL: 'http://x' }, log: quiet });
  assert.equal(b.provider, 'mock');
  assert.match(b.warning, /LLM_MODEL/);
});

test('anthropic: formato della richiesta e parse della risposta', async () => {
  const f = fakeFetch({
    model: 'claude-opus-5-5',
    stop_reason: 'end_turn',
    content: [
      { type: 'thinking', thinking: '' },
      { type: 'text', text: 'Ciao ' },
      { type: 'text', text: 'Napoli' },
    ],
  });
  const llm = createLLM({ env: { LLM_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'k-test' }, fetch: f });
  assert.equal(llm.model, 'claude-opus-5-5');
  const r = await llm.complete({ system: 'sys', messages: [{ role: 'user', content: 'ciao' }] });
  assert.equal(r.text, 'Ciao Napoli');
  const { url, init, body } = f.calls[0];
  assert.equal(url, 'https://api.anthropic.com/v1/messages');
  assert.equal(init.headers['x-api-key'], 'k-test');
  assert.equal(init.headers['anthropic-version'], '2023-06-01');
  assert.equal(body.system, 'sys');
  assert.deepEqual(body.messages, [{ role: 'user', content: 'ciao' }]);
  assert.equal(body.output_config.effort, 'low');
  assert.equal(body.temperature, undefined);
});

test('anthropic json: istruzione nel system e parse robusto', async () => {
  const f = fakeFetch({ content: [{ type: 'text', text: 'Ecco:\n```json\n{"azione": "bus", "n": 3}\n```' }] });
  const llm = createLLM({ provider: 'anthropic', apiKey: 'k', fetch: f, env: {} });
  const r = await llm.complete({ prompt: 'x', json: true });
  assert.deepEqual(r.json, { azione: 'bus', n: 3 });
  assert.match(f.calls[0].body.system, /JSON/);
});

test('anthropic: rifiuto ed errori HTTP', async () => {
  const refusal = createLLM({ provider: 'anthropic', apiKey: 'k', env: {}, log: quiet, fetch: fakeFetch({ stop_reason: 'refusal', content: [] }) });
  await assert.rejects(refusal.complete({ prompt: 'x' }), LLMError);
  const err = createLLM({
    provider: 'anthropic',
    apiKey: 'k',
    env: {},
    log: quiet,
    fetch: fakeFetch({ error: { message: 'chiave non valida' } }, { status: 401 }),
  });
  await assert.rejects(err.complete({ prompt: 'x' }), /HTTP 401: chiave non valida/);
  const fb = await err.complete({ prompt: 'x', fallback: 'riserva' });
  assert.equal(fb.text, 'riserva');
  assert.equal(fb.fallback, true);
  assert.match(fb.error, /401/);
});

test('timeout gestito con fallback', async () => {
  const llm = createLLM({ provider: 'anthropic', apiKey: 'k', env: {}, log: quiet, timeoutMs: 30, fetch: fakeFetch({}, { delayMs: 500 }) });
  const r = await llm.complete({ prompt: 'x', fallback: 'tardi' });
  assert.equal(r.text, 'tardi');
  assert.match(r.error, /timeout/);
});

test('openai-compatible: URL, header e risposta', async () => {
  const f = fakeFetch({ choices: [{ message: { content: '{"ok": true}' } }] });
  const llm = createLLM({
    env: { LLM_PROVIDER: 'openai-compatible', LLM_BASE_URL: 'http://localhost:11434/v1/', LLM_API_KEY: 'sk', LLM_MODEL: 'llama3' },
    fetch: f,
  });
  const r = await llm.complete({ system: 'sys', prompt: 'p', json: true });
  assert.deepEqual(r.json, { ok: true });
  const { url, init, body } = f.calls[0];
  assert.equal(url, 'http://localhost:11434/v1/chat/completions');
  assert.equal(init.headers.authorization, 'Bearer sk');
  assert.equal(body.model, 'llama3');
  assert.equal(body.messages[0].role, 'system');
  assert.deepEqual(body.messages[1], { role: 'user', content: 'p' });
});

test('parseJsonLoose', () => {
  assert.deepEqual(parseJsonLoose('{"a":1}'), { a: 1 });
  assert.deepEqual(parseJsonLoose('testo prima {"a": {"b": "}"}} testo dopo'), { a: { b: '}' } });
  assert.deepEqual(parseJsonLoose('```\n[1,2]\n```'), [1, 2]);
  assert.equal(parseJsonLoose('niente json qui'), undefined);
  assert.equal(parseJsonLoose('{rotto'), undefined);
});
