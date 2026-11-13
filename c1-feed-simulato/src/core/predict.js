// Dalla simulazione alla previsione: vincitore, CTR per segmento, fascia di CPM, perché.
// Si ricalcola nel browser a ogni cambio di calibrazione (è istantaneo).

import { simToCtr, ctrRiferimento } from './calibration.js';
import { stimaCpm } from './cpm.js';
import { motivoTesto } from './reasons.js';
import { makeRng } from './rng.js';

export function buildPrediction(sim, bench, calib) {
  const modo = sim.modo === 'mock' ? 'mock' : 'llm';
  const rifSim = calib.riferimentoSimulato[modo] || 0.03;

  const annunci = sim.annunci.map((a) => {
    const ctrSegmenti = {};
    const quotaImpression = {};
    const segIn = Object.entries(a.segmenti).filter(([, s]) => !s.fuoriTarget);
    const W = segIn.reduce((acc, [, s]) => acc + s.esposizione, 0) || 1;
    for (const [id, s] of Object.entries(a.segmenti)) {
      ctrSegmenti[id] = simToCtr(s.click, a.ad, bench, calib, modo);
      quotaImpression[id] = s.fuoriTarget ? 0 : s.esposizione / W;
    }
    const ctr = segIn.reduce((acc, [id]) => acc + ctrSegmenti[id] * quotaImpression[id], 0);
    const k = Math.exp(calib.incertezza);
    const rapporto = a.totale.click / rifSim;
    return {
      id: a.id,
      nome: a.nome,
      ctr,
      ctrMin: ctr / k,
      ctrMax: ctr * k,
      ctrRiferimento: ctrRiferimento(bench, a.ad),
      ctrSegmenti,
      quotaImpression,
      simClick: a.totale.click,
      simStop: a.totale.stop,
      indice: rapporto,
      cpm: stimaCpm(a, bench, calib, rapporto),
      motivi: motiviAnnuncio(a),
    };
  });

  const classifica = [...annunci].sort((x, y) => y.ctr - x.ctr);
  const probVittoria = winProbabilities(annunci, calib.incertezza, sim.config.seme);
  const vincitore = classifica[0];
  const secondo = classifica[1];
  const perSegmento = segmentBreakdown(sim, annunci);
  return {
    modo,
    annunci,
    classifica: classifica.map((a) => a.id),
    probVittoria,
    vincitore: vincitore && {
      id: vincitore.id,
      nome: vincitore.nome,
      probabilita: probVittoria[vincitore.id] ?? 1,
      margine: secondo ? vincitore.ctr / secondo.ctr - 1 : null,
    },
    perSegmento,
    sintesi: sintesi(sim, annunci, classifica, perSegmento, probVittoria),
    calibrazione: calib,
  };
}

/** Somma pesata dei contributi su tutti i segmenti del target. */
function motiviAnnuncio(a) {
  const segs = Object.values(a.segmenti).filter((s) => !s.fuoriTarget);
  const W = segs.reduce((acc, s) => acc + s.esposizione, 0) || 1;
  const somme = new Map();
  for (const s of segs) {
    for (const m of [...s.motivi.pos, ...s.motivi.neg]) somme.set(m.code, (somme.get(m.code) || 0) + m.valore * s.esposizione / W);
  }
  return somme;
}

/**
 * Probabilità che ogni annuncio sia il migliore, con un'incertezza di modello
 * log-normale (σ = calib.incertezza). Monte Carlo deterministico.
 */
function winProbabilities(annunci, sigma, seme) {
  const out = Object.fromEntries(annunci.map((a) => [a.id, 0]));
  if (annunci.length < 2) { if (annunci[0]) out[annunci[0].id] = 1; return out; }
  const rng = makeRng(`win|${seme}`);
  const N = 4000;
  // il ranking relativo è più affidabile del valore assoluto: sulle differenze
  // usiamo metà dell'incertezza assoluta (gli errori comuni si annullano)
  const s = sigma * 0.5;
  for (let i = 0; i < N; i++) {
    let best = null; let bestV = -Infinity;
    for (const a of annunci) {
      const u = Math.max(rng(), 1e-9); const v = rng();
      const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
      const val = Math.log(a.ctr) + s * z;
      if (val > bestV) { bestV = val; best = a.id; }
    }
    out[best]++;
  }
  for (const k of Object.keys(out)) out[k] /= N;
  return out;
}

