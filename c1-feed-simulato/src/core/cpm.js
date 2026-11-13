// Stima della fascia di CPM con regole esplicite.
// Il CPM non dipende tanto da come reagiscono le persone quanto dall'asta:
// piattaforma, ampiezza del target, età, posizionamento, obiettivo e periodo.

import { PIATTAFORME, POSIZIONAMENTI, OBIETTIVI } from './data.js';
import { clamp } from './rng.js';
import { labelFascia } from './audience.js';

const PERIODO_LABEL = {
  black_friday: 'Black Friday', novembre: 'Novembre', dicembre: 'Dicembre prima di Natale',
  gennaio: 'Gennaio', agosto: 'Agosto', normale: 'Periodo normale',
};

/**
 * @param {object} annuncio voce di sim.annunci
 * @param {object} bench benchmark.json
 * @param {object} calib calibrazione ({ cpmScala })
 * @param {number} rapportoQualita tasso simulato / riferimento (≈1 per un annuncio medio)
 */
export function stimaCpm(annuncio, bench, calib = {}, rapportoQualita = 1) {
  const ad = annuncio.ad;
  const c = bench.cpm;
  const base = c.base_eur[ad.piattaforma] || c.base_eur.instagram;
  const centroBase = (base[0] + base[1]) / 2;
  const fattori = [];
  const add = (nome, mult, motivo) => { fattori.push({ nome, mult: Math.round(mult * 100) / 100, motivo }); return mult; };

  let m = 1;
  const pos = c.posizionamento[ad.posizionamento] || c.posizionamento.feed;
  m *= add(`Posizionamento: ${POSIZIONAMENTI[ad.posizionamento] || ad.posizionamento}`, pos.mult, pos.motivo);
  const ob = c.obiettivo[ad.obiettivo] || c.obiettivo.traffico;
  m *= add(`Obiettivo: ${OBIETTIVI[ad.obiettivo] || ad.obiettivo}`, ob.mult, ob.motivo);

  // età: media dei moltiplicatori pesata sulle impression del target
  const segs = Object.entries(annuncio.segmenti).filter(([, s]) => !s.fuoriTarget);
  const W = segs.reduce((a, [, s]) => a + s.esposizione, 0) || 1;
  const fasce = new Map();
  for (const [id, s] of segs) {
    const f = id.split('|')[0];
    fasce.set(f, (fasce.get(f) || 0) + s.esposizione / W);
  }
  const multEta = [...fasce.entries()].reduce((a, [f, q]) => a + (c.eta[f] ?? 1) * q, 0) || 1;
  const principali = [...fasce.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([f]) => labelFascia(f)).join(' e ');
  m *= add('Età del target', multEta, multEta > 1.02
    ? `Il target è soprattutto ${principali}: fasce con alto potere d'acquisto, molto contese dagli inserzionisti.`
    : multEta < 0.98 ? `Il target è soprattutto ${principali}: fasce meno contese, CPM più basso.` : `Target con età miste (${principali}).`);

  // ampiezza: milioni di persone raggiungibili sulla piattaforma
  const milioni = annuncio.totale.esposizione;
  const soglia = c.ampiezza_target.soglie.find((s) => milioni <= s.fino_a_milioni) || c.ampiezza_target.soglie.at(-1);
  m *= add(`Ampiezza del target: circa ${formatMilioni(milioni)}`, soglia.mult, soglia.motivo);

  const per = c.periodo[annuncio.periodo] || c.periodo.normale;
  m *= add(`Periodo: ${PERIODO_LABEL[annuncio.periodo] || annuncio.periodo}`, per.mult, per.motivo);

  // qualità: un annuncio più rilevante paga un po' meno (effetto piccolo)
  const q = clamp(1 - 0.08 * Math.log(Math.max(rapportoQualita, 0.05)), c.qualita.min, c.qualita.max);
  m *= add('Rilevanza dell\'annuncio', q, q < 0.99
    ? 'L\'annuncio coinvolge più della media: la piattaforma lo premia con un costo un po\' più basso.'
    : q > 1.01 ? 'L\'annuncio coinvolge meno della media: la piattaforma lo penalizza un po\'.' : 'Coinvolgimento nella media.');

  const scala = calib.cpmScala ?? 1;
  if (scala !== 1) m *= add('Taratura in sede', scala, 'Fattore ricavato dai CPM reali degli annunci di esempio.');

  const centro = centroBase * m;
  const amp = c.ampiezza_fascia ?? 0.22;
  return {
    piattaforma: PIATTAFORME[ad.piattaforma] || ad.piattaforma,
    base,
    centro: round2(centro),
    min: round2(centro * (1 - amp)),
    max: round2(centro * (1 + amp)),
    fattori,
  };
}

function formatMilioni(m) {
  if (m >= 1) return `${m.toLocaleString('it-IT', { maximumFractionDigits: 1 })} milioni di persone`;
  return `${Math.round(m * 1000).toLocaleString('it-IT')} mila persone`;
}

const round2 = (x) => Math.round(x * 100) / 100;
