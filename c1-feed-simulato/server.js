#!/usr/bin/env node
// Feed simulato (Challenge 01, Bhblasted): server senza dipendenze npm.
//   node c1-feed-simulato/server.js            → http://localhost:8702
// Serve i file statici della cartella e le API:
//   GET  /api/health     provider LLM attivo
//   POST /api/simulate   { annunci: [...], config: {...} } → simulazione
//                        (con "Accept: application/x-ndjson" manda anche l'avanzamento)
//   POST /api/import     { testo, nome } → annunci normalizzati da JSON/CSV
// LLM: LLM_PROVIDER=mock (predefinito) | anthropic | openai-compatible (vedi README).

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadData, normalizeAd, importAds, runSimulation, VERSIONE_MODELLO } from './src/core/index.js';
import { createLlm } from './src/llm/adapter.js';
import { makeRefiner } from './src/llm/persona-llm.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8702);
const MAX_BODY = 30 * 1024 * 1024;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.csv': 'text/csv; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon',
};

let llm;
try {
  llm = createLlm();
} catch (err) {
  console.error(`[llm] ${err.message}: uso la modalità mock.`);
  llm = createLlm({ LLM_PROVIDER: 'mock' });
}
const llmCache = new Map();
const data = await loadData();

function send(res, status, body, headers = {}) {
  const isObj = typeof body === 'object' && !Buffer.isBuffer(body);
  res.writeHead(status, { 'content-type': isObj ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(isObj ? JSON.stringify(body) : body);
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) throw Object.assign(new Error('Richiesta troppo grande (max 30 MB)'), { status: 413 });
    chunks.push(c);
  }
  const txt = Buffer.concat(chunks).toString('utf8');
  if (!txt) return {};
  try { return JSON.parse(txt); } catch { throw Object.assign(new Error('JSON non valido'), { status: 400 }); }
}

/** Immagine da passare all'LLM: data URL dal browser, oppure file locale della cartella. */
async function resolveImage(raw, ad) {
  const src = raw.immagineLlm || ad.immagine;
  if (!src) return null;
  if (src.startsWith('data:image/')) return src;
  if (/^https?:/i.test(src)) return null;
  const file = path.resolve(ROOT, src.replace(/^\.?\//, ''));
  if (!file.startsWith(ROOT + path.sep)) return null;
  const ext = path.extname(file).toLowerCase();
  if (!['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(ext)) return null;
  try {
    const buf = await fs.readFile(file);
    return `data:${MIME[ext]};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

async function handleSimulate(req, res) {
  const body = await readBody(req);
  const lista = Array.isArray(body) ? body : body.annunci || body.ads;
  if (!Array.isArray(lista) || !lista.length) return send(res, 400, { ok: false, error: 'Serve un elenco "annunci" non vuoto' });
  if (lista.length > 12) return send(res, 400, { ok: false, error: 'Al massimo 12 annunci per simulazione' });
  const seen = new Set();
  const images = new Map();
  const ads = [];
  for (const [i, raw] of lista.entries()) {
    const ad = normalizeAd(raw, i);
    if (seen.has(ad.id)) ad.id = `${ad.id}-${i}`;
    seen.add(ad.id);
    ads.push(ad);
    if (!llm.isMock) images.set(ad.id, await resolveImage(raw, ad));
  }
  const config = body.config || {};
  const useLlm = !llm.isMock && config.usaLlm !== false;
  const stream = (req.headers.accept || '').includes('application/x-ndjson');
  if (stream) res.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' });
  const t0 = Date.now();
  const sim = await runSimulation({
    ads,
    data,
    config: { ...config, concorrenza: Number(process.env.LLM_CONCURRENCY || 6), campioneLlm: Number(process.env.LLM_SAMPLE || config.campioneLlm || 4) },
    refine: useLlm ? makeRefiner(llm, { cache: llmCache, imageFor: (ad) => images.get(ad.id) }) : undefined,
    modo: useLlm ? llm.provider : 'mock',
    modello: useLlm ? llm.model : VERSIONE_MODELLO,
    onProgress: stream ? (done, total, msg) => res.write(`${JSON.stringify({ type: 'progress', done, total, msg })}\n`) : undefined,
  });
  sim.durataMs = Date.now() - t0;
  console.log(`[simulate] ${ads.length} annunci, modo ${sim.modo}, ${sim.durataMs} ms${sim.llmErrori.length ? `, ${sim.llmErrori.length} errori LLM` : ''}`);
  if (sim.llmErrori.length) console.log(`  primo errore: ${sim.llmErrori[0]}`);
  if (stream) {
    res.write(`${JSON.stringify({ type: 'result', result: sim })}\n`);
    res.end();
  } else send(res, 200, sim);
}

async function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.resolve(ROOT, `.${rel}`);
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) return send(res, 403, 'Vietato');
  try {
    const st = await fs.stat(file);
    if (st.isDirectory()) return send(res, 301, '', { location: `${urlPath}/` });
    let buf = await fs.readFile(file);
    if (file === path.join(ROOT, 'index.html')) {
      buf = Buffer.from(buf.toString('utf8').replace('<meta name="c1-backend" content="" />', '<meta name="c1-backend" content="api" />'));
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : buf);
  } catch {
    send(res, 404, 'Non trovato');
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname === '/api/health') {
      return send(res, 200, { ok: true, provider: llm.provider, model: llm.model, llm: !llm.isMock, versione: VERSIONE_MODELLO });
    }
    if (url.pathname === '/api/simulate' && req.method === 'POST') return await handleSimulate(req, res);
    if (url.pathname === '/api/import' && req.method === 'POST') {
      const body = await readBody(req);
      return send(res, 200, { ok: true, annunci: importAds(String(body.testo || ''), String(body.nome || '')) });
    }
    if (url.pathname.startsWith('/api/')) return send(res, 404, { ok: false, error: 'Endpoint sconosciuto' });
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Metodo non consentito');
    return await serveStatic(req, res, url.pathname);
  } catch (err) {
    console.error('[errore]', err);
    if (res.headersSent) {
      try { res.end(`${JSON.stringify({ type: 'error', error: err.message })}\n`); } catch { /* connessione chiusa */ }
      return;
    }
    send(res, err.status || 500, { ok: false, error: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`Feed simulato su http://localhost:${PORT}/  (LLM: ${llm.provider}${llm.isMock ? '' : `, modello ${llm.model}`})`);
});
