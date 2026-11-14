import test from 'node:test';
import assert from 'node:assert/strict';
import { capisci, rispondi, luoghiCitati, momentoCitato, confronta } from '../src/agenti.js';
import { creaModello } from '../src/modello.js';
import { creaRete } from '../src/rete.js';
import { creaGriglia, SOGLIA_PRIVACY } from '../src/griglia.js';
import fs from 'node:fs';
import { ADESSO, EVENTI, leggi, ora, meteoSereno } from './aiuto.js';

const trasporti = leggi('trasporti');
const contestoModello = { eventi: EVENTI, riferimenti: leggi('riferimenti'), stazioni: trasporti.stazioni, adesso: ADESSO, meteoA: meteoSereno };
const base = creaModello(contestoModello);
const ctx = (extra = {}) => ({ modello: base, modelloBase: base, contestoModello, rete: creaRete(trasporti), dati: { trasporti, meteo: {}, aria: { plebiscito: { aqi: 30 } }, allerta: { regionale: null, meteoalarm: [] } }, adesso: ADESSO, ts: ADESSO, zona: null, soloLocale: true, ...extra });

test('luoghi e momenti citati nelle domande', () => {
  assert.deepEqual(luoghiCitati('dal porto a fuorigrotta').map((x) => x.zona), ['beverello', 'maradona']);
  assert.deepEqual(luoghiCitati('San Gregorio Armeno').map((x) => x.zona), ['sangregorio']);
  assert.deepEqual(luoghiCitati('museo archeologico e via toledo').map((x) => x.zona), ['mann', 'toledo']);
  assert.equal(momentoCitato('domani alle 21', ADESSO).ts, ora(15, 21));
  assert.equal(momentoCitato('stasera', ADESSO).ts, ora(14, 20));
  assert.equal(momentoCitato('com’è adesso?', ADESSO).esplicito, false);
});

test('le domande di esempio vengono capite, in italiano e in inglese', () => {
  const a = capisci('Sono appena arrivato al Porto: come raggiungo Fuorigrotta?', ADESSO);
  assert.deepEqual([a.intento, a.da, a.a], ['percorso', 'beverello', 'maradona']);
  const b = capisci('I have just arrived at the Port of Naples. How can I reach Fuorigrotta?', ADESSO);
  assert.deepEqual([b.intento, b.da, b.a], ['percorso', 'beverello', 'maradona']);
  assert.equal(capisci('Domani ci sono due grandi eventi: come evolvono i flussi e quali aree saranno critiche?', ADESSO).intento, 'impatto');
  assert.equal(capisci('Two major events are scheduled tomorrow: how will pedestrian flows evolve, and which areas will be the most critical?', ADESSO).intento, 'impatto');
  assert.equal(capisci('come arrivo al Vomero dalla stazione centrale?', ADESSO).da, 'garibaldi');
  assert.equal(capisci('Cosa succede se chiude la Linea 1?', ADESSO).intento, 'whatif');
  assert.equal(capisci('Cosa posso visitare adesso senza folla?', ADESSO).intento, 'tranquilli');
  assert.equal(capisci('piove domani?', ADESSO).intento, 'meteo');
  assert.equal(capisci('ciao', ADESSO).intento, 'saluto');
});

test('percorso: gli agenti collaborano e il percorso viene disegnato sulla mappa', async () => {
  const r = await rispondi('Sono appena arrivato al Porto: come raggiungo Fuorigrotta?', ctx());
  assert.deepEqual([...new Set(r.passi.map((p) => p.agente))], ['orchestratore', 'mobilita', 'folla', 'eventi', 'meteo']);
  const az = r.azioni.find((x) => x.tipo === 'percorso');
  assert.ok(az.percorso.minuti > 10 && az.da === 'beverello' && az.a === 'maradona');
  assert.match(r.testo, /minuti/);
  assert.ok(r.suggerimenti.length >= 2);
});

test('eventi di domani: aree critiche, flussi, misure e mappa portata al picco', async () => {
  const r = await rispondi('Domani ci sono grandi eventi: come evolvono i flussi e quali aree saranno critiche?', ctx());
  assert.match(r.testo, /Corsa sul lungomare/);
  assert.match(r.testo, /Lungomare/);
  assert.ok(r.passi.some((p) => p.agente === 'folla' && /critiche/.test(p.testo)));
  const quando = r.azioni.find((x) => x.tipo === 'ora').ts;
  assert.ok(quando >= ora(15, 6) && quando <= ora(15, 23));
  assert.ok(r.azioni.find((x) => x.tipo === 'evidenzia').zone.includes('lungomare'));
});

test('what-if dalla chat: scenario applicato e confronto con la situazione di partenza', async () => {
  const r = await rispondi('Simula un concerto al Plebiscito domani alle 21 con 20 mila persone', ctx());
  const sc = r.azioni.find((x) => x.tipo === 'scenario').scenario;
  assert.deepEqual([sc.eventi[0].zona, sc.eventi[0].persone, sc.eventi[0].inizio], ['plebiscito', 20_000, ora(15, 21)]);
  assert.match(r.testo, /Plebiscito/);
  const linea = await rispondi('Cosa succede se chiude la Linea 1?', ctx());
  assert.deepEqual(linea.azioni.find((x) => x.tipo === 'scenario').scenario.lineeChiuse, ['L1']);
  const esito = confronta(ctx(), { pioggia: { da: ora(15, 9), a: ora(15, 19), mm: 5 } });
  assert.ok(esito.dopo.oreCritiche <= esito.prima.oreCritiche);
});

test('consigli senza folla: solo luoghi che si visitano; di notte nessun museo', async () => {
  const r = await rispondi('Cosa posso visitare adesso senza folla?', ctx());
  const zone = r.azioni.find((x) => x.tipo === 'evidenzia').zone;
  assert.ok(zone.length >= 1 && !zone.includes('capodichino') && !zone.includes('garibaldi') && !zone.includes('beverello'));
  const notte = await rispondi('Cosa posso visitare stanotte senza folla?', ctx());
  assert.ok(!(notte.azioni.find((x) => x.tipo === 'evidenzia')?.zone || []).includes('mann'));
});

test('ogni risposta ha testo, passaggi e un orchestratore che apre', async () => {
  for (const d of ['com’è la folla a San Gregorio Armeno?', 'Qual è il posto più affollato adesso?', 'che eventi ci sono domani?', 'piove domani?', 'com’è l’aria?', 'prossima metro da Toledo', 'boh']) {
    const r = await rispondi(d, ctx());
    assert.ok(r.testo.length > 20, d);
    assert.equal(r.passi[0].agente, 'orchestratore', d);
  }
});

test('celle: presenze di fondo dal volume edificato più i luoghi; soglia di privacy', () => {
  const g = creaGriglia(JSON.parse(fs.readFileSync(new URL('../dati/griglia.json', import.meta.url), 'utf8')));
  assert.ok(g.celle.length > 2000);
  assert.equal(g.esagono(g.celle[0]).length, 7);
  const q = base.quadro(ADESSO);
  const r = g.calcola(q, ADESSO);
  assert.equal(r.presenze.length, g.celle.length);
  const neiLuoghi = Object.values(q).reduce((s, x) => s + x.persone, 0);
  assert.ok(r.totale > neiLuoghi + 500_000 && r.totale < 2_000_000, `totale ${r.totale}`);
  assert.equal(r.nascoste, [...r.presenze].filter((p) => p < SOGLIA_PRIVACY).length);
  assert.ok(Math.max(...r.pressione) >= Math.max(...Object.values(q).map((x) => x.quota)) * 0.99);
});
