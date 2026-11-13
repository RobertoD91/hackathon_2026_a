// Elenco degli agenti della CER. Lo usano sia il server Node (server.js) sia la dashboard
// in modalità demo (app.js): per questo gli agenti non importano moduli Node.

import { ProduzioneAgent } from './produzione.js';
import { CasaAgent } from './casa.js';
import { ComunitaAgent } from './comunita.js';
import { FAMIGLIE } from '../model/quartiere.js';

/**
 * Crea istanze nuove a ogni chiamata (ogni hub ha i suoi agenti).
 * @param {{previsione?: 'auto'|'open-meteo'|'simulata', luxGain?: Object<string, number>,
 *          tickMs?: number, fetch?: Function}} [opts]
 */
export function createAgents(opts = {}) {
  return [
    new ProduzioneAgent({ previsione: opts.previsione, luxGain: opts.luxGain, fetch: opts.fetch }),
    ...FAMIGLIE.map((f) => new CasaAgent(f)),
    new ComunitaAgent({ tickMs: opts.tickMs, luxGain: opts.luxGain }),
  ];
}

export { ProduzioneAgent, CasaAgent, ComunitaAgent };
