// Il quartiere della demo: tetti fotovoltaici (ognuno con il suo ESP32) e famiglie della CER.
// Dati di fantasia ma plausibili: un isolato di tre scale a Napoli Est ("Rione Sole").
// Modulo isomorfo. Per adattarlo a un quartiere vero basta cambiare questo file.

export const CER = {
  nome: 'CER Rione Sole',
  luogo: 'Napoli Est',
  gruppoWhatsapp: 'cer-rione-sole',
  referente: 'referente-cer',
  lat: 40.8442,
  lon: 14.2958,
};

/**
 * Tetti fotovoltaici. `zona` è la `location.zone` mandata dall'ESP32 del tetto.
 * `kWp` = potenza di picco. `luxPerWm2` (facoltativo) sovrascrive la conversione
 * generale di parametri.js dopo la taratura del singolo sensore.
 */
export const TETTI = [
  { id: 'tetto-a', zona: 'scala-a', nome: 'Tetto scala A', frase: 'sul tetto della scala A', kWp: 6, lat: 40.8443, lon: 14.2953 },
  { id: 'tetto-b', zona: 'scala-b', nome: 'Tetto scala B', frase: 'sul tetto della scala B', kWp: 8, lat: 40.8444, lon: 14.2959 },
  { id: 'tetto-c', zona: 'scala-c', nome: 'Pensilina del cortile', frase: 'sulla pensilina del cortile', kWp: 4, lat: 40.844, lon: 14.2962 },
];

/** Catalogo dei carichi spostabili (valori medi per ciclo, indicativi). */
export const CARICHI = {
  lavatrice: { nome: 'Lavatrice', kwh: 1.0, durataH: 2, divisibile: false, verbo: 'avvia la lavatrice', daSolo: 'basta impostare la partenza ritardata' },
  lavastoviglie: { nome: 'Lavastoviglie', kwh: 1.1, durataH: 2, divisibile: false, verbo: 'fai partire la lavastoviglie', daSolo: 'basta impostare la partenza ritardata' },
  asciugatrice: { nome: 'Asciugatrice', kwh: 2.0, durataH: 1.5, divisibile: false, verbo: 'avvia l\'asciugatrice' },
  scaldabagno: { nome: 'Scaldabagno', kwh: 3.0, durataH: 2, divisibile: false, verbo: 'accendi lo scaldabagno', daSolo: 'si accende da solo con la presa smart' },
  auto: { nome: 'Auto elettrica', kwh: 9, potenzaKw: 2.3, divisibile: true, verbo: 'carica l\'auto', daSolo: 'la wallbox segue il sole da sola' },
  raffrescamento: { nome: 'Pre-raffrescamento', kwh: 1.6, potenzaKw: 0.8, divisibile: true, verbo: 'rinfresca casa', daSolo: 'il climatizzatore si programma da solo' },
};

/**
 * Profili orari del consumo NON spostabile (frigo, luci, cucina, TV, PC), in kW, ore 0..23.
 * Forma tipica dei profili residenziali italiani, tarata perché una famiglia media consumi
 * 2.000-2.700 kWh/anno compresi i carichi spostabili; scalati per il numero di persone.
 */
