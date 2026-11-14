// Client MQTT 3.1.1 minimale, senza dipendenze npm (node:net, node:tls, WebSocket globale).
//
//   import { MqttClient } from './mqtt-client.js';
//   const c = new MqttClient('mqtts://cloud.robertodisanto.it:8883', { username, password });
//   c.on('connect', () => c.subscribe(['bighack/#']));
//   c.on('message', (topic, payload, packet) => ...);   // payload: Buffer
//   c.connect();
//   await c.publish('bighack/zona/id/readings', '{"...":1}', { qos: 1, retain: false });
//   await c.end();
//
// Trasporti: mqtt:// (TCP, 1883), mqtts:// (TLS, 8883), ws:// e wss:// (WebSocket globale di
// Node ≥ 22, sottoprotocollo "mqtt"). Riconnessione automatica con attesa esponenziale,
// keepalive con PINGREQ, nuova iscrizione ai topic dopo ogni riconnessione, last will,
// QoS 0/1/2 in ricezione, QoS 0/1 in invio. Niente persistenza della sessione (clean session).
//
// Esporta anche il codec dei pacchetti (encode*/decodePacket/PacketParser) e topicMatches:
// li usano i test (test/mqtt.test.js) anche per un piccolo broker di prova in memoria.

import { EventEmitter } from 'node:events';
import net from 'node:net';
import tls from 'node:tls';

export const TYPE = Object.freeze({
  CONNECT: 1, CONNACK: 2, PUBLISH: 3, PUBACK: 4, PUBREC: 5, PUBREL: 6, PUBCOMP: 7,
  SUBSCRIBE: 8, SUBACK: 9, UNSUBSCRIBE: 10, UNSUBACK: 11, PINGREQ: 12, PINGRESP: 13, DISCONNECT: 14,
});

export const CONNACK_REASON = Object.freeze({
  1: 'versione del protocollo non accettata',
  2: 'clientId rifiutato',
  3: 'server non disponibile',
  4: 'utente o password errati',
  5: 'non autorizzato',
});

const MAX_PACKET = 1 << 20; // 1 MB: oltre è quasi certamente un errore (o un abuso)

// ------------------------------------------------------------------ codec

export function encodeRemainingLength(n) {
  if (!Number.isInteger(n) || n < 0 || n > 268_435_455) throw new RangeError(`lunghezza non valida: ${n}`);
  const out = [];
  do {
    let b = n % 128;
    n = Math.floor(n / 128);
    if (n > 0) b |= 0x80;
    out.push(b);
  } while (n > 0);
  return Buffer.from(out);
}

function str(s) {
  const b = Buffer.from(String(s), 'utf8');
  if (b.length > 65535) throw new RangeError('stringa MQTT oltre 65535 byte');
  const len = Buffer.alloc(2);
  len.writeUInt16BE(b.length);
  return Buffer.concat([len, b]);
}

function bin(data) {
  const b = Buffer.isBuffer(data) ? data : Buffer.from(data ?? '');
  const len = Buffer.alloc(2);
  len.writeUInt16BE(b.length);
  return Buffer.concat([len, b]);
}

function u16(n) {
  const b = Buffer.alloc(2);
  b.writeUInt16BE(n);
  return b;
}

export function encodePacket(type, flags, body = Buffer.alloc(0)) {
  return Buffer.concat([Buffer.from([(type << 4) | (flags & 0x0f)]), encodeRemainingLength(body.length), body]);
}

export function encodeConnect({ clientId = '', username, password, keepalive = 30, clean = true, will } = {}) {
  let flags = clean ? 0x02 : 0;
  const payload = [str(clientId)];
  if (will) {
    flags |= 0x04 | ((will.qos ?? 0) << 3) | (will.retain ? 0x20 : 0);
    payload.push(str(will.topic), bin(will.payload));
  }
  if (username !== undefined && username !== null && username !== '') {
    flags |= 0x80;
    payload.push(str(username));
    if (password !== undefined && password !== null && password !== '') {
      flags |= 0x40;
      payload.push(bin(password));
    }
  }
  const header = Buffer.concat([str('MQTT'), Buffer.from([4, flags]), u16(keepalive)]);
  return encodePacket(TYPE.CONNECT, 0, Buffer.concat([header, ...payload]));
}

export function encodeConnack(returnCode = 0, sessionPresent = false) {
  return encodePacket(TYPE.CONNACK, 0, Buffer.from([sessionPresent ? 1 : 0, returnCode]));
}

