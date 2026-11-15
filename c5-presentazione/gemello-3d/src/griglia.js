// Strato "Presenze per cella": la città come la vede una rete mobile, a celle esagonali.
//
// Per ogni cella (dati/griglia.json, generata da strumenti/genera-griglia.mjs):
//   presenze = fondo + luoghi
//   fondo    = volume edificato della cella (REALE, da OpenStreetMap) × persone per m³ × curva della giornata
//   luoghi   = le stime dei luoghi monitorati (modello.js) distribuite sulle celle entro ~450 m
// Il colore della cella è la "pressione": quanto i luoghi vicini sono pieni rispetto alla loro soglia.
//
// Privacy by design: le celle sotto SOGLIA_PRIVACY presenze non vengono mostrate (come nei dati
// aggregati e anonimi degli operatori, che non pubblicano i conteggi piccoli).
// Modulo isomorfo, senza rete.

import { LUOGHI3D } from './luoghi3d.js';
import { tipoGiorno } from './modello.js';
import * as N from '../../../citta-api/fonti/normalizza.js';

export const SOGLIA_PRIVACY = 20;

/** Ipotesi dello strato a celle. */
export const IPOTESI_GRIGLIA = Object.freeze({
  personeOgniMilleM3: 6.2, // ≈ 1,05 milioni di presenze notturne nell'area della griglia (Napoli e comuni confinanti)
  volumeMassimo: 400, // migliaia di m³: oltre (capannoni, hangar, porto) il volume non porta più persone
  sigma: 170, // metri: quanto si allarga la folla di un luogo sulle celle vicine
  raggio: 450, // metri: celle considerate attorno a un luogo
});

/** Presenze di fondo rispetto alla notte: di giorno entrano pendolari e visitatori (ipotesi). */
function curvaFondo(ts) {
  const p = N.partiLocali(ts);
  const h = p.ora + p.minuto / 60;
  const giorno = Math.exp(-(((h - 13.5) / 4.2) ** 2) / 2);
  return 1 + (tipoGiorno(ts) === 'fer' ? 0.18 : 0.07) * giorno;
}

/**
 * Prepara la griglia: centri, esagoni e pesi dei luoghi vicini.
 * @param {{origine:{lon:number,lat:number}, raggio:number, celle:number[][]}} json
 */
export function creaGriglia(json, luoghi = LUOGHI3D) {
  const R = json.raggio;
  const kx = 111_320 * Math.cos((json.origine.lat * Math.PI) / 180);
  const ky = 110_540;
  const celle = json.celle.map(([q, r, v]) => {
    const x = R * Math.sqrt(3) * (q + r / 2);
    const y = R * 1.5 * r;
    return { q, r, v, x, y, lon: json.origine.lon + x / kx, lat: json.origine.lat + y / ky };
  });

  /** Vertici dell'esagono (a punta in su), rimpicciolito per lasciare una fuga tra le celle. */
  const esagono = (c, scala = 0.9) => {
    const out = [];
    for (let i = 0; i <= 6; i++) {
      const a = ((60 * i + 30) * Math.PI) / 180;
      out.push([json.origine.lon + (c.x + R * scala * Math.cos(a)) / kx, json.origine.lat + (c.y + R * scala * Math.sin(a)) / ky]);
    }
    return out;
  };

  // per ogni luogo: celle vicine con peso gaussiano normalizzato (la somma dei pesi fa 1)
  const zone = Object.keys(luoghi);
  const pesi = {}; // zona → [{ i, w, rel }]
  for (const z of zone) {
    const l = luoghi[z];
    const lx = (l.lon - json.origine.lon) * kx;
    const ly = (l.lat - json.origine.lat) * ky;
    let lista = [];
    let vicina = null;
    celle.forEach((c, i) => {
      const d = Math.hypot(c.x - lx, c.y - ly);
      if (!vicina || d < vicina.d) vicina = { i, d };
      if (d <= IPOTESI_GRIGLIA.raggio) lista.push({ i, w: Math.exp(-((d / IPOTESI_GRIGLIA.sigma) ** 2) / 2) });
    });
    if (!lista.length && vicina) lista = [{ i: vicina.i, w: 1 }];
    const somma = lista.reduce((s, x) => s + x.w, 0) || 1;
    const massimo = Math.max(...lista.map((x) => x.w), 1e-9);
    pesi[z] = lista.map((x) => ({ i: x.i, w: x.w / somma, rel: x.w / massimo }));
  }

  const fondoNotte = celle.map((c) => Math.min(c.v, IPOTESI_GRIGLIA.volumeMassimo) * IPOTESI_GRIGLIA.personeOgniMilleM3);
  const ordinati = [...fondoNotte].sort((a, b) => a - b);
  const fondoAlto = ordinati[Math.floor(ordinati.length * 0.97)] || 1;

  /**
   * Presenze e pressione di ogni cella per un quadro del modello (stime dei luoghi a un istante).
   * @returns {{presenze: Float32Array, pressione: Float32Array, totale: number, nascoste: number}}
   */
  function calcola(quadro, ts) {
    const curva = curvaFondo(ts);
    const presenze = new Float32Array(celle.length);
    const pressione = new Float32Array(celle.length);
    for (let i = 0; i < celle.length; i++) {
      presenze[i] = fondoNotte[i] * curva;
      pressione[i] = Math.min(0.34, (fondoNotte[i] / fondoAlto) * 0.3);
    }
    for (const z of zone) {
      const s = quadro[z];
      if (!s) continue;
      for (const p of pesi[z]) {
        presenze[p.i] += s.persone * p.w;
        pressione[p.i] = Math.max(pressione[p.i], s.quota * p.rel);
      }
    }
    let totale = 0;
    let nascoste = 0;
    for (let i = 0; i < celle.length; i++) {
      totale += presenze[i];
      if (presenze[i] < SOGLIA_PRIVACY) nascoste++;
    }
    return { presenze, pressione, totale: Math.round(totale), nascoste };
  }

  return { celle, esagono, calcola, raggio: R, pesi };
}

/** Livello (id) di una pressione, con le stesse soglie dell'affollamento dei luoghi. */
export function livelloPressione(p) {
  return p < 0.35 ? 'tranquillo' : p < 0.6 ? 'normale' : p < 0.85 ? 'vivace' : 'affollato';
}
