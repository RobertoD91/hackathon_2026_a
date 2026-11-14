// Agenti dello scenario "Acqua comune" (fattoria). Li usano sia il server Node
// (server.js --scenario fattoria) sia la pagina in modalità demo: niente moduli Node.

import { CampoAgent } from './campo.js';
import { MeteoAgent } from './meteo.js';
import { Consorzio } from './consorzio.js';

/**
 * Crea istanze nuove a ogni chiamata (ogni hub ha i suoi agenti).
 * @param {{meteo?: object}} [opts]  opzioni dell'agente meteo (es. `{ rete: false }` nei test)
 */
export function createAgents(opts = {}) {
  return [new CampoAgent(), new MeteoAgent(opts.meteo), new Consorzio()];
}

export { CampoAgent, MeteoAgent, Consorzio };
