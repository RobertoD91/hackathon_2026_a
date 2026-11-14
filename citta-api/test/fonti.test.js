// Test delle fonti dati reali di Napoli: normalizzazione (fonti/normalizza.js), caricatore con
// riserve (fonti/dati.js, fetch finto), lettori ZIP/CSV/Snappy/Parquet e script degli snapshot
// (strumenti/, fetch finto), snapshot in dati/ e configurazione del simulatore (simulatore/).
// L'agente "fonti" e l'orchestratore della mappa sono provati in c5-presentazione/mappa/test/.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as N from '../fonti/normalizza.js';
import * as D from '../fonti/dati.js';
import { LUOGHI } from '../fonti/luoghi.js';
import { leggiZip, leggiCsv } from '../strumenti/zip-mini.js';
import { leggiParquet, snappyDecompress } from '../strumenti/parquet-mini.js';
import {
  aggiornaDati,
  riduciGtfs,
  abbinaTransitous,
  crociereDaRss,
  partiteDaOpenfootball,
  regateDaAmericasCup,
  visitatoriDaCsv,
  stagionalitaDaIstat,
  serieDaParquet,
  semplifica,
  nomeStazione,
  giorniTipo,
} from '../strumenti/aggiorna-dati-napoli.js';

const H = 3_600_000;
const T = N.daOraLocale(2026, 11, 14, 15, 0); // sabato 14/11/2026, 15:00 a Napoli
const ZONE = Object.keys(LUOGHI);

// ------------------------------------------------------------------ aiuti

/** Risposta finta per fetch. */
const risposta = (corpo, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => (typeof corpo === 'string' ? JSON.parse(corpo) : corpo),
  text: async () => (typeof corpo === 'string' ? corpo : Buffer.isBuffer(corpo) ? corpo.toString('utf8') : JSON.stringify(corpo)),
  arrayBuffer: async () => {
    const b = Buffer.isBuffer(corpo) ? corpo : Buffer.from(typeof corpo === 'string' ? corpo : JSON.stringify(corpo));
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.length);
  },
});

/** fetch finto: la prima regola (regex sull'URL) che corrisponde decide la risposta. */
function fetchFinto(regole, chiamate = []) {
  return async (url, opts = {}) => {
    chiamate.push(String(url));
    for (const [re, fn] of regole) if (re.test(String(url))) return fn(String(url), opts);
    return risposta({ errore: 'non previsto' }, 404);
  };
}

/** ZIP con metodo deflate (per provare leggiZip e il GTFS). */
function creaZip(file) {
  const locali = [];
  const centrali = [];
  let offset = 0;
  for (const [nome, testo] of Object.entries(file)) {
    const dati = Buffer.from(testo);
    const comp = deflateRawSync(dati);
    const n = Buffer.from(nome);
    const loc = Buffer.alloc(30);
    loc.writeUInt32LE(0x04034b50, 0);
    loc.writeUInt16LE(8, 8);
    loc.writeUInt32LE(comp.length, 18);
    loc.writeUInt32LE(dati.length, 22);
    loc.writeUInt16LE(n.length, 26);
    locali.push(loc, n, comp);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(8, 10);
    cen.writeUInt32LE(comp.length, 20);
    cen.writeUInt32LE(dati.length, 24);
    cen.writeUInt16LE(n.length, 28);
    cen.writeUInt32LE(offset, 42);
    centrali.push(cen, n);
    offset += 30 + n.length + comp.length;
  }
  const cd = Buffer.concat(centrali);
  const fine = Buffer.alloc(22);
  fine.writeUInt32LE(0x06054b50, 0);
  fine.writeUInt16LE(Object.keys(file).length, 8);
  fine.writeUInt16LE(Object.keys(file).length, 10);
  fine.writeUInt32LE(cd.length, 12);
  fine.writeUInt32LE(offset, 16);
  return Buffer.concat([...locali, cd, fine]);
}

// --- Parquet minimo per i test: Thrift compact a mano, pagine PLAIN, compressione nessuna o Snappy
function varint(n) {
  let v = BigInt(n);
  const out = [];
  do {
    let b = Number(v & 0x7fn);
    v >>= 7n;
    if (v) b |= 0x80;
    out.push(b);
  } while (v);
  return out;
}
const zz = (n) => varint((BigInt(n) << 1n) ^ (BigInt(n) < 0n ? -1n : 0n));
/** campi: [[id, tipo, valore]] con tipo 'i32' | 'i64' | 'bin' | 'struct' | 'list:struct' | 'list:i32' | 'list:bin'. */
function struttura(campi) {
  const out = [];
  let ultimo = 0;
  const T = { i32: 5, i64: 6, bin: 8, struct: 12 };
  for (const [id, tipo, v] of campi.sort((a, b) => a[0] - b[0])) {
    const t = tipo.startsWith('list') ? 9 : T[tipo];
    out.push(((id - ultimo) << 4) | t);
    ultimo = id;
    if (tipo === 'i32' || tipo === 'i64') out.push(...zz(v));
    else if (tipo === 'bin') out.push(...varint(Buffer.from(v).length), ...Buffer.from(v));
    else if (tipo === 'struct') out.push(...struttura(v));
    else {
      const el = tipo.split(':')[1];
      out.push((v.length << 4) | { struct: 12, i32: 5, bin: 8 }[el]);
      for (const x of v) out.push(...(el === 'struct' ? struttura(x) : el === 'i32' ? zz(x) : [...varint(Buffer.from(x).length), ...Buffer.from(x)]));
    }
  }
  out.push(0);
  return out;
}
const snappyLiterali = (buf) => {
  const out = [...varint(buf.length)];
  for (let i = 0; i < buf.length; i += 60) {
    const pezzo = buf.subarray(i, i + 60);
    out.push((pezzo.length - 1) << 2, ...pezzo);
  }
  return Buffer.from(out);
};

