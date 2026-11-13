// Modelli fisici semplici e dichiarati: luce → kW, sole "a cielo sereno", consumi delle case.
// Modulo isomorfo, senza dipendenze (solo hourOf del simulatore per il fuso orario).

import { P } from './parametri.js';
import { PROFILI, CARICHI } from './quartiere.js';
import { hourOf } from '../../shared/iot-agents/sim/sim-core.js';

// ------------------------------------------------------------------ griglia della giornata

/** La giornata della CER va dalle 6 alle 24, a passi di 15 minuti (72 intervalli). */
export const GIORNO = Object.freeze({ inizio: 6, fine: 24, passo: 0.25 });
export const N_SLOT = Math.round((GIORNO.fine - GIORNO.inizio) / GIORNO.passo);

/** Indice dell'intervallo che contiene l'ora `h` (decimale), limitato a [0, N_SLOT-1]. */
export function slotDi(h) {
  const s = Math.floor((h - GIORNO.inizio) / GIORNO.passo + 1e-9);
  return Math.max(0, Math.min(N_SLOT - 1, s));
}
/** Ora di inizio dell'intervallo `s`. */
export const oraDiSlot = (s) => GIORNO.inizio + s * GIORNO.passo;
/** Primo intervallo che inizia a `h` o dopo (per pianificare il futuro). */
export function slotDa(h) {
  const s = Math.ceil((h - GIORNO.inizio) / GIORNO.passo - 1e-9);
  return Math.max(0, Math.min(N_SLOT, s));
}
export const vuoto = () => new Array(N_SLOT).fill(0);

