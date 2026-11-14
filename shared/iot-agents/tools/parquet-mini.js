// Lettore Parquet minimo, senza dipendenze, per i file orari della qualità dell'aria dell'EEA
// (Air Quality Download Service, scritti da Parquet.Net). Lo usa tools/aggiorna-dati-napoli.js.
//
// Supporta quello che serve a quei file (e a molti Parquet "piatti"):
// - metadati Thrift compact (FileMetaData, RowGroup, ColumnChunk, PageHeader);
// - colonne piatte (niente annidamenti né ripetizioni), OPTIONAL o REQUIRED;
// - pagine dati v1 e v2, pagina dizionario;
// - codifiche PLAIN, PLAIN_DICTIONARY / RLE_DICTIONARY, livelli RLE/bit-packed;
// - tipi BOOLEAN, INT32, INT64, INT96, FLOAT, DOUBLE, BYTE_ARRAY (UTF-8), FIXED_LEN_BYTE_ARRAY;
// - compressione assente, SNAPPY (decompressore qui sotto), GZIP (zlib di Node).
// Non supporta DELTA_* né BYTE_STREAM_SPLIT: in quel caso lancia un errore chiaro.
//
//   import { leggiParquet } from './parquet-mini.js';
//   const { colonne, righe } = leggiParquet(buffer, { colonne: ['Start', 'Value'] });

import { gunzipSync } from 'node:zlib';

// ------------------------------------------------------------------ Thrift compact protocol

class Thrift {
  constructor(buf, pos = 0) {
    this.b = buf;
    this.p = pos;
  }
  byte() {
    return this.b[this.p++];
  }
  varint() {
    let r = 0n;
    let s = 0n;
    for (;;) {
      const x = this.b[this.p++];
      r |= BigInt(x & 0x7f) << s;
      if (!(x & 0x80)) return r;
      s += 7n;
    }
  }
  zigzag() {
    const v = this.varint();
    return Number((v >> 1n) ^ -(v & 1n));
  }
  binary() {
    const n = Number(this.varint());
    const out = this.b.subarray(this.p, this.p + n);
    this.p += n;
    return out;
  }
  double() {
    const v = this.b.readDoubleLE(this.p);
    this.p += 8;
    return v;
  }
  /** Legge un valore del tipo compact `t` (per le liste i booleani sono un byte). */
  value(t, inList = false) {
    switch (t) {
      case 1:
        return inList ? this.byte() === 1 : true;
      case 2:
        return inList ? this.byte() === 1 : false;
      case 3:
        return (this.byte() << 24) >> 24;
      case 4:
      case 5:
      case 6:
        return this.zigzag();
      case 7:
        return this.double();
      case 8:
        return this.binary();
      case 9:
      case 10:
        return this.list();
      case 11:
        return this.map();
      case 12:
        return this.struct();
      default:
        throw new Error(`Thrift: tipo ${t} sconosciuto alla posizione ${this.p}`);
    }
  }
  list() {
    const h = this.byte();
    let n = h >> 4;
    const t = h & 0x0f;
    if (n === 15) n = Number(this.varint());
    const out = [];
    for (let i = 0; i < n; i++) out.push(this.value(t, true));
    return out;
  }
  map() {
    const n = Number(this.varint());
    if (!n) return new Map();
    const kv = this.byte();
    const m = new Map();
    for (let i = 0; i < n; i++) m.set(this.value(kv >> 4, true), this.value(kv & 0x0f, true));
    return m;
  }
  /** Struttura come oggetto { idCampo: valore }. */
  struct() {
    const o = {};
    let last = 0;
    for (;;) {
      const h = this.byte();
      if (h === 0) return o;
      const t = h & 0x0f;
      const delta = h >> 4;
      const id = delta ? last + delta : this.zigzag();
      last = id;
      o[id] = this.value(t);
    }
  }
}

const testo = (b) => (b instanceof Uint8Array ? Buffer.from(b).toString('utf8') : b);

// ------------------------------------------------------------------ Snappy

