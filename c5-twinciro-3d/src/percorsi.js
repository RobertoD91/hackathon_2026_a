// Percorsi per l'agente Mobilità.
// 1) DAL VIVO: pianificatore Transitous (MOTIS, dati GTFS e tempo reale delle aziende; bus compresi),
//    con il tracciato vero delle strade a piedi e delle linee;
// 2) RISERVA dichiarata: il grafo locale della rete su ferro (rete.js), usato anche quando lo scenario
//    what-if chiude una linea che Transitous non sa essere chiusa.
// Entrambi restituiscono lo stesso formato:
//   { fonte, partenza, arrivo, minuti, cambi, linee, soloPiedi,
//     tratte: [{ modo, da:{nome,lat,lon}, a:{…}, minuti, metri?, linea?, colore?, verso?, fermate?, partenza, tempoReale?, geometria:[[lon,lat],…] }] }

import { percorsoLocale } from './rete.js';

const TRANSITOUS = 'https://api.transitous.org/api/v1/plan';

const MODI = {
  WALK: 'piedi', SUBWAY: 'metro', METRO: 'metro', FUNICULAR: 'funicolare', CABLE_CAR: 'funicolare', AREAL_LIFT: 'funicolare',
  RAIL: 'treno', REGIONAL_RAIL: 'treno', REGIONAL_FAST_RAIL: 'treno', SUBURBAN: 'treno', LONG_DISTANCE: 'treno', HIGHSPEED_RAIL: 'treno', NIGHT_RAIL: 'treno',
  BUS: 'bus', COACH: 'bus', TRAM: 'tram', FERRY: 'traghetto',
};
const COLORI_MODO = { metro: '#f8e414', funicolare: '#f89329', treno: '#c8302f', bus: '#38bdf8', tram: '#a78bfa', traghetto: '#22d3ee', mezzo: '#94a3b8' };

/** Decodifica una polilinea codificata (Google/MOTIS) in [[lon, lat], ...]. */
export function decodificaPolilinea(testo, precisione = 5) {
  const f = 10 ** precisione;
  const out = [];
  let i = 0, lat = 0, lon = 0;
  while (i < testo.length) {
    for (const quale of [0, 1]) {
      let risultato = 0, spostamento = 0, b;
      do {
        b = testo.charCodeAt(i++) - 63;
        risultato += (b & 0x1f) * 2 ** spostamento; // niente operatori a 32 bit: con precisione 7 i numeri sono grandi
        spostamento += 5;
      } while (b >= 0x20);
      const delta = risultato % 2 ? -(risultato + 1) / 2 : risultato / 2;
      if (quale === 0) lat += delta;
      else lon += delta;
    }
    out.push([lon / f, lat / f]);
  }
  return out;
}

