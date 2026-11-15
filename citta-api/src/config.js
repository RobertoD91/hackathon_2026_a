// Configurazione dell'API dati città, solo da variabili d'ambiente (mai segreti nei file).
// Tutte facoltative: senza niente l'API parte sulla porta 8791, senza token, con gli snapshot
// della repo (citta-api/dati/) e senza rinfresco automatico degli snapshot.

import { fileURLToPath } from 'node:url';

export const CARTELLA_DATI_REPO = fileURLToPath(new URL('../dati/', import.meta.url));
export const UA_PREDEFINITO = 'napoli-citta-api/1.0 (demo hackathon; dati aperti)';

/** Sezioni degli snapshot che l'API sa rigenerare (stessi nomi di strumenti/aggiorna-dati-napoli.js). */
export const SEZIONI = ['trasporti', 'aria', 'eventi', 'riferimenti', 'meteo'];

/** Rinfresco predefinito con CITTA_AGGIORNA=si (età massima di ogni snapshot). */
export const AGGIORNA_PREDEFINITO = 'eventi=6h,aria=1h,meteo=3h,riferimenti=24h,trasporti=24h';

const vero = (v, predefinito) => (v == null || v === '' ? predefinito : !/^(0|no|false|off)$/i.test(String(v).trim()));

/** '90s' | '15m' | '6h' | '2d' | numero di minuti → millisecondi (null se non valido). */
export function durata(s) {
  const m = /^\s*(\d+(?:[.,]\d+)?)\s*(s|m|min|h|d|g)?\s*$/i.exec(String(s ?? ''));
  if (!m) return null;
  const v = Number(m[1].replace(',', '.'));
  const u = (m[2] || 'm').toLowerCase();
  return Math.round(v * { s: 1000, m: 60_000, min: 60_000, h: 3_600_000, d: 86_400_000, g: 86_400_000 }[u]);
}

/**
 * CITTA_AGGIORNA → { sezione: età massima in ms }.
 * '' / 0 / no: niente; si / 1: AGGIORNA_PREDEFINITO; altrimenti 'eventi=6h,aria=1h'.
 */
export function pianoAggiornamento(v) {
  const s = String(v ?? '').trim();
  if (!s || /^(0|no|false|off)$/i.test(s)) return {};
  const testo = /^(1|si|sì|yes|true|on)$/i.test(s) ? AGGIORNA_PREDEFINITO : s;
  const piano = {};
  for (const parte of testo.split(',')) {
    const [nome, quanto] = parte.split('=').map((x) => x?.trim());
    if (!nome) continue;
    if (!SEZIONI.includes(nome)) throw new Error(`CITTA_AGGIORNA: sezione "${nome}" sconosciuta (disponibili: ${SEZIONI.join(', ')})`);
    const ms = durata(quanto);
    if (!ms || ms < 10 * 60_000) throw new Error(`CITTA_AGGIORNA: per "${nome}" serve una durata di almeno 10 minuti, es. ${nome}=6h`);
    piano[nome] = ms;
  }
  return piano;
}

/** Origini CORS: lista separata da virgole, '*' per tutte, vuoto per nessuna. */
export function originiCors(v) {
  return String(v ?? '')
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

/**
 * Legge la configurazione da `env` (process.env).
 * @returns {{porta: number, host: string, token: string|null, cors: string[], ua: string, uaForzato: boolean,
 *   cartellaDati: string, cartellaIniziale: string, aggiorna: Record<string, number>, tieniCaldo: boolean,
 *   pausa429Ms: number, log: boolean}}
 */
export function leggiConfig(env = process.env) {
  const porta = Number(env.PORT || env.CITTA_API_PORTA || 8791);
  if (!Number.isInteger(porta) || porta < 1 || porta > 65535) throw new Error(`PORT non valida: ${env.PORT}`);
  const pausa = durata(env.CITTA_PAUSA_429 || '15m');
  const ua = String(env.NAPOLI_UA || '').trim();
  return {
    porta,
    host: env.HOST || env.CITTA_API_HOST || '0.0.0.0',
    token: String(env.CITTA_API_TOKEN || '').trim() || null,
    cors: originiCors(env.CITTA_API_CORS ?? 'https://robertodisanto.it'),
    ua: ua || UA_PREDEFINITO,
    // con NAPOLI_UA impostata si usa per tutte le fonti (tranne quelle a cui serve un UA da browser)
    uaForzato: Boolean(ua),
    cartellaDati: env.CITTA_DATI || CARTELLA_DATI_REPO,
    cartellaIniziale: env.CITTA_DATI_INIZIALI || CARTELLA_DATI_REPO,
    aggiorna: pianoAggiornamento(env.CITTA_AGGIORNA),
    tieniCaldo: vero(env.CITTA_TIENI_CALDO, true),
    pausa429Ms: pausa && pausa >= 60_000 ? pausa : 15 * 60_000,
    log: vero(env.CITTA_LOG, true),
  };
}