export const PROFILI = {
  casa: {
    nome: 'sempre in casa',
    kw: [0.08, 0.07, 0.07, 0.07, 0.07, 0.07, 0.11, 0.19, 0.22, 0.17, 0.17, 0.19, 0.33, 0.3, 0.17, 0.15, 0.17, 0.22, 0.28, 0.33, 0.3, 0.25, 0.17, 0.11],
    presenza: [[7, 23]],
  },
  famiglia: {
    nome: 'famiglia con bambini',
    kw: [0.1, 0.08, 0.08, 0.08, 0.08, 0.09, 0.17, 0.33, 0.25, 0.14, 0.12, 0.14, 0.25, 0.3, 0.17, 0.15, 0.19, 0.28, 0.39, 0.5, 0.52, 0.41, 0.28, 0.15],
    presenza: [[6, 9], [13, 23]],
  },
  fuori: {
    nome: 'fuori casa di giorno',
    kw: [0.07, 0.06, 0.06, 0.06, 0.06, 0.07, 0.17, 0.28, 0.14, 0.07, 0.07, 0.07, 0.07, 0.07, 0.07, 0.07, 0.08, 0.17, 0.3, 0.44, 0.44, 0.33, 0.22, 0.11],
    presenza: [[6, 8], [18, 23]],
  },
  smart: {
    nome: 'lavoro o studio da casa',
    kw: [0.08, 0.07, 0.07, 0.07, 0.07, 0.07, 0.11, 0.22, 0.22, 0.21, 0.2, 0.2, 0.3, 0.28, 0.2, 0.2, 0.21, 0.25, 0.33, 0.41, 0.39, 0.3, 0.22, 0.12],
    presenza: [[7, 23]],
  },
};

/**
 * Le famiglie. Ogni famiglia ha un suo agente casa.
 * - `carichi[].abitudine`: ora in cui lo fanno di solito (scenario "senza agenti");
 * - `carichi[].finestra`: [da, entro] in cui la famiglia accetta di spostarlo;
 * - `carichi[].automatico`: presa smart / wallbox / partenza ritardata: non serve che qualcuno sia in casa;
 * - `adesione`: probabilità di accettare un consiglio compatibile (simula persone vere);
 * - `fragile`: persone anziane o con bisogni particolari (priorità negli avvisi di caldo).
 */
