#!/usr/bin/env node
// Mappa "Napoli in tempo reale" con il hub: hub su porta 8701 + agenti + simulatore nello stesso
// processo (folla e sensori simulati; meteo, aria, trasporti, eventi e allerta veri, dalle fonti
// dell'API dati città in ../../citta-api/).
//
//   node c5-presentazione/mappa/server.js               # hub + agenti + simulatore
//   node c5-presentazione/mappa/server.js --no-sim      # solo hub (letture da sim/simulate.js o via HTTP)
//   PORT=9000 LLM_PROVIDER=anthropic ANTHROPIC_API_KEY=... node c5-presentazione/mappa/server.js
//
// Dashboard: http://localhost:8701/  (reindirizza a /c5-presentazione/mappa/)

import { createHub, attachSimulator, loadSimConfig } from './src/index.js';
import { createAgents } from './agents/index.js';

const here = new URL('./', import.meta.url);
const SIM_CONFIG = new URL('../../citta-api/simulatore/sim-config.json', import.meta.url);

const hub = createHub({
  port: Number(process.env.PORT) || 8701,
  staticDir: here, // la dashboard (index.html, app.js) e gli agenti per la modalità demo
  agents: createAgents(),
});

await hub.start();

let sim = null;
if (!process.argv.includes('--no-sim')) {
  const config = await loadSimConfig(SIM_CONFIG);
  sim = await attachSimulator(hub, config);
}

const shutdown = async () => {
  sim?.stop();
  await hub.stop();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
