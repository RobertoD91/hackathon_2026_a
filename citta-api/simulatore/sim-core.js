// Motore del simulatore di sensori. Isomorfo: lo usano il simulatore Node della mappa
// (c5-presentazione/mappa/sim/simulate.js), la modalità demo della mappa nel browser e la stima
// della folla dell'API (src/folla.js, solo le curve: parseSimConfig e baseValue).
//
//   import { createSimulator } from './sim-core.js';
//   const sim = createSimulator(config, {
//     emit: (reading) => hub.ingestReading(reading),            // corpo di POST /api/readings
//     emitScenario: (s) => hub.scenario(s.name, s.params, s),   // eventi della timeline
//   });
//   sim.start();   // ...  sim.stop();
//
// Formato della configurazione (JSON): vedi c5-presentazione/mappa/README.md, sezione "Simulatore",
// e sim-config.json in questa cartella. In breve:
//
// {
//   "seed": 42, "intervalSec": 3, "speed": 60, "start": "07:00", "timezone": "Europe/Rome",
//   "devices": [{
//     "id": "sim-casa", "count": 3, "jitterM": 150, "vary": 0.2,
//     "location": { "lat": 40.85, "lon": 14.26, "zone": "sanita" },
//     "readings": {
//       "light_lux":     { "kind": "daylight", "max": 60000, "sunrise": 6.8, "sunset": 16.9, "noise": 800,
//                          "effects": { "nuvole": { "multiply": 0.25, "rampSec": 5 } } },
//       "temperature_c": { "kind": "daily", "min": 12, "max": 19, "peakHour": 14, "noise": 0.2 },
//       "power_w":       { "kind": "profile", "points": [[0,250],[7,600],[13,400],[20,1200],[23,400]] },
//       "people_count":  { "kind": "walk", "start": 40, "min": 0, "max": 400, "step": 8, "round": 0 },
//       "fill_pct":      { "kind": "ramp", "from": 5, "to": 95, "periodSec": 21600 },
//       "button":        { "kind": "bool", "p": 0.01 },
//       "humidity_pct":  60
//     }
//   }],
//   "timeline": [{ "at": 30, "name": "nuvole", "params": {}, "duration": 40 }],
//   "loopSec": 180,
//   "scenarios": [{ "name": "nuvole", "label": "Passano le nuvole", "params": {}, "duration": 40 }]
// }
//
// `loopSec` (facoltativo): ogni loopSec secondi reali ricominciano la timeline e la giornata
// simulata (utile per una demo che gira da sola). Gli agenti devono tollerare che l'ora
// simulata torni indietro.
//
// Tempi: `at`, `duration`, `rampSec`, `intervalSec`, `loopSec` sono in secondi REALI;
// gli andamenti giornalieri e `periodSec` delle rampe usano il tempo SIMULATO
// (tempo simulato = start + tempo reale trascorso × speed).

const KINDS = ['constant', 'daily', 'daylight', 'profile', 'ramp', 'walk', 'bool'];

// ------------------------------------------------------------------ fuso orario

const fmtCache = new Map();
function formatter(tz) {
  if (!fmtCache.has(tz)) {
    fmtCache.set(
      tz,
      new Intl.DateTimeFormat('en-GB', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
      }),
    );
  }
  return fmtCache.get(tz);
}

function zonedParts(ts, tz) {
  const p = {};
  for (const { type, value } of formatter(tz).formatToParts(new Date(ts))) p[type] = Number(value);
  return p;
}

/** Ora del giorno (decimale, 0-24) del timestamp nel fuso indicato. Es. 13.5 = 13:30. */
export function hourOf(ts, tz = 'Europe/Rome') {
  const p = zonedParts(ts, tz);
  return p.hour + p.minute / 60 + p.second / 3600;
}

/** "HH:MM" del timestamp nel fuso indicato (per dashboard e messaggi). */
export function formatClock(ts, tz = 'Europe/Rome') {
  const p = zonedParts(ts, tz);
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

function tzOffsetMs(ts, tz) {
  const p = zonedParts(ts, tz);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ts / 1000) * 1000;
}

/** Converte `start` della configurazione (HH:MM di oggi, ISO, ms) in ms epoch. */
export function resolveStart(start, { now = Date.now(), timezone = 'Europe/Rome' } = {}) {
  if (start === undefined || start === null || start === 'now') return now;
  if (typeof start === 'number') return start;
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(start));
  if (m) {
    const p = zonedParts(now, timezone);
    const guess = Date.UTC(p.year, p.month - 1, p.day, Number(m[1]), Number(m[2]));
    return guess - tzOffsetMs(guess, timezone);
  }
  const t = Date.parse(start);
  if (Number.isNaN(t)) throw new Error(`"start" non valido: ${start} (usa "HH:MM", una data ISO o un numero)`);
  return t;
}

