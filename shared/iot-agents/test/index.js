// Permette `node --test shared/iot-agents/test/` (Node 22 tratta la cartella come un modulo
// e carica questo file). In alternativa: `node --test "shared/iot-agents/test/*.test.js"`
// oppure `npm test` dentro shared/iot-agents.
import './validate.test.js';
import './core.test.js';
import './llm.test.js';
import './sim.test.js';
import './http.test.js';
import './fattoria.test.js';
import './mqtt.test.js';
import './fonti-napoli.test.js';
