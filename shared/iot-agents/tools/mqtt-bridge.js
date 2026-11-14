#!/usr/bin/env node
// Ponte MQTT → hub: si iscrive ai topic del broker e inoltra le letture a POST /api/readings
// (CONTRATTO.md, sezioni 1 e 9). Nessuna dipendenza npm: client MQTT in ./mqtt-client.js.
//
//   node shared/iot-agents/tools/mqtt-bridge.js
//   MQTT_URL=mqtt://localhost:1883 HUB_URL=http://localhost:8701 node shared/iot-agents/tools/mqtt-bridge.js
//   DRY_RUN=1 node shared/iot-agents/tools/mqtt-bridge.js     # stampa le letture convertite, non invia
//
// Variabili d'ambiente (tutte facoltative):
//   MQTT_URL           broker (predefinito mqtt://twinciro.robertodisanto.it:1883): mqtt:// mqtts:// ws:// wss://
//   MQTT_USER, MQTT_PASSWORD   credenziali del ponte sul broker
//   MQTT_CLIENT_ID     predefinito bighack-ponte-<casuale>
//   MQTT_TOPICS        filtri separati da virgola (predefinito: bighack/# + Tasmota + c5 secondo i flag)
//   MQTT_PREFIX        prefisso dei topic dei dispositivi (bighack)
//   MQTT_TASMOTA       1 (predefinito) = tele/+/SENSOR, tele/+/STATE, tele/+/LWT; 0 = no
//   MQTT_C5            1 = anche napoli/sensori/+/+ (formato c5-agentic-city); predefinito 0
//   MQTT_C5_PREFIX     prefisso c5 (napoli)
//   MQTT_STATUS        1 (predefinito) = .../status e LWT diventano la lettura { online }
//   MQTT_KEEPALIVE     secondi (30)
//   MQTT_CA_FILE       CA in PEM per mqtts:// con certificato autofirmato
//   MQTT_INSECURE      1 = non verificare il certificato TLS (solo prove)
//   MQTT_MAP           JSON {"<deviceId o topic Tasmota>": {"zone": "...", "lat": .., "lon": .., "deviceId": "..."}}
//   MQTT_MAP_FILE      come MQTT_MAP ma da file
//   MQTT_DEFAULT_ZONE  zona per i Tasmota/c5 non presenti nella mappa
//   HUB_URL            hub (predefinito http://localhost:8701)
//   HUB_TOKEN          token del hub (Authorization: Bearer)
//   DRY_RUN            1 = non invia al hub, stampa
//   HEALTH_PORT        porta HTTP con GET /health (per Docker); predefinito spento
//   LOG                info (predefinito) | quiet | debug

import { readFileSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { MqttClient } from './mqtt-client.js';
import { createConverter } from './mqtt-convert.js';

const flag = (v, def) => (v === undefined || v === '' ? def : !/^(0|false|no|off)$/i.test(v));

/** Configurazione dalle variabili d'ambiente (esportata per i test). */
export function configFromEnv(env = process.env) {
  let map = {};
  if (env.MQTT_MAP_FILE) map = JSON.parse(readFileSync(env.MQTT_MAP_FILE, 'utf8'));
  if (env.MQTT_MAP) map = { ...map, ...JSON.parse(env.MQTT_MAP) };
  return {
    mqttUrl: env.MQTT_URL || 'mqtt://twinciro.robertodisanto.it:1883',
    username: env.MQTT_USER || undefined,
    password: env.MQTT_PASSWORD || undefined,
    clientId: env.MQTT_CLIENT_ID || `bighack-ponte-${os.hostname().replace(/[^A-Za-z0-9-]/g, '').slice(0, 16)}-${Math.random().toString(16).slice(2, 6)}`,
    topics: env.MQTT_TOPICS ? env.MQTT_TOPICS.split(',').map((s) => s.trim()).filter(Boolean) : null,
    prefix: env.MQTT_PREFIX || 'bighack',
    c5Prefix: env.MQTT_C5_PREFIX || 'napoli',
    tasmota: flag(env.MQTT_TASMOTA, true),
    c5: flag(env.MQTT_C5, false),
    status: flag(env.MQTT_STATUS, true),
    keepalive: Number(env.MQTT_KEEPALIVE) || 30,
    ca: env.MQTT_CA_FILE ? readFileSync(env.MQTT_CA_FILE) : undefined,
    insecure: flag(env.MQTT_INSECURE, false),
    map,
    defaultZone: env.MQTT_DEFAULT_ZONE || undefined,
    hubUrl: (env.HUB_URL || 'http://localhost:8701').replace(/\/+$/, ''),
    hubToken: env.HUB_TOKEN || undefined,
    dryRun: flag(env.DRY_RUN, false),
    healthPort: env.HEALTH_PORT ? Number(env.HEALTH_PORT) : undefined,
    log: env.LOG || 'info',
  };
}

function makeLog(level) {
  const ts = () => new Date().toISOString().slice(11, 19);
  return {
    info: (...a) => level !== 'quiet' && console.log(ts(), '[ponte]', ...a),
    debug: (...a) => level === 'debug' && console.log(ts(), '[ponte]', ...a),
    warn: (...a) => console.warn(ts(), '[ponte]', ...a),
  };
}

const short = (r) => `${r.deviceId}${r.location?.zone ? ` @${r.location.zone}` : ''} ${JSON.stringify(r.readings)}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Avvia il ponte. Restituisce { client, stats, stop(), idle() }.
 * @param {ReturnType<typeof configFromEnv>} cfg
 */
export function startBridge(cfg, { log = makeLog(cfg.log), fetchImpl = globalThis.fetch } = {}) {
  const conv = createConverter(cfg);
  const topics = cfg.topics || conv.topics();
  const stats = { received: 0, forwarded: 0, skipped: 0, rejected: 0, errors: 0, queued: 0, mqttConnected: false, since: Date.now() };
  const queue = [];
  let sending = false;
  let stopped = false;
  let idleWaiters = [];

  const headers = { 'content-type': 'application/json', ...(cfg.hubToken ? { authorization: `Bearer ${cfg.hubToken}` } : {}) };

  async function postOne(body) {
    for (let attempt = 1; ; attempt++) {
      try {
        const res = await fetchImpl(`${cfg.hubUrl}/api/readings`, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(5000) });
        if (res.status === 202) return { ok: true };
        const text = await res.text().catch(() => '');
        if (res.status >= 400 && res.status < 500) return { ok: false, status: res.status, error: text };
        throw new Error(`HTTP ${res.status} ${text}`);
      } catch (err) {
        if (stopped || attempt >= 5) return { ok: false, error: err.message };
        await sleep(Math.min(500 * 2 ** attempt, 10_000)); // hub giù o lento: riprova
      }
    }
  }

  async function drain() {
    if (sending) return;
    sending = true;
    while (queue.length && !stopped) {
      const body = queue.shift();
      stats.queued = queue.length;
      const r = await postOne(body);
      if (r.ok) {
        stats.forwarded++;
        log.info(`→ hub ${short(body)}`);
      } else if (r.status) {
        stats.rejected++;
        log.warn(`hub ha rifiutato ${body.deviceId} (${r.status}): ${r.error}`);
      } else {
        stats.errors++;
        log.warn(`hub non raggiungibile (${cfg.hubUrl}): ${r.error}; lettura di ${body.deviceId} persa`);
      }
    }
    sending = false;
    if (!queue.length) {
      for (const w of idleWaiters) w();
      idleWaiters = [];
    }
  }

  function enqueue(body) {
    if (queue.length >= 1000) {
      queue.shift(); // si perde la più vecchia: le letture nuove contano di più
      stats.errors++;
    }
    queue.push(body);
    stats.queued = queue.length;
    drain();
  }

  const client = new MqttClient(cfg.mqttUrl, {
    clientId: cfg.clientId,
    username: cfg.username,
    password: cfg.password,
    keepalive: cfg.keepalive,
    ca: cfg.ca,
    rejectUnauthorized: !cfg.insecure,
  });
  client.subscribe(topics, 1);
  client.on('connect', () => {
    stats.mqttConnected = true;
    log.info(`connesso a ${cfg.mqttUrl.replace(/\/\/[^@/]*@/, '//***@')} come ${cfg.clientId}; topic: ${topics.join(', ')}`);
  });
  client.on('close', () => {
    stats.mqttConnected = false;
  });
  client.on('offline', ({ retryInMs }) => log.info(`broker non connesso, riprovo tra ${Math.round(retryInMs / 1000)} s`));
  client.on('error', (err) => log.warn(`MQTT: ${err.message}`));
  client.on('message', (topic, payload, packet) => {
    stats.received++;
    let out;
    try {
      out = conv.convert(topic, payload, { retain: packet.retain });
    } catch (err) {
      stats.errors++;
      log.warn(`conversione fallita per ${topic}: ${err.message}`);
      return;
    }
    if (!out.readings.length) {
      stats.skipped++;
      log.debug(`saltato ${topic}: ${out.skip}`);
      return;
    }
    for (const body of out.readings) {
      if (cfg.dryRun) {
        stats.forwarded++;
        log.info(`[prova] ${topic} → ${JSON.stringify(body)}`);
      } else {
        enqueue(body);
      }
    }
  });
  client.connect();

  let health;
  if (cfg.healthPort !== undefined) {
    health = http.createServer((req, res) => {
      const ok = stats.mqttConnected;
      res.writeHead(req.url === '/health' ? (ok ? 200 : 503) : 404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok, ...stats, uptime: Math.round((Date.now() - stats.since) / 1000) }));
    });
    health.listen(cfg.healthPort);
  }

  return {
    client,
    stats,
    topics,
    health,
    /** Attende che la coda verso il hub sia vuota (per i test). */
    idle: () => (queue.length || sending ? new Promise((r) => idleWaiters.push(r)) : Promise.resolve()),
    async stop() {
      stopped = true;
      await client.end();
      if (health) await new Promise((r) => health.close(r));
    },
  };
}

async function main() {
  const cfg = configFromEnv();
  const log = makeLog(cfg.log);
  log.info(`ponte MQTT → ${cfg.dryRun ? '(prova, nessun invio)' : cfg.hubUrl}; broker ${cfg.mqttUrl.replace(/\/\/[^@/]*@/, '//***@')}${cfg.username ? ` (utente ${cfg.username})` : ''}`);
  if (Object.keys(cfg.map).length) log.info(`mappa: ${Object.keys(cfg.map).length} dispositivi`);
  const bridge = startBridge(cfg, { log });
  const shutdown = async () => {
    log.info(`chiusura: ricevuti ${bridge.stats.received}, inoltrati ${bridge.stats.forwarded}, saltati ${bridge.stats.skipped}, rifiutati ${bridge.stats.rejected}, errori ${bridge.stats.errors}`);
    await bridge.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('[ponte] errore:', err.message);
    process.exit(1);
  });
}
