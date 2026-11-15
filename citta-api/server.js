#!/usr/bin/env node
// API dati città di Napoli: il "cervello dati" di TwinCIRO.
//
//   node citta-api/server.js                        # porta 8791, snapshot della repo
//   PORT=8791 CITTA_API_TOKEN=… CITTA_AGGIORNA=si node citta-api/server.js
//
// Variabili d'ambiente (tutte facoltative), dettagli nel README:
//   PORT (8791) · HOST (0.0.0.0) · CITTA_API_TOKEN (Bearer) · CITTA_API_CORS (https://robertodisanto.it)
//   NAPOLI_UA (User-Agent) · CITTA_DATI (cartella degli snapshot) · CITTA_AGGIORNA (rinfresco degli snapshot)
//   CITTA_TIENI_CALDO (1) · CITTA_PAUSA_429 (15m) · CITTA_LOG (1)

import { leggiConfig } from './src/config.js';
import { creaServizio } from './src/servizio.js';

let config;
try {
  config = leggiConfig();
} catch (err) {
  console.error(`[citta-api] configurazione non valida: ${err.message}`);
  process.exit(2);
}

let servizio;
try {
  servizio = await creaServizio(config);
  await servizio.avvia();
} catch (err) {
  console.error(`[citta-api] avvio non riuscito: ${err.message}`);
  process.exit(1);
}

let chiusura = false;
for (const segnale of ['SIGINT', 'SIGTERM']) {
  process.on(segnale, async () => {
    if (chiusura) return;
    chiusura = true;
    console.log(`[citta-api] ${segnale}: chiudo`);
    const forza = setTimeout(() => process.exit(0), 5000);
    forza.unref();
    await servizio.chiudi();
    process.exit(0);
  });
}
