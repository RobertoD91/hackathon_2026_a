// Rete "educata" verso le fonti: un fetch da passare a fonti/dati.js (impostaRete) e allo script
// degli snapshot (aggiornaDati) che
// - mette lo User-Agent (NAPOLI_UA o uno generico, mai dati personali);
// - dopo un 429 mette in PAUSA tutto il dominio (es. open-meteo.com: meteo e aria hanno la stessa
//   quota per IP) per CITTA_PAUSA_429 (predefinito 15 minuti) o per il Retry-After se è più lungo:
//   in pausa nessuna richiesta parte, si risponde subito con un errore che contiene "429", così
//   fonti/dati.js passa alla riserva (MET Norway, snapshot) senza aspettare;
// - dopo `sogliaErrori` errori di fila (rete, timeout, 5xx) mette il dominio in pausa breve
//   (2 minuti), per non far aspettare ogni richiesta fino al timeout;
// - tiene i conteggi per /citta/fonti e /salute.

const MAX_PAUSA_MS = 3_600_000;

/** Dominio "registrabile" approssimato (ultime due etichette): api.open-meteo.com → open-meteo.com. */
export function dominio(url) {
  try {
    const h = new URL(String(url)).hostname;
    return h.split('.').slice(-2).join('.');
  } catch {
    return 'sconosciuto';
  }
}

/** Retry-After (secondi o data HTTP) → ms, null se assente o non valido. */
export function retryAfterMs(valore, ora = Date.now()) {
  if (valore == null || valore === '') return null;
  const s = Number(valore);
  if (Number.isFinite(s)) return Math.max(0, s * 1000);
  const t = Date.parse(valore);
  return Number.isFinite(t) ? Math.max(0, t - ora) : null;
}

const hhmm = (ts) => new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(ts);

/**
 * @param {{fetch?: Function, ua?: string, uaForzato?: boolean, ora?: () => number, pausa429Ms?: number,
 *          pausaErroriMs?: number, sogliaErrori?: number, log?: (m: string) => void}} [o]
 */
export function creaRete(o = {}) {
  const base = o.fetch || ((...a) => globalThis.fetch(...a));
  const ora = o.ora || (() => Date.now());
  const ua = o.ua || 'napoli-citta-api/1.0';
  const pausa429Ms = o.pausa429Ms ?? 15 * 60_000;
  const pausaErroriMs = o.pausaErroriMs ?? 2 * 60_000;
  const soglia = o.sogliaErrori ?? 3;
  const log = o.log || (() => {});
  /** dominio → { richieste, ok, errori, di_fila, ultimo, pausaFino, motivo } */
  const domini = new Map();

  const voce = (d) => {
    if (!domini.has(d)) domini.set(d, { richieste: 0, ok: 0, errori: 0, rifiutate: 0, diFila: 0, ultimo: null, pausaFino: 0, motivo: null });
    return domini.get(d);
  };

  function pausa(v, d, ms, motivo) {
    const fino = ora() + Math.min(MAX_PAUSA_MS, ms);
    if (fino > v.pausaFino) {
      v.pausaFino = fino;
      v.motivo = motivo;
      log(`rete: ${d} in pausa fino alle ${hhmm(fino)} (${motivo})`);
    }
  }

  /** fetch compatibile con quello del browser (e con fetchConCurl dello script degli snapshot). */
  async function fetchEducato(url, init = {}) {
    const d = dominio(url);
    const v = voce(d);
    const t = ora();
    if (v.pausaFino > t) {
      v.rifiutate++;
      const per429 = /429/.test(v.motivo || '');
      throw new Error(`${d} in pausa fino alle ${hhmm(v.pausaFino)} ${per429 ? 'dopo un 429 (limite di richieste della fonte)' : `dopo ${soglia} errori di fila`}: nessuna richiesta inviata`);
    }
    const h = new Headers(init.headers || {});
    const attuale = h.get('user-agent') || '';
    // UA da browser (Mozilla/…) messo apposta dallo script per i siti con WAF: resta
    if (!attuale || (o.uaForzato && !/^Mozilla\//.test(attuale))) h.set('user-agent', ua);
    v.richieste++;
    v.ultimo = { ts: t, url: String(url).split('?')[0] };
    let res;
    try {
      res = await base(url, { ...init, headers: Object.fromEntries(h.entries()) });
    } catch (err) {
      v.errori++;
      v.diFila++;
      v.ultimo.esito = String(err?.message || err).slice(0, 120);
      if (v.diFila >= soglia) pausa(v, d, pausaErroriMs, `${v.diFila} errori di fila: ${v.ultimo.esito}`);
      throw err;
    }
    v.ultimo.esito = `HTTP ${res.status}`;
    if (res.status === 429) {
      v.errori++;
      const ra = retryAfterMs(res.headers?.get?.('retry-after'), ora());
      pausa(v, d, Math.max(pausa429Ms, ra ?? 0), 'HTTP 429: limite di richieste');
    } else if (res.status >= 500) {
      v.errori++;
      v.diFila++;
      if (v.diFila >= soglia) pausa(v, d, pausaErroriMs, `${v.diFila} errori di fila (HTTP ${res.status})`);
    } else {
      v.ok++;
      v.diFila = 0;
    }
    return res;
  }

  return {
    fetch: fetchEducato,
    /** Il dominio è in pausa adesso? (ms che mancano, 0 se no) */
    inPausa(url) {
      const v = domini.get(dominio(url));
      return v && v.pausaFino > ora() ? v.pausaFino - ora() : 0;
    },
    /** Stato per dominio (per /citta/fonti e /salute). */
    stato() {
      const t = ora();
      return [...domini.entries()]
        .map(([d, v]) => ({
          dominio: d,
          richieste: v.richieste,
          ok: v.ok,
          errori: v.errori,
          non_inviate_per_pausa: v.rifiutate,
          ultima: v.ultimo ? { ts: v.ultimo.ts, url: v.ultimo.url, esito: v.ultimo.esito } : null,
          in_pausa_fino: v.pausaFino > t ? v.pausaFino : null,
          motivo_pausa: v.pausaFino > t ? v.motivo : null,
        }))
        .sort((a, b) => a.dominio.localeCompare(b.dominio));
    },
    /** Toglie tutte le pause (test e comandi di manutenzione). */
    sblocca() {
      for (const v of domini.values()) {
        v.pausaFino = 0;
        v.diFila = 0;
      }
    },
  };
}