export const FAMIGLIE = [
  {
    id: 'esposito', nome: 'Esposito', scala: 'A', piano: 1, persone: 2, profilo: 'casa', fragile: true,
    descrizione: 'Coppia di pensionati', riscaldamento: 'pdc', clima: 'split', adesione: 0.95,
    motivoRifiuto: 'Oggi abbiamo i nipoti a pranzo, la lavatrice la facciamo stasera.',
    carichi: [
      { tipo: 'lavatrice', abitudine: 18, finestra: [8, 21] },
      { tipo: 'lavastoviglie', abitudine: 20.5, finestra: [8, 23] },
    ],
  },
  {
    id: 'russo', nome: 'Russo', scala: 'A', piano: 2, persone: 4, profilo: 'famiglia',
    descrizione: 'Famiglia con due bambini', riscaldamento: 'gas', clima: 'split', adesione: 0.85,
    motivoRifiuto: 'Stamattina siamo tutti fuori, lasciamo la lavatrice a stasera.',
    carichi: [
      { tipo: 'lavatrice', abitudine: 19.5, finestra: [8, 22], automatico: true },
      { tipo: 'lavastoviglie', abitudine: 21.5, finestra: [9, 23] },
      { tipo: 'scaldabagno', abitudine: 17, finestra: [7, 19], automatico: true },
    ],
  },
  {
    id: 'deluca', nome: 'De Luca', scala: 'A', piano: 3, persone: 1, profilo: 'smart',
    descrizione: 'Ingegnera in smart working, auto elettrica', riscaldamento: 'pdc', adesione: 0.9,
    motivoRifiuto: 'Oggi mi serve l\'auto a metà giornata.',
    carichi: [
      { tipo: 'auto', abitudine: 19, finestra: [9, 23.5], automatico: true },
      { tipo: 'lavastoviglie', abitudine: 22, finestra: [9, 23.5] },
    ],
  },
  {
    id: 'romano', nome: 'Romano', scala: 'B', piano: 1, persone: 2, profilo: 'fuori',
    descrizione: 'Coppia che lavora fuori casa', riscaldamento: 'gas', adesione: 0.8,
    motivoRifiuto: 'Non ci piace lasciare la lavastoviglie accesa quando non c\'è nessuno.',
    carichi: [
      { tipo: 'lavatrice', abitudine: 21, finestra: [7, 22], automatico: true },
      { tipo: 'lavastoviglie', abitudine: 21, finestra: [7, 23], automatico: true },
    ],
  },
  {
    id: 'ferraro', nome: 'Ferraro', scala: 'B', piano: 2, persone: 5, profilo: 'famiglia',
    descrizione: 'Famiglia numerosa', riscaldamento: 'pdc', clima: 'split', adesione: 0.85,
    motivoRifiuto: 'Oggi l\'asciugatrice ci serve dopo cena.',
    carichi: [
      { tipo: 'lavatrice', abitudine: 18.5, finestra: [8, 22] },
      { tipo: 'asciugatrice', abitudine: 20.5, finestra: [9, 23] },
      { tipo: 'scaldabagno', abitudine: 17.5, finestra: [7, 19], automatico: true },
    ],
  },
  {
    id: 'coppola', nome: 'Coppola', scala: 'B', piano: 3, persone: 2, profilo: 'smart',
    descrizione: 'Due studentesse fuori sede', riscaldamento: 'gas', adesione: 0.7,
    motivoRifiuto: 'Domattina abbiamo lezione presto, la facciamo stasera.',
    carichi: [{ tipo: 'lavatrice', abitudine: 22, finestra: [10, 24] }],
  },
  {
    id: 'marino', nome: 'Marino', scala: 'B', piano: 4, persone: 1, profilo: 'casa', fragile: true,
    descrizione: 'Pensionata che vive sola', riscaldamento: 'gas', adesione: 0.95,
    motivoRifiuto: 'Stamattina vado dal medico.',
    carichi: [{ tipo: 'lavatrice', abitudine: 10, finestra: [8, 18] }],
  },
  {
    id: 'iovine', nome: 'Iovine', scala: 'C', piano: 1, persone: 3, profilo: 'famiglia',
    descrizione: 'Famiglia con un neonato', riscaldamento: 'pdc', adesione: 0.9,
    motivoRifiuto: 'Il bimbo dorme dopo pranzo: la lavatrice fa troppo rumore.',
    carichi: [
      { tipo: 'lavatrice', abitudine: 20.5, finestra: [8, 22] },
      { tipo: 'lavastoviglie', abitudine: 21.5, finestra: [8, 23] },
      { tipo: 'scaldabagno', abitudine: 18, finestra: [7, 19.5], automatico: true },
    ],
  },
  {
    id: 'capasso', nome: 'Capasso', scala: 'C', piano: 2, persone: 2, profilo: 'fuori',
    descrizione: 'Artigiano: l\'auto elettrica è fuori casa di giorno', riscaldamento: 'gas', adesione: 0.9,
    motivoRifiuto: 'Oggi rientro tardi.',
    carichi: [
      { tipo: 'auto', abitudine: 18.5, finestra: [18.5, 24], automatico: true },
      { tipo: 'lavatrice', abitudine: 20, finestra: [7, 22], automatico: true },
    ],
  },
  {
    id: 'sorrentino', nome: 'Sorrentino', scala: 'C', piano: 3, persone: 2, profilo: 'smart',
    descrizione: 'Coppia giovane in smart working', riscaldamento: 'pdc', clima: 'split', adesione: 0.85,
    motivoRifiuto: 'Oggi pomeriggio usciamo, la lavastoviglie la facciamo stasera.',
    carichi: [
      { tipo: 'lavatrice', abitudine: 19, finestra: [8, 22] },
      { tipo: 'lavastoviglie', abitudine: 21, finestra: [9, 23] },
    ],
  },
];

export const tettoDellaScala = (scala) => TETTI.find((t) => t.zona === `scala-${String(scala).toLowerCase()}`) || TETTI[0];
export const famiglia = (id) => FAMIGLIE.find((f) => f.id === id);
/** Destinatario WhatsApp di una famiglia (il numero vero lo associa OpenClaw). */
export const destinatario = (id) => `famiglia-${id}`;
