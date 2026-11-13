/**
 * Sistema delle contromosse red team vs blue team.
 *
 * Ogni unità red team ha un `type` (monsters.json). Ogni mossa blue team ha un campo `counters`
 * (attacks.json): se coincide con il tipo del bersaglio la mossa è super efficace, altrimenti è poco efficace.
 */

/**
 * @typedef {keyof typeof CYBER_TYPE} CyberType
 */

/** @enum {CyberType} */
export const CYBER_TYPE = Object.freeze({
  SOCIAL: 'SOCIAL',
  NETWORK: 'NETWORK',
  MALWARE: 'MALWARE',
});

export const SUPER_EFFECTIVE_MULTIPLIER = 2;
export const NOT_EFFECTIVE_MULTIPLIER = 0.5;

/** Suggerimento (due messaggi brevi) mostrato quando il giocatore usa la contromossa sbagliata. */
export const CYBER_TYPE_HINT = Object.freeze({
  SOCIAL: ['È ingegneria sociale: colpisce le persone, non le macchine.', 'Prova MFA, filtro spam o formazione.'],
  NETWORK: ['È un attacco di rete: arriva dal traffico.', 'Prova a bloccare gli IP o a limitare le richieste.'],
  MALWARE: ['È un malware: agisce sui file del sistema.', 'Prova quarantena, backup o patch.'],
});

/**
 * @typedef AttackEffectiveness
 * @type {object}
 * @property {number} multiplier
 * @property {string[]} messages messaggi da mostrare dopo il colpo
 */

/**
 * Calcola l'efficacia di una mossa contro un'unità.
 * Le mosse senza `counters` (quelle del red team) fanno danno normale.
 *
 * @param {import('../types/typedef.js').Attack} attack
 * @param {CyberType | undefined} targetType
 * @returns {AttackEffectiveness}
 */
export function getAttackEffectiveness(attack, targetType) {
  if (!attack.counters || !targetType) {
    return { multiplier: 1, messages: [] };
  }
  if (attack.counters === targetType) {
    return {
      multiplier: SUPER_EFFECTIVE_MULTIPLIER,
      messages: ['È super efficace!', ...(attack.tip ? [attack.tip] : [])],
    };
  }
  return {
    multiplier: NOT_EFFECTIVE_MULTIPLIER,
    messages: ['Non è molto efficace...', ...CYBER_TYPE_HINT[targetType]],
  };
}

/**
 * @param {number} baseAttack
 * @param {number} multiplier
 * @returns {number}
 */
export function calculateDamage(baseAttack, multiplier) {
  return Math.max(1, Math.round(baseAttack * multiplier));
}
