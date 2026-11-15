#!/usr/bin/env node
// Rigenera gli SNAPSHOT dei dati reali di Napoli usati dall'API dati città e dalla mappa "Napoli in
// tempo reale" (citta-api/dati/*.json). Servono per le fonti senza CORS o troppo pesanti per il
// browser (GTFS zip, Parquet dell'EEA, PDF, feed senza CORS) e come riserva quando una fonte live è giù.
// Ogni file dice quando è stato generato, da quali fonti, con quale licenza e cosa è andato storto.
//
//   node citta-api/strumenti/aggiorna-dati-napoli.js                  # tutti gli snapshot
//   node citta-api/strumenti/aggiorna-dati-napoli.js --solo eventi,meteo
//   node citta-api/strumenti/aggiorna-dati-napoli.js --out /tmp/dati  # altra cartella
//   node citta-api/strumenti/aggiorna-dati-napoli.js --curl            # richieste con curl invece di fetch
//                                                                          # (se un WAF rifiuta il client di Node)
//
// Sezioni (un file ciascuna): trasporti (GTFS ANM ed EAV + id Transitous), aria (centraline ARPAC
// via EEA, Parquet), eventi (Comune, Serie A, crociere, America's Cup), riferimenti (visitatori dei
// siti comunali, ISTAT, Wikidata, Inside Airbnb, acque di balneazione, porto), meteo (meteo, allerta
// regionale, Meteoalarm, indice europeo dell'aria, terremoti INGV: riserva delle fonti live).
// Se nessuna fonte di una sezione risponde il file precedente resta com'è; se ne fallisce solo
// qualcuna la sezione viene scritta lo stesso, con l'errore annotato in `meta.fonti`, e la parte di
// quella fonte ripresa dal file precedente (stato 'precedente', con la data `datoDel`).
//
// Nessuna dipendenza npm: ZIP e Parquet con i lettori minimi in questa cartella.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { leggiZip, leggiCsv } from './zip-mini.js';
import { leggiParquet } from './parquet-mini.js';
import { LUOGHI } from '../fonti/luoghi.js';
import {
  km,
  piatto,
  giornoLocale,
  daOraLocale,
  partiLocali,
  eventoComune,
  meteoDaOpenMeteo,
  ariaDaOpenMeteo,
  allertaDaCentroFunzionale,
  meteoalarmCampania,
  terremotiIngv,
  stazioniVicine,
  decodificaEntita,
  partiteDaOpenfootball,
} from '../fonti/normalizza.js';

export { partiteDaOpenfootball };

const CARTELLA = new URL('../dati/', import.meta.url);
// User-Agent generico; per le API che chiedono un contatto (es. Wikidata) si può passare il proprio
// con la variabile d'ambiente NAPOLI_UA (mai dati personali scritti nel codice).
const UA = process.env.NAPOLI_UA || 'napoli-in-tempo-reale/1.0 (demo hackathon; dati aperti)';
const UA_BROWSER = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
/** Riquadro del Comune di Napoli (largo): fermate, centraline, linee tagliate qui. */
const BOX = { s: 40.78, n: 40.92, o: 14.12, e: 14.36 };
const dentro = (p, b = BOX) => p.lat >= b.s && p.lat <= b.n && p.lon >= b.o && p.lon <= b.e;
const ZONE = Object.keys(LUOGHI);
const PUNTI = Object.fromEntries(ZONE.map((z) => [z, { lat: LUOGHI[z].lat, lon: LUOGHI[z].lon }]));
const r5 = (v) => Math.round(v * 1e5) / 1e5;

// ------------------------------------------------------------------ rete

/**
 * Scarica una risorsa. `come`: 'json' | 'testo' | 'buffer'. Errori chiari (HTTP, timeout, JSON).
 * @param {Function} f fetch (vero o finto nei test)
 */
export async function scarica(f, url, { come = 'json', timeoutMs = 60_000, headers = {}, metodo = 'GET', corpo, tentativi = 2 } = {}) {
  let ultimo;
  for (let i = 0; i < tentativi; i++) {
    try {
      const res = await f(url, {
        method: metodo,
        headers: { 'user-agent': UA, accept: come === 'json' ? 'application/json' : '*/*', ...headers },
        body: corpo,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (come === 'json') return await res.json();
      if (come === 'testo') return await res.text();
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      ultimo = err?.name === 'TimeoutError' ? new Error(`timeout dopo ${timeoutMs / 1000} s`) : err;
      if (/HTTP 4\d\d/.test(String(ultimo.message)) && !/HTTP 429/.test(ultimo.message)) break;
    }
  }
  throw new Error(`${url.split('?')[0]}: ${ultimo?.message || ultimo}`);
}

/**
 * fetch fatto con curl (opzione --curl): utile dietro proxy o WAF che rifiutano il client HTTP di
 * Node ma non curl (es. l'API eventi del Comune dalla sandbox di sviluppo). Restituisce un oggetto
 * compatibile con quello che usa `scarica`.
 */
export function fetchConCurl(url, { method = 'GET', headers = {}, body, signal } = {}) {
  const segno = Buffer.from('\n__STATO_HTTP__');
  const args = ['-sS', '-L', '--compressed', '-X', method, '-o', '-', '-w', '\n__STATO_HTTP__%{http_code}', '--max-time', '120'];
  for (const [k, v] of Object.entries(headers)) args.push('-H', `${k}: ${v}`);
  if (body != null) args.push('--data-binary', '@-');
  args.push(url);
  return new Promise((resolve, reject) => {
    const p = execFile('curl', args, { encoding: 'buffer', maxBuffer: 256 * 1024 * 1024 }, (err, out) => {
      if (err) return reject(new Error(`curl: ${String(err.message).split('\n')[0]}`));
      const i = out.lastIndexOf(segno);
      const status = Number(out.subarray(i + segno.length).toString());
      const corpo = out.subarray(0, i);
      resolve({
        ok: status >= 200 && status < 300,
        status,
        json: async () => JSON.parse(corpo.toString('utf8')),
        text: async () => corpo.toString('utf8'),
        arrayBuffer: async () => corpo.buffer.slice(corpo.byteOffset, corpo.byteOffset + corpo.length),
      });
    });
    signal?.addEventListener?.('abort', () => p.kill());
    if (body != null) p.stdin.end(body);
  });
}

/** Esegue `fn` su ogni elemento con al massimo `n` operazioni in parallelo. */
async function aGruppi(lista, n, fn) {
  const out = new Array(lista.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, lista.length) }, async () => {
      while (i < lista.length) {
        const k = i++;
        out[k] = await fn(lista[k], k);
      }
    }),
  );
  return out;
}

/**
 * Registro delle fonti di una sezione: stato, licenza, note.
 * `precedente` = lo snapshot già presente (o null): se una fonte non risponde e `prova` ha una
 * `riserva`, si riusa la sua parte del file precedente (stato 'precedente', con la data di quel file)
 * invece di perderla. Così un 429 o un 502 passeggero non svuota lo snapshot.
 */
function registro(precedente = null) {
  const fonti = [];
  return {
    fonti,
    precedente,
    async prova(def, fn, { riserva } = {}) {
      try {
        const v = await fn();
        fonti.push({ ...def, stato: 'ok' });
        return v;
      } catch (err) {
        const errore = String(err?.message || err).slice(0, 300);
        const vecchio = precedente && riserva ? riserva(precedente) : null;
        if (vecchio != null) {
          fonti.push({ ...def, stato: 'precedente', errore, datoDel: precedente.meta?.generato ?? null });
          return vecchio;
        }
        fonti.push({ ...def, stato: 'errore', errore });
        return null;
      }
    },
  };
}

/** Voci di `perZona` del file precedente che soddisfano `filtro` (riserva dei riferimenti). */
function vociPrecedenti(prec, filtro) {
  return Object.entries(prec?.perZona || {}).flatMap(([zona, voci]) => voci.filter(filtro).map((v) => [zona, v]));
}

// ------------------------------------------------------------------ trasporti (GTFS)

