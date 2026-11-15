// Rete su ferro di Napoli (metro, funicolari, ferrovie EAV) come grafo, e calcolo del percorso.
//
// Il grafo nasce dallo snapshot GTFS di ANM ed EAV (citta-api/dati/trasporti.json):
// le stazioni di ogni linea vengono proiettate sul tracciato per ricavarne l'ordine. I tempi sono
// stimati (velocità commerciale per tipo di linea, attesa = metà dell'intervallo tra le corse
// programmate in quell'ora): è il motore di RISERVA e quello degli scenari "what-if" (linea chiusa).
// Il percorso "dal vivo" con bus e orari reali arriva da Transitous (percorsi.js).
// Modulo puro, senza rete: lo provano i test.

import { tipoGiorno } from './modello.js';
import { partiLocali } from '../../../citta-api/fonti/normalizza.js';

const VELOCITA = { metro: 30, funicolare: 14, ferrovia: 36, bus: 22 }; // km/h commerciali (fermate comprese)
const FATICA_PIEDI = 1.2; // nella scelta del percorso un minuto a piedi pesa come 1,2 minuti seduti

/**
 * Collegamenti che non sono nel GTFS su ferro ma senza i quali il percorso di riserva non avrebbe senso.
 * Alibus (ANM): Aeroporto – Piazza Garibaldi – Porto. Tracciato e frequenza INDICATIVI (dichiarato in pagina).
 */
export const LINEE_EXTRA = Object.freeze([
  {
    id: 'extra-alibus', sigla: 'Alibus', nome: 'Alibus Aeroporto – Stazione – Porto', rete: 'Bus', tipo: 'bus', operatore: 'ANM', colore: '#e11d48', indicativa: true,
    fermate: [
      { id: 'extra-alibus-1', nome: 'Aeroporto Capodichino', lat: 40.8846, lon: 14.2856 },
      { id: 'extra-alibus-2', nome: 'Piazza Garibaldi (Alibus)', lat: 40.8522, lon: 14.2702 },
      { id: 'extra-alibus-3', nome: 'Porto · Molo Angioino (Alibus)', lat: 40.8392, lon: 14.2548 },
    ],
    corse: [0, 0, 0, 0, 0, 2, 3, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 3, 3, 2],
  },
]);
const PASSO = 75; // metri al minuto a piedi (4,5 km/h)
const TORTUOSITA = 1.3; // percorso a piedi ≈ 1,3 × la distanza in linea d'aria
const MAX_PIEDI = 1500; // metri in linea d'aria tra un punto e una stazione
const MAX_CAMBIO = 450; // metri tra due stazioni per cambiare a piedi
const GIORNI = { fer: 'feriale', sab: 'sabato', fes: 'festivo' };

const RAD = Math.PI / 180;
const KY = 110_540;
const kx = (lat) => 111_320 * Math.cos(lat * RAD);

/** Distanza in metri tra due punti {lat, lon}. */
export function metri(a, b) {
  const x = (b.lon - a.lon) * kx((a.lat + b.lat) / 2);
  const y = (b.lat - a.lat) * KY;
  return Math.hypot(x, y);
}

export const minutiAPiedi = (m) => Math.max(1, Math.round((m * TORTUOSITA) / PASSO));

/** Proietta un punto su una polilinea [[lat, lon], ...]: distanza dal tracciato e progressiva in metri. */
function proietta(p, linea) {
  let migliore = { d: Infinity, s: 0, i: 0, t: 0 };
  let s = 0;
  const k = kx(p.lat);
  for (let i = 0; i < linea.length - 1; i++) {
    const ax = (linea[i][1] - p.lon) * k, ay = (linea[i][0] - p.lat) * KY;
    const bx = (linea[i + 1][1] - p.lon) * k, by = (linea[i + 1][0] - p.lat) * KY;
    const dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy;
    const t = l2 ? Math.min(1, Math.max(0, -(ax * dx + ay * dy) / l2)) : 0;
    const d = Math.hypot(ax + t * dx, ay + t * dy);
    const len = Math.sqrt(l2);
    if (d < migliore.d) migliore = { d, s: s + t * len, i, t };
    s += len;
  }
  return migliore;
}

/** Pezzo di polilinea tra due proiezioni, come [[lon, lat], ...]. */
function taglia(linea, a, b) {
  const punto = (pr) => [linea[pr.i][1] + (linea[pr.i + 1][1] - linea[pr.i][1]) * pr.t, linea[pr.i][0] + (linea[pr.i + 1][0] - linea[pr.i][0]) * pr.t];
  const out = [punto(a)];
  for (let i = a.i + 1; i <= b.i; i++) out.push([linea[i][1], linea[i][0]]);
  out.push(punto(b));
  return out;
}

/**
 * Costruisce il grafo dalla sezione `linee` + `stazioni` dello snapshot trasporti.
 * @returns {{stazioni: Map, linee: Map, archi: Array, cambi: Array}}
 */
