// Rinfresco degli snapshot dentro il processo (facoltativo, CITTA_AGGIORNA): ogni minuto guarda
// l'età di ogni snapshot e, se ha superato quella del piano (es. eventi=6h, aria=1h), lo rigenera
// con aggiornaDati() di strumenti/aggiorna-dati-napoli.js, una sezione alla volta,
// usando la stessa rete "educata" dell'API (stesse pause dopo un 429). Dopo un tentativo fallito
// aspetta almeno un'ora (o l'intervallo, se è più breve) prima di riprovare la stessa sezione.

import { generatoIl } from './archivio.js';

/**
 * @param {{piano: Record<string, number>, archivio: object, aggiornaDati: Function, fetch: Function,
 *          ora?: () => number, log?: (m: string) => void, dopo?: (nomi: string[]) => void}} o
 */
export function creaAggiornamento(o) {
  const ora = o.ora || (() => Date.now());
  const log = o.log || (() => {});
  const tentativi = new Map(); // sezione → { ts, esito, errore, durataMs }
  let inCorso = null;
  let timer = null;

  /** Sezioni da rigenerare adesso, dalla più vecchia. */
  function scadute() {
    const t = ora();
    return Object.entries(o.piano)
      .map(([nome, max]) => {
        const g = generatoIl(o.archivio.get(nome));
        const ultimo = tentativi.get(nome);
        const attesa = Math.min(max, 3_600_000);
        if (ultimo?.esito === 'errore' && t - ultimo.ts < attesa) return null;
        if (ultimo?.esito === 'ok' && t - ultimo.ts < max) return null;
        return g == null || t - g >= max ? { nome, eta: g == null ? Infinity : t - g } : null;
      })
      .filter(Boolean)
      .sort((a, b) => b.eta - a.eta)
      .map((x) => x.nome);
  }

  /** Rigenera una sezione (una alla volta in tutto il processo). */
  async function rigenera(nome) {
    if (inCorso) return inCorso;
    inCorso = (async () => {
      const t0 = ora();
      log(`aggiornamento: rigenero lo snapshot "${nome}"…`);
      try {
        const { scritti, errori } = await o.aggiornaDati({ solo: [nome], out: o.archivio.cartella, fetch: o.fetch, log: (m) => log(`aggiornamento: ${m}`) });
        const errore = errori.find((e) => e.sezione === nome)?.errore;
        tentativi.set(nome, { ts: ora(), esito: errore ? 'errore' : 'ok', errore: errore || null, durataMs: ora() - t0 });
        if (scritti.length) {
          const cambiati = await o.archivio.controlla(true);
          o.dopo?.(cambiati);
        }
        return !errore;
      } catch (err) {
        tentativi.set(nome, { ts: ora(), esito: 'errore', errore: String(err?.message || err), durataMs: ora() - t0 });
        log(`aggiornamento: "${nome}" non rigenerato: ${err?.message || err}`);
        return false;
      }
    })();
    try {
      return await inCorso;
    } finally {
      inCorso = null;
    }
  }

  async function giro() {
    if (inCorso) return;
    const [prima] = scadute();
    if (prima) await rigenera(prima);
  }

  return {
    attivo: Object.keys(o.piano).length > 0,
    scadute,
    rigenera,
    giro,
    /** Avvia il controllo periodico (primo giro dopo `ritardoMs`, poi ogni `ogniMs`). */
    avvia({ ritardoMs = 60_000, ogniMs = 60_000 } = {}) {
      if (!Object.keys(o.piano).length) return;
      const t1 = setTimeout(() => {
        giro().catch(() => {});
        timer = setInterval(() => giro().catch(() => {}), ogniMs);
        timer.unref?.();
      }, ritardoMs);
      t1.unref?.();
      timer = t1;
    },
    ferma() {
      clearTimeout(timer);
      clearInterval(timer);
      timer = null;
    },
    /** Stato per /salute: piano, ultimo tentativo, prossime sezioni scadute. */
    stato() {
      return {
        attivo: Object.keys(o.piano).length > 0,
        piano_ore: Object.fromEntries(Object.entries(o.piano).map(([n, ms]) => [n, Math.round((ms / 3_600_000) * 100) / 100])),
        in_corso: Boolean(inCorso),
        ultimi_tentativi: Object.fromEntries([...tentativi.entries()].map(([n, x]) => [n, { ...x }])),
        da_rigenerare: scadute(),
      };
    },
  };
}
