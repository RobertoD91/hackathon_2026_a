// Agente casa: uno per famiglia. Conosce i carichi spostabili, le abitudini e le preferenze
// della famiglia; risponde alle proposte dell'agente comunità e parla con la famiglia su
// WhatsApp (canale `whatsapp` del contratto: il ponte è OpenClaw).
//
// Le persone vere a volte dicono di no: l'accettazione è simulata con la propensione
// `adesione` della famiglia (pseudo-casuale ma deterministica: stessa giornata, stesse risposte).

import { Agent } from '../../shared/iot-agents/src/agent.js';
import { hourOf, formatClock } from '../../shared/iot-agents/sim/sim-core.js';
import { CARICHI, destinatario, tettoDellaScala } from '../model/quartiere.js';
import { richiesta, hhmm, estremi, GIORNO } from '../model/energia.js';

const SYSTEM = `Sei l'assistente di una comunità energetica di quartiere a Napoli e scrivi su WhatsApp
a una famiglia. Tono cordiale e concreto, italiano semplice, al massimo 3 frasi o un breve elenco.
Non inventare numeri, orari o fatti: usa solo quelli del messaggio di partenza.`;

export class CasaAgent extends Agent {
  subscribes = ['agent.message', 'scenario'];

  /** @param {object} famiglia  elemento di FAMIGLIE (model/quartiere.js) */
  constructor(famiglia) {
    super();
    this.f = famiglia;
    this.name = `casa-${famiglia.id}`;
    this.description = `Agente della famiglia ${famiglia.nome} (scala ${famiglia.scala}): carichi, preferenze, avvisi.`;
    this.giorno = 0;
    this.carichi = new Map(); // id → { req, stato, profilo, ricordato, versione }
    this.extra = []; // carichi nati dagli scenari (auto in carica, pre-raffrescamento)
  }

  get to() {
    return destinatario(this.f.id);
  }

  async onStart(ctx) {
    ctx.every(1000, (c) => this.#promemoria(c));
  }

  async onEvent(event, ctx) {
    if (event.type === 'scenario') return this.#scenario(event, ctx);
    const p = event.data.payload || {};
    if (p.tipo === 'nuovo_giorno') return this.#nuovoGiorno(p, ctx);
    if (p.tipo === 'proposta' && p.famiglia === this.f.id) return this.#proposta(p, ctx);
  }

  // ---------------------------------------------------------------- giornata

  #nuovoGiorno(p, ctx) {
    this.giorno = p.giorno ?? this.giorno + 1;
    this.carichi.clear();
    this.extra = [];
    const reqs = this.f.carichi.map((c) => richiesta(this.f, c));
    if (this.f.clima === 'split' && ctx.state.isActive('ondata_calore')) reqs.push(this.#raffrescamento(GIORNO.inizio));
    this.#invia(reqs, ctx, 'Carichi di oggi');
  }

  #invia(reqs, ctx, titolo) {
    for (const r of reqs) this.carichi.set(r.id, { req: r, stato: 'abitudine', profilo: null, ricordato: false, versione: 0 });
    ctx.send('orchestrator', `${titolo}: ${reqs.map((r) => `${r.nome.toLowerCase()} (di solito alle ${hhmm(r.abitudine)})`).join(', ')}`, {
      tipo: 'richieste',
      famiglia: this.f.id,
      richieste: reqs,
    });
  }