export function creaRete(trasporti) {
  const stazioni = new Map((trasporti?.stazioni || []).map((s) => [s.id, s]));
  const linee = new Map((trasporti?.linee || []).map((l) => [l.sigla, l]));
  for (const x of LINEE_EXTRA) {
    linee.set(x.sigla, { ...x, tratti: [x.fermate.map((f) => [f.lat, f.lon])] });
    for (const f of x.fermate) stazioni.set(f.id, { ...f, tipo: x.tipo, linee: [x.sigla], operatore: x.operatore, corse: { feriale: x.corse, sabato: x.corse, festivo: x.corse }, indicativa: true });
  }
  const archi = []; // { linea, da, a, metri, minuti, geometria } (un verso; l'altro si ricava)
  for (const l of linee.values()) {
    const vel = VELOCITA[l.tipo] || VELOCITA.ferrovia;
    const visti = new Set();
    for (const tratto of l.tratti || []) {
      if (tratto.length < 2) continue;
      const sulTratto = [...stazioni.values()]
        .filter((s) => s.linee.includes(l.sigla))
        .map((s) => ({ s, pr: proietta(s, tratto) }))
        .filter((x) => x.pr.d <= 220)
        .sort((a, b) => a.pr.s - b.pr.s);
      for (let i = 0; i < sulTratto.length - 1; i++) {
        const a = sulTratto[i], b = sulTratto[i + 1];
        const chiave = [a.s.id, b.s.id].sort().join('>');
        const m = b.pr.s - a.pr.s;
        if (visti.has(chiave) || m < 30) continue;
        visti.add(chiave);
        archi.push({ linea: l.sigla, da: a.s.id, a: b.s.id, metri: Math.round(m), minuti: (m / 1000 / vel) * 60 + 0.5, geometria: taglia(tratto, a.pr, b.pr) });
      }
    }
  }
  const lista = [...stazioni.values()];
  const cambi = [];
  for (let i = 0; i < lista.length; i++) {
    for (let j = i + 1; j < lista.length; j++) {
      const m = metri(lista[i], lista[j]);
      if (m <= MAX_CAMBIO) cambi.push({ da: lista[i].id, a: lista[j].id, metri: Math.round(m), minuti: minutiAPiedi(m) + 1 });
    }
  }
  return { stazioni, linee, archi, cambi };
}

/** Corse programmate nell'ora per una stazione (null se il dato manca). */
export function corseOra(stazione, ts) {
  const tipo = GIORNI[tipoGiorno(ts)];
  const v = stazione?.corse?.[tipo]?.[partiLocali(ts).ora];
  return v == null ? null : v;
}

/**
 * Percorso più rapido tra due punti {lat, lon, nome} sulla rete su ferro + a piedi.
 * @param {object} rete      risultato di creaRete
 * @param {object} da, a     punti di partenza e arrivo
 * @param {object} [opz]     { ts, lineeChiuse: string[], penalita: (stazione) => minuti in più a salire }
 * @returns itinerario nel formato comune (vedi percorsi.js) o null se non c'è modo di arrivare
 */
