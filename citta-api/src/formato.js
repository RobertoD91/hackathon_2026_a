// Formati comuni delle risposte: orari locali di Napoli, numeri in italiano per i testi, fonte
// compatta con lo STATO del dato (reale, riserva, salvato, snapshot, programmato, simulato, assente).

import * as N from '../fonti/normalizza.js';

/** Stato del dato per chi legge (CiroGPT): da `fonte.tipo` di fonti/dati.js. */
export const STATI = Object.freeze({
  live: 'reale',
  cache: 'reale',
  riserva: 'riserva',
  salvato: 'salvato',
  snapshot: 'snapshot',
  programmato: 'programmato',
  simulato: 'simulato',
  assente: 'assente',
});

/** Cosa vuol dire ogni stato (in /citta e nel README). */
export const LEGENDA_STATI = Object.freeze({
  reale: 'letto dal vivo dalla fonte ufficiale (con cache di pochi minuti)',
  riserva: 'la fonte principale non risponde: dato dal vivo di una fonte di riserva (es. MET Norway al posto di Open-Meteo)',
  salvato: "la fonte dal vivo non risponde: ultimo dato salvato nello snapshot, con la sua ora",
  snapshot: 'dato statico o a lenta variazione dallo snapshot rigenerato periodicamente (eventi, centraline, visitatori)',
  programmato: 'orario programmato GTFS, non in tempo reale',
  simulato: 'stima del simulatore della demo, non una misura (es. la folla)',
  assente: 'nessuna fonte disponibile: non dare numeri',
});

const due = (n) => String(n).padStart(2, '0');

/** 'AAAA-MM-GG HH:MM' nell'ora di Napoli (null se manca). */
export function oraLocale(ts) {
  if (!Number.isFinite(ts)) return null;
  const p = N.partiLocali(ts);
  return `${p.anno}-${due(p.mese)}-${due(p.giorno)} ${due(p.ora)}:${due(p.minuto)}`;
}

const GIORNI = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];
const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];

/** Giorno della settimana (0 = domenica) di 'AAAA-MM-GG'. */
export function giornoSettimana(giorno) {
  const [a, m, g] = giorno.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, g)).getUTCDay();
}

/** 'sabato 14 novembre 2026' da 'AAAA-MM-GG'. */
export function giornoTesto(giorno) {
  const [a, m, g] = giorno.split('-').map(Number);
  return `${GIORNI[giornoSettimana(giorno)]} ${g} ${MESI[m - 1]} ${a}`;
}

/** 'alle 15:00' (oggi), 'ieri alle 11:22', 'domani alle 18:00', 'il 16/11 alle 08:00'. */
export function quando(ts, ora) {
  if (!Number.isFinite(ts)) return '';
  const g = N.giornoLocale(ts);
  const oggi = N.giornoLocale(ora);
  const hm = N.oraBreve(ts);
  if (g === oggi) return `alle ${hm}`;
  if (g === N.giornoLocale(ora - 86_400_000)) return `ieri alle ${hm}`;
  if (g === N.giornoLocale(ora + 86_400_000)) return `domani alle ${hm}`;
  const [a, m, d] = g.split('-');
  return `il ${d}/${m}${a !== oggi.slice(0, 4) ? `/${a}` : ''} alle ${hm}`;
}

/** Numero italiano per i testi: 17.6 → '17,6'. */
export function it(v, dec = 1) {
  return typeof v === 'number' && Number.isFinite(v) ? new Intl.NumberFormat('it-IT', { maximumFractionDigits: dec }).format(v) : 'n/d';
}

/** Arrotonda (null resta null). */
export const tondo = (v, dec = 1) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 10 ** dec) / 10 ** dec : null);

/** Fonte compatta per le risposte: nome, stato, ora del dato, licenza, nota. */
export function fonteBreve(f, extra = {}) {
  if (!f) return { nome: null, stato: 'assente', ora_dato: null, licenza: null, ...extra };
  const out = {
    nome: f.nome ?? null,
    stato: STATI[f.tipo] || f.tipo || 'assente',
    ora_dato: oraLocale(f.ts),
    licenza: f.licenza ?? null,
  };
  if (f.nota) out.nota = f.nota;
  if (f.vecchio) out.aggiornamento_in_corso = true;
  return { ...out, ...extra };
}

