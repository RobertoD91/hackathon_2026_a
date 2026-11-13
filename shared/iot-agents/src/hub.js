// Hub HTTP (solo Node): nucleo + API REST + SSE + file statici.
//
//   import { createHub } from '../shared/iot-agents/src/index.js';
//   const hub = createHub({
//     port: 8703,
//     staticDir: new URL('./public/', import.meta.url),   // cartella della dashboard
//     agents: [new Casa(), new Orchestratore()],
//   });
//   await hub.start();     // → { url, dashboardUrl }
//
// API HTTP (CONTRATTO.md):
//   POST /api/readings           lettura (oggetto) o array di letture → 202 { ok, accepted }
//   GET  /api/stream[?types=a,b] Server-Sent Events: un messaggio `data:` JSON per evento
//   GET  /api/state              istantanea dello stato (HubState.snapshot)
//   POST /api/scenario           { name, params?, active?, duration? } → 202 { ok, event }
//   POST /api/chat               { from, text } → 200 { reply }
//   GET  /api/notifications      ?since=<ts>&channel=whatsapp&to=<id> → { notifications, next }
//   GET  /api/health             { ok, uptime }
//
// File statici con percorsi "a specchio" della repo: il file <repo>/c2-x/public/index.html
// è servito su /c2-x/public/index.html, esattamente come su GitHub Pages. Così gli stessi
// percorsi relativi (es. `../../shared/iot-agents/src/client.js`) funzionano in entrambi i
// casi. `/` reindirizza alla cartella `staticDir`. Sono serviti SOLO: `staticDir`,
// `shared/iot-agents/src`, `shared/iot-agents/sim` e le cartelle in `publicDirs`; mai i file
// o le cartelle che iniziano con un punto (.env, .git...).

import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCore } from './core.js';
import { validateReading } from './validate.js';

const LIB_DIR = path.resolve(fileURLToPath(new URL('..', import.meta.url))); // shared/iot-agents
const DEFAULT_ROOT = path.resolve(LIB_DIR, '..', '..');
const MAX_BODY = 64 * 1024;
const MAX_BATCH = 100;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.geojson': 'application/geo+json',
};

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type, authorization, x-hub-token',
  'access-control-max-age': '86400',
};

// path.resolve toglie la barra finale (new URL('./', import.meta.url) ne ha una).
const toPath = (p) => path.resolve(p instanceof URL || String(p).startsWith('file:') ? fileURLToPath(p) : String(p));

/**
 * Crea il hub. Accetta tutte le opzioni di `createCore` più:
 * @param {{port?: number, host?: string, staticDir?: string|URL, publicDirs?: (string|URL)[],
 *          rootDir?: string|URL, token?: string|null, name?: string}} opts
 *   - port: porta (predefinita env PORT o 8701; 0 = porta libera casuale, utile nei test)
 *   - host: interfaccia (predefinita env HOST o 0.0.0.0, raggiungibile dagli ESP32 in LAN)
 *   - staticDir: cartella della dashboard (tutto ciò che contiene diventa pubblico!)
 *   - publicDirs: altre cartelle da servire (es. gli agenti da caricare anche nel browser)
 *   - rootDir: radice dei percorsi a specchio (predefinita: la root della repo)
 *   - token: se impostato (o env HUB_TOKEN) le POST richiedono `Authorization: Bearer <token>`
 *            oppure `?token=<token>`
 * @returns hub = { start, stop, url, dashboardUrl, server, bus, state, llm, log, publish,
 *          ingestReading, scenario, chat, addAgent, agents, subscribe, idle }
 */
