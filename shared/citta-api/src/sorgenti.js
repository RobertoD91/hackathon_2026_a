// Cache delle fonti dell'API sopra fonti/dati.js (che ha già la sua cache per URL, il timeout e
// le riserve dichiarate). Qui si aggiunge quello che serve a un servizio sempre acceso:
// - un TTL per fonte (meteo 15 min, aria 60 min, allerta 20 min, passaggi 1 min, eventi 6 h...);
// - un esito "degradato" (riserva, ultimo dato salvato, assente) vale solo `riprovaMs` (3 min):
//   poi si riprova la fonte principale, ma mai più spesso di così;
// - richieste uguali in corso condivise (coalescenza): 10 domande insieme = 1 lettura;
// - stale-while-revalidate: se c'è un valore scaduto si aspetta il nuovo al massimo `attesaMaxMs`
//   (4 s), poi si risponde con quello vecchio (lo si dichiara) e il nuovo arriva in sottofondo;
// - lo stato di ogni fonte (ultimo esito, ora, durata, conteggi) per /citta/fonti.

const M = 60_000;
const H = 60 * M;

/** TTL dei risultati buoni (dal vivo o snapshot). Gli snapshot si invalidano quando cambiano i file. */
export const TTL = Object.freeze({
  meteo: 15 * M,
  ariaModello: 60 * M,
  centraline: 6 * H,
  allerta: 20 * M, // come la cache di fonti/dati.js (gli avvisi escono una volta al giorno, 10:30-11:30)
  terremoti: 30 * M,
  trasporti: 6 * H,
  passaggi: 1 * M,
  avvisi: 15 * M,
  traffico: 5 * M,
  eventi: 6 * H,
  riferimenti: 6 * H,
});

const BUONI = new Set(['live', 'cache', 'snapshot', 'programmato']);

/**
 * @param {{D: object, ora?: () => number, ttl?: Record<string, number>, riprovaMs?: number,
 *          attesaMaxMs?: number, log?: (m: string) => void}} o
 */
