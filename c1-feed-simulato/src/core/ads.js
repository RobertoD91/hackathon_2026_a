// Formato degli annunci, normalizzazione e import da JSON/CSV.
// In sede non sappiamo in che formato arriveranno gli annunci: accettiamo
// nomi di campo in italiano e in inglese e li riportiamo a un formato unico.

import { CTA, PIATTAFORME, OBIETTIVI, POSIZIONAMENTI, SETTORI } from './data.js';

const ALIAS = {
  nome: ['nome', 'name', 'variante', 'variant', 'ad_name', 'annuncio', 'id_annuncio', 'ad', 'label'],
  titolo: ['titolo', 'headline', 'title', 'heading'],
  testo: ['testo', 'text', 'copy', 'body', 'primary_text', 'descrizione', 'description', 'caption', 'messaggio'],
  cta: ['cta', 'call_to_action', 'calltoaction', 'pulsante', 'button'],
  piattaforma: ['piattaforma', 'platform', 'canale', 'channel', 'social'],
  obiettivo: ['obiettivo', 'objective', 'goal', 'scopo'],
  posizionamento: ['posizionamento', 'placement', 'formato', 'format'],
  settore: ['settore', 'sector', 'category', 'categoria', 'industry', 'vertical'],
  immagine: ['immagine', 'image', 'image_url', 'img', 'creativita', 'creative', 'url_immagine'],
  descrizioneImmagine: ['descrizione_immagine', 'descrizioneimmagine', 'image_description', 'alt', 'visual'],
  etaMin: ['eta_min', 'etamin', 'age_min', 'agemin', 'min_age'],
  etaMax: ['eta_max', 'etamax', 'age_max', 'agemax', 'max_age'],
  genere: ['genere', 'gender', 'sesso'],
  area: ['area', 'geo', 'zona', 'location', 'regione'],
  target: ['target', 'pubblico', 'audience'],
  dataInizio: ['data_inizio', 'datainizio', 'data', 'start_date', 'date', 'periodo'],
  ctrReale: ['ctr_reale', 'ctrreale', 'ctr', 'real_ctr', 'actual_ctr', 'ctr_vero'],
  cpmReale: ['cpm_reale', 'cpmreale', 'cpm', 'real_cpm', 'actual_cpm', 'cpm_vero'],
};

const norm = (s) => String(s ?? '').trim();
const key = (s) => norm(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[\s-]+/g, '_');

function getField(raw, name) {
  const keys = Object.keys(raw);
  for (const alias of ALIAS[name]) {
    const k = keys.find((x) => key(x) === alias);
    if (k !== undefined && raw[k] !== '' && raw[k] != null) return raw[k];
  }
  return undefined;
}

function matchEnum(value, dict, fallback) {
  const v = key(value);
  if (!v) return fallback;
  if (dict[v]) return v;
  for (const [k, label] of Object.entries(dict)) {
    const l = key(label);
    if (l === v || l.startsWith(v) || v.startsWith(k)) return k;
  }
  // sinonimi inglesi più comuni
  const syn = {
    awareness: 'notorieta', reach: 'notorieta', brand_awareness: 'notorieta', notorieta: 'notorieta',
    traffic: 'traffico', link_clicks: 'traffico', clicks: 'traffico',
    engagement: 'interazione', leads: 'lead', lead_generation: 'lead', contatti: 'lead',
    conversions: 'conversioni', sales: 'conversioni', vendite: 'conversioni', purchase: 'conversioni',
    stories: 'storie', story: 'storie', reel: 'reels', video: 'reels', auto: 'automatico', advantage: 'automatico',
    ig: 'instagram', fb: 'facebook', meta: 'facebook', tik_tok: 'tiktok',
    fashion: 'moda', food: 'cibo', tech: 'tecnologia', travel: 'viaggi', home: 'casa', finance: 'finanza',
    health: 'salute', pets: 'animali', automotive: 'motori', events: 'musica_eventi', music: 'musica_eventi',
  };
  if (syn[v] && dict[syn[v]]) return syn[v];
  return fallback;
}

function matchCta(value) {
  const v = key(value);
  if (!v) return 'Nessuna';
  for (const k of Object.keys(CTA)) if (key(k) === v) return k;
  const syn = {
    shop_now: 'Acquista ora', buy_now: 'Acquista ora', compra: 'Acquista ora', acquista: 'Acquista ora',
    learn_more: 'Scopri di più', scopri: 'Scopri di più', scopri_di_piu: 'Scopri di più',
    sign_up: 'Iscriviti', subscribe: 'Iscriviti', book_now: 'Prenota ora', prenota: 'Prenota ora',
    order_now: 'Ordina ora', ordina: 'Ordina ora', download: 'Scarica', install: 'Scarica', watch_more: 'Guarda ora',
    contact_us: 'Richiedi informazioni', get_quote: 'Richiedi informazioni', send_message: 'Invia messaggio',
    none: 'Nessuna', no: 'Nessuna',
  };
  if (syn[v]) return syn[v];
  // CTA libera: la teniamo, con forza stimata nelle feature
  return norm(value);
}

/** Interpreta un target scritto a mano, es. "Donne 25-44 Sud". */
function parseTargetString(s) {
  const out = {};
  const t = key(s);
  const m = t.match(/(\d{2})\s*[_–-]+\s*(\d{2})/);
  if (m) { out.etaMin = +m[1]; out.etaMax = +m[2]; }
  const p = t.match(/(\d{2})\s*\+/) || t.match(/over_?(\d{2})/);
  if (!m && p) { out.etaMin = +p[1]; out.etaMax = 79; }
  if (/donn|femmin|women|female/.test(t)) out.genere = 'F';
  else if (/uomin|maschi|men\b|male/.test(t)) out.genere = 'M';
  if (/sud|mezzogiorno|isole/.test(t)) out.area = 'sud';
  else if (/nord/.test(t)) out.area = 'nord';
  else if (/centro/.test(t)) out.area = 'centro';
  return out;
}

