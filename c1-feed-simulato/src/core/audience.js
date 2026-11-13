// Generazione del pubblico sintetico.
// Il campione è stratificato: lo stesso numero di persone virtuali per segmento,
// ognuna con un peso pari alla quota di popolazione che rappresenta.

import { makeRng, pickWeighted, pick, clamp, gauss } from './rng.js';

export const GENERI = { F: 'Donne', M: 'Uomini' };

/** Elenco dei segmenti (fascia d'età × genere, oppure solo fascia). */
export function buildSegments(pop, { dividiPerGenere = true } = {}) {
  const segs = [];
  for (const f of pop.fasce_eta) {
    if (dividiPerGenere) {
      for (const g of ['F', 'M']) {
        const quota = g === 'F' ? f.quota_f : 1 - f.quota_f;
        segs.push({ id: `${f.id}|${g}`, fascia: f.id, genere: g, label: `${labelFascia(f.id)} ${g}`, milioni: f.milioni * quota, min: f.min, max: f.max });
      }
    } else {
      segs.push({ id: `${f.id}|T`, fascia: f.id, genere: 'T', label: labelFascia(f.id), milioni: f.milioni, min: f.min, max: f.max });
    }
  }
  return segs;
}

export function labelFascia(id) {
  return id.replace('-', '–');
}

function nomePer(pop, rng, genere, eta) {
  const gen = eta < 35 ? 'giovani' : eta < 55 ? 'adulti' : 'senior';
  const nome = pick(rng, pop.nomi[`${genere}_${gen}`]);
  const iniziale = 'ABCDEFGLMNPRSTV'[Math.floor(rng() * 15)];
  return `${nome} ${iniziale}.`;
}

/**
 * Genera il pubblico.
 * @param {object} pop popolazione.json
 * @param {object} cfg { perSegmento, dividiPerGenere, seme }
 */
export function generateAudience(pop, cfg = {}) {
  const perSegmento = clamp(Math.round(cfg.perSegmento ?? 200), 20, 2000);
  const seme = String(cfg.seme ?? 42);
  const segments = buildSegments(pop, cfg);
  const interessi = Object.entries(pop.interessi).filter(([k]) => !k.startsWith('_'));
  const personas = [];

  for (const seg of segments) {
    const rng = makeRng(`aud|${seme}|${seg.id}`);
    const tratti = pop.tratti_per_eta[seg.fascia];
    for (let i = 0; i < perSegmento; i++) {
      const genere = seg.genere === 'T' ? (rng() < pop.fasce_eta.find((f) => f.id === seg.fascia).quota_f ? 'F' : 'M') : seg.genere;
      // età uniforme nella fascia, con meno peso agli ultra-settantenni
      let eta = seg.min + Math.floor(rng() * (seg.max - seg.min + 1));
      if (eta > 72 && rng() < 0.5) eta -= 10;
      const area = pickWeighted(rng, pop.aree, (a) => a.quota);
      const citta = pick(rng, area.citta);
      const ints = [];
      for (const [nome, def] of interessi) {
        const p = clamp(def.eta[seg.fascia] * (def[genere] ?? 1), 0, 0.95);
        if (rng() < p) ints.push(nome);
      }
      const id = `${seg.id}#${i}`;
      const jit = (k, s) => clamp(tratti[k] + s * gauss(seme, id, k), 0.02, 0.98);
      personas.push({
        id,
        seg: seg.id,
        fascia: seg.fascia,
        nome: nomePer(pop, rng, genere, eta),
        eta,
        genere,
        area: area.id,
        areaNome: area.nome,
        citta,
        interessi: ints,
        tratti: {
          parole: Math.max(6, Math.round(tratti.parole_tollerate * (1 + 0.25 * gauss(seme, id, 'parole')))),
          emoji: jit('emoji', 0.15),
          prezzo: jit('prezzo', 0.18),
          scetticismo: jit('scetticismo', 0.15),
          riprova: jit('riprova_sociale', 0.15),
        },
        // milioni di persone rappresentate da questa persona virtuale
        peso: seg.milioni / perSegmento,
      });
    }
  }
  return { segments, personas, perSegmento, seme };
}

/** Breve profilo testuale, usato nei prompt per l'LLM e nei tooltip. */
export function describePersona(p) {
  const g = p.genere === 'F' ? 'donna' : 'uomo';
  const ints = p.interessi.length ? p.interessi.slice(0, 4).join(', ').replace(/_/g, ' ') : 'nessun interesse particolare';
  return `${p.nome}, ${g}, ${p.eta} anni, ${p.citta} (${p.areaNome}). Interessi: ${ints}.`;
}
