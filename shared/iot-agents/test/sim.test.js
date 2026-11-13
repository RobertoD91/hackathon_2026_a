import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createSimulator, parseSimConfig, baseValue, resolveStart, hourOf, formatClock } from '../sim/sim-core.js';
import { validateReading } from '../src/validate.js';
import { createCore } from '../src/core.js';
import { attachSimulator } from '../sim/simulate.js';
import { silentLogger } from '../src/log.js';

const TZ = 'Europe/Rome';
const T0 = resolveStart('12:00', { now: Date.UTC(2026, 10, 14, 9, 0), timezone: TZ }); // 14/11/2026 12:00 a Napoli

const cfg = (over = {}) => ({
  seed: 7,
  intervalSec: 1,
  speed: 1,
  start: T0,
  devices: [
    {
      id: 'casa',
      count: 3,
      jitterM: 100,
      vary: 0.1,
      location: { lat: 40.85, lon: 14.26, zone: 'z' },
      readings: {
        temperature_c: { kind: 'daily', min: 10, max: 20, peakHour: 14, noise: 0.2 },
        light_lux: { kind: 'daylight', max: 50000, sunrise: 7, sunset: 17, effects: { nuvole: { multiply: 0.1 } } },
        button: { kind: 'bool', p: 0 },
        fisso: 5,
      },
    },
  ],
  ...over,
});

test('fuso orario: ora del giorno e HH:MM', () => {
  assert.equal(formatClock(T0, TZ), '12:00');
  assert.equal(hourOf(T0, TZ), 12);
});

test('espansione dei dispositivi e letture valide per il contratto', () => {
  const sim = createSimulator(cfg(), { now: () => T0 });
  assert.deepEqual(sim.devices.map((d) => d.id), ['casa-01', 'casa-02', 'casa-03']);
  const readings = sim.sample(T0);
  for (const r of readings) {
    const v = validateReading(r);
    assert.equal(v.ok, true, v.error);
    assert.equal(r.meta.simulated, true);
    assert.equal(r.meta.net, 'sim');
    assert.equal(typeof r.meta.simTime, 'number');
    assert.equal(r.readings.button, false);
    assert.ok(Math.abs(r.readings.fisso - 5) <= 0.5, 'costante ±vary (10%)');
  }
  // jitter della posizione: tre punti diversi vicini all'originale
  const lats = new Set(readings.map((r) => r.location.lat));
  assert.equal(lats.size, 3);
  for (const r of readings) assert.ok(Math.abs(r.location.lat - 40.85) < 0.002);
});

test('deterministico a parità di seme', () => {
  const a = createSimulator(cfg(), { now: () => T0 }).sample(T0);
  const b = createSimulator(cfg(), { now: () => T0 }).sample(T0);
  assert.deepEqual(a, b);
  const c = createSimulator(cfg({ seed: 8 }), { now: () => T0 }).sample(T0);
  assert.notDeepEqual(a.map((r) => r.readings), c.map((r) => r.readings));
});

test('andamenti di base', () => {
  const at = (h) => T0 + (h - 12) * 3_600_000;
  const daily = { kind: 'daily', min: 10, max: 20, peakHour: 14 };
  assert.equal(Math.round(baseValue(daily, at(14), { timezone: TZ })), 20);
  assert.equal(Math.round(baseValue(daily, at(2 + 24), { timezone: TZ })), 10);
  const sun = { kind: 'daylight', max: 1000, sunrise: 7, sunset: 17 };
  assert.equal(baseValue(sun, at(12), { timezone: TZ }), 1000);
  assert.equal(baseValue(sun, at(20), { timezone: TZ }), 0);
  const prof = { kind: 'profile', points: [[8, 100], [10, 300]] };
  assert.equal(baseValue(prof, at(9), { timezone: TZ }), 200);
  const ramp = { kind: 'ramp', from: 0, to: 100, periodSec: 3600 };
  assert.equal(baseValue(ramp, T0 + 1_800_000, { timezone: TZ, startSim: T0 }), 50);
  assert.equal(baseValue(ramp, T0 + 5_400_000, { timezone: TZ, startSim: T0 }), 50, 'la rampa ricomincia');
});

test('accelerazione del tempo', () => {
  let t = 1_000_000;
  const sim = createSimulator(cfg({ speed: 60 }), { now: () => t });
  t += 10_000; // 10 s reali = 10 min simulati
  assert.equal(sim.simTime(t) - T0, 600_000);
});

test('timeline con offset: scenari emessi ed effetti applicati', () => {
  let t = 1_000_000;
  const scen = [];
  const sent = [];
  const sim = createSimulator(
    cfg({ timeline: [{ at: 5, name: 'nuvole', params: { forza: 2 }, duration: 10 }] }),
    { now: () => t, emit: (r) => sent.push(r), emitScenario: (s) => scen.push(s) },
  );
  sim.step(t);
  assert.equal(sent.length, 3);
  const luceSole = sent[0].readings.light_lux;
  t += 6000;
  sim.step(t);
  assert.deepEqual(scen, [{ name: 'nuvole', params: { forza: 2 }, active: true, duration: 10 }]);
  assert.deepEqual(sim.activeScenarios(), ['nuvole']);
  const conNuvole = sent.filter((r) => r.deviceId === 'casa-01').at(-1).readings.light_lux;
  assert.ok(conNuvole < luceSole * 0.2, `${conNuvole} vs ${luceSole}`);
  t += 11_000;
  sim.step(t);
  assert.deepEqual(sim.activeScenarios(), [], 'scaduta la durata, l\'effetto finisce');
  assert.equal(scen.length, 1, 'la timeline non si ripete senza loopSec');
});

test('onScenarioEvent: effetti attivati da scenari esterni', () => {
  let t = 1_000_000;
  const sim = createSimulator(cfg(), { now: () => t, selfTrigger: false });
  const base = sim.sample(t)[0].readings.light_lux;
  sim.onScenarioEvent({ name: 'nuvole', params: {}, active: true });
  assert.ok(sim.sample(t)[0].readings.light_lux < base * 0.2);
  sim.onScenarioEvent({ name: 'nuvole', active: false });
  assert.deepEqual(sim.activeScenarios(), []);
});

test('configurazione non valida: errori chiari', () => {
  assert.throws(() => parseSimConfig({}), /devices/);
  assert.throws(() => parseSimConfig({ devices: [{ readings: { x: 1 } }] }), /id/);
  assert.throws(() => parseSimConfig({ devices: [{ id: 'a', readings: { x: { kind: 'boh' } } }] }), /sconosciuto/);
  assert.throws(() => parseSimConfig({ devices: [{ id: 'a', readings: { x: 1 } }], timeline: [{ name: 'x' }] }), /at/);
});

test('configurazione dell\'esempio valida', async () => {
  const conf = JSON.parse(await readFile(new URL('../example/sim-config.json', import.meta.url), 'utf8'));
  const sim = createSimulator(conf);
  assert.equal(sim.devices.length, 11);
  for (const r of sim.sample()) assert.equal(validateReading(r).ok, true);
});

test('attachSimulator: letture nel hub e scenari manuali che cambiano i dati', async () => {
  const core = createCore({ log: silentLogger, llm: { provider: 'mock' } });
  const att = attachSimulator(core, cfg({ intervalSec: 0.2 }), { log: silentLogger });
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(core.state.devices().length, 3);
  const prima = core.state.average('light_lux');
  core.scenario('nuvole', {}, { duration: 5 });
  await new Promise((r) => setTimeout(r, 500));
  assert.ok(core.state.average('light_lux') < prima * 0.2);
  att.stop();
  await core.stop();
});
