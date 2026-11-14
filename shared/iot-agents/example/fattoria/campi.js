// Scenario "Acqua comune": una piccola comunità irrigua dell'Agro Nocerino-Sarnese, tra
// Via Filettine e Via Migliaro a San Marzano sul Sarno (SA), terra del pomodoro San Marzano
// DOP. Dati inventati ma plausibili: 10 appezzamenti, una vasca consortile alimentata da un
// pozzo, una stazione meteo. Comunità, agricoltori e consorzio sono FITTIZI.
//
// Geometrie: poligoni disegnati a mano guardando la mappa OpenStreetMap della zona (strade
// interpoderali, Canale Mannara); non sono particelle catastali reali. Superfici calcolate
// dai poligoni.
//
// Modulo isomorfo: lo usano la mappa (scenario.js), gli agenti e il simulatore, in Node e nel browser.

/** Fonti dei parametri agronomici. */
export const FONTI = {
  fao56:
    'Allen R.G., Pereira L.S., Raes D., Smith M. (1998). Crop evapotranspiration. FAO Irrigation and Drainage Paper 56: ' +
    'tab. 12 (Kc), tab. 20 (fw, frazione di suolo bagnata), tab. 22 (p).',
  fao33: 'Doorenbos J., Kassam A.H. (1979). Yield response to water. FAO Irrigation and Drainage Paper 33 (fattore Ky).',
  openMeteo: 'Open-Meteo.com, Forecast API (CC BY 4.0): et0_fao_evapotranspiration, precipitation_sum.',
};

/**
 * Colture. `kc`: coefficiente colturale FAO-56 (tab. 12) della fase indicata nel campo.
 * `fw`: frazione di suolo bagnata (FAO-56 tab. 20: goccia 0,3-0,4; micro-irrigazione 0,5).
 * Indicativi (scelti per la demo, NON da FAO): `zr` = spessore di suolo rappresentato dalla
 * sonda di umidità (m, più basso della profondità massima delle radici perché la sonda
 * capacitiva misura lo strato vicino al gocciolatore); `sensibilita` 0-1 allo stress idrico
 * nella fase (ispirata al Ky di FAO-33); `soglia` (% vol) sotto cui serve un turno;
 * `obiettivo` (% vol) che il suolo deve avere ancora la sera dopo (soglia + 2: irrigazione in leggero deficit).
 */
export const COLTURE = {
  pomodoro: { nome: 'Pomodoro San Marzano DOP', breve: 'pomodoro San Marzano', categoria: 'pomodoro', zr: 0.3, fw: 0.4, soglia: 24, obiettivo: 26 },
  peperone: { nome: 'Peperone (papaccella napoletana)', breve: 'papaccella', categoria: 'ortaggi', zr: 0.3, fw: 0.4, soglia: 24, obiettivo: 26 },
  zucchina: { nome: 'Zucchina', breve: 'zucchine', categoria: 'ortaggi', zr: 0.3, fw: 0.4, soglia: 23, obiettivo: 25 },
  fagiolino: { nome: 'Fagiolino', breve: 'fagiolini', categoria: 'ortaggi', zr: 0.3, fw: 0.4, soglia: 24, obiettivo: 26 },
  albicocco: { nome: 'Albicocco (albicocca vesuviana)', breve: 'albicocchi', categoria: 'frutteto', zr: 0.5, fw: 0.5, soglia: 22, obiettivo: 24 },
  vite: { nome: 'Vite (Piedirosso)', breve: 'vigneto', categoria: 'vigneto', zr: 0.5, fw: 0.35, soglia: 19, obiettivo: 21 },
  olivo: { nome: 'Olivo', breve: 'uliveto', categoria: 'uliveto', zr: 0.5, fw: 0.4, soglia: 18, obiettivo: 20 },
};

export const CATEGORIE = Object.freeze({
  pomodoro: 'Pomodoro San Marzano',
  ortaggi: 'Ortaggi',
  frutteto: 'Frutteto',
  vigneto: 'Vigneto',
  uliveto: 'Uliveto',
  servizi: 'Acqua e meteo',
});

// Kc FAO-56 tab. 12: pomodoro 0,60 / 1,15 / 0,70-0,90; peperone 0,60 / 1,05 / 0,90; zucchina 0,50 / 1,00 / 0,80;
// fagiolino 0,50 / 1,05 / 0,90; albicocco e drupacee (senza inerbimento) 0,45 / 0,90 / 0,65;
// vite da vino 0,30 / 0,70 / 0,45; olivo (copertura 40-60%) 0,65 / 0,70 / 0,70.
const c = (n, coltura, fase, kc, sensibilita, agricoltore, geo, extra = {}) => ({
  n,
  nome: `Campo ${n}`,
  coltura,
  fase,
  kc,
  sensibilita,
  agricoltore,
  contatto: `agricoltore-${agricoltore.toLowerCase()}`,
  ...geo,
  ...extra,
});

