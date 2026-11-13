// Verifica (backtest): confronto tra previsione e risultati veri.
// Serve in sede quando Bhblasted rivela i risultati.

/**
 * @param {object} pred buildPrediction(...)
 * @param {object} reali { vincitore?: id, annunci: { [id]: { ctr?, cpm?, ctrSegmenti?: {segId: ctr} } } }
 */
export function evaluateBacktest(pred, reali) {
  const righe = [];
  const errAss = [];
  const errRel = [];
  let cpmDentro = 0; let cpmTot = 0;
  const segCoppie = [];

  for (const a of pred.annunci) {
    const r = reali.annunci?.[a.id] || {};
    const riga = { id: a.id, nome: a.nome, ctrPrevisto: a.ctr, cpm: a.cpm };
    if (isNum(r.ctr)) {
      riga.ctrReale = r.ctr;
      riga.erroreAss = a.ctr - r.ctr;
      riga.erroreRel = r.ctr > 0 ? (a.ctr - r.ctr) / r.ctr : null;
      riga.ctrNellaFascia = r.ctr >= a.ctrMin && r.ctr <= a.ctrMax;
      errAss.push(Math.abs(riga.erroreAss));
      if (riga.erroreRel != null) errRel.push(Math.abs(riga.erroreRel));
    }
    if (isNum(r.cpm)) {
      riga.cpmReale = r.cpm;
      riga.cpmDentro = r.cpm >= a.cpm.min && r.cpm <= a.cpm.max;
      riga.cpmScarto = r.cpm < a.cpm.min ? (r.cpm - a.cpm.min) / a.cpm.min : r.cpm > a.cpm.max ? (r.cpm - a.cpm.max) / a.cpm.max : 0;
      cpmTot++;
      if (riga.cpmDentro) cpmDentro++;
    }
    const segReali = r.ctrSegmenti || {};
    riga.segmenti = [];
    for (const [segId, v] of Object.entries(segReali)) {
      if (!isNum(v) || !(segId in a.ctrSegmenti)) continue;
      riga.segmenti.push({ seg: segId, previsto: a.ctrSegmenti[segId], reale: v });
      segCoppie.push({ previsto: a.ctrSegmenti[segId], reale: v });
    }
    righe.push(riga);
  }

  // vincitore: indicato esplicitamente o dedotto dal CTR reale più alto
  let vincitoreReale = reali.vincitore || null;
  if (!vincitoreReale) {
    const conCtr = righe.filter((x) => isNum(x.ctrReale));
    if (conCtr.length >= 2) vincitoreReale = conCtr.sort((x, y) => y.ctrReale - x.ctrReale)[0].id;
  }
  const vincitorePrevisto = pred.vincitore?.id;

  // ordine completo (per 3+ annunci)
  const conCtr = righe.filter((x) => isNum(x.ctrReale));
  const rank = conCtr.length >= 3 ? spearman(conCtr.map((x) => x.ctrPrevisto), conCtr.map((x) => x.ctrReale)) : null;

  return {
    vincitore: vincitoreReale ? { previsto: vincitorePrevisto, reale: vincitoreReale, corretto: vincitorePrevisto === vincitoreReale } : null,
    ctr: errAss.length ? { maePuntiPct: mean(errAss), mapePct: errRel.length ? mean(errRel) * 100 : null, n: errAss.length } : null,
    cpm: cpmTot ? { dentro: cpmDentro, totale: cpmTot } : null,
    segmenti: segCoppie.length ? { maePuntiPct: mean(segCoppie.map((c) => Math.abs(c.previsto - c.reale))), spearman: segCoppie.length >= 3 ? spearman(segCoppie.map((c) => c.previsto), segCoppie.map((c) => c.reale)) : null, n: segCoppie.length } : null,
    ordine: rank,
    righe,
  };
}

function ranks(arr) {
  const idx = arr.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const r = new Array(arr.length);
  for (let i = 0; i < idx.length;) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2 + 1;
    i = j + 1;
  }
  return r;
}

export function spearman(a, b) {
  const ra = ranks(a); const rb = ranks(b);
  const ma = mean(ra); const mb = mean(rb);
  let num = 0; let da = 0; let db = 0;
  for (let i = 0; i < ra.length; i++) {
    num += (ra[i] - ma) * (rb[i] - mb);
    da += (ra[i] - ma) ** 2;
    db += (rb[i] - mb) ** 2;
  }
  return da && db ? num / Math.sqrt(da * db) : null;
}

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const mean = (a) => a.reduce((s, x) => s + x, 0) / (a.length || 1);