export function encodePublish({ topic, payload, qos = 0, retain = false, dup = false, id }) {
  const parts = [str(topic)];
  if (qos > 0) parts.push(u16(id));
  parts.push(Buffer.isBuffer(payload) ? payload : Buffer.from(payload ?? ''));
  return encodePacket(TYPE.PUBLISH, (dup ? 8 : 0) | (qos << 1) | (retain ? 1 : 0), Buffer.concat(parts));
}

export function encodeSubscribe(id, subs) {
  const parts = [u16(id)];
  for (const { topic, qos = 0 } of subs) parts.push(str(topic), Buffer.from([qos]));
  return encodePacket(TYPE.SUBSCRIBE, 0x02, Buffer.concat(parts));
}

export function encodeSuback(id, granted) {
  return encodePacket(TYPE.SUBACK, 0, Buffer.concat([u16(id), Buffer.from(granted)]));
}

export const encodeAck = (type, id) => encodePacket(type, type === TYPE.PUBREL ? 0x02 : 0, u16(id));
export const encodePingreq = () => encodePacket(TYPE.PINGREQ, 0);
export const encodePingresp = () => encodePacket(TYPE.PINGRESP, 0);
export const encodeDisconnect = () => encodePacket(TYPE.DISCONNECT, 0);

/** Divide un flusso di byte in pacchetti { type, flags, body } (anche a pezzi o più per chunk). */
export class PacketParser {
  constructor({ maxPacket = MAX_PACKET } = {}) {
    this.buf = Buffer.alloc(0);
    this.maxPacket = maxPacket;
  }

  push(chunk) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : Buffer.from(chunk);
    const out = [];
    for (;;) {
      if (this.buf.length < 2) break;
      let len = 0;
      let mult = 1;
      let i = 1;
      let complete = false;
      for (; i < this.buf.length && i <= 4; i++) {
        const b = this.buf[i];
        len += (b & 0x7f) * mult;
        mult *= 128;
        if (!(b & 0x80)) {
          complete = true;
          break;
        }
      }
      if (!complete) {
        if (i > 4) throw new Error('lunghezza residua non valida (oltre 4 byte)');
        break; // ne servono altri
      }
      if (len > this.maxPacket) throw new Error(`pacchetto troppo grande: ${len} byte`);
      const start = i + 1;
      if (this.buf.length < start + len) break;
      out.push({ type: this.buf[0] >> 4, flags: this.buf[0] & 0x0f, body: this.buf.subarray(start, start + len) });
      this.buf = this.buf.subarray(start + len);
    }
    return out;
  }
}

function readStr(body, off) {
  if (off + 2 > body.length) throw new Error('pacchetto troncato');
  const n = body.readUInt16BE(off);
  if (off + 2 + n > body.length) throw new Error('pacchetto troncato');
  return [body.subarray(off + 2, off + 2 + n), off + 2 + n];
}

/** Interpreta un pacchetto (lato client e lato broker). */
export function decodePacket({ type, flags, body }) {
  switch (type) {
    case TYPE.CONNACK:
      return { type, sessionPresent: !!(body[0] & 1), returnCode: body[1] };
    case TYPE.PUBLISH: {
      const qos = (flags >> 1) & 3;
      const [t, off0] = readStr(body, 0);
      let off = off0;
      let id;
      if (qos > 0) {
        id = body.readUInt16BE(off);
        off += 2;
      }
      return { type, topic: t.toString('utf8'), payload: body.subarray(off), qos, retain: !!(flags & 1), dup: !!(flags & 8), id };
    }
    case TYPE.PUBACK:
    case TYPE.PUBREC:
    case TYPE.PUBREL:
    case TYPE.PUBCOMP:
    case TYPE.UNSUBACK:
      return { type, id: body.readUInt16BE(0) };
    case TYPE.SUBACK:
      return { type, id: body.readUInt16BE(0), granted: [...body.subarray(2)] };
    case TYPE.CONNECT: {
      let [proto, off] = readStr(body, 0);
      const level = body[off];
      const cflags = body[off + 1];
      const keepalive = body.readUInt16BE(off + 2);
      off += 4;
      let clientId;
      [clientId, off] = readStr(body, off);
      const out = { type, protocol: proto.toString(), level, clean: !!(cflags & 2), keepalive, clientId: clientId.toString() };
      if (cflags & 4) {
        let wt;
        let wp;
        [wt, off] = readStr(body, off);
        [wp, off] = readStr(body, off);
        out.will = { topic: wt.toString(), payload: Buffer.from(wp), qos: (cflags >> 3) & 3, retain: !!(cflags & 0x20) };
      }
      if (cflags & 0x80) {
        let u;
        [u, off] = readStr(body, off);
        out.username = u.toString();
      }
      if (cflags & 0x40) {
        let p;
        [p, off] = readStr(body, off);
        out.password = p.toString();
      }
      return out;
    }
    case TYPE.SUBSCRIBE: {
      const id = body.readUInt16BE(0);
      const subs = [];
      let off = 2;
      while (off < body.length) {
        let t;
        [t, off] = readStr(body, off);
        subs.push({ topic: t.toString(), qos: body[off] & 3 });
        off += 1;
      }
      return { type, id, subs };
    }
    default:
      return { type };
  }
}

