// Lettura dei tetti dallo stato condiviso: per ogni tetto sceglie il sensore da usare e
// converte la luce in kW. Lo usano l'agente produzione e l'agente comunità (stessa regola).
//
// Regola: se nella zona del tetto c'è un ESP32 VERO che ha scritto negli ultimi `maxEtaReale` ms,
// si usa quello (e il simulato della stessa zona viene ignorato); altrimenti il più recente.

import { TETTI } from './quartiere.js';
import { luxToKw } from './energia.js';

/**
 * @param {object} state  ctx.state (HubState)
 * @param {{tetti?: object[], luxGain?: Object<string, number>, now?: number, maxEtaReale?: number}} [opts]
 *   luxGain: moltiplicatore della luce per deviceId (es. demo al chiuso con un ESP32 vero)
 * @returns {{id, nome, zona, kWp, kw, lux, temp, deviceId, reale, ts}[]}
 */
export function letturaTetti(state, { tetti = TETTI, luxGain = {}, now = Date.now(), maxEtaReale = 30_000 } = {}) {
  return tetti.map((t) => {
    const devs = state.byZone(t.zona).filter((d) => typeof d.readings.light_lux === 'number' || typeof d.readings.temperature_c === 'number');
    const reali = devs.filter((d) => !d.simulated && now - d.receivedAt < maxEtaReale);
    const pool = reali.length ? reali : devs;
    const d = pool.sort((a, b) => b.receivedAt - a.receivedAt)[0];
    if (!d) return { ...t, kw: 0, lux: null, temp: null, deviceId: null, reale: false, ts: null };
    const gain = luxGain[d.deviceId] ?? 1;
    const lux = typeof d.readings.light_lux === 'number' ? d.readings.light_lux * gain : null;
    return {
      ...t,
      kw: lux === null ? 0 : luxToKw(lux, t.kWp, t.luxPerWm2 ? { luxPerWm2: t.luxPerWm2 } : {}),
      lux,
      temp: typeof d.readings.temperature_c === 'number' ? d.readings.temperature_c : null,
      deviceId: d.deviceId,
      reale: !d.simulated,
      net: d.meta?.net ?? null,
      ts: d.receivedAt,
    };
  });
}

/** Temperatura da usare per una scala: quella del suo tetto, o la media dei tetti. */
export function temperaturaScala(letture, scala) {
  const own = letture.find((t) => t.zona === `scala-${String(scala).toLowerCase()}`);
  if (own && typeof own.temp === 'number') return own.temp;
  const v = letture.map((t) => t.temp).filter((x) => typeof x === 'number');
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}
