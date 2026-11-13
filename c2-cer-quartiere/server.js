#!/usr/bin/env node
// CER di quartiere: hub su porta 8703 + agenti (produzione, 10 case, comunità) + simulatore.
//
//   node c2-cer-quartiere/server.js              # hub + simulatore dei tetti
//   node c2-cer-quartiere/server.js --no-sim     # solo hub (dati dagli ESP32 veri o da sim/simulate.js)
//
// Variabili d'ambiente:
//   PORT=8703                         porta (predefinita 8703)
//   PREVISIONE=auto|open-meteo|simulata   fonte della previsione (predefinita auto: Open-Meteo se raggiungibile)
//   LUX_GAIN=esp32-tetto-b=40,...     moltiplica la luce di un ESP32 vero (demo al chiuso)
//   LLM_PROVIDER, ANTHROPIC_API_KEY... come in shared/iot-agents (predefinito mock)
//   HUB_TOKEN                         token per le POST (facoltativo)
//
// Dashboard: http://localhost:8703/  (reindirizza a /c2-cer-quartiere/)

import { createHub, attachSimulator, loadSimConfig } from '../shared/iot-agents/src/index.js';
import { createAgents } from './agents/index.js';

const here = new URL('./', import.meta.url);

function parseGain(s) {
  const out = {};
  for (const part of String(s || '').split(',')) {
    const [id, g] = part.split('=').map((x) => x?.trim());
    if (id && Number(g) > 0) out[id] = Number(g);
  }
  return out;
}

const previsione = process.env.PREVISIONE || 'auto';
const luxGain = parseGain(process.env.LUX_GAIN);

const hub = createHub({
  port: Number(process.env.PORT) || 8703,
  staticDir: here, // dashboard, agenti e modello (servono anche al browser in modalità demo)
  agents: createAgents({ previsione, luxGain }),
});

await hub.start();
hub.log.info(`previsione: ${previsione}${Object.keys(luxGain).length ? `; LUX_GAIN ${JSON.stringify(luxGain)}` : ''}`);

let sim = null;
if (!process.argv.includes('--no-sim')) {
  const config = await loadSimConfig(new URL('./sim-config.json', here));
  sim = attachSimulator(hub, config);
}

const shutdown = async () => {
  sim?.stop();
  await hub.stop();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
