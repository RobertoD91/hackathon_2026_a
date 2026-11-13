// Elenco degli agenti dell'esempio. Lo usano sia il server Node (server.js) sia la
// dashboard in modalità demo (app.js): per questo gli agenti non importano moduli Node.

import { ClimaAgent } from './clima.js';
import { IlluminazioneAgent } from './illuminazione.js';
import { Orchestrator } from './orchestrator.js';
import { FollaAgent } from './folla.js';

/** Crea istanze nuove a ogni chiamata (ogni hub ha i suoi agenti). */
export function createAgents() {
  return [new ClimaAgent(), new IlluminazioneAgent(), new FollaAgent(), new Orchestrator()];
}

export { ClimaAgent, IlluminazioneAgent, FollaAgent, Orchestrator };