/** "13:30" da un'ora decimale. */
export function hhmm(h) {
  const m = Math.round(h * 60);
  const hh = Math.floor(m / 60) % 24;
  return `${String(hh).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

// ------------------------------------------------------------------ fotovoltaico

/**
 * Luce misurata dall'ESP32 sul tetto → potenza prodotta (kW).
 * kW = kWp × (G / 1000 W/m²) × PR, con G = lux / luxPerWm2.
 */
export function luxToKw(lux, kWp, { luxPerWm2 = P('luxPerWm2'), pr = P('performanceRatio') } = {}) {
  if (typeof lux !== 'number' || !(lux > 0)) return 0;
  return (kWp * (lux / luxPerWm2) * pr) / 1000;
}

/**
 * Alba, tramonto e irraggiamento a mezzogiorno su un pannello esposto a sud, inclinato di `tilt`,
 * con cielo sereno. Formule astronomiche semplificate (declinazione di Cooper, equazione del tempo,
 * massa d'aria di Meinel): errore di qualche minuto e di qualche punto percentuale, sufficiente per
 * una previsione "di forma".
 * @returns {{alba: number, tramonto: number, mezzogiorno: number, gMezzogiorno: number}}
 */
export function giornataSolare(ts, { lat = 40.844, lon = 14.296, tilt = 30, timezone = 'Europe/Rome' } = {}) {
  const d = new Date(ts);
  const inizioAnno = Date.UTC(d.getUTCFullYear(), 0, 0);
  const n = Math.floor((ts - inizioAnno) / 86_400_000);
  const rad = Math.PI / 180;
  const decl = 23.44 * Math.sin((2 * Math.PI * (284 + n)) / 365);
  const B = (2 * Math.PI * (n - 81)) / 364;
  const eot = 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B); // minuti
  const utcH = d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600;
  let offset = hourOf(ts, timezone) - utcH;
  if (offset > 12) offset -= 24;
  if (offset < -12) offset += 24;
  const mezzogiorno = 12 - lon / 15 + Math.round(offset) - eot / 60;
  const x = Math.max(-1, Math.min(1, -Math.tan(lat * rad) * Math.tan(decl * rad)));
  const semi = Math.acos(x) / rad / 15;
  const elev = 90 - lat + decl;
  const am = 1 / Math.sin(Math.max(5, elev) * rad);
  const dni = 1353 * Math.pow(0.7, Math.pow(am, 0.678));
  const incid = Math.abs(lat - decl - tilt);
  const g = dni * Math.cos(incid * rad) + 0.1 * dni;
  return { alba: mezzogiorno - semi, tramonto: mezzogiorno + semi, mezzogiorno, gMezzogiorno: Math.round(g) };
}

/** Irraggiamento a cielo sereno (W/m²) all'ora `h`: campana tra alba e tramonto. */
export function irraggiamentoSereno(h, sole) {
  if (h <= sole.alba || h >= sole.tramonto) return 0;
  return sole.gMezzogiorno * Math.sin((Math.PI * (h - sole.alba)) / (sole.tramonto - sole.alba));
}

/** kW prodotti a cielo sereno da `kWp` all'ora `h`. */
export const kwSereno = (h, sole, kWp) => (kWp * irraggiamentoSereno(h, sole) * P('performanceRatio')) / 1000;

/**
 * Riduzione dell'irraggiamento con la copertura nuvolosa (Kasten e Czeplak, 1980):
 * G / G_sereno = 1 − 0,75 · (N/8)^3,4, con N in ottavi (qui in percentuale).
 */
export const fattoreNuvole = (coperturaPct) => 1 - 0.75 * Math.pow(Math.max(0, Math.min(100, coperturaPct)) / 100, 3.4);

// ------------------------------------------------------------------ consumi delle case

const scalaPersone = (f) => 0.8 + 0.1 * (f.persone || 2);

/** Consumo non spostabile della famiglia all'ora `h` (kW). */
export function consumoBaseKw(f, h) {
  const prof = PROFILI[f.profilo] || PROFILI.famiglia;
  return prof.kw[Math.max(0, Math.min(23, Math.floor(h)))] * scalaPersone(f);
}

export function inCasa(f, h) {
  const prof = PROFILI[f.profilo] || PROFILI.famiglia;
  return prof.presenza.some(([a, b]) => h >= a && h < b);
}

/**
 * Riscaldamento (pompa di calore) o raffrescamento (split) all'ora `h` con temperatura esterna `t`.
 * È qui che serve il sensore di temperatura: la domanda cambia con il meteo vero.
 */
export function climaKw(f, h, t) {
  if (typeof t !== 'number' || !inCasa(f, h)) return 0;
  let kw = 0;
  if (f.riscaldamento === 'pdc') kw += P('coefficienteRiscaldamento') * Math.max(0, 19 - t);
  if (f.clima === 'split') kw += P('coefficienteRaffrescamento') * Math.max(0, t - 26);
  return kw;
}

// ------------------------------------------------------------------ carichi spostabili

/** Richiesta completa di un carico di una famiglia (catalogo + abitudini + preferenze). */
export function richiesta(f, c, extra = {}) {
  const cat = CARICHI[c.tipo];
  if (!cat) throw new Error(`carico sconosciuto: ${c.tipo}`);
  const kwh = c.kwh ?? cat.kwh;
  const potenzaKw = cat.divisibile ? (c.potenzaKw ?? cat.potenzaKw) : kwh / (c.durataH ?? cat.durataH);
  const durataH = cat.divisibile ? kwh / potenzaKw : (c.durataH ?? cat.durataH);
  return {
    id: `${f.id}:${c.id || c.tipo}`,
    famiglia: f.id,
    tipo: c.tipo,
    nome: c.nome || cat.nome,
    kwh,
    potenzaKw,
    durataH,
    divisibile: !!cat.divisibile,
    automatico: !!c.automatico,
    abitudine: c.abitudine,
    finestra: c.finestra || [GIORNO.inizio, GIORNO.fine],
    ...extra,
  };
}

/** Profilo (kW per intervallo) di un carico a blocco che parte a `inizio`. */
export function profiloBlocco(inizio, durataH, potenzaKw) {
  const p = vuoto();
  const fine = inizio + durataH;
  for (let s = 0; s < N_SLOT; s++) {
    const a = oraDiSlot(s);
    const b = a + GIORNO.passo;
    const sovrapp = Math.max(0, Math.min(b, fine) - Math.max(a, inizio));
    if (sovrapp > 0) p[s] = (potenzaKw * sovrapp) / GIORNO.passo;
  }
  return p;
}

/** Profilo "di abitudine": parte all'ora solita (o a `da`, se più tardi) e va a piena potenza. */
export function profiloAbitudine(r, { da = -Infinity } = {}) {
  const inizio = Math.max(r.abitudine, da);
  return profiloBlocco(inizio, r.durataH, r.potenzaKw);
}

/** Energia (kWh) di un profilo, eventualmente solo tra gli intervalli [da, a). */
export function energia(profilo, da = 0, a = N_SLOT) {
  let e = 0;
  for (let s = Math.max(0, da); s < Math.min(N_SLOT, a); s++) e += profilo[s] * GIORNO.passo;
  return e;
}

/** Primo e ultimo istante in cui il profilo consuma: { inizio, fine } in ore, o null. */
export function estremi(profilo) {
  let a = -1;
  let b = -1;
  for (let s = 0; s < N_SLOT; s++) {
    if (profilo[s] > 1e-6) {
      if (a < 0) a = s;
      b = s;
    }
  }
  return a < 0 ? null : { inizio: oraDiSlot(a), fine: oraDiSlot(b) + GIORNO.passo };
}

/** Fasce continue di un profilo: [[da, a], ...] in ore. */
export function fasce(profilo) {
  const out = [];
  let a = null;
  for (let s = 0; s <= N_SLOT; s++) {
    const on = s < N_SLOT && profilo[s] > 1e-6;
    if (on && a === null) a = s;
    if (!on && a !== null) {
      out.push([oraDiSlot(a), oraDiSlot(s)]);
      a = null;
    }
  }
  return out;
}