function segmentBreakdown(sim, annunci) {
  const out = [];
  for (const seg of sim.segmenti) {
    const righe = annunci.map((a) => {
      const sa = sim.annunci.find((x) => x.id === a.id).segmenti[seg.id];
      return { id: a.id, nome: a.nome, ctr: a.ctrSegmenti[seg.id], fuoriTarget: sa.fuoriTarget, quota: a.quotaImpression[seg.id], motivi: sa.motivi, voci: sa.vociLlm, llm: sa.llm, stop: sa.stop };
    });
    const valide = righe.filter((r) => !r.fuoriTarget);
    const best = [...(valide.length ? valide : righe)].sort((x, y) => y.ctr - x.ctr)[0];
    out.push({ id: seg.id, label: seg.label, migliore: best?.id, fuoriTarget: valide.length === 0, righe, frase: fraseSegmento(seg, best, righe) });
  }
  return out;
}

function fraseSegmento(seg, best, righe) {
  if (!best) return '';
  const altri = righe.filter((r) => r.id !== best.id);
  const pos = best.motivi.pos[0];
  const negAltro = altri.map((r) => ({ r, m: r.motivi.neg[0] })).filter((x) => x.m).sort((a, b) => a.m.valore - b.m.valore)[0];
  let s = `${seg.label}: preferisce ${best.nome}`;
  if (pos) s += ` perché ${pos.testo}`;
  if (negAltro && altri.length) s += `; in ${negAltro.r.nome} ${negAltro.m.testo}`;
  return `${s}.`;
}

function sintesi(sim, annunci, classifica, perSegmento, prob) {
  const out = [];
  const pct = (x) => `${x.toLocaleString('it-IT', { maximumFractionDigits: 2, minimumFractionDigits: 2 })}%`;
  const v = classifica[0];
  if (!v) return out;
  if (classifica.length > 1) {
    const s = classifica[1];
    out.push(`Vince ${v.nome}: CTR previsto ${pct(v.ctr)} contro ${pct(s.ctr)} di ${s.nome} (${Math.round((v.ctr / s.ctr - 1) * 100)}% in più). Probabilità che sia davvero la migliore: ${formatProb(prob[v.id] ?? 0)}.`);
    // perché vince: codici dove il vincitore fa meglio del secondo
    const codes = new Set([...v.motivi.keys(), ...s.motivi.keys()]);
    const diff = [...codes].map((c) => ({ c, d: (v.motivi.get(c) || 0) - (s.motivi.get(c) || 0), sv: v.motivi.get(c) || 0, ss: s.motivi.get(c) || 0 }))
      .filter((x) => Math.abs(x.d) > 0.03).sort((a, b) => b.d - a.d);
    const forti = diff.filter((x) => x.d > 0).slice(0, 2).map((x) => (x.sv > 0 ? motivoTesto(x.c, 1, true) : `in ${s.nome} ${motivoTesto(x.c, -1, true)}`));
    if (forti.length) out.push(`Perché: ${forti.join('; ')}.`);
    const contro = diff.filter((x) => x.d < 0).slice(-1).map((x) => (x.ss > 0 ? `${s.nome} fa meglio su un punto: ${motivoTesto(x.c, 1, true)}` : `${v.nome} ha comunque un punto debole: ${motivoTesto(x.c, -1, true)}`));
    if (contro.length) out.push(`${contro[0]}.`);
  } else {
    out.push(`CTR previsto ${pct(v.ctr)} (fascia ${pct(v.ctrMin)}–${pct(v.ctrMax)}).`);
  }
  // segmenti che preferiscono un altro annuncio
  const divergenti = perSegmento.filter((s) => !s.fuoriTarget && s.migliore && s.migliore !== v.id);
  if (divergenti.length && classifica.length > 1) {
    const byAd = new Map();
    for (const s of divergenti) byAd.set(s.migliore, [...(byAd.get(s.migliore) || []), s.label]);
    for (const [id, labels] of byAd) {
      const nome = annunci.find((a) => a.id === id).nome;
      out.push(`Attenzione: per ${labels.join(', ')} funziona meglio ${nome}.`);
    }
  }
  // segmento migliore e peggiore del vincitore
  const segsV = perSegmento.map((s) => ({ s, r: s.righe.find((r) => r.id === v.id) })).filter((x) => !x.r.fuoriTarget);
  if (segsV.length > 1) {
    const top = segsV.sort((a, b) => b.r.ctr - a.r.ctr);
    out.push(`${v.nome} rende di più su ${top[0].s.label} (${pct(top[0].r.ctr)}) e di meno su ${top.at(-1).s.label} (${pct(top.at(-1).r.ctr)}).`);
  }
  if (sim.llmErrori?.length) out.push(`Nota: ${sim.llmErrori.length} chiamate LLM non riuscite, per quei segmenti vale la stima euristica.`);
  return out;
}

export function formatProb(p) {
  if (p > 0.99) return 'oltre il 99%';
  if (p < 0.01) return 'meno dell\'1%';
  return `${Math.round(p * 100)}%`;
}
