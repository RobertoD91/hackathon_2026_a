// Stato condiviso del hub. Isomorfo.
//
// Il nucleo aggiorna lo stato con `apply(event)` per ogni evento pubblicato;
// agenti e dashboard lo leggono (gli agenti tramite `ctx.state`, in sola lettura:
// gli oggetti restituiti sono congelati).
//
// Metodi di lettura principali:
//   state.devices()                      → [dispositivo]
//   state.device('esp32-01')             → dispositivo | undefined
//   state.byZone('plebiscito')           → [dispositivo]
//   state.zones()                        → ['plebiscito', ...]
//   state.values('temperature_c', { zone })   → [{ deviceId, zone, value, ts }]
//   state.average('temperature_c', { zone })  → numero | null
//   state.sum('power_w', { zone })            → numero | null
//   state.metric('kwh_condivisi')        → { name, value, unit, ts, source } | undefined
//   state.metrics()                      → { nome: metrica }
//   state.decisions(10)                  → ultimi eventi agent.decision (dal più vecchio)
//   state.notifications({ since, channel })   → eventi notify
//   state.isActive('metro_guasto')       → boolean
//   state.activeScenarios()              → [{ name, params, since, until? }]
//   state.simTime()                      → ora simulata in ms (vedi sotto)
//   state.snapshot()                     → oggetto JSON di GET /api/state
//
// Un "dispositivo" è:
//   { deviceId, zone, location, readings, readingTs, meta, ts, receivedAt, count,
//     simulated, history: { grandezza: [[ts, valore], ...] } }
// `readings` unisce le ultime letture ricevute (una lettura parziale non cancella le altre
// grandezze); `readingTs[grandezza]` dice quando è arrivato ogni valore.
//
// Ora simulata: il simulatore manda `meta.simTime` (ms) e `meta.speed` (secondi simulati
// per secondo reale). `simTime()` estrapola l'ora simulata corrente; senza simulatore
// coincide con l'ora reale. Gli agenti la usano per ragionare sull'ora del giorno.

const freeze = Object.freeze;

export class HubState {
  #devices = new Map();
  #metrics = new Map();
  #decisions = [];
  #notifications = [];
  #messages = [];
  #scenarioEvents = [];
  #chats = [];
  #active = new Map();
  #agents = new Map();
  #clock = null; // { sim, real, speed }
  #stats = { events: 0, readings: 0, rejected: 0, startedAt: Date.now() };
  #limits;