/** Parquet con End (INT96), Value (DECIMAL 16 byte, scala 2, OPTIONAL) e Validity (INT32), come i file EEA. */
function creaParquet(righe, codec = 0) {
  const n = righe.length;
  const int96 = (ms) => {
    const b = Buffer.alloc(12);
    const giorno = Math.floor(ms / 86_400_000);
    b.writeBigUInt64LE(BigInt(ms - giorno * 86_400_000) * 1_000_000n, 0);
    b.writeUInt32LE(giorno + 2440588, 8);
    return b;
  };
  const dec = (v) => {
    const b = Buffer.alloc(16);
    let x = BigInt(Math.round(v * 100));
    if (x < 0n) x += 1n << 128n;
    for (let i = 15; i >= 0; i--) {
      b[i] = Number(x & 0xffn);
      x >>= 8n;
    }
    return b;
  };
  const presenti = righe.filter((r) => r.valore != null);
  const defBits = righe.reduce((acc, r, i) => acc | ((r.valore != null ? 1 : 0) << i), 0);
  const colonne = [
    { nome: 'End', tipo: 3, dati: Buffer.concat(righe.map((r) => int96(r.fine))) },
    { nome: 'Value', tipo: 7, dati: Buffer.concat([Buffer.from([4, 0, 0, 0, 0x03, defBits & 0xff, (defBits >> 8) & 0xff, 0]), ...presenti.map((r) => dec(r.valore))]) },
    { nome: 'Validity', tipo: 1, dati: Buffer.concat(righe.map((r) => { const b = Buffer.alloc(4); b.writeInt32LE(r.validita ?? 1); return b; })) },
  ];
  const parti = [Buffer.from('PAR1')];
  let pos = 4;
  const chunk = [];
  for (const c of colonne) {
    const corpo = codec === 1 ? snappyLiterali(c.dati) : c.dati;
    const testa = Buffer.from(struttura([[1, 'i32', 0], [2, 'i32', c.dati.length], [3, 'i32', corpo.length], [5, 'struct', [[1, 'i32', n], [2, 'i32', 0], [3, 'i32', 3], [4, 'i32', 3]]]]));
    chunk.push({ c, offset: pos, totale: testa.length + corpo.length });
    parti.push(testa, corpo);
    pos += testa.length + corpo.length;
  }
  const meta = Buffer.from(
    struttura([
      [1, 'i32', 1],
      [2, 'list:struct', [
        [[4, 'bin', 'schema'], [5, 'i32', 3]],
        [[1, 'i32', 3], [3, 'i32', 0], [4, 'bin', 'End']],
        [[1, 'i32', 7], [2, 'i32', 16], [3, 'i32', 1], [4, 'bin', 'Value'], [6, 'i32', 5], [7, 'i32', 2], [8, 'i32', 38]],
        [[1, 'i32', 1], [3, 'i32', 0], [4, 'bin', 'Validity']],
      ]],
      [3, 'i64', n],
      [4, 'list:struct', [[
        [1, 'list:struct', chunk.map(({ c, offset, totale }) => [[2, 'i64', offset], [3, 'struct', [[1, 'i32', c.tipo], [2, 'list:i32', [0]], [3, 'list:bin', [c.nome]], [4, 'i32', codec], [5, 'i64', n], [6, 'i64', totale], [7, 'i64', totale], [9, 'i64', offset]]]])],
        [2, 'i64', pos],
        [3, 'i64', n],
      ]]],
    ]),
  );
  const lung = Buffer.alloc(4);
  lung.writeUInt32LE(meta.length);
  return Buffer.concat([...parti, meta, lung, Buffer.from('PAR1')]);
}

// ------------------------------------------------------------------ normalizzazione

test('fonti: tempo nel fuso di Napoli (ora solare e legale) e formati del Centro Funzionale', () => {
  assert.equal(new Date(N.daOraLocale(2026, 11, 14, 15, 0)).toISOString(), '2026-11-14T14:00:00.000Z');
  assert.equal(new Date(N.daOraLocale(2026, 7, 15, 15, 0)).toISOString(), '2026-07-15T13:00:00.000Z');
  assert.equal(N.giornoLocale(Date.UTC(2026, 10, 14, 23, 30)), '2026-11-15', 'dopo mezzanotte a Napoli è già domani');
  assert.equal(N.daDataCf('15:00 - 13/11/2026'), N.daOraLocale(2026, 11, 13, 15, 0));
  assert.equal(N.daIsoLocale('2026-11-14T02:15'), N.daOraLocale(2026, 11, 14, 2, 15));
  assert.equal(N.oraBreve(T), '15:00');
  assert.equal(N.dataBreve(T, T), '14 nov');
  assert.equal(N.dataBreve(N.daOraLocale(2027, 5, 22), T), '22 mag 2027');
});

test('fonti: meteo da Open-Meteo (più luoghi), MET Norway e livelli della modalità Meteo', () => {
  const cur = (t, codice, raff = 10) => ({ latitude: 40.84, longitude: 14.25, current: { time: '2026-11-14T15:00', temperature_2m: t, apparent_temperature: t + 1, relative_humidity_2m: 80, precipitation: 0, weather_code: codice, wind_speed_10m: 8, wind_gusts_10m: raff, is_day: 1 } });
  const m = N.meteoDaOpenMeteo([cur(17.5, 1), cur(16, 95, 72), {}], ['plebiscito', 'vomero', 'sanita']);
  assert.deepEqual(Object.keys(m), ['plebiscito', 'vomero'], 'un luogo senza dati resta fuori');
  assert.equal(m.plebiscito.cielo, 'Quasi sereno');
  assert.equal(m.plebiscito.ts, N.daOraLocale(2026, 11, 14, 15, 0));
  assert.equal(N.livelloMeteo(m.plebiscito).livello, 'tranquillo');
  assert.equal(N.livelloMeteo(m.vomero).livello, 'affollato', 'temporale e raffiche forti');
  assert.equal(N.livelloMeteo(m.plebiscito, { livello: 2 }).livello, 'vivace', "con l'allerta gialla non è bel tempo");
  assert.equal(N.livelloMeteo({ codice: 3 }).livello, 'normale');
  assert.equal(N.livelloMeteo(null), null);
  const met = N.meteoDaMetNo({
    geometry: { coordinates: [14.25, 40.84, 30] },
    properties: { timeseries: [{ time: '2026-11-14T14:00:00Z', data: { instant: { details: { air_temperature: 16.6, relative_humidity: 86, wind_speed: 2 } }, next_1_hours: { summary: { symbol_code: 'lightrain_day' }, details: { precipitation_amount: 0.4 } } } }] },
  });
  assert.equal(met.temperatura, 16.6);
  assert.equal(met.vento, 7.2, 'm/s → km/h');
  assert.equal(met.cielo, 'Pioggia debole');
  assert.equal(met.pioggia, 0.4);
  assert.equal(N.meteoDaMetNo({}), null);
});