/** Appezzamenti: la chiave è la `location.zone` del sensore del campo. `rete`: tracciato
 *  schematico della condotta dalla vasca al campo (per il livello sovrapposto della mappa). */
export const CAMPI = Object.freeze({
  campo_01: c(1, 'olivo', 'indurimento del nocciolo', 0.7, 0.3, 'Gennaro', {
    lat: 40.765992, lon: 14.596345, area: 15640,
    poligono: [[40.766679, 14.595745], [40.766695, 14.596946], [40.765378, 14.596946], [40.765215, 14.595745]],
    rete: [[40.767248, 14.601646], [40.766809, 14.601646], [40.766809, 14.596345], [40.766663, 14.596345]],
  }),
  campo_02: c(2, 'vite', 'pre-invaiatura', 0.7, 0.4, 'Rosa', {
    lat: 40.766019, lon: 14.598054, area: 19340,
    poligono: [[40.766695, 14.597054], [40.766728, 14.598341], [40.76576, 14.59891], [40.765533, 14.59891], [40.765378, 14.597054]],
    rete: [[40.767248, 14.601646], [40.766809, 14.601646], [40.766809, 14.598054], [40.766663, 14.598054]],
  }),
  campo_03: c(3, 'pomodoro', 'fioritura', 1.15, 1, 'Aniello', {
    lat: 40.766232, lon: 14.600568, area: 11980,
    poligono: [[40.766776, 14.600144], [40.76676, 14.601163], [40.765695, 14.601163], [40.765695, 14.5998]],
    rete: [[40.767248, 14.601646], [40.766809, 14.601646], [40.766809, 14.600568], [40.766663, 14.600568]],
  }),
  campo_04: c(4, 'pomodoro', 'allegagione', 1.15, 1, 'Carmela', {
    lat: 40.766224, lon: 14.601753, area: 10200,
    poligono: [[40.76676, 14.601238], [40.766744, 14.602268], [40.765695, 14.602268], [40.765695, 14.601238]],
    rete: [[40.767248, 14.601646], [40.766809, 14.601646], [40.766809, 14.601753], [40.766663, 14.601753]],
  }),
  campo_05: c(5, 'pomodoro', 'ingrossamento delle bacche', 1.15, 0.8, 'Salvatore', {
    lat: 40.766215, lon: 14.602864, area: 10150,
    poligono: [[40.766744, 14.602343], [40.766728, 14.603384], [40.765695, 14.603384], [40.765695, 14.602343]],
    rete: [[40.767248, 14.601646], [40.766809, 14.601646], [40.766809, 14.602864], [40.766663, 14.602864]],
  }),
  campo_06: c(6, 'peperone', 'fioritura', 1.05, 0.9, 'Teresa', {
    lat: 40.766207, lon: 14.603974, area: 9880,
    poligono: [[40.766728, 14.603459], [40.766711, 14.604489], [40.765695, 14.604489], [40.765695, 14.603459]],
    rete: [[40.767248, 14.601646], [40.766809, 14.601646], [40.766809, 14.603974], [40.766663, 14.603974]],
  }),
  campo_07: c(7, 'zucchina', 'raccolta', 1.0, 0.7, 'Vincenzo', {
    lat: 40.766199, lon: 14.605079, area: 9720,
    poligono: [[40.766711, 14.604564], [40.766695, 14.605594], [40.765695, 14.605594], [40.765695, 14.604564]],
    rete: [[40.767248, 14.601646], [40.766809, 14.601646], [40.766809, 14.605079], [40.766663, 14.605079]],
  }),
  campo_08: c(8, 'pomodoro', 'maturazione', 0.8, 0.4, 'Anna', {
    lat: 40.765018, lon: 14.601142, area: 15110,
    poligono: [[40.765557, 14.599929], [40.765557, 14.601882], [40.764516, 14.601882], [40.764443, 14.600873]],
    rete: [[40.767248, 14.601646], [40.766809, 14.601646], [40.766809, 14.601206], [40.76563, 14.601206], [40.76563, 14.601142], [40.7655, 14.601142]],
  }, { soglia: 21, obiettivo: 23, nota: 'in maturazione un leggero deficit idrico aumenta zuccheri e sapore' }),
  campo_09: c(9, 'albicocco', 'post-raccolta', 0.9, 0.5, 'Ciro', {
    lat: 40.765028, lon: 14.602477, area: 10300,
    poligono: [[40.765557, 14.601957], [40.765557, 14.602998], [40.764476, 14.602998], [40.764524, 14.601957]],
    rete: [[40.767248, 14.601646], [40.766809, 14.601646], [40.766809, 14.601206], [40.76563, 14.601206], [40.76563, 14.602477], [40.7655, 14.602477]],
  }),
  campo_10: c(10, 'fagiolino', 'fioritura', 1.05, 0.9, 'Lucia', {
    lat: 40.764984, lon: 14.603915, area: 18090,
    poligono: [[40.765557, 14.603073], [40.765557, 14.604758], [40.764354, 14.604758], [40.764467, 14.603073]],
    rete: [[40.767248, 14.601646], [40.766809, 14.601646], [40.766809, 14.601206], [40.76563, 14.601206], [40.76563, 14.603915], [40.7655, 14.603915]],
  }),
});

