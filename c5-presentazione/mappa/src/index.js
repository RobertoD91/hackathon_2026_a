// Punto d'ingresso del nucleo per Node.
//
//   import { createHub, Agent, createLLM } from './src/index.js';   (da c5-presentazione/mappa/)
//
// Nel browser NON importare questo file (contiene node:http): usa `src/client.js`
// per le dashboard, oppure direttamente `src/core.js`, `src/agent.js`, `src/llm.js`.

export { createHub } from './hub.js';
export { createCore } from './core.js';
export { Agent } from './agent.js';
export { EventBus } from './bus.js';
export { HubState } from './state.js';
export { createLLM, mockComplete, parseJsonLoose, LLMError, DEFAULT_ANTHROPIC_MODEL } from './llm.js';
export { createLogger, silentLogger } from './log.js';
export { createEvent, newEventId, EVENT_TYPES } from './events.js';
export {
  validateReading,
  validateScenario,
  validateChat,
  NET_VALUES,
  STANDARD_READINGS,
} from './validate.js';
export { createSimulator, parseSimConfig, hourOf, formatClock } from '../../../citta-api/simulatore/sim-core.js';
export { attachSimulator, runSimulator, loadSimConfig, followStream } from '../sim/simulate.js';