test("fonti: qualità dell'aria, fasce EEA, centralina (media 24 h per i PM) e modello CAMS", () => {
  assert.equal(N.classeInquinante('NO2', 26.7), 0);
  assert.equal(N.classeInquinante('NO2', 95), 2);
  assert.equal(N.classeInquinante('PM10', 45), 2);
  assert.equal(N.classeInquinante('PM2.5', 80), 5);
  assert.equal(N.classeInquinante('XYZ', 1), null);
  assert.equal(N.classeAqi(19), 0);
  assert.equal(N.classeAqi(21), 1);
  assert.equal(N.classeAqi(130), 5);
  assert.equal(N.livelloAria(5).label, 'Scadente', 'scadente comprende anche le classi peggiori');
  assert.equal(N.livelloAria(1).id, 'normale');
  // PM10: ultimo valore 60 (moderata) ma media di 24 ore 30 (discreta); NO2 ultimo 15 (buona)
  const serie = (v, ult) => Array.from({ length: 24 }, (_, i) => [T - (23 - i) * H, i === 23 ? ult : v]);
  const c = N.classeCentralina({ PM10: { serie: serie(29, 53) }, NO2: { serie: serie(10, 15) } });
  assert.equal(c.classe, 1);
  assert.equal(c.inquinante, 'PM10');
  assert.equal(c.valore, 30);
  assert.equal(c.ts, T);
  assert.equal(N.classeCentralina({}), null);
  const a = N.ariaDaOpenMeteo([{ current: { time: '2026-11-14T15:00', european_aqi: 19, pm10: 12.6, pm2_5: 4.5, nitrogen_dioxide: 11.2, ozone: 53 } }], ['plebiscito']);
  assert.equal(a.plebiscito.aqi, 19);
  assert.equal(a.plebiscito.pm25, 4.5);
});

test('fonti: allerta del Centro Funzionale (Zona 1) e Meteoalarm (non scaduti, il livello più alto)', () => {
  const ultima = { bollettinoMeteoBindList: [{ zona: null, tipoDesc: ' piogge mare', livello: 2, livelloDesc: 'Livello di allerta giallo' }], idBollettino: 723, dataEmissione: '11:10 - 13/11/2026', dataDa: '15:00 - 13/11/2026', dataA: '12:00 - 14/11/2026', numeroAvviso: 93 };
  const zona = { bollettinoMeteoBindList: [{ zona: 1, tipoDesc: 'mare', livello: 2, livelloDesc: 'Livello di allerta giallo', tipoRischi: 'Idrogeologico Localizzato', fenomeni: 'Mare agitato' }] };
  const a = N.allertaDaCentroFunzionale(ultima, zona, { bollettinoMeteoBindList: [] }, N.daOraLocale(2026, 11, 14, 2, 0));
  assert.equal(a.livello, 2);
  assert.equal(a.colore, 'gialla');
  assert.deepEqual(a.tipi, ['mare'], 'la Zona 1 ha la precedenza sul riepilogo regionale');
  assert.equal(a.zona, 1);
  assert.equal(a.inCorso, true);
  assert.equal(a.al, N.daOraLocale(2026, 11, 14, 12, 0));
  assert.equal(N.allertaDaCentroFunzionale(ultima, null, null, T).scaduta, true);
  assert.equal(N.allertaDaCentroFunzionale(null), null);
  const info = (event, livello, onset, expires, area = 'Campania', language = 'it-IT') => ({
    language,
    event,
    onset,
    expires,
    headline: event,
    area: [{ areaDesc: area }],
    parameter: [{ valueName: 'awareness_level', value: `${livello}; x; y` }],
  });
  const feed = {
    warnings: [
      { alert: { info: [info('Giallo Temporali Allerta', 2, '2026-11-15T07:00:00+01:00', '2026-11-15T18:59:00+01:00')] } },
      { alert: { info: [info('Arancione Temporali Allerta', 3, '2026-11-15T07:00:00+01:00', '2026-11-15T18:59:00+01:00')] } },
      { alert: { info: [info('Verde Vento Allerta', 1, '2026-11-15T07:00:00+01:00', '2026-11-15T23:59:00+01:00')] } },
      { alert: { info: [info('Arancione Vento Allerta', 3, '2026-11-13T09:00:00+01:00', '2026-11-13T18:59:00+01:00')] } },
      { alert: { info: [info('Rosso Pioggia Allerta', 4, '2026-11-15T07:00:00+01:00', '2026-11-15T18:59:00+01:00', 'Lazio')] } },
      { alert: { info: [info('Orange Thunderstorm', 3, '2026-11-15T07:00:00+01:00', '2026-11-15T18:59:00+01:00', 'Campania', 'en-GB')] } },
    ],
  };
  const ma = N.meteoalarmCampania(feed, T);
  assert.equal(ma.length, 1, 'scaduti, verdi, altre regioni e altre lingue esclusi');
  assert.equal(ma[0].fenomeno, 'Temporali');
  assert.equal(ma[0].livello, 3);
  assert.equal(ma[0].colore, 'arancione');
});

