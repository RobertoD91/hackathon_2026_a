// Agente "campi" (agente campo): legge le sonde di umidità del suolo e la temperatura di ogni
// appezzamento, ne calcola il livello (Saturo / Ottimale / Asciutto / Stress idrico) e avvisa
// il consorzio quando un campo cambia livello. Regole deterministiche, niente LLM.

import { Agent } from '../../../src/agent.js';
import { CAMPI, COLTURE, LIVELLI_UMIDITA, livelloUmidita, livelloTemperatura } from '../campi.js';
import { fmt } from '../piano.js';

const ISTERESI = 0.4; // punti di umidità: vicino a una soglia il livello non cambia (niente avvisi a raffica per il rumore)

/** Livello di umidità con isteresi rispetto al livello precedente. */
export function livelloConIsteresi(theta, prima) {
  const lv = livelloUmidita(theta);
  if (!prima || lv.id === prima) return lv;
  if (livelloUmidita(theta + ISTERESI).id === prima || livelloUmidita(theta - ISTERESI).id === prima) {
    return LIVELLI_UMIDITA.find((l) => l.id === prima);
  }
  return lv;
}

export class CampoAgent extends Agent {
  name = 'campi';
  description = 'Umidità del suolo e temperatura di ogni campo; segnala stress idrico e caldo in fioritura.';
  subscribes = ['reading'];

  #livelli = new Map(); // zona → id livello di umidità
  #caldo = new Map(); // zona → id livello di temperatura

  async onEvent(event, ctx) {
    const { readings, location } = event.data;
    const zona = location?.zone;
    const campo = CAMPI[zona];
    if (!campo) return;

    if (typeof readings.soil_moisture_pct === 'number') {
      const theta = ctx.state.average('soil_moisture_pct', { zone: zona });
      const prima = this.#livelli.get(zona);
      const lv = livelloConIsteresi(theta, prima);
      this.#livelli.set(zona, lv.id);
      if (this.cooldown('metriche', 3000)) this.#metriche(ctx);
      if (prima !== undefined && prima !== lv.id) this.#cambio(ctx, zona, campo, prima, lv, theta);
    }

    if (typeof readings.temperature_c === 'number') {
      const t = ctx.state.average('temperature_c', { zone: zona });
      const lv = livelloTemperatura(t);
      const prima = this.#caldo.get(zona);
      this.#caldo.set(zona, lv.id);
      if (lv.id === 'torrido' && prima && prima !== 'torrido' && /fioritura|allegagione/.test(campo.fase)) {
        ctx.decide(`${campo.nome}: ${fmt(t)} °C in ${campo.fase}`, {
          level: 'warning',
          actions: [{ type: 'allerta_caldo', zone: zona, label: `C${campo.n} caldo in ${campo.fase}` }],
          reasoning: `Sopra i 34-35 °C ${COLTURE[campo.coltura].breve} rischia di perdere fiori e frutti appena allegati (indicativo): meglio non far mancare l'acqua.`,
        });
      }
    }
  }

  #cambio(ctx, zona, campo, prima, lv, theta) {
    const testo = `${campo.nome} (${COLTURE[campo.coltura].breve}): umidità del suolo ${fmt(theta)} %, ${lv.label.toLowerCase()}`;
    const level = lv.id === 'stress' ? 'warning' : lv.id === 'ottimale' && (prima === 'stress' || prima === 'asciutto') ? 'good' : 'info';
    ctx.decide(testo, {
      level,
      actions: [{ type: 'livello_umidita', zone: zona, label: `C${campo.n} ${lv.label.toLowerCase()}` }],
      reasoning: `Da "${prima}" a "${lv.id}" (soglie: stress < 18 %, asciutto < 24 %, saturo ≥ 34 %).`,
    });
    ctx.send('orchestrator', testo, { tipo: 'stato_campo', zona, livello: lv.id, prima, theta: r1(theta) });
  }

  #metriche(ctx) {
    const valori = Object.keys(CAMPI)
      .map((z) => ctx.state.average('soil_moisture_pct', { zone: z }))
      .filter((v) => typeof v === 'number');
    if (!valori.length) return;
    ctx.metric('campi_in_stress', [...this.#livelli.values()].filter((l) => l === 'stress').length, `su ${Object.keys(CAMPI).length}`, {
      label: 'Campi in stress idrico',
    });
    ctx.metric('umidita_media', r1(valori.reduce((s, v) => s + v, 0) / valori.length), '%', { label: 'Umidità media del suolo' });
  }
}

const r1 = (v) => Math.round(v * 10) / 10;
