import test from 'node:test';
import assert from 'node:assert/strict';
import { creaRete, percorsoLocale, stazioniVicine, metri, corseOra } from '../src/rete.js';
import { decodificaPolilinea, daTransitous, trovaPercorso, impostaFetch } from '../src/percorsi.js';
import { LUOGHI3D as L } from '../src/luoghi3d.js';
import { ADESSO, leggi, ora } from './aiuto.js';

const rete = creaRete(leggi('trasporti'));

test('il grafo ha stazioni, linee, archi tra stazioni vicine sul tracciato e cambi a piedi', () => {
  assert.ok(rete.stazioni.size >= 90);
  assert.ok(rete.linee.has('L1') && rete.linee.has('L6') && rete.linee.has('Alibus'));
  assert.ok(rete.archi.length >= 70);
  for (const e of rete.archi) {
    assert.ok(e.metri > 30 && e.metri < 9000, `${e.linea} ${e.da}-${e.a}: ${e.metri} m`);
    assert.ok(e.geometria.length >= 2 && e.minuti > 0);
  }
  assert.ok(rete.cambi.every((c) => c.metri <= 450));
});

test('percorso dal Porto a Fuorigrotta: mezzi su ferro, tempi sensati, geometria da disegnare', () => {
  const p = percorsoLocale(rete, L.beverello, L.maradona, { ts: ADESSO });
  assert.ok(p && !p.soloPiedi);
  assert.ok(p.minuti >= 15 && p.minuti <= 60, `${p.minuti} min`);
  assert.equal(p.tratte[0].modo, 'piedi');
  assert.equal(p.tratte[p.tratte.length - 1].modo, 'piedi');
  const mezzi = p.tratte.filter((t) => t.modo !== 'piedi');
  assert.ok(mezzi.length >= 1 && mezzi.every((t) => t.geometria.length >= 2 && t.fermate >= 1 && t.colore));
  assert.equal(p.arrivo - p.partenza, p.minuti * 60_000);
});

test('linea chiusa: il percorso cambia e non usa più quella linea', () => {
  const p = percorsoLocale(rete, L.beverello, L.maradona, { ts: ADESSO });
  const linea = p.linee[0];
  const senza = percorsoLocale(rete, L.beverello, L.maradona, { ts: ADESSO, lineeChiuse: [linea] });
  assert.ok(senza && !senza.linee.includes(linea));
  assert.ok(senza.minuti >= p.minuti);
});

test('di notte non ci sono corse: si va a piedi (o non si trova un mezzo)', () => {
  const p = percorsoLocale(rete, L.plebiscito, L.castel_ovo, { ts: ora(15, 3) });
  assert.ok(p.soloPiedi);
  assert.ok(p.minuti >= 10 && p.minuti <= 30);
});

test('dall’aeroporto si arriva in centro con l’Alibus (collegamento indicativo dichiarato)', () => {
  const p = percorsoLocale(rete, L.capodichino, L.plebiscito, { ts: ADESSO });
  assert.ok(p.linee.includes('Alibus'));
  assert.ok(p.tratte.find((t) => t.linea === 'Alibus').indicativa);
});

test('stazioni vicine e corse programmate nell’ora', () => {
  const v = stazioniVicine(rete, L.garibaldi, { n: 3, ts: ora(16, 8) });
  assert.equal(v.length, 3);
  assert.ok(v[0].m <= v[1].m && v[0].piedi >= 1);
  assert.ok(corseOra(v[0], ora(16, 8)) > 0);
  assert.ok(metri(L.plebiscito, L.castel_ovo) > 500);
});

test('polilinea codificata: precisione 5 e 7', () => {
  // esempio della documentazione di Google: (38.5,-120.2) (40.7,-120.95) (43.252,-126.453)
  assert.deepEqual(decodificaPolilinea('_p~iF~ps|U_ulLnnqC_mqNvxq`@', 5), [[-120.2, 38.5], [-120.95, 40.7], [-126.453, 43.252]]);
  const p7 = decodificaPolilinea('wwv|iWydtznGjc@rL', 7);
  assert.ok(Math.abs(p7[0][1] - 40.838) < 0.01 && Math.abs(p7[0][0] - 14.253) < 0.01, JSON.stringify(p7[0]));
});

const tratta = (mode, da, a, durata, extra = {}) => ({ mode, from: { name: da[0], lat: da[1], lon: da[2] }, to: { name: a[0], lat: a[1], lon: a[2] }, duration: durata, startTime: '2026-11-14T14:30:00Z', endTime: '2026-11-14T14:40:00Z', ...extra });

test('Transitous: itinerario normalizzato; scartato se una corsa "si teletrasporta"', () => {
  const buono = { startTime: '2026-11-14T14:30:00Z', endTime: '2026-11-14T15:03:00Z', legs: [
    tratta('WALK', ['START', 40.8383, 14.2537], ['MUNICIPIO', 40.8397, 14.2527], 360, { distance: 416 }),
    tratta('SUBWAY', ['MUNICIPIO', 40.8397, 14.2527], ['AUGUSTO', 40.8262, 14.1962], 1020, { routeShortName: 'L6', headsign: 'MOSTRA', intermediateStops: [1, 2, 3, 4, 5], realTime: false }),
    tratta('WALK', ['AUGUSTO', 40.8262, 14.1962], ['END', 40.828, 14.193], 600, { distance: 564 }),
  ] };
  const p = daTransitous(buono, { da: { nome: 'Porto' }, a: { nome: 'Fuorigrotta' }, linee: rete.linee });
  assert.equal(p.minuti, 33);
  assert.deepEqual(p.linee, ['L6']);
  assert.equal(p.tratte[0].da.nome, 'Porto');
  assert.equal(p.tratte[1].colore, rete.linee.get('L6').colore);
  assert.equal(p.tratte[1].fermate, 6);
  const rotto = { ...buono, legs: [buono.legs[0], tratta('BUS', ['VITTORIA', 40.832, 14.236], ['TECCHIO', 40.825, 14.192], 0, { routeShortName: 'R7' }), buono.legs[2]] };
  assert.equal(daTransitous(rotto, {}), null);
});

test('se Transitous non risponde si usa il grafo locale, e lo si dichiara', async () => {
  impostaFetch(async () => { throw new Error('rete assente'); });
  const r = await trovaPercorso(rete, L.beverello, L.maradona, { ts: ADESSO });
  assert.equal(r.fonte, 'locale');
  assert.match(r.nota, /riserva/);
  assert.ok(r.migliore.minuti > 0);
  impostaFetch((...x) => globalThis.fetch(...x));
});
