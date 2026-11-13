// Simulazione: ogni persona virtuale "vede" ogni annuncio nel feed.
// Gira identica in Node (server.js, cli.js) e nel browser (modalità statica).
// L'LLM, se presente, è un passaggio facoltativo (opzione `refine`) che corregge
// i numeri di un campione di persone per segmento e scrive commenti e motivi.

import { generateAudience } from './audience.js';
import { extractFeatures, featureChips } from './features.js';
import { scorePersona, adContext } from './heuristic.js';
import { reactAndComment } from './comments.js';
import { topMotivi } from './reasons.js';
import { clamp } from './rng.js';

export const VERSIONE_MODELLO = 'mock-euristico-1';
const MAX_COMMENTI_SEGMENTO = 14;

/**
 * @param {object} opts
 * @param {object[]} opts.ads annunci normalizzati (normalizeAd)
 * @param {object} opts.data { popolazione, benchmark }
 * @param {object} [opts.config] { perSegmento, dividiPerGenere, seme }
 * @param {Function} [opts.refine] async ({ad, features, segment, campione}) => {persone:[...], modello} | null
 * @param {Function} [opts.onProgress] (done, total, msg)
 */
export async function runSimulation({ ads, data, config = {}, refine, onProgress, modo = 'mock', modello = VERSIONE_MODELLO }) {
  const cfg = { perSegmento: 200, dividiPerGenere: true, seme: 42, campioneLlm: 4, ...config };
  const seme = String(cfg.seme);
  const pop = data.popolazione;
  const audience = generateAudience(pop, cfg);
  const bySeg = new Map(audience.segments.map((s) => [s.id, audience.personas.filter((p) => p.seg === s.id)]));
  const totalSteps = ads.length * audience.segments.length * (refine ? 2 : 1);
  let done = 0;
  const llmErrori = [];

  // valutazione euristica di un segmento (deterministica, si può ricalcolare)
  const prepared = ads.map((ad) => {
    const f = extractFeatures(ad);
    return { ad, f, ctx: adContext(ad, f) };
  });
  const evalSegment = ({ ad, f, ctx }, seg) => {
    const valutate = bySeg.get(seg.id).map((p) => ({ p, ev: scorePersona(p, ad, f, ctx, seme) }));
    const inT = valutate.filter((x) => x.ev.target);
    const fuoriTarget = inT.length < 10;
    return { valutate, inT, fuoriTarget, usate: fuoriTarget ? valutate : inT };
  };

  // passaggio LLM facoltativo, in parallelo con concorrenza limitata
  const llmRes = new Map();
  if (refine) {
    const tasks = [];
    for (const pr of prepared) {
      for (const seg of audience.segments) {
        const { usate } = evalSegment(pr, seg);
        tasks.push({ key: `${pr.ad.id}|${seg.id}`, run: () => refine({ ad: pr.ad, features: pr.f, segment: seg, campione: campione(usate, cfg.campioneLlm) }), label: `${pr.ad.nome} / ${seg.label}` });
      }
    }
    let next = 0;
    const worker = async () => {
      while (next < tasks.length) {
        const t = tasks[next++];
        try {
          llmRes.set(t.key, await t.run());
        } catch (err) {
          llmErrori.push(`${t.label}: ${err.message}`);
        }
        done++;
        if (onProgress) onProgress(done, totalSteps, `LLM: ${t.label}`);
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, cfg.concorrenza || 6) }, worker));
  }

  const annunci = [];
  for (const pr of prepared) {
    const { ad, f, ctx } = pr;
    const uso = pop.uso_social[ad.piattaforma] || pop.uso_social.instagram;
    const segOut = {};
    const commenti = [];

    for (const seg of audience.segments) {
      const { valutate, inT, fuoriTarget, usate } = evalSegment(pr, seg);
      const quotaTarget = inT.length / valutate.length;
      const llm = llmRes.get(`${ad.id}|${seg.id}`) || null;

      let stop = 0; let click = 0; let like = 0; let nInteresse = 0;
      const reazioni = { click: 0, like: 0, commento: 0, ignora: 0 };
      const somme = new Map();
      const segCommenti = [];
      for (const { p, ev } of usate) {
        stop += ev.pStop; click += ev.pClick; like += ev.pLike;
        if (ev.interesse) nInteresse++;
        for (const [code, v] of ev.contrib) somme.set(code, (somme.get(code) || 0) + v);
        const rx = reactAndComment(p, ev, ctx.hash, seme);
        reazioni[rx.reazione]++;
        if (rx.commento && segCommenti.length < MAX_COMMENTI_SEGMENTO) {
          segCommenti.push(commentOf(p, rx.commento, rx.motivo, rx.reazione, 'mock'));
        }
      }
      const n = usate.length;
      let fattoreLlm = null;
      if (llm && llm.persone?.length) {
        const byId = new Map(campione(usate, cfg.campioneLlm).map((x) => [x.p.id, x]));
        let hStop = 0; let hClick = 0; let lStop = 0; let lClick = 0; let k = 0;
        const llmCommenti = [];
        for (const r of llm.persone) {
          const x = byId.get(r.id);
          if (!x) continue;
          k++;
          hStop += x.ev.pStop; hClick += x.ev.pClick;
          lStop += clamp(Number(r.p_stop) || 0, 0, 1);
          lClick += clamp(Number(r.p_click) || 0, 0, 1) * clamp(Number(r.p_stop) || 0, 0, 1);
          if (r.commento) llmCommenti.push(commentOf(x.p, r.commento, r.motivo || '', r.reazione || 'commento', 'llm'));
        }
        if (k) {
          // l'LLM corregge il livello del segmento (rapporto con l'euristica), non lo sostituisce
          // peso di credibilità: con pochi giudizi LLM la correzione viene attenuata
          const w = k / (k + 4);
          const fs = clamp((lStop / Math.max(hStop, 1e-6)) ** w, 0.4, 2.5);
          const fc = clamp((lClick / Math.max(hClick, 1e-6)) ** w, 0.25, 4);
          stop *= fs; click *= fc;
          fattoreLlm = { stop: round(fs, 3), click: round(fc, 3), campione: k, modello: llm.modello };
          segCommenti.unshift(...llmCommenti);
        }
      }

      const usoSeg = uso[seg.fascia] ?? 0.3;
      const milioniTarget = seg.milioni * quotaTarget;
      segOut[seg.id] = {
        persone: n,
        quotaTarget: round(quotaTarget, 3),
        fuoriTarget,
        // milioni di persone del target che usano la piattaforma: pesa le impression
        esposizione: round(milioniTarget * usoSeg, 4),
        stop: round(stop / n, 5),
        click: round(click / n, 6),
        like: round(like / n, 5),
        reazioni,
        motivi: motiviSegmento(somme, n, nInteresse / n),
        llm: fattoreLlm,
        vociLlm: fattoreLlm ? segCommenti.filter((c) => c.fonte === 'llm').map((c) => c.motivo).filter(Boolean).slice(0, 3) : [],
      };
      commenti.push(...segCommenti);
      done++;
      if (onProgress) onProgress(done, totalSteps, `${ad.nome}: ${seg.label}`);
    }

    // totali pesati sull'esposizione (solo segmenti nel target)
    const segsIn = Object.values(segOut).filter((s) => !s.fuoriTarget);
    const W = segsIn.reduce((a, s) => a + s.esposizione, 0) || 1;
    const tot = (k) => segsIn.reduce((a, s) => a + s[k] * s.esposizione, 0) / W;
    const reazioniTot = { click: 0, like: 0, commento: 0, ignora: 0 };
    for (const s of segsIn) for (const k of Object.keys(reazioniTot)) reazioniTot[k] += s.reazioni[k];

    const { imageStats, ...adLeggero } = ad;
    annunci.push({
      id: ad.id,
      nome: ad.nome,
      ad: { ...adLeggero, immagine: ad.immagine && ad.immagine.startsWith('data:') ? '' : ad.immagine, imageStats },
      features: f,
      chips: featureChips(f),
      interessi: ctx.interessi,
      periodo: ctx.periodo,
      segmenti: segOut,
      totale: {
        stop: round(tot('stop'), 5),
        click: round(tot('click'), 6),
        like: round(tot('like'), 5),
        esposizione: round(W, 4),
        reazioni: reazioniTot,
      },
      commenti,
    });
  }

  return {
    versione: 1,
    modo,
    modello,
    creato: new Date().toISOString(),
    config: { perSegmento: audience.perSegmento, dividiPerGenere: cfg.dividiPerGenere !== false, seme },
    segmenti: audience.segments.map(({ id, label, fascia, genere, milioni }) => ({ id, label, fascia, genere, milioni: round(milioni, 3) })),
    personeTotali: audience.personas.length,
    llmErrori,
    annunci,
  };
}

