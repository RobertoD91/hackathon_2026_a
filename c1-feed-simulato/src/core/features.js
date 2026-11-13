// Estrazione di caratteristiche misurabili dall'annuncio (testo, CTA, immagine).
// Sono la base del punteggio euristico della modalità mock.

import { CTA } from './data.js';
import { clamp } from './rng.js';

const RE = {
  prezzo: /(\d+[.,]?\d*\s?€|€\s?\d+|\b\d+[.,]?\d*\s?euro\b)/i,
  sconto: /(-\s?\d{1,2}\s?%|\d{1,2}\s?%|\bscont[oi]\b|\bsaldi\b|\bpromo(zione)?\b|\bofferta\b|black\s?friday|cyber\s?monday|\bcoupon\b|\bcodice\b)/i,
  gratis: /(\bgratis\b|\bgratuit[aoie]\b|\bomaggio\b|\bin regalo\b|\bfree\b)/i,
  urgenza: /(solo oggi|\bultim[ie]\b|\bscade\b|\bentro\b|fino a (domenica|lunedì|lunedi|martedì|martedi|mercoledì|mercoledi|giovedì|giovedi|venerdì|venerdi|sabato|stasera|mezzanotte|esaurimento)|pochi pezzi|tempo limitato|affrettati|non perdere|solo per \d+|ancora \d+ (giorni|ore))/i,
  riprova: /(recension|clienti soddisfatti|più vendut|piu vendut|★|\bstelle\b|\b\d+[.,]?\d*\s?(mila|k)\s+(clienti|persone|utenti|famiglie)|consigliat[oaie]|scelto da)/i,
  beneficio: /(risparmi|comod|facil|veloc|legger|sostenibil|riciclat|garanzi|resi gratuiti|spedizione|consegna|in \d+ minuti|senza pensieri|resistent|natural)/i,
  tu: /\b(tu|ti|tuo|tua|tuoi|tue|scopri|prova|regalati|immagina|trova)\b/i,
  invito: /(clicca|scopri|acquista|compra|ordina|prenota|iscriviti|link in bio|scarica|approfitta|vai su)/i,
  scontoGrande: /(-\s?[5-9]\d\s?%|\b[5-9]\d\s?%)/,
  volti: /(person[ae]|donn[ae]|uom[oi]|ragazz[aoie]|volto|viso|sorrid|famiglia|bambin|modell[ao])/i,
  prodotto: /(prodotto|scarp|sneaker|bottigli|confezion|packshot|oggetto|still life|piatto|telefono|zaino|borsa)/i,
};

const countMatches = (s, re) => (s.match(re) || []).length;

function words(s) {
  return s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));
}

/**
 * Caratteristiche dell'annuncio (tutti i valori numerici sono semplici da spiegare).
 */
