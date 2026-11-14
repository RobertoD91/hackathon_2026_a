// Simulatore della fattoria: il simulatore generico (sim/sim-core.js, con sim-config.json)
// più un bilancio idrico semplificato che lo rende "a circuito chiuso". Isomorfo: lo usano
// il server (server.js --scenario fattoria) e la pagina in modalità demo (scenario.js).
//
// Perché serve: il simulatore generico produce andamenti che non dipendono dagli agenti;
// qui invece l'umidità del suolo deve SCENDERE con l'evapotraspirazione e SALIRE quando il
// consorzio apre l'acqua di un campo, e il serbatoio deve svuotarsi con i turni.
//
// Come funziona: ogni lettura del simulatore generico passa da `fisica.applica(lettura)`:
// - campi (soil_moisture_pct): valore del sim-config (umidità iniziale + rumore + effetti)
//   + un bilancio che si accumula: − ET0 × Kc × (frazione della giornata trascorsa, a campana
//   tra alba e tramonto) × k, + acqua dei turni × efficienza × k, − drenaggio sopra il 34 %;
// - serbatoio (fill_pct): valore iniziale − acqua dei turni + ricarica del pozzo.
// I turni arrivano dalle decisioni del consorzio con un'azione `{ type: 'apri_valvola', zone,
// litri, minuti, inizio }` (in produzione la stessa azione comanderebbe l'elettrovalvola di un
// ESP32 con relè). Quando la giornata simulata ricomincia (loopSec) il bilancio si azzera.
// Valori indicativi: è un modello per la demo, non un modello agronomico validato.

import { createSimulator, hourOf, createRandom } from '../../sim/sim-core.js';
import { CAMPI, SERBATOIO, SOGLIE_UMIDITA, parametri } from './campi.js';

const H = 3_600_000;

/** Frazione dell'ET giornaliera tra le ore h0 e h1 (stesso giorno), distribuita a campana tra alba e tramonto. */
function frazioneGiorno(h0, h1, alba, tramonto) {
  const F = (h) => {
    if (h <= alba) return 0;
    if (h >= tramonto) return 1;
    return (1 - Math.cos((Math.PI * (h - alba)) / (tramonto - alba))) / 2;
  };
  return h1 >= h0 ? F(h1) - F(h0) : F(24) - F(h0) + F(h1); // a cavallo della mezzanotte
}

/**
 * Bilancio idrico di campi e serbatoio.
 * @param {object} [conf]  blocco "fisica" del sim-config
 * @param {{attivi?: () => string[], timezone?: string, efficienza?: number}} [opts]
 */
