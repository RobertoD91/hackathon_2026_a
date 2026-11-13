// Modello euristico deterministico della modalità mock.
// Per ogni persona virtuale calcola:
//   p_stop  = probabilità di fermarsi sull'annuncio nel feed;
//   p_click = p_stop × probabilità di cliccare dopo essersi fermata.
// Ogni termine del modello è un "motivo" con un codice: i motivi vengono poi
// aggregati per segmento e spiegati in italiano (vedi reasons.js).

import { gauss, sigmoid, hashString } from './rng.js';
import { inTarget } from './ads.js';

/** Parole chiave che collegano il testo dell'annuncio agli interessi delle persone. */
const INTERESSI_RE = {
  moda: /(moda|vestit|scarp|sneaker|borsa|abbigliament|outfit|look|stile|collezione)/i,
  beauty: /(crema|trucco|make.?up|skincare|profum|capelli|cosmetic|beauty|siero)/i,
  sport: /(sport|corsa|running|palestra|fitness|allenament|calcio|bici|yoga|trekking|camminat)/i,
  tecnologia: /(smartphone|telefono|app\b|tech|digitale|computer|cuffie|smart|elettronic|fibra|5g)/i,
  gaming: /(gaming|videogioc|gioca|console|gamer|esport)/i,
  viaggi: /(viagg|vacanz|volo|hotel|weekend|destinazion|crociera|b&b)/i,
  cibo: /(pizza|ristorant|cucina|ricett|cibo|delivery|consegna a domicilio|gelato|caff[eè]|pasta|sapore|gusto)/i,
  casa: /(casa|arredo|divano|cucina componibile|bagno|giardino|elettrodomestic|bollett|luce e gas)/i,
  famiglia: /(famiglia|bambin|figli|mamm|papà|papa\b|scuola|neonat)/i,
  finanza: /(conto|banca|mutuo|prestito|investiment|risparmio|carta di credito|tasso|interessi)/i,
  motori: /(auto\b|automobil|moto\b|scooter|noleggio|concessionari|elettrica|ibrida)/i,
  musica_eventi: /(concerto|festival|biglietti|evento|musica|teatro|spettacolo)/i,
  salute: /(salute|benessere|integrator|farmac|dieta|dormire|stress|medic|visita)/i,
  animali: /(cane|gatto|animali|pet\b|cucciol|crocchette)/i,
  sostenibilita: /(sostenibil|riciclat|ecologic|green|ambiente|plastica|biologic|km 0|impatto)/i,
};

/** Interessi toccati dall'annuncio: settore dichiarato + parole chiave nel testo. */
export function adInterests(ad) {
  const set = new Set();
  if (ad.settore && ad.settore !== 'altro') set.add(ad.settore);
  const txt = `${ad.titolo} ${ad.testo} ${ad.descrizioneImmagine}`;
  for (const [k, re] of Object.entries(INTERESSI_RE)) if (re.test(txt)) set.add(k);
  return [...set];
}

/** Periodo della campagna per stagionalità (usato anche dal CPM). */
export function periodoCampagna(dataIso) {
  const d = new Date(`${dataIso || ''}T12:00:00`);
  if (Number.isNaN(d.getTime())) return 'normale';
  const y = d.getFullYear();
  const m = d.getMonth();
  // Black Friday = ultimo venerdì di novembre; finestra da 7 giorni prima al Cyber Monday
  const fine = new Date(y, 10, 30, 12);
  const bf = new Date(fine);
  bf.setDate(30 - ((fine.getDay() + 2) % 7));
  const da = new Date(bf); da.setDate(bf.getDate() - 7);
  const a = new Date(bf); a.setDate(bf.getDate() + 3);
  if (d >= da && d <= a) return 'black_friday';
  if (m === 10) return 'novembre';
  if (m === 11 && d.getDate() <= 24) return 'dicembre';
  if (m === 0) return 'gennaio';
  if (m === 7) return 'agosto';
  return 'normale';
}

export function adHash(ad) {
  return hashString([ad.titolo, ad.testo, ad.cta, ad.piattaforma, ad.obiettivo, ad.posizionamento, ad.settore,
    JSON.stringify(ad.target), ad.descrizioneImmagine, JSON.stringify(ad.imageStats || {}), ad.dataInizio].join('|')).toString(36);
}

/** Contesto per annuncio calcolato una volta sola. */
export function adContext(ad, f) {
  const img = f.immagine;
  let imgScore = 0;
  if (img) {
    imgScore = 0.9 * (img.saturazione - 0.3) + 0.6 * (img.contrasto - 0.25) + 0.4 * (img.colori - 0.3)
      - 1.6 * Math.max(0, 0.32 - img.luminosita) - 0.8 * Math.max(0, img.luminosita - 0.85);
  }
  return {
    hash: adHash(ad),
    interessi: adInterests(ad),
    periodo: periodoCampagna(ad.dataInizio),
    imgScore,
    verticale: ad.piattaforma === 'tiktok' || ad.posizionamento === 'storie' || ad.posizionamento === 'reels',
  };
}

/**
 * Valuta una persona davanti a un annuncio.
 * @returns {{pStop:number, pClick:number, pLike:number, contrib:Array<[string,number]>, target:boolean, interesse:boolean}}
 */
