#!/usr/bin/env node
// Esempio minimo del nucleo: hub su porta 8701 + 3 agenti + simulatore nello stesso processo.
//
//   node shared/iot-agents/example/server.js            # hub + simulatore
//   node shared/iot-agents/example/server.js --no-sim   # solo hub (dati da ESP32 o da sim/simulate.js)
//   PORT=9000 LLM_PROVIDER=anthropic ANTHROPIC_API_KEY=... node shared/iot-agents/example/server.js
//
// Dashboard: http://localhost:8701/  (reindirizza a /shared/iot-agents/example/)
//
// Copia questo file nella tua soluzione e cambia agenti, configurazione e porta.

import { createHub, attachSimulator, loadSimConfig } from '../src/index.js';
import { createAgents } from './agents/index.js';

const here = new URL('./', import.meta.url);

const hub = createHub({
  port: Number(process.env.PORT) || 8701,
  staticDir: here, // la dashboard (index.html, app.js) e gli agenti per la modalità demo
  agents: createAgents(),
});

await hub.start();

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
