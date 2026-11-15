import test from 'node:test';
import assert from 'node:assert/strict';
import { creaModello, flussi, valoreProfilo, tipoGiorno, ORA } from '../src/modello.js';
import { LUOGHI3D } from '../src/luoghi3d.js';
import { ADESSO, EVENTI, leggi, ora, meteoSereno } from './aiuto.js';

const riferimenti = leggi('riferimenti');
const trasporti = leggi('trasporti');
const contesto = { eventi: EVENTI, riferimenti, stazioni: trasporti.stazioni, adesso: ADESSO, meteoA: meteoSereno };

test('i luoghi 3D comprendono i 10 della mappa 2D e hanno tutti i campi del modello', () => {
  assert.ok(Object.keys(LUOGHI3D).length >= 26);
  for (const [zona, l] of Object.entries(LUOGHI3D)) {
    assert.ok(l.capienza > 0 && l.lat > 40.7 && l.lat < 41 && l.lon > 14.1 && l.lon < 14.4, zona);
    assert.ok(l.profilo && l.breve && typeof l.turisti === 'number' && typeof l.aperto === 'number', zona);
  }
  assert.equal(LUOGHI3D.plebiscito.originale, true);
  assert.equal(LUOGHI3D.sanlaise.originale, false);
});

test('tipo di giorno e profilo: sabato, festivo, feriale; di notte quasi nessuno', () => {
  assert.equal(tipoGiorno(ora(14, 12)), 'sab');
  assert.equal(tipoGiorno(ora(15, 12)), 'fes');
  assert.equal(tipoGiorno(ora(16, 12)), 'fer');
  assert.ok(valoreProfilo('museo', ora(16, 4)) < 0.05);
  assert.ok(valoreProfilo('stazione', ora(16, 8)) > valoreProfilo('stazione', ora(16, 3)));
});

test('la stima è deterministica e coerente (livello, intervallo, composizione che fa 100%)', () => {
  const m = creaModello(contesto);
  const a = m.stima('plebiscito', ADESSO);
  const b = creaModello(contesto).stima('plebiscito', ADESSO);
  assert.equal(a.persone, b.persone);
  assert.ok(a.min <= a.persone && a.persone <= a.max);
  assert.ok(['tranquillo', 'normale', 'vivace', 'affollato'].includes(a.livello));
  const c = a.composizione;
  assert.ok(Math.abs(c.residenti + c.pendolari + c.turistiItaliani + c.turistiStranieri - 1) < 1e-9);
});

test('un evento reale in calendario alza la stima del luogo e dei luoghi vicini', () => {
  const con = creaModello(contesto);
  const senza = creaModello({ ...contesto, eventi: { ...EVENTI, comune: [] } });
  const t = ora(15, 11);
  assert.ok(con.stima('lungomare', t).persone > senza.stima('lungomare', t).persone + 2000);
  assert.equal(con.stima('lungomare', t).componenti.eventi[0].titolo, 'Corsa sul lungomare');
  // prima dell'inizio la gente arriva passando dai luoghi vicini
  assert.ok(con.stima('chiaia', ora(15, 8, 30)).persone >= senza.stima('chiaia', ora(15, 8, 30)).persone);
  assert.equal(con.eventiTra(ora(15, 0), ora(15, 23)).filter((e) => e.persone >= 1000).length, 1);
});

test('partita e crociere: stadio pieno la sera, croceristi in centro a metà giornata', () => {
  const m = creaModello(contesto);
  assert.equal(m.stima('maradona', ora(16, 21)).livello, 'affollato');
  assert.equal(m.stima('maradona', ora(16, 11)).livello, 'tranquillo');
  const senza = creaModello({ ...contesto, eventi: { ...EVENTI, crociere: [] } });
  assert.ok(m.stima('centro_storico', ora(16, 12)).persone > senza.stima('centro_storico', ora(16, 12)).persone);
});

test('what-if pioggia: meno persone all’aperto, di più nei musei', () => {
  const base = creaModello(contesto);
  const pioggia = creaModello(contesto, { pioggia: { da: ora(15, 9), a: ora(15, 15), mm: 5 } });
  const t = ora(15, 12);
  assert.ok(pioggia.stima('lungomare', t).persone < base.stima('lungomare', t).persone * 0.8);
  assert.ok(pioggia.stima('mann', t).persone > base.stima('mann', t).persone);
  assert.equal(pioggia.stima('lungomare', ora(15, 18)).persone, base.stima('lungomare', ora(15, 18)).persone);
});

test('what-if evento e misure: il concerto riempie la piazza, la diversione abbassa il picco', () => {
  const evento = { id: 'x', titolo: 'Concerto', zona: 'plebiscito', inizio: ora(15, 21), durataOre: 3, persone: 20_000 };
  const senza = creaModello(contesto, { eventi: [evento] });
  const con = creaModello(contesto, { eventi: [evento], misure: { diversione: true } });
  const t = ora(15, 22);
  assert.equal(senza.stima('plebiscito', t).livello, 'affollato');
  assert.ok(con.stima('plebiscito', t).persone < senza.stima('plebiscito', t).persone);
  // le persone non spariscono: vanno nei luoghi vicini
  const somma = (m) => Object.values(m.quadro(t)).reduce((s, x) => s + x.persone, 0);
  assert.ok(Math.abs(somma(con) - somma(senza)) < 30);
  assert.ok(con.indicatori(ADESSO, 48).eccesso < senza.indicatori(ADESSO, 48).eccesso);
});

test('what-if linea chiusa: cambia la stima dei luoghi serviti da quella linea', () => {
  const base = creaModello(contesto);
  const chiusa = creaModello(contesto, { lineeChiuse: ['L1'] });
  const t = ora(16, 18);
  const diversi = Object.keys(LUOGHI3D).filter((z) => chiusa.stima(z, t).persone !== base.stima(z, t).persone);
  assert.ok(diversi.length >= 3, `luoghi cambiati: ${diversi}`);
  assert.ok(diversi.includes('vomero') || diversi.includes('dante') || diversi.includes('toledo'));
});

test('criticità e sintesi: ordinate dal luogo più pieno, con ore sopra soglia', () => {
  const m = creaModello(contesto);
  const c = m.criticita(ora(15, 6), 18);
  assert.equal(c.length, Object.keys(LUOGHI3D).length);
  for (let i = 1; i < c.length; i++) assert.ok(c[i - 1].picco.quota >= c[i].picco.quota);
  assert.ok(c.find((x) => x.zona === 'lungomare').oreCritiche >= 1);
  const s = m.sintesi(ADESSO);
  assert.equal(Object.values(s.perLivello).reduce((a, b) => a + b, 0), c.length);
});

test('flussi: verso il luogo dell’evento prima dell’inizio, in uscita alla fine, da stazioni vere', () => {
  const m = creaModello(contesto);
  const prima = flussi(m, ora(15, 8), { stazioni: trasporti.stazioni });
  const arrivo = prima.find((f) => f.zona === 'lungomare');
  assert.ok(arrivo && arrivo.arrivo && arrivo.persone > 500);
  assert.ok(arrivo.da.stazione, 'il flusso parte da una stazione dello snapshot GTFS');
  const dopo = flussi(m, ora(15, 13), { stazioni: trasporti.stazioni }).find((f) => f.zona === 'lungomare');
  assert.ok(dopo && !dopo.arrivo);
  assert.ok(flussi(m, ADESSO, { stazioni: trasporti.stazioni }).every((f) => f.persone >= 150));
  assert.equal(ORA, 3_600_000);
});