/** true se il topic corrisponde al filtro MQTT (+ = un livello, # = tutto il resto). */
export function topicMatches(filter, topic) {
  if (filter === '#') return !topic.startsWith('$');
  const f = filter.split('/');
  const t = topic.split('/');
  if (t[0]?.startsWith('$') && (f[0] === '+' || f[0] === '#')) return false;
  for (let i = 0; i < f.length; i++) {
    if (f[i] === '#') return true;
    if (i >= t.length) return false;
    if (f[i] !== '+' && f[i] !== t[i]) return false;
  }
  return f.length === t.length;
}

// ------------------------------------------------------------------ trasporti

function openTransport(url, opts, handlers) {
  const port = Number(url.port) || { 'mqtt:': 1883, 'mqtts:': 8883, 'ws:': 80, 'wss:': 443 }[url.protocol];
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (url.protocol === 'mqtt:' || url.protocol === 'tcp:') {
    const s = net.connect({ host, port });
    s.setNoDelay(true);
    s.on('connect', handlers.open);
    s.on('data', handlers.data);
    s.on('error', handlers.error);
    s.on('close', handlers.close);
    return { write: (b) => s.write(b), close: () => s.destroy(), end: () => s.end() };
  }
  if (url.protocol === 'mqtts:' || url.protocol === 'ssl:') {
    const s = tls.connect({ host, port, servername: net.isIP(host) ? undefined : host, ca: opts.ca, rejectUnauthorized: opts.rejectUnauthorized !== false, ALPNProtocols: opts.alpn });
    s.setNoDelay(true);
    s.on('secureConnect', handlers.open);
    s.on('data', handlers.data);
    s.on('error', handlers.error);
    s.on('close', handlers.close);
    return { write: (b) => s.write(b), close: () => s.destroy(), end: () => s.end() };
  }
  if (url.protocol === 'ws:' || url.protocol === 'wss:') {
    if (typeof globalThis.WebSocket !== 'function') throw new Error('ws:// e wss:// richiedono Node ≥ 22 (WebSocket globale)');
    const wsUrl = `${url.protocol}//${url.host}${url.pathname === '/' ? '/mqtt' : url.pathname}${url.search}`;
    const ws = new globalThis.WebSocket(wsUrl, ['mqtt']);
    ws.binaryType = 'arraybuffer';
    let closed = false;
    const close = () => {
      if (!closed) {
        closed = true;
        handlers.close();
      }
    };
    ws.addEventListener('open', handlers.open);
    ws.addEventListener('message', (ev) => handlers.data(Buffer.from(ev.data)));
    ws.addEventListener('error', (ev) => handlers.error(ev.error || new Error(ev.message || 'errore WebSocket')));
    ws.addEventListener('close', close);
    return {
      write: (b) => ws.readyState === 1 && ws.send(b),
      close: () => {
        try { ws.close(); } catch { /* già chiuso */ }
        close();
      },
      end: () => ws.close(),
    };
  }
  throw new Error(`schema non supportato: ${url.protocol} (usa mqtt://, mqtts://, ws:// o wss://)`);
}

// ------------------------------------------------------------------ client

