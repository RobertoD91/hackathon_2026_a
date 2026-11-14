// Dati reali per TwinCiro 3D. Riusa il caricamento delle fonti della mappa "Napoli in tempo reale"
// (shared/iot-agents/example/fonti/dati.js: fonti live con cache, timeout e riserve dichiarate,
// snapshot in shared/iot-agents/example/dati/) e aggiunge la previsione meteo ORARIA, che serve
// al modello per le prossime 48 ore.
// Ogni blocco porta con sé `fonte` (nome, licenza, tipo: live | cache | riserva | salvato | snapshot | assente).

import * as F from '../../shared/iot-agents/example/fonti/dati.js';
import * as N from '../../shared/iot-agents/example/fonti/normalizza.js';

const ORA = 3_600_000;
const CENTRO = { lat: 40.8435, lon: 14.242 };

const FONTE_ORARIA = { id: 'meteoOrario', nome: 'Open-Meteo, previsione oraria (modello ICON-2I di ItaliaMeteo-ARPAE)', url: 'https://open-meteo.com/', licenza: 'CC BY 4.0' };
const FONTE_ORARIA_MET = { id: 'meteoOrario', nome: 'MET Norway Locationforecast, previsione oraria', url: 'https://api.met.no/', licenza: 'CC BY 4.0' };

/** Open-Meteo `hourly` → Map(ts dell'ora → { temperatura, pioggia, probabilita, codice, cielo, vento, raffiche }). */
export function orarioDaOpenMeteo(json) {
  const h = json?.hourly;
  const out = new Map();
  if (!h?.time) return out;
  h.time.forEach((t, i) => {
    const ts = N.daIsoLocale(t);
    if (ts == null || h.temperature_2m?.[i] == null) return;
    out.set(ts, {
      temperatura: h.temperature_2m[i],
      pioggia: h.precipitation?.[i] ?? 0,
      probabilita: h.precipitation_probability?.[i] ?? null,
      codice: h.weather_code?.[i] ?? null,
      cielo: N.descriviMeteo(h.weather_code?.[i]),
      vento: h.wind_speed_10m?.[i] ?? null,
      raffiche: h.wind_gusts_10m?.[i] ?? null,
    });
  });
  return out;
}

/** MET Norway compact → la stessa Map (pioggia = precipitazione dell'ora successiva). */
export function orarioDaMetNo(json) {
  const out = new Map();
  for (const s of json?.properties?.timeseries || []) {
    const ts = Date.parse(s.time);
    const d = s.data?.instant?.details;
    if (!Number.isFinite(ts) || d?.air_temperature == null) continue;
    const prossima = s.data.next_1_hours || s.data.next_6_hours;
    const mm = prossima?.details?.precipitation_amount ?? 0;
    out.set(Math.floor(ts / ORA) * ORA, {
      temperatura: d.air_temperature,
      pioggia: s.data.next_1_hours ? mm : mm / 6,
      probabilita: null,
      codice: null,
      cielo: mm >= 0.3 ? 'Pioggia' : (d.cloud_area_fraction ?? 0) > 70 ? 'Coperto' : (d.cloud_area_fraction ?? 0) > 30 ? 'Parzialmente nuvoloso' : 'Sereno',
      vento: d.wind_speed != null ? Math.round(d.wind_speed * 36) / 10 : null,
      raffiche: null,
    });
  }
  return out;
}

/** Previsione oraria per Napoli (da ieri a dopodomani): Open-Meteo ICON-2I → modello predefinito → MET Norway → niente. */
export async function meteoOrario() {
  const q = `latitude=${CENTRO.lat}&longitude=${CENTRO.lon}&hourly=temperature_2m,precipitation,precipitation_probability,weather_code,wind_speed_10m,wind_gusts_10m&past_days=1&forecast_days=3&timezone=Europe%2FRome`;
  const errori = [];
  for (const [chiave, modello, nota] of [
    ['icon2i', '&models=italia_meteo_arpae_icon_2i', 'griglia di 2,2 km'],
    ['base', '', 'modello predefinito'],
  ]) {
    try {
      const r = await F.conCache(`twin3d:orario:${chiave}`, 30 * 60_000, async () => [...orarioDaOpenMeteo(await F.richiestaJson(`https://api.open-meteo.com/v1/forecast?${q}${modello}`))]);
      if (r.valore.length >= 24) return { dati: new Map(r.valore), fonte: { ...FONTE_ORARIA, tipo: r.daCache ? 'cache' : 'live', ts: r.letto, letto: r.letto, nota } };
      errori.push('risposta incompleta');
    } catch (err) {
      errori.push(err.message);
      if (/429/.test(err.message)) break;
    }
  }
  try {
    const r = await F.conCache('twin3d:orario:metno', 30 * 60_000, async () => [...orarioDaMetNo(await F.richiestaJson(`https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${CENTRO.lat}&lon=${CENTRO.lon}`))]);
    if (r.valore.length >= 12) return { dati: new Map(r.valore), fonte: { ...FONTE_ORARIA_MET, tipo: 'riserva', ts: r.letto, letto: r.letto, nota: `Open-Meteo non disponibile (${errori.join('; ')})` } };
  } catch (err) {
    errori.push(err.message);
  }
  return { dati: new Map(), fonte: { ...FONTE_ORARIA, tipo: 'assente', nota: `nessuna previsione oraria: il modello non applica l'effetto del meteo (${errori.join('; ')})` } };
}

/**
 * Carica tutto ciò che serve all'avvio. Niente lancia: ogni fonte che manca è dichiarata in `fonti`.
 * @returns {Promise<{eventi, riferimenti, trasporti, meteo, orario, aria, centraline, allerta, fonti: object[], meteoA: (ts:number)=>object|null}>}
 */
export async function caricaTutto() {
  const [eventi, riferimenti, trasporti, meteo, orario, aria, centraline, allerta] = await Promise.all([
    F.eventi(), F.riferimenti(), F.trasporti(), F.meteo(), meteoOrario(), F.ariaModello(), F.centraline(), F.allerta(),
  ]);
  const mappaOraria = orario.dati;
  const meteoA = (ts) => mappaOraria.get(Math.floor(ts / ORA) * ORA) ?? null;
  return {
    eventi: eventi.dati,
    riferimenti: riferimenti.dati,
    trasporti: trasporti.dati,
    meteo: meteo.dati,
    orario: mappaOraria,
    aria: aria.dati,
    centraline: centraline.dati,
    allerta: allerta.dati,
    meteoA,
    fonti: [eventi.fonte, riferimenti.fonte, trasporti.fonte, meteo.fonte, orario.fonte, aria.fonte, centraline.fonte, allerta.fonte],
  };
}

export { F as fonti, N as norm };
