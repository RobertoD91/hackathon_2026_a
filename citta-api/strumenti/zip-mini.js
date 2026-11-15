// Lettore ZIP minimo, senza dipendenze (zlib di Node): basta per i GTFS.
// Legge la directory centrale e restituisce i file come Buffer; supporta i metodi
// "stored" (0) e "deflate" (8), non ZIP64 né cifratura.
//
//   import { leggiZip } from './zip-mini.js';
//   const file = leggiZip(buffer);            // { 'stops.txt': Buffer, ... }
//   const solo = leggiZip(buffer, ['stops.txt', 'routes.txt']);

import { inflateRawSync } from 'node:zlib';

/**
 * @param {Buffer|Uint8Array} buf  contenuto dello zip
 * @param {string[]} [nomi]        file da estrarre (predefinito: tutti); confronto sul nome senza cartelle
 * @returns {Record<string, Buffer>}
 */
export function leggiZip(buf, nomi = null) {
  if (!Buffer.isBuffer(buf)) buf = Buffer.from(buf);
  // fine della directory centrale: firma 0x06054b50 negli ultimi 64 KB
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('ZIP: directory centrale non trovata');
  const voci = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const vuoi = nomi ? new Set(nomi) : null;
  const out = {};
  for (let k = 0; k < voci; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('ZIP: voce della directory centrale non valida');
    const metodo = buf.readUInt16LE(p + 10);
    const compresso = buf.readUInt32LE(p + 20);
    const lNome = buf.readUInt16LE(p + 28);
    const lExtra = buf.readUInt16LE(p + 30);
    const lCommento = buf.readUInt16LE(p + 32);
    const offset = buf.readUInt32LE(p + 42);
    const nome = buf.toString('utf8', p + 46, p + 46 + lNome);
    p += 46 + lNome + lExtra + lCommento;
    const base = nome.split('/').pop();
    if (!base || (vuoi && !vuoi.has(base))) continue;
    // intestazione locale: i campi nome ed extra possono avere lunghezze diverse da quelle centrali
    if (buf.readUInt32LE(offset) !== 0x04034b50) throw new Error(`ZIP: intestazione locale non valida per ${nome}`);
    const inizio = offset + 30 + buf.readUInt16LE(offset + 26) + buf.readUInt16LE(offset + 28);
    const dati = buf.subarray(inizio, inizio + compresso);
    if (metodo === 0) out[base] = Buffer.from(dati);
    else if (metodo === 8) out[base] = inflateRawSync(dati);
    else throw new Error(`ZIP: metodo di compressione ${metodo} non supportato (${nome})`);
  }
  return out;
}

/** Parser CSV (RFC 4180: virgolette, virgole e a capo nei campi). Restituisce oggetti per riga. */
export function leggiCsv(testo, { separatore = ',' } = {}) {
  if (testo.charCodeAt(0) === 0xfeff) testo = testo.slice(1);
  const righe = [];
  let campo = '';
  let riga = [];
  let virgolette = false;
  for (let i = 0; i < testo.length; i++) {
    const c = testo[i];
    if (virgolette) {
      if (c === '"') {
        if (testo[i + 1] === '"') {
          campo += '"';
          i++;
        } else virgolette = false;
      } else campo += c;
    } else if (c === '"') virgolette = true;
    else if (c === separatore) {
      riga.push(campo);
      campo = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && testo[i + 1] === '\n') i++;
      riga.push(campo);
      campo = '';
      if (riga.length > 1 || riga[0] !== '') righe.push(riga);
      riga = [];
    } else campo += c;
  }
  if (campo !== '' || riga.length) {
    riga.push(campo);
    righe.push(riga);
  }
  const [intestazione, ...dati] = righe;
  if (!intestazione) return [];
  const chiavi = intestazione.map((h) => h.trim());
  return dati.map((r) => Object.fromEntries(chiavi.map((k, i) => [k, (r[i] ?? '').trim()])));
}
