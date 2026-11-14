// Agente "meteo": previsione per domani (evapotraspirazione di riferimento ET0 e pioggia)
// per le coordinate dei campi, da Open-Meteo (https://open-meteo.com, CC BY 4.0, senza chiave).
// Isomorfo: usa `fetch`, che c'è in Node ≥ 18 e nel browser (Open-Meteo consente CORS).
//
// Quale previsione usa il consorzio (campo `fonte`, sempre DICHIARATA):
// - "open-meteo": la previsione reale, se la data reale è nella stagione irrigua (aprile-settembre)
//   oppure se è attivo lo scenario `meteo_reale` (pulsante "Previsione reale");
// - "simulata": una previsione tipica di luglio (indicativa) quando Open-Meteo non risponde, dà
//   429 o un errore, oppure fuori stagione (la giornata simulata della demo è estiva: una
//   previsione reale di novembre non avrebbe senso per il pomodoro in campo). Anche in questo
//   caso i valori reali, se arrivati, sono mostrati accanto (`reale`).
// Gli scenari modificano la previsione: `ondata_calore` (ET0 ×1,35, +6 °C), `pioggia_in_arrivo`
// (pioggia di domani ≥ params.mm, predefinito 18 mm).

import { Agent } from '../../../src/agent.js';
import { COORDINATE } from '../campi.js';

/** Previsione simulata: giornata tipo di metà luglio nella piana del Sarno (valori indicativi). */
export const PREVISIONE_SIMULATA = Object.freeze({
  et0Oggi: 5.6,
  et0Domani: 5.8,
  pioggiaDomani: 0,
  probPioggiaDomani: 5,
  tmaxDomani: 32,
});

const URL_OPEN_METEO = 'https://api.open-meteo.com/v1/forecast';

export class MeteoAgent extends Agent {
  name = 'meteo';
  description = 'Previsione di domani (ET0 e pioggia) da Open-Meteo; previsione simulata dichiarata se non disponibile.';
  subscribes = ['scenario'];

  #fetch;
  #rete;
  #timeoutMs;
  #aggiornaMs;
  #oraReale;
  #stagione;
  #reale = null; // ultima previsione Open-Meteo valida
  #errore = null; // perché non c'è (o non si usa) la previsione reale
  #scenari = new Map(); // scenari attivi che cambiano la previsione
  #ultima = null; // firma dell'ultima previsione inviata

  /**
   * @param {{fetch?: Function, rete?: boolean, timeoutMs?: number, aggiornaMs?: number,
   *          oraReale?: () => number, stagioneIrrigua?: [number, number]}} [opts]
   */
  constructor(opts = {}) {
    super();
    this.#fetch = opts.fetch ?? (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
    this.#rete = opts.rete !== false;
    this.#timeoutMs = opts.timeoutMs ?? 8000;
    this.#aggiornaMs = opts.aggiornaMs ?? 30 * 60_000;
    this.#oraReale = opts.oraReale ?? (() => Date.now());
    this.#stagione = opts.stagioneIrrigua ?? [4, 9];
  }

