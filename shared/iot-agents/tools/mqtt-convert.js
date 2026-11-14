// Conversione dei messaggi MQTT nel formato delle letture del contratto (CONTRATTO.md, sezione 1).
// Funzioni pure (più una piccola cache per lo stato Tasmota), usate da mqtt-bridge.js e dai test.
//
// Topic riconosciuti (prefisso "bighack" e "napoli" configurabili):
//   bighack/<zona>/<deviceId>/readings      JSON del contratto (anche parziale o un array)
//   bighack/<zona>/<deviceId>/status        {"online": true|false} → lettura { online }
//   tele/<topic>/SENSOR|STATE|LWT           telemetria Tasmota (FullTopic predefinito %prefix%/%topic%/)
//   bighack/<zona>/<topic>/tele/SENSOR|...  Tasmota con FullTopic bighack/<zona>/%topic%/%prefix%/
//   napoli/sensori/<nodo>/<grandezza>       formato di c5-agentic-city {"valore": n, "zona": "..."}
//
//   const conv = createConverter({ map, defaultZone });
//   const { readings, skip } = conv.convert(topic, payloadBuffer, { retain });

const ID_RE = /^[A-Za-z0-9._:-]{1,64}$/;
const KEY_RE = /^[A-Za-z][A-Za-z0-9_]{0,47}$/;
const MAX_READINGS = 32;

/** Rende un id valido per il contratto: caratteri non ammessi → "-", massimo 64. */
export function sanitizeId(s) {
  const out = String(s ?? '').replace(/[^A-Za-z0-9._:-]/g, '-').slice(0, 64);
  return out || 'sconosciuto';
}

/** Rende un nome di grandezza valido: minuscolo, [a-z0-9_], inizia con una lettera, max 48. */
export function sanitizeKey(s) {
  let k = String(s ?? '')
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!/^[a-z]/.test(k)) k = `x_${k}`;
  return k.slice(0, 48).replace(/_+$/, '');
}

function parseJson(buf) {
  const text = Buffer.isBuffer(buf) ? buf.toString('utf8') : String(buf ?? '');
  try {
    return { ok: true, value: JSON.parse(text), text };
  } catch {
    return { ok: false, text };
  }
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined);
const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

// ------------------------------------------------------------------ Tasmota

/** Campi dei sensori Tasmota → grandezza del contratto (con eventuale conversione di unità). */
const TASMOTA_FIELDS = {
  Temperature: 'temperature_c',
  Humidity: 'humidity_pct',
  Illuminance: 'light_lux',
  Pressure: 'pressure_hpa',
  SeaPressure: 'sea_pressure_hpa',
  DewPoint: 'dew_point_c',
  CarbonDioxide: 'co2_ppm',
  eCO2: 'eco2_ppm',
  TVOC: 'tvoc_ppb',
  Distance: 'distance_cm',
  UvIndex: 'uv_index',
  UvLevel: 'uv_level',
  Moisture: 'soil_moisture_pct',
  'PM1': 'pm1_ugm3',
  'PM2.5': 'pm25_ugm3',
  'PM10': 'pm10_ugm3',
  Gas: 'gas_kohm',
  Weight: 'weight_kg',
};

const TASMOTA_ENERGY = {
  Power: 'power_w',
  ApparentPower: 'apparent_power_va',
  ReactivePower: 'reactive_power_var',
  Factor: 'power_factor',
  Voltage: 'voltage_v',
  Current: 'current_a',
  Today: 'energy_today_kwh',
  Yesterday: 'energy_yesterday_kwh',
  Total: 'energy_total_kwh',
};

// Chiavi di primo livello che non sono sensori
const TASMOTA_SKIP = new Set(['Time', 'TempUnit', 'PressureUnit', 'SpeedUnit', 'Epoch', 'Uptime', 'UptimeSec']);

function toCelsius(v, unit) {
  return unit === 'F' ? round(((v - 32) * 5) / 9, 2) : v;
}

function toHpa(v, unit) {
  if (unit === 'mmHg') return round(v * 1.333224, 1);
  if (unit === 'inHg') return round(v * 33.86389, 1);
  return v;
}

