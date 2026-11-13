#!/usr/bin/env node
// Previsione da riga di comando, utile in sede per provare in fretta un file di annunci.
//   node c1-feed-simulato/cli.js esempi/annunci-esempio.json
//   node c1-feed-simulato/cli.js annunci.csv --risultati risultati.json   (backtest)
//   node c1-feed-simulato/cli.js annunci.csv --llm                       (usa LLM_PROVIDER)
//   node c1-feed-simulato/cli.js annunci.csv --json                      (output JSON)

import fs from 'node:fs';
import path from 'node:path';
import {
  loadData, importAds, runSimulation, buildPrediction, defaultCalibration, evaluateBacktest, VERSIONE_MODELLO,
} from './src/core/index.js';
import { createLlm } from './src/llm/adapter.js';
import { makeRefiner } from './src/llm/persona-llm.js';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
if (!file) {
  console.log('Uso: node cli.js <annunci.json|csv> [--risultati file.json] [--calibrazione file.json] [--llm] [--json] [--per-segmento N]');
  process.exit(1);
}
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };

const data = await loadData();
const ads = importAds(fs.readFileSync(file, 'utf8'), file);
const llm = args.includes('--llm') ? createLlm() : null;
const sim = await runSimulation({
  ads,
  data,
  config: { perSegmento: Number(opt('--per-segmento') || 200) },
  refine: llm && !llm.isMock ? makeRefiner(llm, {
    imageFor: (ad) => {
      if (!ad.immagine || /^(https?:|data:)/.test(ad.immagine)) return ad.immagine?.startsWith('data:') ? ad.immagine : null;
      const p = path.resolve(path.dirname(file), ad.immagine);
      const alt = path.resolve(path.dirname(new URL(import.meta.url).pathname), ad.immagine);
      const f = fs.existsSync(p) ? p : fs.existsSync(alt) ? alt : null;
      return f ? `data:image/${path.extname(f).slice(1).replace('jpg', 'jpeg')};base64,${fs.readFileSync(f).toString('base64')}` : null;
    },
  }) : undefined,
  modo: llm && !llm.isMock ? llm.provider : 'mock',
  modello: llm && !llm.isMock ? llm.model : VERSIONE_MODELLO,
});
const calibFile = opt('--calibrazione');
const calib = calibFile ? JSON.parse(fs.readFileSync(calibFile, 'utf8')) : defaultCalibration(data.benchmark);
const pred = buildPrediction(sim, data.benchmark, calib);

if (args.includes('--json')) {
  console.log(JSON.stringify({ simulazione: sim, previsione: pred }, (k, v) => (v instanceof Map ? Object.fromEntries(v) : v), 2));
  process.exit(0);
}

const pct = (x) => `${x.toFixed(2)}%`;
console.log(`\nModo: ${sim.modo} (${sim.modello}), ${sim.personeTotali} persone virtuali\n`);
for (const r of pred.sintesi) console.log(`• ${r}`);
console.log('\nCTR previsto per segmento:');
const head = ['Segmento'.padEnd(10), ...pred.annunci.map((a) => a.nome.slice(0, 16).padStart(17))].join('');
console.log(head);
for (const seg of sim.segmenti) {
  const row = [seg.label.padEnd(10), ...pred.annunci.map((a) => {
    const fuori = sim.annunci.find((x) => x.id === a.id).segmenti[seg.id].fuoriTarget;
    return `${pct(a.ctrSegmenti[seg.id])}${fuori ? '*' : ' '}`.padStart(17);
  })].join('');
  console.log(row);
}
console.log(['Totale'.padEnd(10), ...pred.annunci.map((a) => `${pct(a.ctr)} `.padStart(17))].join(''));
console.log('(* fuori target: stima "e se")\n\nFascia di CPM:');
for (const a of pred.annunci) console.log(`  ${a.nome}: ${a.cpm.min.toFixed(2)}–${a.cpm.max.toFixed(2)} € (${a.cpm.fattori.map((f) => `${f.nome} ×${f.mult}`).join(', ')})`);

const risFile = opt('--risultati');
if (risFile) {
  const reali = JSON.parse(fs.readFileSync(risFile, 'utf8'));
  const bt = evaluateBacktest(pred, reali);
  console.log('\nVerifica:');
  if (bt.vincitore) console.log(`  Vincitore: previsto ${bt.vincitore.previsto}, reale ${bt.vincitore.reale} → ${bt.vincitore.corretto ? 'GIUSTO' : 'SBAGLIATO'}`);
  if (bt.ctr) console.log(`  CTR: errore medio ${bt.ctr.maePuntiPct.toFixed(2)} punti percentuali (${bt.ctr.mapePct?.toFixed(0)}% relativo)`);
  if (bt.cpm) console.log(`  CPM dentro la fascia: ${bt.cpm.dentro}/${bt.cpm.totale}`);
  if (bt.segmenti) console.log(`  Segmenti: errore medio ${bt.segmenti.maePuntiPct.toFixed(2)} pp su ${bt.segmenti.n} valori`);
}
