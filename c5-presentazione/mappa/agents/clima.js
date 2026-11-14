// Agente "clima": controlla la temperatura per zona e segnala il caldo all'orchestratore.
// Esempio di agente specialista: regole deterministiche, niente LLM.

import { Agent } from '../src/agent.js';

const SOGLIA_CALDO = 30; // °C: sopra questa media di zona c'è "caldo"
const SOGLIA_RIENTRO = 28; // °C: sotto torna normale (isteresi, per non oscillare)

export class ClimaAgent extends Agent {
  name = 'clima';
  description = 'Temperatura e umidità per zona; segnala il caldo.';
  subscribes = ['reading'];

  /** zona → 'normale' | 'caldo' */
  #statoZone = new Map();

  async onEvent(event, ctx) {
    const { readings, location } = event.data;
    if (typeof readings.temperature_c !== 'number') return;
    const zona = location?.zone ?? 'sconosciuta';

    // media della zona dallo stato condiviso (comprende la lettura appena arrivata)
    const media = ctx.state.average('temperature_c', { zone: zona });
    const umidita = ctx.state.average('humidity_pct', { zone: zona });
    const prima = this.#statoZone.get(zona) ?? 'normale';
    const ora = media >= SOGLIA_CALDO ? 'caldo' : media <= SOGLIA_RIENTRO ? 'normale' : prima;
    this.#statoZone.set(zona, ora);

    // KPI: temperatura media della città, al massimo una volta ogni 3 secondi
    if (this.cooldown('metrica', 3000)) {
      ctx.metric('temperatura_media', round(ctx.state.average('temperature_c')), '°C', { label: 'Temperatura sensori' });
      ctx.metric('zone_calde', [...this.#statoZone.values()].filter((s) => s === 'caldo').length, '', {
        label: 'Zone con caldo',
      });
    }

    if (ora === prima) return;
    if (ora === 'caldo') {
      ctx.decide(`Caldo in zona ${zona}: media ${round(media)} °C`, {
        level: 'warning',
        actions: [{ type: 'allerta', zone: zona }],
        reasoning: `La media di zona ha superato ${SOGLIA_CALDO} °C (umidità ${round(umidita) ?? 'n/d'} %).`,
      });
      ctx.send('orchestrator', `Caldo in zona ${zona}: ${round(media)} °C`, {
        tipo: 'caldo',
        zona,
        temperatura: round(media),
        umidita: round(umidita),
      });
    } else {
      ctx.decide(`Temperatura rientrata in zona ${zona}: ${round(media)} °C`, { level: 'good' });
      ctx.send('orchestrator', `Caldo rientrato in zona ${zona}`, { tipo: 'caldo_rientrato', zona });
    }
  }
}

const round = (v) => (typeof v === 'number' ? Math.round(v * 10) / 10 : null);
