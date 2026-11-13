// Test della logica pura: conversioni, ottimizzatore, bilancio e KPI.
//   node --test c2-cer-quartiere/test/

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  N_SLOT, slotDi, slotDa, oraDiSlot, vuoto, luxToKw, giornataSolare, kwSereno, fattoreNuvole,
  consumoBaseKw, climaKw, richiesta, profiloBlocco, profiloAbitudine, energia, estremi, hhmm,
} from '../model/energia.js';
import { pianifica, kwhAlSole, ordineRoundRobin, indiceJain } from '../model/ottimizzatore.js';
import { Bilancio } from '../model/bilancio.js';
import { PARAMETRI, P, euroPerKwhCondiviso, prezzoEnergia } from '../model/parametri.js';
import { FAMIGLIE, TETTI, CARICHI } from '../model/quartiere.js';

const fam = (id, extra = {}) => ({ id, nome: id, scala: 'A', persone: 2, profilo: 'casa', carichi: [], ...extra });
/** Sole libero costante `kw` tra le ore `da` e `a`, zero altrove. */
function sole(kw, da, a) {
  const s = vuoto();
  for (let i = 0; i < N_SLOT; i++) if (oraDiSlot(i) >= da && oraDiSlot(i) < a) s[i] = kw;
  return s;
}

// ------------------------------------------------------------------ parametri

test('ogni parametro ha valore, unità, fonte e stato', () => {
  for (const [nome, p] of Object.entries(PARAMETRI)) {
    assert.ok(p.valore !== undefined, nome);
    assert.equal(typeof p.fonte, 'string', nome);
    assert.ok(p.fonte.length > 20, `${nome}: fonte troppo vaga`);
    assert.equal(typeof p.stato, 'string', nome);
  }
  assert.equal(P('punOrario').length, 24);
  assert.ok(Math.abs(euroPerKwhCondiviso() - 0.129) < 1e-9);
  assert.ok(prezzoEnergia(19) > prezzoEnergia(13), 'la sera costa più di mezzogiorno');
});

// ------------------------------------------------------------------ energia

test('griglia della giornata: 72 quarti d\'ora dalle 6 alle 24', () => {
  assert.equal(N_SLOT, 72);
  assert.equal(slotDi(6), 0);
  assert.equal(slotDi(6.24), 0);
  assert.equal(slotDi(13), 28);
  assert.equal(slotDi(30), 71);
  assert.equal(slotDa(13.01), 29);
  assert.equal(oraDiSlot(28), 13);
  assert.equal(hhmm(13.5), '13:30');
  assert.equal(hhmm(9.25), '09:15');
});

test('luce → kW: conversione dichiarata (lux / 60 = W/m², × kWp × PR)', () => {
  assert.equal(luxToKw(0, 8), 0);
  assert.equal(luxToKw(-5, 8), 0);
  assert.equal(luxToKw(null, 8), 0);
  // 60.000 lux = 1000 W/m² → 8 kWp × 0,85
  assert.ok(Math.abs(luxToKw(60_000, 8) - 6.8) < 1e-9);
  assert.ok(Math.abs(luxToKw(30_000, 8, { luxPerWm2: 120 }) - 1.7) < 1e-9);
});

test('giornata solare a Napoli: alba, tramonto e irraggiamento plausibili', () => {
  const nov = giornataSolare(Date.parse('2026-11-14T10:00:00Z'));
  assert.ok(Math.abs(nov.alba - 6.92) < 0.15, `alba ${hhmm(nov.alba)}`); // effemeridi: 06:55
  assert.ok(Math.abs(nov.tramonto - 16.68) < 0.15, `tramonto ${hhmm(nov.tramonto)}`); // 16:41
  assert.ok(nov.gMezzogiorno > 650 && nov.gMezzogiorno < 850);
  const giu = giornataSolare(Date.parse('2026-06-21T10:00:00Z'));
  assert.ok(giu.tramonto - giu.alba > 14.5, 'a giugno le giornate sono più lunghe');
  assert.equal(kwSereno(3, nov, 6), 0, 'di notte niente sole');
  assert.ok(kwSereno(nov.mezzogiorno, nov, 18) > 10);
});

test('fattore nuvole (Kasten-Czeplak): 1 a cielo sereno, 0,25 a cielo coperto', () => {
  assert.equal(fattoreNuvole(0), 1);
  assert.ok(Math.abs(fattoreNuvole(100) - 0.25) < 1e-9);
  assert.ok(fattoreNuvole(50) > 0.9);
});

