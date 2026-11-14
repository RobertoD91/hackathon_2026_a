// Aiuti dei test: orologio finto, fetch finto con regole per URL, snapshot sintetici in una
// cartella temporanea, servizio completo in ascolto su una porta libera.

import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as N from '../../iot-agents/example/fonti/normalizza.js';
import { LUOGHI } from '../../iot-agents/example/luoghi.js';
import { creaServizio } from '../src/servizio.js';

export const H = 3_600_000;
export const M = 60_000;
/** Sabato 14/11/2026 alle 15:00 a Napoli. */
export const T = N.daOraLocale(2026, 11, 14, 15, 0);
export const ZONE = Object.keys(LUOGHI);

export function orologio(t = T) {
  const o = { t, ora: () => o.t, avanza: (ms) => (o.t += ms) };
  return o;
}

export const risposta = (corpo, status = 200, headers = {}) =>
  new Response(typeof corpo === 'string' ? corpo : JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json', ...headers } });

/**
 * fetch finto: `regole` = [[regex, (url, init) => Response | Promise<Response>], ...]; registra le chiamate.
 * Una richiesta senza regola risponde 404.
 */
export function fetchFinto(regole) {
  const chiamate = [];
  const f = async (url, init = {}) => {
    chiamate.push({ url: String(url), headers: init.headers || {} });
    for (const [re, fn] of regole) if (re.test(String(url))) return fn(String(url), init);
    return risposta({ errore: 'nessuna regola' }, 404);
  };
  f.chiamate = chiamate;
  f.conta = (re) => chiamate.filter((c) => re.test(c.url)).length;
  return f;
}

const isoLocale = (ts) => {
  const p = N.partiLocali(ts);
  const d = (n) => String(n).padStart(2, '0');
  return `${p.anno}-${d(p.mese)}-${d(p.giorno)}T${d(p.ora)}:${d(p.minuto)}`;
};
const dataCf = (ts) => {
  const p = N.partiLocali(ts);
  const d = (n) => String(n).padStart(2, '0');
  return `${d(p.ora)}:${d(p.minuto)} - ${d(p.giorno)}/${d(p.mese)}/${p.anno}`;
};

// ------------------------------------------------------------------ risposte delle fonti

export function openMeteo(t, { temp = 18 } = {}) {
  return ZONE.map((z, i) => ({
    latitude: LUOGHI[z].lat,
    longitude: LUOGHI[z].lon,
    current: { time: isoLocale(t - 15 * M), temperature_2m: temp + i / 10, apparent_temperature: temp - 1, relative_humidity_2m: 70, precipitation: 0, weather_code: 2, wind_speed_10m: 18.5, wind_gusts_10m: 30, is_day: 1 },
  }));
}

export function cams(t) {
  return ZONE.map(() => ({ current: { time: isoLocale(t - H), european_aqi: 30, pm10: 16, pm2_5: 5, nitrogen_dioxide: 17, ozone: 52 } }));
}

export function metNo(t) {
  return {
    geometry: { coordinates: [14.242, 40.8435] },
    properties: { timeseries: [{ time: new Date(t - 30 * M).toISOString(), data: { instant: { details: { air_temperature: 16, relative_humidity: 80, wind_speed: 5 } }, next_1_hours: { summary: { symbol_code: 'lightrain' }, details: { precipitation_amount: 0.4 } } } }] },
  };
}

export function allertaCf(t, { livello = 2, vuota = false } = {}) {
  if (vuota) return { ultima: { bollettinoMeteoBindList: [], idBollettino: null, dataDa: dataCf(t - H), dataA: dataCf(t + H) }, zona: null, domani: { bollettinoMeteoBindList: [] } };
  return {
    ultima: { idBollettino: 7, numeroAvviso: 94, dataEmissione: dataCf(t - 4 * H), dataDa: dataCf(t - 3 * H), dataA: dataCf(t + 6 * H), bollettinoMeteoBindList: [{ zona: 1, livello, livelloDesc: 'Livello di allerta giallo', tipoDesc: 'mare' }] },
    zona: { bollettinoMeteoBindList: [{ zona: 1, livello, livelloDesc: 'Livello di allerta giallo', tipoDesc: 'mare vento', fenomeni: 'Mare agitato, venti forti.' }] },
    domani: { bollettinoMeteoBindList: [] },
  };
}

export function transitous(t, linea = 'L1', verso = 'PISCINOLA', eav = false) {
  return {
    stopTimes: [5, 14, 23].map((min) => ({
      place: { departure: new Date(t + min * M).toISOString(), scheduledDeparture: new Date(t + min * M).toISOString() },
      routeShortName: linea,
      headsign: verso,
      realTime: min === 5,
      mode: eav ? 'REGIONAL_RAIL' : 'SUBWAY',
      agencyName: eav ? 'Eav srl - Divisione Ferrovia' : 'Azienda Napoletana Mobilità',
    })),
  };
}

/** Regole per tutte le fonti, con l'allerta e Open-Meteo configurabili. */
export function fontiNormali(t, o = {}) {
  const cf = allertaCf(t, o.allerta);
  return [
    [/\/\/api\.open-meteo\.com/, () => (o.meteo429 ? risposta({ reason: 'limite' }, 429) : risposta(openMeteo(t)))],
    [/\/\/air-quality-api\.open-meteo\.com/, () => (o.meteo429 ? risposta({}, 429) : risposta(cams(t)))],
    [/api\.met\.no/, () => risposta(metNo(t))],
    [/findLastAllertaNew/, () => risposta(cf.ultima)],
    [/findByIdZona/, () => risposta(cf.zona)],
    [/findAllertaDomaniNew/, () => risposta(cf.domani)],
    [/ingv\.it/, () => risposta({ features: [{ properties: { time: new Date(t - 20 * H).toISOString(), mag: 2.1, magType: 'Md', place: 'Campi Flegrei' }, geometry: { coordinates: [14.14, 40.83, 2.5] } }] })],
    [/eavsrl\.it/, () => risposta([{ date_gmt: '2026-11-14T08:00:00', title: { rendered: 'Cumana: ascensore di Mostra fuori servizio' }, link: 'https://www.eavsrl.it/x', categories: [65] }])],
    [/transitous\.org/, (u) => (o.transitousGiu ? risposta({}, 503) : risposta(/EAV_/.test(u) ? transitous(t, '9', 'Torregaveta', true) : transitous(t)))],
    [/autostrade\.it/, () => risposta({ events: [] })],
  ];
}

// ------------------------------------------------------------------ snapshot sintetici

export function snapshotSintetici(t = T) {
  const generato = new Date(t - 5 * H).toISOString();
  const corse = { feriale: Array(24).fill(10), sabato: Array(24).fill(8), festivo: Array(24).fill(6) };
  const stazioni = [
    { id: 'anm-6325', nome: 'Toledo', tipo: 'metro', linee: ['L1'], operatore: 'ANM', lat: 40.8427, lon: 14.25024, corse, transitous: ['it-Campania-ANM_6325'] },
    { id: 'anm-6240', nome: 'Chiaia', tipo: 'metro', linee: ['L6'], operatore: 'ANM', lat: 40.8361, lon: 14.2477, corse, transitous: ['it-Campania-ANM_6240'] },
    { id: 'anm-6347', nome: 'Garibaldi', tipo: 'metro', linee: ['L1'], operatore: 'ANM', lat: 40.85222, lon: 14.27253, corse, transitous: ['it-Campania-ANM_6347'] },
    { id: 'anm-6271', nome: 'Piazza Garibaldi', tipo: 'metro', linee: ['L2'], operatore: 'Trenitalia', lat: 40.8525, lon: 14.2718, corse, transitous: [] },
    { id: 'eav-6801', nome: 'Montesanto', tipo: 'ferrovia', linee: ['Circumflegrea', 'Cumana'], operatore: 'EAV', lat: 40.84705, lon: 14.24533, corse, transitous: ['it-Campania-EAV_6801'] },
    { id: 'eav-6804', nome: 'Mostra', tipo: 'ferrovia', linee: ['Cumana'], operatore: 'EAV', lat: 40.8248, lon: 14.1945, corse, transitous: ['it-Campania-EAV_6804'] },
    { id: 'anm-6279', nome: 'Bagnoli', tipo: 'metro', linee: ['L2'], operatore: 'Trenitalia', lat: 40.8155, lon: 14.1735, corse, transitous: ['it-trenitalia_x'] },
  ];
  const giorno = N.giornoLocale(t);
  const g0 = N.inizioGiorno(giorno);
  const meteo = Object.fromEntries(ZONE.map((z) => [z, { temperatura: 15, percepita: 14, umidita: 80, pioggia: 0, codice: 3, cielo: 'Coperto', vento: 10, raffiche: 20, giorno: true, ts: t - 6 * H }]));
  return {
    trasporti: { meta: { generato, fonti: [{ nome: 'GTFS ANM', stato: 'ok' }] }, linee: [{ sigla: 'L1', colore: '#c00' }], stazioni, vicine: { plebiscito: [{ id: 'anm-6240', m: 97, piedi: 2 }] } },
    aria: {
      meta: { generato, ultimoDato: t - 10 * H, fonti: [{ nome: 'EEA', stato: 'ok' }] },
      stazioni: [{ id: 'IT1491A', nome: 'NA07 ENTE FERROVIE', tipo: 'traffico urbano', lat: 40.853, lon: 14.272, misure: { NO2: { unita: 'µg/m³', ultimo: { ts: t - 10 * H, valore: 95 }, serie: [[t - 11 * H, 80], [t - 10 * H, 95]] } } }],
      vicine: { garibaldi: { id: 'IT1491A', km: 0.1 }, plebiscito: { id: 'IT1491A', km: 2 } },
    },
    eventi: {
      meta: { generato, fonti: [{ nome: 'Comune', stato: 'ok' }] },
      partite: [{ giorno, ora: '20:45', casa: 'Napoli', ospite: 'Torino', competizione: 'Serie A', fonte: 'openfootball' }],
      crociere: [{ giorno: N.giornoLocale(t + 2 * 24 * H), navi: ['MSC Magnifica', 'Costa Toscana'] }],
      comune: [{ titolo: 'Tri Gold Caracciolo', inizio: g0 + 9 * H, fine: g0 + 13 * H, luogo: 'Rotonda Diaz', tipo: 'Evento sportivo', zona: 'lungomare', grande: true }],
      speciali: [{ giorno: '2027-05-22', titolo: 'Louis Vuitton Cup · regate di flotta', evento: 'Louis Vuitton Cup', zona: 'lungomare', fonte: 'americascup', riserva: false }],
    },
    riferimenti: {
      meta: { generato, fonti: [{ nome: 'ISTAT', stato: 'ok' }] },
      perZona: {
        castel_ovo: [
          { tipo: 'visitatori', etichetta: "Castel dell'Ovo", anno: 2019, totale: 233500, mesi: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11500, 12], fonte: 'Comune di Napoli, CC BY 4.0' },
          { tipo: 'visitatori', etichetta: "Castel dell'Ovo", anno: 2025, totale: 0, mesi: Array(12).fill(0), nota: 'chiuso per lavori', chiuso: true, fonte: 'Comune di Napoli, CC BY 4.0' },
        ],
      },
      stagionalita: { anno: 2025, mesi: { 11: { arrivi: 100_000, stranieri: 40_000 } }, mediaArrivi: 200_000 },
    },
    meteo: {
      meta: { generato, fonti: [{ nome: 'Open-Meteo', stato: 'ok' }] },
      meteo,
      aria: Object.fromEntries(ZONE.map((z) => [z, { aqi: 45, pm10: 20, pm25: 9, no2: 30, o3: 40, ts: t - 7 * H }])),
      allerta: null,
      meteoalarm: [{ fenomeno: 'Temporali', livello: 3, colore: 'arancione', inizio: g0 + 31 * H, fine: g0 + 43 * H, titolo: 'Allerta Temporali Arancione' }],
      terremoti: [],
    },
    indice: { generato, file: {} },
  };
}