test('fonti: eventi del Comune (orari "locali come UTC", zona, grandi eventi) e del giorno', () => {
  const tri = N.eventoComune(
    { titolo: 'Tri Gold Caracciolo 2026', data_orario_inizio: '1794646800', data_orario_fine: '1794747600', luogo_evento: '{"address": "Rotonda Diaz | Lungomare Caracciolo - Napoli"}', tipo_evento: '{"title": "Evento sportivo"}' },
    LUOGHI,
  );
  assert.equal(tri.inizio, N.daOraLocale(2026, 11, 14, 9, 0), '1794646800 = 09:00Z letto come 09:00 a Napoli');
  assert.equal(tri.zona, 'lungomare');
  assert.equal(tri.grande, true);
  const mostra = N.eventoComune({ titolo: 'Mostra - Viaggio Dharmico', data_orario_inizio: '1796403600', luogo_evento: { title: 'Castel Nuovo - Maschio Angioino', address: 'Via Vittorio Emanuele III' }, tipo_evento: { title: 'Manifestazione artistica' } }, LUOGHI);
  assert.equal(mostra.zona, 'beverello');
  assert.equal(mostra.grande, false, 'una mostra non sposta folla');
  assert.equal(N.zonaPerTesto('Parco San Laise, Bagnoli', LUOGHI), null);
  assert.equal(N.zonaPerTesto('Piazza Municipio - Napoli', LUOGHI), 'beverello');

  const dati = {
    partite: [{ giorno: '2026-11-14', ora: '20:45', casa: 'Napoli', ospite: 'Torino', competizione: 'Serie A', fonte: 'openfootball' }, { giorno: '2026-11-21', ora: null, casa: 'Napoli', ospite: 'Lecce' }],
    crociere: [{ giorno: '2026-11-14', navi: ['MSC Euribia', 'Viking Mira'] }, { giorno: '2026-11-16', navi: ['Costa Toscana'] }],
    comune: [tri, mostra, { ...N.eventoComune({ titolo: 'Libro', data_orario_inizio: '1794938400', luogo_evento: { address: 'Molosiglio' }, tipo_evento: { title: 'Evento sportivo' } }, LUOGHI), grande: false }],
    speciali: [
      { giorno: '2027-05-22', titolo: 'Louis Vuitton Cup · regate di flotta', evento: 'Louis Vuitton Cup', zona: 'lungomare' },
      { giorno: '2027-05-24', titolo: 'Louis Vuitton Cup · giorno di riserva', evento: 'Louis Vuitton Cup', zona: 'lungomare', riserva: true },
    ],
  };
  const oggi = N.eventiDelGiorno(dati, '2026-11-14');
  assert.deepEqual(oggi.map((e) => e.scenario).sort(), ['evento_beverello', 'evento_lungomare', 'evento_maradona']);
  const partita = oggi.find((e) => e.zona === 'maradona');
  assert.deepEqual(partita.finestra, [N.daOraLocale(2026, 11, 14, 17, 45), N.daOraLocale(2026, 11, 14, 23, 45)], '3 ore prima e 3 dopo il calcio d\'inizio');
  assert.equal(oggi.find((e) => e.zona === 'beverello').nota, 'MSC Euribia, Viking Mira');
  assert.equal(N.eventiDelGiorno(dati, '2027-05-24')[0].scenario, null, 'giorno di riserva: niente folla');
  const prossimi = N.prossimiEventi(dati, '2026-11-14');
  assert.ok(prossimi.some((p) => p.titolo === 'Napoli - Lecce'));
  assert.ok(!prossimi.some((p) => p.titolo === 'Libro'), 'gli eventi piccoli non vanno tra i prossimi');
  assert.ok(prossimi.some((p) => p.giorno === '2027-05-22'), "l'America's Cup compare anche se lontana");
  // tanti giorni di navi non spingono fuori la prossima partita al Maradona
  const navi = Array.from({ length: 8 }, (_, i) => ({ giorno: `2026-11-${String(15 + i).padStart(2, '0')}`, navi: ['Nave'] }));
  const conNavi = N.prossimiEventi({ ...dati, crociere: navi }, '2026-11-14', { max: 5 });
  assert.ok(conNavi.some((p) => p.zona === 'maradona'), JSON.stringify(conNavi.map((p) => p.titolo)));
  assert.deepEqual(conNavi.map((p) => p.giorno), [...conNavi.map((p) => p.giorno)].sort(), 'restano in ordine di data');
});

test('fonti: stagionalità ISTAT, stazioni vicine, corse per ora, passaggi, avvisi EAV e traffico ASPI', () => {
  const st = N.stagione({ stagionalita: { anno: 2025, mediaArrivi: 364_316, mesi: { 11: { arrivi: 189_942, stranieri: 81_171 }, 8: { arrivi: 526_896 } } } }, 11);
  assert.equal(st.indice, 0.52);
  assert.equal(st.scenario, 'stagione_bassa');
  assert.equal(st.stranieriPct, 43);
  assert.equal(N.stagione({ stagionalita: { anno: 2025, mediaArrivi: 364_316, mesi: { 8: { arrivi: 526_896 } } } }, 8).scenario, 'stagione_alta');
  assert.equal(N.stagione(null, 11), null);

  const stazioni = [
    { id: 'a', nome: 'Chiaia', lat: 40.8353, lon: 14.248, corse: { feriale: Array(24).fill(5), sabato: Array(24).fill(4), festivo: Array(24).fill(2) } },
    { id: 'b', nome: 'Lontana', lat: 40.9, lon: 14.3 },
  ];
  const v = N.stazioniVicine(LUOGHI.plebiscito, stazioni);
  assert.deepEqual(v.map((s) => s.id), ['a']);
  assert.ok(v[0].m < 150 && v[0].piedi >= 1);
  assert.deepEqual(N.corseInOra(stazioni[0], T), { corse: 4, tipo: 'sabato' });
  assert.equal(N.corseInOra(stazioni[0], N.daOraLocale(2026, 12, 8, 10)).tipo, 'festivo', "l'8 dicembre è festivo");

  const p = N.passaggiDaTransitous(
    {
      stopTimes: [
        { place: { departure: '2026-11-14T14:12:00Z', scheduledDeparture: '2026-11-14T14:10:00Z' }, realTime: true, routeShortName: 'L1', headsign: 'Piscinola', mode: 'SUBWAY' },
        { place: { departure: '2026-11-14T14:05:00Z', scheduledDeparture: '2026-11-14T14:05:00Z' }, realTime: false, routeShortName: 'L1', headsign: 'Garibaldi' },
        { place: { departure: '2026-11-14T13:00:00Z' }, routeShortName: 'L1', headsign: 'vecchio' },
      ],
    },
    T,
  );
  assert.deepEqual(p.map((x) => x.verso), ['Garibaldi', 'Piscinola'], 'ordinati e senza quelli passati');
  assert.equal(p[1].ritardoMin, 2);
  assert.equal(p[0].ritardoMin, null);

  const av = N.avvisiEav([{ date_gmt: '2026-11-13T14:48:36', title: { rendered: 'Linee Flegree &#8211; ascensore di Mostra fuori servizio' }, link: 'https://x', categories: [65] }], ['Mostra', 'Montesanto']);
  assert.equal(av[0].titolo, 'Linee Flegree – ascensore di Mostra fuori servizio');
  assert.deepEqual(av[0].stazioni, ['Mostra']);
  assert.equal(av[0].tipo, 'impianti');

  const tr = N.trafficoAspi({
    events: [
      { c_str: 'A56', t_des_str: 'A56 TANGENZIALE DI NAPOLI', t_des_fra_it: 'Tratto Chiuso', t_des_fra_cau_it: 'Lavori', locpri: 'Capodimonte', locsec: 'Capodichino', n_crd_lat: 40.86675, n_crd_lon: 14.24433, fino_al: '202611140500P01:303', d_agg: 1 },
      { c_str: 'A1', t_des_str: 'Milano-Napoli', t_des_fra_it: 'Coda', n_crd_lat: 45.4, n_crd_lon: 9.2 },
    ],
  });
  assert.equal(tr.length, 1, 'solo gli eventi attorno a Napoli');
  assert.equal(tr[0].strada, 'A56 TANGENZIALE DI NAPOLI');
  assert.equal(tr[0].fino, N.daOraLocale(2026, 11, 14, 5, 0));
});