/** 'oggi', 'domani', 'ieri' o 'il 16/11' per il giorno di `ts`. */
function giornoParola(ts, ora) {
  const q = quando(ts, ora);
  if (q.startsWith('alle ')) return 'oggi';
  if (q.startsWith('ieri')) return 'ieri';
  if (q.startsWith('domani')) return 'domani';
  return q.replace(/ alle .*$/, '');
}

/** 'fino alle 18:00', 'fino a domani alle 18:59', 'fino al 16/11 alle 08:00'. */
export function finoA(ts, ora) {
  const q = quando(ts, ora);
  if (!q) return '';
  if (q.startsWith('alle ')) return `fino ${q}`;
  if (q.startsWith('il ')) return `fino al ${q.slice(3)}`;
  return `fino a ${q}`;
}

/** 'domani dalle 07:00 alle 18:59' o 'dal 16/11 alle 08:00 al 17/11 alle 12:00'. */
export function intervallo(inizio, fine, ora) {
  if (!Number.isFinite(inizio) || !Number.isFinite(fine)) return '';
  if (N.giornoLocale(inizio) === N.giornoLocale(fine)) return `${giornoParola(inizio, ora)} dalle ${N.oraBreve(inizio)} alle ${N.oraBreve(fine)}`;
  const da = quando(inizio, ora);
  const dal = da.startsWith('il ') ? `dal ${da.slice(3)}` : da.startsWith('alle ') ? `da oggi ${da}` : `da ${da}`;
  return `${dal} ${finoA(fine, ora).replace(/^fino /, '')}`;
}

/** 'delle 15:00', 'di ieri alle 11:22', 'di domani alle 18:00', 'del 16/11 alle 08:00'. */
export function delle(ts, ora) {
  const q = quando(ts, ora);
  if (q.startsWith('alle ')) return `delle ${q.slice(5)}`;
  if (q.startsWith('il ')) return `del ${q.slice(3)}`;
  return q ? `di ${q}` : '';
}

/** "Open-Meteo (…), dato delle 15:00" per i testi, con lo stato se non è un dato dal vivo. */
export function citazione(f, ora, nome = null) {
  const s = STATI[f?.tipo] || 'assente';
  const n = nome || f?.nome || 'fonte sconosciuta';
  const d = Number.isFinite(f?.ts) ? delle(f.ts, ora) : '';
  if (s === 'riserva') return `${n}, fonte di riserva${d ? `, dato ${d}` : ''}`;
  if (s === 'salvato') return `${n}, ultimo dato salvato${d ? ` ${d}` : ''}, perché la fonte dal vivo non risponde`;
  if (s === 'programmato') return `${n}, orario programmato`;
  if (s === 'assente') return `${n}: dato non disponibile`;
  return `${n}${d ? `, dato ${d}` : ''}`;
}

/**
 * Solo lo stato e l'ora, per i testi che hanno già detto la fonte: "dato delle 15:00",
 * "fonte di riserva, dato delle 15:00", "ultimo dato salvato delle 08:45", "dato non disponibile".
 */
export function statoDato(f, ora) {
  const s = STATI[f?.tipo] || 'assente';
  const d = Number.isFinite(f?.ts) ? delle(f.ts, ora) : '';
  if (s === 'riserva') return `fonte di riserva${d ? `, dato ${d}` : ''}`;
  if (s === 'salvato') return `ultimo dato salvato${d ? ` ${d}` : ''}, la fonte dal vivo non risponde`;
  if (s === 'programmato') return 'orario programmato';
  if (s === 'assente') return 'dato non disponibile';
  return d ? `dato ${d}` : '';
}

/** Nome breve per i testi solo se la fonte è davvero quella (con la riserva si cita la riserva). */
export const nomeSe = (f, re, breve) => (re.test(f?.nome || '') ? breve : null);

/** Errore con codice HTTP per il router. */
export class ErroreApi extends Error {
  constructor(status, messaggio, extra = {}) {
    super(messaggio);
    this.status = status;
    this.extra = extra;
  }
}