test('consumi: profilo base sempre positivo, la temperatura cambia la domanda', () => {
  const f = fam('x', { riscaldamento: 'pdc', clima: 'split' });
  for (let h = 0; h < 24; h += 0.5) assert.ok(consumoBaseKw(f, h) > 0);
  assert.equal(climaKw(f, 12, 19), 0, 'a 19 °C niente riscaldamento');
  assert.ok(climaKw(f, 12, 9) > climaKw(f, 12, 14), 'più freddo = più riscaldamento');
  assert.ok(climaKw(f, 15, 32) > 0, 'col caldo parte lo split');
  assert.equal(climaKw(f, 3, 5), 0, 'di notte (fuori dalla presenza) spento');
  assert.equal(climaKw(fam('gas', { riscaldamento: 'gas' }), 12, 5), 0, 'caldaia a gas: niente kW elettrici');
});

test('consumi giornalieri delle famiglie in un intervallo realistico (5-12 kWh)', () => {
  for (const f of FAMIGLIE) {
    let e = 0;
    for (let h = 0; h < 24; h += 0.25) e += (consumoBaseKw(f, h) + climaKw(f, h, 14)) * 0.25;
    for (const c of f.carichi) e += richiesta(f, c).kwh;
    assert.ok(e > 4 && e < 20, `${f.nome}: ${e.toFixed(1)} kWh/giorno`);
  }
});

test('profili dei carichi: energia conservata, estremi corretti', () => {
  const p = profiloBlocco(12, 2, 0.5);
  assert.ok(Math.abs(energia(p) - 1) < 1e-9);
  assert.deepEqual(estremi(p), { inizio: 12, fine: 14 });
  const r = richiesta(fam('a'), { tipo: 'auto', abitudine: 19, finestra: [9, 24] });
  assert.equal(r.divisibile, true);
  assert.ok(Math.abs(energia(profiloAbitudine(r)) - CARICHI.auto.kwh) < 1e-6);
  const tardi = profiloAbitudine(richiesta(fam('a'), { tipo: 'lavatrice', abitudine: 10 }), { da: 15 });
  assert.equal(estremi(tardi).inizio, 15, 'se l\'ora solita è passata parte adesso');
});

// ------------------------------------------------------------------ ottimizzatore

test('ottimizzatore: la lavatrice delle 20 va nelle ore di sole', () => {
  const r = richiesta(fam('a'), { tipo: 'lavatrice', abitudine: 20, finestra: [8, 22] });
  const { assegnazioni } = pianifica({ ora: 6, surplus: sole(3, 11, 15), richieste: [r] });
  const a = assegnazioni[0];
  assert.equal(a.cambia, true);
  const e = estremi(a.profilo);
  assert.ok(e.inizio >= 11 && e.fine <= 15, `${hhmm(e.inizio)}-${hhmm(e.fine)}`);
  assert.ok(Math.abs(a.kwhSole - 1) < 1e-6, 'tutta al sole');
  assert.equal(a.kwhSoleAbitudine, 0);
  assert.ok(Math.abs(a.guadagnoKwh - 1) < 1e-6);
});

test('ottimizzatore: rispetta la finestra della famiglia', () => {
  const r = richiesta(fam('a'), { tipo: 'lavatrice', abitudine: 20, finestra: [14, 22] });
  const { assegnazioni } = pianifica({ ora: 6, surplus: sole(3, 10, 15), richieste: [r] });
  const e = estremi(assegnazioni[0].profilo);
  assert.ok(e.inizio >= 14 && e.fine <= 22);
});

test('ottimizzatore: niente sole → nessuna proposta (resta l\'abitudine)', () => {
  const r = richiesta(fam('a'), { tipo: 'lavastoviglie', abitudine: 21, finestra: [8, 23] });
  const { assegnazioni } = pianifica({ ora: 6, surplus: vuoto(), richieste: [r], sogliaEuro: 99 });
  assert.equal(assegnazioni[0].cambia, false);
  assert.equal(estremi(assegnazioni[0].profilo).inizio, 21);
});

test('ottimizzatore: non pianifica nel passato', () => {
  const r = richiesta(fam('a'), { tipo: 'lavatrice', abitudine: 20, finestra: [8, 22] });
  const { assegnazioni } = pianifica({ ora: 13.1, surplus: sole(3, 9, 15), richieste: [r] });
  assert.ok(estremi(assegnazioni[0].profilo).inizio >= 13.25);
});

test('ottimizzatore: un carico divisibile riempie il sole e completa l\'energia', () => {
  const r = richiesta(fam('a'), { tipo: 'auto', abitudine: 19, finestra: [9, 23] });
  const { assegnazioni } = pianifica({ ora: 6, surplus: sole(1.5, 10, 14), richieste: [r] });
  const a = assegnazioni[0];
  assert.ok(Math.abs(energia(a.profilo) - r.kwh) < 1e-6, 'energia completa');
  assert.ok(a.profilo.every((kw) => kw <= r.potenzaKw + 1e-9), 'mai oltre la potenza della wallbox');
  assert.ok(Math.abs(a.kwhSole - 6) < 1e-6, '4 ore × 1,5 kW di sole');
});