/** Cartella temporanea con gli snapshot sintetici. */
export async function cartellaSnapshot(dati = snapshotSintetici()) {
  const dir = await mkdtemp(join(tmpdir(), 'citta-api-test-'));
  for (const [nome, v] of Object.entries(dati)) await writeFile(join(dir, `${nome}.json`), JSON.stringify(v));
  return dir;
}

/** Servizio completo in ascolto su 127.0.0.1 (porta libera). */
export async function avviaServizio({ regole, config = {}, orologio: o = orologio(), dati } = {}) {
  const dir = await cartellaSnapshot(dati);
  const fetch = fetchFinto(regole || fontiNormali(o.t));
  const s = await creaServizio(
    { porta: 0, host: '127.0.0.1', token: null, cors: ['https://robertodisanto.it'], ua: 'test-ua/1.0', uaForzato: false, cartellaDati: dir, cartellaIniziale: dir, aggiorna: {}, tieniCaldo: false, pausa429Ms: 15 * M, log: false, ...config },
    { fetch, ora: o.ora, log: () => {} },
  );
  const porta = await s.avvia({ porta: 0, host: '127.0.0.1' });
  const base = `http://127.0.0.1:${porta}`;
  const get = async (percorso, headers = {}) => {
    const r = await globalThis.fetch(base + percorso, { headers });
    const testo = await r.text();
    let json = null;
    try {
      json = JSON.parse(testo);
    } catch {
      /* testo semplice */
    }
    return { status: r.status, headers: r.headers, json, testo };
  };
  return {
    s,
    fetch,
    orologio: o,
    dir,
    base,
    get,
    async chiudi() {
      await s.chiudi();
      await rm(dir, { recursive: true, force: true });
    },
  };
}