export function createFisica(conf = {}, opts = {}) {
  const tz = opts.timezone || 'Europe/Rome';
  const attivi = opts.attivi || (() => []);
  const et0 = conf.et0 ?? 5.6;
  const alba = conf.alba ?? 5.6;
  const tramonto = conf.tramonto ?? 20.5;
  const efficienza = conf.efficienza ?? 0.9;
  const drenaggioOre = conf.drenaggioOre ?? 6;
  const effetti = conf.effetti || {};
  const rnd = createRandom(conf.seme ?? 11);
  let delta = {}; // zona → { d: punti % (campi) o m³ (serbatoio), t: ultima ora simulata }
  let valvole = []; // { zona, litri, inizio, fine }
  let ultimo = null;

  const fattore = (chiave) => attivi().reduce((f, nome) => f * (effetti[nome]?.[chiave] ?? 1), 1);

  /** Litri consegnati al campo `zona` (o a tutti) tra t0 e t1 (ore simulate in ms). */
  function acqua(t0, t1, zona) {
    let l = 0;
    for (const v of valvole) {
      if (zona && v.zona !== zona) continue;
      const a = Math.max(t0, v.inizio);
      const b = Math.min(t1, v.fine);
      if (b > a) l += (v.litri * (b - a)) / (v.fine - v.inizio);
    }
    return l;
  }

  function reset() {
    delta = {};
    valvole = [];
  }

  /** Corregge una lettura del simulatore generico (restituisce un oggetto nuovo). */
  function applica(r) {
    const t = r.meta?.simTime;
    const zona = r.location?.zone;
    if (typeof t !== 'number') return r;
    if (ultimo !== null && t < ultimo - 2 * H) {
      reset(); // la giornata simulata è ricominciata (loopSec)
      ultimo = t;
    } else ultimo = Math.max(ultimo ?? t, t);
    const campo = CAMPI[zona];
    const serbatoio = zona === SERBATOIO.zona;
    if (!campo && !serbatoio) return r;
    const s = (delta[zona] ||= { d: 0, t });
    const t0 = s.t;
    const t1 = Math.max(t0, Math.min(t, t0 + 2 * H)); // al massimo 2 ore per passo
    s.t = t;
    const readings = { ...r.readings };

    if (campo && typeof readings.soil_moisture_pct === 'number') {
      const p = parametri(campo);
      const ore = (t1 - t0) / H;
      if (ore > 0) {
        const fr = frazioneGiorno(hourOf(t0, tz), hourOf(t1, tz), alba, tramonto);
        s.d -= et0 * fattore('et0') * p.kc * fr * p.k;
        s.d += ((acqua(t0, t1, zona) * efficienza) / campo.area) * p.k; // 1 l/m² = 1 mm
        const theta = readings.soil_moisture_pct + s.d;
        if (theta > SOGLIE_UMIDITA.saturo) s.d -= (theta - SOGLIE_UMIDITA.saturo) * (1 - Math.exp(-ore / drenaggioOre));
      }
      readings.soil_moisture_pct = arrotonda(Math.min(45, Math.max(5, readings.soil_moisture_pct + s.d + rnd.gauss() * 0.05)), 1);
    }
    if (serbatoio && typeof readings.fill_pct === 'number') {
      const cap = SERBATOIO.capacitaM3;
      const ore = (t1 - t0) / H;
      s.d += SERBATOIO.ricaricaM3h * fattore('ricarica') * ore - acqua(t0, t1) / 1000;
      const vol = (readings.fill_pct / 100) * cap + s.d;
      if (vol > cap) s.d -= vol - cap; // vasca piena: il pozzo si ferma
      if (vol < 0) s.d -= vol;
      readings.fill_pct = arrotonda(Math.min(100, Math.max(0, ((readings.fill_pct / 100) * cap + s.d) / cap * 100)), 1);
    }
    return { ...r, readings };
  }

  /** Apre l'acqua di un campo: `{ zone, litri, minuti, inizio }` (inizio = ora simulata, ms). */
  function irriga(a) {
    if (!CAMPI[a?.zone] || !(a.litri > 0) || !(a.minuti > 0)) return false;
    const inizio = typeof a.inizio === 'number' ? a.inizio : ultimo ?? 0;
    // stessa valvola già registrata (es. lo stesso evento arrivato due volte): non raddoppiare
    if (valvole.some((v) => v.zona === a.zone && v.inizio === inizio)) return false;
    valvole.push({ zona: a.zone, litri: a.litri, inizio, fine: inizio + a.minuti * 60_000 });
    return true;
  }

  return { applica, irriga, reset, acqua, get valvole() { return valvole.slice(); } };
}

/**
 * Avvia il simulatore della fattoria collegato a un hub (createHub) o a un nucleo (createCore):
 * letture → `target.ingestReading`, timeline → `target.scenario`; ascolta dal bus gli scenari
 * (effetti sui dati) e le decisioni con `apri_valvola` (turni d'acqua).
 * @returns {{sim, fisica, stop: () => void}}
 */
export function attachFattoria(target, config, opts = {}) {
  let sim = null;
  const fisica = createFisica(config.fisica, { attivi: () => sim?.activeScenarios() ?? [], timezone: config.timezone });
  sim = createSimulator(config, {
    emit: (r) => target.ingestReading(fisica.applica(r)),
    emitScenario: (s) => target.scenario(s.name, s.params, { active: s.active, duration: s.duration }),
    selfTrigger: false,
    log: opts.log,
  });
  const off = target.bus.subscribe(
    (e) => {
      if (e.type === 'scenario') sim.onScenarioEvent(e.data);
      else for (const a of e.data?.actions || []) if (a?.type === 'apri_valvola') fisica.irriga(a);
    },
    { types: ['scenario', 'agent.decision'] },
  );
  sim.start();
  opts.log?.info?.(`simulatore "${sim.config.name}": ${sim.devices.length} dispositivi, velocità ×${sim.config.speed}, bilancio idrico attivo`);
  return {
    sim,
    fisica,
    stop() {
      off();
      sim.stop();
    },
  };
}

const arrotonda = (v, dec) => Math.round(v * 10 ** dec) / 10 ** dec;
