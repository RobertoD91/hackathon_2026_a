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
 * `obiettivo` (% vol) a cui riportare il suolo per la sera dopo.
 */
export const COLTURE = {
  pomodoro: { nome: 'Pomodoro San Marzano DOP', breve: 'pomodoro San Marzano', categoria: 'pomodoro', zr: 0.3, fw: 0.4, soglia: 24, obiettivo: 28 },
  peperone: { nome: 'Peperone (papaccella napoletana)', breve: 'papaccella', categoria: 'ortaggi', zr: 0.3, fw: 0.4, soglia: 24, obiettivo: 28 },
  zucchina: { nome: 'Zucchina', breve: 'zucchine', categoria: 'ortaggi', zr: 0.3, fw: 0.4, soglia: 23, obiettivo: 27 },
  fagiolino: { nome: 'Fagiolino', breve: 'fagiolini', categoria: 'ortaggi', zr: 0.3, fw: 0.4, soglia: 24, obiettivo: 28 },
  albicocco: { nome: 'Albicocco (albicocca vesuviana)', breve: 'albicocchi', categoria: 'frutteto', zr: 0.5, fw: 0.5, soglia: 22, obiettivo: 26 },
  vite: { nome: 'Vite (Piedirosso)', breve: 'vigneto', categoria: 'vigneto', zr: 0.5, fw: 0.35, soglia: 19, obiettivo: 23 },
  olivo: { nome: 'Olivo', breve: 'uliveto', categoria: 'uliveto', zr: 0.5, fw: 0.4, soglia: 18, obiettivo: 22 },
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

/** Appezzamenti: la chiave è la `location.zone` del sensore del campo. */
export const CAMPI = Object.freeze({
  campo_01: c(1, 'olivo', 'indurimento del nocciolo', 0.7, 0.3, 'Gennaro', {
    lat: 40.765992, lon: 14.596345, area: 15640,
    poligono: [[40.766313, 14.597472], [40.766329, 14.598674], [40.765012, 14.598674], [40.764849, 14.597472]].map(() => null),
  }),
});
