// Calibrazione: il tasso di click simulato NON è un CTR.
// Lo usiamo come punteggio relativo e lo convertiamo così:
//   CTR = CTR_riferimento(piattaforma, obiettivo) × settore × scala × (tasso_simulato / riferimento_simulato)^esponente
// Con annunci d'esempio dai risultati noti si tarano `scala` ed `esponente`
// (regressione sui logaritmi) e `cpmScala` (media geometrica reale/previsto).

import { clamp } from './rng.js';

export function defaultCalibration(bench) {
  const d = bench.calibrazione_default || {};
  return {
    fonte: 'default',
    riferimentoSimulato: d.riferimento_simulato || { mock: 0.03, llm: 0.03 },
    scala: d.scala ?? 1,
    esponente: d.esponente ?? 1,
    incertezza: d.incertezza_log ?? 0.3,
    cpmScala: 1,
    punti: 0,
  };
}

export function ctrRiferimento(bench, ad) {
  const tab = bench.ctr_riferimento_pct[ad.piattaforma] || bench.ctr_riferimento_pct.instagram;
  const base = tab[ad.obiettivo] ?? tab.traffico;
  const sett = bench.moltiplicatore_settore[ad.settore] ?? 1;
  return base * sett;
}

/** Converte un tasso di click simulato in CTR previsto (percentuale). */
export function simToCtr(sim, ad, bench, calib, modo = 'mock') {
  const rif = calib.riferimentoSimulato[modo === 'mock' ? 'mock' : 'llm'] || 0.03;
  const r = Math.max(sim, 1e-6) / rif;
  return ctrRiferimento(bench, ad) * calib.scala * r ** calib.esponente;
}

/**
 * Taratura su risultati noti.
 * @param {Array<{sim:number, rif:number, reale:number}>} punti
 *   sim = tasso simulato, rif = CTR di riferimento (%), reale = CTR vero (%)
 */
export function fitCalibration(punti, base, cpmPunti = [], modo = 'mock') {
  const ok = punti.filter((p) => p.sim > 0 && p.reale > 0 && p.rif > 0);
  const out = { ...base, fonte: 'taratura', punti: ok.length };
  const rifSim = base.riferimentoSimulato[modo === 'mock' ? 'mock' : 'llm'] || 0.03;
  if (ok.length) {
    const xs = ok.map((p) => Math.log(p.sim / rifSim));
    const ys = ok.map((p) => Math.log(p.reale / p.rif));
    const mx = mean(xs);
    const my = mean(ys);
    const vx = mean(xs.map((x) => (x - mx) ** 2));
    let b = base.esponente;
    if (ok.length >= 3 && vx > 0.01) {
      b = clamp(mean(xs.map((x, i) => (x - mx) * (ys[i] - my))) / vx, 0.3, 2);
    }
    const a = my - b * mx;
    out.scala = round(Math.exp(a), 4);
    out.esponente = round(b, 3);
    if (ok.length >= 3) {
      const res = xs.map((x, i) => ys[i] - (a + b * x));
      out.incertezza = round(clamp(Math.sqrt(mean(res.map((r) => r * r))), 0.1, 0.8), 3);
    }
  }
  const cp = cpmPunti.filter((p) => p.previsto > 0 && p.reale > 0);
  if (cp.length) {
    out.cpmScala = round(Math.exp(mean(cp.map((p) => Math.log(p.reale / p.previsto)))) * (base.cpmScala || 1), 4);
  }
  out.creata = new Date().toISOString();
  return out;
}

const mean = (a) => a.reduce((s, x) => s + x, 0) / (a.length || 1);
const round = (x, d) => Math.round(x * 10 ** d) / 10 ** d;