  async onStart(ctx) {
    this.#errore = this.#rete ? 'in attesa di Open-Meteo' : 'rete disattivata';
    this.#pubblica(ctx); // subito una previsione (simulata), così il consorzio può già pianificare
    if (!this.#rete) return;
    // non si aspetta la risposta: la pagina in demo non deve restare ferma se la rete è lenta
    this.aggiorna(ctx).catch(() => {});
    ctx.every(this.#aggiornaMs, (c) => this.aggiorna(c));
  }

  async onEvent(event, ctx) {
    const { name, params, active } = event.data;
    if (!['ondata_calore', 'pioggia_in_arrivo', 'meteo_reale'].includes(name)) return;
    if (active === false) this.#scenari.delete(name);
    else this.#scenari.set(name, params || {});
    this.#pubblica(ctx);
  }

  /** Scarica la previsione da Open-Meteo e la ripubblica (anche se fallisce: con la simulata). */
  async aggiorna(ctx) {
    this.#reale = (await this.#scarica()) ?? this.#reale;
    this.#pubblica(ctx);
  }

  async #scarica() {
    if (!this.#fetch) {
      this.#errore = 'fetch non disponibile';
      return null;
    }
    const q = new URLSearchParams({
      latitude: COORDINATE.lat,
      longitude: COORDINATE.lon,
      daily: 'et0_fao_evapotranspiration,precipitation_sum,precipitation_probability_max,temperature_2m_max',
      timezone: 'Europe/Rome',
      forecast_days: '2',
    });
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = setTimeout(() => ctrl?.abort(), this.#timeoutMs);
    try {
      const res = await this.#fetch(`${URL_OPEN_METEO}?${q}`, { signal: ctrl?.signal });
      if (res.status === 429) throw new Error('Open-Meteo: troppe richieste (429)');
      if (!res.ok) throw new Error(`Open-Meteo: errore HTTP ${res.status}`);
      const d = (await res.json())?.daily;
      const num = (a, i) => (Array.isArray(a) && typeof a[i] === 'number' ? a[i] : null);
      const reale = {
        data: d?.time?.[1] ?? null,
        et0Oggi: num(d?.et0_fao_evapotranspiration, 0),
        et0Domani: num(d?.et0_fao_evapotranspiration, 1),
        pioggiaDomani: num(d?.precipitation_sum, 1),
        probPioggiaDomani: num(d?.precipitation_probability_max, 1),
        tmaxDomani: num(d?.temperature_2m_max, 1),
        ricevuta: this.#oraReale(),
      };
      if (reale.et0Domani === null || reale.pioggiaDomani === null) throw new Error('Open-Meteo: risposta senza ET0 o pioggia');
      this.#errore = null;
      return reale;
    } catch (err) {
      const m = String(err?.message || err);
      this.#errore = err?.name === 'AbortError' ? 'Open-Meteo non risponde (timeout)' : m.startsWith('Open-Meteo') ? m : `Open-Meteo non raggiungibile (${m})`;
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /** La previsione che il consorzio deve usare adesso. */
  previsione() {
    const mese = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', month: 'numeric' }).format(this.#oraReale()));
    const inStagione = mese >= this.#stagione[0] && mese <= this.#stagione[1];
    const chiesta = this.#scenari.has('meteo_reale');
    let p;
    if (this.#reale && (inStagione || chiesta)) {
      p = {
        fonte: 'open-meteo',
        motivo: inStagione ? 'previsione reale' : 'previsione reale di oggi, chiesta con il pulsante (fuori stagione irrigua)',
        ...pick(this.#reale),
      };
    } else {
      p = {
        fonte: 'simulata',
        motivo: this.#reale ? 'fuori stagione irrigua: la giornata simulata è di luglio' : this.#errore || 'Open-Meteo non disponibile',
        ...PREVISIONE_SIMULATA,
      };
      if (chiesta && !this.#reale) p.motivo = `previsione reale chiesta ma ${this.#errore || 'non disponibile'}`;
    }
    const modifiche = [];
    if (this.#scenari.has('ondata_calore')) {
      p.et0Domani = r1(p.et0Domani * 1.35);
      if (p.tmaxDomani != null) p.tmaxDomani = r1(p.tmaxDomani + 6);
      modifiche.push('ondata di calore');
    }
    if (this.#scenari.has('pioggia_in_arrivo')) {
      const mm = Number(this.#scenari.get('pioggia_in_arrivo').mm) || 18;
      p.pioggiaDomani = Math.max(p.pioggiaDomani ?? 0, mm);
      p.probPioggiaDomani = 90;
      p.et0Domani = r1(p.et0Domani * 0.6);
      modifiche.push('pioggia in arrivo');
    }
    return { ...p, modifiche, reale: this.#reale, coordinate: COORDINATE };
  }

  #pubblica(ctx) {
    const p = this.previsione();
    const firma = JSON.stringify([p.fonte, p.motivo, p.et0Domani, p.pioggiaDomani, p.modifiche, p.reale?.ricevuta]);
    if (firma === this.#ultima) return;
    this.#ultima = firma;
    const fonte = p.fonte === 'open-meteo' ? 'Open-Meteo (reale)' : `simulata: ${p.motivo}`;
    const reale = p.fonte !== 'open-meteo' && p.reale ? ` · Open-Meteo per domani: ET0 ${fmt(p.reale.et0Domani)} mm, pioggia ${fmt(p.reale.pioggiaDomani)} mm` : '';
    const testo = `Previsione per domani: ET0 ${fmt(p.et0Domani)} mm, pioggia ${fmt(p.pioggiaDomani)} mm`;
    ctx.metric('et0_domani', p.et0Domani, 'mm', { label: 'ET0 domani' });
    ctx.metric('pioggia_domani', p.pioggiaDomani, 'mm', { label: 'Pioggia prevista domani' });
    ctx.decide(`${testo}${p.modifiche.length ? ` (${p.modifiche.join(', ')})` : ''}`, {
      level: p.pioggiaDomani >= 2 ? 'info' : p.et0Domani >= 7 ? 'warning' : 'info',
      actions: [{ type: 'previsione', label: p.fonte === 'open-meteo' ? 'fonte: Open-Meteo' : 'fonte: simulata' }],
      reasoning: `Fonte: ${fonte}${reale}.`,
    });
    ctx.send('orchestrator', testo, { tipo: 'previsione', previsione: p });
  }
}

function pick(r) {
  return {
    et0Oggi: r.et0Oggi,
    et0Domani: r.et0Domani,
    pioggiaDomani: r.pioggiaDomani,
    probPioggiaDomani: r.probPioggiaDomani,
    tmaxDomani: r.tmaxDomani,
    data: r.data,
  };
}

const r1 = (v) => Math.round(v * 10) / 10;
const fmt = (v) => (typeof v === 'number' ? new Intl.NumberFormat('it-IT', { maximumFractionDigits: 1 }).format(v) : 'n/d');