const nomeBello = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/(^|[\s\-'.(])([a-zà-ù])/g, (_, a, b) => a + b.toUpperCase())
    .replace(/\s+-\s+/g, ' · ');

/** Metri in linea d'aria tra due punti {lat, lon}. */
const lineaDAria = (p, q) => Math.hypot((q.lon - p.lon) * 111_320 * Math.cos((p.lat * Math.PI) / 180), (q.lat - p.lat) * 110_540);

/**
 * Itinerario Transitous → formato comune. `linee` (Map sigla → linea dello snapshot) dà i colori ufficiali.
 * Restituisce null se l'itinerario non è credibile: capita che i dati in tempo reale diano corse a durata
 * zero o più veloci di 90 km/h (un bus che "si teletrasporta"), e quelle non vanno proposte a nessuno.
 */
export function daTransitous(it, { da, a, linee } = {}) {
  const tratte = [];
  for (const l of it.legs || []) {
    const modo = MODI[l.mode] || 'mezzo';
    if (modo !== 'piedi' && (!(l.duration > 0) || lineaDAria(l.from, l.to) / l.duration > 25)) return null;
    const geometria = l.legGeometry?.points ? decodificaPolilinea(l.legGeometry.points, l.legGeometry.precision ?? 7) : [[l.from.lon, l.from.lat], [l.to.lon, l.to.lat]];
    const A = { nome: l.from.name === 'START' ? da?.nome || 'Partenza' : nomeBello(l.from.name), lat: l.from.lat, lon: l.from.lon };
    const B = { nome: l.to.name === 'END' ? a?.nome || 'Arrivo' : nomeBello(l.to.name), lat: l.to.lat, lon: l.to.lon };
    const minuti = Math.max(1, Math.round((l.duration || 0) / 60));
    if (modo === 'piedi') {
      if ((l.distance ?? 0) < 25 && minuti <= 1 && tratte.length) continue;
      const prec = tratte[tratte.length - 1];
      if (prec?.modo === 'piedi') {
        prec.a = B; prec.minuti += minuti; prec.metri += Math.round(l.distance || 0); prec.geometria.push(...geometria);
        continue;
      }
      tratte.push({ modo, da: A, a: B, minuti, metri: Math.round(l.distance || 0), geometria, partenza: Date.parse(l.startTime) });
    } else {
      const sigla = l.routeShortName || l.displayName || '';
      const ufficiale = linee?.get(sigla);
      tratte.push({
        modo, linea: sigla, nomeLinea: ufficiale?.nome || l.routeLongName || sigla, operatore: l.agencyName || '',
        colore: ufficiale?.colore || (l.routeColor ? `#${l.routeColor}` : COLORI_MODO[modo]),
        verso: nomeBello(l.headsign), da: A, a: B, minuti, fermate: (l.intermediateStops?.length ?? 0) + 1,
        partenza: Date.parse(l.startTime), arrivo: Date.parse(l.endTime), tempoReale: l.realTime === true, geometria,
      });
    }
  }
  const mezzi = tratte.filter((t) => t.modo !== 'piedi');
  const partenza = Date.parse(it.startTime);
  const arrivo = Date.parse(it.endTime);
  return {
    fonte: 'transitous', partenza, arrivo, minuti: Math.round((arrivo - partenza) / 60_000), cambi: Math.max(0, mezzi.length - 1),
    tratte, linee: mezzi.map((t) => t.linea), soloPiedi: mezzi.length === 0, tempoReale: mezzi.some((t) => t.tempoReale),
  };
}

// In Node Transitous chiede uno User-Agent che identifichi il progetto (403 senza); nel browser lo mette il browser.
const IN_NODE = typeof window === 'undefined' && Boolean(globalThis.process?.versions?.node);
const INTESTAZIONI = IN_NODE ? { 'user-agent': 'twinciro-3d/1.0 (demo The Big Hack 2026)' } : undefined;

let fetchFn = (...x) => globalThis.fetch(...x);
/** Per i test: fetch finto. */
export function impostaFetch(f) {
  fetchFn = f;
}

/** Chiede a Transitous fino a `n` itinerari; lancia se la rete non risponde in `timeoutMs`. */
export async function percorsiDalVivo(da, a, { ts = Date.now(), n = 4, timeoutMs = 7000, linee } = {}) {
  const url = `${TRANSITOUS}?fromPlace=${da.lat},${da.lon}&toPlace=${a.lat},${a.lon}&time=${new Date(ts).toISOString()}&numItineraries=${n}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchFn(url, { signal: ctrl.signal, headers: INTESTAZIONI });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = await res.json();
    const visti = new Set();
    return [...(j.itineraries || []), ...(j.direct || [])]
      .map((it) => daTransitous(it, { da, a, linee }))
      .filter((p) => p && p.tratte.length)
      .sort((x, y) => x.partenza - y.partenza)
      .filter((p) => {
        // lo stesso viaggio con la corsa successiva non è un'alternativa: resta solo la prima partenza
        const k = p.tratte.map((t) => `${t.modo}:${t.linea || ''}:${t.a.nome}`).join('|');
        return !visti.has(k) && visti.add(k);
      });
  } catch (err) {
    throw new Error(err?.name === 'AbortError' ? `nessuna risposta in ${Math.round(timeoutMs / 1000)} s` : err.message || String(err));
  } finally {
    clearTimeout(timer);
  }
}

/** Punteggio di un itinerario: minuti, più un costo per ogni cambio e per la strada a piedi oltre i 10 minuti. */
const punteggio = (p) => p.minuti + p.cambi * 5 + Math.max(0, p.tratte.filter((t) => t.modo === 'piedi').reduce((s, t) => s + t.minuti, 0) - 10) * 0.5;

/**
 * Il percorso migliore e un'alternativa.
 * @param {object} rete            grafo locale (creaRete)
 * @param {object} da, a           { nome, lat, lon }
 * @param {object} [opz]           { ts, lineeChiuse, penalita, soloLocale, timeoutMs }
 * @returns {Promise<{migliore, alternative, fonte:'transitous'|'locale', nota:string}>}
 */
export async function trovaPercorso(rete, da, a, opz = {}) {
  const chiuse = opz.lineeChiuse || [];
  const locale = () => {
    const migliore = percorsoLocale(rete, da, a, opz);
    const alternative = [];
    // alternativa: lo stesso viaggio senza la prima linea usata
    if (migliore && migliore.linee.length) {
      const alt = percorsoLocale(rete, da, a, { ...opz, lineeChiuse: [...chiuse, migliore.linee[0]] });
      if (alt && alt.minuti <= migliore.minuti + 25 && alt.linee.join() !== migliore.linee.join()) alternative.push(alt);
    }
    return { migliore, alternative };
  };
  if (opz.soloLocale) return { ...locale(), fonte: 'locale', nota: 'rete su ferro da orari GTFS (motore di riserva)' };
  try {
    let lista = await percorsiDalVivo(da, a, { ts: opz.ts, linee: rete.linee, timeoutMs: opz.timeoutMs });
    const tolti = lista.filter((p) => p.linee.some((l) => chiuse.includes(l))).length;
    lista = lista.filter((p) => !p.linee.some((l) => chiuse.includes(l))).sort((x, y) => punteggio(x) - punteggio(y));
    if (!lista.length) throw new Error(tolti ? 'tutti gli itinerari usano la linea chiusa' : 'nessun itinerario');
    return { migliore: lista[0], alternative: lista.slice(1, 3), fonte: 'transitous', nota: `Transitous${lista[0].tempoReale ? ', con dati in tempo reale' : ', orari programmati'}` };
  } catch (err) {
    return { ...locale(), fonte: 'locale', nota: `motore di riserva (rete su ferro da orari GTFS): Transitous non disponibile (${err.message})` };
  }
}