// ------------------------------------------------------------------ caricatore con riserve (fetch finto)

test('fonti/dati: meteo dal vivo, poi MET Norway se Open-Meteo dà 429, poi snapshot dichiarato', async () => {
  const cur = { current: { time: '2026-11-14T15:00', temperature_2m: 17, weather_code: 1, wind_speed_10m: 5 } };
  D.impostaRete({ ora: () => T });
  D.svuotaCache();
  const chiamate = [];
  D.impostaRete({ fetch: fetchFinto([[/api\.open-meteo\.com/, () => risposta(ZONE.map(() => cur))]], chiamate) });
  let r = await D.meteo();
  assert.equal(r.fonte.tipo, 'live');
  assert.equal(r.fonte.id, 'openMeteo');
  assert.match(chiamate[0], /models=italia_meteo_arpae_icon_2i/);
  assert.equal(Object.keys(r.dati).length, ZONE.length);
  r = await D.meteo();
  assert.equal(r.fonte.tipo, 'cache', 'la seconda volta niente rete');
  assert.equal(chiamate.length, 1);

  D.svuotaCache();
  const metno = { properties: { timeseries: [{ time: '2026-11-14T14:00:00Z', data: { instant: { details: { air_temperature: 15 } } } }] } };
  chiamate.length = 0;
  D.impostaRete({ fetch: fetchFinto([[/open-meteo/, () => risposta({}, 429)], [/api\.met\.no/, () => risposta(metno)]], chiamate) });
  r = await D.meteo();
  assert.equal(r.fonte.tipo, 'riserva');
  assert.equal(r.fonte.id, 'metNo');
  assert.match(r.fonte.nota, /429/);
  assert.equal(chiamate.filter((u) => u.includes('open-meteo')).length, 1, 'dopo un 429 non si riprova Open-Meteo');
  assert.equal(r.dati.vomero.temperatura, 15);

  D.svuotaCache();
  D.impostaSnapshot('meteo', { meta: { generato: '2026-11-14T01:00:00Z' }, meteo: { plebiscito: { temperatura: 16, ts: T - 5 * H } }, aria: {}, meteoalarm: [] });
  D.impostaRete({ fetch: async () => { throw new TypeError('Failed to fetch'); } });
  r = await D.meteo();
  assert.equal(r.fonte.tipo, 'salvato');
  assert.match(r.fonte.nota, /non raggiungibile/);
  assert.equal(r.dati.plebiscito.temperatura, 16);
  D.impostaSnapshot('meteo', null);
  D.svuotaCache();
  r = await D.meteo();
  assert.equal(r.fonte.tipo, 'assente');
});

test('fonti/dati: allerta con riserva, passaggi senza doppioni, richieste uguali condivise', async () => {
  D.svuotaCache();
  D.impostaRete({ ora: () => N.daOraLocale(2026, 11, 14, 2, 0) });
  const ultima = { bollettinoMeteoBindList: [{ tipoDesc: 'mare', livello: 2 }], idBollettino: 7, dataEmissione: '11:10 - 13/11/2026', dataDa: '15:00 - 13/11/2026', dataA: '12:00 - 14/11/2026', numeroAvviso: 93 };
  D.impostaSnapshot('meteo', { meteoalarm: [{ fenomeno: 'Temporali', livello: 3, inizio: T, fine: T + 12 * H }], allerta: { grezzo: { ultima } } });
  D.impostaRete({ fetch: fetchFinto([[/findLastAllertaNew/, () => risposta(ultima)], [/findByIdZona\/1\/7/, () => risposta({ bollettinoMeteoBindList: [{ zona: 1, livello: 2, tipoDesc: 'mare' }] })], [/Domani/, () => risposta({ bollettinoMeteoBindList: [] })]]) });
  let r = await D.allerta();
  assert.equal(r.fonte.tipo, 'live');
  assert.equal(r.dati.regionale.colore, 'gialla');
  assert.equal(r.dati.meteoalarm.length, 1, 'Meteoalarm dallo snapshot (non ha CORS)');
  D.svuotaCache();
  D.impostaRete({ fetch: async () => risposta({}, 503) });
  r = await D.allerta();
  assert.equal(r.fonte.tipo, 'salvato');
  assert.equal(r.dati.regionale.numero, 93);

  D.svuotaCache();
  D.impostaRete({ ora: () => T });
  const corsa = (min, verso) => ({ place: { departure: new Date(T + min * 60_000).toISOString() }, routeShortName: 'L6', headsign: verso });
  let n = 0;
  D.impostaRete({
    fetch: async (url) => {
      n++;
      await new Promise((ok) => setTimeout(ok, 5));
      // Transitous raggruppa con la stazione anche le fermate dei bus vicine: vanno scartate
      const bus = { ...corsa(5, 'Medina'), routeShortName: '201', mode: 'BUS' };
      return risposta({ stopTimes: [{ ...corsa(3, 'Mostra'), mode: 'SUBWAY' }, bus, corsa(9, 'Municipio')] }, url.includes('stoptimes') ? 200 : 404);
    },
  });
  const s = { id: 'anm-1', transitous: ['it-Campania-ANM_1', 'it-Campania-ANM_2'] };
  const [a, b] = await Promise.all([D.passaggi(s), D.passaggi(s)]);
  assert.equal(n, 2, 'una richiesta per fermata, condivisa tra le due chiamate');
  assert.deepEqual(a.dati.map((x) => x.verso), ['Mostra', 'Municipio'], 'le due banchine danno le stesse corse: niente doppioni, niente bus');
  assert.equal(b.dati.length, 2);
  assert.equal((await D.passaggi({ id: 'x', transitous: [] })).fonte.tipo, 'assente');

  // traffico ASPI: zero eventi è un dato ("nessun evento"), non un errore
  D.impostaRete({ fetch: async () => risposta({ events: [] }) });
  const tr = await D.traffico();
  assert.equal(tr.fonte.tipo, 'live');
  assert.deepEqual(tr.dati, []);
  assert.match(tr.fonte.nota, /nessun evento in corso/);
  D.impostaSnapshot('meteo', null);
  D.impostaRete({ fetch: (...x) => globalThis.fetch(...x), ora: () => Date.now() });
  D.svuotaCache();
});