export function creaSorgenti(o) {
  const D = o.D;
  const ora = o.ora || (() => Date.now());
  const ttl = { ...TTL, ...(o.ttl || {}) };
  const riprovaMs = o.riprovaMs ?? 3 * M;
  const attesaMaxMs = o.attesaMaxMs ?? 4000;
  const log = o.log || (() => {});

  const FUNZIONI = {
    meteo: () => D.meteo(),
    ariaModello: () => D.ariaModello(),
    centraline: () => D.centraline(),
    allerta: async () => {
      const r = await D.allerta();
      // Il Centro Funzionale ha risposto, ma senza avvisi in vigore (bollettinoMeteoBindList vuota):
      // fonti/dati.js ora lo dà già come dato dal vivo con nessunAvvisoInVigore; questo ramo resta per
      // le versioni precedenti di dati.js, che lo trattavano come un errore e ripiegavano sul salvato.
      if (r?.fonte?.tipo === 'salvato' && /senza bollettino/.test(r.fonte.nota || '')) {
        return {
          dati: { ...r.dati, nessunAvvisoInVigore: true },
          fonte: { ...r.fonte, tipo: 'live', ts: ora(), nota: 'il Centro Funzionale risponde senza avvisi in vigore; "regionale" è l\'ultimo avviso emesso, salvato' },
        };
      }
      return r;
    },
    terremoti: () => D.terremoti(),
    trasporti: () => D.trasporti(),
    passaggi: (stazione) => D.passaggi(stazione, { n: 10 }),
    avvisi: (nomi) => D.avvisiEav(nomi),
    traffico: () => D.traffico(),
    eventi: () => D.eventi(),
    riferimenti: () => D.riferimenti(),
  };

  const cache = new Map(); // chiave → { valore, scade, letto }
  const inVolo = new Map(); // chiave → Promise
  const stato = new Map(); // nome → { richieste, letture, ultimo }

  const st = (nome) => {
    if (!stato.has(nome)) stato.set(nome, { richieste: 0, letture: 0, ultimo: null });
    return stato.get(nome);
  };

  function aggiorna(nome, chiave, args) {
    if (inVolo.has(chiave)) return inVolo.get(chiave);
    const s = st(nome);
    const t0 = ora();
    const p = (async () => {
      let valore;
      try {
        valore = await FUNZIONI[nome](...args);
      } catch (err) {
        // le funzioni di fonti/dati.js non lanciano: questo è un errore di programma o di dati
        log(`fonte ${nome}: errore inatteso ${err?.stack || err}`);
        valore = { dati: null, fonte: { id: nome, tipo: 'assente', nota: `errore interno: ${err?.message || err}` } };
      }
      const buono = BUONI.has(valore?.fonte?.tipo);
      const durata = buono ? ttl[nome] : Math.min(riprovaMs, ttl[nome]);
      const letto = ora();
      cache.set(chiave, { valore, scade: letto + durata, letto });
      s.letture++;
      s.ultimo = { fonte: valore?.fonte ?? null, letto, durataMs: letto - t0, chiave };
      if (!buono) log(`fonte ${nome}: ${valore?.fonte?.tipo ?? 'assente'}${valore?.fonte?.nota ? ` (${valore.fonte.nota})` : ''}`);
      return valore;
    })().finally(() => inVolo.delete(chiave));
    inVolo.set(chiave, p);
    return p;
  }

  /**
   * Dato di una fonte: { dati, fonte } come fonti/dati.js, con `fonte.vecchio = true` se è un
   * valore scaduto restituito mentre il nuovo è in arrivo.
   * @param {string} nome  una delle chiavi di TTL
   * @param {{chiave?: string, args?: any[]}} [opz]  chiave diversa per fonte con argomenti (passaggi)
   */
  async function leggi(nome, { chiave = nome, args = [] } = {}) {
    if (!FUNZIONI[nome]) throw new Error(`fonte sconosciuta: ${nome}`);
    st(nome).richieste++;
    const e = cache.get(chiave);
    if (e && ora() < e.scade) return e.valore;
    const p = aggiorna(nome, chiave, args);
    if (!e) return p;
    let timer;
    const scaduto = new Promise((r) => {
      timer = setTimeout(() => r(null), attesaMaxMs);
      timer.unref?.();
    });
    const nuovo = await Promise.race([p, scaduto]);
    clearTimeout(timer);
    if (nuovo) return nuovo;
    return { ...e.valore, fonte: { ...e.valore.fonte, vecchio: true, nota: [e.valore.fonte?.nota, 'aggiornamento in corso: dato della lettura precedente'].filter(Boolean).join('; ') } };
  }

  return {
    leggi,
    /**
     * Rilegge in anticipo le fonti scadute (o mai lette): tiene "calda" l'API.
     * @param {Array<string | {nome: string, args?: any[], chiave?: string}>} voci
     */
    async scalda(voci) {
      await Promise.all(
        voci.map((v) => {
          const { nome, args = [], chiave = nome } = typeof v === 'string' ? { nome: v } : v;
          const e = cache.get(chiave);
          if (e && ora() < e.scade - 30_000) return null;
          return aggiorna(nome, chiave, args).catch(() => null);
        }),
      );
    },
    /** Dimentica i risultati (tutti o di alcune fonti): la prossima richiesta li ricalcola. */
    invalida(nomi = null) {
      for (const k of [...cache.keys()]) if (!nomi || nomi.some((n) => k === n || k.startsWith(`${n}:`))) cache.delete(k);
    },
    /** Toglie dalla cache le voci scadute da più di 10 minuti (passaggi di tante stazioni). */
    pulisci() {
      const t = ora();
      for (const [k, e] of cache) if (t - e.scade > 10 * M) cache.delete(k);
    },
    /** Stato per fonte: richieste ricevute, letture fatte, ultimo esito. */
    stato() {
      return Object.fromEntries([...stato.entries()].map(([n, s]) => [n, { ...s, ttlMs: ttl[n] }]));
    },
    ttl,
  };
}
