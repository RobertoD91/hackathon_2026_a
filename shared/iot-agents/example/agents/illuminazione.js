// Agente "illuminazione": accende i lampioni di una zona solo quando la luce naturale
// non basta, e misura l'energia risparmiata rispetto a un orario fisso.
// Esempio di agente che usa l'ora simulata (ctx.simTime) e produce un KPI misurabile.

import { Agent } from '../../src/agent.js';
import { hourOf } from '../../sim/sim-core.js';

const SOGLIA_LUX = 400; // sotto questa luce servono i lampioni
const POTENZA_ZONA_KW = 4; // potenza dei lampioni di una zona
// Confronto: un impianto a orario fisso, acceso dalle 16:30 alle 7:00.
const accesoAOrario = (h) => h >= 16.5 || h < 7;

export class IlluminazioneAgent extends Agent {
  name = 'illuminazione';
  description = 'Lampioni accesi solo quando serve; kWh risparmiati rispetto all\'orario fisso.';
  subscribes = ['reading'];

  #accesi = new Map(); // zona → boolean
  #ultimoTs = new Map(); // zona → ora simulata dell'ultima lettura
  #kwhRisparmiati = 0;

  async onEvent(event, ctx) {
    const { readings, location, meta } = event.data;
    if (typeof readings.light_lux !== 'number') return;
    const zona = location?.zone ?? 'sconosciuta';
    const simTs = meta?.simTime ?? ctx.simTime();

    const lux = ctx.state.average('light_lux', { zone: zona });
    const accendi = lux < SOGLIA_LUX;

    // energia: per l'intervallo trascorso dall'ultima lettura di questa zona
    const prevTs = this.#ultimoTs.get(zona);
    this.#ultimoTs.set(zona, simTs);
    if (prevTs !== undefined && simTs > prevTs) {
      const ore = Math.min(1, (simTs - prevTs) / 3_600_000);
      const orario = accesoAOrario(hourOf(prevTs));
      const nostro = this.#accesi.get(zona) ?? false;
      this.#kwhRisparmiati += ((orario ? 1 : 0) - (nostro ? 1 : 0)) * POTENZA_ZONA_KW * ore;
      if (this.cooldown('metrica', 3000)) {
        ctx.metric('kwh_risparmiati', Math.round(this.#kwhRisparmiati * 10) / 10, 'kWh', {
          label: 'Energia risparmiata',
        });
        ctx.metric('lampioni_accesi', [...this.#accesi.values()].filter(Boolean).length, 'zone', {
          label: 'Zone con lampioni accesi',
        });
      }
    }

    if (this.#accesi.get(zona) === accendi) return;
    this.#accesi.set(zona, accendi);
    ctx.decide(`${accendi ? 'Accendo' : 'Spengo'} i lampioni in zona ${zona} (${Math.round(lux)} lux)`, {
      level: 'info',
      actions: [{ type: accendi ? 'lampioni_on' : 'lampioni_off', zone: zona }],
      reasoning: `Soglia ${SOGLIA_LUX} lux. Un impianto a orario fisso sarebbe ${
        accesoAOrario(hourOf(simTs)) ? 'acceso' : 'spento'
      }.`,
    });
  }
}
