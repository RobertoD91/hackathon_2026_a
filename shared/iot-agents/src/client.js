// Client per le dashboard (solo browser). Stessa interfaccia in due modalità:
//
// - "live": c'è un hub Node raggiungibile → usa /api/state, /api/stream (SSE), /api/chat...
// - "demo": nessun backend (es. GitHub Pages) → fa girare nel browser lo stesso nucleo
//   (createCore), gli stessi agenti e il simulatore. La dashboard non cambia.
//
//   import { connectHub } from '../src/client.js';
//   const hub = await connectHub({
//     simConfig: './sim-config.json',                          // catalogo scenari + dati in demo
//     demoAgents: async () => (await import('./agents.js')).createAgents(),
//   });
//   hub.mode;                                   // 'live' | 'demo'
//   const state = await hub.getState();         // come GET /api/state
//   const off = hub.on('reading', (evt) => ...);  // tipo, array di tipi o '*'
//   await hub.scenario('ondata_calore', { zona: 'centro' }, { duration: 60 });
//   const { reply } = await hub.chat('Com\'è la situazione?', { from: 'dashboard' });
//   hub.scenarios;                              // catalogo dalla configurazione del simulatore
//   hub.onStatus((s) => ...);                   // 'connected' | 'reconnecting' | 'demo'
//
// Parametri nell'URL della pagina:
//   ?demo=1               forza la modalità demo
//   ?api=http://host:8703 usa un hub su un altro indirizzo (default: stessa origine, /api)
//   ?token=...            token del hub per le POST (se il hub ha HUB_TOKEN)

import { createCore } from './core.js';
import { createLogger } from './log.js';
import { createSimulator } from '../sim/sim-core.js';

export { formatClock, hourOf } from '../sim/sim-core.js';

/**
 * @param {{api?: string, simConfig?: string|object, demoAgents?: () => (object[]|Promise<object[]>),
 *          probeTimeoutMs?: number, forceDemo?: boolean, from?: string}} [opts]
 */
export async function connectHub(opts = {}) {
  const q = new URLSearchParams(location.search);
  const forceDemo = opts.forceDemo ?? (q.get('demo') === '1' || q.get('demo') === 'true');
  const apiParam = q.get('api');
  const api = (apiParam ? apiParam.replace(/\/+$/, '') + '/api' : opts.api || new URL('/api', location.origin).href).replace(/\/+$/, '');
  const token = q.get('token') || null;

  const simConfig = await loadConfig(opts.simConfig);
  const scenarios = simConfig?.scenarios || [];

  if (!forceDemo && location.protocol.startsWith('http') && (await probe(api, opts.probeTimeoutMs ?? 1500))) {
    return liveClient(api, token, scenarios, simConfig);
  }
  return demoClient(opts, scenarios, simConfig);
}

async function loadConfig(src) {
  if (!src) return null;
  if (typeof src === 'object') return src;
  try {
    const res = await fetch(src, { cache: 'no-cache' });
    return await res.json();
  } catch (err) {
    console.warn('[client] configurazione del simulatore non caricata:', err);
    return null;
  }
}

async function probe(api, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(api + '/state', { signal: ctrl.signal, cache: 'no-store' });
    if (!res.ok) return false;
    const j = await res.json();
    return j && j.ok === true && typeof j.devices === 'object';
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

function makeListeners() {
  const set = new Set();
  return {
    add(types, fn) {
      const list = types === undefined || types === '*' ? null : new Set([].concat(types));
      const entry = { list, fn };
      set.add(entry);
      return () => set.delete(entry);
    },
    emit(evt) {
      for (const { list, fn } of set) {
        if (list && !list.has(evt.type)) continue;
        try {
          fn(evt);
        } catch (err) {
          console.error('[client] listener in errore:', err);
        }
      }
    },
  };
}

function liveClient(api, token, scenarios, simConfig) {
  const listeners = makeListeners();
  const statusFns = new Set();
  let status = 'reconnecting';
  const setStatus = (s) => {
    if (s === status) return;
    status = s;
    statusFns.forEach((f) => f(s));
  };
  const es = new EventSource(api + '/stream');
  es.onopen = () => setStatus('connected');
  es.onerror = () => setStatus('reconnecting');
  es.onmessage = (m) => {
    try {
      listeners.emit(JSON.parse(m.data));
    } catch (err) {
      console.warn('[client] messaggio SSE non valido', err);
    }
  };

  const post = async (path, body) => {
    const headers = { 'content-type': 'application/json' };
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await fetch(api + path, { method: 'POST', headers, body: JSON.stringify(body) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok && !('reply' in j)) throw new Error(j.error || `HTTP ${res.status}`);
    return j;
  };

  return {
    mode: 'live',
    api,
    scenarios,
    simConfig,
    get status() {
      return status;
    },
    onStatus: (fn) => (statusFns.add(fn), () => statusFns.delete(fn)),
    on: (types, fn) => (typeof types === 'function' ? listeners.add('*', types) : listeners.add(types, fn)),
    getState: async () => (await fetch(api + '/state', { cache: 'no-store' })).json(),
    scenario: (name, params = {}, { duration, active = true } = {}) => post('/scenario', { name, params, duration, active }),
    chat: (text, { from = 'dashboard' } = {}) => post('/chat', { from, text }),
    sendReading: (body) => post('/readings', body),
    close: () => es.close(),
  };
}

async function demoClient(opts, scenarios, simConfig) {
  const log = createLogger({ prefix: 'demo', level: 'info' });
  const agents = opts.demoAgents ? await opts.demoAgents() : [];
  const core = createCore({ agents, log });
  await core.start();
  let sim = null;
  if (simConfig) {
    sim = createSimulator(simConfig, {
      emit: (r) => core.ingestReading(r),
      emitScenario: (s) => core.scenario(s.name, s.params, { active: s.active, duration: s.duration }),
      selfTrigger: false,
    });
    core.bus.subscribe((e) => sim.onScenarioEvent(e.data), { types: ['scenario'] });
    sim.start();
  } else {
    log.warn('modalità demo senza simConfig: nessun dato simulato');
  }
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const fail = (r) => {
    if (!r.ok) throw new Error(r.error);
    return { ok: true, event: r.event };
  };
  return {
    mode: 'demo',
    api: null,
    scenarios,
    simConfig,
    core,
    sim,
    status: 'demo',
    onStatus: (fn) => (fn('demo'), () => {}),
    on: (types, fn) => {
      if (typeof types === 'function') return core.bus.subscribe((e) => types(clone(e)));
      const list = types === '*' ? undefined : [].concat(types);
      return core.bus.subscribe((e) => fn(clone(e)), { types: list });
    },
    getState: async () => clone(core.state.snapshot()),
    scenario: async (name, params = {}, { duration, active = true } = {}) =>
      fail(core.scenario(name, params, { duration, active })),
    chat: async (text, { from = 'dashboard' } = {}) => core.chat({ from, text }),
    sendReading: async (body) => fail(core.ingestReading(body)),
    close: async () => {
      sim?.stop();
      await core.stop();
    },
  };
}
