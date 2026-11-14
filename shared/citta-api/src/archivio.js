// Archivio degli snapshot (trasporti, aria, eventi, riferimenti, meteo, indice) in una cartella
// configurabile (CITTA_DATI; nel container un volume). Li legge dal disco, li passa a
// fonti/dati.js con impostaSnapshot e li ricarica quando il file cambia (rigenerato dal rinfresco
// interno o da `node shared/citta-api/aggiorna.js`), al massimo un controllo ogni 30 s.
//
// Alla prima partenza la cartella si riempie con gli snapshot della repo (cartella iniziale):
// un file della repo più recente di quello nella cartella (dopo un git pull e una nuova immagine)
// prende il suo posto.

import { readFile, writeFile, stat, mkdir, copyFile, rename } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export const NOMI_SNAPSHOT = ['trasporti', 'aria', 'eventi', 'riferimenti', 'meteo', 'indice'];

/** Data di generazione di uno snapshot (ms) o null. */
export function generatoIl(dati) {
  const g = dati?.meta?.generato ?? dati?.generato;
  const t = g ? Date.parse(g) : NaN;
  return Number.isFinite(t) ? t : null;
}

async function leggiJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

/**
 * @param {{cartella: string, iniziale?: string, inietta: (nome: string, dati: any) => void,
 *          ora?: () => number, controlloMs?: number, log?: (m: string) => void}} o
 */
export function creaArchivio(o) {
  const cartella = resolve(o.cartella);
  const iniziale = o.iniziale ? resolve(o.iniziale) : null;
  const ora = o.ora || (() => Date.now());
  const controlloMs = o.controlloMs ?? 30_000;
  const log = o.log || (() => {});
  const dati = new Map(); // nome → oggetto o null
  const firme = new Map(); // nome → 'mtime|dimensione'
  const errori = new Map(); // nome → messaggio
  let ultimoControllo = 0;
  let inCorso = null;

  const file = (nome, dir = cartella) => join(dir, `${nome}.json`);

  /** Crea la cartella e la riempie con gli snapshot iniziali mancanti o più vecchi. */
  async function semina() {
    await mkdir(cartella, { recursive: true });
    if (!iniziale || iniziale === cartella) return [];
    const copiati = [];
    for (const nome of NOMI_SNAPSHOT) {
      let sorgente;
      try {
        sorgente = await leggiJson(file(nome, iniziale));
      } catch {
        continue; // la repo non ha questo snapshot
      }
      let attuale = null;
      try {
        attuale = await leggiJson(file(nome));
      } catch {
        /* manca o è rovinato: si copia */
      }
      const gS = generatoIl(sorgente);
      const gA = generatoIl(attuale);
      if (!attuale || (gS != null && (gA == null || gS > gA))) {
        const tmp = `${file(nome)}.tmp`;
        await copyFile(file(nome, iniziale), tmp);
        await rename(tmp, file(nome));
        copiati.push(nome);
      }
    }
    if (copiati.length) log(`snapshot: copiati dalla repo in ${cartella}: ${copiati.join(', ')}`);
    return copiati;
  }

  /** Rilegge i file cambiati (o tutti con forza=true). Restituisce i nomi ricaricati. */
  async function controlla(forza = false) {
    if (!forza && ora() - ultimoControllo < controlloMs) return [];
    if (inCorso) return inCorso;
    inCorso = (async () => {
      ultimoControllo = ora();
      const cambiati = [];
      for (const nome of NOMI_SNAPSHOT) {
        let firma = 'assente';
        try {
          const s = await stat(file(nome));
          firma = `${s.mtimeMs}|${s.size}`;
        } catch {
          /* file assente */
        }
        if (!forza && firme.get(nome) === firma) continue;
        firme.set(nome, firma);
        let valore = null;
        if (firma !== 'assente') {
          try {
            valore = await leggiJson(file(nome));
            errori.delete(nome);
          } catch (err) {
            // file a metà (scrittura in corso) o rovinato: resta il dato di prima, si riprova al prossimo controllo
            errori.set(nome, String(err.message).slice(0, 160));
            firme.delete(nome);
            continue;
          }
        } else errori.set(nome, 'file assente');
        dati.set(nome, valore);
        o.inietta(nome, valore);
        cambiati.push(nome);
      }
      if (cambiati.length && !forza) log(`snapshot: ricaricati ${cambiati.join(', ')}`);
      return cambiati;
    })();
    try {
      return await inCorso;
    } finally {
      inCorso = null;
    }
  }

  return {
    cartella,
    /** Prima partenza: semina e carica tutto. */
    async prepara() {
      await semina();
      return controlla(true);
    },
    controlla,
    /** Snapshot caricato (null se manca). */
    get: (nome) => dati.get(nome) ?? null,
    /** Scrive uno snapshot (usato dai test). */
    async scrivi(nome, valore) {
      await mkdir(cartella, { recursive: true });
      await writeFile(file(nome), `${JSON.stringify(valore)}\n`);
    },
    /** Stato dei file per /salute e /citta/fonti. */
    info() {
      return Object.fromEntries(
        NOMI_SNAPSHOT.map((nome) => {
          const d = dati.get(nome);
          return [nome, { generato: generatoIl(d), errore: errori.get(nome) || null }];
        }),
      );
    },
  };
}
