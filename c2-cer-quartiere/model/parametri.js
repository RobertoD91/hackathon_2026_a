// Parametri economici, ambientali e di conversione della CER, con la loro fonte.
// Modulo isomorfo (Node e browser): lo usano agenti, test e dashboard (tabella "fonti").
//
// Regola: ogni numero che finisce in un KPI sta qui, con `fonte` e `stato`.
// `stato` = "dato pubblicato" se il valore è preso da un documento ufficiale,
// "indicativo, da verificare" se è una stima o un arrotondamento nostro.

export const PARAMETRI = {
  tariffaPremio: {
    etichetta: 'Tariffa premio GSE sull\'energia condivisa',
    valore: 0.12,
    unita: '€/kWh',
    fonte:
      'DM MASE 414/2023 (decreto CACER) e regole operative GSE: impianti fino a 200 kW, ' +
      'TIP = 80 €/MWh + max(0; 180 − Pz), con tetto di 120 €/MWh. Per il fotovoltaico al Sud ' +
      '(Campania) non c\'è maggiorazione geografica (+4 Centro, +10 Nord). Con Pz intorno a ' +
      '100-110 €/MWh si arriva al tetto. Senza contributo PNRR in conto capitale (Napoli supera i 50.000 abitanti).',
    stato: 'indicativo, da verificare (dipende dal prezzo zonale orario Pz)',
  },
  valorizzazioneArera: {
    etichetta: 'Restituzione ARERA delle componenti tariffarie',
    valore: 0.009,
    unita: '€/kWh',
    fonte:
      'ARERA, TIAD (delibera 727/2022/R/eel): corrispettivo di valorizzazione sull\'energia condivisa ' +
      '(componenti di trasmissione e distribuzione evitate). Ordine di grandezza 8-10 €/MWh in bassa tensione.',
    stato: 'indicativo, da verificare (aggiornato ogni anno da ARERA)',
  },
  fattoreEmissione: {
    etichetta: 'Fattore di emissione dei consumi elettrici',
    valore: 0.2347,
    unita: 'kg CO₂/kWh',
    fonte:
      'ISPRA, "Le emissioni di CO₂ nel settore elettrico", Rapporto 413/2025, Tabella 1.3: ' +
      'consumi elettrici 2023 = 234,7 g CO₂/kWh (stima preliminare 2024: 198,9).',
    stato: 'dato pubblicato (usare l\'edizione più recente)',
  },
  perditeEnergia: {
    etichetta: 'Perdite di rete applicate in bolletta',
    valore: 0.102,
    unita: '',
    fonte: 'ARERA, fattore convenzionale di perdita per le utenze in bassa tensione (10,2%).',
    stato: 'indicativo, da verificare',
  },
  spreadOfferta: {
    etichetta: 'Spread di un\'offerta a prezzo orario indicizzato al PUN',
    valore: 0.015,
    unita: '€/kWh',
    fonte: 'Valore tipico delle offerte PUN-indicizzate sul mercato libero (Portale Offerte ARERA).',
    stato: 'indicativo, da verificare',
  },
  punOrario: {
    etichetta: 'Profilo orario del PUN (giorno feriale d\'autunno)',
    // €/MWh, ore 0..23
    valore: [105, 100, 97, 95, 96, 102, 115, 130, 135, 125, 115, 108, 104, 102, 105, 112, 128, 150, 165, 160, 145, 130, 120, 110],
    unita: '€/MWh',
    fonte:
      'GME (mercatoelettrico.org), forma tipica del PUN orario: valle nelle ore centrali, picco tra le 18 e le 20. ' +
      'Valori arrotondati da noi.',
    stato: 'indicativo, da verificare sui dati GME del giorno',
  },
  luxPerWm2: {
    etichetta: 'Conversione luce → irraggiamento (sensore con diffusore)',
    valore: 60,
    unita: 'lux per W/m²',
    fonte:
      'La luce solare ha un\'efficacia luminosa di circa 110-120 lm/W; il BH1750 satura a ~55.000 lux ' +
      '(modalità ad alta risoluzione), quindi lo montiamo dietro un diffusore che dimezza la lettura: ' +
      '≈ 60 lux per W/m². Da tarare per ogni tetto confrontando con l\'inverter in una giornata serena.',
    stato: 'indicativo, da tarare',
  },
  performanceRatio: {
    etichetta: 'Performance ratio dell\'impianto',
    valore: 0.85,
    unita: '',
    fonte: 'Valore tipico per impianti FV residenziali (perdite di temperatura, inverter, cavi, sporco).',
    stato: 'indicativo',
  },
  coefficienteRiscaldamento: {
    etichetta: 'Pompa di calore: kW elettrici per grado sotto 19 °C',
    valore: 0.05,
    unita: 'kW/°C',
    fonte: 'Appartamento di 70-90 m² in classe E-F, COP ≈ 3. Stima nostra.',
    stato: 'indicativo',
  },
  coefficienteRaffrescamento: {
    etichetta: 'Climatizzatore: kW elettrici per grado sopra 26 °C',
    valore: 0.12,
    unita: 'kW/°C',
    fonte: 'Split da 9.000-12.000 BTU, EER ≈ 3. Stima nostra.',
    stato: 'indicativo',
  },
  giorniAnno: {
    etichetta: 'Proiezione annua',
    valore: 365,
    unita: 'giorni',
    fonte: '"Se ogni giorno fosse come oggi": solo un ordine di grandezza. A novembre si produce meno della media annua.',
    stato: 'stima grezza',
  },
};

/** Valore numerico di un parametro (scorciatoia). */
export const P = (nome) => PARAMETRI[nome].valore;

/** Euro per kWh condiviso (tariffa premio + restituzione ARERA). */
export const euroPerKwhCondiviso = () => P('tariffaPremio') + P('valorizzazioneArera');

/**
 * Prezzo della componente energia in bolletta per un'offerta a prezzo orario (€/kWh).
 * Solo questa parte cambia con l'ora: oneri, trasporto e quota fissa non dipendono
 * dall'orario e si annullano nel confronto con/senza agenti.
 */
export function prezzoEnergia(h) {
  const pun = P('punOrario')[Math.max(0, Math.min(23, Math.floor(h)))];
  return (pun / 1000) * (1 + P('perditeEnergia')) + P('spreadOfferta');
}
