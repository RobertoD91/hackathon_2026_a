// Nucleo del hub senza HTTP: bus + stato + agenti + LLM. Isomorfo (Node e browser).
//
// In Node si usa di solito `createHub` (hub.js), che aggiunge il server HTTP.
// Nel browser la "modalità demo" delle dashboard usa direttamente `createCore`.
//
//   const core = createCore({ agents: [new Meteo(), new Orchestratore()] });
//   await core.start();
//   core.ingestReading({ deviceId: 'esp32-01', readings: { temperature_c: 31 } });
//   core.scenario('ondata_calore', { zona: 'centro' }, { duration: 60 });
//   const { reply } = await core.chat({ from: 'mario', text: 'che succede?' });
//   await core.idle();   // attende che gli agenti abbiano smaltito gli eventi (utile nei test)
//   await core.stop();
//
// Regole di consegna degli eventi agli agenti:
// - un agente riceve gli eventi dei tipi in `subscribes` ('*' = tutti);
// - non riceve MAI gli eventi pubblicati da lui stesso (niente auto-cicli);
// - `agent.message` arriva solo se `data.to` è il suo nome, '*' oppure assente;
// - ogni agente ha una coda: gli eventi gli arrivano uno alla volta, in ordine;
//   se la coda supera `queueLimit` si scartano le letture più vecchie;
// - un errore in un agente viene registrato e non ferma gli altri;
// - catene di eventi causate da agenti più lunghe di `maxDepth` vengono interrotte
//   (protezione dai cicli tra agenti, es. A risponde a B che risponde ad A...).

import { EventBus } from './bus.js';
import { createEvent, createMonotonicClock } from './events.js';
import { HubState } from './state.js';
import { createLLM } from './llm.js';
import { createLogger } from './log.js';
import { validateReading, validateScenario, validateChat } from './validate.js';

/**
 * @param {{agents?: object[], llm?: object, log?: object, limits?: object,
 *          maxDepth?: number, queueLimit?: number, chatTimeoutMs?: number, slowMs?: number}} [opts]
 *   - agents: istanze di Agent (o oggetti `{ name, subscribes, onEvent }`)
 *   - llm: adattatore già creato con `createLLM()` oppure le sue opzioni; predefinito: da env
 *   - log: logger (`createLogger()`), predefinito con prefisso "hub"
 *   - limits: quanti elementi tiene lo stato (vedi HubState)
 */
