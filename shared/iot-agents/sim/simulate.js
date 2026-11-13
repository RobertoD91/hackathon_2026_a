#!/usr/bin/env node
// Simulatore di sensori (CONTRATTO.md, sezione 6). Solo Node.
//
// Da riga di comando:
//   node shared/iot-agents/sim/simulate.js --config <file.json> --target http://localhost:8701
//
//   --config <file>   configurazione JSON (obbligatoria; formato in sim-core.js e README)
//   --target <url>    hub a cui inviare (predefinito http://localhost:8701)
//   --speed <n>       sovrascrive "speed" (secondi simulati per secondo reale)
//   --interval <s>    sovrascrive "intervalSec" di tutti i dispositivi
//   --seed <n>        sovrascrive "seed"
//   --duration <s>    si ferma dopo s secondi
//   --once            invia una sola lettura per dispositivo ed esce (codice 0 se tutte accettate)
//   --no-follow       non ascolta /api/stream: gli scenari lanciati a mano dalla dashboard
//                     non modificano i dati simulati (la timeline sì)
//   --token <t>       token del hub (oppure env HUB_TOKEN)
//   --quiet           meno log
//
// Come modulo:
//   import { runSimulator, attachSimulator, loadSimConfig } from '../shared/iot-agents/sim/simulate.js';
//   const run = await runSimulator({ configPath: './sim.json', target: 'http://localhost:8703' });  // via HTTP
//   const att = attachSimulator(hub, config);   // nello stesso processo del hub, senza HTTP
//   run.stop(); att.stop();

import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { createSimulator } from './sim-core.js';
import { createLogger } from '../src/log.js';

export { createSimulator } from './sim-core.js';

/** Legge e fa il parse di un file di configurazione JSON. */
export async function loadSimConfig(file) {
  const raw = await readFile(file, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`configurazione ${file} non è JSON valido: ${err.message}`);
  }
}

function applyOverrides(config, { speed, intervalSec, seed } = {}) {
  const c = structuredClone(config);
  if (speed) c.speed = speed;
  if (seed !== undefined) c.seed = seed;
  if (intervalSec) {
    c.intervalSec = intervalSec;
    for (const d of c.devices || []) delete d.intervalSec;
  }
  return c;
}

/**
 * Avvia il simulatore nello stesso processo del hub: le letture vanno a
 * `hub.ingestReading`, la timeline a `hub.scenario`, e gli scenari pubblicati sul hub
 * (anche quelli lanciati a mano dalla dashboard) attivano gli effetti sui dati.
 * @param {object} hub  risultato di createHub() o createCore()
 * @param {object} config  configurazione JSON già letta
 * @param {{speed?: number, intervalSec?: number, seed?: number, log?: object}} [opts]
 * @returns {{sim: object, stop: () => void}}
 */
export function attachSimulator(hub, config, opts = {}) {
  const log = opts.log || createLogger({ prefix: 'sim' });
  const sim = createSimulator(applyOverrides(config, opts), {
    emit: (r) => hub.ingestReading(r),
    emitScenario: (s) => hub.scenario(s.name, s.params, { active: s.active, duration: s.duration }),
    selfTrigger: false,
    log,
  });
  const off = hub.bus.subscribe((e) => sim.onScenarioEvent(e.data), { types: ['scenario'] });
  sim.start();
  log.info(`simulatore "${sim.config.name}": ${sim.devices.length} dispositivi, velocità ×${sim.config.speed}`);
  return {
    sim,
    stop() {
      off();
      sim.stop();
    },
  };
}

/**
 * Avvia il simulatore che invia via HTTP a un hub (anche su un'altra macchina).
 * @param {{config?: object, configPath?: string, target?: string, follow?: boolean,
 *          token?: string, speed?: number, intervalSec?: number, seed?: number,
 *          durationSec?: number, log?: object}} opts
 * @returns {Promise<{sim: object, stop: () => void, done: Promise<void>, stats: object}>}
 */
