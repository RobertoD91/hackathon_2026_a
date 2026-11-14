// Caricamento delle fonti dati reali di Napoli, isomorfo (browser e Node):
// - fonti con CORS aperto lette dal vivo con timeout, cache (memoria + localStorage nel browser)
//   e riserva dichiarata (altra fonte o snapshot in ../dati/);
// - snapshot statici (../dati/*.json, rigenerati da tools/aggiorna-dati-napoli.js) letti con
//   fetch nel browser e dal disco in Node (process.getBuiltinModule: niente import di node:*).
//
// Ogni funzione restituisce { dati, fonte } dove `fonte` dice SEMPRE da dove arriva il dato:
//   { id, nome, url, licenza, tipo, ts, nota } con tipo:
//   'live' | 'cache' (dal vivo), 'riserva' (altra fonte live), 'salvato' (ultimo dato dello snapshot al
//   posto di una fonte live giù), 'snapshot' (dato statico per natura), 'programmato' (orari GTFS), 'assente'
// `ts` è l'istante del dato (misura o previsione), non quello della richiesta.

import * as N from './normalizza.js';
import { LUOGHI } from '../luoghi.js';

const CARTELLA_DATI = new URL('../dati/', import.meta.url);
const ZONE = Object.keys(LUOGHI);
const LAT = ZONE.map((z) => LUOGHI[z].lat).join(',');
const LON = ZONE.map((z) => LUOGHI[z].lon).join(',');

/** Catalogo delle fonti (attribuzioni e licenze mostrate in pagina). */
export const FONTI = Object.freeze({
  openMeteo: { nome: 'Open-Meteo (modello ICON-2I di ItaliaMeteo-ARPAE)', url: 'https://open-meteo.com/', licenza: 'CC BY 4.0' },
  openMeteoBase: { nome: 'Open-Meteo (modello predefinito)', url: 'https://open-meteo.com/', licenza: 'CC BY 4.0' },
  metNo: { nome: 'MET Norway Locationforecast', url: 'https://api.met.no/', licenza: 'CC BY 4.0' },
  cams: { nome: 'Open-Meteo Air Quality (Copernicus CAMS)', url: 'https://open-meteo.com/en/docs/air-quality-api', licenza: 'CC BY 4.0, dati Copernicus' },
  centraline: { nome: 'Centraline ARPAC via EEA (dati orari non validati)', url: 'https://eeadmz1-downloads-webapp.azurewebsites.net/', licenza: 'riuso con citazione EEA' },
  allerta: { nome: 'Protezione Civile Regione Campania, Centro Funzionale', url: 'https://centrofunzionale.regione.campania.it/', licenza: '© Regione Campania, citata come fonte' },
  meteoalarm: { nome: 'Meteoalarm (EUMETNET)', url: 'https://meteoalarm.org/', licenza: 'attribuzione a Meteoalarm' },
  ingv: { nome: 'INGV, terremoti', url: 'https://terremoti.ingv.it/', licenza: 'CC BY 4.0' },
  gtfs: { nome: 'GTFS ANM ed EAV (orari programmati)', url: 'https://mobilitydatabase.org/', licenza: 'ANM: CC BY 4.0 (Comune di Napoli); EAV: citata' },
  transitous: { nome: 'Transitous (prossimi passaggi)', url: 'https://transitous.org/sources/', licenza: 'servizio comunitario per progetti open source non commerciali' },
  eav: { nome: 'EAV, infomobilità', url: 'https://www.eavsrl.it/', licenza: 'contenuti del sito EAV, citati' },
  aspi: { nome: "Autostrade per l'Italia, viabilità", url: 'https://viabilita.autostrade.it/', licenza: '© Autostrade per l\'Italia: dato di contesto citato' },
  eventi: { nome: 'Comune di Napoli, openfootball, Cruise Timetables, America\'s Cup', url: 'https://www.comune.napoli.it/', licenza: 'Comune: CC BY 4.0; openfootball: CC0; altre citate' },
  openfootball: { nome: 'openfootball (calendario Serie A)', url: 'https://github.com/openfootball/football.json', licenza: 'CC0 1.0' },
  riferimenti: { nome: 'Comune di Napoli, ISTAT, Wikidata, Inside Airbnb, EEA, AdSP', url: 'https://dati.comune.napoli.it/', licenza: 'CC BY 4.0 / CC0 / citate' },
});

