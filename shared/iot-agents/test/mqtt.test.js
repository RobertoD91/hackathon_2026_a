// Test del ponte MQTT → hub (tools/mqtt-bridge.js), del client MQTT (tools/mqtt-client.js) e
// delle conversioni (tools/mqtt-convert.js). Nessun broker esterno: un piccolo broker MQTT 3.1.1
// in memoria (qui sotto) basta per client e ponte. Con MQTT_TEST_URL=mqtt://host:porta gira
// anche una prova contro un broker vero (es. Mosquitto in Docker).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {
  MqttClient, PacketParser, TYPE, decodePacket, encodeAck, encodeConnack, encodeConnect, encodePingresp,
  encodePublish, encodeRemainingLength, encodeSuback, encodeSubscribe, topicMatches,
} from '../tools/mqtt-client.js';
import { createConverter, sanitizeId, sanitizeKey, tasmotaSensorReadings } from '../tools/mqtt-convert.js';
import { configFromEnv, startBridge } from '../tools/mqtt-bridge.js';
import { validateReading } from '../src/validate.js';
import { createHub } from '../src/hub.js';
import { silentLogger } from '../src/log.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const once = (em, ev) => new Promise((r) => em.once(ev, (...a) => r(a)));
async function until(fn, ms = 3000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const v = await fn();
    if (v) return v;
    await sleep(20);
  }
  throw new Error('condizione non raggiunta in tempo');
}

// ------------------------------------------------------------------ broker di prova in memoria

function startMiniBroker({ users } = {}) {
  const clients = new Set();
  const retained = new Map();
  const stats = { pings: 0, pubacksFromClients: 0, connects: 0 };
  let nextId = 1;
  const route = (topic, payload, qos) => {
    for (const c of clients) {
      const sub = c.subs.find((s) => topicMatches(s.topic, topic));
      if (!sub) continue;
      const q = Math.min(qos, sub.qos);
      c.sock.write(encodePublish({ topic, payload, qos: q, id: q ? nextId++ : undefined }));
    }
  };
  const server = net.createServer((sock) => {
    const c = { sock, subs: [], will: null };
    const parser = new PacketParser();
    sock.on('error', () => {});
    sock.on('close', () => {
      clients.delete(c);
      if (c.will) {
        if (c.will.retain) retained.set(c.will.topic, c.will.payload);
        route(c.will.topic, c.will.payload, c.will.qos);
      }
    });
    sock.on('data', (d) => {
      for (const raw of parser.push(d)) {
        const p = decodePacket(raw);
        if (p.type === TYPE.CONNECT) {
          stats.connects++;
          if (users && users[p.username] !== p.password) {
            sock.write(encodeConnack(4));
            sock.end();
            return;
          }
          c.will = p.will || null;
          c.clientId = p.clientId;
          c.keepalive = p.keepalive;
          clients.add(c);
          sock.write(encodeConnack(0));
        } else if (p.type === TYPE.SUBSCRIBE) {
          c.subs.push(...p.subs);
          sock.write(encodeSuback(p.id, p.subs.map((s) => (s.topic.startsWith('vietato/') ? 0x80 : s.qos))));
          for (const [t, m] of retained) if (p.subs.some((s) => topicMatches(s.topic, t))) sock.write(encodePublish({ topic: t, payload: m, retain: true }));
        } else if (p.type === TYPE.PUBLISH) {
          if (p.qos === 1) sock.write(encodeAck(TYPE.PUBACK, p.id));
          if (p.retain) retained.set(p.topic, Buffer.from(p.payload));
          route(p.topic, Buffer.from(p.payload), p.qos);
        } else if (p.type === TYPE.PUBACK) {
          stats.pubacksFromClients++;
        } else if (p.type === TYPE.PINGREQ) {
          stats.pings++;
          sock.write(encodePingresp());
        } else if (p.type === TYPE.DISCONNECT) {
          c.will = null; // uscita pulita: niente last will
          sock.end();
        }
      }
    });
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve({
        url: `mqtt://127.0.0.1:${server.address().port}`,
        stats,
        clients,
        retained,
        dropAll: () => { for (const c of clients) c.sock.destroy(); },
        close: () => new Promise((r) => { for (const c of clients) c.sock.destroy(); server.close(r); }),
      }),
    ),
  );
}

