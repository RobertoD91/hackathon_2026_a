#!/usr/bin/env node
// Rigenera gli snapshot nella cartella dati dell'API (CITTA_DATI; predefinita: quella della repo,
// citta-api/dati/) con lo script strumenti/aggiorna-dati-napoli.js.
// L'API in esecuzione se ne accorge da sola entro un minuto (ricarica i file cambiati).
//
//   node citta-api/aggiorna.js                       # tutte le sezioni (1-6 minuti)
//   node citta-api/aggiorna.js --solo eventi,aria    # solo alcune
//   node citta-api/aggiorna.js --curl                # richieste con curl (WAF che rifiutano Node)
//   docker compose exec citta-api node citta-api/aggiorna.js --solo eventi   # nel container

import { aggiornaDati, fetchConCurl } from './strumenti/aggiorna-dati-napoli.js';
import { leggiConfig, SEZIONI } from './src/config.js';
import { creaRete } from './src/rete.js';

const arg = (n) => {
  const i = process.argv.indexOf(n);
  return i > 0 ? process.argv[i + 1] : undefined;
};

const config = leggiConfig();
const solo = (arg('--solo') || '').split(',').map((s) => s.trim()).filter(Boolean);
const ignote = solo.filter((s) => !SEZIONI.includes(s));
if (ignote.length) {
  console.error(`[aggiorna] sezioni sconosciute: ${ignote.join(', ')} (disponibili: ${SEZIONI.join(', ')})`);
  process.exit(2);
}
const rete = creaRete({ fetch: process.argv.includes('--curl') ? fetchConCurl : undefined, ua: config.ua, uaForzato: config.uaForzato, pausa429Ms: config.pausa429Ms, log: (m) => console.log(`[aggiorna] ${m}`) });
const t0 = Date.now();
const { scritti, errori } = await aggiornaDati({ solo: solo.length ? solo : undefined, out: config.cartellaDati, fetch: rete.fetch, log: (m) => console.log(`[aggiorna] ${m}`) });
console.log(`[aggiorna] fatto in ${((Date.now() - t0) / 1000).toFixed(0)} s in ${config.cartellaDati}: ${scritti.join(', ') || 'nessun file'}`);
for (const e of errori) console.error(`[aggiorna] ERRORE ${e.sezione}: ${e.errore}`);
process.exitCode = errori.length ? 1 : 0;
