/**
 * Etichette in italiano per le voci dei menu.
 * Le chiavi sono i valori interni delle opzioni (usati dalla logica di gioco): qui cambia solo il testo mostrato.
 */
const MENU_LABELS = Object.freeze({
  // menu di battaglia
  FIGHT: 'MOSSE',
  SWITCH: 'CAMBIA',
  ITEM: 'OGGETTI',
  FLEE: 'FUGGI',
  // menu del mondo
  MONSTERDEX: 'DATABASE',
  MONSTERS: 'TEAM',
  BAG: 'ZAINO',
  SAVE: 'SALVA',
  OPTIONS: 'OPZIONI',
  EXIT: 'ESCI',
  // conferma
  YES: 'SÌ',
  NO: 'NO',
  // menu della squadra
  SELECT: 'SCEGLI',
  MOVE: 'SPOSTA',
  SUMMARY: 'DETTAGLI',
  RELEASE: 'RILASCIA',
  CANCEL: 'ANNULLA',
});

/**
 * @param {string} option valore interno dell'opzione
 * @returns {string} etichetta da mostrare
 */
export function menuLabel(option) {
  return MENU_LABELS[option] ?? option;
}
