// Test rapido del motore (nessuna dipendenza): node c1-feed-simulato/test/smoke.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as C from '../src/core/index.js';
import { extractJson } from '../src/llm/adapter.js';

const dir = new URL('../esempi/', import.meta.url);
const data = await C.loadData();

// import JSON e CSV
const adsJson = C.importAds(fs.readFileSync(new URL('annunci-esempio.json', dir), 'utf8'), 'x.json');
const adsCsv = C.importAds(fs.readFileSync(new URL('annunci-esempio.csv', dir), 'utf8'), 'x.csv');
assert.equal(adsJson.length, 3);
assert.equal(adsCsv.length, 2);
assert.deepEqual(adsCsv[0].target, { etaMin: 25, etaMax: 54, genere: 'tutti', area: 'sud' });
assert.equal(adsCsv[0].piattaforma, 'facebook');
const en = C.importAds('ad_name,primary_text,call_to_action,platform,objective,age_min,age_max\nX,"Hello, world",Shop now,IG,Sales,18,34', 'x.csv')[0];
assert.equal(en.cta, 'Acquista ora');
assert.equal(en.piattaforma, 'instagram');
assert.equal(en.obiettivo, 'conversioni');
assert.equal(en.testo, 'Hello, world');

// simulazione deterministica
const s1 = await C.runSimulation({ ads: adsJson, data, config: { perSegmento: 100 } });
const s2 = await C.runSimulation({ ads: adsJson, data, config: { perSegmento: 100 } });
assert.deepEqual(s1.annunci.map((a) => a.totale), s2.annunci.map((a) => a.totale));

// previsione: A (offerta chiara, CTA forte) deve battere B e C
const calib = C.defaultCalibration(data.benchmark);
const pred = C.buildPrediction(s1, data.benchmark, calib);
assert.equal(pred.vincitore.id, 'ad-a');
for (const a of pred.annunci) {
  assert.ok(a.ctr > 0.05 && a.ctr < 10, `CTR plausibile per ${a.nome}: ${a.ctr}`);
  assert.ok(a.cpm.min < a.cpm.centro && a.cpm.centro < a.cpm.max);
}
assert.equal(C.periodoCampagna('2026-11-27'), 'black_friday');
assert.equal(C.periodoCampagna('2026-11-10'), 'novembre');

// verifica e taratura
const reali = JSON.parse(fs.readFileSync(new URL('risultati-demo.json', dir), 'utf8'));
const bt = C.evaluateBacktest(pred, reali);
assert.equal(bt.vincitore.corretto, true);
const punti = pred.annunci.map((a) => ({ sim: a.simClick, rif: a.ctrRiferimento, reale: reali.annunci[a.id].ctr }));
const tarata = C.fitCalibration(punti, calib, pred.annunci.map((a) => ({ previsto: a.cpm.centro, reale: reali.annunci[a.id].cpm })));
const bt2 = C.evaluateBacktest(C.buildPrediction(s1, data.benchmark, tarata), reali);
assert.ok(bt2.ctr.maePuntiPct < bt.ctr.maePuntiPct, 'la taratura riduce l\'errore sugli esempi');

// JSON dentro testo LLM
assert.deepEqual(extractJson('ok ```json\n{"persone":[{"id":"a"}]}\n``` fine'), { persone: [{ id: 'a' }] });

console.log('ok: import, simulazione deterministica, previsione, verifica, taratura');
