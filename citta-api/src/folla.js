// Folla STIMATA per luogo: è la stessa stima della mappa "Napoli in tempo reale", cioè il
// simulatore (simulatore/sim-config.json, curva oraria per luogo con capienze
// indicative) calcolato all'ora reale, senza rumore, con gli effetti dichiarati degli scenari
// accesi dai DATI REALI: eventi di oggi nella finestra dell'evento (evento_<zona>) e stagione
// turistica ISTAT (stagione_bassa/alta). NON è una misura: le presenze da rete mobile non sono
// pubbliche (vanno chieste a Fastweb + Vodafone). L'API lo dichiara sempre (stato "simulato").

import { readFileSync } from 'node:fs';
import { parseSimConfig, baseValue } from '../simulatore/sim-core.js';
import { livelloFolla } from '../fonti/luoghi.js';
import * as N from '../fonti/normalizza.js';

const SIM_CONFIG = new URL('../simulatore/sim-config.json', import.meta.url);

/** Scenari reali attivi a un istante: { nome → motivo }. */
export function scenariAttivi({ eventi, riferimenti, ora }) {
  const attivi = new Map();
  for (const e of N.eventiDelGiorno(eventi, N.giornoLocale(ora))) {
    if (!e.scenario || !e.finestra || ora < e.finestra[0] || ora > e.finestra[1]) continue;
    attivi.set(e.scenario, [attivi.get(e.scenario), e.titolo].filter(Boolean).join('; '));
  }
  const st = N.stagione(riferimenti, N.partiLocali(ora).mese);
  if (st?.scenario) attivi.set(st.scenario, `arrivi del mese ${String(st.indice).replace('.', ',')}× la media mensile (ISTAT ${st.anno})`);
  return attivi;
}

/**
 * @param {object} [config]  configurazione del simulatore (predefinita: quella della mappa)
 * @returns {(zona: string, o: {ora: number, attivi: Map<string, string>, capienza: number}) => object|null}
 */
export function creaStimaFolla(config = JSON.parse(readFileSync(SIM_CONFIG, 'utf8'))) {
  const cfg = parseSimConfig(config);
  const perZona = new Map();
  for (const d of cfg.devices) {
    const z = d.location?.zone;
    if (!z || !d.defs.people_count) continue;
    (perZona.get(z) ?? perZona.set(z, []).get(z)).push(d);
  }
  return function stima(zona, { ora, attivi = new Map(), capienza }) {
    const dispositivi = perZona.get(zona);
    if (!dispositivi?.length) return null;
    let persone = 0;
    const effetti = new Set();
    for (const d of dispositivi) {
      const def = d.defs.people_count;
      let v = baseValue(def, ora, { timezone: cfg.timezone }) * d.scale;
      for (const [nome, eff] of Object.entries(def.effects || {})) {
        if (!attivi.has(nome)) continue;
        v = eff.set !== undefined ? eff.set : v * (eff.multiply ?? 1) + (eff.add ?? 0);
        effetti.add(nome);
      }
      persone += Math.max(0, v);
    }
    // arrotondata: è una stima, non un conteggio
    const arrotondate = persone >= 1000 ? Math.round(persone / 100) * 100 : Math.round(persone / 10) * 10;
    const livello = livelloFolla(persone, capienza);
    return {
      persone_stimate: arrotondate,
      capienza_indicativa: capienza,
      livello: livello.label,
      livello_id: livello.id,
      effetti: [...effetti].map((n) => ({ scenario: n, motivo: attivi.get(n) })),
    };
  };
}