// ------------------------------------------------------------------ codec

describe('codec MQTT 3.1.1', () => {
  test('lunghezza residua ai confini (1-4 byte)', () => {
    assert.deepEqual([...encodeRemainingLength(0)], [0]);
    assert.deepEqual([...encodeRemainingLength(127)], [0x7f]);
    assert.deepEqual([...encodeRemainingLength(128)], [0x80, 0x01]);
    assert.deepEqual([...encodeRemainingLength(16383)], [0xff, 0x7f]);
    assert.deepEqual([...encodeRemainingLength(16384)], [0x80, 0x80, 0x01]);
    assert.deepEqual([...encodeRemainingLength(268_435_455)], [0xff, 0xff, 0xff, 0x7f]);
    assert.throws(() => encodeRemainingLength(268_435_456));
  });

  test('CONNECT con last will, utente e password: andata e ritorno', () => {
    const buf = encodeConnect({ clientId: 'badge-1a2b', username: 'u', password: 'p€', keepalive: 30, will: { topic: 'bighack/z/badge-1a2b/status', payload: '{"online":false}', qos: 1, retain: true } });
    const [pkt] = new PacketParser().push(buf);
    const c = decodePacket(pkt);
    assert.equal(c.protocol, 'MQTT');
    assert.equal(c.level, 4);
    assert.equal(c.clientId, 'badge-1a2b');
    assert.equal(c.keepalive, 30);
    assert.equal(c.username, 'u');
    assert.equal(c.password, 'p€');
    assert.equal(c.will.topic, 'bighack/z/badge-1a2b/status');
    assert.equal(c.will.payload.toString(), '{"online":false}');
    assert.equal(c.will.qos, 1);
    assert.equal(c.will.retain, true);
    assert.equal(c.clean, true);
  });

  test('PUBLISH QoS 0 e 1, SUBSCRIBE: andata e ritorno', () => {
    const big = 'x'.repeat(20_000); // lunghezza residua su 3 byte
    const [a, b, s] = new PacketParser().push(Buffer.concat([
      encodePublish({ topic: 't/1', payload: 'ciao' }),
      encodePublish({ topic: 't/2', payload: big, qos: 1, retain: true, id: 7 }),
      encodeSubscribe(9, [{ topic: 'bighack/#', qos: 1 }, { topic: 'tele/+/SENSOR', qos: 0 }]),
    ]));
    assert.deepEqual({ ...decodePacket(a), payload: undefined }, { type: TYPE.PUBLISH, topic: 't/1', payload: undefined, qos: 0, retain: false, dup: false, id: undefined });
    assert.equal(decodePacket(a).payload.toString(), 'ciao');
    const pb = decodePacket(b);
    assert.equal(pb.qos, 1);
    assert.equal(pb.id, 7);
    assert.equal(pb.retain, true);
    assert.equal(pb.payload.length, 20_000);
    assert.deepEqual(decodePacket(s), { type: TYPE.SUBSCRIBE, id: 9, subs: [{ topic: 'bighack/#', qos: 1 }, { topic: 'tele/+/SENSOR', qos: 0 }] });
  });

  test('parser: flusso a un byte alla volta e pacchetti uniti', () => {
    const stream = Buffer.concat([encodeConnack(0), encodePublish({ topic: 'a/b', payload: 'x'.repeat(300), qos: 1, id: 1 }), encodePingresp()]);
    const p = new PacketParser();
    const got = [];
    for (const byte of stream) got.push(...p.push(Buffer.from([byte])));
    assert.deepEqual(got.map((x) => x.type), [TYPE.CONNACK, TYPE.PUBLISH, TYPE.PINGRESP]);
    assert.equal(decodePacket(got[1]).payload.length, 300);
    assert.throws(() => new PacketParser().push(Buffer.from([0x30, 0xff, 0xff, 0xff, 0xff, 0x01])), /lunghezza residua/);
    assert.throws(() => new PacketParser({ maxPacket: 10 }).push(encodePublish({ topic: 'a', payload: 'x'.repeat(20) })), /troppo grande/);
  });

  test('topicMatches: + e #', () => {
    const cases = [
      ['bighack/#', 'bighack/zona/id/readings', true],
      ['bighack/#', 'bighack', true],
      ['tele/+/SENSOR', 'tele/tasmota_1/SENSOR', true],
      ['tele/+/SENSOR', 'tele/tasmota_1/STATE', false],
      ['tele/+/SENSOR', 'tele/a/b/SENSOR', false],
      ['napoli/sensori/+/+', 'napoli/sensori/varco/persone', true],
      ['#', '$SYS/broker/uptime', false],
      ['a/b', 'a/b/c', false],
    ];
    for (const [f, t, exp] of cases) assert.equal(topicMatches(f, t), exp, `${f} ~ ${t}`);
  });
});