export class MqttClient extends EventEmitter {
  /**
   * @param {string} url mqtt://, mqtts://, ws://, wss:// (utente e password anche nell'URL)
   * @param {object} [o]
   * @param {string} [o.clientId] predefinito "node-<casuale>"
   * @param {string} [o.username] @param {string} [o.password]
   * @param {number} [o.keepalive=30] secondi
   * @param {{topic:string,payload:string|Buffer,qos?:number,retain?:boolean}} [o.will]
   * @param {boolean} [o.reconnect=true]
   * @param {number} [o.minBackoffMs=1000] @param {number} [o.maxBackoffMs=30000]
   * @param {number} [o.connectTimeoutMs=10000]
   * @param {string|Buffer} [o.ca] CA per mqtts:// @param {boolean} [o.rejectUnauthorized=true]
   */
  constructor(url, o = {}) {
    super();
    this.url = new URL(url);
    if (!['mqtt:', 'tcp:', 'mqtts:', 'ssl:', 'ws:', 'wss:'].includes(this.url.protocol)) {
      throw new Error(`schema non supportato: ${this.url.protocol} (usa mqtt://, mqtts://, ws:// o wss://)`);
    }
    this.opts = {
      clientId: o.clientId || `node-${Math.random().toString(16).slice(2, 10)}`,
      username: o.username ?? (this.url.username ? decodeURIComponent(this.url.username) : undefined),
      password: o.password ?? (this.url.password ? decodeURIComponent(this.url.password) : undefined),
      keepalive: o.keepalive ?? 30,
      will: o.will,
      reconnect: o.reconnect !== false,
      minBackoffMs: o.minBackoffMs ?? 1000,
      maxBackoffMs: o.maxBackoffMs ?? 30_000,
      connectTimeoutMs: o.connectTimeoutMs ?? 10_000,
      ca: o.ca,
      rejectUnauthorized: o.rejectUnauthorized,
    };
    this.connected = false;
    this.subscriptions = new Map(); // filtro → qos (rinnovate a ogni connessione)
    this.pending = new Map(); // id → { resolve, reject, timer } (PUBACK, SUBACK)
    this.queue = []; // pubblicazioni fatte da disconnessi (max 100)
    this.inboundQos2 = new Set();
    this.nextId = 1;
    this.backoff = this.opts.minBackoffMs;
    this.ending = false;
    this.transport = null;
    this.timers = {};
  }

  /** Avvia la connessione (e le riconnessioni). Restituisce il client. */
  connect() {
    this.ending = false;
    this._open();
    return this;
  }

  _open() {
    clearTimeout(this.timers.reconnect);
    const parser = new PacketParser();
    let opened = false;
    let closedOnce = false;
    const onClose = () => {
      if (closedOnce) return;
      closedOnce = true;
      this._onClose(opened);
    };
    try {
      this.transport = openTransport(this.url, this.opts, {
        open: () => {
          opened = true;
          this.transport.write(encodeConnect({ ...this.opts, clean: true }));
        },
        data: (chunk) => {
          this.lastRx = Date.now();
          let packets;
          try {
            packets = parser.push(chunk);
          } catch (err) {
            this.emit('error', err);
            this.transport?.close();
            return;
          }
          for (const p of packets) this._onPacket(p);
        },
        error: (err) => this.emit('error', err),
        close: onClose,
      });
    } catch (err) {
      queueMicrotask(() => {
        this.emit('error', err);
        onClose();
      });
      return;
    }
    this.timers.connect = setTimeout(() => {
      if (!this.connected) {
        this.emit('error', new Error(`nessuna risposta dal broker entro ${this.opts.connectTimeoutMs} ms`));
        this.transport?.close();
      }
    }, this.opts.connectTimeoutMs);
  }

