// Luoghi della mappa "Napoli in tempo reale" (stile Seoul Real-Time City Data).
// Una voce per zona: la chiave è la `location.zone` dei sensori. La capienza è la soglia
// "affollato" (persone stimate nell'area): valori indicativi scelti per la demo, non misurati.
// Modulo isomorfo: lo usano la dashboard (mappa) e l'agente folla, in Node e nel browser.

export const CATEGORIE = Object.freeze({
  piazze: 'Piazze e centro',
  mare: 'Lungomare e porto',
  attrazioni: 'Attrazioni',
  trasporti: 'Stazioni',
  quartieri: 'Quartieri',
  eventi: 'Eventi e sport',
});

/** @type {Record<string, {nome: string, categoria: keyof typeof CATEGORIE, capienza: number, lat: number, lon: number}>} */
export const LUOGHI = Object.freeze({
  plebiscito: { nome: 'Piazza del Plebiscito', categoria: 'piazze', capienza: 3000, lat: 40.8359, lon: 14.2488 },
  centro_storico: { nome: 'Spaccanapoli · Centro storico', categoria: 'piazze', capienza: 4500, lat: 40.8484, lon: 14.2558 },
  lungomare: { nome: 'Lungomare Caracciolo', categoria: 'mare', capienza: 5000, lat: 40.8329, lon: 14.2349 },
  mergellina: { nome: 'Mergellina', categoria: 'mare', capienza: 2500, lat: 40.8288, lon: 14.2183 },
  beverello: { nome: 'Molo Beverello · Stazione Marittima', categoria: 'mare', capienza: 3500, lat: 40.8383, lon: 14.2537 },
  castel_ovo: { nome: "Castel dell'Ovo", categoria: 'attrazioni', capienza: 1500, lat: 40.828, lon: 14.2476 },
  garibaldi: { nome: 'Napoli Centrale · Garibaldi', categoria: 'trasporti', capienza: 6000, lat: 40.853, lon: 14.2725 },
  vomero: { nome: 'Vomero · Piazza Vanvitelli', categoria: 'quartieri', capienza: 3000, lat: 40.844, lon: 14.229 },
  sanita: { nome: 'Rione Sanità', categoria: 'quartieri', capienza: 2000, lat: 40.8606, lon: 14.2497 },
  maradona: { nome: 'Stadio Diego Armando Maradona', categoria: 'eventi', capienza: 12000, lat: 40.828, lon: 14.193 },
});

/** Livelli di affollamento, come i 4 livelli di Seoul (여유 · 보통 · 약간 붐빔 · 붐빔). */
export const LIVELLI_FOLLA = Object.freeze([
  { id: 'tranquillo', label: 'Tranquillo', max: 0.35 },
  { id: 'normale', label: 'Normale', max: 0.6 },
  { id: 'vivace', label: 'Un po’ affollato', max: 0.85 },
  { id: 'affollato', label: 'Affollato', max: Infinity },
]);

/** Livelli di temperatura per la vista "caldo". */
export const LIVELLI_CALDO = Object.freeze([
  { id: 'tranquillo', label: 'Fresco', max: 18 },
  { id: 'normale', label: 'Gradevole', max: 26 },
  { id: 'vivace', label: 'Caldo', max: 32 },
  { id: 'affollato', label: 'Molto caldo', max: Infinity },
]);

/** Livello di affollamento dato il numero di persone e la capienza del luogo. */
export function livelloFolla(persone, capienza) {
  const r = capienza > 0 ? persone / capienza : 0;
  return LIVELLI_FOLLA.find((l) => r < l.max) ?? LIVELLI_FOLLA[LIVELLI_FOLLA.length - 1];
}

/** Livello di caldo data la temperatura (°C). */
export function livelloCaldo(temperatura) {
  return LIVELLI_CALDO.find((l) => temperatura < l.max) ?? LIVELLI_CALDO[LIVELLI_CALDO.length - 1];
}

/** Distanza approssimata in km (equirettangolare: va bene su scala cittadina). */
export function distanzaKm(a, b) {
  const rad = Math.PI / 180;
  const x = (b.lon - a.lon) * rad * Math.cos(((a.lat + b.lat) / 2) * rad);
  const y = (b.lat - a.lat) * rad;
  return Math.sqrt(x * x + y * y) * 6371;
}