// ------------------------------------------------------------------ lettori senza dipendenze

test('strumenti: ZIP, CSV con virgolette, Snappy e Parquet (INT96, DECIMAL, valori nulli, Snappy)', () => {
  const zip = creaZip({ 'stops.txt': 'stop_id,stop_name\n"1","A, B"\n', 'cartella/routes.txt': 'x\n1\n' });
  const f = leggiZip(zip);
  assert.deepEqual(Object.keys(f).sort(), ['routes.txt', 'stops.txt'], 'nomi senza cartelle');
  assert.deepEqual(leggiCsv(f['stops.txt'].toString()), [{ stop_id: '1', stop_name: 'A, B' }]);
  assert.deepEqual(Object.keys(leggiZip(zip, ['stops.txt'])), ['stops.txt']);
  assert.deepEqual(leggiCsv('﻿a;b\r\n"x ""y""";2\r\n', { separatore: ';' }), [{ a: 'x "y"', b: '2' }]);

  // "abc" letterale + copia di 6 byte a distanza 3 + "X"
  assert.equal(snappyDecompress(Buffer.from([10, 0x08, 97, 98, 99, 0x09, 0x03, 0x00, 88])).toString(), 'abcabcabcX');
  assert.throws(() => snappyDecompress(Buffer.from([5, 0x09, 0x03])), /Snappy/);

  const righe = [
    { fine: Date.UTC(2026, 10, 13, 20), valore: 26.68 },
    { fine: Date.UTC(2026, 10, 13, 21), valore: null },
    { fine: Date.UTC(2026, 10, 13, 22), valore: -1.5, validita: -1 },
  ];
  for (const codec of [0, 1]) {
    const pq = leggiParquet(creaParquet(righe, codec));
    assert.equal(pq.numRighe, 3);
    assert.deepEqual(pq.colonne.End, righe.map((r) => r.fine), `INT96 → ms (codec ${codec})`);
    assert.deepEqual(pq.colonne.Value, [26.68, null, -1.5], 'DECIMAL con segno e valori nulli');
    assert.deepEqual(pq.colonne.Validity, [1, 1, -1]);
  }
  // serieDaParquet: solo valori validi, ts = fine dell'ora in UTC (i file EEA sono in UTC+1)
  assert.deepEqual(serieDaParquet(creaParquet(righe)), [[Date.UTC(2026, 10, 13, 19), 26.7]]);
  assert.throws(() => leggiParquet(Buffer.from('nonparquet')), /PAR1/);
});

test('strumenti: GTFS ridotto a linee e stazioni con corse per ora, abbinamento a Transitous', () => {
  const zip = creaZip({
    'routes.txt': 'route_id,agency_id,route_short_name,route_long_name,route_type,route_color\n"10","ANM","L1","METRO LINEA L1","1","F8E414"\n"20","ANM","C16","","3","FFFFFF"\n',
    'stops.txt': 'stop_id,stop_name,stop_lat,stop_lon\n"1","TOLEDO","40.8427","14.2502"\n"2","TOLEDO","40.8428","14.2503"\n"3","DANTE","40.8490","14.2500"\n"9","BUS","40.85","14.26"\n',
    'trips.txt': 'route_id,service_id,trip_id,shape_id,direction_id\n"10","SAB","t1","s1","0"\n"10","FER","t2","s1","1"\n"20","SAB","t3","","0"\n',
    'stop_times.txt': 'trip_id,arrival_time,departure_time,stop_id,stop_sequence\n"t1","15:01:00","15:01:00","1","1"\n"t1","15:04:00","15:04:00","3","2"\n"t2","25:10:00","25:10:00","2","1"\n"t3","15:00:00","15:00:00","9","1"\n',
    'shapes.txt': 'shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence\n"s1","40.8427","14.2502","1"\n"s1","40.8458","14.2501","2"\n"s1","40.8490","14.2500","3"\n',
    'calendar_dates.txt': 'service_id,date,exception_type\n"SAB","20261114","1"\n"FER","20261116","1"\n',
  });
  const r = riduciGtfs(leggiZip(zip), {
    prefisso: 'anm',
    tipi: [1, 7],
    ora: T,
    nomeLinea: (x) => ({ sigla: x.route_short_name, nome: x.route_long_name, rete: 'Metropolitana' }),
    tipoLinea: () => 'metro',
    operatore: () => 'ANM',
    colore: (x) => `#${x.route_color}`,
    tipoStazione: () => 'metro',
    operatoreStazione: () => 'ANM',
  });
  assert.deepEqual(r.giorni, { sabato: '20261114', festivo: '20261115', feriale: '20261116' });
  assert.deepEqual(r.linee.map((l) => [l.sigla, l.colore]), [['L1', '#F8E414']], 'solo metro e funicolari');
  assert.equal(r.linee[0].tratti[0].length, 2, 'percorso semplificato (il punto intermedio è allineato)');
  const toledo = r.stazioni.find((s) => s.nome === 'Toledo');
  assert.deepEqual(toledo.fermate, ['1', '2'], 'le due banchine con lo stesso nome sono una stazione');
  assert.equal(toledo.corse.sabato[15], 1);
  assert.equal(toledo.corse.feriale[1], 1, 'le 25:10 sono l\'1:10 del giorno dopo');
  assert.equal(r.stazioni.length, 2);
  abbinaTransitous(r.stazioni, [{ stopId: 'it-Campania-ANM_2', lat: 40.8428, lon: 14.2503, modes: ['SUBWAY'] }, { stopId: 'it-Campania-ANM_77', lat: 40.849, lon: 14.25, modes: ['SUBWAY'] }]);
  assert.deepEqual(toledo.transitous, ['it-Campania-ANM_2']);
  assert.deepEqual(r.stazioni.find((s) => s.nome === 'Dante').transitous, ['it-Campania-ANM_77'], 'senza id uguale: la fermata più vicina dello stesso tipo');
  assert.equal(nomeStazione('C.SO V. EMANUELE'), 'Corso Vittorio Emanuele');
  assert.equal(nomeStazione("MEDAGLIE D'ORO"), "Medaglie d'Oro");
  assert.equal(semplifica([[0, 0], [0, 0.5], [0, 1]]).length, 2);
  assert.deepEqual(giorniTipo(N.daOraLocale(2026, 11, 16, 10)), { feriale: '20261116', sabato: '20261121', festivo: '20261122' });
});

