// Agente produzione/meteo: legge la luce dei tetti (ESP32), la converte in kW e prevede
// la produzione del resto della giornata.
//
// Previsione = sole a cielo sereno (modello astronomico) × fattore nuvole.
// - Fattore nuvole dalla copertura oraria di Open-Meteo, se raggiungibile; altrimenti
//   "previsione simulata" (cielo sereno), dichiarata come tale in dashboard e nei messaggi.
// - Correzione "nowcast" con i sensori: il rapporto misurato/sereno degli ultimi minuti pesa
//   molto sulle prossime ore e sfuma verso la previsione più avanti (costante 1,5 h).
// Quando il rapporto crolla (nuvola) o risale (sereno) avvisa subito l'agente comunità.

import { Agent } from '../../shared/iot-agents/src/agent.js';
import { hourOf } from '../../shared/iot-agents/sim/sim-core.js';
import { CER, TETTI } from '../model/quartiere.js';
import { N_SLOT, oraDiSlot, GIORNO, giornataSolare, kwSereno, fattoreNuvole, hhmm } from '../model/energia.js';
import { letturaTetti } from '../model/tetti.js';

const SOGLIA_NUVOLA = 0.6; // sotto il 60% del sereno: nuvola
const SOGLIA_SERENO = 0.85; // sopra l'85%: di nuovo sereno (isteresi)
const OPEN_METEO =
  'https://api.open-meteo.com/v1/forecast?hourly=cloud_cover,temperature_2m&timezone=Europe%2FRome&forecast_days=1';

export class ProduzioneAgent extends Agent {
  name = 'produzione';
  description = 'Luce dei tetti → kW prodotti; previsione di irraggiamento (Open-Meteo o simulata) corretta con i sensori.';
  subscribes = ['reading', 'agent.message'];

  /**
   * @param {{previsione?: 'auto'|'open-meteo'|'simulata', fetch?: Function, luxGain?: object, timeoutMs?: number}} [opts]
   */
  constructor(opts = {}) {
    super();
    this.modo = opts.previsione || 'auto';
    this.fetch = opts.fetch ?? (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
    this.luxGain = opts.luxGain || {};
    this.timeoutMs = opts.timeoutMs ?? 5000;
    this.meteo = { fonte: 'simulata', nota: 'in attesa di Open-Meteo' };
    this.rapporto = 1;
    this.cielo = 'sereno';
    this.ultimaPrevisioneH = -Infinity;
    this.rapportoInviato = 1;
    this.ultimaH = null;
  }

  async onStart(ctx) {
    if (this.modo === 'simulata' || !this.fetch) {
      this.meteo = { fonte: 'simulata', nota: 'cielo sereno previsto (dato simulato, dichiarato)' };
      return;
    }
    // non blocca l'avvio del hub: la previsione arriva quando arriva
    this.#caricaOpenMeteo(ctx);
  }

  async #caricaOpenMeteo(ctx) {
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    const t = setTimeout(() => ctrl?.abort(), this.timeoutMs);
    try {
      const url = `${OPEN_METEO}&latitude=${CER.lat}&longitude=${CER.lon}`;
      const res = await this.fetch(url, ctrl ? { signal: ctrl.signal } : {});
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      const cop = j?.hourly?.cloud_cover;
      if (!Array.isArray(cop) || cop.length < 24) throw new Error('risposta senza cloud_cover orario');
      const centrali = cop.slice(10, 15);
      const media = Math.round(centrali.reduce((a, b) => a + b, 0) / centrali.length);
      this.meteo = {
        fonte: 'open-meteo',
        copertura: cop.slice(0, 24),
        temperatura: j.hourly.temperature_2m?.slice(0, 24) ?? null,
        giorno: j.hourly.time?.[0]?.slice(0, 10) ?? null,
        nota: `Open-Meteo per Napoli: copertura nuvolosa media ${media}% tra le 10 e le 15`,
      };
      ctx.decide(`Previsione meteo caricata da Open-Meteo (${this.meteo.giorno ?? 'oggi'})`, {
        level: 'info',
        reasoning: `${this.meteo.nota}. La previsione si corregge con la luce misurata dai sensori sui tetti.`,
      });
    } catch (err) {
      this.meteo = { fonte: 'simulata', nota: `Open-Meteo non raggiungibile (${err.name === 'AbortError' ? 'timeout' : err.message}): cielo sereno simulato` };
      if (this.modo === 'open-meteo') ctx.log.warn(this.meteo.nota);
      ctx.decide('Previsione meteo simulata', {
        level: 'info',
        reasoning: `${this.meteo.nota}. Lo dichiariamo in dashboard; i sensori correggono comunque la previsione.`,
      });
    } finally {
      clearTimeout(t);
      this.ultimaPrevisioneH = -Infinity; // manda subito la nuova previsione
    }
  }

