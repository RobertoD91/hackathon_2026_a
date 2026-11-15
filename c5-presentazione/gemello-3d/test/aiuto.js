// Dati di prova condivisi dai test: eventi finti (così i test non dipendono dal calendario del giorno),
// riferimenti e trasporti veri dagli snapshot della repo.
import fs from 'node:fs';
import * as N from '../../../citta-api/fonti/normalizza.js';

const DATI = new URL('../../../citta-api/dati/', import.meta.url);
export const leggi = (nome) => JSON.parse(fs.readFileSync(new URL(`${nome}.json`, DATI), 'utf8'));

/** Sabato 14 novembre 2026, 15:30 a Napoli. */
export const ADESSO = N.daOraLocale(2026, 11, 14, 15, 30);
export const ora = (giorno, h, m = 0) => N.daOraLocale(2026, 11, giorno, h, m);

/** Calendario finto: un evento grande del Comune sul Lungomare domenica mattina, una partita lunedì sera. */
export const EVENTI = {
  partite: [{ giorno: '2026-11-16', ora: '20:45', casa: 'Napoli', ospite: 'Torino', competizione: 'Serie A', fonte: 'openfootball' }],
  crociere: [{ giorno: '2026-11-16', navi: ['Nave Uno', 'Nave Due'] }],
  comune: [{ titolo: 'Corsa sul lungomare', inizio: ora(15, 9), fine: ora(15, 13), luogo: 'Rotonda Diaz | Lungomare Caracciolo - Napoli', tipo: 'Evento sportivo', zona: 'lungomare', grande: true }],
  speciali: [],
};

export const meteoSereno = () => ({ temperatura: 17, pioggia: 0, cielo: 'Sereno', raffiche: 10 });
