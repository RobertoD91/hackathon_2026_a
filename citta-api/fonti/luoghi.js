// Luoghi della mappa "Napoli in tempo reale" (stile Seoul Real-Time City Data).
// Una voce per zona: la chiave è la `location.zone` dei sensori. La capienza è la soglia
// "affollato" (persone stimate nell'area): valori indicativi scelti per la demo, non misurati.
// Modulo isomorfo: lo usano l'API dati città, la mappa della presentazione e il suo agente folla,
// in Node e nel browser.

export const CATEGORIE = Object.freeze({
  piazze: 'Piazze e centro',
  mare: 'Lungomare e porto',
  attrazioni: 'Attrazioni',
  trasporti: 'Stazioni',
  quartieri: 'Quartieri',
  eventi: 'Eventi e sport',
});

/**
 * `parole`: nomi di vie, piazze e monumenti della zona (ricerca nella mappa e abbinamento degli
 * eventi reali del Comune al luogo, vedi fonti/normalizza.js → zonaPerTesto).
 * @type {Record<string, {nome: string, categoria: keyof typeof CATEGORIE, capienza: number, lat: number, lon: number, parole: string[]}>}
 */
export const LUOGHI = Object.freeze({
  plebiscito: {
    nome: 'Piazza del Plebiscito', categoria: 'piazze', capienza: 3000, lat: 40.8359, lon: 14.2488,
    parole: ['Plebiscito', 'Palazzo Reale', 'Teatro San Carlo', 'Galleria Umberto', 'Piazza Trieste e Trento', 'Via Toledo', 'Via Chiaia'],
  },
  centro_storico: {
    nome: 'Spaccanapoli · Centro storico', categoria: 'piazze', capienza: 4500, lat: 40.8484, lon: 14.2558,
    parole: ['Spaccanapoli', 'Via dei Tribunali', 'San Gregorio Armeno', 'Piazza del Gesù', 'Piazza Dante', 'San Domenico Maggiore', 'Piazza Bellini', 'Duomo', 'San Severo al Pendino', 'Decumani', 'Museo Archeologico', 'MANN'],
  },
  lungomare: {
    nome: 'Lungomare Caracciolo', categoria: 'mare', capienza: 5000, lat: 40.8329, lon: 14.2349,
    parole: ['Caracciolo', 'Rotonda Diaz', 'Villa Comunale', 'Casina Pompeiana', 'Lungomare', 'Riviera di Chiaia'],
  },
  mergellina: {
    nome: 'Mergellina', categoria: 'mare', capienza: 2500, lat: 40.8288, lon: 14.2183,
    parole: ['Mergellina', 'Piazza Sannazaro', 'Molo Mergellina', 'Posillipo', 'Pausilypon'],
  },
  beverello: {
    nome: 'Molo Beverello · Stazione Marittima', categoria: 'mare', capienza: 3500, lat: 40.8383, lon: 14.2537,
    parole: ['Beverello', 'Stazione Marittima', 'Molo Angioino', 'Piazza Municipio', 'Maschio Angioino', 'Castel Nuovo', 'Molosiglio', 'Porto di Napoli', 'crociere', 'aliscafi'],
  },
  castel_ovo: {
    nome: "Castel dell'Ovo", categoria: 'attrazioni', capienza: 1500, lat: 40.828, lon: 14.2476,
    parole: ["Castel dell'Ovo", 'Borgo Marinari', 'Via Partenope', 'Santa Lucia', 'Nazario Sauro'],
  },
  garibaldi: {
    nome: 'Napoli Centrale · Garibaldi', categoria: 'trasporti', capienza: 6000, lat: 40.853, lon: 14.2725,
    parole: ['Garibaldi', 'Napoli Centrale', 'Stazione Centrale', 'Corso Umberto', 'Porta Nolana', 'Circumvesuviana'],
  },
  vomero: {
    nome: 'Vomero · Piazza Vanvitelli', categoria: 'quartieri', capienza: 3000, lat: 40.844, lon: 14.229,
    parole: ['Vomero', 'Vanvitelli', 'Via Scarlatti', "Castel Sant'Elmo", 'San Martino', 'Floridiana', 'Arenella', 'funicolare'],
  },
  sanita: {
    nome: 'Rione Sanità', categoria: 'quartieri', capienza: 2000, lat: 40.8606, lon: 14.2497,
    parole: ['Sanità', 'Rione Sanità', 'Catacombe', 'Capodimonte', 'Materdei', 'Vergini'],
  },
  maradona: {
    nome: 'Stadio Diego Armando Maradona', categoria: 'eventi', capienza: 12000, lat: 40.828, lon: 14.193,
    parole: ['Maradona', 'stadio', 'Fuorigrotta', 'San Paolo', "Mostra d'Oltremare", 'Piazzale Tecchio', 'SSC Napoli', 'partita'],
  },
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