  _onClose(opened) {
    const wasConnected = this.connected;
    this.connected = false;
    clearTimeout(this.timers.connect);
    clearInterval(this.timers.ping);
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error('connessione chiusa'));
      this.pending.delete(id);
    }
    if (wasConnected || opened) this.emit('close');
    if (this.ending || !this.opts.reconnect) return;
    const wait = this.backoff;
    this.backoff = Math.min(this.backoff * 2, this.opts.maxBackoffMs);
    this.emit('offline', { retryInMs: wait });
    this.timers.reconnect = setTimeout(() => {
      this.emit('reconnect');
      this._open();
    }, wait);
    this.timers.reconnect.unref?.();
  }

  _onPacket(raw) {
    let p;
    try {
      p = decodePacket(raw);
    } catch (err) {
      this.emit('error', err);
      return;
    }
    switch (p.type) {
      case TYPE.CONNACK:
        clearTimeout(this.timers.connect);
        if (p.returnCode !== 0) {
          const err = new Error(`connessione rifiutata dal broker: ${CONNACK_REASON[p.returnCode] || p.returnCode}`);
          err.code = p.returnCode;
          this.emit('error', err);
          this.transport?.close();
          return;
        }
        this.connected = true;
        this.backoff = this.opts.minBackoffMs;
        this._startPing();
        if (this.subscriptions.size) {
          const subs = [...this.subscriptions].map(([topic, qos]) => ({ topic, qos }));
          this._send(encodeSubscribe(this._id(), subs));
        }
        this.emit('connect', p);
        for (const q of this.queue.splice(0)) this._publishNow(q);
        break;
      case TYPE.PUBLISH:
        if (p.qos === 2) {
          this._send(encodeAck(TYPE.PUBREC, p.id));
          if (this.inboundQos2.has(p.id)) return; // duplicato: già consegnato
          this.inboundQos2.add(p.id);
        }
        this.emit('message', p.topic, p.payload, p);
        if (p.qos === 1) this._send(encodeAck(TYPE.PUBACK, p.id));
        break;
      case TYPE.PUBREL:
        this.inboundQos2.delete(p.id);
        this._send(encodeAck(TYPE.PUBCOMP, p.id));
        break;
      case TYPE.PUBACK:
      case TYPE.SUBACK:
      case TYPE.UNSUBACK: {
        const w = this.pending.get(p.id);
        if (w) {
          clearTimeout(w.timer);
          this.pending.delete(p.id);
          if (p.type === TYPE.SUBACK && p.granted.includes(0x80)) w.reject(new Error('iscrizione rifiutata dal broker (ACL?)'));
          else w.resolve(p);
        }
        if (p.type === TYPE.SUBACK && p.granted.includes(0x80)) this.emit('error', new Error('iscrizione a un topic rifiutata dal broker (ACL?)'));
        break;
      }
      case TYPE.PINGRESP:
      default:
        break;
    }
  }

  _startPing() {
    clearInterval(this.timers.ping);
    const ka = this.opts.keepalive * 1000;
    if (!ka) return;
    this.lastRx = Date.now();
    this.timers.ping = setInterval(() => {
      if (Date.now() - this.lastRx > ka * 1.5) {
        this.emit('error', new Error('keepalive scaduto: nessuna risposta dal broker'));
        this.transport?.close();
        return;
      }
      this._send(encodePingreq());
    }, ka / 2);
    this.timers.ping.unref?.();
  }

  _send(buf) {
    if (this.transport) this.transport.write(buf);
  }

  _id() {
    const id = this.nextId;
    this.nextId = this.nextId >= 65535 ? 1 : this.nextId + 1;
    return id;
  }

  _wait(id, ms = 10_000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`nessuna conferma dal broker per il pacchetto ${id}`));
      }, ms);
      timer.unref?.();
      this.pending.set(id, { resolve, reject, timer });
    });
  }

  /** Iscrizione (ricordata e rinnovata dopo ogni riconnessione). */
  subscribe(filters, qos = 1) {
    const list = (Array.isArray(filters) ? filters : [filters]).filter(Boolean);
    for (const f of list) this.subscriptions.set(f, qos);
    if (!this.connected || !list.length) return Promise.resolve(null);
    const id = this._id();
    const p = this._wait(id);
    this._send(encodeSubscribe(id, list.map((topic) => ({ topic, qos }))));
    return p;
  }

  /** Pubblica. QoS 1: la promessa si risolve al PUBACK. Da disconnessi si accoda (max 100). */
  publish(topic, payload, { qos = 0, retain = false } = {}) {
    if (qos > 1) qos = 1;
    const msg = { topic, payload: typeof payload === 'string' || Buffer.isBuffer(payload) ? payload : JSON.stringify(payload), qos, retain };
    if (!this.connected) {
      if (this.queue.length >= 100) return Promise.reject(new Error('coda di invio piena (broker non connesso)'));
      return new Promise((resolve, reject) => this.queue.push({ ...msg, resolve, reject }));
    }
    return this._publishNow(msg);
  }

  _publishNow(msg) {
    let p;
    if (msg.qos === 1) {
      const id = this._id();
      p = this._wait(id);
      this._send(encodePublish({ ...msg, id }));
    } else {
      this._send(encodePublish(msg));
      p = Promise.resolve(null);
    }
    if (msg.resolve) p.then(msg.resolve, msg.reject);
    return p;
  }

  /** Chiude con DISCONNECT (nessun last will) e ferma le riconnessioni. */
  end() {
    this.ending = true;
    clearTimeout(this.timers.reconnect);
    clearInterval(this.timers.ping);
    clearTimeout(this.timers.connect);
    for (const q of this.queue.splice(0)) q.reject?.(new Error('client chiuso'));
    if (!this.transport) return Promise.resolve();
    return new Promise((resolve) => {
      const t = this.transport;
      const done = () => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        t.close();
        resolve();
      }, 1000);
      this.once('close', done);
      if (this.connected) {
        t.write(encodeDisconnect());
        t.end();
      } else {
        t.close();
        done();
      }
    });
  }
}