export function createCore(opts = {}) {
  const {
    agents = [],
    limits,
    maxDepth = 8,
    queueLimit = 200,
    chatTimeoutMs = 60_000,
    slowMs = 10_000,
  } = opts;
  const log = opts.log || createLogger({ prefix: 'hub' });
  const llm = opts.llm && typeof opts.llm.complete === 'function' ? opts.llm : createLLM({ ...(opts.llm || {}), log });
  const clock = createMonotonicClock();
  const bus = new EventBus({ onError: (err, e) => log.error(`listener del bus in errore su ${e.type}:`, err) });
  const state = new HubState(limits);
  const depthOf = new WeakMap();
  const registry = new Map(); // nome → { agent, queue, running, handled, errors, dropped, lastError, log }
  const timers = new Set();
  const scenarioTimers = new Map();
  const seenDevices = new Set();
  let started = false;

  for (const a of agents) addAgent(a);

  // ------------------------------------------------------------------ agenti

  function addAgent(agent) {
    if (!agent || typeof agent !== 'object') throw new TypeError('agente non valido');
    const name = agent.name;
    if (typeof name !== 'string' || !name) throw new TypeError('ogni agente deve avere un "name"');
    if (registry.has(name)) throw new Error(`agente duplicato: "${name}"`);
    if (agent.subscribes !== undefined && !Array.isArray(agent.subscribes)) {
      throw new TypeError(`agente "${name}": "subscribes" deve essere un array di tipi di evento`);
    }
    if ((agent.subscribes || []).length && typeof agent.onEvent !== 'function') {
      throw new TypeError(`agente "${name}": manca il metodo onEvent(event, ctx)`);
    }
    const entry = {
      agent,
      queue: [],
      running: false,
      handled: 0,
      errors: 0,
      dropped: 0,
      lastError: null,
      log: log.child ? log.child(name) : log,
    };
    registry.set(name, entry);
    updateInfo(entry);
    if (started) Promise.resolve(callHook(entry, 'onStart')).catch(() => {});
    return agent;
  }

  function updateInfo(e) {
    state.setAgentInfo(e.agent.name, {
      subscribes: e.agent.subscribes || [],
      description: e.agent.description || '',
      handled: e.handled,
      errors: e.errors,
      dropped: e.dropped,
      queue: e.queue.length,
      lastError: e.lastError,
    });
  }

  function wants(entry, event) {
    const { agent } = entry;
    if (event.source === agent.name) return false; // protezione dagli auto-cicli
    const subs = agent.subscribes || [];
    if (!subs.includes(event.type) && !subs.includes('*')) return false;
    if (event.type === 'agent.message') {
      const to = event.data?.to;
      if (to && to !== '*' && to !== agent.name) return false;
    }
    return true;
  }

  function dispatch(event) {
    for (const entry of registry.values()) {
      if (!wants(entry, event)) continue;
      if (entry.queue.length >= queueLimit) {
        const i = entry.queue.findIndex((e) => e.type === 'reading');
        entry.queue.splice(i >= 0 ? i : 0, 1);
        entry.dropped++;
        if (entry.dropped === 1 || entry.dropped % 100 === 0) {
          entry.log.warn(`coda piena (${queueLimit}): eventi scartati finora ${entry.dropped}. L'agente è troppo lento?`);
        }
      }
      entry.queue.push(event);
      if (!entry.running) {
        entry.running = true;
        queueMicrotask(() => drain(entry));
      }
    }
  }

  async function drain(entry) {
    while (entry.queue.length) {
      const event = entry.queue.shift();
      const t0 = Date.now();
      try {
        await entry.agent.onEvent(event, makeCtx(entry, event));
        entry.handled++;
      } catch (err) {
        entry.errors++;
        entry.lastError = { ts: Date.now(), message: String(err?.message || err), eventType: event.type };
        entry.log.error(`errore gestendo ${event.type} da ${event.source}:`, err);
      }
      const dt = Date.now() - t0;
      if (dt > slowMs) entry.log.warn(`onEvent lento: ${dt} ms per ${event.type}`);
      updateInfo(entry);
    }
    entry.running = false;
  }

  async function callHook(entry, hook) {
    if (typeof entry.agent[hook] !== 'function') return;
    try {
      await entry.agent[hook](makeCtx(entry, null));
    } catch (err) {
      entry.errors++;
      entry.lastError = { ts: Date.now(), message: String(err?.message || err), eventType: hook };
      entry.log.error(`errore in ${hook}:`, err);
      updateInfo(entry);
    }
  }

  /** Contesto passato agli handler di un agente. `cause` = evento che li ha attivati. */
  function makeCtx(entry, cause) {
    const source = entry.agent.name;
    const pub = (type, data) => publish(type, data, { source, cause });
    const ctx = {
      agent: entry.agent,
      event: cause,
      state,
      llm,
      log: entry.log,
      publish: pub,
      decide(summary, extra = {}) {
        const d = typeof summary === 'object' && summary !== null ? summary : { summary, ...extra };
        return pub('agent.decision', { actions: [], reasoning: '', ...d });
      },
      send(to, text, payload = {}) {
        return pub('agent.message', { to, text, payload });
      },
      notify(channel, to, text, extra = {}) {
        const d = typeof channel === 'object' && channel !== null ? channel : { channel, to, text, ...extra };
        return pub('notify', { channel: 'dashboard', ...d });
      },
      metric(name, value, unit = '', extra = {}) {
        return pub('metric', { name, value, unit, ...extra });
      },
      every(ms, fn) {
        const id = setInterval(() => {
          Promise.resolve()
            .then(() => fn(makeCtx(entry, null)))
            .catch((err) => {
              entry.errors++;
              entry.lastError = { ts: Date.now(), message: String(err?.message || err), eventType: 'every' };
              entry.log.error('errore nel timer:', err);
              updateInfo(entry);
            });
        }, ms);
        timers.add(id);
        return () => {
          clearInterval(id);
          timers.delete(id);
        };
      },
      now: () => Date.now(),
      simTime: () => state.simTime(),
    };
    return ctx;
  }

  // ------------------------------------------------------------------ pubblicazione

  /**
   * Pubblica un evento: aggiorna lo stato, lo manda ai listener del bus (SSE, dashboard)
   * e agli agenti interessati. Restituisce l'evento, o `null` se bloccato dalla
   * protezione dai cicli.
   * @param {string} type
   * @param {object} data
   * @param {{source?: string, cause?: object}} [opts]
   */
  function publish(type, data = {}, { source = 'hub', cause = null } = {}) {
    const depth = cause ? (depthOf.get(cause) ?? 0) + 1 : 0;
    if (depth > maxDepth) {
      log.warn(`catena di eventi troppo lunga (${depth}): scarto ${type} da ${source}. Ciclo tra agenti?`);
      return null;
    }
    const event = createEvent({ type, source, data, ts: clock() });
    depthOf.set(event, depth);
    state.apply(event);
    logEvent(event);
    bus.emit(event);
    dispatch(event);
    return event;
  }

  function logEvent(e) {
    const d = e.data || {};
    switch (e.type) {
      case 'reading': {
        const vals = Object.entries(d.readings || {})
          .map(([k, v]) => `${k}=${typeof v === 'number' ? +v.toFixed(2) : v}`)
          .join(' ');
        if (!seenDevices.has(d.deviceId)) {
          seenDevices.add(d.deviceId);
          const kind = d.meta?.simulated ? 'simulato' : `reale${d.meta?.net ? ', ' + d.meta.net : ''}`;
          log.info(`nuovo dispositivo ${d.deviceId} (zona ${d.location?.zone ?? 'n/d'}, ${kind}): ${vals}`);
        } else log.debug(`lettura ${d.deviceId}: ${vals}`);
        break;
      }
      case 'agent.decision':
        log.info(`[${e.source}] decisione: ${d.summary}`);
        break;
      case 'agent.message':
        log.info(`[${e.source} → ${d.to ?? '*'}] ${d.text}`);
        break;
      case 'notify':
        log.info(`[${e.source}] notifica ${d.channel} a ${d.to}: ${d.text}`);
        break;
      case 'metric':
        log.debug(`[${e.source}] metrica ${d.name} = ${d.value} ${d.unit ?? ''}`);
        break;
      case 'scenario':
        log.info(`scenario ${d.active === false ? 'concluso' : 'avviato'}: ${d.name} ${JSON.stringify(d.params || {})}`);
        break;
      case 'chat':
        log.info(`chat da ${d.from}: "${d.text}" → "${String(d.reply).slice(0, 120)}"`);
        break;
      default:
        log.debug(`[${e.source}] ${e.type}`);
    }
  }

  // ------------------------------------------------------------------ ingressi

  /**
   * Valida e pubblica una lettura (stesso corpo di POST /api/readings).
   * @returns {{ok: true, event: object} | {ok: false, error: string}}
   */
  function ingestReading(body) {
    const r = validateReading(body);
    if (!r.ok) {
      state.countRejected();
      log.warn(`lettura rifiutata: ${r.error}`);
      return r;
    }
    return { ok: true, event: publish('reading', r.value, { source: r.value.deviceId }) };
  }

  /**
   * Pubblica un evento `scenario`. Con `duration` (secondi) pubblica in automatico la
   * fine (`active: false`) allo scadere.
   * @param {string} name
   * @param {object} [params]
   * @param {{active?: boolean, duration?: number, source?: string}} [opts]
   * @returns {{ok: true, event: object} | {ok: false, error: string}}
   */
  function scenario(name, params = {}, { active = true, duration, source = 'scenario' } = {}) {
    const r = validateScenario({ name, params, active, duration });
    if (!r.ok) return r;
    clearTimeout(scenarioTimers.get(name));
    scenarioTimers.delete(name);
    const event = publish('scenario', r.value, { source });
    if (active && duration) {
      const t = setTimeout(() => {
        scenarioTimers.delete(name);
        scenario(name, params, { active: false, source });
      }, duration * 1000);
      scenarioTimers.set(name, t);
    }
    return { ok: true, event };
  }

  /**
   * Inoltra un messaggio di chat all'orchestratore (`onChat`) e pubblica un evento `chat`.
   * Non lancia eccezioni: in caso di errore risponde con un messaggio di scuse.
   * @returns {Promise<{ok: boolean, reply: string, error?: string}>}
   */
  async function chat(body) {
    const v = validateChat(body);
    if (!v.ok) return { ok: false, reply: '', error: v.error };
    const { from, text } = v.value;
    const orch = registry.get('orchestrator');
    let reply;
    let ok = true;
    if (!orch || typeof orch.agent.onChat !== 'function') {
      reply = 'Nessun orchestratore attivo: aggiungi un agente con name = "orchestrator" e un metodo onChat.';
      ok = false;
    } else {
      try {
        const r = await withTimeout(orch.agent.onChat({ from, text }, makeCtx(orch, null)), chatTimeoutMs);
        reply = typeof r === 'string' ? r : (r?.reply ?? '');
      } catch (err) {
        orch.errors++;
        orch.lastError = { ts: Date.now(), message: String(err?.message || err), eventType: 'chat' };
        orch.log.error('errore in onChat:', err);
        updateInfo(orch);
        reply = 'Scusa, in questo momento non riesco a rispondere. Riprova tra poco.';
        ok = false;
      }
    }
    if (!reply) reply = 'Non ho una risposta per questo messaggio.';
    publish('chat', { from, text, reply }, { source: 'chat' });
    return { ok, reply };
  }

  // ------------------------------------------------------------------ ciclo di vita

  async function start() {
    if (started) return;
    started = true;
    const names = [...registry.keys()];
    log.info(`agenti: ${names.length ? names.join(', ') : '(nessuno)'}; LLM: ${llm.provider}${llm.model && llm.model !== 'mock' ? ' ' + llm.model : ''}`);
    if (names.length && !registry.has('orchestrator')) log.warn('nessun agente "orchestrator": /api/chat non avrà risposte');
    for (const e of registry.values()) await callHook(e, 'onStart');
  }

  async function stop() {
    for (const id of timers) clearInterval(id);
    timers.clear();
    for (const t of scenarioTimers.values()) clearTimeout(t);
    scenarioTimers.clear();
    if (started) for (const e of registry.values()) await callHook(e, 'onStop');
    started = false;
  }

  /** Promessa che si risolve quando tutti gli agenti hanno la coda vuota. */
  async function idle({ timeoutMs = 10_000 } = {}) {
    const t0 = Date.now();
    for (;;) {
      const busy = [...registry.values()].some((e) => e.running || e.queue.length);
      if (!busy) return true;
      if (Date.now() - t0 > timeoutMs) return false;
      await new Promise((r) => setTimeout(r, 2));
    }
  }

  return {
    bus,
    state,
    llm,
    log,
    publish,
    ingestReading,
    scenario,
    chat,
    addAgent,
    agents: () => [...registry.values()].map((e) => e.agent),
    subscribe: (fn, o) => bus.subscribe(fn, o),
    start,
    stop,
    idle,
  };
}

function withTimeout(promise, ms) {
  let t;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, rej) => {
      t = setTimeout(() => rej(new Error(`timeout dopo ${ms} ms`)), ms);
    }),
  ]).finally(() => clearTimeout(t));
}