export function createHub(opts = {}) {
  const env = process.env;
  const port = opts.port ?? (env.PORT ? Number(env.PORT) : 8701);
  const host = opts.host || env.HOST || '0.0.0.0';
  const token = opts.token !== undefined ? opts.token : env.HUB_TOKEN || null;
  const rootDir = toPath(opts.rootDir || DEFAULT_ROOT);
  const staticDir = opts.staticDir ? toPath(opts.staticDir) : null;
  const allowed = [
    staticDir,
    path.join(LIB_DIR, 'src'),
    path.join(LIB_DIR, 'sim'),
    ...(opts.publicDirs || []).map(toPath),
  ].filter(Boolean);
  const staticRel = staticDir ? path.relative(rootDir, staticDir) : null;
  const staticInsideRoot = staticRel !== null && !staticRel.startsWith('..') && !path.isAbsolute(staticRel);
  const landing = staticDir ? (staticInsideRoot ? '/' + toUrlPath(staticRel) + (staticRel ? '/' : '') : '/') : null;

  const core = createCore(opts);
  const { log, state, bus } = core;
  const sseClients = new Set();
  const startedAt = Date.now();
  let actualPort = port;

  const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      log.error(`errore su ${req.method} ${req.url}:`, err);
      if (!res.headersSent) sendJson(res, 500, { ok: false, error: 'errore interno' });
      else res.end();
    });
  });

  async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;
    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS);
      return res.end();
    }
    if (p.startsWith('/api/')) return handleApi(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { ok: false, error: 'metodo non ammesso' });
    return serveStatic(req, res, url);
  }

  // ------------------------------------------------------------------ API

  async function handleApi(req, res, url) {
    const route = `${req.method} ${url.pathname.replace(/\/+$/, '')}`;
    const isPost = req.method === 'POST';
    if (isPost && token && !authorized(req, url)) {
      return sendJson(res, 401, { ok: false, error: 'token mancante o errato' });
    }
    switch (route) {
      case 'GET /api/health':
        return sendJson(res, 200, { ok: true, uptime: Math.round((Date.now() - startedAt) / 1000) });

      case 'GET /api/state':
        return sendJson(res, 200, state.snapshot());

      case 'GET /api/stream':
        return openStream(req, res, url);

      case 'GET /api/notifications': {
        const q = url.searchParams;
        const sinceRaw = q.get('since');
        const since = sinceRaw === null || sinceRaw === '' ? undefined : Number(sinceRaw);
        if (since !== undefined && !Number.isFinite(since)) {
          return sendJson(res, 400, { ok: false, error: '"since" deve essere un numero (ms epoch)' });
        }
        let list = state.notifications({
          since,
          channel: q.get('channel') || undefined,
          to: q.get('to') || undefined,
        });
        if (since === undefined) list = list.slice(-50);
        const all = state.notifications();
        const lastTs = all.length ? all[all.length - 1].ts : 0;
        // `next` è il valore da passare come `since` alla prossima chiamata.
        const next = list.length ? list[list.length - 1].ts : (since ?? lastTs);
        return sendJson(res, 200, { ok: true, now: Date.now(), next, notifications: list });
      }

      case 'POST /api/readings': {
        const body = await readJson(req, res);
        if (body === undefined) return;
        const items = Array.isArray(body) ? body : [body];
        if (items.length === 0 || items.length > MAX_BATCH) {
          return sendJson(res, 400, { ok: false, error: `servono da 1 a ${MAX_BATCH} letture` });
        }
        for (let i = 0; i < items.length; i++) {
          const v = validateReading(items[i]);
          if (!v.ok) {
            state.countRejected();
            const where = Array.isArray(body) ? `lettura ${i}: ` : '';
            log.warn(`lettura rifiutata da ${req.socket.remoteAddress}: ${where}${v.error}`);
            return sendJson(res, 400, { ok: false, error: where + v.error });
          }
        }
        for (const it of items) core.ingestReading(it);
        return sendJson(res, 202, { ok: true, accepted: items.length });
      }

      case 'POST /api/scenario': {
        const body = await readJson(req, res);
        if (body === undefined) return;
        const r = core.scenario(body?.name, body?.params ?? {}, {
          active: body?.active ?? true,
          duration: body?.duration,
        });
        if (!r.ok) return sendJson(res, 400, r);
        return sendJson(res, 202, { ok: true, event: r.event });
      }

      case 'POST /api/chat': {
        const body = await readJson(req, res);
        if (body === undefined) return;
        if (typeof body?.text !== 'string' || !body.text.trim()) {
          return sendJson(res, 400, { ok: false, error: '"text" obbligatorio' });
        }
        const r = await core.chat({ from: body.from ?? 'anonimo', text: body.text });
        if (r.error) return sendJson(res, 400, { ok: false, error: r.error });
        return sendJson(res, 200, { ok: r.ok, reply: r.reply });
      }

      default:
        return sendJson(res, 404, { ok: false, error: `endpoint sconosciuto: ${req.method} ${url.pathname}` });
    }
  }

  function authorized(req, url) {
    const h = req.headers.authorization || '';
    const t = h.startsWith('Bearer ') ? h.slice(7) : req.headers['x-hub-token'] || url.searchParams.get('token');
    return t === token;
  }

  function openStream(req, res, url) {
    const types = (url.searchParams.get('types') || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    res.writeHead(200, {
      ...CORS,
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    res.write('retry: 3000\n: connesso al hub\n\n');
    const off = bus.subscribe((e) => res.write(`id: ${e.id}\ndata: ${JSON.stringify(e)}\n\n`), {
      types: types.length ? types : undefined,
    });
    const ping = setInterval(() => res.write(': ping\n\n'), 15_000);
    const client = { res, close: () => cleanup() };
    sseClients.add(client);
    log.debug(`SSE: client connesso (${sseClients.size})`);
    function cleanup() {
      clearInterval(ping);
      off();
      sseClients.delete(client);
      res.end();
    }
    req.on('close', cleanup);
  }

  // ------------------------------------------------------------------ file statici

  async function serveStatic(req, res, url) {
    let rel;
    try {
      rel = decodeURIComponent(url.pathname);
    } catch {
      return sendText(res, 400, 'percorso non valido');
    }
    if (rel === '/' && landing && landing !== '/') {
      res.writeHead(302, { ...CORS, location: landing });
      return res.end();
    }
    if (rel === '/' && !staticDir) {
      return sendJson(res, 200, {
        ok: true,
        message: 'Hub IoT + agenti attivo. Nessuna dashboard configurata (opzione staticDir).',
        endpoints: ['/api/readings', '/api/stream', '/api/state', '/api/scenario', '/api/chat', '/api/notifications'],
      });
    }
    const norm = path.posix.normalize(rel);
    if (norm.split('/').some((seg) => seg.startsWith('.') && seg !== '')) return sendText(res, 404, 'non trovato');

    const candidates = [path.join(rootDir, norm)];
    if (staticDir && !staticInsideRoot) candidates.unshift(path.join(staticDir, norm));
    for (const file of candidates) {
      if (!allowed.some((dir) => file === dir || file.startsWith(dir + path.sep))) continue;
      let st;
      try {
        st = await fs.stat(file);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (!url.pathname.endsWith('/')) {
          res.writeHead(301, { ...CORS, location: url.pathname + '/' + url.search });
          return res.end();
        }
        const index = path.join(file, 'index.html');
        try {
          await fs.access(index);
          return sendFile(req, res, index);
        } catch {
          continue;
        }
      }
      if (st.isFile()) return sendFile(req, res, file);
    }
    return sendText(res, 404, 'non trovato');
  }

  async function sendFile(req, res, file) {
    const data = await fs.readFile(file);
    res.writeHead(200, {
      ...CORS,
      'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'content-length': data.length,
      'cache-control': 'no-cache',
    });
    res.end(req.method === 'HEAD' ? undefined : data);
  }

  // ------------------------------------------------------------------ ciclo di vita

  async function start() {
    await core.start();
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => {
        server.off('error', reject);
        resolve();
      });
    });
    actualPort = server.address().port;
    log.info(`hub in ascolto su ${hub.url}` + (staticDir ? ` · dashboard: ${hub.dashboardUrl}` : ''));
    if (token) log.info('token attivo: le POST richiedono Authorization: Bearer <HUB_TOKEN>');
    return { url: hub.url, dashboardUrl: hub.dashboardUrl };
  }

  async function stop() {
    await core.stop();
    for (const c of [...sseClients]) c.close();
    await new Promise((resolve) => {
      if (!server.listening) return resolve();
      server.close(() => resolve());
      server.closeAllConnections?.();
    });
  }

  const hub = {
    ...core,
    start,
    stop,
    server,
    get port() {
      return actualPort;
    },
    get url() {
      return `http://localhost:${actualPort}`;
    },
    get dashboardUrl() {
      return landing ? `http://localhost:${actualPort}${landing}` : null;
    },
  };
  return hub;
}

function toUrlPath(rel) {
  return rel.split(path.sep).map(encodeURIComponent).join('/');
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { ...CORS, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
}

function sendText(res, status, text) {
  res.writeHead(status, { ...CORS, 'content-type': 'text/plain; charset=utf-8' });
  res.end(text);
}

/** Legge il corpo JSON. In caso di errore risponde 400/413 e restituisce undefined. */
async function readJson(req, res) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) {
      sendJson(res, 413, { ok: false, error: `corpo troppo grande (max ${MAX_BODY / 1024} KB)` });
      req.destroy();
      return undefined;
    }
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) {
    sendJson(res, 400, { ok: false, error: 'corpo vuoto: serve un JSON' });
    return undefined;
  }
  try {
    return JSON.parse(raw);
  } catch {
    sendJson(res, 400, { ok: false, error: 'JSON non valido' });
    return undefined;
  }
}