test('strumenti: parser di crociere, Serie A, America\'s Cup, visitatori comunali e ISTAT', () => {
  const rss = `<rss><channel><item><title>Cruises To Naples, Italy on 16 Nov 2026</title><description>Celebrity Cruises 10 Night Greece, Italy  and  Malta on Celebrity Equinox, MSC Cruises 7 Night Western Mediterranean on MSC Magnifica (7 Night Mediterranean)</description></item><item><title>Cruises To Naples, Italy on 3 Aug 2029</title><description>X on Ship One</description></item></channel></rss>`;
  assert.deepEqual(crociereDaRss(rss), [{ giorno: '2026-11-16', navi: ['Celebrity Equinox', 'MSC Magnifica'] }, { giorno: '2029-08-03', navi: ['Ship One'] }]);
  assert.deepEqual(
    partiteDaOpenfootball({ matches: [{ round: 'Matchday 12', date: '2026-11-21', time: '20:45', team1: 'SSC Napoli', team2: 'Torino FC' }, { date: '2026-11-28', team1: 'AS Roma', team2: 'SSC Napoli' }] }).map((p) => [p.giorno, p.ora, p.ospite]),
    [['2026-11-21', '20:45', 'Torino']],
    'solo le partite in casa',
  );
  assert.deepEqual(
    partiteDaOpenfootball({ matches: ['Bologna FC 1909', 'Parma Calcio 1913', 'Genoa CFC', 'Internazionale Milano'].map((team2, i) => ({ date: `2026-09-0${i + 1}`, team1: 'SSC Napoli', team2 })) }).map((p) => p.ospite),
    ['Bologna', 'Parma', 'Genoa', 'Internazionale Milano'],
    'nomi brevi delle squadre ospiti',
  );
  assert.equal(N.partiteDaOpenfootball, partiteDaOpenfootball, 'pagina e script usano lo stesso parser');
  const ac = regateDaAmericasCup([
    { time: '2027-05-22 12:00:00', title: 'Fleet race', short_text: '<span class="event-name">LOUIS VUITTON CUP</span>' },
    { time: '2027-07-20 12:00:00', title: 'Reserve day', short_text: '<span class="event-name">LOUIS VUITTON 38TH AMERICA\'S CUP</span>' },
  ]);
  assert.equal(ac[0].titolo, 'Louis Vuitton Cup · regate di flotta');
  assert.equal(ac[1].riserva, true);
  assert.equal(ac[1].evento, "Louis Vuitton 38th America's Cup");
  const v = visitatoriDaCsv('﻿MESE;ANNO;Nro VISITATORI;Nota\nGennaio;2025;976;\nFebbraio;2025;1.279;\nOttobre;2025;0;Chiuso per lavori\n');
  assert.equal(v.anno, 2025);
  assert.equal(v.mesi[1], 1279, 'separatore delle migliaia');
  assert.equal(v.totale, 2255);
  assert.deepEqual(v.note, ['chiuso per lavori']);
  const csv = 'TIME_PERIOD,OBS_VALUE,DATA_TYPE,COUNTRY_RES_GUESTS,TYPE_ACCOMMODATION\n' + Array.from({ length: 12 }, (_, i) => `2025-${String(i + 1).padStart(2, '0')},${(i + 1) * 100},AR,WORLD,ALL\n2025-${String(i + 1).padStart(2, '0')},${(i + 1) * 40},AR,WRL_X_ITA,ALL\n2024-01,999999,AR,WORLD,ALL`).join('\n');
  const s = stagionalitaDaIstat(csv);
  assert.equal(s.anno, 2025, "vince l'anno più recente");
  assert.equal(s.mesi[11].arrivi, 1100);
  assert.equal(s.mesi[11].stranieri, 440);
  assert.equal(s.mediaArrivi, 650);
});