/** Nomi delle stazioni: maiuscolo ANM → forma leggibile. */
const NOMI = {
  'c so v emanuele': 'Corso Vittorio Emanuele',
  'p fuga': 'Piazza Fuga',
  'p co angelina': 'Parco Angelina',
  's antonio': "Sant'Antonio",
  's gioacchino': 'San Gioacchino',
  's rosa': 'Salvator Rosa',
  'universita': 'Università',
  'medaglie d oro': "Medaglie d'Oro",
  'piazza garibaldi': 'Piazza Garibaldi',
  'san giovanni barra': 'San Giovanni-Barra',
  'napoli centrale rfi': 'Napoli Centrale',
  'napoli p garibaldi': 'Napoli Piazza Garibaldi',
};
const MINUSCOLE = new Set(['di', 'del', 'della', 'delle', 'dei', 'da', 'e', 'a', 'al', 'alla', 'in', 'sul', 'sant']);
export function nomeStazione(s) {
  const k = piatto(s);
  if (NOMI[k]) return NOMI[k];
  return String(s)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .split(' ')
    .map((w, i) => (i > 0 && MINUSCOLE.has(w) ? w : w.replace(/(^|['’-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase())))
    .join(' ');
}

/** Rete EAV di una linea (dai nomi delle fermate e della linea). */
function reteEav(nomeLinea, fermate) {
  const n = piatto(nomeLinea);
  const f = fermate.map((x) => piatto(x));
  if (f.some((x) => x.includes('montesanto')) || /torregaveta|bagnoli|pozzuoli|soccavo|pianura/.test(n)) {
    return /pianura|quarto|soccavo|monte sant/.test(n) ? 'Circumflegrea' : 'Cumana';
  }
  if (f.some((x) => x.includes('piscinola')) || /piscinola|aversa/.test(n)) return 'Metrocampania NordEst';
  if (f.some((x) => x.includes('porta nolana') || x.includes('garibaldi'))) return 'Circumvesuviana';
  return 'Ferrovia EAV';
}
const COLORI_EAV = { Cumana: '#1f6fb8', Circumflegrea: '#2e9b4f', Circumvesuviana: '#c8302f', 'Metrocampania NordEst': '#7b4fa0', 'Ferrovia EAV': '#6b6b6b' };

/** Riga CSV con virgolette (una riga, senza a capo nei campi): più veloce di leggiCsv sui file grandi. */
function dividiRiga(r) {
  if (!r.includes('"')) return r.split(',');
  const out = [];
  let campo = '';
  let q = false;
  for (let i = 0; i < r.length; i++) {
    const c = r[i];
    if (q) {
      if (c === '"') {
        if (r[i + 1] === '"') {
          campo += '"';
          i++;
        } else q = false;
      } else campo += c;
    } else if (c === '"') q = true;
    else if (c === ',') {
      out.push(campo);
      campo = '';
    } else campo += c;
  }
  out.push(campo);
  return out;
}

/** Scorre un CSV grande riga per riga chiamando `fn(oggetto con le sole colonne chieste)`. */
function perRiga(testo, colonne, fn) {
  let p = testo.charCodeAt(0) === 0xfeff ? 1 : 0;
  let fine = testo.indexOf('\n', p);
  const intest = dividiRiga(testo.slice(p, fine).replace(/\r$/, '')).map((h) => h.trim());
  const idx = colonne.map((c) => intest.indexOf(c));
  p = fine + 1;
  while (p < testo.length) {
    fine = testo.indexOf('\n', p);
    if (fine === -1) fine = testo.length;
    const riga = testo.slice(p, fine).replace(/\r$/, '');
    p = fine + 1;
    if (!riga) continue;
    const v = dividiRiga(riga);
    fn(idx.map((i) => (i >= 0 ? v[i] : undefined)));
  }
}

/** Douglas-Peucker su [[lat, lon], ...] con tolleranza in gradi. */
export function semplifica(punti, tol = 0.00008) {
  if (punti.length < 3) return punti;
  const tieni = new Uint8Array(punti.length);
  tieni[0] = tieni[punti.length - 1] = 1;
  const pila = [[0, punti.length - 1]];
  while (pila.length) {
    const [a, b] = pila.pop();
    const [ya, xa] = punti[a];
    const [yb, xb] = punti[b];
    const dx = xb - xa;
    const dy = yb - ya;
    const l2 = dx * dx + dy * dy || 1e-18;
    let max = 0;
    let k = -1;
    for (let i = a + 1; i < b; i++) {
      const [y, x] = punti[i];
      const t = Math.max(0, Math.min(1, ((x - xa) * dx + (y - ya) * dy) / l2));
      const d = Math.hypot(x - (xa + t * dx), y - (ya + t * dy));
      if (d > max) {
        max = d;
        k = i;
      }
    }
    if (max > tol && k > 0) {
      tieni[k] = 1;
      pila.push([a, k], [k, b]);
    }
  }
  return punti.filter((_, i) => tieni[i]);
}

/** Tagli di un percorso al riquadro: tratti consecutivi dentro il riquadro (allargato di poco). */
function tagliaAlRiquadro(punti, b = BOX) {
  const largo = { s: b.s - 0.01, n: b.n + 0.01, o: b.o - 0.01, e: b.e + 0.01 };
  const tratti = [];
  let cur = [];
  for (const p of punti) {
    if (dentro({ lat: p[0], lon: p[1] }, largo)) cur.push(p);
    else if (cur.length) {
      if (cur.length > 1) tratti.push(cur);
      cur = [];
    }
  }
  if (cur.length > 1) tratti.push(cur);
  return tratti;
}

/** Date di riferimento (AAAAMMGG) per giorno feriale, sabato e festivo a partire da `ora`. */
export function giorniTipo(ora) {
  const out = {};
  for (let d = 0; d < 14 && Object.keys(out).length < 3; d++) {
    const g = giornoLocale(ora + d * 86_400_000);
    const [a, m, gg] = g.split('-').map(Number);
    const dow = new Date(Date.UTC(a, m - 1, gg)).getUTCDay();
    const tipo = dow === 0 ? 'festivo' : dow === 6 ? 'sabato' : 'feriale';
    out[tipo] ??= g.replaceAll('-', '');
  }
  return out;
}

/** Servizi attivi in una data AAAAMMGG (calendar.txt facoltativo + calendar_dates.txt). */
function serviziAttivi(file, data) {
  const attivi = new Set();
  if (file['calendar.txt']) {
    const giorni = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const dow = giorni[new Date(Date.UTC(+data.slice(0, 4), +data.slice(4, 6) - 1, +data.slice(6, 8))).getUTCDay()];
    for (const c of leggiCsv(file['calendar.txt'].toString('utf8'))) if (c.start_date <= data && c.end_date >= data && c[dow] === '1') attivi.add(c.service_id);
  }
  perRiga(file['calendar_dates.txt']?.toString('utf8') || 'service_id,date,exception_type\n', ['service_id', 'date', 'exception_type'], ([s, d, t]) => {
    if (d !== data) return;
    if (t === '1') attivi.add(s);
    else attivi.delete(s);
  });
  return attivi;
}

/**
 * Riduce un GTFS alle linee su ferro scelte: linee con percorso semplificato e stazioni con le
 * corse programmate per ora (feriale, sabato, festivo).
 * @param {Record<string, Buffer>} file  contenuto dello zip
 * @param {{operatore: string, prefisso: string, tipi: number[], ora: number, nomeLinea: Function, tipoStazione: Function, colore: Function}} o
 */
export function riduciGtfs(file, o) {
  const testo = (n) => file[n]?.toString('utf8') ?? '';
  const routes = leggiCsv(testo('routes.txt')).filter((r) => o.tipi.includes(Number(r.route_type)));
  const rotte = new Map(routes.map((r) => [r.route_id, r]));
  const stops = new Map(leggiCsv(testo('stops.txt')).map((s) => [s.stop_id, s]));
  const trips = new Map();
  perRiga(testo('trips.txt'), ['route_id', 'service_id', 'trip_id', 'shape_id', 'direction_id'], ([route, servizio, trip, shape, dir]) => {
    if (rotte.has(route)) trips.set(trip, { route, servizio, shape, dir });
  });
  const tipi = giorniTipo(o.ora);
  const attivi = Object.fromEntries(Object.entries(tipi).map(([t, d]) => [t, serviziAttivi(file, d)]));
  const fermatePerRotta = new Map(); // route → Set(stop_id)
  const partenze = new Map(); // stop_id → { feriale: [24], ... }
  const sequenze = new Map(); // trip → [[seq, stop]]
  perRiga(testo('stop_times.txt'), ['trip_id', 'departure_time', 'stop_id', 'stop_sequence'], ([trip, dep, stop, seq]) => {
    const t = trips.get(trip);
    if (!t) return;
    (fermatePerRotta.get(t.route) ?? fermatePerRotta.set(t.route, new Set()).get(t.route)).add(stop);
    (sequenze.get(trip) ?? sequenze.set(trip, []).get(trip)).push([Number(seq), stop]);
    const h = parseInt(dep, 10) % 24;
    if (!Number.isFinite(h)) return;
    for (const [tipo, set] of Object.entries(attivi)) {
      if (!set.has(t.servizio)) continue;
      const p = partenze.get(stop) ?? partenze.set(stop, { feriale: Array(24).fill(0), sabato: Array(24).fill(0), festivo: Array(24).fill(0) }).get(stop);
      p[tipo][h]++;
    }
  });

  // percorsi: per ogni linea la forma più lunga (o, senza shapes, la sequenza di fermate più lunga)
  const forme = new Map();
  if (file['shapes.txt']) {
    const usate = new Set([...trips.values()].map((t) => t.shape).filter(Boolean));
    perRiga(testo('shapes.txt'), ['shape_id', 'shape_pt_lat', 'shape_pt_lon', 'shape_pt_sequence'], ([id, lat, lon, seq]) => {
      if (!usate.has(id)) return;
      (forme.get(id) ?? forme.set(id, []).get(id)).push([Number(seq), Number(lat), Number(lon)]);
    });
    for (const v of forme.values()) v.sort((a, b) => a[0] - b[0]);
  }
  const linee = [];
  const stazioniLinee = new Map(); // stop_id → Set(sigla)
  for (const r of routes) {
    const fermate = [...(fermatePerRotta.get(r.route_id) || [])].map((id) => stops.get(id)).filter(Boolean);
    const inCitta = fermate.filter((s) => dentro({ lat: +s.stop_lat, lon: +s.stop_lon }));
    if (!inCitta.length) continue;
    const viaggi = [...trips.entries()].filter(([, t]) => t.route === r.route_id);
    let percorso = null;
    const shapeIds = [...new Set(viaggi.map(([, t]) => t.shape).filter((s) => forme.has(s)))];
    if (shapeIds.length) {
      const migliore = shapeIds.sort((a, b) => forme.get(b).length - forme.get(a).length)[0];
      percorso = forme.get(migliore).map(([, la, lo]) => [la, lo]);
    } else {
      const piuLungo = viaggi.map(([id]) => sequenze.get(id) || []).sort((a, b) => b.length - a.length)[0] || [];
      percorso = piuLungo
        .sort((a, b) => a[0] - b[0])
        .map(([, id]) => stops.get(id))
        .filter(Boolean)
        .map((s) => [+s.stop_lat, +s.stop_lon]);
    }
    const sigla = o.nomeLinea(r, fermate.map((s) => s.stop_name));
    const tratti = tagliaAlRiquadro(percorso).map((t) => semplifica(t).map(([la, lo]) => [r5(la), r5(lo)]));
    linee.push({
      id: `${o.prefisso}-${r.route_id}`,
      sigla: sigla.sigla,
      nome: sigla.nome,
      rete: sigla.rete,
      tipo: o.tipoLinea(r),
      operatore: o.operatore(r),
      colore: o.colore(r, sigla),
      tratti,
    });
    for (const s of inCitta) (stazioniLinee.get(s.stop_id) ?? stazioniLinee.set(s.stop_id, new Set()).get(s.stop_id)).add(sigla.sigla);
  }

  // stazioni: banchine con lo stesso nome entro 400 m diventano una stazione
  const gruppi = [];
  for (const [id, sigle] of stazioniLinee) {
    const s = stops.get(id);
    const p = { lat: +s.stop_lat, lon: +s.stop_lon };
    const chiave = piatto(s.stop_name);
    const tipo = o.tipoStazione([...sigle], linee);
    const centro = (x) => ({ lat: x.lat / x.ids.length, lon: x.lon / x.ids.length }); // lat e lon sono somme
    let g = gruppi.find((x) => x.chiave === chiave && x.tipo === tipo && km(centro(x), p) < 0.4);
    if (!g) gruppi.push((g = { chiave, tipo, nome: nomeStazione(s.stop_name), ids: [], sigle: new Set(), lat: 0, lon: 0 }));
    g.ids.push(id);
    for (const x of sigle) g.sigle.add(x);
    g.lat += p.lat;
    g.lon += p.lon;
  }
  const stazioni = gruppi.map((g) => {
    const corse = { feriale: Array(24).fill(0), sabato: Array(24).fill(0), festivo: Array(24).fill(0) };
    for (const id of g.ids) for (const t of Object.keys(corse)) partenze.get(id)?.[t].forEach((v, h) => (corse[t][h] += v));
    return {
      id: `${o.prefisso}-${g.ids[0]}`,
      nome: g.nome,
      tipo: g.tipo,
      linee: [...g.sigle].sort(),
      operatore: o.operatoreStazione([...g.sigle], linee),
      lat: r5(g.lat / g.ids.length),
      lon: r5(g.lon / g.ids.length),
      fermate: g.ids,
      corse,
    };
  });
  return { linee, stazioni, giorni: tipi };
}

/** Abbina a ogni stazione gli id delle fermate di Transitous (per i prossimi passaggi). */
export function abbinaTransitous(stazioni, fermateTransitous) {
  const perId = new Map(fermateTransitous.map((f) => [f.stopId, f]));
  const modi = { metro: ['SUBWAY', 'METRO'], funicolare: ['FUNICULAR'], ferrovia: ['REGIONAL_RAIL', 'SUBURBAN', 'RAIL', 'SUBWAY'] };
  for (const s of stazioni) {
    const pref = s.id.startsWith('anm-') ? 'it-Campania-ANM_' : s.id.startsWith('eav-') ? 'it-Campania-EAV_' : null;
    let ids = pref ? s.fermate.map((f) => pref + f).filter((id) => perId.has(id)) : [];
    if (!ids.length || s.operatore === 'Trenitalia') {
      const vicine = fermateTransitous
        .filter((f) => (f.modes || []).some((m) => modi[s.tipo]?.includes(m)))
        .filter((f) => (s.operatore === 'Trenitalia' ? f.stopId.startsWith('it-trenitalia') : true))
        .map((f) => ({ id: f.stopId, d: km(s, f) }))
        .filter((f) => f.d < 0.3)
        .sort((a, b) => a.d - b.d);
      if (vicine.length) ids = [vicine[0].id];
    }
    s.transitous = [...new Set(ids)].slice(0, 2);
  }
  return stazioni;
}

export async function sezioneTrasporti({ fetch: f, ora, log }) {
  const reg = registro();
  const anm = await reg.prova(
    { nome: 'GTFS ANM (metro L1, L6, L2 e funicolari)', ente: 'ANM / Comune di Napoli', url: 'https://www.anm.it/google/google-transit.zip', licenza: 'CC BY 4.0 (dataset del Comune di Napoli su dati.gov.it)', via: 'copia di Mobility Database (mdb-893)' },
    async () => {
      let buf;
      try {
        buf = await scarica(f, 'https://files.mobilitydatabase.org/mdb-893/latest.zip', { come: 'buffer', timeoutMs: 120_000 });
      } catch {
        buf = await scarica(f, 'https://www.anm.it/google/google-transit.zip', { come: 'buffer', timeoutMs: 120_000 });
      }
      return leggiZip(buf, ['routes.txt', 'stops.txt', 'trips.txt', 'stop_times.txt', 'shapes.txt', 'calendar.txt', 'calendar_dates.txt']);
    },
  );
  const eav = await reg.prova(
    { nome: 'GTFS EAV (Cumana, Circumflegrea, Circumvesuviana, Metrocampania)', ente: 'EAV srl', url: 'https://www.wimob.it/cfile/download.php?file=google-transit.zip', licenza: 'non indicata dal fornitore (citare EAV)', via: 'copia di Mobility Database (tld-4833)' },
    async () => {
      let buf;
      try {
        buf = await scarica(f, 'https://files.mobilitydatabase.org/tld-4833/latest.zip', { come: 'buffer', timeoutMs: 120_000 });
      } catch {
        buf = await scarica(f, 'https://www.wimob.it/cfile/download.php?file=google-transit.zip', { come: 'buffer', timeoutMs: 120_000 });
      }
      return leggiZip(buf, ['routes.txt', 'stops.txt', 'trips.txt', 'stop_times.txt', 'shapes.txt', 'calendar.txt', 'calendar_dates.txt']);
    },
  );
  if (!anm && !eav) throw new Error('nessun GTFS scaricato');
  const linee = [];
  const stazioni = [];
  let giorni = null;
  if (anm) {
    log('trasporti: riduco il GTFS ANM…');
    const r = riduciGtfs(anm, {
      prefisso: 'anm',
      tipi: [1, 7],
      ora,
      nomeLinea: (r) => ({ sigla: r.route_short_name, nome: nomeStazione(r.route_long_name || r.route_short_name).replace(/^Metro Linea (L\d)$/, 'Metro linea $1'), rete: r.route_type === '7' ? 'Funicolari' : 'Metropolitana' }),
      tipoLinea: (r) => (r.route_type === '7' ? 'funicolare' : 'metro'),
      operatore: (r) => (r.agency_id === 'FS' ? 'Trenitalia' : 'ANM'),
      colore: (r) => `#${(r.route_color || '888888').replace(/^#/, '')}`,
      tipoStazione: (sigle) => (sigle.every((s) => /^F\d/.test(s)) ? 'funicolare' : 'metro'),
      operatoreStazione: (sigle, linee) => (sigle.every((s) => linee.find((l) => l.sigla === s)?.operatore === 'Trenitalia') ? 'Trenitalia' : 'ANM'),
    });
    linee.push(...r.linee);
    stazioni.push(...r.stazioni);
    giorni = r.giorni;
  }
  if (eav) {
    log('trasporti: riduco il GTFS EAV…');
    const r = riduciGtfs(eav, {
      prefisso: 'eav',
      tipi: [2],
      ora,
      nomeLinea: (r, fermate) => {
        const rete = reteEav(r.route_long_name, fermate);
        return { sigla: rete, nome: r.route_long_name, rete };
      },
      tipoLinea: () => 'ferrovia',
      operatore: () => 'EAV',
      colore: (r, s) => COLORI_EAV[s.rete] || '#6b6b6b',
      tipoStazione: () => 'ferrovia',
      operatoreStazione: () => 'EAV',
    });
    // più linee EAV hanno la stessa rete (es. Circumvesuviana): i tratti uguali si fondono
    for (const l of r.linee) {
      const g = linee.find((x) => x.operatore === 'EAV' && x.sigla === l.sigla);
      if (g) {
        const visti = new Set(g.tratti.map((t) => JSON.stringify(t)));
        g.tratti.push(...l.tratti.filter((t) => !visti.has(JSON.stringify(t))));
        g.nome = g.sigla;
      } else linee.push({ ...l, nome: l.sigla });
    }
    stazioni.push(...r.stazioni);
    giorni ??= r.giorni;
  }
  const transitous = await reg.prova(
    { nome: 'Transitous: fermate (id per i prossimi passaggi)', ente: 'Transitous (comunità, MOTIS)', url: 'https://api.transitous.org/', licenza: 'servizio gratuito per progetti open source non commerciali; dati delle aziende di trasporto' },
    () => scarica(f, `https://api.transitous.org/api/v1/map/stops?min=${BOX.s},${BOX.o}&max=${BOX.n},${BOX.e}`, { timeoutMs: 60_000 }),
  );
  abbinaTransitous(stazioni, Array.isArray(transitous) ? transitous : []);
  for (const s of stazioni) delete s.fermate;
  const vicine = Object.fromEntries(ZONE.map((z) => [z, stazioniVicine(PUNTI[z], stazioni, { n: 4, maxKm: 1.2 }).map((s) => ({ id: s.id, m: s.m, piedi: s.piedi }))]));
  return {
    file: 'trasporti.json',
    dati: {
      meta: {
        descrizione: 'Linee su ferro (metro, funicolari, ferrovie EAV) e stazioni nel Comune di Napoli, con le corse programmate per ora; stazioni vicine ai luoghi della mappa.',
        giorniDiRiferimento: giorni,
        nota: 'Corse programmate (orario GTFS), non in tempo reale. La funicolare di Montesanto (F2) non è nel GTFS ANM. I prossimi passaggi si chiedono dal vivo a Transitous con gli id in `transitous`.',
        fonti: reg.fonti,
      },
      linee,
      stazioni,
      vicine,
    },
  };
}

// ------------------------------------------------------------------ qualità dell'aria (EEA / ARPAC)

const INQUINANTI = { 5: 'PM10', 8: 'NO2', 6001: 'PM2.5', 7: 'O3' };
/** Tipo delle stazioni dai metadati EEA (PanEuropean_metadata.csv, verificati per queste). */
const TIPI_STAZIONE = { IT0898A: 'traffico urbano', IT1491A: 'traffico urbano', IT1496A: 'traffico urbano', IT1497A: 'fondo urbano', IT2221A: 'industriale', IT2277A: 'fondo suburbano' };

/**
 * Riduce un Parquet orario dell'EEA alle ultime `ore` ore valide: [[ts, valore], ...].
 * Start ed End nei file sono in UTC+1 (fuso dichiarato nei metadati EEA): ts = fine dell'ora in UTC.
 */
export function serieDaParquet(buf, ore = 48) {
  const { colonne } = leggiParquet(buf, { colonne: ['End', 'Value', 'Validity'] });
  const serie = [];
  for (let i = 0; i < colonne.End.length; i++) {
    const v = colonne.Value[i];
    if (v == null || !(colonne.Validity[i] > 0) || v < 0) continue;
    serie.push([colonne.End[i] - 3_600_000, Math.round(v * 10) / 10]);
  }
  serie.sort((a, b) => a[0] - b[0]);
  const ultimo = serie.at(-1)?.[0] ?? 0;
  return serie.filter((p) => p[0] > ultimo - ore * 3_600_000);
}

export async function sezioneAria({ fetch: f, ora, log }) {
  const reg = registro();
  const anag = await reg.prova(
    { nome: 'Anagrafica delle stazioni di qualità dell\'aria', ente: 'European Environment Agency', url: 'https://air.discomap.eea.europa.eu/arcgis/rest/services/AirQuality/AirQualityDownloadServiceEUMonitoringStations/MapServer/0', licenza: 'riuso libero con citazione dell\'EEA' },
    async () => {
      const q = new URLSearchParams({ where: "CountryCode='IT'", geometry: '14.05,40.74,14.45,40.96', geometryType: 'esriGeometryEnvelope', inSR: '4326', spatialRel: 'esriSpatialRelIntersects', outFields: 'AirQualityStationEoICode,AQStationName', outSR: '4326', returnGeometry: 'true', f: 'json' });
      const j = await scarica(f, `https://air.discomap.eea.europa.eu/arcgis/rest/services/AirQuality/AirQualityDownloadServiceEUMonitoringStations/MapServer/0/query?${q}`);
      return Object.fromEntries((j.features || []).map((x) => [x.attributes.AirQualityStationEoICode, { nome: x.attributes.AQStationName, lat: r5(x.geometry.y), lon: r5(x.geometry.x) }]));
    },
  );
  const urls = await reg.prova(
    { nome: 'Dati orari aggiornati (E2a, non validati) delle centraline ARPAC dell\'area di Napoli', ente: 'EEA, dati trasmessi da ARPA Campania tramite ISPRA', url: 'https://eeadmz1-downloads-webapp.azurewebsites.net/', licenza: 'riuso libero con citazione dell\'EEA; dati E2a non validati' },
    async () => {
      const corpo = JSON.stringify({ countries: ['IT'], cities: ['Napoli (greater city)'], pollutants: ['PM10', 'NO2', 'PM2.5', 'O3'], dataset: 1, dateTimeStart: `${new Date(ora - 7 * 86_400_000).toISOString().slice(0, 10)}T00:00:00Z`, dateTimeEnd: `${new Date(ora).toISOString().slice(0, 19)}Z`, aggregationType: 'hour' });
      // (un intervallo che inizia nell'anno precedente restituisce una lista vuota)
      const csv = await scarica(f, 'https://eeadmz1-downloads-api-appservice.azurewebsites.net/ParquetFile/urls', { come: 'testo', metodo: 'POST', corpo, headers: { 'content-type': 'application/json' } });
      return csv.split(/\r?\n/).map((r) => r.replace(/^﻿/, '').trim()).filter((r) => /^https?:.*\.parquet$/.test(r));
    },
  );
  if (!urls?.length) throw new Error('nessun file Parquet dall\'EEA');
  log(`aria: ${urls.length} file Parquet da leggere…`);
  const stazioni = {};
  const errori = [];
  await aGruppi(urls, 6, async (u) => {
    const m = /SPO\.(IT\d+[A-Z])_(\d+)_/.exec(u);
    if (!m || !INQUINANTI[m[2]]) return;
    const [, id, cod] = m;
    try {
      const serie = serieDaParquet(await scarica(f, u, { come: 'buffer', timeoutMs: 90_000 }));
      if (!serie.length) return;
      const st = (stazioni[id] ??= { id, misure: {} });
      const inq = INQUINANTI[cod];
      const prima = st.misure[inq];
      // più punti di campionamento per lo stesso inquinante: vince il più aggiornato
      if (!prima || serie.at(-1)[0] > prima.ultimo.ts) st.misure[inq] = { unita: 'µg/m³', ultimo: { ts: serie.at(-1)[0], valore: serie.at(-1)[1] }, serie: serie.slice(-24) };
    } catch (err) {
      errori.push(`${id}/${INQUINANTI[cod]}: ${err.message}`);
    }
  });
  const lista = Object.values(stazioni)
    .map((s) => ({ ...s, nome: anag?.[s.id]?.nome ?? s.id, tipo: TIPI_STAZIONE[s.id] ?? null, lat: anag?.[s.id]?.lat ?? null, lon: anag?.[s.id]?.lon ?? null }))
    .filter((s) => s.lat != null)
    .sort((a, b) => a.id.localeCompare(b.id));
  const vicine = Object.fromEntries(
    ZONE.map((z) => {
      const v = lista.filter((s) => s.misure.NO2 || s.misure.PM10).map((s) => ({ id: s.id, km: Math.round(km(PUNTI[z], s) * 10) / 10 })).sort((a, b) => a.km - b.km)[0];
      return [z, v ?? null];
    }),
  );
  const ultimo = Math.max(0, ...lista.flatMap((s) => Object.values(s.misure).map((m) => m.ultimo.ts)));
  return {
    file: 'aria.json',
    dati: {
      meta: {
        descrizione: 'Ultime 24 ore di misure orarie (NO2, PM10, PM2.5, O3) delle centraline ARPAC dell\'area di Napoli, dal servizio di download dell\'EEA.',
        ultimoDato: ultimo || null,
        nota: 'Dati E2a "up-to-date": non validati, con qualche ora di ritardo. ts = fine dell\'ora di misura (UTC). Tipo della stazione noto solo per quelle verificate nei metadati EEA.',
        erroriParquet: errori.slice(0, 20),
        fonti: reg.fonti,
      },
      stazioni: lista,
      vicine,
    },
  };
}

// ------------------------------------------------------------------ eventi

// partiteDaOpenfootball (partite in casa del Napoli): in fonti/normalizza.js, la usa anche il browser

/** Calendario delle navi da crociera (RSS di cruisetimetables): [{ giorno, navi }]. */
export function crociereDaRss(xml) {
  const MESI = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
  const out = [];
  for (const [, item] of String(xml).matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const t = /<title>[^<]*on (\d{1,2}) (\w{3}) (\d{4})<\/title>/.exec(item);
    if (!t || !MESI[t[2]]) continue;
    const giorno = `${t[3]}-${String(MESI[t[2]]).padStart(2, '0')}-${t[1].padStart(2, '0')}`;
    const descr = decodificaEntita(/<description>([\s\S]*?)<\/description>/.exec(item)?.[1] || '');
    const navi = [...new Set([...descr.matchAll(/ on ([A-Z][^,(]+?)(?=\s*\(|,|$)/g)].map((m) => m[1].trim()))];
    if (navi.length) out.push({ giorno, navi });
  }
  return out.sort((a, b) => a.giorno.localeCompare(b.giorno));
}

/** Calendario America's Cup (schedule-ac38.json): giorni di regata a Napoli. */
export function regateDaAmericasCup(lista) {
  return (Array.isArray(lista) ? lista : [])
    .map((x) => {
      const giorno = String(x.time || '').slice(0, 10);
      const grezzo = decodificaEntita(/event-name">([^<]*)</.exec(x.short_text || '')?.[1] || "America's Cup");
      const evento = grezzo.split(/\s+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
      const tipo = String(x.title || '').trim();
      const riserva = /reserve/i.test(tipo);
      const nomi = { 'Fleet race': 'regate di flotta', 'Match race': 'match race', 'Reserve day': 'giorno di riserva' };
      return { giorno, titolo: `${evento} · ${nomi[tipo] || tipo}`, evento, riserva, zona: 'lungomare', fonte: 'americascup', nota: 'regate nel Golfo, campo davanti al Lungomare Caracciolo' };
    })
    .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.giorno))
    .sort((a, b) => a.giorno.localeCompare(b.giorno));
}

export async function sezioneEventi({ fetch: f, ora, precedente }) {
  const reg = registro(precedente);
  const vecchi = (chiave, filtro = () => true) => (p) => (Array.isArray(p?.[chiave]) && p[chiave].some(filtro) ? p[chiave].filter(filtro) : null);
  const oggi = giornoLocale(ora);
  const comune = await reg.prova(
    { nome: 'Eventi del Comune di Napoli', ente: 'Comune di Napoli', url: 'https://www.comune.napoli.it/wp-json/api/v1/news', licenza: 'CC BY 4.0 (note legali del sito); immagini escluse', nota: 'API del sito: solo i 10 eventi correnti, senza coordinate (luogo abbinato con parole chiave); orari locali codificati come UTC' },
    async () => (await scarica(f, 'https://www.comune.napoli.it/wp-json/api/v1/news', { headers: { 'user-agent': UA_BROWSER } })).data.map((e) => eventoComune(e, LUOGHI)).filter((e) => e.titolo),
    { riserva: vecchi('comune', (e) => (e.fine ?? e.inizio) >= ora) },
  );
  const partite = await reg.prova(
    { nome: 'Calendario Serie A 2026/27 (partite in casa del Napoli)', ente: 'openfootball', url: 'https://github.com/openfootball/football.json', licenza: 'CC0 1.0 (pubblico dominio)' },
    async () => partiteDaOpenfootball(await scarica(f, 'https://raw.githubusercontent.com/openfootball/football.json/master/2026-27/it.1.json')),
    { riserva: vecchi('partite', (p) => p.fonte === 'openfootball') },
  );
  const prossima = await reg.prova(
    { nome: 'Prossima partita del Napoli (anche coppe)', ente: 'TheSportsDB', url: 'https://www.thesportsdb.com/api/v1/json/123/eventsnext.php?id=133670', licenza: 'termini TheSportsDB (chiave pubblica di prova, citare la fonte)' },
    async () => (await scarica(f, 'https://www.thesportsdb.com/api/v1/json/123/eventsnext.php?id=133670')).events || [],
    // le partite di coppa già salvate restano (e non vanno riconvertite: si aggiungono sotto)
    { riserva: (p) => ((p?.partite || []).some((x) => x.fonte === 'thesportsdb') ? [] : null) },
  );
  const coppePrecedenti = reg.fonti.at(-1)?.stato === 'precedente' ? (precedente.partite || []).filter((x) => x.fonte === 'thesportsdb') : [];
  for (const e of prossima || []) {
    if (!/maradona/i.test(e.strVenue || '') || !e.dateEvent) continue;
    const t = e.strTime ? Date.parse(`${e.dateEvent}T${e.strTime}Z`) : null;
    const giorno = t ? giornoLocale(t) : e.dateEvent;
    if ((partite ||= []).some((p) => p.giorno === giorno)) continue;
    const p = t ? partiLocali(t) : null;
    partite.push({ giorno, ora: p ? `${String(p.ora).padStart(2, '0')}:${String(p.minuto).padStart(2, '0')}` : null, casa: 'Napoli', ospite: e.strAwayTeam, competizione: e.strLeague || 'Calcio', fonte: 'thesportsdb' });
  }
  for (const c of coppePrecedenti) if (!(partite ||= []).some((p) => p.giorno === c.giorno)) partite.push(c);
  const crociere = await reg.prova(
    { nome: 'Calendario degli scali delle navi da crociera a Napoli', ente: 'Cruise Timetables (fonte privata, non ufficiale)', url: 'https://www.cruisetimetables.com/cruises-to-naples-italy.html', licenza: 'proprietaria: citata come fonte in una demo non commerciale', nota: 'l\'Autorità portuale non pubblica un calendario aperto degli accosti' },
    async () => crociereDaRss(await scarica(f, 'https://www.cruisetimetables.com/cruises-to-naples-italy.xml', { come: 'testo', headers: { 'user-agent': UA_BROWSER } })),
    { riserva: vecchi('crociere') },
  );
  const regate = await reg.prova(
    { nome: "Calendario America's Cup 2027 (Napoli)", ente: "America's Cup Event", url: 'https://www.americascup.com/json/schedule-ac38.json', licenza: 'contenuto del sito ufficiale, senza licenza dichiarata: citato come fonte', nota: 'orari 12:00-14:00 uniformi (segnaposto): si usano solo i giorni' },
    async () => regateDaAmericasCup(await scarica(f, 'https://www.americascup.com/json/schedule-ac38.json', { headers: { 'user-agent': UA_BROWSER } })),
    { riserva: vecchi('speciali') },
  );
  if (!comune && !partite && !crociere && !regate) throw new Error('nessuna fonte di eventi raggiungibile');
  const fino = giornoLocale(ora + 200 * 86_400_000);
  return {
    file: 'eventi.json',
    dati: {
      meta: {
        descrizione: "Eventi reali che spostano persone: partite in casa al Maradona, navi da crociera in porto, eventi del Comune, giorni di regata dell'America's Cup 2027.",
        nota: 'Quali eventi "spostano folla" e di quanto è un\'ipotesi dichiarata (vedi effects evento_* in sim-config.json).',
        fonti: reg.fonti,
      },
      partite: (partite || []).filter((p) => p.giorno >= giornoLocale(ora - 30 * 86_400_000)),
      crociere: (crociere || []).filter((c) => c.giorno >= oggi && c.giorno <= fino),
      comune: comune || [],
      speciali: regate || [],
    },
  };
}

// ------------------------------------------------------------------ riferimenti (dati statici reali)

/** Siti comunali con visitatori mensili (CKAN del Comune) e zona della mappa. */
const SITI = [
  { dataset: 'numero-visitatori-di-castel-nuovo-maschio-angioino', nome: 'Castel Nuovo · Maschio Angioino', zona: 'beverello' },
  { dataset: 'numero-visitatori-del-castel-dell-ovo', nome: "Castel dell'Ovo", zona: 'castel_ovo', anniExtra: ['2019'] },
  { dataset: 'numero-visitatori-di-san-domenico-maggiore', nome: 'Complesso di San Domenico Maggiore', zona: 'centro_storico' },
  { dataset: 'numero-visitatori-di-san-severo-al-pendino', nome: 'San Severo al Pendino', zona: 'centro_storico' },
  { dataset: 'numero-dei-visitatori-della-casina-pompeiana', nome: 'Casina Pompeiana (Villa Comunale)', zona: 'lungomare' },
  { dataset: 'numero-visitatori-al-complesso-archeologico-del-pausilypon', nome: 'Parco archeologico del Pausilypon', zona: 'mergellina' },
  { dataset: 'numero-visitatori-della-ex-real-casa-dell-annunziata', nome: "Real Casa dell'Annunziata", zona: 'garibaldi' },
  { dataset: 'numero-visitatori-del-palazzo-delle-arti-napoli-pan', nome: 'PAN · Palazzo delle Arti', zona: 'lungomare' },
];
const NOMI_MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];

/** CSV dei visitatori (MESE;ANNO;Nro VISITATORI;Nota) → { anno, mesi: [12 numeri|null], totale, note }. */
export function visitatoriDaCsv(testo) {
  const sep = (testo.split(/\r?\n/)[0].match(/;/g) || []).length >= 2 ? ';' : ',';
  const righe = leggiCsv(testo, { separatore: sep });
  const mesi = Array(12).fill(null);
  const note = new Set();
  let anno = null;
  for (const r of righe) {
    const k = Object.keys(r);
    const mese = NOMI_MESI.indexOf(piatto(r[k[0]]));
    if (mese < 0) continue;
    anno ??= Number(r[k[1]]) || null;
    const v = Number(String(r[k[2]] ?? '').replace(/\./g, '').replace(',', '.'));
    mesi[mese] = Number.isFinite(v) ? v : null;
    const n = String(r[k[3]] ?? '').trim();
    if (n.length >= 3) note.add(n.toLowerCase());
  }
  const validi = mesi.filter((v) => v != null);
  return { anno, mesi, totale: validi.length ? validi.reduce((a, b) => a + b, 0) : null, note: [...note] };
}

/** SDMX-CSV ISTAT (movimento turistico mensile, provincia) → { anno, mesi: { 1: { arrivi, presenze, stranieri } }, mediaArrivi }. */
export function stagionalitaDaIstat(csvTesto) {
  const righe = leggiCsv(csvTesto);
  const mesi = {};
  let anno = null;
  for (const r of righe) {
    if (r.TYPE_ACCOMMODATION && r.TYPE_ACCOMMODATION !== 'ALL') continue;
    const m = /^(\d{4})-(\d{2})$/.exec(r.TIME_PERIOD || '');
    if (!m) continue;
    const a = +m[1];
    if (anno != null && a < anno) continue;
    if (anno == null || a > anno) {
      anno = a;
      for (const k of Object.keys(mesi)) delete mesi[k];
    }
    const x = (mesi[+m[2]] ??= {});
    const v = Number(r.OBS_VALUE);
    if (r.DATA_TYPE === 'AR' && r.COUNTRY_RES_GUESTS === 'WORLD') x.arrivi = v;
    if (r.DATA_TYPE === 'NI' && r.COUNTRY_RES_GUESTS === 'WORLD') x.presenze = v;
    if (r.DATA_TYPE === 'AR' && r.COUNTRY_RES_GUESTS === 'WRL_X_ITA') x.stranieri = v;
  }
  const arr = Object.values(mesi).map((m) => m.arrivi).filter(Number.isFinite);
  return { anno, mesi, mediaArrivi: arr.length === 12 ? Math.round(arr.reduce((a, b) => a + b, 0) / 12) : null };
}

export async function sezioneRiferimenti({ fetch: f, ora, log, precedente }) {
  const reg = registro(precedente);
  const perZona = Object.fromEntries(ZONE.map((z) => [z, []]));
  const aggiungi = (zona, voce) => zona && perZona[zona]?.push(voce);
  /** Riserva: rimette in `perZona` le voci del file precedente scelte da `filtro` (true se ce n'erano). */
  const rimetti = (filtro) => (p) => {
    const voci = vociPrecedenti(p, filtro);
    for (const [z, v] of voci) aggiungi(z, v);
    return voci.length ? true : null;
  };

  const pacchetti = await reg.prova(
    { nome: 'Visitatori mensili dei siti culturali comunali', ente: 'Comune di Napoli (dati.comune.napoli.it)', url: 'https://dati.comune.napoli.it/dataset?q=visitatori', licenza: 'CC BY 4.0', nota: 'server lento (10-60 s a richiesta)' },
    async () => (await scarica(f, 'https://dati.comune.napoli.it/api/3/action/package_search?q=visitatori&rows=20', { timeoutMs: 120_000 })).result.results,
    { riserva: rimetti((v) => v.tipo === 'visitatori' && /^Comune di Napoli/.test(v.fonte || '')) },
  );
  if (Array.isArray(pacchetti)) {
    log('riferimenti: visitatori dei siti comunali…');
    await aGruppi(SITI, 4, async (sito) => {
      const p = pacchetti.find((x) => x.name === sito.dataset);
      if (!p) return;
      const perAnno = (a) => p.resources.find((r) => r.name.includes(a) || r.url.includes(`_${a}`));
      const anni = [...new Set(p.resources.map((r) => /(20\d\d)/.exec(`${r.name} ${r.url}`)?.[1]).filter(Boolean))].sort();
      const ultimo = anni.at(-1);
      for (const anno of [ultimo, ...(sito.anniExtra || [])]) {
        const r = perAnno(anno);
        if (!r) continue;
        try {
          const v = visitatoriDaCsv(await scarica(f, r.url, { come: 'testo', timeoutMs: 120_000 }));
          const chiuso = v.totale === 0 || v.note.some((n) => n.includes('lavori'));
          aggiungi(sito.zona, {
            tipo: 'visitatori',
            etichetta: sito.nome,
            anno: v.anno ?? Number(anno),
            totale: v.totale,
            mesi: v.mesi,
            nota: chiuso ? (v.note.some((n) => n.includes('lavori')) ? 'chiuso per lavori' : 'chiuso') : v.note.length ? `note: ${v.note.join(', ')}` : null,
            chiuso,
            fonte: 'Comune di Napoli, CC BY 4.0',
            url: `https://dati.comune.napoli.it/dataset/${sito.dataset}`,
          });
        } catch (err) {
          log(`riferimenti: ${sito.nome} ${anno}: ${err.message}`);
        }
      }
    });
  }

  const stagionalita = await reg.prova(
    { nome: 'Arrivi e presenze turistiche mensili, provincia di Napoli', ente: 'ISTAT (esploradati, SDMX)', url: 'https://esploradati.istat.it/databrowser/', licenza: 'CC BY 4.0' },
    async () =>
      stagionalitaDaIstat(
        await scarica(f, `https://esploradati.istat.it/SDMXWS/rest/data/IT1,122_54_DF_DCSC_TUR_3,1.0/M.ITF33.........?startPeriod=${partiLocali(ora).anno - 1}-01`, {
          come: 'testo',
          timeoutMs: 120_000,
          tentativi: 3,
          // senza Accept-Language esplicito (fetch di Node manda "*") il server ISTAT risponde 500 "languageTag1"
          headers: { accept: 'application/vnd.sdmx.data+csv;version=1.0.0', 'accept-language': 'it' },
        }),
      ),
    { riserva: (p) => p?.stagionalita ?? null },
  );

  await reg.prova(
    { nome: 'Visitatori annui di musei e monumenti (Wikidata, proprietà P1174)', ente: 'Wikidata', url: 'https://query.wikidata.org/', licenza: 'CC0 1.0', nota: 'fonti eterogenee: valore più recente per luogo' },
    async () => {
      const q = `SELECT ?item ?itemLabel ?coord ?visitors ?time WHERE { ?item wdt:P131 wd:Q2634; wdt:P625 ?coord; p:P1174 ?st. ?st ps:P1174 ?visitors. OPTIONAL{?st pq:P585 ?time} SERVICE wikibase:label { bd:serviceParam wikibase:language "it,en". } }`;
      const j = await scarica(f, `https://query.wikidata.org/sparql?query=${encodeURIComponent(q)}`, { headers: { accept: 'application/sparql-results+json' }, timeoutMs: 90_000 });
      const migliori = new Map();
      for (const b of j.results.bindings) {
        const m = /Point\(([-\d.]+) ([-\d.]+)\)/.exec(b.coord?.value || '');
        if (!m) continue;
        const anno = b.time ? Number(b.time.value.slice(0, 4)) : 0;
        const v = Number(b.visitors.value);
        const prima = migliori.get(b.item.value);
        if (!prima || anno > prima.anno) migliori.set(b.item.value, { nome: b.itemLabel.value, lat: +m[2], lon: +m[1], anno, v, id: b.item.value.split('/').pop() });
      }
      const perZ = {};
      for (const x of [...migliori.values()].sort((a, b) => b.v - a.v)) {
        if (x.v < 20_000 || !x.anno || /bibliotec/i.test(x.nome)) continue; // biblioteche e piccoli siti: poco utili per la folla
        const z = ZONE.map((zz) => [zz, km(PUNTI[zz], x)]).sort((a, b) => a[1] - b[1])[0];
        if (z[1] > 1.0 || (perZ[z[0]] = (perZ[z[0]] || 0) + 1) > 3) continue;
        aggiungi(z[0], { tipo: 'visitatori', etichetta: x.nome.charAt(0).toUpperCase() + x.nome.slice(1), anno: x.anno, totale: x.v, fonte: 'Wikidata, CC0', url: `https://www.wikidata.org/wiki/${x.id}` });
      }
    },
    { riserva: rimetti((v) => /^Wikidata/.test(v.fonte || '')) },
  );

  await reg.prova(
    { nome: 'Annunci di affitti brevi (densità di turisti che dormono in zona)', ente: 'Inside Airbnb', url: 'https://insideairbnb.com/get-the-data/', licenza: 'CC BY 4.0', nota: 'istantanea del 19/09/2026; solo conteggi, nessun dato personale' },
    async () => {
      const testo = await scarica(f, 'https://data.insideairbnb.com/italy/campania/naples/2026-09-19/visualisations/listings.csv', { come: 'testo', timeoutMs: 120_000 });
      const conta = Object.fromEntries(ZONE.map((z) => [z, 0]));
      perRiga(testo, ['latitude', 'longitude'], ([la, lo]) => {
        const p = { lat: +la, lon: +lo };
        if (!Number.isFinite(p.lat)) return;
        for (const z of ZONE) if (km(PUNTI[z], p) <= 0.6) conta[z]++;
      });
      for (const z of ZONE) aggiungi(z, { tipo: 'airbnb', etichetta: 'Annunci di affitti brevi entro 600 m', totale: conta[z], anno: 2026, fonte: 'Inside Airbnb, CC BY 4.0', url: 'https://insideairbnb.com/naples/' });
    },
    { riserva: rimetti((v) => v.tipo === 'airbnb') },
  );

  await reg.prova(
    { nome: 'Acque di balneazione: classe di qualità 2025 per sito', ente: 'EEA (dati del Ministero della Salute e di ARPAC)', url: 'https://water.discomap.eea.europa.eu/arcgis/rest/services/BathingWater/BathingWater_Dyna_WM_2025/MapServer/3', licenza: 'riuso libero con citazione dell\'EEA' },
    async () => {
      const q = new URLSearchParams({ where: "bathingWaterIdentifier LIKE 'IT015063049%'", outFields: 'bathingWaterIdentifier,bathingWaterName,latitude,longitude,qualityStatus,qualityStatus_minus1', returnGeometry: 'false', f: 'json' });
      const j = await scarica(f, `https://water.discomap.eea.europa.eu/arcgis/rest/services/BathingWater/BathingWater_Dyna_WM_2025/MapServer/3/query?${q}`);
      const CLASSI = { Excellent: 'eccellente', Good: 'buona', Sufficient: 'sufficiente', Poor: 'scarsa' };
      for (const { attributes: a } of j.features || []) {
        const p = { lat: a.latitude, lon: a.longitude };
        const z = ZONE.map((zz) => [zz, km(PUNTI[zz], p)]).sort((x, y) => x[1] - y[1])[0];
        if (z[1] > 1.2) continue;
        aggiungi(z[0], { tipo: 'mare', etichetta: `Acqua di balneazione · ${nomeStazione(a.bathingWaterName)}`, valore: CLASSI[a.qualityStatus] || a.qualityStatus, anno: 2025, nota: a.qualityStatus_minus1 ? `2024: ${CLASSI[a.qualityStatus_minus1] || a.qualityStatus_minus1}` : null, fonte: 'EEA', url: 'https://www.eea.europa.eu/en/topics/in-depth/bathing-water' });
      }
    },
    { riserva: rimetti((v) => v.tipo === 'mare') },
  );

  // Porto: valori trascritti dai bollettini PDF dell'Autorità di Sistema Portuale (contenuti riservati:
  // si citano pochi valori aggregati, senza ripubblicare il documento).
  aggiungi('beverello', { tipo: 'porto', etichetta: 'Passeggeri del golfo (aliscafi e traghetti locali)', totale: 6_654_994, anno: 2025, nota: 'circa 18.200 al giorno in media', fonte: 'AdSP Mar Tirreno Centrale, bollettino 12 mesi 2025 (valore citato)', url: 'https://adsptirrenocentrale.it/statistiche/bollettino-dati-statistici/' });
  aggiungi('beverello', { tipo: 'porto', etichetta: 'Crocieristi nel porto di Napoli', totale: 1_829_254, anno: 2025, nota: '1.566.289 in transito; gennaio-giugno 2026: 615.248 (−10,4 %)', fonte: 'AdSP Mar Tirreno Centrale, bollettini 2025-2026 (valori citati)', url: 'https://adsptirrenocentrale.it/statistiche/bollettino-dati-statistici/' });
  reg.fonti.push({ nome: 'Statistiche del porto (crocieristi, passeggeri del golfo)', ente: 'Autorità di Sistema Portuale del Mar Tirreno Centrale', url: 'https://adsptirrenocentrale.it/statistiche/bollettino-dati-statistici/', licenza: 'contenuti riservati: valori aggregati citati, non ripubblicati', stato: 'trascritto', nota: 'bollettini PDF verificati il 14/11/2026' });

  for (const z of ZONE) perZona[z].sort((a, b) => ({ visitatori: 0, porto: 1, mare: 2, airbnb: 3 })[a.tipo] - ({ visitatori: 0, porto: 1, mare: 2, airbnb: 3 })[b.tipo] || (b.totale ?? 0) - (a.totale ?? 0));
  return {
    file: 'riferimenti.json',
    dati: {
      meta: {
        descrizione: "Dati statici reali che danno la scala dell'affollamento stimato: visitatori dei siti, flussi del porto, stagionalità turistica, densità di affitti brevi, qualità del mare.",
        fonti: reg.fonti,
      },
      perZona,
      stagionalita: stagionalita ?? null,
    },
  };
}

// ------------------------------------------------------------------ meteo, allerte, aria (riserva delle fonti live)

export async function sezioneMeteo({ fetch: f, ora, precedente }) {
  const reg = registro(precedente);
  const vecchio = (chiave) => (p) => (p?.[chiave] && Object.keys(p[chiave]).length ? p[chiave] : null);
  const lat = ZONE.map((z) => LUOGHI[z].lat).join(',');
  const lon = ZONE.map((z) => LUOGHI[z].lon).join(',');
  const meteo = await reg.prova(
    { nome: 'Meteo attuale per luogo (modello ICON-2I, 2,2 km)', ente: 'Open-Meteo.com (ItaliaMeteo-ARPAE)', url: 'https://open-meteo.com/', licenza: 'CC BY 4.0' },
    async () =>
      meteoDaOpenMeteo(
        await scarica(f, `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_gusts_10m,is_day&models=italia_meteo_arpae_icon_2i&timezone=Europe%2FRome`),
        ZONE,
      ),
    { riserva: vecchio('meteo') },
  );
  const aria = await reg.prova(
    { nome: "Indice europeo della qualità dell'aria (modello CAMS)", ente: 'Open-Meteo.com su dati Copernicus CAMS', url: 'https://open-meteo.com/en/docs/air-quality-api', licenza: 'CC BY 4.0 (dati Copernicus)' },
    async () =>
      ariaDaOpenMeteo(
        await scarica(f, `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&current=european_aqi,pm10,pm2_5,nitrogen_dioxide,ozone&domains=cams_europe&timezone=Europe%2FRome`),
        ZONE,
      ),
    { riserva: vecchio('aria') },
  );
  const CF = 'https://centrofunzionale.regione.campania.it/CentroFunzionalePortaleRest/rest/bollettinometeo';
  const allerta = await reg.prova(
    { nome: 'Allerta meteo regionale (Zona 1, Napoli)', ente: 'Protezione Civile Regione Campania, Centro Funzionale', url: 'https://centrofunzionale.regione.campania.it/', licenza: '© Protezione Civile Regione Campania: citata come fonte' },
    async () => {
      const ultima = await scarica(f, `${CF}/findLastAllertaNew`);
      const zona = ultima?.idBollettino ? await scarica(f, `${CF}/findByIdZona/1/${ultima.idBollettino}`).catch(() => null) : null;
      const domani = await scarica(f, `${CF}/findAllertaDomaniNew`).catch(() => null);
      return { ultima, zona, domani, normalizzata: allertaDaCentroFunzionale(ultima, zona, domani, ora) };
    },
    // dal file precedente si riprende il grezzo, così "scaduta" si ricalcola sull'ora di adesso
    { riserva: (p) => (p?.allerta?.grezzo ? { ...p.allerta.grezzo, normalizzata: allertaDaCentroFunzionale(p.allerta.grezzo.ultima, p.allerta.grezzo.zona, p.allerta.grezzo.domani, ora) } : null) },
  );
  const meteoalarm = await reg.prova(
    { nome: 'Avvisi Meteoalarm per la Campania', ente: 'EUMETNET Meteoalarm (dati dell\'Aeronautica Militare)', url: 'https://meteoalarm.org/', licenza: 'riuso con attribuzione a Meteoalarm/EUMETNET', nota: 'senza CORS: solo da snapshot' },
    async () => meteoalarmCampania(await scarica(f, 'https://feeds.meteoalarm.org/api/v1/warnings/feeds-italy', { timeoutMs: 90_000 }), ora),
    { riserva: (p) => (p?.meteoalarm || []).filter((w) => w.fine > ora) },
  );
  const terremoti = await reg.prova(
    { nome: 'Terremoti dei Campi Flegrei (ultimi 30 giorni)', ente: 'INGV', url: 'https://terremoti.ingv.it/', licenza: 'CC BY 4.0' },
    async () => {
      const da = new Date(ora - 30 * 86_400_000).toISOString().slice(0, 19);
      return terremotiIngv(await scarica(f, `https://webservices.ingv.it/fdsnws/event/1/query?starttime=${da}&minlat=40.75&maxlat=40.90&minlon=14.00&maxlon=14.25&minmag=0&format=geojson&orderby=time&limit=50`)).slice(0, 20);
    },
    { riserva: (p) => (p?.terremoti?.length ? p.terremoti : null) },
  );
  if (!meteo && !aria && !allerta && !meteoalarm) throw new Error('nessuna fonte meteo raggiungibile');
  return {
    file: 'meteo.json',
    dati: {
      meta: {
        descrizione: 'Ultimo meteo, indice dell\'aria, allerte e terremoti salvati: la pagina li usa solo se le fonti live non rispondono (lo dichiara).',
        fonti: reg.fonti,
      },
      meteo: meteo || {},
      aria: aria || {},
      allerta: allerta ? { ...allerta.normalizzata, grezzo: { ultima: allerta.ultima, zona: allerta.zona, domani: allerta.domani } } : null,
      meteoalarm: meteoalarm || [],
      terremoti: terremoti || [],
    },
  };
}

// ------------------------------------------------------------------ orchestrazione

export const SEZIONI = { trasporti: sezioneTrasporti, aria: sezioneAria, eventi: sezioneEventi, riferimenti: sezioneRiferimenti, meteo: sezioneMeteo };

/**
 * Rigenera gli snapshot.
 * @param {{fetch?: Function, ora?: number, solo?: string[], out?: URL|string, scrivi?: boolean, log?: Function}} [opts]
 * @returns {Promise<{scritti: string[], errori: {sezione: string, errore: string}[], risultati: Record<string, object>}>}
 */
export async function aggiornaDati(opts = {}) {
  const f = opts.fetch ?? globalThis.fetch;
  const ora = opts.ora ?? Date.now();
  const log = opts.log ?? (() => {});
  const out = opts.out ? new URL(String(opts.out).endsWith('/') ? String(opts.out) : `${opts.out}/`, `file://${process.cwd()}/`) : CARTELLA;
  const scrivi = opts.scrivi !== false;
  const nomi = opts.solo?.length ? opts.solo : Object.keys(SEZIONI);
  const scritti = [];
  const errori = [];
  const risultati = {};
  if (scrivi) await mkdir(out, { recursive: true });
  for (const nome of nomi) {
    const fn = SEZIONI[nome];
    if (!fn) {
      errori.push({ sezione: nome, errore: `sezione sconosciuta (disponibili: ${Object.keys(SEZIONI).join(', ')})` });
      continue;
    }
    const t0 = Date.now();
    log(`${nome}: inizio`);
    try {
      // lo snapshot già presente: le sezioni ne riusano le parti delle fonti che ora non rispondono
      const precedente = await readFile(new URL(`${nome}.json`, out), 'utf8')
        .then(JSON.parse)
        .catch(() => null);
      const { file, dati } = await fn({ fetch: f, ora, log, precedente });
      // nessuna fonte ha risposto (solo dati del file precedente): il file resta com'era, data compresa
      if (dati.meta?.fonti?.length && !dati.meta.fonti.some((x) => x.stato === 'ok')) {
        throw new Error(`nessuna fonte raggiungibile (${dati.meta.fonti.filter((x) => x.errore).map((x) => x.errore).slice(0, 2).join('; ')})`);
      }
      dati.meta = { generato: new Date(ora).toISOString(), script: 'citta-api/strumenti/aggiorna-dati-napoli.js', ...dati.meta };
      risultati[nome] = dati;
      if (scrivi) {
        await writeFile(new URL(file, out), `${JSON.stringify(dati)}\n`);
        scritti.push(file);
      }
      const ko = dati.meta.fonti?.filter((x) => x.stato === 'errore').length ?? 0;
      const vecchie = dati.meta.fonti?.filter((x) => x.stato === 'precedente').map((x) => x.nome) ?? [];
      log(
        `${nome}: scritto ${file} in ${((Date.now() - t0) / 1000).toFixed(1)} s${ko ? ` (${ko} fonti in errore)` : ''}` +
          (vecchie.length ? ` (dati del file precedente per: ${vecchie.join('; ')})` : ''),
      );
    } catch (err) {
      errori.push({ sezione: nome, errore: String(err?.message || err) });
      log(`${nome}: NON aggiornato (resta lo snapshot precedente): ${err?.message || err}`);
    }
  }
  if (scrivi) {
    // indice: data e fonti di ogni snapshot presente nella cartella
    const indice = { generato: new Date(ora).toISOString(), file: {} };
    for (const nome of Object.keys(SEZIONI)) {
      const file = `${nome}.json`;
      try {
        const d = risultati[nome] ?? JSON.parse(await readFile(new URL(file, out), 'utf8'));
        indice.file[file] = { generato: d.meta.generato, fonti: (d.meta.fonti || []).map(({ nome: n, ente, licenza, stato, url }) => ({ nome: n, ente, licenza, stato, url })) };
      } catch {
        /* snapshot mai generato */
      }
    }
    await writeFile(new URL('indice.json', out), `${JSON.stringify(indice, null, 1)}\n`);
    scritti.push('indice.json');
  }
  return { scritti, errori, risultati };
}

// ------------------------------------------------------------------ riga di comando

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const arg = (n) => {
    const i = process.argv.indexOf(n);
    return i > 0 ? process.argv[i + 1] : undefined;
  };
  const solo = arg('--solo')?.split(',').map((s) => s.trim()).filter(Boolean);
  const t0 = Date.now();
  const conCurl = process.argv.includes('--curl');
  const { scritti, errori } = await aggiornaDati({ solo, out: arg('--out'), fetch: conCurl ? fetchConCurl : undefined, log: (m) => console.log(`[dati] ${m}`) });
  console.log(`[dati] fatto in ${((Date.now() - t0) / 1000).toFixed(0)} s: ${scritti.join(', ') || 'nessun file'}`);
  for (const e of errori) console.error(`[dati] ERRORE ${e.sezione}: ${e.errore}`);
  process.exitCode = errori.length ? 1 : 0;
}