// ------------------------------------------------------------------ conversioni

describe('conversioni verso il contratto', () => {
  const conv = createConverter({
    map: { tasmota_ABC123: { zone: 'plebiscito', lat: 40.8359, lon: 14.2488 }, 'badge-rinomina': { deviceId: 'badge-ingresso', zone: 'ingresso' } },
    defaultZone: 'citta-della-scienza',
    c5: true,
  });
  const one = (topic, payload, opts) => {
    const r = conv.convert(topic, Buffer.from(typeof payload === 'string' ? payload : JSON.stringify(payload)), opts);
    for (const body of r.readings) {
      const v = validateReading(body);
      assert.ok(v.ok, `non valida per il hub: ${v.error} ${JSON.stringify(body)}`);
    }
    return r;
  };

  test('bighack/<zona>/<id>/readings: messaggio del badge passa com\'è (+ meta.via)', () => {
    const msg = { deviceId: 'badge-1a2b', ts: 1763100000123, location: { lat: 40.8069, lon: 14.1764, zone: 'citta-della-scienza' }, readings: { light_lux: 532, button: false }, meta: { fw: 'badge-mqtt-0.1.0', net: 'wifi', simulated: false } };
    const { readings: [r] } = one('bighack/citta-della-scienza/badge-1a2b/readings', msg);
    assert.deepEqual(r, { ...msg, meta: { ...msg.meta, via: 'mqtt' } });
  });

  test('forma corta, id e zona dal topic, array, mappa che rinomina', () => {
    let { readings: [r] } = one('bighack/molo/sensore-7/readings', { light_lux: 12, button: true, note: 'testo ignorato' });
    assert.equal(r.deviceId, 'sensore-7');
    assert.deepEqual(r.readings, { light_lux: 12, button: true });
    assert.deepEqual(r.location, { zone: 'molo' });
    const arr = one('bighack/molo/s/readings', [{ readings: { a: 1 } }, { readings: { b: 2 } }]).readings;
    assert.equal(arr.length, 2);
    ({ readings: [r] } = one('bighack/qualsiasi/badge-rinomina/readings', { readings: { light_lux: 1 } }));
    assert.equal(r.deviceId, 'badge-ingresso');
    assert.equal(r.location.zone, 'ingresso');
    assert.equal(one('bighack/z/id/readings', '{rotto').skip, 'JSON non valido');
    assert.equal(one('bighack/z/id/readings', { readings: {} }).readings.length, 0);
    assert.match(one('bighack/z/id/cmd', { text: 'ciao' }).skip, /cmd/);
  });

  test('status e last will → lettura { online }', () => {
    let { readings: [r] } = one('bighack/citta-della-scienza/badge-1a2b/status', { deviceId: 'badge-1a2b', online: false, zone: 'citta-della-scienza' }, { retain: true });
    assert.deepEqual(r.readings, { online: false });
    assert.equal(r.meta.retained, true);
    ({ readings: [r] } = one('bighack/z/x/status', 'online'));
    assert.equal(r.readings.online, true);
    assert.ok(one('bighack/z/x/status', { altro: 1 }).skip);
  });

  test('Tasmota: BH1750 + AM2301 (DHT22) con zona dalla mappa', () => {
    const { readings: [r] } = one('tele/tasmota_ABC123/SENSOR', { Time: '2026-11-14T10:00:00', BH1750: { Illuminance: 123 }, AM2301: { Temperature: 21.4, Humidity: 55.2, DewPoint: 12.0 }, TempUnit: 'C' });
    assert.equal(r.deviceId, 'tasmota_ABC123');
    assert.deepEqual(r.readings, { light_lux: 123, temperature_c: 21.4, humidity_pct: 55.2, dew_point_c: 12 });
    assert.deepEqual(r.location, { zone: 'plebiscito', lat: 40.8359, lon: 14.2488 });
    assert.equal(r.meta.source, 'tasmota');
    assert.equal(r.meta.deviceTime, '2026-11-14T10:00:00');
    assert.equal(r.ts, undefined, 'l\'ora di Tasmota è locale e senza fuso: il ts lo mette il hub');
  });

  test('Tasmota: più DS18B20, BME280 in mmHg, °F, ENERGY multicanale, ANALOG, Switch', () => {
    const { readings } = tasmotaSensorReadings({
      'DS18B20-1': { Id: '01144A0CB2AA', Temperature: 70.0 },
      'DS18B20-2': { Id: '01144A0CB2BB', Temperature: 71.6 },
      BME280: { Temperature: 68.0, Humidity: 40, DewPoint: 50, Pressure: 760.0 },
      ENERGY: { TotalStartTime: '2026-01-01T00:00:00', Total: 12.5, Yesterday: 0.3, Today: 0.12, Power: [100, 50], Voltage: 230, Current: 0.65, Factor: 0.97 },
      ANALOG: { A0: 512 },
      Switch1: 'ON',
      TempUnit: 'F',
      PressureUnit: 'mmHg',
    });
    assert.equal(readings.temperature_c, 21.11);
    assert.equal(readings.temperature_c_ds18b20_2, 22);
    assert.equal(readings.temperature_c_bme280, 20);
    assert.equal(readings.pressure_hpa, 1013.3); // 760 mmHg = 1013,25 hPa
    assert.equal(readings.humidity_pct, 40);
    assert.equal(readings.power_w, 150);
    assert.equal(readings.power_w_1, 100);
    assert.equal(readings.power_w_2, 50);
    assert.equal(readings.voltage_v, 230);
    assert.equal(readings.energy_today_kwh, 0.12);
    assert.equal(readings.analog_a0, 512);
    assert.equal(readings.switch1, true);
    assert.ok(validateReading({ deviceId: 'x', readings }).ok);
  });

  test('Tasmota: STATE (RSSI e relè), LWT, FullTopic con la zona, sensori sconosciuti', () => {
    const c = createConverter({});
    assert.ok(c.convert('tele/presa1/STATE', Buffer.from(JSON.stringify({ UptimeSec: 60, Wifi: { RSSI: 70, Signal: -65 } }))).skip);
    const { readings: [s] } = c.convert('tele/presa1/STATE', Buffer.from(JSON.stringify({ POWER: 'ON', Wifi: { Signal: -61 } })));
    assert.deepEqual(s.readings, { relay: true });
    const { readings: [r] } = c.convert('tele/presa1/SENSOR', Buffer.from(JSON.stringify({ ENERGY: { Power: 42 } })));
    assert.equal(r.meta.rssi, -61);
    assert.equal(r.location, undefined, 'senza mappa né zona predefinita: niente location');
    const { readings: [l] } = c.convert('tele/presa1/LWT', Buffer.from('Offline'), { retain: true });
    assert.deepEqual(l.readings, { online: false });
    const { readings: [z] } = c.convert('bighack/molo/tasmota_9/tele/SENSOR', Buffer.from(JSON.stringify({ BH1750: { Illuminance: 9 } })));
    assert.equal(z.location.zone, 'molo');
    assert.match(c.convert('tele/x/SENSOR', Buffer.from(JSON.stringify({ PMS5003: { CF1: 3 } }))).skip, /nessun sensore/);
    assert.ok(createConverter({ tasmota: false }).convert('tele/x/SENSOR', Buffer.from('{}')).skip);
  });

  test('c5-agentic-city: persone × moltiplicatore, luce, copie dei badge saltate', () => {
    let { readings: [r] } = one('napoli/sensori/varco_rotonda/persone', { zona: 'rotonda_diaz', valore: 7, moltiplicatore: 200 });
    assert.deepEqual(r.readings, { people_count: 1400 });
    assert.equal(r.location.zone, 'rotonda_diaz');
    assert.equal(r.deviceId, 'varco_rotonda');
    ({ readings: [r] } = one('napoli/sensori/nodo1/luce', 321));
    assert.deepEqual(r.readings, { light_lux: 321 });
    assert.equal(r.location.zone, 'citta-della-scienza');
    assert.match(one('napoli/sensori/badge-1a2b/luce', { valore: 3, deviceId: 'badge-1a2b' }).skip, /copia/);
    assert.ok(createConverter({}).convert('napoli/sensori/n/luce', Buffer.from('{"valore":1}')).skip, 'c5 spento di default');
  });

  test('id e nomi ripuliti', () => {
    assert.equal(sanitizeId('tasmota ABC/1'), 'tasmota-ABC-1');
    assert.equal(sanitizeKey('PM2.5'), 'pm2_5');
    assert.equal(sanitizeKey('CarbonDioxide'), 'carbon_dioxide');
    assert.equal(sanitizeKey('1wire'), 'x_1wire');
    assert.deepEqual(createConverter({ prefix: 'test/bighack' }).parseTopic('test/bighack/z/id/readings'), { kind: 'readings', zone: 'z', id: 'id' });
    assert.deepEqual(createConverter({ c5: true }).topics(), ['bighack/#', 'tele/+/SENSOR', 'tele/+/STATE', 'tele/+/LWT', 'napoli/sensori/+/+']);
  });
});

