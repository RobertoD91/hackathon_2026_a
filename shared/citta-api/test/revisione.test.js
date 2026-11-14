// Test aggiunti in revisione: percorsi malformati, date impossibili, luoghi noti fuori dai 10
// (Città della Scienza), eventi per un luogo non monitorato, PM come media su 24 ore, treni doppi
// di Transitous e operatore diverso da quello della stazione.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { avviaServizio, fontiNormali, orologio, snapshotSintetici, risposta, T, H, M } from './aiuti.js';
import { dataEsiste } from '../src/citta.js';

test('percorsi: codifica non valida = 400 (non 500), barre doppie e maiuscole accettate', async () => {
  const a = await avviaServizio();
  try {
    const r = await a.get('/citta/eventi/%E0%A4%A');
    assert.equal(r.status, 400);
    assert.match(r.json.errore, /non capito/);
    assert.equal((await a.get('//citta//meteo?luogo=vomero')).json.luogo.id, 'vomero');
    assert.equal((await a.get('/CITTA/Meteo/?luogo=vomero')).status, 200);
    assert.equal((await a.get('/citta/luogo?nome=%E0%A4%A')).status, 404, 'parametro malformato: 404 leggibile, non 500');
  } finally {
    await a.chiudi();
  }
});

test('eventi: le date che non esistono sono rifiutate', async () => {
  assert.equal(dataEsiste('2026-02-28'), true);
  assert.equal(dataEsiste('2028-02-29'), true);
  assert.equal(dataEsiste('2026-02-29'), false);
  assert.equal(dataEsiste('2026-02-30'), false);
  assert.equal(dataEsiste('2026-13-01'), false);
  const a = await avviaServizio();
  try {
    for (const g of ['2026-02-30', '31/02', '2026-13-01', '0/0']) assert.equal((await a.get(`/citta/eventi?giorno=${encodeURIComponent(g)}`)).status, 400, g);
    assert.equal((await a.get('/citta/eventi?giorno=28/02')).json.giorno, '2026-02-28');
  } finally {
    await a.chiudi();
  }
});