/** Vasca consortile alimentata dal pozzo, e modulo d'acqua dei turni (valori indicativi). */
export const SERBATOIO = Object.freeze({
  zona: 'serbatoio',
  nome: 'Vasca consortile · pozzo',
  lat: 40.767248,
  lon: 14.601646,
  capacitaM3: 1500,
  riservaPct: 15, // non si scende sotto: riserva per emergenze e antincendio
  ricaricaM3h: 30, // portata del pozzo che riempie la vasca
  moduloLs: 35, // portata consegnata a un campo durante il suo turno (l/s), un campo alla volta
  dotazioneM3: 900, // acqua concessa dal consorzio per notte
});

/** Stazione meteo della comunità (temperatura, umidità dell'aria, luce). */
export const STAZIONE = Object.freeze({
  zona: 'stazione_meteo',
  nome: 'Stazione meteo',
  lat: 40.7645,
  lon: 14.605026,
});

/** Punto per la previsione meteo (centro degli appezzamenti). */
export const COORDINATE = Object.freeze({ lat: 40.7657, lon: 14.6005, luogo: 'San Marzano sul Sarno (SA)' });

/** Livelli di umidità del suolo (% volumetrica; soglie indicative per un suolo franco di origine vulcanica). */
export const SOGLIE_UMIDITA = Object.freeze({ stress: 18, asciutto: 24, saturo: 34 });
export const LIVELLI_UMIDITA = Object.freeze([
  { id: 'stress', label: 'Stress idrico' },
  { id: 'asciutto', label: 'Asciutto' },
  { id: 'ottimale', label: 'Ottimale' },
  { id: 'saturo', label: 'Saturo' },
]);

export function livelloUmidita(theta) {
  if (theta < SOGLIE_UMIDITA.stress) return LIVELLI_UMIDITA[0];
  if (theta < SOGLIE_UMIDITA.asciutto) return LIVELLI_UMIDITA[1];
  if (theta < SOGLIE_UMIDITA.saturo) return LIVELLI_UMIDITA[2];
  return LIVELLI_UMIDITA[3];
}

/** Livelli di temperatura dell'aria sul campo (°C; sopra i 34-35 °C il pomodoro perde fiori, indicativo). */
export const LIVELLI_TEMPERATURA = Object.freeze([
  { id: 'fresco', label: 'Fresco', max: 18 },
  { id: 'mite', label: 'Mite', max: 28 },
  { id: 'caldo', label: 'Caldo', max: 34 },
  { id: 'torrido', label: 'Torrido', max: Infinity },
]);

export function livelloTemperatura(t) {
  return LIVELLI_TEMPERATURA.find((l) => t < l.max) ?? LIVELLI_TEMPERATURA[LIVELLI_TEMPERATURA.length - 1];
}

/**
 * Parametri agronomici del campo (coltura + eventuali eccezioni del campo) e `k`, i punti di
 * umidità (% vol) che la sonda guadagna per 1 mm d'acqua nel suolo: k = 0,1 / (zr × fw).
 */
export function parametri(campo) {
  const col = COLTURE[campo.coltura];
  const p = { ...col, kc: campo.kc, sensibilita: campo.sensibilita, soglia: campo.soglia ?? col.soglia, obiettivo: campo.obiettivo ?? col.obiettivo };
  p.k = 0.1 / (p.zr * p.fw);
  return p;
}

/** Il campo dal numero (3), dalla zona ("campo_03") o null. */
export function trovaCampo(chiave) {
  if (CAMPI[chiave]) return [chiave, CAMPI[chiave]];
  const n = Number(chiave);
  return Object.entries(CAMPI).find(([, cc]) => cc.n === n) ?? null;
}