function parseNumber(v) {
  if (v == null || v === '') return undefined;
  if (typeof v === 'number') return v;
  const n = parseFloat(String(v).replace('%', '').replace('€', '').replace(',', '.').trim());
  return Number.isFinite(n) ? n : undefined;
}

/** Riporta un annuncio grezzo (da form, JSON o CSV) al formato interno. */
export function normalizeAd(raw = {}, i = 0) {
  const lettera = String.fromCharCode(65 + (i % 26));
  const targetRaw = getField(raw, 'target');
  const fromString = typeof targetRaw === 'string' ? parseTargetString(targetRaw) : {};
  const t = (typeof targetRaw === 'object' && targetRaw) ? targetRaw : {};
  const etaMin = parseNumber(getField(raw, 'etaMin') ?? t.etaMin ?? t.eta_min ?? t.age_min ?? fromString.etaMin) ?? 18;
  const etaMax = parseNumber(getField(raw, 'etaMax') ?? t.etaMax ?? t.eta_max ?? t.age_max ?? fromString.etaMax) ?? 65;
  const generoRaw = key(getField(raw, 'genere') ?? t.genere ?? t.gender ?? fromString.genere ?? 'tutti');
  const genere = /^(f|donn|femm|women|female)/.test(generoRaw) ? 'F' : /^(m|uomin|masch|men|male)/.test(generoRaw) ? 'M' : 'tutti';
  const areaRaw = key(getField(raw, 'area') ?? t.area ?? fromString.area ?? 'italia');
  const area = /sud|isole|mezzogiorno/.test(areaRaw) ? 'sud' : /nord/.test(areaRaw) ? 'nord' : /centro/.test(areaRaw) ? 'centro' : 'italia';

  const ad = {
    id: norm(raw.id) || `ad-${lettera.toLowerCase()}-${i}`,
    nome: norm(getField(raw, 'nome')) || `Variante ${lettera}`,
    marchio: norm(raw.marchio ?? raw.brand ?? raw.inserzionista) || '',
    titolo: norm(getField(raw, 'titolo')),
    testo: norm(getField(raw, 'testo')),
    cta: matchCta(getField(raw, 'cta')),
    piattaforma: matchEnum(getField(raw, 'piattaforma'), PIATTAFORME, 'instagram'),
    obiettivo: matchEnum(getField(raw, 'obiettivo'), OBIETTIVI, 'traffico'),
    posizionamento: matchEnum(getField(raw, 'posizionamento'), POSIZIONAMENTI, 'feed'),
    settore: matchEnum(getField(raw, 'settore'), SETTORI, 'altro'),
    target: {
      etaMin: Math.max(18, Math.min(79, etaMin)),
      etaMax: Math.max(18, Math.min(79, Math.max(etaMin, etaMax))),
      genere,
      area,
    },
    dataInizio: norm(getField(raw, 'dataInizio')) || new Date().toISOString().slice(0, 10),
    descrizioneImmagine: norm(getField(raw, 'descrizioneImmagine')),
    immagine: norm(getField(raw, 'immagine')) || '',
    imageStats: raw.imageStats || null,
  };
  const ctrReale = parseNumber(getField(raw, 'ctrReale') ?? raw.risultati?.ctr);
  const cpmReale = parseNumber(getField(raw, 'cpmReale') ?? raw.risultati?.cpm);
  if (ctrReale !== undefined || cpmReale !== undefined || raw.risultati) {
    ad.risultati = { ctr: ctrReale, cpm: cpmReale, ctrSegmenti: raw.risultati?.ctrSegmenti || {} };
  }
  return ad;
}

/** Parser CSV minimale: virgolette, separatore , ; o tab rilevato in automatico. */
export function parseCsv(text) {
  const src = text.replace(/^﻿/, '');
  const firstLine = src.split(/\r?\n/)[0] || '';
  const counts = { ',': 0, ';': 0, '\t': 0 };
  let inQ = false;
  for (const ch of firstLine) {
    if (ch === '"') inQ = !inQ;
    else if (!inQ && ch in counts) counts[ch]++;
  }
  const sep = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  const rows = [];
  let row = [];
  let cell = '';
  inQ = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQ) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') inQ = false;
      else cell += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  if (rows.length < 2) return [];
  const head = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => Object.fromEntries(head.map((h, j) => [h, (r[j] ?? '').trim()])));
}

/** Importa un elenco di annunci da testo JSON o CSV. */
export function importAds(text, filename = '') {
  const trimmed = text.trim();
  let list;
  if (/\.json$/i.test(filename) || trimmed.startsWith('[') || trimmed.startsWith('{')) {
    const parsed = JSON.parse(trimmed);
    list = Array.isArray(parsed) ? parsed : (parsed.annunci || parsed.ads || parsed.items || [parsed]);
  } else {
    list = parseCsv(trimmed);
  }
  if (!list.length) throw new Error('Nessun annuncio trovato nel file');
  return list.map((raw, i) => normalizeAd(raw, i));
}

/** Quota del target dichiarato: età, genere, area. */
export function inTarget(persona, ad) {
  const t = ad.target;
  if (persona.eta < t.etaMin || persona.eta > t.etaMax) return false;
  if (t.genere !== 'tutti' && persona.genere !== t.genere) return false;
  if (t.area === 'nord' && !['nord-ovest', 'nord-est'].includes(persona.area)) return false;
  if (t.area === 'centro' && persona.area !== 'centro') return false;
  if (t.area === 'sud' && !['sud', 'isole'].includes(persona.area)) return false;
  return true;
}
