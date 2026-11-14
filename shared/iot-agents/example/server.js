#!/usr/bin/env node
// Esempio del nucleo: hub su porta 8701 + agenti + simulatore nello stesso processo.
// Due scenari, uno per volta (stessa porta):
//
//   node shared/iot-agents/example/server.js                       # Napoli (predefinito)
//   node shared/iot-agents/example/server.js --scenario fattoria   # Fattoria "Acqua comune" (anche SCENARIO=fattoria)
//   node shared/iot-agents/example/server.js --no-sim              # solo hub (dati da ESP32 o da sim/simulate.js)
//   PORT=9000 LLM_PROVIDER=anthropic ANTHROPIC_API_KEY=... node shared/iot-agents/example/server.js
//
// Dashboard: http://localhost:8701/  (reindirizza alla pagina dello scenario avviato)
//
// Copia questo file nella tua soluzione e cambia agenti, configurazione e porta.

import { createHub, attachSimulator, loadSimConfig } from '../src/index.js';

const here = new URL('./', import.meta.url);

const SCENARI = {
  napoli: {
    dir: here, // la dashboard (index.html, app.js) e gli agenti per la modalità demo
    agenti: './agents/index.js',
    simConfig: './sim-config.json',
    attach: attachSimulator,
  },
  fattoria: {
    dir: new URL('./fattoria/', here),
    publicDirs: [here], // la pagina della fattoria usa ../app.js, ../mappa.js, ../style.css
    agenti: './fattoria/agents/index.js',
    simConfig: './fattoria/sim-config.json',
    // simulatore generico + bilancio idrico (l'umidità sale quando il consorzio apre l'acqua)
    attach: async (hub, config) => (await import('./fattoria/simulatore.js')).attachFattoria(hub, config, { log: hub.log.child?.('sim') ?? hub.log }),
  },
};

const i = process.argv.indexOf('--scenario');
const nome = (i > 0 ? process.argv[i + 1] : process.env.SCENARIO) || 'napoli';
const scelta = SCENARI[nome];
if (!scelta) {
  console.error(`Scenario "${nome}" sconosciuto: usa ${Object.keys(SCENARI).join(' o ')}.`);
  process.exit(1);
}

const { createAgents } = await import(new URL(scelta.agenti, here).href);
const hub = createHub({
  port: Number(process.env.PORT) || 8701,
  staticDir: scelta.dir,
  publicDirs: scelta.publicDirs,
  agents: createAgents(),
});

await hub.start();

let sim = null;
if (!process.argv.includes('--no-sim')) {
  const config = await loadSimConfig(new URL(scelta.simConfig, here));
  sim = await scelta.attach(hub, config);
}

const shutdown = async () => {
  sim?.stop();
  await hub.stop();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