export async function runSimulator(opts = {}) {
  const log = opts.log || createLogger({ prefix: 'sim' });
  const target = (opts.target || 'http://localhost:8701').replace(/\/+$/, '');
  const token = opts.token ?? process.env.HUB_TOKEN ?? null;
  const follow = opts.follow ?? true;
  const config = opts.config || (await loadSimConfig(opts.configPath));
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const stats = { sent: 0, accepted: 0, failed: 0 };
  let lastErrLog = 0;

  const post = async (p, body) => {
    try {
      const res = await fetch(target + p, { method: 'POST', headers, body: JSON.stringify(body) });
      stats.sent++;
      if (res.ok) stats.accepted++;
      else {
        stats.failed++;
        const txt = await res.text();
        if (Date.now() - lastErrLog > 10_000) {
          lastErrLog = Date.now();
          log.warn(`${p} → HTTP ${res.status}: ${txt.slice(0, 200)}`);
        }
      }
      return res.ok;
    } catch (err) {
      stats.failed++;
      if (Date.now() - lastErrLog > 10_000) {
        lastErrLog = Date.now();
        log.warn(`impossibile raggiungere ${target}${p}: ${err.cause?.code || err.message}`);
      }
      return false;
    }
  };

  const sim = createSimulator(applyOverrides(config, opts), {
    emit: (r) => void post('/api/readings', r),
    emitScenario: (s) => void post('/api/scenario', s),
    selfTrigger: !follow,
    log,
  });

  const ctrl = new AbortController();
  if (follow) {
    followStream(`${target}/api/stream?types=scenario`, (e) => sim.onScenarioEvent(e.data), {
      signal: ctrl.signal,
      log,
    });
  }

  sim.start();
  log.info(
    `simulatore "${sim.config.name}" → ${target}: ${sim.devices.length} dispositivi, velocità ×${sim.config.speed}` +
      (follow ? ', segue gli scenari del hub' : ''),
  );
  const statsTimer = setInterval(
    () => log.info(`inviate ${stats.sent} richieste (${stats.accepted} accettate, ${stats.failed} fallite)`),
    30_000,
  );

  let resolveDone;
  const done = new Promise((r) => (resolveDone = r));
  const stop = () => {
    sim.stop();
    ctrl.abort();
    clearInterval(statsTimer);
    resolveDone();
  };
  if (opts.durationSec) setTimeout(stop, opts.durationSec * 1000);
  return { sim, stop, done, stats };
}

/**
 * Legge un endpoint Server-Sent Events con fetch e chiama `onEvent(json)` per ogni
 * messaggio `data:`. Si ricollega da solo dopo 3 s se la connessione cade.
 */
export async function followStream(url, onEvent, { signal, log, headers = {} } = {}) {
  let wasConnected = false;
  while (!signal?.aborted) {
    try {
      const res = await fetch(url, { headers: { accept: 'text/event-stream', ...headers }, signal });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      if (!wasConnected) log?.info?.(`collegato a ${url}`);
      wasConnected = true;
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const data = block
            .split('\n')
            .filter((l) => l.startsWith('data:'))
            .map((l) => l.slice(5).trimStart())
            .join('\n');
          if (!data) continue;
          try {
            onEvent(JSON.parse(data));
          } catch (err) {
            log?.warn?.('evento SSE non gestito:', err.message);
          }
        }
      }
    } catch (err) {
      if (signal?.aborted) return;
      log?.debug?.(`stream ${url} non disponibile (${err.cause?.code || err.message}), riprovo tra 3 s`);
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
}

// ------------------------------------------------------------------ riga di comando

function parseArgs(argv) {
  const out = { follow: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => argv[++i];
    switch (a) {
      case '--config': out.configPath = val(); break;
      case '--target': out.target = val(); break;
      case '--speed': out.speed = Number(val()); break;
      case '--interval': out.intervalSec = Number(val()); break;
      case '--seed': out.seed = Number(val()); break;
      case '--duration': out.durationSec = Number(val()); break;
      case '--token': out.token = val(); break;
      case '--once': out.once = true; break;
      case '--no-follow': out.follow = false; break;
      case '--quiet': out.quiet = true; break;
      case '-h':
      case '--help': out.help = true; break;
      default:
        throw new Error(`opzione sconosciuta: ${a} (usa --help)`);
    }
  }
  return out;
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }
  if (args.help || !args.configPath) {
    console.log(
      'Uso: node shared/iot-agents/sim/simulate.js --config <file.json> [--target http://localhost:8701]\n' +
        '     [--speed n] [--interval s] [--seed n] [--duration s] [--once] [--no-follow] [--token t] [--quiet]',
    );
    process.exit(args.help ? 0 : 2);
  }
  const log = createLogger({ prefix: 'sim', level: args.quiet ? 'warn' : process.env.LOG_LEVEL || 'info' });
  const configPath = path.resolve(args.configPath);

  if (args.once) {
    const config = applyOverrides(await loadSimConfig(configPath), args);
    const target = (args.target || 'http://localhost:8701').replace(/\/+$/, '');
    const token = args.token ?? process.env.HUB_TOKEN;
    const sim = createSimulator(config);
    let ok = 0;
    const readings = sim.sample();
    for (const r of readings) {
      try {
        const res = await fetch(`${target}/api/readings`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify(r),
        });
        if (res.ok) ok++;
        else log.warn(`${r.deviceId}: HTTP ${res.status} ${await res.text()}`);
      } catch (err) {
        log.error(`${r.deviceId}: ${err.cause?.code || err.message}`);
      }
    }
    log.warn(`inviate ${readings.length} letture, accettate ${ok}`);
    process.exit(ok === readings.length ? 0 : 1);
  }

  const run = await runSimulator({ ...args, configPath, log });
  const shutdown = () => {
    run.stop();
    log.info(`fermato: ${run.stats.accepted}/${run.stats.sent} richieste accettate`);
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  await run.done;
  shutdown();
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}