/** Decompressione Snappy (formato "raw", come nelle pagine Parquet). */
export function snappyDecompress(src) {
  let p = 0;
  let len = 0;
  for (let s = 0; ; s += 7) {
    const x = src[p++];
    len |= (x & 0x7f) << s;
    if (!(x & 0x80)) break;
  }
  const out = Buffer.allocUnsafe(len);
  let o = 0;
  while (p < src.length) {
    const tag = src[p++];
    const tipo = tag & 3;
    if (tipo === 0) {
      let n = tag >> 2;
      if (n >= 60) {
        const k = n - 59;
        n = 0;
        for (let i = 0; i < k; i++) n |= src[p++] << (8 * i);
      }
      n += 1;
      src.copy ? src.copy(out, o, p, p + n) : out.set(src.subarray(p, p + n), o);
      p += n;
      o += n;
      continue;
    }
    let n;
    let off;
    if (tipo === 1) {
      n = ((tag >> 2) & 7) + 4;
      off = ((tag >> 5) << 8) | src[p++];
    } else if (tipo === 2) {
      n = (tag >> 2) + 1;
      off = src[p] | (src[p + 1] << 8);
      p += 2;
    } else {
      n = (tag >> 2) + 1;
      off = (src[p] | (src[p + 1] << 8) | (src[p + 2] << 16) | (src[p + 3] << 24)) >>> 0;
      p += 4;
    }
    if (!off || off > o) throw new Error('Snappy: offset non valido');
    for (let i = 0; i < n; i++, o++) out[o] = out[o - off]; // le copie possono sovrapporsi
  }
  if (o !== len) throw new Error(`Snappy: attesi ${len} byte, ottenuti ${o}`);
  return out;
}

// ------------------------------------------------------------------ codifiche

const larghezza = (max) => (max <= 0 ? 0 : 32 - Math.clz32(max));

/** Ibrido RLE / bit-packed (livelli e indici del dizionario). */
function rleBitPacked(buf, pos, fine, w, n) {
  const out = new Array(n);
  let i = 0;
  const bytesW = Math.ceil(w / 8);
  while (i < n && pos < fine) {
    let h = 0;
    for (let s = 0; ; s += 7) {
      const x = buf[pos++];
      h |= (x & 0x7f) << s;
      if (!(x & 0x80)) break;
    }
    if (h & 1) {
      const gruppi = h >>> 1;
      const tot = gruppi * 8;
      let bit = 0;
      for (let k = 0; k < tot; k++) {
        let v = 0;
        for (let b = 0; b < w; b++, bit++) v |= ((buf[pos + (bit >> 3)] >> (bit & 7)) & 1) << b;
        if (i < n) out[i++] = v;
      }
      pos += gruppi * w;
    } else {
      const cnt = h >>> 1;
      let v = 0;
      for (let b = 0; b < bytesW; b++) v |= buf[pos++] << (8 * b);
      for (let k = 0; k < cnt && i < n; k++) out[i++] = v;
    }
  }
  while (i < n) out[i++] = 0;
  return out;
}

/** INT96 (giorno giuliano + nanosecondi) → millisecondi Unix. */
function int96(buf, p) {
  const nanos = buf.readBigUInt64LE(p);
  const giorno = buf.readUInt32LE(p + 8);
  return (giorno - 2440588) * 86_400_000 + Number(nanos / 1_000_000n);
}

function leggiPlain(buf, pos, n, tipo, lunghezzaFissa) {
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    switch (tipo) {
      case 0:
        out[i] = Boolean((buf[pos + (i >> 3)] >> (i & 7)) & 1);
        break;
      case 1:
        out[i] = buf.readInt32LE(pos);
        pos += 4;
        break;
      case 2:
        out[i] = buf.readBigInt64LE(pos);
        pos += 8;
        break;
      case 3:
        out[i] = int96(buf, pos);
        pos += 12;
        break;
      case 4:
        out[i] = buf.readFloatLE(pos);
        pos += 4;
        break;
      case 5:
        out[i] = buf.readDoubleLE(pos);
        pos += 8;
        break;
      case 6: {
        const l = buf.readUInt32LE(pos);
        out[i] = buf.toString('utf8', pos + 4, pos + 4 + l);
        pos += 4 + l;
        break;
      }
      case 7:
        out[i] = buf.subarray(pos, pos + lunghezzaFissa);
        pos += lunghezzaFissa;
        break;
      default:
        throw new Error(`Parquet: tipo fisico ${tipo} non supportato`);
    }
  }
  return out;
}