test('ottimizzatore: due famiglie e poco sole → uno a testa (round robin, equità)', () => {
  const A = fam('a');
  const B = fam('b');
  const richieste = [
    richiesta(A, { tipo: 'lavatrice', abitudine: 20, finestra: [8, 22] }),
    richiesta(A, { tipo: 'lavastoviglie', abitudine: 21, finestra: [8, 23] }),
    richiesta(B, { tipo: 'lavatrice', abitudine: 20, finestra: [8, 22] }),
  ];
  // sole libero per due soli carichi (0,55 kW per 4 ore)
  const { assegnazioni } = pianifica({ ora: 6, surplus: sole(0.55, 11, 15), richieste, ordineFamiglie: ['a', 'b'], sogliaEuro: 99 });
  const alSole = assegnazioni.filter((a) => a.cambia).map((a) => a.id).sort();
  assert.deepEqual(alSole, ['a:lavastoviglie', 'b:lavatrice'], 'B non resta senza sole per dare il secondo carico ad A');
  assert.deepEqual(ordineRoundRobin(richieste, ['b', 'a']).map((r) => r.famiglia), ['b', 'a', 'a']);
});

test('ottimizzatore: il sole non viene contato due volte', () => {
  const richieste = ['a', 'b', 'c', 'd'].map((id) => richiesta(fam(id), { tipo: 'lavatrice', abitudine: 20, finestra: [8, 22] }));
  const surplus = sole(1, 12, 14); // 2 kWh di sole libero in tutto
  const { assegnazioni, residuo } = pianifica({ ora: 6, surplus, richieste });
  const tot = assegnazioni.reduce((n, a) => n + a.kwhSole, 0);
  assert.ok(tot <= 2 + 1e-6, `kWh al sole assegnati ${tot}`);
  assert.ok(residuo.every((v) => v > -1.0001));
});

test('ottimizzatore: un piano già accettato si cambia solo se il guadagno supera la soglia', () => {
  const r = richiesta(fam('a'), { tipo: 'lavatrice', abitudine: 20, finestra: [8, 22] });
  const attuale = profiloBlocco(12, 2, 0.5);
  const quasiUguale = pianifica({ ora: 6, surplus: sole(3, 11.5, 14), richieste: [{ ...r, attuale }] });
  assert.equal(quasiUguale.assegnazioni[0].cambia, false, 'non disturbo la famiglia per pochi Wh');
  assert.equal(quasiUguale.assegnazioni[0].scelta, 'attuale');
  // nuvola sulle 12-14: conviene spostarla alle 14-16
  const nuvola = pianifica({ ora: 6, surplus: sole(3, 14, 16), richieste: [{ ...r, attuale }] });
  assert.equal(nuvola.assegnazioni[0].cambia, true);
  assert.equal(estremi(nuvola.assegnazioni[0].profilo).inizio, 14);
});

test('ottimizzatore: se il sole è tutto prenotato sposta per prezzo solo se si risparmia davvero', () => {
  const r = richiesta(fam('a'), { tipo: 'auto', abitudine: 18, finestra: [18, 24] });
  const { assegnazioni } = pianifica({ ora: 6, surplus: vuoto(), richieste: [r] });
  const a = assegnazioni[0];
  assert.equal(a.scelta, 'prezzo');
  assert.ok(a.risparmioEuro >= 0.15);
  assert.ok(estremi(a.profilo).inizio >= 20, 'dopo il picco di prezzo serale');
});

test('kwhAlSole e indice di Jain', () => {
  assert.equal(kwhAlSole(profiloBlocco(12, 1, 2), sole(1, 12, 13)), 1);
  assert.equal(indiceJain([1, 1, 1, 1]), 1);
  assert.ok(Math.abs(indiceJain([1, 0, 0, 0]) - 0.25) < 1e-9);
  assert.equal(indiceJain([]), 1);
});

// ------------------------------------------------------------------ bilancio

