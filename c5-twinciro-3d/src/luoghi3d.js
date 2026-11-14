// Luoghi del gemello 3D: i 10 della mappa "Napoli in tempo reale" (shared/iot-agents/example/luoghi.js)
// più 16 luoghi che completano la città (musei, quartieri, aeroporto, Bagnoli...).
//
// Coordinate dei luoghi nuovi: OpenStreetMap (Nominatim, 14/11/2026). Le capienze sono la soglia
// "affollato" (persone stimate nell'area) e sono valori INDICATIVI scelti per la demo, non misurati.
//
// Per ogni luogo il modello (modello.js) usa:
// - profilo:  la curva della giornata tipo (vedi PROFILI in modello.js);
// - turisti:  quota di visitatori (0..1): pesa la stagionalità ISTAT e la composizione;
// - aperto:   quanto il luogo è all'aperto (0..1): pesa l'effetto della pioggia;
// - breve:    nome corto per le etichette sulla mappa;
// - parlato:  come lo chiama CiroGPT nelle risposte (se manca, vale `breve`);
// - visita:   è un luogo che si visita (consigli "senza folla" dell'agente Turismo).
// Modulo isomorfo (browser e Node), senza rete.

import { LUOGHI, CATEGORIE, LIVELLI_FOLLA, livelloFolla, distanzaKm } from '../../shared/iot-agents/example/luoghi.js';

export { CATEGORIE, LIVELLI_FOLLA, livelloFolla, distanzaKm };

/** Caratteri dei 10 luoghi già presenti nella mappa 2D (stesse chiavi, stesse coordinate e capienze). */
const CARATTERI = {
  plebiscito: { profilo: 'piazza', turisti: 0.6, aperto: 1, breve: 'Plebiscito', parlato: 'Piazza del Plebiscito', visita: true },
  centro_storico: { profilo: 'piazza', turisti: 0.65, aperto: 0.85, breve: 'Spaccanapoli', parlato: 'Spaccanapoli (centro storico)', visita: true },
  lungomare: { profilo: 'mare', turisti: 0.45, aperto: 1, breve: 'Lungomare', parlato: 'Lungomare Caracciolo', visita: true },
  mergellina: { profilo: 'mare', turisti: 0.35, aperto: 1, breve: 'Mergellina', visita: true },
  beverello: { profilo: 'porto', turisti: 0.7, aperto: 0.7, breve: 'Porto · Beverello', parlato: 'Porto (Molo Beverello)' },
  castel_ovo: { profilo: 'attrazione', turisti: 0.75, aperto: 0.9, breve: "Castel dell'Ovo", visita: true },
  garibaldi: { profilo: 'stazione', turisti: 0.3, aperto: 0.3, breve: 'Garibaldi', parlato: 'Stazione Centrale (Garibaldi)' },
  vomero: { profilo: 'quartiere', turisti: 0.15, aperto: 0.8, breve: 'Vomero' },
  sanita: { profilo: 'quartiere', turisti: 0.3, aperto: 0.8, breve: 'Sanità' },
  maradona: { profilo: 'stadio', turisti: 0.1, aperto: 0.9, breve: 'Fuorigrotta · Maradona', parlato: 'Fuorigrotta (Stadio Maradona)' },
};

/** Parole spostate dai luoghi originali ai luoghi nuovi (più precisi): servono ad abbinare eventi e domande. */
const PAROLE_TOLTE = {
  plebiscito: ['Via Toledo', 'Via Chiaia'],
  centro_storico: ['San Gregorio Armeno', 'Piazza Dante', 'Duomo', 'Museo Archeologico', 'MANN'],
  vomero: ["Castel Sant'Elmo", 'San Martino', 'Arenella'],
  sanita: ['Capodimonte'],
  mergellina: ['Posillipo', 'Pausilypon'],
};

/** Parole in più per i luoghi originali (come le persone li chiamano in chat). */
const PAROLE_AGGIUNTE = {
  plebiscito: ['Piazza Plebiscito'],
  beverello: ['porto', 'Molo Beverello', 'traghetti', 'nave da crociera', 'port of Naples', 'port'],
  garibaldi: ['stazione centrale', 'Piazza Garibaldi', 'Centrale', 'central station'],
  maradona: ['Campi Flegrei', 'Tecchio', 'stadium'],
  lungomare: ['Via Caracciolo', 'Villa Comunale', 'seafront'],
  centro_storico: ['centro storico', 'Tribunali', 'historic centre', 'old town'],
  vomero: ['Piazza Vanvitelli'],
};