// ------------------------------------------------------------------ client contro il broker di prova

describe('MqttClient', () => {
  let broker;
  before(async () => { broker = await startMiniBroker({ users: { ponte: 'segreta' } }); });
  after(() => broker.close());

  test('credenziali sbagliate: errore con il motivo', async () => {
    const c = new MqttClient(broker.url, { username: 'ponte', password: 'no', reconnect: false });
    const err = once(c, 'error');
    c.connect();
    const [e] = await err;
    assert.equal(e.code, 4);
    assert.match(e.message, /utente o password/);
    await c.end();
  });

  test('iscrizione, QoS 1 nei due sensi, retained, PUBACK al broker', async () => {
    const pub = new MqttClient(broker.url, { username: 'ponte', password: 'segreta' });
    pub.on('error', () => {});
    pub.connect();
    await once(pub, 'connect');
    await pub.publish('bighack/z/a/status', '{"online":true}', { qos: 1, retain: true });

    const sub = new MqttClient(broker.url, { username: 'ponte', password: 'segreta' });
    const got = [];
    sub.on('message', (t, p, pkt) => got.push({ t, p: p.toString(), retain: pkt.retain, qos: pkt.qos }));
    sub.subscribe(['bighack/#']);
    sub.connect();
    await once(sub, 'connect');
    await until(() => got.length === 1);
    assert.deepEqual(got[0], { t: 'bighack/z/a/status', p: '{"online":true}', retain: true, qos: 0 });
    const before = broker.stats.pubacksFromClients;
    await pub.publish('bighack/z/a/readings', '{"readings":{"x":1}}', { qos: 1 });
    await until(() => got.length === 2);
    assert.equal(got[1].qos, 1);
    await until(() => broker.stats.pubacksFromClients === before + 1);
    await pub.end();
    await sub.end();
  });

  test('iscrizione rifiutata dal broker (ACL): errore', async () => {
    const c = new MqttClient(broker.url, { username: 'ponte', password: 'segreta' });
    const errors = [];
    c.on('error', (e) => errors.push(e.message));
    c.connect();
    await once(c, 'connect');
    await assert.rejects(c.subscribe('vietato/#'), /rifiutata/);
    assert.ok(errors.some((m) => /rifiutata/.test(m)));
    await c.end();
  });

  test('riconnessione dopo la caduta del broker, con nuova iscrizione', async () => {
    const c = new MqttClient(broker.url, { username: 'ponte', password: 'segreta', minBackoffMs: 50 });
    c.on('error', () => {});
    const msgs = [];
    c.on('message', (t) => msgs.push(t));
    c.subscribe('riconnessione/#');
    c.connect();
    await once(c, 'connect');
    const reconnected = once(c, 'connect');
    broker.dropAll();
    await reconnected;
    const p = new MqttClient(broker.url, { username: 'ponte', password: 'segreta' });
    p.on('error', () => {});
    p.connect();
    await once(p, 'connect');
    await p.publish('riconnessione/ok', 'x', { qos: 1 });
    await until(() => msgs.includes('riconnessione/ok'));
    await p.end();
    await c.end();
  });

  test('last will alla caduta, nessun last will con DISCONNECT; keepalive', async () => {
    const watcher = new MqttClient(broker.url, { username: 'ponte', password: 'segreta' });
    const wills = [];
    watcher.on('message', (t, p) => wills.push(p.toString()));
    watcher.subscribe('will/#');
    watcher.connect();
    await once(watcher, 'connect');

    const dev = new MqttClient(broker.url, { username: 'ponte', password: 'segreta', keepalive: 1, reconnect: false, will: { topic: 'will/badge', payload: '{"online":false}', qos: 1, retain: true } });
    dev.on('error', () => {});
    dev.connect();
    await once(dev, 'connect');
    const pings = broker.stats.pings;
    await sleep(1200);
    assert.ok(broker.stats.pings > pings, 'PINGREQ inviati con keepalive 1 s');
    dev.transport.close(); // caduta brusca (rete persa): il broker manda il last will
    await until(() => wills.length === 1);
    assert.equal(wills[0], '{"online":false}');

    const polite = new MqttClient(broker.url, { username: 'ponte', password: 'segreta', will: { topic: 'will/altro', payload: 'x' } });
    polite.on('error', () => {});
    polite.connect();
    await once(polite, 'connect');
    await polite.end();
    await sleep(100);
    assert.equal(wills.length, 1, 'con DISCONNECT il broker non manda il last will');
    await watcher.end();
  });

  test('schema non supportato', () => {
    assert.throws(() => new MqttClient('http://x'), /schema non supportato/);
  });
});