  #raffrescamento(h) {
    return richiesta(this.f, { tipo: 'raffrescamento', abitudine: 18, finestra: [Math.max(11, h), 20], automatico: true });
  }

  #scenario(event, ctx) {
    const { name, params = {}, active } = event.data;
    if (active === false) return;
    const h = hourOf(ctx.simTime());
    if (name === 'auto_elettrica' && (params.famiglia || 'sorrentino') === this.f.id) {
      const id = `auto-${Math.round(h * 100)}`;
      if (h >= 23) return;
      const entro = Math.min(24, Math.max(h + 4, Number(params.entro) || 19));
      const r = richiesta(this.f, {
        id,
        tipo: 'auto',
        nome: 'Auto elettrica',
        kwh: Number(params.kwh) || 10,
        abitudine: h,
        finestra: [h, entro],
        automatico: true,
      });
      this.#invia([r], ctx, `Attaccata ora un'auto elettrica (${r.kwh} kWh, pronta entro le ${hhmm(entro)})`);
    }
    if (name === 'ondata_calore' && this.f.clima === 'split' && h < 17 && ![...this.carichi.values()].some((c) => c.req.tipo === 'raffrescamento')) {
      this.#invia([this.#raffrescamento(h)], ctx, 'Ondata di calore: posso rinfrescare casa in anticipo');
    }
  }

  // ---------------------------------------------------------------- proposte

  /** La famiglia accetta? Deterministico per giornata e carico. */
  accetta(id) {
    return rand(`${this.giorno}:${id}`) < (this.f.adesione ?? 0.85);
  }

  async #proposta(p, ctx) {
    const accettate = [];
    const rifiutate = [];
    const nuove = [];
    const cambi = [];
    for (const c of p.carichi) {
      const mio = this.carichi.get(c.id);
      if (!mio) continue;
      const giaAccettato = mio.stato === 'accettato';
      const e = estremi(c.profilo);
      const dentro = e && e.inizio >= mio.req.finestra[0] - 1e-6 && e.fine <= mio.req.finestra[1] + 1e-6;
      if (mio.stato === 'rifiutato' || !dentro || (!giaAccettato && !this.accetta(c.id))) {
        mio.stato = 'rifiutato';
        rifiutate.push({ id: c.id, motivo: dentro ? this.f.motivoRifiuto : 'fuori dagli orari che ci vanno bene' });
        continue;
      }
      const prima = mio.profilo;
      mio.stato = 'accettato';
      mio.profilo = c.profilo;
      mio.versione = p.versione;
      mio.ricordato = false;
      accettate.push(c.id);
      (giaAccettato ? cambi : nuove).push({ c, req: mio.req, prima });
    }
    // prima il messaggio alla famiglia, poi la risposta all'agente comunità
    if (nuove.length || cambi.length) await this.#scrivi(p, nuove, cambi, ctx);
    ctx.send(
      'orchestrator',
      `Famiglia ${this.f.nome}: ${accettate.length} sì${rifiutate.length ? `, ${rifiutate.length} no` : ''}`,
      { tipo: 'risposta', famiglia: this.f.id, versione: p.versione, accettate, rifiutate },
    );
  }

  async #scrivi(p, nuove, cambi, ctx) {
    const h = hourOf(ctx.simTime());
    const tetto = p.tetto?.frase || tettoDellaScala(this.f.scala).frase;
    const righe = [...nuove, ...cambi].map(({ c, req }) => `• ${descrivi(req, c.profilo)}`);
    let base;
    if (cambi.length && !nuove.length) {
      const perche = p.motivo === 'meteo' ? 'il meteo è cambiato sopra i tetti' : 'abbiamo trovato un orario con più sole';
      base = `Cambio di programma, ${perche}:\n${righe.join('\n')}`;
    } else {
      const saluto = h < 12 ? 'Buongiorno' : h < 18 ? 'Buon pomeriggio' : 'Buonasera';
      const sole = p.finestraSole ? ` tra le ${hhmm(p.finestraSole[0])} e le ${hhmm(p.finestraSole[1])}` : '';
      const euro = p.stimaEuro > 0.005 ? ` (circa ${euro2(p.stimaEuro)} € di incentivo per la CER)` : '';
      const vantaggio =
        p.guadagnoKwh >= 0.3
          ? `Così il quartiere usa ${num(p.guadagnoKwh)} kWh di sole in più${euro}.`
          : `Il sole di oggi è già quasi tutto prenotato, ma così risparmiate circa ${euro2(Math.max(0, p.stimaBollettaEuro || 0))} € in bolletta.`;
      base =
        `${saluto} famiglia ${this.f.nome}! ${p.finestraSole ? `Oggi c'è sole ${tetto}${sole}.` : 'Oggi il sole sui tetti è poco.'} Il programma che vi propone la CER:\n` +
        `${righe.join('\n')}\n${vantaggio}` +
        (nuove.some(({ req }) => !req.automatico) ? ' Vi ricordo un\'ora prima.' : '');
    }
    const { text } = await ctx.llm.complete({
      system: SYSTEM,
      prompt: `Riscrivi questo messaggio WhatsApp senza cambiare orari e numeri:\n${base}`,
      fallback: base,
    });
    ctx.notify('whatsapp', this.to, text, { famiglia: this.f.id, ora: formatClock(ctx.simTime()), tipo: 'programma' });
  }

  /** Promemoria un'ora prima dei carichi da avviare a mano (lavatrice, lavastoviglie...). */
  async #promemoria(ctx) {
    if (!this.carichi.size) return;
    const h = hourOf(ctx.simTime());
    for (const mio of this.carichi.values()) {
      if (mio.stato !== 'accettato' || mio.ricordato || mio.req.automatico || mio.req.divisibile) continue;
      const e = estremi(mio.profilo);
      if (!e) continue;
      const manca = e.inizio - h;
      if (manca > 1.05 || manca < 0.05) continue;
      mio.ricordato = true;
      const tetto = tettoDellaScala(this.f.scala).frase;
      const quando = manca > 0.6 ? "tra un'ora" : 'tra poco';
      const verbo = CARICHI[mio.req.tipo]?.verbo || `avvia ${mio.req.nome.toLowerCase()}`;
      const base = `${cap(verbo)} alle ${hhmm(e.inizio)}: ${quando} c'è sole ${tetto}.`;
      const { text } = await ctx.llm.complete({ system: SYSTEM, prompt: `Riscrivi questo promemoria senza cambiare l'orario:\n${base}`, fallback: base });
      ctx.notify('whatsapp', this.to, text, { famiglia: this.f.id, ora: formatClock(ctx.simTime()), tipo: 'promemoria' });
    }
  }
}

/** "lavatrice alle 12:30 (di solito alle 19:30)", "auto elettrica tra le 10:45 e le 14:30 (...)". */
export function descrivi(req, profilo) {
  const e = estremi(profilo);
  if (!e) return req.nome.toLowerCase();
  const daSolo = req.automatico ? CARICHI[req.tipo]?.daSolo : null;
  if (req.divisibile) {
    return `${req.nome.toLowerCase()} tra le ${hhmm(e.inizio)} e le ${hhmm(e.fine)}${daSolo ? ` (${daSolo})` : ''}`;
  }
  return `${req.nome.toLowerCase()} alle ${hhmm(e.inizio)} (di solito alle ${hhmm(req.abitudine)}${daSolo ? `; ${daSolo}` : ''})`;
}

function rand(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const num = (x) => new Intl.NumberFormat('it-IT', { maximumFractionDigits: 1 }).format(x);
const euro2 = (x) => new Intl.NumberFormat('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(x);