export function percorsoLocale(rete, da, a, opz = {}) {
  const ts = opz.ts ?? Date.now();
  const chiuse = new Set(opz.lineeChiuse || []);
  const nodi = new Map(); // id → [{ verso, minuti, tipo, ... }]
  const arco = (x, y, minuti, info) => {
    if (!nodi.has(x)) nodi.set(x, []);
    nodi.get(x).push({ verso: y, minuti, costo: info.tipo === 'piedi' ? minuti * FATICA_PIEDI : minuti, ...info });
  };
  const inServizio = (s) => {
    const c = corseOra(s, ts);
    return c == null ? 4 : c; // senza dato si assume un servizio rado ma presente
  };
  for (const s of rete.stazioni.values()) {
    const corse = inServizio(s);
    for (const sigla of s.linee) {
      if (chiuse.has(sigla) || corse <= 0) continue;
      const attesa = Math.min(12, Math.max(2, 60 / corse)) + (opz.penalita?.(s) ?? 0);
      arco(`S:${s.id}`, `L:${s.id}|${sigla}`, attesa, { tipo: 'sali', linea: sigla, attesa });
      arco(`L:${s.id}|${sigla}`, `S:${s.id}`, 0.3, { tipo: 'scendi' });
    }
  }
  for (const e of rete.archi) {
    if (chiuse.has(e.linea)) continue;
    arco(`L:${e.da}|${e.linea}`, `L:${e.a}|${e.linea}`, e.minuti, { tipo: 'corsa', linea: e.linea, arco: e, inverso: false });
    arco(`L:${e.a}|${e.linea}`, `L:${e.da}|${e.linea}`, e.minuti, { tipo: 'corsa', linea: e.linea, arco: e, inverso: true });
  }
  for (const c of rete.cambi) {
    arco(`S:${c.da}`, `S:${c.a}`, c.minuti, { tipo: 'piedi', metri: c.metri });
    arco(`S:${c.a}`, `S:${c.da}`, c.minuti, { tipo: 'piedi', metri: c.metri });
  }
  for (const s of rete.stazioni.values()) {
    const mDa = metri(da, s);
    if (mDa <= MAX_PIEDI) arco('O', `S:${s.id}`, minutiAPiedi(mDa), { tipo: 'piedi', metri: Math.round(mDa) });
    const mA = metri(s, a);
    if (mA <= MAX_PIEDI) arco(`S:${s.id}`, 'D', minutiAPiedi(mA), { tipo: 'piedi', metri: Math.round(mA) });
  }
  const diretto = metri(da, a);
  arco('O', 'D', (diretto * TORTUOSITA) / PASSO, { tipo: 'piedi', metri: Math.round(diretto) });

  // Dijkstra (il grafo ha poche centinaia di nodi: basta una ricerca lineare del minimo)
  const dist = new Map([['O', 0]]);
  const tempo = new Map([['O', 0]]);
  const prima = new Map();
  const fatti = new Set();
  for (;;) {
    let u = null;
    for (const [k, v] of dist) if (!fatti.has(k) && (u === null || v < dist.get(u))) u = k;
    if (u === null || u === 'D') break;
    fatti.add(u);
    for (const e of nodi.get(u) || []) {
      const nd = dist.get(u) + e.costo;
      if (nd < (dist.get(e.verso) ?? Infinity)) {
        dist.set(e.verso, nd);
        tempo.set(e.verso, tempo.get(u) + e.minuti);
        prima.set(e.verso, { da: u, e });
      }
    }
  }
  if (!dist.has('D')) return null;

  const passi = [];
  for (let n = 'D'; n !== 'O'; n = prima.get(n).da) passi.unshift({ ...prima.get(n), a: n });
  const punto = (id) => {
    if (id === 'O') return { nome: da.nome || 'Partenza', lat: da.lat, lon: da.lon };
    if (id === 'D') return { nome: a.nome || 'Arrivo', lat: a.lat, lon: a.lon };
    const s = rete.stazioni.get(id.slice(2).split('|')[0]);
    return { nome: s.nome, lat: s.lat, lon: s.lon, stazione: s.id };
  };
  const tratte = [];
  let t = ts;
  for (const p of passi) {
    const e = p.e;
    if (e.tipo === 'piedi') {
      const A = punto(p.da), B = punto(p.a);
      tratte.push({ modo: 'piedi', da: A, a: B, minuti: Math.round(e.minuti), metri: Math.round(e.metri * TORTUOSITA), geometria: [[A.lon, A.lat], [B.lon, B.lat]], partenza: t });
    } else if (e.tipo === 'sali') {
      const l = rete.linee.get(e.linea);
      tratte.push({ modo: l.tipo === 'ferrovia' ? 'treno' : l.tipo, indicativa: Boolean(l.indicativa), linea: e.linea, nomeLinea: l.nome, colore: l.colore, operatore: l.operatore, da: punto(p.da), a: null, minuti: 0, attesaMin: Math.round(e.attesa), fermate: 0, geometria: [], partenza: t + e.attesa * 60_000, tempoReale: false });
    } else if (e.tipo === 'corsa') {
      const tr = tratte[tratte.length - 1];
      tr.minuti += e.minuti;
      tr.fermate++;
      tr.a = punto(p.a);
      const g = e.inverso ? [...e.arco.geometria].reverse() : e.arco.geometria;
      tr.geometria.push(...(tr.geometria.length ? g.slice(1) : g));
    }
    t += e.minuti * 60_000;
  }
  for (const tr of tratte) tr.minuti = Math.max(1, Math.round(tr.minuti));
  // due tratti a piedi di fila (arrivo in stazione + cambio) diventano uno
  const unite = [];
  for (const tr of tratte) {
    const u = unite[unite.length - 1];
    if (u && u.modo === 'piedi' && tr.modo === 'piedi') {
      u.a = tr.a;
      u.minuti += tr.minuti;
      u.metri += tr.metri;
      u.geometria.push(tr.geometria[1]);
    } else unite.push(tr);
  }
  const minuti = Math.round(tempo.get('D'));
  const mezzi = unite.filter((x) => x.modo !== 'piedi');
  return {
    fonte: 'locale',
    partenza: ts,
    arrivo: ts + minuti * 60_000,
    minuti,
    cambi: Math.max(0, mezzi.length - 1),
    tratte: unite,
    linee: mezzi.map((x) => x.linea),
    soloPiedi: mezzi.length === 0,
  };
}

/** Le stazioni più vicine a un punto, con minuti a piedi e corse programmate nell'ora. */
export function stazioniVicine(rete, punto, { n = 3, maxMetri = 1200, ts = Date.now() } = {}) {
  return [...rete.stazioni.values()]
    .map((s) => ({ ...s, m: Math.round(metri(punto, s)) }))
    .filter((s) => s.m <= maxMetri)
    .sort((a, b) => a.m - b.m)
    .slice(0, n)
    .map((s) => ({ ...s, piedi: minutiAPiedi(s.m), corseOra: corseOra(s, ts) }));
}