// ------------------------------------------------------------------ ponte end-to-end: broker → ponte → hub

describe('ponte MQTT → hub', () => {
  let broker;
  let hub;
  let bridge;
  let pub;
  before(async () => {
    broker = await startMiniBroker();
    hub = createHub({ port: 0, host: '127.0.0.1', staticDir: new URL('../example/', import.meta.url), agents: [], log: silentLogger, llm: { provider: 'mock' }, token: 'segreto' });
    await hub.start();
    const cfg = configFromEnv({
      MQTT_URL: broker.url,
      HUB_URL: hub.url,
      HUB_TOKEN: 'segreto',
      MQTT_MAP: JSON.stringify({ tasmota_ABC123: { zone: 'plebiscito', lat: 40.8359, lon: 14.2488 } }),
      MQTT_C5: '1',
      LOG: 'quiet',
    });
    bridge = startBridge(cfg, { log: { info() {}, debug() {}, warn() {} } });
    await until(() => bridge.stats.mqttConnected);
    pub = new MqttClient(broker.url);
    pub.on('error', () => {});
    pub.connect();
    await once(pub, 'connect');
    await sleep(50); // SUBACK del ponte
  });
  after(async () => {
    await pub.end();
    await bridge.stop();
    await hub.stop();
    await broker.close();
  });

  test('configurazione dalle variabili d\'ambiente', () => {
    const c = configFromEnv({});
    assert.equal(c.mqttUrl, 'mqtt://cloud.robertodisanto.it:1883');
    assert.equal(c.hubUrl, 'http://localhost:8701');
    assert.equal(c.tasmota, true);
    assert.equal(c.c5, false);
    assert.deepEqual(bridge.topics, ['bighack/#', 'tele/+/SENSOR', 'tele/+/STATE', 'tele/+/LWT', 'napoli/sensori/+/+']);
    assert.equal(configFromEnv({ MQTT_TASMOTA: '0', MQTT_TOPICS: 'a/#, b/+' }).topics.join('|'), 'a/#|b/+');
  });

  test('lettura del badge, pulsante, last will, Tasmota e c5 arrivano nello stato del hub', async () => {
    const badge = { deviceId: 'badge-1a2b', ts: Date.now(), location: { lat: 40.8069, lon: 14.1764, zone: 'citta-della-scienza' }, readings: { light_lux: 532, temperature_c: 23.5, supply_v: 4.14, badges_nearby: 2, button: false }, meta: { fw: 'badge-mqtt-0.1.0', net: 'wifi', simulated: false, rssi: -67 } };
    await pub.publish('bighack/citta-della-scienza/badge-1a2b/readings', JSON.stringify(badge), { qos: 1 });
    await pub.publish('bighack/citta-della-scienza/badge-1a2b/readings', JSON.stringify({ ...badge, readings: { ...badge.readings, button: true } }), { qos: 1 });
    await pub.publish('tele/tasmota_ABC123/SENSOR', JSON.stringify({ Time: '2026-11-14T10:00:00', BH1750: { Illuminance: 80 }, AM2301: { Temperature: 19.5, Humidity: 70 } }), { qos: 1 });
    await pub.publish('napoli/sensori/varco_rotonda/persone', JSON.stringify({ zona: 'rotonda_diaz', valore: 3, moltiplicatore: 200 }));
    await pub.publish('bighack/citta-della-scienza/badge-1a2b/status', JSON.stringify({ deviceId: 'badge-1a2b', online: false, zone: 'citta-della-scienza' }), { qos: 1, retain: true });

    await until(() => bridge.stats.forwarded >= 5);
    await bridge.idle();
    await hub.idle();
    const b = hub.state.device('badge-1a2b');
    assert.equal(b.zone, 'citta-della-scienza');
    assert.equal(b.readings.light_lux, 532);
    assert.equal(b.readings.button, true);
    assert.equal(b.readings.online, false);
    const t = hub.state.device('tasmota_ABC123');
    assert.equal(t.zone, 'plebiscito');
    assert.equal(t.readings.light_lux, 80);
    assert.equal(t.readings.temperature_c, 19.5);
    assert.equal(hub.state.device('varco_rotonda').readings.people_count, 600);
    assert.equal(bridge.stats.rejected, 0);
  });

  test('lettura non valida: il hub la rifiuta (400) e il ponte la conta senza fermarsi', async () => {
    const before = bridge.stats.rejected;
    await pub.publish('bighack/z/rotto/readings', JSON.stringify({ readings: { light_lux: 'tanta' } }), { qos: 1 });
    await until(() => bridge.stats.rejected === before + 1);
    await pub.publish('bighack/z/dopo/readings', JSON.stringify({ readings: { light_lux: 5 } }), { qos: 1 });
    await until(() => hub.state.device('dopo'));
  });

  test('token del hub sbagliato: rifiutata (401)', async () => {
    const b2 = startBridge(configFromEnv({ MQTT_URL: broker.url, HUB_URL: hub.url, HUB_TOKEN: 'sbagliato', LOG: 'quiet' }), { log: { info() {}, debug() {}, warn() {} } });
    await until(() => b2.stats.mqttConnected);
    await sleep(50);
    await pub.publish('bighack/z/token/readings', JSON.stringify({ readings: { light_lux: 5 } }), { qos: 1 });
    await until(() => b2.stats.rejected === 1);
    await until(() => hub.state.device('token')); // il ponte con il token giusto la inoltra comunque
    await b2.stop();
  });
});

// ------------------------------------------------------------------ broker vero (facoltativo)

test('broker vero (MQTT_TEST_URL, es. Mosquitto in Docker)', { skip: !process.env.MQTT_TEST_URL && 'MQTT_TEST_URL non impostata' }, async () => {
  const url = process.env.MQTT_TEST_URL;
  const topic = `bighack/test/node-${process.pid}/readings`;
  const sub = new MqttClient(url, { username: process.env.MQTT_TEST_USER, password: process.env.MQTT_TEST_PASSWORD });
  const got = [];
  sub.on('message', (t, p, pkt) => got.push({ t, p: p.toString(), qos: pkt.qos }));
  sub.subscribe(topic, 1);
  sub.connect();
  await once(sub, 'connect');
  await sleep(100);
  const pub = new MqttClient(url, { username: process.env.MQTT_TEST_USER, password: process.env.MQTT_TEST_PASSWORD });
  pub.connect();
  await once(pub, 'connect');
  await pub.publish(topic, JSON.stringify({ readings: { light_lux: 1 } }), { qos: 1 });
  await until(() => got.length === 1);
  assert.equal(got[0].qos, 1);
  await pub.end();
  await sub.end();
});