  async onEvent(event, ctx) {
    if (event.type === 'agent.message') {
      if (event.data.payload?.tipo === 'nuovo_giorno') {
        this.rapporto = 1;
        this.cielo = 'sereno';
        this.ultimaPrevisioneH = -Infinity;
      }
      return;
    }
    const { readings } = event.data;
    if (typeof readings.light_lux !== 'number') return;

    const simNow = ctx.simTime();
    const h = hourOf(simNow);
    if (this.ultimaH !== null && h < this.ultimaH - 1) this.ultimaPrevisioneH = -Infinity; // giornata ricominciata
    this.ultimaH = h;

    const tetti = letturaTetti(ctx.state, { luxGain: this.luxGain });
    const totale = tetti.reduce((a, t) => a + t.kw, 0);
    const sole = giornataSolare(simNow);
    const sereno = tetti.filter((t) => t.deviceId).reduce((a, t) => a + kwSereno(h, sole, t.kWp), 0);
    if (sereno > 1) {
      const r = Math.min(1.3, totale / sereno);
      this.rapporto = 0.5 * this.rapporto + 0.5 * r;
    }
    if (this.cooldown('metrica', 2000)) {
      ctx.metric('produzione_kw', round(totale), 'kW', { label: 'Produzione FV della CER' });
      ctx.metric('rapporto_sereno_pct', Math.round(this.rapporto * 100), '%', { label: 'Sole misurato / sereno' });
    }

    let motivo = null;
    if (this.cielo === 'sereno' && sereno > 1 && this.rapporto < SOGLIA_NUVOLA) {
      this.cielo = 'nuvola';
      motivo = 'nuvola';
      const coinvolti = tetti.filter((t) => t.lux !== null && t.kw < 0.6 * kwSereno(h, sole, t.kWp)).map((t) => t.nome);
      ctx.decide(`Nuvola sul quartiere alle ${hhmm(h)}: produzione al ${Math.round(this.rapporto * 100)}% del sereno`, {
        level: 'warning',
        actions: [{ type: 'previsione', to: 'orchestrator' }],
        reasoning: `Misurati ${num(totale)} kW contro ${num(sereno)} kW attesi a cielo sereno (${coinvolti.join(', ') || 'tutti i tetti'}). Abbasso la previsione delle prossime ore e avviso l'agente comunità.`,
      });
    } else if (this.cielo === 'nuvola' && this.rapporto > SOGLIA_SERENO) {
      this.cielo = 'sereno';
      motivo = 'sereno';
      ctx.decide(`Torna il sole alle ${hhmm(h)}: produzione al ${Math.round(this.rapporto * 100)}% del sereno`, {
        level: 'good',
        actions: [{ type: 'previsione', to: 'orchestrator' }],
        reasoning: 'La luce sui tetti è tornata vicina al valore atteso: rialzo la previsione.',
      });
    } else if (this.cielo === 'nuvola' && Math.abs(this.rapporto - this.rapportoInviato) > 0.15) {
      motivo = 'nuvola'; // la nuvola si è fatta più (o meno) fitta: aggiorno la previsione
    } else if (h - this.ultimaPrevisioneH >= 1) {
      motivo = this.ultimaPrevisioneH === -Infinity ? 'inizio' : 'periodico';
    }
    if (!motivo) return;
    this.ultimaPrevisioneH = h;
    this.rapportoInviato = this.rapporto;
    const kw = this.previsione(h, sole, tetti);
    const picco = kw.indexOf(Math.max(...kw));
    ctx.send('orchestrator', `Previsione FV (${motivo}): picco ${num(kw[picco])} kW alle ${hhmm(oraDiSlot(picco))}`, {
      tipo: 'previsione',
      motivo,
      kw,
      fonte: this.meteo.fonte,
      nota: this.meteo.nota,
      rapporto: round(this.rapporto),
      cielo: this.cielo,
      ora: round(h),
      sole: { alba: round(sole.alba), tramonto: round(sole.tramonto) },
    });
  }

  /** kW previsti per ogni quarto d'ora della giornata. */
  previsione(h, sole = giornataSolare(Date.now()), tetti = TETTI) {
    const kWp = tetti.reduce((a, t) => a + t.kWp, 0);
    const out = [];
    for (let s = 0; s < N_SLOT; s++) {
      const hs = oraDiSlot(s) + GIORNO.passo / 2;
      const cs = kwSereno(hs, sole, kWp);
      const fPrev = this.meteo.fonte === 'open-meteo' ? fattoreNuvole(coperturaA(this.meteo.copertura, hs)) : 1;
      const w = Math.exp(-Math.max(0, hs - h) / 1.5);
      out.push(round(cs * (w * this.rapporto + (1 - w) * fPrev)));
    }
    return out;
  }
}

const round = (x) => Math.round(x * 100) / 100;
const num = (x) => new Intl.NumberFormat('it-IT', { maximumFractionDigits: 1 }).format(x);

/** Copertura nuvolosa all'ora decimale `h`, interpolata tra i valori orari di Open-Meteo. */
function coperturaA(cop, h) {
  const a = Math.max(0, Math.min(23, Math.floor(h - 0.5)));
  const b = Math.min(23, a + 1);
  const f = Math.max(0, Math.min(1, h - 0.5 - a));
  return (cop[a] ?? 0) * (1 - f) + (cop[b] ?? 0) * f;
}