export function extractFeatures(ad) {
  const testo = ad.testo || '';
  const titolo = ad.titolo || '';
  const tutto = `${titolo}\n${testo}`;
  const w = words(testo);
  const nParole = w.length;
  const primaFrase = (testo.split(/(?<=[.!?\n])\s+/)[0] || '').trim();
  const paroleIniziali = words(testo).slice(0, 12).join(' ');
  const lettere = tutto.replace(/[^\p{L}]/gu, '');
  const maiuscole = words(tutto).filter((x) => x.length >= 3 && x === x.toUpperCase() && /\p{Lu}/u.test(x)).length;

  const ctaDef = CTA[ad.cta] || (ad.cta && ad.cta !== 'Nessuna' ? { forza: 0.6, obiettivi: [] } : CTA['Nessuna']);
  const offerta = RE.sconto.test(tutto) || RE.prezzo.test(tutto) || RE.gratis.test(tutto);
  const offertaPresto = RE.sconto.test(`${titolo} ${paroleIniziali}`) || RE.prezzo.test(`${titolo} ${paroleIniziali}`) || RE.gratis.test(`${titolo} ${paroleIniziali}`);
  const beneficioPresto = RE.beneficio.test(`${titolo} ${paroleIniziali}`);

  // chiarezza 0..1: si capisce cosa offri nei primi secondi?
  let chiarezza = 0.45;
  if (titolo && words(titolo).length <= 8) chiarezza += 0.15;
  if (words(primaFrase).length <= 12) chiarezza += 0.1;
  if (offertaPresto) chiarezza += 0.15;
  else if (beneficioPresto) chiarezza += 0.08;
  if (nParole > 45) chiarezza -= 0.15;
  if (countMatches(tutto, /!/g) > 3) chiarezza -= 0.1;
  if (maiuscole > 3) chiarezza -= 0.1;
  if (!testo && !titolo) chiarezza = 0.1;

  const img = ad.imageStats || null;
  const desc = ad.descrizioneImmagine || '';
  const haImmagine = Boolean(ad.immagine || img || desc);

  return {
    nParole,
    nParoleTitolo: words(titolo).length,
    haTitolo: Boolean(titolo),
    prezzo: RE.prezzo.test(tutto),
    sconto: RE.sconto.test(tutto),
    scontoGrande: RE.scontoGrande.test(tutto),
    gratis: RE.gratis.test(tutto),
    offerta,
    offertaPresto,
    urgenza: RE.urgenza.test(tutto),
    riprova: RE.riprova.test(tutto),
    beneficio: RE.beneficio.test(tutto),
    tu: RE.tu.test(tutto),
    domanda: tutto.includes('?'),
    emoji: countMatches(tutto, /\p{Extended_Pictographic}/gu),
    hashtag: countMatches(tutto, /#[\p{L}\p{N}_]+/gu),
    esclamativi: countMatches(tutto, /!/g),
    maiuscole,
    lettere: lettere.length,
    invitoNelTesto: RE.invito.test(tutto),
    ctaForza: ctaDef.forza,
    ctaCoerente: ctaDef.obiettivi.includes(ad.obiettivo),
    ctaNome: ad.cta || 'Nessuna',
    chiarezza: clamp(chiarezza, 0, 1),
    haImmagine,
    immagine: img
      ? { luminosita: img.luminosita ?? 0.5, contrasto: img.contrasto ?? 0.3, saturazione: img.saturazione ?? 0.35, colori: img.colori ?? 0.3 }
      : null,
    volti: RE.volti.test(desc),
    soloProdotto: RE.prodotto.test(desc) && !RE.volti.test(desc),
  };
}

/** Riassunto leggibile delle caratteristiche, per la UI. */
export function featureChips(f) {
  const chips = [];
  chips.push({ ok: f.nParole <= 25, testo: `${f.nParole} parole` });
  if (f.offertaPresto) chips.push({ ok: true, testo: 'offerta nei primi secondi' });
  else if (f.offerta) chips.push({ ok: true, testo: 'offerta nel testo' });
  else chips.push({ ok: false, testo: 'nessuna offerta o prezzo' });
  if (f.urgenza) chips.push({ ok: true, testo: 'urgenza' });
  if (f.riprova) chips.push({ ok: true, testo: 'riprova sociale' });
  chips.push({ ok: f.ctaForza >= 0.6, testo: `CTA: ${f.ctaNome}` });
  if (!f.ctaCoerente && f.ctaForza > 0) chips.push({ ok: false, testo: 'CTA poco coerente con l\'obiettivo' });
  if (f.emoji) chips.push({ ok: f.emoji <= 4, testo: `${f.emoji} emoji` });
  if (f.maiuscole > 3 || f.esclamativi > 3) chips.push({ ok: false, testo: 'troppe maiuscole o "!": sembra spam' });
  if (f.scontoGrande) chips.push({ ok: false, testo: 'sconto molto alto: può sembrare sospetto' });
  if (f.chiarezza < 0.45) chips.push({ ok: false, testo: 'messaggio poco chiaro' });
  if (f.immagine) {
    if (f.immagine.luminosita < 0.3) chips.push({ ok: false, testo: 'immagine scura' });
    if (f.immagine.saturazione > 0.4) chips.push({ ok: true, testo: 'colori vivaci' });
    if (f.immagine.saturazione < 0.18) chips.push({ ok: false, testo: 'colori spenti' });
  } else if (!f.haImmagine) chips.push({ ok: false, testo: 'senza immagine' });
  if (f.volti) chips.push({ ok: true, testo: 'persone nell\'immagine' });
  return chips;
}