test('strumenti: aggiornaDati con fetch finto scrive gli snapshot e l\'indice; una sezione fallita non cancella il file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dati-napoli-'));
  const out = pathToFileURL(`${dir}/`).href;
  try {
    const cur = { current: { time: '2026-11-14T15:00', temperature_2m: 17, european_aqi: 20, weather_code: 1 } };
    const f = fetchFinto([
      [/comune\.napoli\.it/, () => risposta({ success: true, data: [{ titolo: 'Tri Gold Caracciolo 2026', data_orario_inizio: '1794646800', data_orario_fine: '1794747600', luogo_evento: '{"address":"Rotonda Diaz | Lungomare Caracciolo"}', tipo_evento: '{"title":"Evento sportivo"}' }] })],
      [/openfootball/, () => risposta({ matches: [{ date: '2026-11-21', time: '20:45', team1: 'SSC Napoli', team2: 'Torino FC' }] })],
      [/thesportsdb/, () => risposta({ events: [] })],
      [/cruisetimetables/, () => risposta('<item><title>Cruises To Naples, Italy on 16 Nov 2026</title><description>A on Costa Toscana</description></item>')],
      [/americascup/, () => risposta([{ time: '2027-05-22 12:00:00', title: 'Fleet race', short_text: '<span class="event-name">LOUIS VUITTON CUP</span>' }])],
      [/open-meteo\.com/, () => risposta(ZONE.map(() => cur))],
      [/findLastAllertaNew/, () => risposta({ bollettinoMeteoBindList: [{ livello: 1, tipoDesc: '' }], idBollettino: null, dataDa: '15:00 - 13/11/2026', dataA: '12:00 - 14/11/2026' })],
      [/findAllertaDomaniNew/, () => risposta({ bollettinoMeteoBindList: [] })],
      [/meteoalarm/, () => risposta({ warnings: [] })],
      [/ingv/, () => risposta({ features: [{ properties: { time: '2026-11-13T07:22:11', mag: 2.6, magType: 'Md', place: 'Campi Flegrei' }, geometry: { coordinates: [14.148, 40.835, 3] } }] })],
    ]);
    const r1 = await aggiornaDati({ fetch: f, ora: T, solo: ['eventi', 'meteo'], out });
    assert.deepEqual(r1.errori, []);
    assert.deepEqual(r1.scritti, ['eventi.json', 'meteo.json', 'indice.json']);
    const ev = JSON.parse(await readFile(join(dir, 'eventi.json'), 'utf8'));
    assert.equal(ev.meta.generato, new Date(T).toISOString());
    assert.equal(ev.comune[0].zona, 'lungomare');
    assert.deepEqual(ev.crociere, [{ giorno: '2026-11-16', navi: ['Costa Toscana'] }]);
    assert.equal(ev.partite[0].ospite, 'Torino');
    assert.ok(ev.meta.fonti.every((x) => x.stato === 'ok' && x.licenza), 'ogni fonte con stato e licenza');
    const me = JSON.parse(await readFile(join(dir, 'meteo.json'), 'utf8'));
    assert.equal(me.meteo.plebiscito.temperatura, 17);
    assert.equal(me.terremoti[0].magnitudo, 2.6);
    const idx = JSON.parse(await readFile(join(dir, 'indice.json'), 'utf8'));
    assert.deepEqual(Object.keys(idx.file).sort(), ['eventi.json', 'meteo.json']);

    // una sola fonte giù (Open-Meteo 429): la sua parte arriva dal file precedente, dichiarata
    const conMeteoGiu = async (url, o) => (/api\.open-meteo\.com/.test(String(url)) ? risposta({}, 429) : f(url, o));
    const r3 = await aggiornaDati({ fetch: conMeteoGiu, ora: T + H, solo: ['meteo'], out });
    assert.deepEqual(r3.errori, []);
    const me2 = JSON.parse(await readFile(join(dir, 'meteo.json'), 'utf8'));
    assert.equal(me2.meteo.plebiscito.temperatura, 17, 'il meteo salvato prima non si perde');
    const fm = me2.meta.fonti.find((x) => /Meteo attuale/.test(x.nome));
    assert.equal(fm.stato, 'precedente');
    assert.equal(fm.datoDel, new Date(T).toISOString());
    assert.match(fm.errore, /429/);
    assert.equal(me2.meta.generato, new Date(T + H).toISOString());

    // tutto giù: la sezione non viene riscritta e l'errore è riportato
    const prima = await readFile(join(dir, 'eventi.json'), 'utf8');
    const r2 = await aggiornaDati({ fetch: async () => risposta({}, 503), ora: T + H, solo: ['eventi', 'boh'], out });
    assert.deepEqual(r2.errori.map((e) => e.sezione), ['eventi', 'boh']);
    assert.equal(await readFile(join(dir, 'eventi.json'), 'utf8'), prima);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('snapshot in dati/: presenti, con meta, fonti e contenuti minimi', async () => {
  const leggi = async (n) => JSON.parse(await readFile(new URL(`../dati/${n}.json`, import.meta.url), 'utf8'));
  const [tr, ar, ev, ri, me] = await Promise.all(['trasporti', 'aria', 'eventi', 'riferimenti', 'meteo'].map(leggi));
  for (const d of [tr, ar, ev, ri, me]) {
    assert.ok(Date.parse(d.meta.generato) > 0);
    assert.ok(d.meta.fonti.length > 0);
  }
  assert.ok(tr.linee.some((l) => l.sigla === 'L1') && tr.stazioni.length > 40);
  for (const z of ZONE) assert.ok(Array.isArray(tr.vicine[z]), z);
  assert.ok(ar.stazioni.every((s) => s.lat && s.lon && Object.keys(s.misure).length));
  assert.ok(Array.isArray(ev.partite) && Array.isArray(ev.crociere) && Array.isArray(ev.comune));
  assert.ok(ri.perZona.beverello.length > 0);
});

// ------------------------------------------------------------------ simulatore (curve della folla)

test('sim-config: ogni luogo ha l\'effetto del suo evento reale e la stagione cambia la folla', async () => {
  const conf = JSON.parse(await readFile(new URL('../simulatore/sim-config.json', import.meta.url), 'utf8'));
  for (const z of ZONE) {
    const d = conf.devices.find((x) => x.location.zone === z);
    assert.ok(d.readings.people_count.effects[`evento_${z}`]?.add > 0, z);
  }
  const { createSimulator } = await import('../simulatore/sim-core.js');
  let t = 1_000_000;
  const sim = createSimulator({ ...conf, timeline: [] }, { now: () => t, selfTrigger: false });
  const persone = (z) => sim.sample(t).find((r) => r.location.zone === z).readings.people_count;
  const base = persone('lungomare');
  sim.onScenarioEvent({ name: 'evento_lungomare', active: true });
  t += 60_000;
  assert.ok(persone('lungomare') > base + 1500, 'il triathlon aggiunge persone');
  sim.onScenarioEvent({ name: 'evento_lungomare', active: false });
  sim.onScenarioEvent({ name: 'stagione_bassa', active: true });
  t += 60_000;
  assert.ok(persone('maradona') <= 60, 'lo stadio vuoto non cambia');
  const conBassa = sim.sample(t).find((r) => r.location.zone === 'beverello').readings.people_count;
  sim.onScenarioEvent({ name: 'stagione_bassa', active: false });
  const senza = sim.sample(t).find((r) => r.location.zone === 'beverello').readings.people_count;
  assert.ok(conBassa < senza, `${conBassa} < ${senza}`);
});
