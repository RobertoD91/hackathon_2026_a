import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateReading, validateScenario, validateChat } from '../src/validate.js';

const ok = {
  deviceId: 'esp32-plebiscito-01',
  ts: 1763000000000,
  location: { lat: 40.8359, lon: 14.2488, zone: 'plebiscito' },
  readings: { temperature_c: 24.1, light_lux: 5300, humidity_pct: 61, button: false },
  meta: { fw: '0.1.0', net: '5g', simulated: false },
};

test('lettura del contratto valida', () => {
  const r = validateReading(ok);
  assert.equal(r.ok, true);
  assert.deepEqual(r.value.readings, ok.readings);
  assert.equal(r.value.ts, ok.ts);
  assert.equal(r.value.location.zone, 'plebiscito');
});

test('ts mancante: lo mette il server', () => {
  const r = validateReading({ deviceId: 'a', readings: { x: 1 } }, { now: 1_800_000_000_000 });
  assert.equal(r.ok, true);
  assert.equal(r.value.ts, 1_800_000_000_000);
});

test('ts non plausibile (millis dall\'avvio): ora del server e originale in meta.deviceTs', () => {
  const r = validateReading({ deviceId: 'a', ts: 12345, readings: { x: 1 } }, { now: 1_800_000_000_000 });
  assert.equal(r.ok, true);
  assert.equal(r.value.ts, 1_800_000_000_000);
  assert.equal(r.value.meta.deviceTs, 12345);
});

test('errori di validazione con messaggio chiaro', () => {
  const cases = [
    [null, /oggetto JSON/],
    [[], /oggetto JSON/],
    [{ readings: { x: 1 } }, /deviceId/],
    [{ deviceId: 'con spazi', readings: { x: 1 } }, /deviceId/],
    [{ deviceId: 'a' }, /readings/],
    [{ deviceId: 'a', readings: {} }, /vuoto/],
    [{ deviceId: 'a', readings: { x: 'caldo' } }, /readings\.x/],
    [{ deviceId: 'a', readings: { x: NaN } }, /readings\.x/],
    [{ deviceId: 'a', readings: { 'temp-c': 1 } }, /non valido/],
    [{ deviceId: 'a', readings: { x: 1 }, ts: 'ieri' }, /ts/],
    [{ deviceId: 'a', readings: { x: 1 }, location: { lat: 100 } }, /lat/],
    [{ deviceId: 'a', readings: { x: 1 }, location: { lon: 'est' } }, /lon/],
    [{ deviceId: 'a', readings: { x: 1 }, meta: { net: 'lora' } }, /meta\.net/],
    [{ deviceId: 'a', readings: { x: 1 }, meta: { simulated: 'no' } }, /simulated/],
  ];
  for (const [body, re] of cases) {
    const r = validateReading(body);
    assert.equal(r.ok, false, JSON.stringify(body));
    assert.match(r.error, re);
  }
});

test('troppe grandezze', () => {
  const readings = Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`g${i}`, i]));
  assert.equal(validateReading({ deviceId: 'a', readings }).ok, false);
});

test('validateScenario e validateChat', () => {
  assert.deepEqual(validateScenario({ name: 'metro_guasto', params: { linea: 1 } }).value, {
    name: 'metro_guasto',
    params: { linea: 1 },
    active: true,
  });
  assert.equal(validateScenario({ name: 'x', duration: 30 }).value.duration, 30);
  assert.equal(validateScenario({ name: '' }).ok, false);
  assert.equal(validateScenario({ name: 'x', params: [] }).ok, false);
  assert.equal(validateScenario({ name: 'x', duration: -1 }).ok, false);
  assert.deepEqual(validateChat({ text: '  ciao ' }).value, { from: 'anonimo', text: 'ciao' });
  assert.equal(validateChat({ from: 'u', text: '' }).ok, false);
});