export const KS = 0.5;
export const KC = 0.35;
export const BASE_STOP = -1.25;
export const BASE_CLICK = -2.2;

export function scorePersona(p, ad, f, ctx, seme = '42') {
  const contrib = [];
  // i pesi sono compressi (KS, KC) perché le differenze tra annunci reali sono
  // dell'ordine di 1,5–4 volte, non di 10 volte
  const add = (code, v) => { if (v) contrib.push([code, v]); return v; };
  const addS = (code, v) => add(code, KS * v);
  const addC = (code, v) => add(code, KC * v);
  const t = p.tratti;
  const target = inTarget(p, ad);
  const interesse = ctx.interessi.some((i) => p.interessi.includes(i));
  const giovane = p.eta < 35;

  // --- fermarsi nel feed -------------------------------------------------
  let s = BASE_STOP;
  if (!f.haImmagine) s += addS('no_immagine', ad.piattaforma === 'facebook' || ad.piattaforma === 'linkedin' ? -1.0 : -1.4);
  else {
    s += addS(ctx.imgScore >= 0 ? 'immagine_forte' : 'immagine_debole', 1.2 * ctx.imgScore);
    if (f.volti) s += addS('volti', giovane ? 0.35 : 0.25);
  }
  if (ctx.interessi.length) s += addS(interesse ? 'interesse' : 'no_interesse', interesse ? 0.75 : -0.25);
  if (f.offertaPresto) s += addS('offerta', 0.55 * t.prezzo);
  else if (f.offerta) s += addS('offerta', 0.25 * t.prezzo);
  const eccesso = (f.nParole - t.parole) / t.parole;
  if (eccesso > 0) s += addS('testo_lungo', -0.7 * Math.min(eccesso, 2));
  else if (f.nParole > 0 && f.nParole <= t.parole * 0.6) s += addS('testo_breve', 0.15);
  if (ctx.verticale && f.nParole > 20) s += addS('formato_piattaforma', -0.3);
  if (ad.piattaforma === 'linkedin' && f.emoji > 2) s += addS('formato_piattaforma', -0.3);
  if (f.haTitolo && f.nParoleTitolo <= 8) s += addS('chiarezza', 0.15);
  if (f.emoji >= 1 && f.emoji <= 4) s += addS(t.emoji >= 0.5 ? 'emoji_ok' : 'emoji_troppe', 0.5 * (t.emoji - 0.5));
  else if (f.emoji > 6) s += addS('emoji_troppe', -0.35);
  if (f.maiuscole > 3 || f.esclamativi > 3) s += addS('maiuscole', -0.6 * t.scetticismo);
  if (!target) s += addS('fuori_target', -0.35);
  if (f.offerta && (ctx.periodo === 'black_friday' || ctx.periodo === 'novembre')) s += addS('stagione', (ctx.periodo === 'black_friday' ? 0.3 : 0.15) * t.prezzo);
  s += 0.35 * gauss(seme, p.id, ctx.hash, 's');

  // --- cliccare dopo essersi fermata ------------------------------------
  let c = BASE_CLICK;
  if (f.ctaForza > 0) c += addC(f.ctaForza >= 0.6 ? 'cta_forte' : 'cta_debole', 0.9 * (f.ctaForza - 0.55));
  else c += addC('cta_debole', f.invitoNelTesto ? -0.35 : -0.7);
  if (f.ctaForza > 0) c += addC(f.ctaCoerente ? 'cta_coerente' : 'cta_incoerente', f.ctaCoerente ? 0.2 : -0.25);
  if (f.offerta) c += addC('offerta', 0.9 * t.prezzo);
  else if (ad.obiettivo === 'conversioni' || ad.obiettivo === 'traffico') c += addC('no_offerta', -0.5 * t.prezzo);
  if (f.scontoGrande || (f.gratis && f.urgenza && f.esclamativi > 2)) c += addC('offerta_sospetta', -0.7 * t.scetticismo);
  if (f.urgenza) c += addC('urgenza', 0.45 * t.prezzo);
  if (f.riprova) c += addC('riprova', 0.8 * (t.riprova - 0.2));
  c += addC(f.chiarezza >= 0.5 ? 'chiarezza' : 'poco_chiaro', 1.2 * (f.chiarezza - 0.5));
  if (ctx.interessi.length) c += addC(interesse ? 'interesse' : 'no_interesse', interesse ? 0.55 : -0.2);
  if (f.beneficio) c += addC('beneficio', 0.15);
  if (!target) c += addC('fuori_target', -0.35);
  if (ad.obiettivo === 'notorieta') c -= 0.25;
  else if (ad.obiettivo === 'interazione') c -= 0.1;
  c += 0.3 * gauss(seme, p.id, ctx.hash, 'c');

  const pStop = sigmoid(s);
  const pClickDopo = sigmoid(c);
  const pLike = sigmoid(s + 0.2 + (interesse ? 0.5 : 0) + (f.offerta ? 0.2 : 0) - (f.ctaForza > 0.8 && !interesse ? 0.2 : 0));
  return { pStop, pClick: pStop * pClickDopo, pLike, contrib, target, interesse };
}