test('eventi: navi senza parentesi annidate nel testo', async () => {
  const a = await avviaServizio();
  try {
    const r = await a.get('/citta/eventi?giorno=luned%C3%AC&formato=testo');
    assert.match(r.testo, /navi in porto in giornata, orari di arrivo e partenza non pubblicati/);
    assert.doesNotMatch(r.testo, /\([^()]*\(/, 'nessuna parentesi dentro un\'altra');
  } finally {
    await a.chiudi();
  }
});

test('luoghi noti fuori dai 10: Città della Scienza e aeroporto', async () => {
  const a = await avviaServizio();
  try {
    const r = await a.get(`/citta/luogo?nome=${encodeURIComponent('citta della scienza')}`);
    assert.equal(r.status, 200);
    assert.equal(r.json.luogo.tipo, 'punto');
    assert.equal(r.json.luogo.id, 'citta_scienza');
    assert.equal(r.json.luogo.luogo_monitorato_vicino.zona, 'maradona');
    assert.equal(r.json.folla, null, 'nessuna folla per un punto senza sensori');
    assert.match(r.json.testo, /Città della Scienza: .*luogo monitorato più vicino: Stadio Diego Armando Maradona/);
    assert.equal((await a.get('/citta/meteo?luogo=coroglio')).json.luogo.id, 'citta_scienza');
    assert.equal((await a.get('/citta/luogo?nome=aeroporto%20di%20capodichino')).json.luogo.id, 'aeroporto');
    const l = await a.get('/citta/luoghi');
    assert.ok(l.json.altri_luoghi_noti.includes('Città della Scienza'));
    const no = await a.get('/citta/luogo?nome=xyzzy');
    assert.ok(no.json.altri_luoghi_noti.length >= 1);
  } finally {
    await a.chiudi();
  }
});

test('trasporti vicini: nessuna stazione entro 1200 m, ricerca allargata a 2500 m e dichiarata', async () => {
  const a = await avviaServizio();
  try {
    const r = await a.get('/citta/trasporti/vicino?lat=40.86&lon=14.25');
    assert.equal(r.json.raggio_m, 2500);
    assert.match(r.json.nota, /allargata a 2500 m/);
    assert.equal(r.json.stazioni[0].nome, 'Montesanto');
    assert.match(r.json.testo, /^Nessuna stazione entro 1200 m da punto 40\.8600, 14\.2500; le più vicine: Montesanto/);
    const fisso = await a.get('/citta/trasporti/vicino?lat=40.86&lon=14.25&raggio_m=1000');
    assert.equal(fisso.json.stazioni.length, 0, 'con un raggio chiesto non si allarga');
    const l = await a.get('/citta/luogo?lat=40.86&lon=14.25');
    assert.equal(l.json.trasporti.stazioni[0].nome, 'Montesanto');
  } finally {
    await a.chiudi();
  }
});

test('eventi per un luogo non monitorato: tutta la città, dichiarato (non gli eventi del luogo più vicino)', async () => {
  const a = await avviaServizio();
  try {
    const r = await a.get('/citta/eventi?luogo=bagnoli');
    assert.equal(r.status, 200);
    assert.match(r.json.nota_luogo, /non è uno dei luoghi monitorati: elenco gli eventi di tutta la città/);
    assert.ok(r.json.eventi.some((e) => e.titolo === 'Tri Gold Caracciolo'), 'non filtrati sul Maradona');
    assert.match(r.json.testo, /eventi di tutta la città/);
    const s = await a.get('/citta/eventi?luogo=stadio');
    assert.equal(s.json.nota_luogo, undefined);
    assert.deepEqual(s.json.eventi.map((e) => e.titolo), ['Napoli - Torino']);
  } finally {
    await a.chiudi();
  }
});

test('aria: per i PM il valore è la media delle 24 ore e il testo lo dice', async () => {
  const o = orologio();
  const dati = snapshotSintetici(o.t);
  dati.aria.stazioni[0].misure.PM10 = { unita: 'µg/m³', ultimo: { ts: o.t - 10 * H, valore: 70 }, serie: [[o.t - 11 * H, 60], [o.t - 10 * H, 70]] };
  const a = await avviaServizio({ orologio: o, dati });
  try {
    const g = await a.get('/citta/aria?luogo=garibaldi');
    assert.equal(g.json.aria.centralina.inquinante_peggiore, 'PM10');
    assert.equal(g.json.aria.centralina.valore_ugm3, 65);
    assert.equal(g.json.aria.centralina.valore_tipo, 'media delle ultime 24 ore');
    assert.match(g.json.testo, /PM10 65 µg\/m³ di media nelle 24 ore fino alle 05:00/);
    const tutta = await a.get('/citta/aria');
    assert.match(tutta.json.testo, /PM10 65 µg\/m³ di media nelle 24 ore/);
  } finally {
    await a.chiudi();
  }
});

test('passaggi: treni con lo stesso numero una volta sola, operatore diverso da quello della stazione scritto', async () => {
  const o = orologio();
  const dati = snapshotSintetici(o.t);
  const corse = dati.trasporti.stazioni[0].corse;
  dati.trasporti.stazioni.push({ id: 'eav-6701', nome: 'Napoli Centrale', tipo: 'ferrovia', linee: ['Ferrovia EAV'], operatore: 'EAV', lat: 40.8528, lon: 14.2722, corse, transitous: ['it-Campania-EAV_6701'] });
  const treno = (min, linea, verso) => ({ place: { departure: new Date(o.t + min * M).toISOString() }, routeShortName: linea, headsign: verso, mode: 'HIGHSPEED_RAIL', agencyName: 'Trenitalia' });
  const regole = [[/EAV_6701/, () => risposta({ stopTimes: [treno(10, 'FR 9426', 'VENEZIA S.LUCIA'), treno(25, 'FR 9583', 'REGGIO DI CALABRIA'), treno(30, 'FR 9583', 'REGGIO DI CALABRIA')].map((x) => ({ ...x, mode: 'RAIL' })) })], ...fontiNormali(o.t)];
  const a = await avviaServizio({ orologio: o, dati, regole });
  try {
    const r = await a.get('/citta/passaggi?stazione=napoli%20centrale');
    assert.equal(r.json.stazione.id, 'eav-6701');
    assert.deepEqual(r.json.passaggi.map((p) => `${p.ora} ${p.linea}`), ['15:10 FR 9426', '15:25 FR 9583']);
    assert.match(r.json.testo, /^Prossime partenze da Napoli Centrale: 15:10 FR 9426 Trenitalia per VENEZIA/);
    // stazione ANM con corse ANM: le linee restano nel titolo, nessun operatore accanto alle corse
    const t = await a.get('/citta/passaggi?stazione=toledo');
    assert.match(t.json.testo, /^Prossime partenze da Toledo \(L1\): 15:05 L1 per PISCINOLA/);
    // motivo in parole, senza parentesi annidate né "CORS"
    const pg = await a.get('/citta/passaggi?stazione=piazza%20garibaldi&formato=testo');
    assert.match(pg.testo, /^Prossimi passaggi da Piazza Garibaldi \(L2\) non disponibili: la stazione non è su Transitous\. Orario programmato: 8 corse/);
  } finally {
    await a.chiudi();
  }
});

test('429 di Open-Meteo: i testi citano la riserva MET Norway e dicono che l\'aria è un dato salvato', async () => {
  const o = orologio();
  const a = await avviaServizio({ orologio: o, regole: fontiNormali(o.t, { meteo429: true }) });
  try {
    const l = await a.get('/citta/luogo?nome=plebiscito&formato=testo');
    assert.match(l.testo, /\(MET Norway Locationforecast, fonte di riserva, dato delle 14:30\)/);
    assert.doesNotMatch(l.testo, /Open-Meteo, fonte di riserva/, 'non si attribuisce a Open-Meteo un dato di MET Norway');
    assert.match(l.testo, /Aria \w+ \(modello CAMS, ultimo dato salvato delle 08:00, la fonte dal vivo non risponde\)/);
    const r = await a.get('/citta/riassunto?formato=testo');
    assert.match(r.testo, /\(MET Norway Locationforecast, fonte di riserva/);
    assert.match(r.testo, /Aria: \w+ secondo il modello Copernicus CAMS \(indice europeo 45, ultimo dato salvato delle 08:00/);
    const ar = await a.get('/citta/aria?luogo=vomero&formato=testo');
    assert.match(ar.testo, /modello Copernicus CAMS, ultimo dato salvato delle 08:00/);
    const tutta = await a.get('/citta/aria?formato=testo');
    assert.match(tutta.testo, /^Aria a Napoli: \w+ secondo il modello Copernicus CAMS \(indice europeo 45, ultimo dato salvato/);
  } finally {
    await a.chiudi();
  }
  // con le fonti dal vivo: "dato delle …" e il nome Open-Meteo
  const b = await avviaServizio();
  try {
    const l = await b.get('/citta/luogo?nome=plebiscito&formato=testo');
    assert.match(l.testo, /\(Open-Meteo, dato delle 14:45\)/);
    assert.match(l.testo, /Aria \w+ \(modello CAMS, dato delle 14:00\)/);
    const g = await b.get('/citta/luogo?nome=garibaldi&formato=testo');
    assert.match(g.testo, /Aria moderata \(centralina ARPAC NA07 ENTE FERROVIE, misura delle 05:00\)/);
  } finally {
    await b.chiudi();
  }
});

test('nessuno stack trace verso il client su un errore interno', async () => {
  const a = await avviaServizio();
  try {
    const orig = a.s.sorgenti.leggi;
    a.s.sorgenti.leggi = () => {
      throw new Error('guasto finto /segreto/percorso.js:12');
    };
    const r = await a.get('/citta/meteo');
    assert.equal(r.status, 500);
    assert.deepEqual(r.json, { errore: 'errore interno del servizio' });
    a.s.sorgenti.leggi = orig;
  } finally {
    await a.chiudi();
  }
  assert.ok(T > 0);
});