/**
 * Motivi del segmento. "interesse" e "no_interesse" sono due facce della stessa
 * cosa: li fondiamo in un solo motivo con la quota di persone interessate.
 */
function motiviSegmento(somme, n, quotaInteresse) {
  const m = new Map(somme);
  if (m.has('interesse') || m.has('no_interesse')) {
    const net = (m.get('interesse') || 0) + (m.get('no_interesse') || 0);
    m.delete('interesse');
    m.delete('no_interesse');
    m.set(net >= 0 ? 'interesse' : 'no_interesse', net);
  }
  const out = topMotivi(m, n);
  const q = Math.round(quotaInteresse * 100);
  for (const x of [...out.pos, ...out.neg]) {
    if (x.code === 'interesse') x.testo = `il prodotto rientra negli interessi di molti (${q}% del segmento)`;
    if (x.code === 'no_interesse') x.testo = `il prodotto interessa a pochi (${q}% del segmento)`;
  }
  return out;
}

function campione(usate, k) {
  return [...usate].sort((a, b) => a.p.id.localeCompare(b.p.id, 'en', { numeric: true })).slice(0, k);
}

function commentOf(p, testo, motivo, reazione, fonte) {
  return { personaId: p.id, nome: p.nome, eta: p.eta, genere: p.genere, citta: p.citta, seg: p.seg, testo, motivo, reazione, fonte };
}

function round(x, d) {
  const m = 10 ** d;
  return Math.round(x * m) / m;
}