  /**
   * @param {{maxDecisions?: number, maxNotifications?: number, maxMessages?: number,
   *          maxScenarios?: number, maxChats?: number, historySize?: number}} [limits]
   */
  constructor(limits = {}) {
    this.#limits = {
      maxDecisions: 50,
      maxNotifications: 200,
      maxMessages: 100,
      maxScenarios: 50,
      maxChats: 50,
      historySize: 60,
      ...limits,
    };
  }

  // ---------------------------------------------------------------- scrittura (solo il nucleo)

  /** Aggiorna lo stato con un evento. Chiamato dal nucleo, non dagli agenti. */
  apply(event) {
    this.#stats.events++;
    const L = this.#limits;
    switch (event.type) {
      case 'reading':
        this.#applyReading(event);
        break;
      case 'agent.decision':
        push(this.#decisions, event, L.maxDecisions);
        if (event.data?.metrics && typeof event.data.metrics === 'object') {
          for (const [name, v] of Object.entries(event.data.metrics)) {
            if (typeof v === 'number') this.#setMetric({ name, value: v }, event);
            else if (v && typeof v === 'object' && typeof v.value === 'number') this.#setMetric({ name, ...v }, event);
          }
        }
        break;
      case 'notify':
        push(this.#notifications, event, L.maxNotifications);
        break;
      case 'agent.message':
        push(this.#messages, event, L.maxMessages);
        break;
      case 'metric':
        if (event.data && typeof event.data.name === 'string') this.#setMetric(event.data, event);
        break;
      case 'scenario': {
        push(this.#scenarioEvents, event, L.maxScenarios);
        const { name, params = {}, active = true, duration } = event.data || {};
        if (!name) break;
        if (active === false) this.#active.delete(name);
        else {
          const entry = { name, params, since: event.ts };
          if (duration) entry.until = event.ts + duration * 1000;
          this.#active.set(name, freeze(entry));
        }
        break;
      }
      case 'chat':
        push(this.#chats, event, L.maxChats);
        break;
      default:
        break;
    }
  }

  /** Conta una lettura rifiutata dalla validazione. */
  countRejected() {
    this.#stats.rejected++;
  }

  /** Aggiorna le statistiche di un agente (usato dal nucleo). */
  setAgentInfo(name, info) {
    this.#agents.set(name, freeze({ ...(this.#agents.get(name) || {}), ...info, name }));
  }

  #applyReading(event) {
    this.#stats.readings++;
    const r = event.data;
    const prev = this.#devices.get(r.deviceId);
    const readings = { ...(prev?.readings || {}), ...r.readings };
    const readingTs = { ...(prev?.readingTs || {}) };
    const history = { ...(prev?.history || {}) };
    for (const [k, v] of Object.entries(r.readings)) {
      readingTs[k] = r.ts;
      if (typeof v === 'number') {
        const h = (history[k] || []).concat([freeze([r.ts, v])]);
        if (h.length > this.#limits.historySize) h.splice(0, h.length - this.#limits.historySize);
        history[k] = freeze(h);
      }
    }
    const location = r.location || prev?.location || null;
    const meta = r.meta || {};
    const entry = {
      deviceId: r.deviceId,
      zone: location?.zone ?? null,
      location: location ? freeze({ ...location }) : null,
      readings: freeze(readings),
      readingTs: freeze(readingTs),
      meta: freeze({ ...meta }),
      ts: r.ts,
      receivedAt: event.ts,
      count: (prev?.count || 0) + 1,
      simulated: meta.simulated === true,
      history: freeze(history),
    };
    this.#devices.set(r.deviceId, freeze(entry));

    if (typeof meta.simTime === 'number' && Number.isFinite(meta.simTime)) {
      const speed = typeof meta.speed === 'number' && meta.speed > 0 ? meta.speed : 1;
      this.#clock = { sim: meta.simTime, real: event.ts, speed };
    }
  }

  #setMetric(m, event) {
    const entry = { name: m.name, value: m.value, unit: m.unit ?? '', ts: event.ts, source: event.source };
    if (m.label) entry.label = m.label;
    this.#metrics.set(m.name, freeze(entry));
  }

  // ---------------------------------------------------------------- lettura

  devices() {
    return [...this.#devices.values()];
  }

  device(id) {
    return this.#devices.get(id);
  }

  byZone(zone) {
    return this.devices().filter((d) => d.zone === zone);
  }

  zones() {
    return [...new Set(this.devices().map((d) => d.zone).filter(Boolean))];
  }

  /** Valori di una grandezza su tutti i dispositivi (o su una zona). */
  values(key, { zone } = {}) {
    const out = [];
    for (const d of this.#devices.values()) {
      if (zone !== undefined && d.zone !== zone) continue;
      if (!(key in d.readings)) continue;
      out.push({ deviceId: d.deviceId, zone: d.zone, value: d.readings[key], ts: d.readingTs[key] });
    }
    return out;
  }

  average(key, opts) {
    const nums = this.values(key, opts).map((v) => v.value).filter((v) => typeof v === 'number');
    return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
  }

  sum(key, opts) {
    const nums = this.values(key, opts).map((v) => v.value).filter((v) => typeof v === 'number');
    return nums.length ? nums.reduce((a, b) => a + b, 0) : null;
  }

  metric(name) {
    return this.#metrics.get(name);
  }

  metrics() {
    return Object.fromEntries(this.#metrics);
  }

  decisions(n = this.#limits.maxDecisions) {
    return this.#decisions.slice(-n);
  }

  messages(n = this.#limits.maxMessages) {
    return this.#messages.slice(-n);
  }

  chats(n = this.#limits.maxChats) {
    return this.#chats.slice(-n);
  }

  /** Eventi `notify` con ts > since (facoltativo), filtrati per canale (facoltativo). */
  notifications({ since, channel, to } = {}) {
    return this.#notifications.filter(
      (e) =>
        (since === undefined || e.ts > since) &&
        (channel === undefined || e.data?.channel === channel) &&
        (to === undefined || e.data?.to === to),
    );
  }

  isActive(name) {
    return this.#active.has(name);
  }

  scenario(name) {
    return this.#active.get(name);
  }

  activeScenarios() {
    return [...this.#active.values()];
  }

  agents() {
    return [...this.#agents.values()];
  }

  /** Ora simulata corrente in ms epoch (uguale all'ora reale senza simulatore). */
  simTime(now = Date.now()) {
    const c = this.#clock;
    if (!c) return now;
    return Math.round(c.sim + (now - c.real) * c.speed);
  }

  /** Velocità del tempo simulato (1 = tempo reale). */
  speed() {
    return this.#clock?.speed ?? 1;
  }

  /** Istantanea JSON (risposta di GET /api/state). */
  snapshot(now = Date.now()) {
    return {
      ok: true,
      now,
      simTime: this.simTime(now),
      speed: this.speed(),
      devices: Object.fromEntries(this.#devices),
      metrics: this.metrics(),
      decisions: this.decisions(),
      notifications: this.#notifications.slice(-50),
      messages: this.messages(30),
      chats: this.chats(),
      scenarios: { active: this.activeScenarios(), recent: this.#scenarioEvents.slice(-20) },
      agents: this.agents(),
      stats: { ...this.#stats, devices: this.#devices.size },
    };
  }
}

function push(arr, item, max) {
  arr.push(item);
  if (arr.length > max) arr.splice(0, arr.length - max);
}