/** Luoghi nuovi del gemello 3D. */
const NUOVI = {
  toledo: {
    nome: 'Via Toledo · Quartieri Spagnoli', categoria: 'piazze', capienza: 4000, lat: 40.84168, lon: 14.24875,
    parole: ['Via Toledo', 'Toledo', 'Quartieri Spagnoli', 'Largo Maradona', 'murale di Maradona'],
    profilo: 'shopping', turisti: 0.5, aperto: 0.9, breve: 'Via Toledo', visita: true,
  },
  dante: {
    nome: 'Piazza Dante · Port’Alba', categoria: 'piazze', capienza: 2000, lat: 40.84916, lon: 14.2503,
    parole: ['Piazza Dante', "Port'Alba", 'Piazza Bellini', 'Convitto'],
    profilo: 'movida', turisti: 0.35, aperto: 1, breve: 'Piazza Dante',
  },
  sangregorio: {
    nome: 'San Gregorio Armeno', categoria: 'attrazioni', capienza: 1200, lat: 40.85041, lon: 14.25762,
    parole: ['San Gregorio Armeno', 'presepi', 'presepe', 'San Lorenzo Maggiore', 'Napoli Sotterranea'],
    profilo: 'attrazione', turisti: 0.8, aperto: 0.9, breve: 'S. Gregorio Armeno', parlato: 'San Gregorio Armeno', visita: true,
    // via dei presepi: da novembre all'Epifania è il luogo più affollato del centro (ipotesi dichiarata)
    mesi: { 11: 1.45, 12: 1.8, 1: 1.25 },
  },
  duomo: {
    nome: 'Duomo · Tesoro di San Gennaro', categoria: 'attrazioni', capienza: 1500, lat: 40.85265, lon: 14.25987,
    parole: ['Duomo', 'Cattedrale', 'San Gennaro', 'Via Duomo', 'Museo del Tesoro'],
    profilo: 'attrazione', turisti: 0.7, aperto: 0.5, breve: 'Duomo', visita: true,
  },
  mann: {
    nome: 'Museo Archeologico Nazionale', categoria: 'attrazioni', capienza: 1200, lat: 40.85361, lon: 14.25115,
    parole: ['Museo Archeologico', 'MANN', 'Museo Nazionale', 'Piazza Cavour', 'Galleria Principe'],
    profilo: 'museo', turisti: 0.8, aperto: 0.15, breve: 'MANN', parlato: 'Museo Archeologico (MANN)', visita: true,
  },
  capodimonte: {
    nome: 'Museo e Real Bosco di Capodimonte', categoria: 'attrazioni', capienza: 1800, lat: 40.86703, lon: 14.25088,
    parole: ['Capodimonte', 'Real Bosco', 'Museo di Capodimonte', 'Reggia di Capodimonte'],
    profilo: 'parco', turisti: 0.5, aperto: 0.7, breve: 'Capodimonte', parlato: 'Museo e Bosco di Capodimonte', visita: true,
  },
  santelmo: {
    nome: "Castel Sant'Elmo · San Martino", categoria: 'attrazioni', capienza: 1200, lat: 40.84371, lon: 14.23925,
    parole: ["Castel Sant'Elmo", "Sant'Elmo", 'San Martino', 'Certosa', 'Largo San Martino'],
    profilo: 'attrazione', turisti: 0.75, aperto: 0.8, breve: "Sant'Elmo", parlato: "Castel Sant'Elmo", visita: true,
  },
  chiaia: {
    nome: 'Chiaia · Piazza dei Martiri', categoria: 'quartieri', capienza: 2000, lat: 40.83431, lon: 14.24178,
    parole: ['Piazza dei Martiri', 'Via Chiaia', 'Via dei Mille', 'Via Filangieri', 'baretti', 'Chiaia'],
    profilo: 'movida', turisti: 0.3, aperto: 0.9, breve: 'Chiaia',
  },
  montesanto: {
    nome: 'Montesanto · Pignasecca', categoria: 'trasporti', capienza: 2500, lat: 40.84639, lon: 14.24393,
    parole: ['Montesanto', 'Pignasecca', 'mercato della Pignasecca', 'Piazza Pignasecca'],
    profilo: 'mercato', turisti: 0.25, aperto: 0.8, breve: 'Montesanto',
  },
  arenella: {
    nome: "Arenella · Piazza Medaglie d'Oro", categoria: 'quartieri', capienza: 2500, lat: 40.85032, lon: 14.23115,
    parole: ["Medaglie d'Oro", 'Arenella', 'Antignano', 'Piazza degli Artisti'],
    profilo: 'quartiere', turisti: 0.05, aperto: 0.8, breve: 'Arenella',
  },
  direzionale: {
    nome: 'Centro Direzionale', categoria: 'quartieri', capienza: 4000, lat: 40.85805, lon: 14.2816,
    parole: ['Centro Direzionale', 'Tribunale', 'Isola', 'Regione Campania'],
    profilo: 'uffici', turisti: 0.05, aperto: 0.6, breve: 'Centro Direzionale',
  },
  capodichino: {
    nome: 'Aeroporto di Capodichino', categoria: 'trasporti', capienza: 5000, lat: 40.884, lon: 14.28455,
    parole: ['aeroporto', 'Capodichino', 'airport', 'aereo', 'volo'],
    profilo: 'aeroporto', turisti: 0.6, aperto: 0.1, breve: 'Aeroporto', parlato: 'Aeroporto di Capodichino',
  },
  sangiovanni: {
    nome: 'San Giovanni a Teduccio · Polo universitario', categoria: 'quartieri', capienza: 2000, lat: 40.83716, lon: 14.30587,
    parole: ['San Giovanni a Teduccio', 'San Giovanni', 'Apple Academy', 'polo universitario', 'Pietrarsa'],
    profilo: 'uffici', turisti: 0.05, aperto: 0.6, breve: 'San Giovanni',
  },
  virgiliano: {
    nome: 'Posillipo · Parco Virgiliano', categoria: 'mare', capienza: 2500, lat: 40.80388, lon: 14.18653,
    parole: ['Parco Virgiliano', 'Posillipo', 'Virgiliano', 'Pausilypon', 'Marechiaro', 'Gaiola'],
    profilo: 'parco', turisti: 0.3, aperto: 1, breve: 'Posillipo', parlato: 'Posillipo (Parco Virgiliano)', visita: true,
  },
  cittascienza: {
    nome: 'Città della Scienza · Bagnoli', categoria: 'eventi', capienza: 2500, lat: 40.80472, lon: 14.17454,
    parole: ['Città della Scienza', 'Coroglio', 'Futuro Remoto', 'Big Hack', 'hackathon', 'Bagnoli'],
    profilo: 'museo', turisti: 0.3, aperto: 0.3, breve: 'Città della Scienza', visita: true,
  },
  sanlaise: {
    nome: 'Parco San Laise · Bagnoli', categoria: 'eventi', capienza: 3000, lat: 40.82165, lon: 14.16532,
    parole: ['Parco San Laise', 'San Laise', 'ex base NATO', 'Viale della Liberazione'],
    profilo: 'sede', turisti: 0.1, aperto: 1, breve: 'Parco San Laise',
  },
};