// ------------------------------------------------------------------ numeri casuali deterministici

function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** PRNG mulberry32: stessa sequenza a parità di seme. */
export function createRandom(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const gauss = () => {
    const u = Math.max(next(), 1e-12);
    const v = next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  return { next, gauss };
}

// ------------------------------------------------------------------ configurazione

/**
 * Valida la configurazione ed espande i dispositivi replicati (`count`).
 * Lancia un Error con un messaggio chiaro se qualcosa non va.
 */
export function parseSimConfig(cfg) {
  if (!cfg || typeof cfg !== 'object') throw new Error('configurazione del simulatore mancante');
  if (!Array.isArray(cfg.devices) || cfg.devices.length === 0) throw new Error('"devices" deve essere un array non vuoto');
  const seed = Number.isFinite(cfg.seed) ? cfg.seed : 1;
  const devices = [];
  cfg.devices.forEach((d, i) => {
    if (!d || typeof d.id !== 'string' || !d.id) throw new Error(`devices[${i}]: manca "id"`);
    if (!d.readings || typeof d.readings !== 'object' || !Object.keys(d.readings).length) {
      throw new Error(`dispositivo ${d.id}: "readings" deve definire almeno una grandezza`);
    }
    const defs = {};
    for (const [key, raw] of Object.entries(d.readings)) {
      const def = typeof raw === 'number' || typeof raw === 'boolean' ? { kind: 'constant', value: raw } : { ...raw };
      def.kind = def.kind || 'constant';
      if (!KINDS.includes(def.kind)) {
        throw new Error(`dispositivo ${d.id}, ${key}: kind "${def.kind}" sconosciuto (usa ${KINDS.join(', ')})`);
      }
      if (def.kind === 'profile' && (!Array.isArray(def.points) || def.points.length < 2)) {
        throw new Error(`dispositivo ${d.id}, ${key}: "profile" richiede "points": [[ora, valore], ...] (almeno 2)`);
      }
      defs[key] = def;
    }
    const count = Math.max(1, Math.floor(d.count || 1));
    for (let n = 0; n < count; n++) {
      const id = count > 1 ? `${d.id}-${String(n + 1).padStart(2, '0')}` : d.id;
      const rnd = createRandom(hashString(id) ^ seed);
      let location = d.location ? { ...d.location } : undefined;
      if (location && count > 1 && d.jitterM && typeof location.lat === 'number') {
        const dLat = ((rnd.next() * 2 - 1) * d.jitterM) / 111_320;
        const dLon = ((rnd.next() * 2 - 1) * d.jitterM) / (111_320 * Math.cos((location.lat * Math.PI) / 180));
        location = { ...location, lat: +(location.lat + dLat).toFixed(6), lon: +(location.lon + dLon).toFixed(6) };
      }
      const scale = d.vary ? 1 + d.vary * (rnd.next() * 2 - 1) : 1;
      devices.push({
        id,
        location,
        defs,
        scale,
        rnd,
        intervalMs: Math.max(200, (d.intervalSec ?? cfg.intervalSec ?? 3) * 1000),
        meta: d.meta || {},
        walk: {},
        nextAt: 0,
      });
    }
  });
  const timeline = (cfg.timeline || []).map((t, i) => {
    if (!t || typeof t.name !== 'string') throw new Error(`timeline[${i}]: manca "name"`);
    if (typeof t.at !== 'number' || t.at < 0) throw new Error(`timeline[${i}] (${t.name}): "at" (secondi) obbligatorio`);
    return { at: t.at, name: t.name, params: t.params || {}, duration: t.duration, active: t.active ?? true };
  });
  return {
    name: cfg.name || 'simulazione',
    seed,
    speed: cfg.speed > 0 ? cfg.speed : 1,
    start: cfg.start,
    timezone: cfg.timezone || 'Europe/Rome',
    net: cfg.net || 'sim',
    fw: cfg.fw || 'sim-0.1',
    loopSec: cfg.loopSec > 0 ? cfg.loopSec : null,
    devices,
    timeline,
    scenarios: cfg.scenarios || [],
  };
}

// ------------------------------------------------------------------ andamenti

/**
 * Valore "di base" di una grandezza (senza rumore né effetti) all'ora simulata `simTs`.
 * Esportata per i test e per chi vuole disegnare la curva attesa.
 */
export function baseValue(def, simTs, { timezone = 'Europe/Rome', startSim = simTs } = {}) {
  const h = hourOf(simTs, timezone);
  switch (def.kind) {
    case 'constant':
      return def.value ?? 0;
    case 'daily': {
      const min = def.min ?? 0;
      const max = def.max ?? 1;
      const peak = def.peakHour ?? 14;
      return min + (max - min) * (0.5 + 0.5 * Math.cos((2 * Math.PI * (h - peak)) / 24));
    }
    case 'daylight': {
      const rise = def.sunrise ?? 7;
      const set = def.sunset ?? 17;
      const night = def.min ?? 0;
      if (h <= rise || h >= set) return night;
      return night + ((def.max ?? 50_000) - night) * Math.sin((Math.PI * (h - rise)) / (set - rise));
    }
    case 'profile': {
      const pts = [...def.points].sort((a, b) => a[0] - b[0]);
      const first = pts[0];
      const last = pts[pts.length - 1];
      // interpolazione lineare, ciclica sulle 24 ore
      const ext = [[last[0] - 24, last[1]], ...pts, [first[0] + 24, first[1]]];
      for (let i = 0; i < ext.length - 1; i++) {
        const [h0, v0] = ext[i];
        const [h1, v1] = ext[i + 1];
        if (h >= h0 && h <= h1) return h1 === h0 ? v0 : v0 + ((v1 - v0) * (h - h0)) / (h1 - h0);
      }
      return first[1];
    }
    case 'ramp': {
      const from = def.from ?? 0;
      const to = def.to ?? 100;
      const period = (def.periodSec ?? 3600) * 1000;
      let f = (simTs - startSim) / period;
      f = def.loop === false ? Math.min(1, f) : f - Math.floor(f);
      return from + (to - from) * f;
    }
    default:
      return 0;
  }
}

function applyEffect(v, eff, factor) {
  if (!eff || factor <= 0) return v;
  let target = v;
  if (eff.set !== undefined) target = eff.set;
  else target = v * (eff.multiply ?? 1) + (eff.add ?? 0);
  return v + (target - v) * factor;
}

// ------------------------------------------------------------------ simulatore

/**
 * @param {object} config  configurazione JSON (vedi sopra)
 * @param {{emit?: (reading: object) => void,
 *          emitScenario?: (s: {name: string, params: object, active: boolean, duration?: number}) => void,
 *          now?: () => number, selfTrigger?: boolean, log?: object}} [opts]
 *   - emit: riceve ogni lettura (corpo di POST /api/readings)
 *   - emitScenario: riceve gli eventi della timeline
 *   - selfTrigger: se true (predefinito) gli eventi della timeline attivano subito gli
 *     effetti; metti false quando il simulatore "ascolta" gli scenari dal hub con
 *     `onScenarioEvent` (così attiva gli effetti anche per gli scenari lanciati a mano)
 */
export function createSimulator(config, opts = {}) {
  const cfg = parseSimConfig(config);
  const now = opts.now || (() => Date.now());
  const emit = opts.emit || (() => {});
  const emitScenario = opts.emitScenario || (() => {});
  const selfTrigger = opts.selfTrigger ?? true;
  const log = opts.log || null;

  let realStart = now();
  let simStart = resolveStart(cfg.start, { now: realStart, timezone: cfg.timezone });
  const active = new Map(); // nome → { params, since, until }
  let fired = new Set();
  let loopIndex = 0;
  let timer = null;

  // Con `loopSec` la giornata simulata e la timeline ricominciano ogni loopSec secondi reali.
  const simTime = (t = now()) => {
    let dt = t - realStart;
    if (cfg.loopSec) dt %= cfg.loopSec * 1000;
    return simStart + dt * cfg.speed;
  };

  function sampleDevice(dev, t) {
    const sTs = simTime(t);
    const readings = {};
    for (const [key, def] of Object.entries(dev.defs)) {
      let v;
      if (def.kind === 'bool') {
        v = dev.rnd.next() < (def.p ?? 0.05);
      } else if (def.kind === 'walk') {
        const lo = def.min ?? -Infinity;
        const hi = def.max ?? Infinity;
        const prev = dev.walk[key] ?? (def.start ?? (Number.isFinite(lo) ? lo : 0)) * dev.scale;
        const next = Math.min(hi, Math.max(lo, prev + dev.rnd.gauss() * (def.step ?? 1)));
        dev.walk[key] = next;
        v = next;
      } else {
        v = baseValue(def, sTs, { timezone: cfg.timezone, startSim: simStart }) * dev.scale;
      }
      if (typeof v === 'number') {
        for (const [name, eff] of Object.entries(def.effects || {})) {
          const a = active.get(name);
          if (!a) continue;
          const ramp = (eff.rampSec ?? 0) * 1000;
          const factor = ramp > 0 ? Math.min(1, (t - a.since) / ramp) : 1;
          v = applyEffect(v, eff, factor);
        }
        if (def.noise) v += dev.rnd.gauss() * def.noise;
        if (Array.isArray(def.clamp)) v = Math.min(def.clamp[1], Math.max(def.clamp[0], v));
        else if (def.kind !== 'walk' && def.allowNegative !== true) v = Math.max(0, v);
        const dec = def.round ?? 1;
        v = Math.round(v * 10 ** dec) / 10 ** dec;
      } else {
        for (const [name, eff] of Object.entries(def.effects || {})) {
          if (active.has(name) && eff.set !== undefined) v = eff.set;
        }
      }
      readings[key] = v;
    }
    const body = {
      deviceId: dev.id,
      ts: Math.round(t),
      readings,
      meta: { fw: cfg.fw, net: cfg.net, simulated: true, simTime: Math.round(sTs), speed: cfg.speed, ...dev.meta },
    };
    if (dev.location) body.location = dev.location;
    return body;
  }

  /** Una lettura per ogni dispositivo all'istante `t` (non invia nulla). */
  function sample(t = now()) {
    return cfg.devices.map((d) => sampleDevice(d, t));
  }

  /** Attiva localmente gli effetti di uno scenario (idempotente). */
  function trigger(name, params = {}, { duration } = {}) {
    const t = now();
    const prev = active.get(name);
    // se lo scenario è già attivo la rampa non riparte: si aggiornano solo parametri e scadenza
    const since = prev ? prev.since : t;
    active.set(name, { params, since, until: duration ? t + duration * 1000 : null });
  }

  /** Disattiva localmente uno scenario. */
  function end(name) {
    active.delete(name);
  }

  /** Da collegare agli eventi `scenario` del hub: `{ name, params, active, duration }`. */
  function onScenarioEvent(data) {
    if (!data?.name) return;
    if (data.active === false) end(data.name);
    else trigger(data.name, data.params, { duration: data.duration });
  }

  function fire(item) {
    log?.info?.(`timeline: ${item.name}${item.active === false ? ' (fine)' : ''}`);
    const s = { name: item.name, params: item.params, active: item.active };
    if (item.duration) s.duration = item.duration;
    try {
      emitScenario(s);
    } catch (err) {
      log?.error?.('emitScenario in errore:', err);
    }
    if (selfTrigger) onScenarioEvent(s);
  }

  /** Avanza la simulazione all'istante `t`: timeline, scadenze e invio delle letture dovute. */
  function step(t = now()) {
    let elapsed = (t - realStart) / 1000;
    if (cfg.loopSec) {
      const li = Math.floor(elapsed / cfg.loopSec);
      if (li !== loopIndex) {
        loopIndex = li;
        fired = new Set();
      }
      elapsed -= li * cfg.loopSec;
    }
    cfg.timeline.forEach((item, i) => {
      if (!fired.has(i) && elapsed >= item.at) {
        fired.add(i);
        fire(item);
      }
    });
    for (const [name, a] of active) if (a.until && t >= a.until) active.delete(name);
    for (const dev of cfg.devices) {
      if (t >= dev.nextAt) {
        dev.nextAt = t + dev.intervalMs;
        try {
          emit(sampleDevice(dev, t));
        } catch (err) {
          log?.error?.('emit in errore:', err);
        }
      }
    }
  }

  function start({ tickMs = 250 } = {}) {
    if (timer) return;
    realStart = now();
    simStart = resolveStart(cfg.start, { now: realStart, timezone: cfg.timezone });
    fired = new Set();
    loopIndex = 0;
    // primi invii sfalsati per non mandare tutto nello stesso istante
    cfg.devices.forEach((d, i) => (d.nextAt = realStart + (i * Math.min(d.intervalMs, 1000)) / cfg.devices.length));
    step(realStart);
    timer = setInterval(() => step(), tickMs);
  }

  function stop() {
    clearInterval(timer);
    timer = null;
  }

  return {
    config: cfg,
    devices: cfg.devices.map((d) => ({ id: d.id, location: d.location, readings: Object.keys(d.defs) })),
    scenarios: cfg.scenarios,
    start,
    stop,
    step,
    sample,
    trigger,
    end,
    onScenarioEvent,
    simTime,
    activeScenarios: () => [...active.keys()],
    get running() {
      return timer !== null;
    },
  };
}
