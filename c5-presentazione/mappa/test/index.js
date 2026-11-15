// Permette `node --test c5-presentazione/mappa/test/` (Node 22 tratta la cartella come un modulo
// e carica questo file). In alternativa: `node --test "c5-presentazione/mappa/test/*.test.js"`
// oppure `npm test` dentro c5-presentazione/mappa.
import './validate.test.js';
import './core.test.js';
import './llm.test.js';
import './sim.test.js';
import './http.test.js';
import './agenti-fonti.test.js';