// ------------------------------------------------------------------ cache e richieste

const memoria = new Map(); // chiave → { ts, valore }
const inVolo = new Map(); // chiave → Promise
const PREFISSO = 'napoli-fonti:';

function store() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

function leggiCache(chiave, ttlMs, ora) {
  const m = memoria.get(chiave);
  if (m && ora - m.ts < ttlMs) return m;
  try {
    const raw = store()?.getItem(PREFISSO + chiave);
    if (raw) {
      const v = JSON.parse(raw);
      if (v && ora - v.ts < ttlMs) {
        memoria.set(chiave, v);
        return v;
      }
    }
  } catch {
    /* localStorage pieno, disattivato o in una finestra privata: solo memoria */
  }
  return null;
}

function scriviCache(chiave, valore, ora) {
  const v = { ts: ora, valore };
  memoria.set(chiave, v);
  try {
    store()?.setItem(PREFISSO + chiave, JSON.stringify(v));
  } catch {
    /* come sopra */
  }
}

/** Svuota la cache (test e pulsante "aggiorna"). */
export function svuotaCache() {
  memoria.clear();
  inVolo.clear();
  try {
    const s = store();
    if (s) for (const k of Object.keys(s)) if (k.startsWith(PREFISSO)) s.removeItem(k);
  } catch {
    /* niente */
  }
}

let fetchFn = (...a) => globalThis.fetch(...a);
let oraFn = () => Date.now();
/** Per i test: fetch e orologio finti. */
export function impostaRete({ fetch, ora } = {}) {
  if (fetch) fetchFn = fetch;
  if (ora) oraFn = ora;
}

