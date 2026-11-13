// Validazione delle letture dei sensori (CONTRATTO.md, sezione 1). Isomorfo.
//
//   const r = validateReading(body);
//   if (!r.ok) return res400(r.error);
//   use(r.value);   // lettura normalizzata (ts sempre presente)

export const NET_VALUES = Object.freeze(['5g', 'wifi', 'sim']);

/** Nomi standard delle grandezze (altri nomi sono ammessi se rispettano il formato). */
export const STANDARD_READINGS = Object.freeze([
  'temperature_c',
  'humidity_pct',
  'light_lux',
  'soil_moisture_pct',
  'fill_pct',
  'button',
  'power_w',
  'people_count',
]);

const DEVICE_ID_RE = /^[A-Za-z0-9._:-]{1,64}$/;
const READING_KEY_RE = /^[A-Za-z][A-Za-z0-9_]{0,47}$/;
const MAX_READINGS = 32;
// Sotto questa soglia il ts non è un epoch in ms (es. millis() dell'ESP32 senza NTP).
const MIN_PLAUSIBLE_TS = 1_000_000_000_000; // 9 settembre 2001

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const fail = (error) => ({ ok: false, error });

/**
 * Valida e normalizza il corpo di `POST /api/readings`.
 *
 * Regole:
 * - `deviceId`: stringa 1-64 caratteri `[A-Za-z0-9._:-]`, obbligatoria;
 * - `ts`: facoltativo; se manca o non è un epoch in ms plausibile lo mette il server
 *   (il valore originale finisce in `meta.deviceTs`);
 * - `location`: facoltativa; `lat` in [-90, 90], `lon` in [-180, 180], `zone` stringa;
 * - `readings`: oggetto non vuoto (max 32 chiavi) `nome → numero finito | boolean`;
 * - `meta`: facoltativo; `net` ∈ {"5g","wifi","sim"}, `simulated` boolean, altre chiavi libere.
 *
 * @param {unknown} body
 * @param {{now?: number}} [opts]
 * @returns {{ok: true, value: object} | {ok: false, error: string}}
 */
export function validateReading(body, { now = Date.now() } = {}) {
  if (!isObj(body)) return fail('il corpo deve essere un oggetto JSON');

  const { deviceId, ts, location, readings, meta } = body;

  if (typeof deviceId !== 'string' || !DEVICE_ID_RE.test(deviceId)) {
    return fail('"deviceId" obbligatorio: stringa di 1-64 caratteri tra lettere, cifre e . _ : -');
  }

  let outMeta = {};
  if (meta !== undefined) {
    if (!isObj(meta)) return fail('"meta" deve essere un oggetto');
    if (meta.net !== undefined && !NET_VALUES.includes(meta.net)) {
      return fail(`"meta.net" deve essere uno tra ${NET_VALUES.join(', ')}`);
    }
    if (meta.simulated !== undefined && typeof meta.simulated !== 'boolean') {
      return fail('"meta.simulated" deve essere boolean');
    }
    outMeta = { ...meta };
  }

  let outTs = now;
  if (ts !== undefined && ts !== null) {
    if (typeof ts !== 'number' || !Number.isFinite(ts)) return fail('"ts" deve essere un numero (ms epoch)');
    if (ts >= MIN_PLAUSIBLE_TS) outTs = Math.round(ts);
    else outMeta.deviceTs = ts; // es. millis() dall'avvio: teniamo l'originale, usiamo l'ora del server
  }

  let outLocation;
  if (location !== undefined && location !== null) {
    if (!isObj(location)) return fail('"location" deve essere un oggetto');
    const { lat, lon, zone } = location;
    if (lat !== undefined && (typeof lat !== 'number' || !(lat >= -90 && lat <= 90))) {
      return fail('"location.lat" deve essere un numero tra -90 e 90');
    }
    if (lon !== undefined && (typeof lon !== 'number' || !(lon >= -180 && lon <= 180))) {
      return fail('"location.lon" deve essere un numero tra -180 e 180');
    }
    if (zone !== undefined && (typeof zone !== 'string' || zone.length > 64)) {
      return fail('"location.zone" deve essere una stringa (max 64 caratteri)');
    }
    outLocation = { ...location };
  }

  if (!isObj(readings)) return fail('"readings" obbligatorio: oggetto nome_unità → numero | boolean');
  const keys = Object.keys(readings);
  if (keys.length === 0) return fail('"readings" è vuoto');
  if (keys.length > MAX_READINGS) return fail(`"readings" ha più di ${MAX_READINGS} grandezze`);
  const outReadings = {};
  for (const k of keys) {
    if (!READING_KEY_RE.test(k)) {
      return fail(`nome di grandezza non valido: "${k}" (usa lettere, cifre e _, es. temperature_c)`);
    }
    const v = readings[k];
    if (typeof v === 'boolean') outReadings[k] = v;
    else if (typeof v === 'number' && Number.isFinite(v)) outReadings[k] = v;
    else return fail(`"readings.${k}" deve essere un numero finito o un boolean`);
  }

  const value = { deviceId, ts: outTs, readings: outReadings, meta: outMeta };
  if (outLocation) value.location = outLocation;
  return { ok: true, value };
}

/**
 * Valida il corpo di `POST /api/scenario`: `{ name, params?, active?, duration? }`.
 * @returns {{ok: true, value: object} | {ok: false, error: string}}
 */
export function validateScenario(body) {
  if (!isObj(body)) return fail('il corpo deve essere un oggetto JSON');
  const { name, params = {}, active = true, duration } = body;
  if (typeof name !== 'string' || !/^[A-Za-z0-9_.:-]{1,64}$/.test(name)) {
    return fail('"name" obbligatorio: stringa 1-64 caratteri tra lettere, cifre e _ . : -');
  }
  if (!isObj(params)) return fail('"params" deve essere un oggetto');
  if (typeof active !== 'boolean') return fail('"active" deve essere boolean');
  if (duration !== undefined && (typeof duration !== 'number' || !(duration > 0))) {
    return fail('"duration" (secondi) deve essere un numero positivo');
  }
  const value = { name, params, active };
  if (duration !== undefined) value.duration = duration;
  return { ok: true, value };
}

/** Valida il corpo di `POST /api/chat`: `{ from, text }`. */
export function validateChat(body) {
  if (!isObj(body)) return fail('il corpo deve essere un oggetto JSON');
  const { from = 'anonimo', text } = body;
  if (typeof from !== 'string' || from.length > 128) return fail('"from" deve essere una stringa (max 128)');
  if (typeof text !== 'string' || !text.trim()) return fail('"text" obbligatorio');
  if (text.length > 4000) return fail('"text" troppo lungo (max 4000 caratteri)');
  return { ok: true, value: { from, text: text.trim() } };
}