/**
 * Converte un tele/<topic>/SENSOR di Tasmota in grandezze del contratto.
 * Il primo sensore di ogni tipo prende il nome standard (es. temperature_c); gli altri
 * il nome con il sensore (temperature_c_ds18b20_2). Le chiavi sconosciute si saltano.
 * @returns {{ readings: object, sensors: string[] }}
 */
export function tasmotaSensorReadings(obj) {
  const readings = {};
  const sensors = [];
  const tempUnit = obj.TempUnit;
  const pressUnit = obj.PressureUnit;
  const put = (std, sensorKey, value) => {
    if (value === undefined || Object.keys(readings).length >= MAX_READINGS) return;
    let k = std;
    if (k in readings) k = sanitizeKey(`${std}_${sensorKey}`);
    for (let i = 2; k in readings; i++) k = sanitizeKey(`${std}_${sensorKey}_${i}`);
    if (KEY_RE.test(k)) readings[k] = value;
  };
  for (const [key, val] of Object.entries(obj)) {
    if (TASMOTA_SKIP.has(key)) continue;
    // Switch1: "ON"/"OFF" (SwitchMode con SetOption...): boolean
    if (/^Switch\d*$/.test(key) && typeof val === 'string') {
      put(sanitizeKey(key), key, val.toUpperCase() === 'ON');
      continue;
    }
    if (!isObj(val)) continue;
    sensors.push(key);
    const isEnergy = key === 'ENERGY';
    const isAnalog = key === 'ANALOG';
    for (const [field, raw] of Object.entries(val)) {
      const std = isEnergy ? TASMOTA_ENERGY[field] : TASMOTA_FIELDS[field];
      if (isAnalog && !std && /^(A|Range)\d+$/.test(field)) {
        const v = num(raw);
        if (v !== undefined) put(sanitizeKey(`analog_${field}`), key, v); // ADC grezzo (es. fotoresistenza)
        continue;
      }
      if (!std) continue;
      if (Array.isArray(raw)) {
        // prese multicanale: un valore per canale, e per la potenza anche la somma
        const vals = raw.map(num).filter((v) => v !== undefined);
        vals.forEach((v, i) => put(`${std}_${i + 1}`, key, v));
        if (vals.length && std === 'power_w') put(std, key, round(vals.reduce((a, b) => a + b, 0), 2));
        continue;
      }
      let v = num(raw);
      if (v === undefined) continue;
      if (std === 'temperature_c' || std === 'dew_point_c') v = toCelsius(v, tempUnit);
      if (std === 'pressure_hpa' || std === 'sea_pressure_hpa') v = toHpa(v, pressUnit);
      put(std, key, v);
    }
  }
  return { readings, sensors };
}

// ------------------------------------------------------------------ c5-agentic-city

/** Grandezze di napoli/sensori/<nodo>/<grandezza> → nomi del contratto. */
const C5_NAMES = {
  luce: 'light_lux',
  temperatura: 'temperature_c',
  umidita: 'humidity_pct',
  pressione: 'pressure_hpa',
  tensione: 'supply_v',
  persone: 'people_count',
  badge_vicini: 'badges_nearby',
  pulsante: 'button',
};

// ------------------------------------------------------------------ convertitore

/**
 * @param {object} [o]
 * @param {Record<string, {zone?:string, lat?:number, lon?:number, deviceId?:string}>} [o.map]
 *        posizione per deviceId, topic Tasmota o nodo c5 (vince su quella dichiarata dal dispositivo)
 * @param {string} [o.defaultZone] zona per i dispositivi Tasmota/c5 senza zona
 * @param {string} [o.prefix='bighack'] @param {string} [o.c5Prefix='napoli']
 * @param {boolean} [o.tasmota=true] @param {boolean} [o.c5=false] @param {boolean} [o.status=true]
 */
