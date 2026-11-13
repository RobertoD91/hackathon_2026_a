// Agente "folla": stima l'affollamento per luogo (people_count dei sensori della zona,
// in produzione: dati anonimi e aggregati delle celle telefoniche) e, quando un luogo
// diventa "Affollato", propone all'orchestratore un'alternativa tranquilla vicina.
// Regole deterministiche, niente LLM.

import { Agent } from '../../src/agent.js';
import { LUOGHI, livelloFolla, distanzaKm } from '../luoghi.js';

export class FollaAgent extends Agent {
  name = 'folla';
  description = 'Affollamento per luogo (stile Seoul Real-Time City Data); propone alternative.';
  subscribes = ['reading'];

  /** zona → id del livello */
  #livelli = new Map();

  async onEvent(event, ctx) {
    const { readings, location } = event.data;
    if (typeof readings.people_count !== 'number') return;
    const zona = location?.zone;
    const luogo = LUOGHI[zona];
    if (!luogo) return;

    const persone = personeInZona(ctx.state, zona);
    const livello = livelloFolla(persone, luogo.capienza);
    const prima = this.#livelli.get(zona);
    this.#livelli.set(zona, livello.id);

    if (this.cooldown('metrica', 3000)) {
      const affollati = [...this.#livelli.values()].filter((l) => l === 'affollato').length;
      ctx.metric('luoghi_affollati', affollati, '', { label: 'Luoghi affollati' });
      ctx.metric('persone_stimate', totalePersone(ctx.state), '', { label: 'Persone nei luoghi monitorati' });
    }

    if (prima === undefined || prima === livello.id) return;
    if (livello.id === 'affollato') {
      const alt = alternativa(ctx.state, zona);
      ctx.decide(`${luogo.nome} è affollato: ~${persone} persone`, {
        level: 'warning',
        actions: [{ type: 'suggerisci_alternativa', zone: zona }, ...(alt ? [{ type: 'alternativa', zone: alt.zona }] : [])],
        reasoning:
          `Stima ${persone} persone su una soglia di ${luogo.capienza}.` +
          (alt ? ` Alternativa più vicina e tranquilla: ${alt.nome} (${alt.km.toFixed(1)} km, ${alt.livello}).` : ''),
      });
      ctx.send('orchestrator', `${luogo.nome} affollato`, {
        tipo: 'affollamento',
        zona,
        luogo: luogo.nome,
        persone,
        alternativa: alt ? { zona: alt.zona, nome: alt.nome, km: Math.round(alt.km * 10) / 10 } : null,
      });
    } else if (prima === 'affollato') {
      ctx.decide(`${luogo.nome}: affollamento in calo (${livello.label.toLowerCase()})`, { level: 'good' });
    }
  }
}

/** Somma delle persone stimate dai sensori attivi della zona. */
export function personeInZona(state, zona) {
  return Math.round(
    state
      .values('people_count', { zone: zona })
      .reduce((s, v) => s + (typeof v.value === 'number' ? v.value : 0), 0),
  );
}

function totalePersone(state) {
  return Object.keys(LUOGHI).reduce((s, z) => s + personeInZona(state, z), 0);
}

/** Il luogo più vicino con livello "tranquillo" o "normale" (stessa categoria se possibile). */
function alternativa(state, zona) {
  const da = LUOGHI[zona];
  const candidati = Object.entries(LUOGHI)
    .filter(([z]) => z !== zona && z !== 'maradona')
    .map(([z, l]) => {
      const liv = livelloFolla(personeInZona(state, z), l.capienza);
      return { zona: z, nome: l.nome, km: distanzaKm(da, l), livello: liv.label.toLowerCase(), ok: liv.id === 'tranquillo' || liv.id === 'normale', stessa: l.categoria === da.categoria };
    })
    .filter((c) => c.ok)
    .sort((a, b) => Number(b.stessa) - Number(a.stessa) || a.km - b.km);
  return candidati[0] ?? null;
}
