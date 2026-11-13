// Punto d'ingresso del motore condiviso (Node + browser).
export { loadData, PIATTAFORME, OBIETTIVI, POSIZIONAMENTI, SETTORI, CTA, AREE_TARGET } from './data.js';
export { normalizeAd, importAds, parseCsv, inTarget } from './ads.js';
export { generateAudience, buildSegments, describePersona, labelFascia } from './audience.js';
export { extractFeatures, featureChips } from './features.js';
export { runSimulation, VERSIONE_MODELLO } from './simulate.js';
export { buildPrediction } from './predict.js';
export { defaultCalibration, fitCalibration, simToCtr, ctrRiferimento } from './calibration.js';
export { evaluateBacktest } from './backtest.js';
export { periodoCampagna } from './heuristic.js';