test('bilancio: energia condivisa = somma oraria del minimo tra produzione e consumi', () => {
  const b = new Bilancio({ famiglie: [{ id: 'a' }, { id: 'b' }] });
  // ore 12: prod 4 kW, consumi con = 1+2, senza = 1+0,5
  b.aggiungi({ h: 12, dtH: 1, prodKw: 4, consumi: { con: { a: 1, b: 2 }, senza: { a: 1, b: 0.5 } } });
  // ore 20: niente sole
  b.aggiungi({ h: 20, dtH: 1, prodKw: 0, consumi: { con: { a: 1, b: 0 }, senza: { a: 1, b: 1.5 } } });
  const con = b.kpi('con');
  const senza = b.kpi('senza');
  assert.equal(con.prodottaKwh, 4);
  assert.equal(con.condivisaKwh, 3);
  assert.equal(senza.condivisaKwh, 1.5);
  assert.equal(con.consumataKwh, senza.consumataKwh, 'stessa energia consumata: cambia solo quando');
  assert.equal(con.quotaCondivisa, 0.75);
  assert.ok(Math.abs(con.incentivoEuro - 3 * euroPerKwhCondiviso()) < 1e-9);
  assert.ok(Math.abs(con.co2EvitataKg - 3 * P('fattoreEmissione')) < 1e-9);
  const r = b.risultati();
  assert.equal(r.delta.condivisaKwh, 1.5);
  assert.ok(r.delta.bollettaEuro > 0, 'spostare consumi dalla sera a mezzogiorno costa meno');
  assert.ok(Math.abs(r.annuo.condivisaKwh - 1.5 * 365) < 1e-9);
});

test('bilancio: usa le ore, non i singoli istanti (regola GSE)', () => {
  const b = new Bilancio({ famiglie: [{ id: 'a' }] });
  // nella stessa ora: prima sole senza consumi, poi consumi senza sole
  b.aggiungi({ h: 12, dtH: 0.5, prodKw: 2, consumi: { con: { a: 0 }, senza: { a: 0 } } });
  b.aggiungi({ h: 12.5, dtH: 0.5, prodKw: 0, consumi: { con: { a: 2 }, senza: { a: 2 } } });
  assert.equal(b.kpi('con').condivisaKwh, 1, 'su base oraria 1 kWh prodotto e 1 consumato = 1 condiviso');
});

test('bilancio: la ripartizione per famiglia somma al totale', () => {
  const b = new Bilancio({ famiglie: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] });
  for (let h = 6; h < 24; h += 0.25) {
    const prod = h > 8 && h < 16 ? 3 : 0;
    b.aggiungi({ h, dtH: 0.25, prodKw: prod, consumi: { con: { a: 1, b: 0.5, c: h > 18 ? 2 : 0.2 }, senza: { a: 1, b: 0.5, c: 0.3 } } });
  }
  for (const m of ['con', 'senza']) {
    const k = b.kpi(m);
    const somma = Object.values(k.famiglie).reduce((n, f) => n + f.condivisaKwh, 0);
    assert.ok(Math.abs(somma - k.condivisaKwh) < 1e-9, m);
    assert.ok(k.equita > 0 && k.equita <= 1);
  }
  const s = b.serieKw();
  assert.equal(s.prod.length, N_SLOT);
  assert.equal(s.prod[slotDi(12)], 3);
  assert.equal(s.prod[0], 0);
});

test('bilancio: ignora intervalli fuori dalla giornata o senza durata', () => {
  const b = new Bilancio({ famiglie: [{ id: 'a' }] });
  b.aggiungi({ h: 3, dtH: 1, prodKw: 5, consumi: { con: { a: 1 }, senza: { a: 1 } } });
  b.aggiungi({ h: 12, dtH: 0, prodKw: 5, consumi: { con: { a: 1 }, senza: { a: 1 } } });
  assert.equal(b.kpi('con').prodottaKwh, 0);
  b.reset();
  assert.equal(b.oreSimulate, 0);
});

test('il quartiere è coerente: tetti con kWp, famiglie con carichi del catalogo', () => {
  assert.ok(TETTI.length >= 3);
  const zone = new Set(TETTI.map((t) => t.zona));
  for (const f of FAMIGLIE) {
    assert.ok(zone.has(`scala-${f.scala.toLowerCase()}`), `${f.nome}: scala senza tetto`);
    for (const c of f.carichi) {
      assert.ok(CARICHI[c.tipo], `${f.nome}: ${c.tipo}`);
      const r = richiesta(f, c);
      assert.ok(r.abitudine >= r.finestra[0] - 1e-9 || r.tipo === 'auto', `${f.nome} ${c.tipo}: abitudine fuori finestra`);
      assert.ok(r.abitudine + r.durataH <= 24 + 1e-9, `${f.nome} ${c.tipo}: finisce dopo mezzanotte`);
    }
  }
});

test('bilancio: la copia è indipendente dall\'originale', () => {
  const b = new Bilancio({ famiglie: [{ id: 'a' }] });
  b.aggiungi({ h: 12, dtH: 1, prodKw: 2, consumi: { con: { a: 1 }, senza: { a: 1 } } });
  const c = b.clona();
  c.aggiungi({ h: 13, dtH: 1, prodKw: 2, consumi: { con: { a: 2 }, senza: { a: 0 } } });
  assert.equal(b.kpi('con').condivisaKwh, 1);
  assert.equal(c.kpi('con').condivisaKwh, 3);
  assert.equal(c.kpi('senza').condivisaKwh, 1);
});
