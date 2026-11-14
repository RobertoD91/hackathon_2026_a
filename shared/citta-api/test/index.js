// Permette `node --test shared/citta-api/test/` (Node 22 tratta la cartella come un modulo e
// carica questo file). In alternativa: `npm test` dentro shared/citta-api.
import './unita.test.js';
import './api.test.js';
import './revisione.test.js';
