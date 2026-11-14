// Ricerca tollerante di luoghi e stazioni: "castel dell'ovo", "plebiscito", "maradona",
// "stadio", "spacca napoli", "plebiscitto" (refuso), "piazza garibaldi", "toledo"...
// Confronta il testo normalizzato (N.piatto: minuscole, senza accenti né punteggiatura) con il
// nome del luogo, il suo id e le `parole` di luoghi.js (vie, piazze, monumenti della zona).

import { piatto } from '../../iot-agents/example/fonti/normalizza.js';

/** Parole che da sole non identificano un luogo. */
const VUOTE = new Set(
  'a ad al alla alle allo ai agli all c che come con da dal dalla dalle dai dagli de dei degli del della delle dell di do e ed fino gli i il in la le lo nel nella nei per qui sono su sul sulla tra un una uno vicino vicina presso zona napoli citta oggi adesso ora dove sta va vado andare arrivo arrivare quanto quanta'.split(' '),
);

const parole = (s) => piatto(s).split(' ').filter(Boolean);
const significative = (tok) => tok.filter((t) => t.length >= 3 && !VUOTE.has(t));
const compatto = (s) => piatto(s).replace(/ /g, '');

/** Distanza di Levenshtein (stringhe corte). */
export function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prec = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prec[j] + 1, cur[j - 1] + 1, prec[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prec = cur;
  }
  return prec[b.length];
}

/** Somiglianza 0-1 tra due parole (1 = uguali; 0,9 se una è l'inizio dell'altra: "castel"/"castello"). */
export function somiglianza(a, b) {
  const m = Math.max(a.length, b.length);
  if (!m) return 1;
  const s = 1 - levenshtein(a, b) / m;
  return Math.min(a.length, b.length) >= 5 && (a.startsWith(b) || b.startsWith(a)) ? Math.max(s, 0.9) : s;
}

/**
 * Punteggio 0-100 di quanto la domanda `q` nomina il candidato `c` (testi già normalizzati).
 * 100 uguali · 95 uguali senza spazi · 90 il candidato è scritto per intero nella domanda ·
 * 85 idem senza spazi · 70 la domanda è una parte del candidato · fino a 65 parole quasi uguali (refusi).
 */
export function punteggio(q, c) {
  if (!q || !c) return 0;
  if (q === c) return 100;
  const qc = q.replace(/ /g, '');
  const cc = c.replace(/ /g, '');
  if (qc === cc) return 95;
  const tq = q.split(' ');
  const tc = c.split(' ');
  const sigC = significative(tc);
  const sigQ = significative(tq);
  if (sigC.length && ` ${q} `.includes(` ${c} `)) return 90;
  if (cc.length >= 5 && sigC.length && qc.includes(cc)) return 85;
  if (sigQ.length && q.length >= 4 && ` ${c} `.includes(` ${q} `)) return 70;
  if (!sigC.length || !sigQ.length) return 0;
  // parole quasi uguali: ogni parola significativa del candidato trova una parola della domanda
  let somma = 0;
  let trovate = 0;
  for (const p of sigC) {
    const migliore = Math.max(...tq.map((x) => (x.length >= 3 ? somiglianza(p, x) : 0)));
    const soglia = p.length >= 8 ? 0.75 : p.length >= 5 ? 0.78 : 0.99;
    if (migliore >= soglia) {
      trovate++;
      somma += migliore;
    }
  }
  if (!trovate) return 0;
  const quota = trovate / sigC.length;
  if (quota === 1) return Math.round(50 + 15 * (somma / trovate));
  // candidato lungo nominato in parte ("castello angioino" per "Maschio Angioino · Castel Nuovo")
  return sigC.length >= 2 && quota >= 0.5 ? Math.round(35 * quota * (somma / trovate)) : 0;
}

/**
 * Luoghi che corrispondono alla domanda, dal migliore: [{ id, luogo, punteggio, con }].
 * @param {string} domanda
 * @param {Record<string, {nome: string, parole?: string[]}>} luoghi  LUOGHI di luoghi.js
 */
export function cercaLuoghi(domanda, luoghi) {
  const q = parole(domanda).join(' ');
  if (!q) return [];
  const out = [];
  for (const [id, l] of Object.entries(luoghi)) {
    let migliore = { punteggio: 0, con: null };
    for (const nome of [l.nome, ...l.nome.split(' · '), id.replace(/_/g, ' '), ...(l.parole || [])]) {
      const p = punteggio(q, parole(nome).join(' '));
      // a parità vince il nome del luogo (prima nella lista)
      if (p > migliore.punteggio) migliore = { punteggio: p, con: nome };
    }
    if (migliore.punteggio > 0) out.push({ id, luogo: l, ...migliore });
  }
  return out.sort((a, b) => b.punteggio - a.punteggio);
}

const ORDINE_TIPO = { metro: 0, ferrovia: 1, funicolare: 2 };

/**
 * Stazioni che corrispondono alla domanda (nome o id), dalla migliore. `linea` (es. "L1",
 * "cumana") restringe alle stazioni di quella linea. A parità: metro, poi treni, poi funicolari.
 * @param {string} domanda
 * @param {Array<{id: string, nome: string, tipo: string, linee: string[]}>} stazioni
 */
export function cercaStazioni(domanda, stazioni, { linea = null } = {}) {
  const lista = (stazioni || []).filter((s) => !linea || s.linee.some((l) => compatto(l) === compatto(linea)));
  const perId = lista.find((s) => s.id === String(domanda).trim());
  if (perId) return [{ stazione: perId, punteggio: 100 }];
  const q = parole(String(domanda).replace(/\b(stazione|fermata|metro|metropolitana|funicolare|linea)\b/gi, ' ')).join(' ');
  if (!q) return [];
  const tq = q.split(' ');
  return lista
    .map((s) => {
      const nomi = [s.nome, s.nome.replace(/^Napoli\s+/i, '')];
      const p = Math.max(...nomi.map((n) => punteggio(q, parole(n).join(' '))));
      // "cumana bagnoli", "l2 montesanto": la linea citata nella domanda fa da spareggio
      const linea = s.linee.some((l) => tq.includes(compatto(l))) ? 5 : 0;
      return { stazione: s, punteggio: p ? p + linea : 0 };
    })
    .filter((x) => x.punteggio >= 50)
    .sort((a, b) => b.punteggio - a.punteggio || ORDINE_TIPO[a.stazione.tipo] - ORDINE_TIPO[b.stazione.tipo] || b.stazione.linee.length - a.stazione.linee.length);
}

/** Soglia sotto la quale una corrispondenza non basta per dire "trovato". */
export const SOGLIA = 50;