function componi() {
  const out = {};
  for (const [zona, l] of Object.entries(LUOGHI)) {
    const tolte = (PAROLE_TOLTE[zona] || []).map((p) => p.toLowerCase());
    out[zona] = Object.freeze({
      ...l,
      ...CARATTERI[zona],
      originale: true,
      parole: [...l.parole.filter((p) => !tolte.includes(p.toLowerCase())), ...(PAROLE_AGGIUNTE[zona] || [])],
    });
  }
  for (const [zona, l] of Object.entries(NUOVI)) out[zona] = Object.freeze({ ...l, originale: false });
  return Object.freeze(out);
}

/** @type {Record<string, {nome:string, breve:string, categoria:string, capienza:number, lat:number, lon:number, parole:string[], profilo:string, turisti:number, aperto:number, originale:boolean, mesi?:Record<number,number>}>} */
export const LUOGHI3D = componi();

export const ZONE = Object.freeze(Object.keys(LUOGHI3D));

/** Colori dei 4 livelli (gli stessi della mappa 2D, per coerenza tra i prototipi). */
export const COLORI_LIVELLO = Object.freeze({
  tranquillo: '#1fb46a',
  normale: '#f2c200',
  vivace: '#ff8a2a',
  affollato: '#e5413a',
});

export const ETICHETTE_LIVELLO = Object.freeze(Object.fromEntries(LIVELLI_FOLLA.map((l) => [l.id, l.label])));

/** Il luogo più vicino a un punto {lat, lon} (zona e distanza in km). */
export function luogoVicino(punto, { escludi = [] } = {}) {
  let migliore = null;
  for (const [zona, l] of Object.entries(LUOGHI3D)) {
    if (escludi.includes(zona)) continue;
    const km = distanzaKm(punto, l);
    if (!migliore || km < migliore.km) migliore = { zona, km };
  }
  return migliore;
}