/** DECIMAL → numero (byte array big-endian in complemento a due, oppure INT32/INT64). */
function decimale(v, scala) {
  let n;
  if (typeof v === 'number') n = BigInt(v);
  else if (typeof v === 'bigint') n = v;
  else {
    n = 0n;
    for (const b of v) n = (n << 8n) | BigInt(b);
    if (v.length && v[0] & 0x80) n -= 1n << BigInt(8 * v.length);
  }
  return Number(n) / 10 ** scala;
}

function decomprimi(codec, dati, attesi) {
  if (codec === 0) return dati;
  if (codec === 1) return snappyDecompress(dati);
  if (codec === 2) return gunzipSync(dati);
  throw new Error(`Parquet: compressione ${codec} non supportata (solo nessuna, SNAPPY, GZIP)`);
}

// ------------------------------------------------------------------ lettura

/**
 * Legge le colonne piatte di un file Parquet.
 * @param {Buffer} buf  contenuto del file
 * @param {{colonne?: string[]}} [opts]  nomi delle colonne da leggere (predefinito: tutte)
 * @returns {{ numRighe: number, schema: {nome: string, tipo: number, logico?: object}[], colonne: Record<string, any[]>, righe: () => object[], creatoDa?: string }}
 */
export function leggiParquet(buf, opts = {}) {
  if (!Buffer.isBuffer(buf)) buf = Buffer.from(buf);
  if (buf.toString('latin1', 0, 4) !== 'PAR1' || buf.toString('latin1', buf.length - 4) !== 'PAR1') throw new Error('Parquet: firma PAR1 assente');
  const lenMeta = buf.readUInt32LE(buf.length - 8);
  const meta = new Thrift(buf, buf.length - 8 - lenMeta).struct();
  const schemaEl = meta[2] || [];
  // elemento 0 = radice; i figli piatti seguono
  const schema = schemaEl.slice(1).map((e) => ({
    nome: testo(e[4]),
    tipo: e[1],
    lunghezza: e[2],
    opzionale: e[3] === 1,
    ripetuto: e[3] === 2,
    convertito: e[6],
    scala: e[7],
    logico: e[10],
    figli: e[5],
  }));
  if (schema.some((s) => s.figli || s.ripetuto)) throw new Error('Parquet: colonne annidate o ripetute non supportate');
  const vuoi = opts.colonne ? new Set(opts.colonne) : null;
  const colonne = Object.fromEntries(schema.filter((s) => !vuoi || vuoi.has(s.nome)).map((s) => [s.nome, []]));
  let numRighe = 0;

  for (const rg of meta[4] || []) {
    numRighe += Number(rg[3]);
    for (const cc of rg[1] || []) {
      const md = cc[3];
      const nome = (md[3] || []).map(testo).join('.');
      if (!(nome in colonne)) continue;
      const def = schema.find((s) => s.nome === nome);
      const codec = md[4];
      const tipo = md[1];
      const maxDef = def.opzionale ? 1 : 0;
      let pos = Number(md[11] ?? md[9]);
      if (md[11] != null && Number(md[11]) > Number(md[9])) pos = Number(md[9]); // alcuni writer non scrivono l'offset del dizionario prima dei dati
      const fineChunk = pos + Number(md[7]);
      const totale = Number(md[5]);
      let dizionario = null;
      let letti = 0;
      const out = colonne[nome];
      while (letti < totale && pos < fineChunk) {
        const t = new Thrift(buf, pos);
        const ph = t.struct();
        pos = t.p;
        const compresso = buf.subarray(pos, pos + ph[3]);
        pos += ph[3];
        const tipoPagina = ph[1];
        if (tipoPagina === 2) {
          const dati = decomprimi(codec, compresso, ph[2]);
          dizionario = leggiPlain(dati, 0, ph[7][1], tipo, def.lunghezza);
          continue;
        }
        if (tipoPagina !== 0 && tipoPagina !== 3) continue; // pagine indice: si saltano
        let n;
        let codifica;
        let defLv = null;
        let dati;
        let p0 = 0;
        if (tipoPagina === 0) {
          const dh = ph[5];
          n = dh[1];
          codifica = dh[2];
          dati = decomprimi(codec, compresso, ph[2]);
          if (maxDef > 0) {
            const l = dati.readUInt32LE(0);
            defLv = rleBitPacked(dati, 4, 4 + l, larghezza(maxDef), n);
            p0 = 4 + l;
          }
        } else {
          const dh = ph[8];
          n = dh[1];
          codifica = dh[4];
          const lDef = dh[5] || 0;
          const lRep = dh[6] || 0;
          const livelli = compresso.subarray(0, lRep + lDef);
          const corpo = compresso.subarray(lRep + lDef);
          if (maxDef > 0) defLv = rleBitPacked(livelli, lRep, lRep + lDef, larghezza(maxDef), n);
          dati = dh[7] === false ? corpo : decomprimi(codec, corpo, ph[2] - lRep - lDef);
        }
        const presenti = defLv ? defLv.filter((d) => d === maxDef).length : n;
        let valori;
        if (codifica === 0) valori = leggiPlain(dati, p0, presenti, tipo, def.lunghezza);
        else if (codifica === 2 || codifica === 8) {
          if (!dizionario) throw new Error(`Parquet: colonna ${nome} codificata a dizionario senza dizionario`);
          const w = dati[p0];
          valori = rleBitPacked(dati, p0 + 1, dati.length, w, presenti).map((k) => dizionario[k]);
        } else throw new Error(`Parquet: codifica ${codifica} non supportata (colonna ${nome})`);
        if (defLv) {
          let k = 0;
          for (let i = 0; i < n; i++) out.push(defLv[i] === maxDef ? valori[k++] : null);
        } else out.push(...valori);
        letti += n;
      }
    }
  }

  // conversioni dei tipi logici più comuni
  for (const s of schema) {
    const c = colonne[s.nome];
    if (!c) continue;
    const lt = s.logico || {};
    if (s.convertito === 5 || lt[5]) {
      // DECIMAL: intero con segno (big-endian per i byte array) diviso per 10^scala
      const scala = s.scala ?? lt[5]?.[1] ?? 0;
      for (let i = 0; i < c.length; i++) c[i] = c[i] == null ? null : decimale(c[i], scala);
    } else if (lt[8]) {
      // TIMESTAMP { isAdjustedToUTC, unit: { MILLIS | MICROS | NANOS } }
      const unit = lt[8][2] || {};
      const div = unit[1] ? 1n : unit[2] ? 1000n : 1_000_000n;
      for (let i = 0; i < c.length; i++) if (typeof c[i] === 'bigint') c[i] = Number(c[i] / div);
    } else if (s.convertito === 9 || s.convertito === 10) {
      // TIMESTAMP_MILLIS / TIMESTAMP_MICROS
      const div = s.convertito === 9 ? 1n : 1000n;
      for (let i = 0; i < c.length; i++) if (typeof c[i] === 'bigint') c[i] = Number(c[i] / div);
    } else if (s.tipo === 2) {
      for (let i = 0; i < c.length; i++) if (typeof c[i] === 'bigint') c[i] = Number(c[i]);
    }
  }

  return {
    numRighe,
    schema: schema.map(({ nome, tipo, convertito, scala, logico }) => ({ nome, tipo, convertito, scala, logico })),
    colonne,
    creatoDa: meta[6] ? testo(meta[6]) : undefined,
    righe() {
      const nomi = Object.keys(colonne);
      const n = Math.max(0, ...nomi.map((k) => colonne[k].length));
      return Array.from({ length: n }, (_, i) => Object.fromEntries(nomi.map((k) => [k, colonne[k][i]])));
    },
  };
}