export function createConverter(o = {}) {
  const map = o.map || {};
  const prefix = o.prefix || 'bighack';
  const c5Prefix = o.c5Prefix || 'napoli';
  const opts = { tasmota: o.tasmota !== false, c5: !!o.c5, status: o.status !== false };
  const tasmotaRssi = new Map(); // topic Tasmota → dBm (da tele/<topic>/STATE)

  function parseTopic(topic) {
    const t = topic.split('/');
    const pre = prefix.split('/');
    const hasPrefix = pre.every((p, i) => t[i] === p);
    const rest = hasPrefix ? t.slice(pre.length) : null;
    if (rest && rest.length === 3) {
      const [zone, id, leaf] = rest;
      if (leaf === 'readings') return { kind: 'readings', zone, id };
      if (leaf === 'status') return { kind: 'status', zone, id };
      return { kind: 'ignore', reason: `foglia "${leaf}" non letta dal ponte` };
    }
    if (rest && rest.length === 4 && rest[2] === 'tele') return { kind: 'tasmota', zone: rest[0], tasmotaTopic: rest[1], leaf: rest[3] };
    if (t.length === 3 && t[0] === 'tele') return { kind: 'tasmota', tasmotaTopic: t[1], leaf: t[2] };
    const c5 = c5Prefix.split('/');
    if (t.length === c5.length + 3 && c5.every((p, i) => t[i] === p) && t[c5.length] === 'sensori') {
      return { kind: 'c5', node: t[c5.length + 1], quantity: t[c5.length + 2] };
    }
    return { kind: 'ignore', reason: 'topic non riconosciuto' };
  }

  /** Applica la mappa e completa location/meta. */
  function finish(body, keys, zoneFromTopic) {
    const entry = keys.map((k) => map[k]).find(Boolean);
    const location = isObj(body.location) ? { ...body.location } : {};
    if (location.zone === undefined && zoneFromTopic && zoneFromTopic !== 'senza-zona') location.zone = zoneFromTopic;
    if (location.zone === undefined && o.defaultZone) location.zone = o.defaultZone;
    if (entry) {
      if (entry.zone !== undefined) location.zone = entry.zone;
      if (typeof entry.lat === 'number') location.lat = entry.lat;
      if (typeof entry.lon === 'number') location.lon = entry.lon;
      if (entry.deviceId) body.deviceId = entry.deviceId;
    }
    body.deviceId = ID_RE.test(String(body.deviceId ?? '')) ? body.deviceId : sanitizeId(body.deviceId);
    if (Object.keys(location).length) body.location = location;
    else delete body.location;
    body.meta = { ...(isObj(body.meta) ? body.meta : {}), via: 'mqtt' };
    return body;
  }

  function fromContract(obj, info) {
    if (!isObj(obj)) return null;
    const body = { ...obj };
    if (!isObj(body.readings)) {
      // forma corta: {"light_lux": 12, "button": true} → readings
      const readings = {};
      for (const [k, v] of Object.entries(obj)) {
        if (['deviceId', 'ts', 'location', 'meta'].includes(k)) continue;
        if ((typeof v === 'number' && Number.isFinite(v)) || typeof v === 'boolean') readings[k] = v;
        delete body[k];
      }
      body.readings = readings;
    }
    if (!Object.keys(body.readings).length) return null;
    if (body.deviceId === undefined) body.deviceId = info.id;
    return finish(body, [body.deviceId, info.id], info.zone);
  }

  function convert(topic, payload, { retain = false } = {}) {
    const info = parseTopic(topic);
    if (info.kind === 'ignore') return { readings: [], skip: info.reason };
    const j = parseJson(payload);

    if (info.kind === 'readings') {
      if (!j.ok) return { readings: [], skip: 'JSON non valido' };
      const list = (Array.isArray(j.value) ? j.value : [j.value]).map((v) => fromContract(v, info)).filter(Boolean);
      return list.length ? { readings: list } : { readings: [], skip: 'nessuna grandezza' };
    }

    if (info.kind === 'status') {
      if (!opts.status) return { readings: [], skip: 'stato disattivato (MQTT_STATUS=0)' };
      let online;
      if (j.ok && isObj(j.value) && typeof j.value.online === 'boolean') online = j.value.online;
      else if (/^(online|offline|true|false|1|0)$/i.test(j.text.trim())) online = /^(online|true|1)$/i.test(j.text.trim());
      if (online === undefined) return { readings: [], skip: 'stato senza "online"' };
      const v = isObj(j.value) ? j.value : {};
      const body = { deviceId: v.deviceId ?? info.id, readings: { online }, meta: { source: 'status', retained: retain } };
      if (v.zone) body.location = { zone: v.zone };
      return { readings: [finish(body, [body.deviceId, info.id], info.zone)] };
    }

    if (info.kind === 'tasmota') {
      if (!opts.tasmota) return { readings: [], skip: 'Tasmota disattivato (MQTT_TASMOTA=0)' };
      const tt = info.tasmotaTopic;
      const base = (readings, extraMeta = {}) =>
        finish(
          { deviceId: tt, readings, meta: { source: 'tasmota', tasmotaTopic: tt, net: 'wifi', simulated: false, ...extraMeta } },
          [tt],
          info.zone,
        );
      if (info.leaf === 'LWT') {
        const s = j.text.trim();
        if (!/^(online|offline)$/i.test(s)) return { readings: [], skip: 'LWT sconosciuto' };
        return { readings: [base({ online: /^online$/i.test(s) }, { retained: retain })] };
      }
      if (!j.ok || !isObj(j.value)) return { readings: [], skip: 'JSON non valido' };
      if (info.leaf === 'STATE') {
        const sig = num(j.value.Wifi?.Signal);
        if (sig !== undefined) tasmotaRssi.set(tt, sig);
        const relays = {};
        for (const [k, v] of Object.entries(j.value)) {
          const m = /^POWER(\d*)$/.exec(k);
          if (m && typeof v === 'string') relays[m[1] ? `relay_${m[1]}` : 'relay'] = v.toUpperCase() === 'ON';
        }
        if (!Object.keys(relays).length) return { readings: [], skip: 'STATE senza relè (RSSI memorizzato)' };
        return { readings: [base(relays, sig !== undefined ? { rssi: sig } : {})] };
      }
      if (info.leaf === 'SENSOR') {
        const { readings, sensors } = tasmotaSensorReadings(j.value);
        if (!Object.keys(readings).length) return { readings: [], skip: `nessun sensore riconosciuto (${sensors.join(', ') || 'vuoto'})` };
        const meta = { sensors };
        if (typeof j.value.Time === 'string') meta.deviceTime = j.value.Time; // ora locale del dispositivo, senza fuso: il ts lo mette il hub
        if (tasmotaRssi.has(tt)) meta.rssi = tasmotaRssi.get(tt);
        return { readings: [base(readings, meta)] };
      }
      return { readings: [], skip: `tele/${info.leaf} non letto dal ponte` };
    }

    if (info.kind === 'c5') {
      if (!opts.c5) return { readings: [], skip: 'c5 disattivato (MQTT_C5=0)' };
      const v = j.ok ? (isObj(j.value) ? j.value : { valore: j.value }) : { valore: num(j.text) };
      if (v.deviceId) return { readings: [], skip: 'copia c5 di un dispositivo bighack (già letto da bighack/#)' };
      const value = typeof v.valore === 'boolean' ? v.valore : num(v.valore);
      if (value === undefined) return { readings: [], skip: 'c5 senza "valore" numerico' };
      const name = C5_NAMES[info.quantity] || sanitizeKey(info.quantity);
      const readings = {};
      const meta = { source: 'c5' };
      if (name === 'people_count' && num(v.moltiplicatore) !== undefined && typeof value === 'number') {
        readings.people_count = Math.round(value * num(v.moltiplicatore)); // come l'agente Folla di c5
        meta.valore = value;
        meta.moltiplicatore = num(v.moltiplicatore);
      } else {
        readings[name] = value;
      }
      const body = { deviceId: info.node, readings, meta };
      if (typeof v.zona === 'string' && v.zona) body.location = { zone: v.zona };
      return { readings: [finish(body, [info.node])] };
    }
    return { readings: [], skip: 'topic non riconosciuto' };
  }

  /** Topic a cui iscriversi per questa configurazione. */
  function topics() {
    const list = [`${prefix}/#`];
    if (opts.tasmota) list.push('tele/+/SENSOR', 'tele/+/STATE', 'tele/+/LWT');
    if (opts.c5) list.push(`${c5Prefix}/sensori/+/+`);
    return list;
  }

  return { convert, parseTopic, topics };
}