/** GET JSON con timeout ed errori leggibili (429 = limite di richieste della fonte). */
export async function richiestaJson(url, { timeoutMs = 9000, headers } = {}) {
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = setTimeout(() => ctrl?.abort(), timeoutMs);
  try {
    const res = await fetchFn(url, { signal: ctrl?.signal, headers });
    if (res.status === 429) throw new Error('troppe richieste (429): limite della fonte raggiunto');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    if (err?.name === 'AbortError') throw new Error(`nessuna risposta in ${Math.round(timeoutMs / 1000)} s`);
    if (err?.name === 'TypeError' && /fetch|network|load/i.test(err.message)) throw new Error('fonte non raggiungibile (rete o CORS)');
    throw err instanceof Error ? err : new Error(String(err));
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Valore con cache: `fn()` solo se la cache è scaduta; richieste uguali in corso condivise.
 * @returns {Promise<{valore: any, letto: number, daCache: boolean}>}
 */
export async function conCache(chiave, ttlMs, fn) {
  const ora = oraFn();
  const c = leggiCache(chiave, ttlMs, ora);
  if (c) return { valore: c.valore, letto: c.ts, daCache: true };
  if (inVolo.has(chiave)) return inVolo.get(chiave);
  const p = (async () => {
    try {
      const valore = await fn();
      scriviCache(chiave, valore, oraFn());
      return { valore, letto: oraFn(), daCache: false };
    } finally {
      inVolo.delete(chiave);
    }
  })();
  inVolo.set(chiave, p);
  return p;
}

// ------------------------------------------------------------------ snapshot

const snapshotCaricati = new Map();

/** Snapshot `dati/<nome>.json` (fetch nel browser, disco in Node). null se manca o non è leggibile. */
export function snapshot(nome) {
  if (!snapshotCaricati.has(nome)) {
    const url = new URL(`${nome}.json`, CARTELLA_DATI);
    const p = (async () => {
      try {
        if (url.protocol === 'file:') {
          const fs = globalThis.process?.getBuiltinModule?.('node:fs/promises');
          if (!fs) return null;
          return JSON.parse(await fs.readFile(url, 'utf8'));
        }
        const res = await fetchFn(url.href, { cache: 'no-cache' });
        return res.ok ? await res.json() : null;
      } catch {
        return null;
      }
    })();
    snapshotCaricati.set(nome, p);
  }
  return snapshotCaricati.get(nome);
}

/** Per i test: dati degli snapshot iniettati invece di leggerli. */
export function impostaSnapshot(nome, dati) {
  snapshotCaricati.set(nome, Promise.resolve(dati));
}

/** In Node alcune API (Transitous) chiedono uno User-Agent che identifichi il progetto; nel browser lo mette il browser. */
const IN_NODE = typeof window === 'undefined' && Boolean(globalThis.process?.versions?.node);
const UA_NODE = IN_NODE ? { 'user-agent': 'napoli-in-tempo-reale/1.0 (demo The Big Hack 2026)' } : undefined;

const fonte = (id, tipo, extra = {}) => ({ id, ...FONTI[id], tipo, ...extra });

const tsSnapshot = (s) => (s?.meta?.generato ? Date.parse(s.meta.generato) : null);

// ------------------------------------------------------------------ meteo

/** Meteo attuale per luogo: Open-Meteo ICON-2I → Open-Meteo predefinito → MET Norway (un punto) → snapshot. */
export async function meteo() {
  const q = 'current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_gusts_10m,is_day&timezone=Europe%2FRome';
  const errori = [];
  for (const [id, modello] of [
    ['openMeteo', '&models=italia_meteo_arpae_icon_2i'],
    ['openMeteoBase', ''],
  ]) {
    try {
      const r = await conCache(`meteo:${id}`, 15 * 60_000, async () =>
        N.meteoDaOpenMeteo(await richiestaJson(`https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}&${q}${modello}`), ZONE),
      );
      if (Object.keys(r.valore).length >= ZONE.length - 2) {
        const ts = Math.max(...Object.values(r.valore).map((m) => m.ts || 0));
        return { dati: r.valore, fonte: fonte(id, r.daCache ? 'cache' : 'live', { ts, letto: r.letto, nota: id === 'openMeteo' ? 'previsione per l\'ora corrente, griglia di 2,2 km' : 'modello predefinito (ICON-2I non disponibile)' }) };
      }
      errori.push(`${FONTI[id].nome}: risposta incompleta`);
    } catch (err) {
      errori.push(`${FONTI[id].nome}: ${err.message}`);
      if (/429/.test(err.message)) break; // stessa quota per IP: inutile riprovare Open-Meteo
    }
  }
  try {
    const r = await conCache('meteo:metno', 30 * 60_000, async () => N.meteoDaMetNo(await richiestaJson('https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=40.8435&lon=14.242')));
    if (r.valore) {
      const dati = Object.fromEntries(ZONE.map((z) => [z, r.valore]));
      return { dati, fonte: fonte('metNo', 'riserva', { ts: r.valore.ts, letto: r.letto, nota: `un solo punto per tutta la città (${errori.join('; ')})` }) };
    }
  } catch (err) {
    errori.push(`${FONTI.metNo.nome}: ${err.message}`);
  }
  const s = await snapshot('meteo');
  if (s?.meteo && Object.keys(s.meteo).length) {
    const ts = Math.max(...Object.values(s.meteo).map((m) => m.ts || 0));
    return { dati: s.meteo, fonte: fonte('openMeteo', 'salvato', { ts, nota: `fonti live non disponibili: ${errori.join('; ')}` }) };
  }
  return { dati: {}, fonte: fonte('openMeteo', 'assente', { nota: errori.join('; ') || 'nessuna fonte disponibile' }) };
}

// ------------------------------------------------------------------ aria

/** Indice europeo della qualità dell'aria dal modello CAMS (uguale per tutta la città: griglia di 11 km). */
export async function ariaModello() {
  try {
    const r = await conCache('aria:cams', 60 * 60_000, async () =>
      N.ariaDaOpenMeteo(
        await richiestaJson(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${LAT}&longitude=${LON}&current=european_aqi,pm10,pm2_5,nitrogen_dioxide,ozone&domains=cams_europe&timezone=Europe%2FRome`),
        ZONE,
      ),
    );
    if (Object.keys(r.valore).length) {
      const ts = Math.max(...Object.values(r.valore).map((m) => m.ts || 0));
      return { dati: r.valore, fonte: fonte('cams', r.daCache ? 'cache' : 'live', { ts, letto: r.letto, nota: 'modello di fondo regionale (celle di circa 11 km)' }) };
    }
  } catch (err) {
    const s = await snapshot('meteo');
    if (s?.aria && Object.keys(s.aria).length) {
      return { dati: s.aria, fonte: fonte('cams', 'salvato', { ts: Math.max(...Object.values(s.aria).map((m) => m.ts || 0)), nota: `fonte live non disponibile: ${err.message}` }) };
    }
    return { dati: {}, fonte: fonte('cams', 'assente', { nota: err.message }) };
  }
  return { dati: {}, fonte: fonte('cams', 'assente', { nota: 'risposta vuota' }) };
}

/** Centraline ARPAC (snapshot dall'EEA): stazioni con le ultime 24 ore e la più vicina per luogo. */
export async function centraline() {
  const s = await snapshot('aria');
  if (!s?.stazioni?.length) return { dati: null, fonte: fonte('centraline', 'assente', { nota: 'snapshot dati/aria.json assente' }) };
  return { dati: s, fonte: fonte('centraline', 'snapshot', { ts: s.meta?.ultimoDato ?? null, letto: tsSnapshot(s), nota: 'misure orarie non validate, salvate con lo script degli snapshot' }) };
}

// ------------------------------------------------------------------ allerte e rischi

const CF = 'https://centrofunzionale.regione.campania.it/CentroFunzionalePortaleRest/rest/bollettinometeo';

/** Allerta regionale per Napoli (Zona 1) dal vivo, con Meteoalarm dallo snapshot (non ha CORS). */
export async function allerta() {
  const s = await snapshot('meteo');
  const meteoalarm = (s?.meteoalarm || []).filter((a) => a.fine > oraFn());
  try {
    const r = await conCache('allerta:cf', 20 * 60_000, async () => {
      const ultima = await richiestaJson(`${CF}/findLastAllertaNew`);
      const zona = ultima?.idBollettino ? await richiestaJson(`${CF}/findByIdZona/1/${ultima.idBollettino}`).catch(() => null) : null;
      const domani = await richiestaJson(`${CF}/findAllertaDomaniNew`).catch(() => null);
      return { ultima, zona, domani };
    });
    const a = N.allertaDaCentroFunzionale(r.valore.ultima, r.valore.zona, r.valore.domani, oraFn());
    if (a) return { dati: { regionale: a, meteoalarm }, fonte: fonte('allerta', r.daCache ? 'cache' : 'live', { ts: a.emissione, letto: r.letto }) };
    if (r.valore.ultima) {
      // Il Centro Funzionale ha risposto ma senza avvisi in vigore: è un dato vero ("nessun avviso"),
      // non un guasto. L'ultimo avviso salvato resta solo come storia (scaduto, non mostrato nel banner).
      const g = s?.allerta?.grezzo;
      const storia = g ? N.allertaDaCentroFunzionale(g.ultima, g.zona, g.domani, oraFn()) : null;
      return {
        // Senza avvisi in vigore l'ultimo avviso è chiuso per tutti (banner, agenti, API), anche se le sue date dicono altro.
        dati: { regionale: storia ? { ...storia, inCorso: false, scaduta: true } : null, meteoalarm, nessunAvvisoInVigore: true },
        fonte: fonte('allerta', r.daCache ? 'cache' : 'live', { ts: oraFn(), letto: r.letto, nota: 'senza avvisi in vigore' }),
      };
    }
    throw new Error('risposta senza bollettino');
  } catch (err) {
    const g = s?.allerta?.grezzo;
    const a = g ? N.allertaDaCentroFunzionale(g.ultima, g.zona, g.domani, oraFn()) : null;
    return {
      dati: { regionale: a, meteoalarm },
      fonte: fonte('allerta', a ? 'salvato' : 'assente', { ts: a?.emissione ?? null, nota: `${err.message}${a ? ': ultimo avviso salvato' : ''}` }),
    };
  }
}

/** Ultimi terremoti dei Campi Flegrei (INGV) dal vivo, con riserva sullo snapshot. */
export async function terremoti() {
  try {
    const da = new Date(oraFn() - 30 * 86_400_000).toISOString().slice(0, 19);
    const r = await conCache('ingv', 30 * 60_000, async () =>
      N.terremotiIngv(await richiestaJson(`https://webservices.ingv.it/fdsnws/event/1/query?starttime=${da}&minlat=40.75&maxlat=40.90&minlon=14.00&maxlon=14.25&minmag=0&format=geojson&orderby=time&limit=50`)).slice(0, 20),
    );
    return { dati: r.valore, fonte: fonte('ingv', r.daCache ? 'cache' : 'live', { ts: r.valore[0]?.ts ?? null, letto: r.letto }) };
  } catch (err) {
    const s = await snapshot('meteo');
    return { dati: s?.terremoti || [], fonte: fonte('ingv', s?.terremoti ? 'salvato' : 'assente', { ts: s?.terremoti?.[0]?.ts ?? null, nota: err.message }) };
  }
}

// ------------------------------------------------------------------ trasporti

/** Linee e stazioni (snapshot GTFS). */
export async function trasporti() {
  const s = await snapshot('trasporti');
  if (!s?.stazioni) return { dati: null, fonte: fonte('gtfs', 'assente', { nota: 'snapshot dati/trasporti.json assente' }) };
  return { dati: s, fonte: fonte('gtfs', 'programmato', { ts: tsSnapshot(s), nota: 'corse programmate, non in tempo reale' }) };
}

/** Prossimi passaggi di una stazione (Transitous, dal vivo; cache di un minuto). */
export async function passaggi(stazione, { n = 8 } = {}) {
  const ids = stazione?.transitous || [];
  if (!ids.length) return { dati: [], fonte: fonte('transitous', 'assente', { nota: 'stazione non trovata su Transitous' }) };
  try {
    const r = await conCache(`passaggi:${ids.join('+')}`, 60_000, async () => {
      // Transitous raggruppa la stazione con le fermate dei bus vicine ("DANTE - M1"): se ne chiedono
      // di più e si tengono solo metro, funicolari e treni, come dice la scheda
      const risposte = await Promise.all(ids.map((id) => richiestaJson(`https://api.transitous.org/api/v1/stoptimes?stopId=${encodeURIComponent(id)}&n=${Math.min(30, n * 3)}`, { timeoutMs: 8000, headers: UA_NODE })));
      // più fermate per stazione (una per binario) possono restituire le stesse corse: si tolgono i doppioni
      const visti = new Set();
      return risposte
        .flatMap((j) => N.passaggiDaTransitous(j, oraFn()))
        .filter((p) => !/^(BUS|COACH)$/.test(p.modo))
        .sort((a, b) => a.ts - b.ts)
        .filter((p) => {
          const k = `${p.ts}|${p.linea}|${p.verso}`;
          return !visti.has(k) && visti.add(k);
        })
        .slice(0, n);
    });
    const tr = r.valore.some((p) => p.tempoReale);
    return { dati: r.valore, fonte: fonte('transitous', r.daCache ? 'cache' : 'live', { ts: r.letto, letto: r.letto, nota: tr ? 'con dati in tempo reale dove disponibili' : 'orari programmati (nessun dato in tempo reale per questa fermata)' }) };
  } catch (err) {
    return { dati: [], fonte: fonte('transitous', 'assente', { nota: err.message }) };
  }
}

/** Avvisi EAV (guasti, scioperi, ascensori) dal vivo; `nomi` = nomi delle stazioni da riconoscere nei titoli. */
export async function avvisiEav(nomi = []) {
  try {
    const r = await conCache('eav', 15 * 60_000, () => richiestaJson('https://www.eavsrl.it/wp-json/wp/v2/posts?categories=41,17,65,173&per_page=12&_fields=date,date_gmt,title,link,categories'));
    const avvisi = N.avvisiEav(r.valore, nomi);
    return { dati: avvisi, fonte: fonte('eav', r.daCache ? 'cache' : 'live', { ts: avvisi[0]?.ts ?? null, letto: r.letto }) };
  } catch (err) {
    return { dati: [], fonte: fonte('eav', 'assente', { nota: err.message }) };
  }
}

/** Eventi di traffico su tangenziale e autostrade attorno a Napoli (ASPI, dal vivo, cache 5 minuti). */
export async function traffico() {
  try {
    const r = await conCache('aspi', 5 * 60_000, async () => N.trafficoAspi(await richiestaJson('https://viabilita.autostrade.it/json/eventi.json', { timeoutMs: 12_000 })));
    const nota = r.valore.length ? `${r.valore.length} eventi nell'area di Napoli` : "nessun evento in corso nell'area di Napoli";
    return { dati: r.valore, fonte: fonte('aspi', r.daCache ? 'cache' : 'live', { ts: Math.max(0, ...r.valore.map((e) => e.ts || 0)) || r.letto, letto: r.letto, nota }) };
  } catch (err) {
    return { dati: null, fonte: fonte('aspi', 'assente', { nota: err.message }) };
  }
}

// ------------------------------------------------------------------ eventi e riferimenti

/** Eventi (snapshot) con il calendario della Serie A aggiornato dal vivo quando possibile. */
export async function eventi() {
  const s = await snapshot('eventi');
  if (!s) return { dati: null, fonte: fonte('eventi', 'assente', { nota: 'snapshot dati/eventi.json assente' }) };
  let partite = s.partite;
  let nota = 'snapshot';
  try {
    const r = await conCache('openfootball', 6 * 3_600_000, async () => {
      const j = await richiestaJson('https://raw.githubusercontent.com/openfootball/football.json/master/2026-27/it.1.json', { timeoutMs: 10_000 });
      // stesso formato e stessa finestra (ultimi 30 giorni in poi) dello script degli snapshot
      const da = N.giornoLocale(oraFn() - 30 * 86_400_000);
      return N.partiteDaOpenfootball(j).filter((p) => p.giorno >= da);
    });
    if (r.valore.length) {
      // le partite da altre fonti (es. coppe da TheSportsDB) restano
      partite = [...r.valore, ...s.partite.filter((p) => p.fonte !== 'openfootball' && !r.valore.some((x) => x.giorno === p.giorno))];
      nota = 'snapshot, partite di Serie A aggiornate dal vivo (openfootball)';
    }
  } catch {
    /* restano le partite dello snapshot */
  }
  return { dati: { ...s, partite }, fonte: fonte('eventi', 'snapshot', { ts: tsSnapshot(s), letto: tsSnapshot(s), nota }) };
}

/** Riferimenti statici reali (visitatori, porto, stagionalità, affitti brevi, mare). */
export async function riferimenti() {
  const s = await snapshot('riferimenti');
  if (!s) return { dati: null, fonte: fonte('riferimenti', 'assente', { nota: 'snapshot dati/riferimenti.json assente' }) };
  return { dati: s, fonte: fonte('riferimenti', 'snapshot', { ts: tsSnapshot(s), letto: tsSnapshot(s) }) };
}

/** Indice degli snapshot (data e fonti di ogni file). */
export async function indice() {
  return snapshot('indice');
}
