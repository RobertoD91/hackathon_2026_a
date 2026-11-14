#!/usr/bin/env node
// Prove MQTT senza installare nulla (stesso client del ponte, nessuna dipendenza npm).
//
//   node shared/iot-agents/tools/mqtt-pub.js <topic> '<payload>' [--retain] [--qos 1]
//   node shared/iot-agents/tools/mqtt-pub.js --sub 'bighack/#'            # stampa i messaggi (come mosquitto_sub)
//   node shared/iot-agents/tools/mqtt-pub.js --badge [--id badge-prova] [--zone citta-della-scienza] [--count 5] [--every 2]
//                                            # simula il badge: status retained + letture come il firmware
//   node shared/iot-agents/tools/mqtt-pub.js --tasmota tasmota_ABC123     # un tele/<topic>/SENSOR con BH1750 + AM2301
//
// Broker: --url oppure MQTT_URL (predefinito mqtt://localhost:1883); credenziali --user/--password
// oppure MQTT_USER/MQTT_PASSWORD; --insecure per TLS senza verifica.

import { MqttClient } from './mqtt-client.js';

const argv = process.argv.slice(2);
const args = { _: [] };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (!a.startsWith('--')) args._.push(a);
  else if (['--retain', '--badge', '--insecure', '--button'].includes(a)) args[a.slice(2)] = true;
  else args[a.slice(2)] = argv[++i];
}

const url = args.url || process.env.MQTT_URL || 'mqtt://localhost:1883';
const client = new MqttClient(url, {
  username: args.user || process.env.MQTT_USER,
  password: args.password || process.env.MQTT_PASSWORD,
  rejectUnauthorized: !args.insecure,
  reconnect: !!args.sub,
});
client.on('error', (e) => {
  console.error(`[mqtt] ${e.message}`);
  if (!args.sub) process.exit(1);
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

client.on('connect', async () => {
  try {
    if (args.sub) {
      console.error(`[mqtt] connesso a ${url}, in ascolto su ${args.sub}`);
      return;
    }
    if (args.badge) {
      const id = args.id || 'badge-prova';
      const zone = args.zone || 'citta-della-scienza';
      const base = `bighack/${zone}/${id}`;
      await client.publish(`${base}/status`, { deviceId: id, online: true, fw: 'mqtt-pub', zone, interval_s: Number(args.every) || 2 }, { qos: 1, retain: true });
      const n = Number(args.count) || 1;
      for (let i = 0; i < n; i++) {
        const body = {
          deviceId: id,
          ts: Date.now(),
          location: { lat: 40.8069, lon: 14.1764, zone },
          readings: { light_lux: Math.round(300 + Math.random() * 400), temperature_c: 22 + Math.round(Math.random() * 20) / 10, supply_v: 4.1, button: !!args.button && i === n - 1 },
          meta: { fw: 'mqtt-pub', net: 'wifi', simulated: true, hw: 'why2025-badge', trigger: 'interval' },
        };
        await client.publish(`${base}/readings`, JSON.stringify(body), { qos: 1 });
        console.log(`${base}/readings ${JSON.stringify(body)}`);
        if (i < n - 1) await sleep((Number(args.every) || 2) * 1000);
      }
    } else if (args.tasmota) {
      const t = args.tasmota;
      const msg = { Time: new Date().toISOString().slice(0, 19), BH1750: { Illuminance: 123 }, AM2301: { Temperature: 21.4, Humidity: 55.2, DewPoint: 12.0 }, TempUnit: 'C' };
      await client.publish(`tele/${t}/LWT`, 'Online', { qos: 1, retain: true });
      await client.publish(`tele/${t}/SENSOR`, JSON.stringify(msg), { qos: 1 });
      console.log(`tele/${t}/SENSOR ${JSON.stringify(msg)}`);
    } else {
      const [topic, payload = ''] = args._;
      if (!topic) throw new Error('uso: mqtt-pub.js <topic> <payload> | --sub <filtro> | --badge | --tasmota <topic>');
      await client.publish(topic, payload, { qos: Number(args.qos) || 0, retain: !!args.retain });
      console.log(`pubblicato su ${topic} (${Buffer.byteLength(payload)} byte)`);
    }
    await client.end();
    process.exit(0);
  } catch (err) {
    console.error(`[mqtt] ${err.message}`);
    process.exit(1);
  }
});

if (args.sub) {
  client.subscribe(args.sub.split(','), 1);
  client.on('message', (topic, payload, p) => console.log(`${topic}${p.retain ? ' (retained)' : ''} ${payload.toString('utf8')}`));
  process.on('SIGINT', async () => {
    await client.end();
    process.exit(0);
  });
}
client.connect();
