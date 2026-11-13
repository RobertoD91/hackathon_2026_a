// Agente comunità (orchestratore della CER, `name = 'orchestrator'`).
//
// - Raccoglie i carichi spostabili dagli agenti casa e la previsione dall'agente produzione.
// - Pianifica con l'ottimizzatore (model/ottimizzatore.js) per massimizzare l'energia condivisa,
//   servendo le famiglie a turno in ordine di equità, e manda le proposte agli agenti casa.
// - Ripianifica quando cambia il meteo (nuvola, sereno), quando arriva un carico nuovo
//   (auto in carica, ondata di calore) e ogni ora simulata.
// - Tiene il bilancio "con agenti" e "senza agenti" sulla stessa giornata (model/bilancio.js)
//   e pubblica ogni secondo l'evento `cer.stato` per la dashboard, più le metriche standard.
// - Risponde alla chat (dashboard e WhatsApp via OpenClaw) con regole; l'LLM, se c'è, riformula.

import { Agent } from '../../shared/iot-agents/src/agent.js';
import { hourOf, formatClock } from '../../shared/iot-agents/sim/sim-core.js';
import { CER, TETTI, FAMIGLIE, CARICHI, destinatario, tettoDellaScala } from '../model/quartiere.js';
import {
  N_SLOT, GIORNO, slotDi, slotDa, oraDiSlot, vuoto, hhmm, giornataSolare,
  consumoBaseKw, climaKw, profiloAbitudine, estremi, fasce, energia, richiesta,
} from '../model/energia.js';
import { pianifica, kwhAlSole, costo } from '../model/ottimizzatore.js';
import { Bilancio } from '../model/bilancio.js';
import { letturaTetti, temperaturaScala } from '../model/tetti.js';
import { euroPerKwhCondiviso, PARAMETRI } from '../model/parametri.js';

const SYSTEM = `Sei l'agente della comunità energetica rinnovabile "${CER.nome}" (${CER.luogo}).
Rispondi in italiano, chiaro e cordiale, al massimo 3 frasi. Usa SOLO i dati forniti: niente numeri inventati.`;

export class ComunitaAgent extends Agent {
  name = 'orchestrator';
  description = 'Agente comunità: massimizza l\'energia condivisa della CER coordinando gli agenti casa, in modo equo.';
  subscribes = ['agent.message', 'scenario'];

  /** @param {{tickMs?: number, luxGain?: object, famiglie?: object[]}} [opts] */
  constructor(opts = {}) {
    super();
    this.tickMs = opts.tickMs ?? 1000;
    this.luxGain = opts.luxGain || {};
    this.famiglie = opts.famiglie || FAMIGLIE;
    this.bilancio = new Bilancio({ famiglie: this.famiglie });
    this.giorno = 0;
    this.ultimoSim = null;
    this.ultimaH = null;
    this.carichi = new Map(); // id → { req, stato, profiloCon, profiloSenza, versione, kwhSole, guadagnoKwh, motivo }
    this.previsione = null;
    this.daPianificare = null;
    this.ultimoPianoH = -Infinity;
    this.versioni = new Map();
    this.riepilogoInviato = false;
    this.tick = 0;
    this.piano = { versione: 0, ora: null, spostati: 0, guadagnoKwh: 0, motivo: null };
    this.serieOre = [];
  }

  async onStart(ctx) {
    ctx.every(this.tickMs, (c) => this.passo(c));
  }

  // ================================================================ ciclo

  passo(ctx) {
    if (!ctx.state.devices().length) return;
    const simNow = ctx.simTime();
    const h = hourOf(simNow);
    if (this.ultimaH === null || h < this.ultimaH - 1) this.#nuovoGiorno(ctx, h);

    const tetti = letturaTetti(ctx.state, { luxGain: this.luxGain });
    const prodKw = tetti.reduce((a, t) => a + t.kw, 0);
    const consumi = this.consumi(h, tetti);
    const dtH = (simNow - this.ultimoSim) / 3_600_000;
    if (dtH > 0 && dtH < 0.5) this.bilancio.aggiungi({ h: this.ultimaH, dtH, prodKw, consumi: { con: consumi.con, senza: consumi.senza } });
    this.ultimoSim = simNow;
    this.ultimaH = h;

    if (this.previsione && this.carichi.size) {
      if (this.daPianificare) this.#pianifica(ctx, h, this.daPianificare);
      else if (h - this.ultimoPianoH >= 1) this.#pianifica(ctx, h, 'periodico');
    }
    if (h >= 21 && !this.riepilogoInviato) this.#riepilogo(ctx, h);

    this.tick++;
    ctx.publish('cer.stato', this.stato(ctx, h, simNow, tetti, consumi, prodKw));
    if (this.tick % 3 === 0) this.#metriche(ctx);
  }

  #nuovoGiorno(ctx, h) {
    this.giorno++;
    this.bilancio.reset();
    this.carichi.clear();
    this.versioni.clear();
    this.previsione = null;
    this.daPianificare = 'iniziale';
    this.ultimoPianoH = -Infinity;
    this.riepilogoInviato = false;
    this.ultimoSim = null;
    this.piano = { versione: 0, ora: null, spostati: 0, guadagnoKwh: 0, motivo: null };
    ctx.send('*', `Nuova giornata (${hhmm(h)}): agenti casa, mandatemi i carichi di oggi`, { tipo: 'nuovo_giorno', giorno: this.giorno });
  }

  /** kW consumati ora da ogni famiglia, con e senza agenti. */
  consumi(h, tetti) {
    const s = slotDi(h);
    const con = {};
    const senza = {};
    const fissi = {};
    for (const f of this.famiglie) {
      const t = temperaturaScala(tetti, f.scala);
      const base = consumoBaseKw(f, h) + climaKw(f, h, t ?? 15);
      fissi[f.id] = base;
      con[f.id] = base;
      senza[f.id] = base;
    }
    for (const c of this.carichi.values()) {
      con[c.req.famiglia] += c.profiloCon[s];
      senza[c.req.famiglia] += c.profiloSenza[s];
    }
    return { con, senza, fissi };
  }

  // ================================================================ messaggi

  async onEvent(event, ctx) {
    if (event.type === 'scenario') return this.#scenario(event, ctx);
    const p = event.data.payload || {};
    if (p.tipo === 'richieste') return this.#richieste(p, ctx);
    if (p.tipo === 'previsione') return this.#previsione(p, ctx);
    if (p.tipo === 'risposta') return this.#risposta(p, ctx);
  }

  #richieste(p, ctx) {
    let nuove = 0;
    for (const r of p.richieste || []) {
      if (this.carichi.has(r.id)) continue;
      const senza = profiloAbitudine(r);
      // un carico che partirebbe adesso (es. auto appena attaccata) aspetta il piano: la wallbox è in pausa
      const immediato = this.ultimaH !== null && r.abitudine <= this.ultimaH + GIORNO.passo;
      this.carichi.set(r.id, {
        req: r,
        stato: immediato ? 'in_attesa' : 'abitudine',
        profiloCon: immediato ? vuoto() : senza.slice(),
        profiloSenza: senza,
        versione: 0,
        kwhSole: 0,
        guadagnoKwh: 0,
      });
      nuove++;
    }
    if (nuove && this.daPianificare !== 'iniziale') this.daPianificare = 'nuovo carico';
  }

  #previsione(p, ctx) {
    const prima = this.previsione;
    this.previsione = { kw: p.kw, fonte: p.fonte, nota: p.nota, rapporto: p.rapporto, cielo: p.cielo, ora: p.ora, sole: p.sole };
    if (p.motivo === 'nuvola' || p.motivo === 'sereno') {
      this.daPianificare = 'meteo';
      if (p.motivo === 'nuvola' && this.cooldown(`nuvola:${this.giorno}`, 30_000)) {
        ctx.notify(
          'whatsapp',
          CER.gruppoWhatsapp,
          `Nuvola sopra il Rione alle ${hhmm(p.ora)}: i pannelli producono il ${Math.round(p.rapporto * 100)}% del solito. ` +
            'Chi aveva un elettrodomestico in programma riceve a breve il nuovo orario.',
          { ora: hhmm(p.ora), tipo: 'meteo' },
        );
      }
    } else if (!prima && !this.daPianificare) this.daPianificare = 'iniziale';
  }

  #risposta(p, ctx) {
    const h = this.ultimaH ?? GIORNO.inizio;
    const f = this.famiglie.find((x) => x.id === p.famiglia);
    for (const id of p.accettate || []) {
      const c = this.carichi.get(id);
      if (!c || !c.proposto) continue;
      c.stato = 'accettato';
      c.profiloCon = c.proposto;
      c.proposto = null;
    }
    for (const { id, motivo } of p.rifiutate || []) {
      const c = this.carichi.get(id);
      if (!c) continue;
      c.stato = 'rifiutato';
      c.motivo = motivo;
      c.proposto = null;
      // la famiglia fa come al solito (se l'ora solita è passata, parte adesso)
      const avviato = estremi(c.profiloCon);
      if (!avviato || avviato.inizio >= h) c.profiloCon = profiloAbitudine(c.req, { da: h });
      ctx.decide(`Famiglia ${f?.nome ?? p.famiglia}: ${c.req.nome.toLowerCase()} resta alle ${hhmm(Math.max(c.req.abitudine, h))}`, {
        level: 'info',
        reasoning: `Risposta della famiglia: «${motivo}». Rispetto la scelta e non lo ripropongo oggi; l'energia condivisa persa la recupero con gli altri carichi.`,
        actions: [{ type: 'rifiuto', to: `casa-${p.famiglia}` }],
      });
    }
  }

  #scenario(event, ctx) {
    const { name, params = {}, active } = event.data;
    const h = this.ultimaH ?? hourOf(ctx.simTime());
    if (active === false) {
      if (name === 'ondata_calore') ctx.decide('Ondata di calore finita', { level: 'good', reasoning: 'Le temperature sui tetti tornano nella norma.' });
      return;
    }
    if (name === 'nuvola') {
      ctx.decide('Scenario "nuvola" lanciato: aspetto che lo vedano i sensori', {
        level: 'info',
        reasoning: 'Non reagisco al pulsante ma ai dati: quando la luce sui tetti cala, l\'agente produzione me lo segnala e ripianifico.',
      });
    } else if (name === 'ondata_calore') {
      const fragili = this.famiglie.filter((f) => f.fragile);
      ctx.notify(
        'whatsapp',
        CER.gruppoWhatsapp,
        `Ondata di calore in arrivo: tenete le persiane chiuse nelle ore calde. Chi ha il climatizzatore può rinfrescare casa ` +
          `tra le 12 e le 16, quando i pannelli del Rione producono di più: è energia nostra. Bussiamo dai vicini anziani.`,
        { ora: hhmm(h), tipo: 'caldo' },
      );
      for (const f of fragili) {
        ctx.notify('whatsapp', destinatario(f.id), `Signora/Signor ${f.nome}, oggi fa molto caldo: beva spesso e tenga le persiane chiuse. Se serve qualcosa scriva qui, il referente della CER passa a trovarla.`, {
          famiglia: f.id,
          ora: hhmm(h),
          tipo: 'caldo',
        });
      }
      ctx.decide(`Ondata di calore: avviso il gruppo e ${fragili.length} famiglie fragili`, {
        level: 'warning',
        actions: [{ type: 'notify', to: CER.gruppoWhatsapp }, ...fragili.map((f) => ({ type: 'notify', to: destinatario(f.id) }))],
        reasoning: 'La temperatura fa salire i consumi dei climatizzatori: chiedo agli agenti casa con lo split di anticipare il raffrescamento nelle ore di sole.',
      });
    } else if (name === 'auto_elettrica') {
      const f = this.famiglie.find((x) => x.id === (params.famiglia || 'sorrentino'));
      ctx.decide(`Auto elettrica in carica dalla famiglia ${f?.nome ?? '?'}`, {
        level: 'info',
        reasoning: 'Senza coordinamento caricherebbe subito a piena potenza; aspetto la richiesta del suo agente casa per spalmarla sul sole libero.',
      });
    }
  }

  // ================================================================ pianificazione

  /** Sole libero previsto (kW per intervallo) togliendo i consumi fissi e i carichi già partiti. */
  surplus(h, tetti, esclusi = new Set()) {
    const out = vuoto();
    const temp = Object.fromEntries(this.famiglie.map((f) => [f.id, temperaturaScala(tetti, f.scala) ?? 15]));
    for (let s = 0; s < N_SLOT; s++) {
      const hs = oraDiSlot(s) + GIORNO.passo / 2;
      let cons = 0;
      for (const f of this.famiglie) cons += consumoBaseKw(f, hs) + climaKw(f, hs, temp[f.id]);
      out[s] = (this.previsione?.kw[s] ?? 0) - cons;
    }
    for (const [id, c] of this.carichi) {
      if (esclusi.has(id)) continue;
      for (let s = 0; s < N_SLOT; s++) out[s] -= c.profiloCon[s];
    }
    return out;
  }

  /** Ordine di equità: prima chi ha la copertura solare più bassa finora, a parità le famiglie fragili. */
  ordineFamiglie() {
    const k = this.bilancio.kpi('con').famiglie;
    const cop = (id) => (k[id]?.consumoKwh > 0 ? k[id].condivisaKwh / k[id].consumoKwh : 0);
    return [...this.famiglie]
      .sort((a, b) => {
        const d = cop(a.id) - cop(b.id);
        if (Math.abs(d) > 0.02) return d;
        return (b.fragile ? 1 : 0) - (a.fragile ? 1 : 0) || a.id.localeCompare(b.id);
      })
      .map((f) => f.id);
  }

  #pianifica(ctx, h, motivo) {
    this.daPianificare = null;
    this.ultimoPianoH = h;
    const primo = slotDa(h);
    const tetti = letturaTetti(ctx.state, { luxGain: this.luxGain });
    const candidati = new Map(); // id → richiesta per l'ottimizzatore
    for (const [id, c] of this.carichi) {
      if (c.stato === 'rifiutato' || c.proposto) continue;
      if (c.stato === 'in_attesa') {
        candidati.set(id, { ...c.req });
        continue;
      }
      const e = estremi(c.profiloCon);
      if (!e) continue;
      if (!c.req.divisibile) {
        if (e.inizio < oraDiSlot(primo)) continue; // già partito: non si tocca
        candidati.set(id, { ...c.req, attuale: c.stato === 'accettato' ? c.profiloCon : undefined });
      } else {
        const fatta = energia(c.profiloCon, 0, primo);
        const resta = c.req.kwh - fatta;
        if (resta < 0.1) continue;
        if (c.stato !== 'accettato' && e.inizio < oraDiSlot(primo)) continue; // abitudine già in corso
        const futuro = c.profiloCon.map((v, s) => (s >= primo ? v : 0));
        candidati.set(id, { ...c.req, kwh: resta, abitudine: Math.max(c.req.abitudine, oraDiSlot(primo)), attuale: c.stato === 'accettato' ? futuro : undefined, _passato: c.profiloCon.map((v, s) => (s < primo ? v : 0)) });
      }
    }
    if (!candidati.size) return;
    // il sole libero tiene conto di tutti i carichi tranne quelli da pianificare (per i divisibili resta la parte già fatta)
    const surplus = this.surplus(h, tetti, new Set(candidati.keys()));
    for (const r of candidati.values()) if (r._passato) for (let s = 0; s < N_SLOT; s++) surplus[s] -= r._passato[s];

    const { assegnazioni } = pianifica({ ora: h, surplus, richieste: [...candidati.values()], ordineFamiglie: this.ordineFamiglie() });

    const perFam = new Map();
    let guadagno = 0;
    for (const a of assegnazioni) {
      const c = this.carichi.get(a.id);
      const r = candidati.get(a.id);
      c.kwhSole = a.kwhSole;
      if (!a.cambia) {
        if (c.stato === 'in_attesa') {
          c.stato = 'abitudine'; // non conviene spostarlo: parte adesso, come farebbe da solo
          c.profiloCon = a.profilo;
        }
        continue;
      }
      const profilo = r._passato ? a.profilo.map((v, s) => v + r._passato[s]) : a.profilo;
      c.proposto = profilo;
      c.stato = c.stato === 'accettato' ? 'accettato' : 'proposto';
      c.guadagnoKwh = a.guadagnoKwh;
      guadagno += a.guadagnoKwh;
      if (!perFam.has(a.famiglia)) perFam.set(a.famiglia, []);
      perFam.get(a.famiglia).push({ a, c, profilo });
    }
    const spostati = [...perFam.values()].reduce((n, l) => n + l.length, 0);
    this.piano = { versione: this.piano.versione + 1, ora: h, spostati, guadagnoKwh: round2(guadagno), motivo };
    if (!spostati) {
      if (motivo === 'nuovo carico') {
        const nuovi = assegnazioni;
        ctx.decide(`Nuovo carico: lo lascio partire subito`, {
          level: 'info',
          reasoning: `Spostarlo non porterebbe almeno 0,3 kWh di sole in più né 0,15 € di risparmio: il sole libero di oggi è già prenotato dagli altri carichi (${nuovi.map((a) => `${a.tipo}: ${num(a.kwhSole)} kWh al sole`).join(', ') || 'nessun dettaglio'}).`,
        });
      } else if (motivo === 'iniziale' || motivo === 'meteo') {
        ctx.decide(`Piano ${motivo}: nessuno spostamento utile ora`, {
          level: 'info',
          reasoning: `Con la previsione attuale (${this.previsione.fonte}) nessun carico guadagna almeno 0,3 kWh di sole spostandolo.`,
        });
      }
      return;
    }

    const sole = this.previsione.sole;
    for (const [famId, items] of perFam) {
      const f = this.famiglie.find((x) => x.id === famId);
      const v = (this.versioni.get(famId) || 0) + 1;
      this.versioni.set(famId, v);
      const tetto = tettoDellaScala(f.scala);
      const kwh = items.reduce((n, { a }) => n + a.guadagnoKwh, 0);
      const bolletta = items.reduce((n, { a }) => n + a.risparmioEuro, 0);
      ctx.send(
        `casa-${famId}`,
        `Proposta per la famiglia ${f.nome}: ${items.map(({ c, profilo }) => `${c.req.nome.toLowerCase()} ${quando(c.req, profilo)}`).join(', ')}`,
        {
          tipo: 'proposta',
          famiglia: famId,
          versione: v,
          motivo,
          tetto: { id: tetto.id, nome: tetto.nome, frase: tetto.frase },
          finestraSole: finestraSole(surplus, primo),
          guadagnoKwh: round2(kwh),
          stimaEuro: round2(kwh * euroPerKwhCondiviso()),
          stimaBollettaEuro: round2(bolletta),
          carichi: items.map(({ c, profilo, a }) => ({ id: c.req.id, tipo: c.req.tipo, nome: c.req.nome, profilo, scelta: a.scelta, kwhSole: a.kwhSole, guadagnoKwh: a.guadagnoKwh, risparmioEuro: a.risparmioEuro })),
        },
      );
    }
    const etichetta = { iniziale: 'Piano del mattino', meteo: 'Ripianifico per il meteo', 'nuovo carico': 'Nuovo carico da inserire', periodico: 'Aggiornamento orario' }[motivo] || 'Piano';
    ctx.decide(`${etichetta}: ${spostati} ${spostati === 1 ? 'carico spostato' : 'carichi spostati'} verso il sole, +${num(guadagno)} kWh condivisi previsti`, {
      level: motivo === 'meteo' ? 'warning' : 'good',
      actions: [...perFam.keys()].map((id) => ({ type: 'proposta', to: `casa-${id}` })),
      reasoning:
        `Previsione ${this.previsione.fonte === 'open-meteo' ? 'Open-Meteo' : 'simulata'} corretta con i sensori (ora ${Math.round(this.previsione.rapporto * 100)}% del sereno; ` +
        `alba ${hhmm(sole.alba)}, tramonto ${hhmm(sole.tramonto)}). Famiglie servite a turno, prima chi ha avuto meno sole finora: ` +
        `${this.ordineFamiglie().slice(0, 3).map((id) => this.famiglie.find((x) => x.id === id).nome).join(', ')}…`,
      metrics: { guadagno_previsto_kwh: { value: round2(guadagno), unit: 'kWh', label: 'Guadagno previsto dal piano' } },
    });
  }

  // ================================================================ uscite

  /**
   * Risultati del bilancio con il risparmio in bolletta "maturato": per ogni carico già finito
   * nello scenario con agenti, costo all'ora solita − costo all'ora effettiva. Così a metà
   * giornata non si confronta la lavatrice già fatta a mezzogiorno con quella che "senza agenti"
   * si farebbe stasera (a fine giornata coincide con il conto orario del bilancio).
   */
  risultati(h = this.ultimaH ?? GIORNO.inizio) {
    const r = this.bilancio.risultati();
    const perFam = Object.fromEntries(this.famiglie.map((f) => [f.id, 0]));
    for (const c of this.carichi.values()) {
      const e = estremi(c.profiloCon);
      if (!e || e.fine > h + 1e-6) continue;
      perFam[c.req.famiglia] += costo(c.profiloSenza) - costo(c.profiloCon);
    }
    const bolletta = Object.values(perFam).reduce((a, b) => a + b, 0);
    r.delta.bollettaEuro = bolletta;
    r.delta.totaleEuro = r.delta.incentivoEuro + bolletta;
    r.annuo.euro = r.delta.totaleEuro * PARAMETRI.giorniAnno.valore;
    for (const [id, v] of Object.entries(perFam)) r.famiglie[id].bollettaEuro = v;
    return r;
  }

  #riepilogo(ctx, h) {
    this.riepilogoInviato = true;
    const r = this.risultati();
    const testo =
      `Riepilogo di oggi della ${CER.nome}: ${num(r.con.condivisaKwh)} kWh di sole usati nel quartiere ` +
      `(${pct(r.con.quotaCondivisa)} della produzione), ${num(r.delta.condivisaKwh)} kWh in più grazie ai vostri spostamenti. ` +
      `Valgono ${euro(r.delta.totaleEuro)} € in più tra incentivo e bolletta e ${num(r.delta.co2Kg)} kg di CO₂ in meno. Grazie a tutti!`;
    ctx.notify('whatsapp', CER.gruppoWhatsapp, testo, { ora: hhmm(h), tipo: 'riepilogo' });
    ctx.notify('dashboard', CER.referente, `Riepilogo per il referente: ${testo}`, { ora: hhmm(h), tipo: 'riepilogo' });
    ctx.decide(`Riepilogo serale inviato al gruppo: +${num(r.delta.condivisaKwh)} kWh condivisi rispetto a senza agenti`, {
      level: 'good',
      actions: [{ type: 'notify', to: CER.gruppoWhatsapp }],
    });
  }

  #metriche(ctx) {
    const r = this.risultati();
    ctx.metric('quota_condivisa_pct', Math.round(r.con.quotaCondivisa * 1000) / 10, '%', { label: 'Quota di energia condivisa (con agenti)' });
    ctx.metric('quota_condivisa_senza_pct', Math.round(r.senza.quotaCondivisa * 1000) / 10, '%', { label: 'Quota di energia condivisa (senza agenti)' });
    ctx.metric('kwh_condivisi', round2(r.con.condivisaKwh), 'kWh', { label: 'Energia condivisa oggi (con agenti)' });
    ctx.metric('kwh_condivisi_senza', round2(r.senza.condivisaKwh), 'kWh', { label: 'Energia condivisa oggi (senza agenti)' });
    ctx.metric('euro_in_piu', round2(r.delta.totaleEuro), '€', { label: 'Incentivo + bolletta in più grazie agli agenti' });
    ctx.metric('co2_evitata_in_piu_kg', round2(r.delta.co2Kg), 'kg', { label: 'CO₂ evitata in più grazie agli agenti' });
  }

  /**
   * Proiezione a fine giornata: il conto vero fin qui + il resto della giornata stimato con la
   * previsione di produzione e i piani attuali (con) o le abitudini (senza). Serve a leggere i KPI
   * a metà giornata: spostare un carico verso mezzogiorno all'inizio "peggiora" il confronto.
   */
  proiezione(h, tetti) {
    if (!this.previsione) return null;
    const b = this.bilancio.clona();
    const temp = Object.fromEntries(this.famiglie.map((f) => [f.id, temperaturaScala(tetti, f.scala) ?? 15]));
    for (let s = slotDa(h); s < N_SLOT; s++) {
      const hs = oraDiSlot(s);
      const con = {};
      const senza = {};
      for (const f of this.famiglie) con[f.id] = senza[f.id] = consumoBaseKw(f, hs) + climaKw(f, hs, temp[f.id]);
      for (const c of this.carichi.values()) {
        con[c.req.famiglia] += (c.proposto || c.profiloCon)[s];
        senza[c.req.famiglia] += c.profiloSenza[s];
      }
      b.aggiungi({ h: hs, dtH: GIORNO.passo, prodKw: this.previsione.kw[s] ?? 0, consumi: { con, senza } });
    }
    const r = b.risultati();
    const pick = (k) => ({ condivisaKwh: round2(k.condivisaKwh), quotaCondivisa: round2(k.quotaCondivisa), prodottaKwh: round2(k.prodottaKwh) });
    return { con: pick(r.con), senza: pick(r.senza), delta: { condivisaKwh: round2(r.delta.condivisaKwh), totaleEuro: round2(r.delta.totaleEuro), co2Kg: round2(r.delta.co2Kg) } };
  }

  /** Istantanea per la dashboard (evento `cer.stato`). */
  stato(ctx, h, simNow, tetti, consumi, prodKw) {
    const s = slotDi(h);
    const r = this.risultati();
    const serie = this.bilancio.serieKw();
    const famiglie = this.famiglie.map((f) => {
      const carichi = [...this.carichi.values()].filter((c) => c.req.famiglia === f.id).map((c) => {
        const prof = c.proposto || c.profiloCon;
        return {
          id: c.req.id,
          tipo: c.req.tipo,
          nome: c.req.nome,
          abitudine: hhmm(c.req.abitudine),
          stato: c.stato,
          piano: fasce(prof).map(([a, b]) => [hhmm(a), hhmm(b)]),
          attivoCon: c.profiloCon[s] > 0,
          attivoSenza: c.profiloSenza[s] > 0,
          kwhSole: c.kwhSole,
          motivo: c.motivo || null,
        };
      });
      const k = r.famiglie[f.id];
      return {
        id: f.id,
        nome: f.nome,
        scala: f.scala,
        piano: f.piano,
        descrizione: f.descrizione,
        fragile: !!f.fragile,
        kwCon: round2(consumi.con[f.id]),
        kwSenza: round2(consumi.senza[f.id]),
        condivisaKwh: round2(k.condivisaKwh),
        condivisaKwhSenza: round2(k.condivisaKwhSenza),
        consumoKwh: round2(k.consumoKwh),
        euro: round2(k.euroCon - k.euroSenza + k.bollettaEuro),
        carichi,
      };
    });
    const consCon = Object.values(consumi.con).reduce((a, b) => a + b, 0);
    const consSenza = Object.values(consumi.senza).reduce((a, b) => a + b, 0);
    return {
      giorno: this.giorno,
      ora: round2(h),
      orario: formatClock(simNow),
      ora_reale: Date.now(),
      sole: this.previsione?.sole || (() => { const g = giornataSolare(simNow); return { alba: round2(g.alba), tramonto: round2(g.tramonto) }; })(),
      previsione: this.previsione ? { fonte: this.previsione.fonte, nota: this.previsione.nota, rapporto: this.previsione.rapporto, cielo: this.previsione.cielo, kw: this.previsione.kw } : null,
      ora_kw: { prod: round2(prodKw), con: round2(consCon), senza: round2(consSenza), condivisaCon: round2(Math.min(prodKw, consCon)), condivisaSenza: round2(Math.min(prodKw, consSenza)) },
      tetti: tetti.map((t) => ({ id: t.id, nome: t.nome, zona: t.zona, kWp: t.kWp, kw: round2(t.kw), lux: t.lux === null ? null : Math.round(t.lux), temp: t.temp, deviceId: t.deviceId, reale: t.reale, net: t.net })),
      serie: { inizio: GIORNO.inizio, passo: GIORNO.passo, ...serie },
      kpi: { con: r.con, senza: r.senza, delta: r.delta, annuo: r.annuo, oreSimulate: round2(r.oreSimulate), fineGiornata: this.proiezione(h, tetti) },
      piano: this.piano,
      famiglie,
      scenari: ctx.state.activeScenarios().map((x) => x.name),
    };
  }

  // ================================================================ chat

  async onChat({ from, text }, ctx) {
    const risposta = this.rispondi(from, text, ctx);
    if (ctx.llm.isMock) return risposta;
    const r = this.risultati();
    const { text: reply } = await ctx.llm.complete({
      system: SYSTEM,
      prompt:
        `Domanda di ${from}: "${text}"\n\nDati (JSON): ${JSON.stringify({
          ora: this.ultimaH === null ? null : hhmm(this.ultimaH),
          previsione: this.previsione?.fonte,
          con_agenti: { kwh_condivisi: round2(r.con.condivisaKwh), quota: pct(r.con.quotaCondivisa) },
          senza_agenti: { kwh_condivisi: round2(r.senza.condivisaKwh), quota: pct(r.senza.quotaCondivisa) },
          euro_in_piu: round2(r.delta.totaleEuro),
        })}\n\nRisposta di riferimento calcolata dalle regole: ${risposta}\nRiformulala senza cambiare orari e numeri.`,
      fallback: risposta,
    });
    return reply;
  }

  /** Risposte a regole: funzionano sempre, anche senza LLM. */
  rispondi(from, text, ctx) {
    const t = text.toLowerCase();
    const fam = this.famiglie.find((f) => from === destinatario(f.id) || from === f.id || t.includes(f.nome.toLowerCase()));
    const h = this.ultimaH ?? hourOf(ctx.simTime());
    if (!this.previsione && /auto|lav|quando|conviene|risparm/.test(t)) {
      return 'Sto ancora raccogliendo i dati dei tetti per la giornata: riprova tra qualche secondo.';
    }
    if (/auto|ricaric|carica|wallbox|elettrica/.test(t)) return this.#quando(ctx, h, 'auto', fam);
    if (/lavastov/.test(t)) return this.#quando(ctx, h, 'lavastoviglie', fam);
    if (/lavatric|lavare|lavo|bucato|panni|asciugatric/.test(t)) return this.#quando(ctx, h, /asciug/.test(t) ? 'asciugatrice' : 'lavatrice', fam);
    if (/scaldabagn|acqua calda|boiler/.test(t)) return this.#quando(ctx, h, 'scaldabagno', fam);
    if (/co2|co₂|emission|ambient|inquin/.test(t)) {
      const r = this.risultati();
      return `Oggi la CER ha evitato ${num(r.con.co2EvitataKg)} kg di CO₂ usando il sole dei tetti nello stesso momento in cui lo consumiamo; senza i consigli sarebbero ${num(r.senza.co2EvitataKg)} kg. Fattore ISPRA ${String(PARAMETRI.fattoreEmissione.valore).replace('.', ',')} kg/kWh.`;
    }
    if (/sole|produc|produz|tetto|pannell|nuvol|meteo|previsio/.test(t)) return this.#produzione(ctx, h);
    if (/risparm|guadagn|incentiv|euro|soldi|quanto|bollett|beneficio|kpi/.test(t)) return this.#risparmi(h, fam);
    if (/equ|giust|famiglie|chi/.test(t)) return this.#equita();
    if (/programma|piano|oggi cosa|cosa devo|consigli/.test(t) && fam) return this.#programma(fam);
    if (/cer|comunit|come funziona|cos'è|cosa sei|chi sei|aiuto|help/.test(t)) {
      return `Sono l'agente della ${CER.nome}: ${TETTI.length} impianti sui tetti (${TETTI.reduce((a, x) => a + x.kWp, 0)} kWp) e ${this.famiglie.length} famiglie. ` +
        'Lo Stato premia l\'energia prodotta e consumata nella stessa ora: io coordino gli agenti delle case per spostare lavatrici, auto e scaldabagni nelle ore di sole, a turno tra le famiglie.';
    }
    if (/ciao|salve|buongiorno|buonasera/.test(t)) {
      return `Ciao${fam ? ` famiglia ${fam.nome}` : ''}! Sono le ${hhmm(h)}. Chiedimi "quando conviene caricare l'auto?", "quando faccio la lavatrice?" o "quanto abbiamo risparmiato oggi?".`;
    }
    return 'Posso dirti quando conviene usare lavatrice, lavastoviglie o caricare l\'auto, quanto sole producono i tetti e quanto abbiamo guadagnato oggi. Prova: "quando conviene caricare l\'auto?"';
  }

  #quando(ctx, h, tipo, fam) {
    if (!this.previsione) return 'Sto ancora raccogliendo i dati dei tetti per la giornata: riprova tra qualche secondo.';
    const tetti = letturaTetti(ctx.state, { luxGain: this.luxGain });
    const surplus = this.surplus(h, tetti);
    const f = fam || this.famiglie[0];
    const cat = CARICHI[tipo];
    const r = richiesta(f, { tipo, abitudine: Math.max(h, GIORNO.inizio), finestra: [h, 24] });
    const { assegnazioni } = pianifica({ ora: h, surplus, richieste: [r], soglia: 0 });
    const a = assegnazioni[0];
    const sole = this.previsione.sole;
    const quota = a.kwhSole / r.kwh;
    const nome = tipo === 'auto' ? "caricare l'auto" : `usare ${tipo === 'lavatrice' ? 'la lavatrice' : tipo === 'lavastoviglie' ? 'la lavastoviglie' : tipo === 'asciugatrice' ? "l'asciugatrice" : 'lo scaldabagno'}`;
    if (quota >= 0.3) {
      const ff = fasce(a.profilo);
      const intervallo = cat.divisibile ? `tra le ${hhmm(ff[0][0])} e le ${hhmm(ff[ff.length - 1][1])}` : `alle ${hhmm(ff[0][0])}`;
      const sera = kwhAlSole(profiloAbitudine({ ...r, abitudine: 19.5 }, { da: h }), surplus);
      return `Conviene ${nome} ${intervallo}: lì il sole dei tetti non è ancora usato dal quartiere e copre circa ${num(a.kwhSole)} kWh su ${num(r.kwh)}. ` +
        `Alle 19:30 ne coprirebbe ${num(sera)}. Per la CER sono circa ${euro((a.kwhSole - sera) * euroPerKwhCondiviso())} € di incentivo in più.`;
    }
    if (h >= sole.tramonto - 0.5) {
      return `Oggi il sole sui tetti è finito (tramonto alle ${hhmm(sole.tramonto)}). Se puoi aspettare, domani conviene tra le ${hhmm(sole.alba + 3.5)} e le ${hhmm(sole.tramonto - 2.5)}; ` +
        'se ti serve stasera, meglio dopo le 21, quando l\'energia costa meno.';
    }
    const ff = fasce(a.profilo);
    const fascia = ff.length ? (cat.divisibile ? `tra le ${hhmm(ff[0][0])} e le ${hhmm(ff[ff.length - 1][1])}` : `alle ${hhmm(ff[0][0])}`) : '';
    return `Il sole dei tetti di oggi è già quasi tutto prenotato dai vicini: ${nome} ne prenderebbe solo ${num(a.kwhSole)} kWh su ${num(r.kwh)}. ` +
      `Se puoi aspettare, domani conviene tra le ${hhmm(sole.alba + 3.5)} e le ${hhmm(sole.tramonto - 2.5)}; se ti serve oggi, meglio ${fascia} (sole rimasto e prezzo più basso).`;
  }

  #risparmi(h, fam) {
    const r = this.risultati();
    let s = `Oggi fino alle ${hhmm(h)}, con i consigli: ${num(r.con.condivisaKwh)} kWh condivisi (${pct(r.con.quotaCondivisa)} della produzione) contro ${num(r.senza.condivisaKwh)} kWh (${pct(r.senza.quotaCondivisa)}) senza. ` +
      `In più: ${euro(r.delta.incentivoEuro)} € di incentivo, ${euro(r.delta.bollettaEuro)} € di bolletta e ${num(r.delta.co2Kg)} kg di CO₂ evitata.`;
    if (fam) {
      const k = r.famiglie[fam.id];
      s += ` Per voi ${fam.nome}: ${num(k.condivisaKwh)} kWh di sole del quartiere (erano ${num(k.condivisaKwhSenza)}).`;
    }
    return s;
  }

  #produzione(ctx, h) {
    const tetti = letturaTetti(ctx.state, { luxGain: this.luxGain });
    const tot = tetti.reduce((a, t) => a + t.kw, 0);
    const p = this.previsione;
    const fonte = p?.fonte === 'open-meteo' ? 'Open-Meteo' : 'simulata (cielo sereno)';
    return `Alle ${hhmm(h)} i tetti producono ${num(tot)} kW: ${tetti.map((t) => `${t.nome.toLowerCase()} ${num(t.kw)} kW${t.reale ? ' (sensore vero)' : ''}`).join(', ')}. ` +
      (p ? `Il sole misurato è al ${Math.round(p.rapporto * 100)}% del sereno; previsione ${fonte}, tramonto alle ${hhmm(p.sole.tramonto)}.` : '');
  }

  #equita() {
    const r = this.risultati();
    const righe = this.famiglie
      .map((f) => ({ f, k: r.famiglie[f.id] }))
      .sort((a, b) => b.k.condivisaKwh - b.k.condivisaKwhSenza - (a.k.condivisaKwh - a.k.condivisaKwhSenza))
      .slice(0, 3)
      .map(({ f, k }) => `${f.nome} +${num(k.condivisaKwh - k.condivisaKwhSenza)} kWh`);
    return `Servo le famiglie a turno: prima chi finora ha avuto meno sole. Indice di equità (Jain, 1 = tutti uguali): ${num(r.con.equita, 2)} con gli agenti, ${num(r.senza.equita, 2)} senza. Chi ha guadagnato di più oggi: ${righe.join(', ')}.`;
  }

  #programma(fam) {
    const items = [...this.carichi.values()].filter((c) => c.req.famiglia === fam.id);
    if (!items.length) return `Famiglia ${fam.nome}: oggi non ho ancora i vostri carichi.`;
    return `Programma di oggi per i ${fam.nome}: ` + items.map((c) => `${c.req.nome.toLowerCase()} ${quando(c.req, c.proposto || c.profiloCon)} (${{ accettato: 'accettato', rifiutato: 'come al solito', proposto: 'proposto', abitudine: 'come al solito' }[c.stato]})`).join('; ') + '.';
  }
}

/** Fascia della giornata con sole libero (≥ 1 kW) da `primo` in poi: [da, a] in ore, o null. */
function finestraSole(surplus, primo) {
  let a = null;
  let b = null;
  for (let s = primo; s < N_SLOT; s++) {
    if (surplus[s] >= 1) {
      if (a === null) a = s;
      b = s;
    }
  }
  return a === null ? null : [oraDiSlot(a), oraDiSlot(b) + GIORNO.passo];
}

function quando(req, profilo) {
  const ff = fasce(profilo);
  if (!ff.length) return '';
  return req.divisibile ? `tra le ${hhmm(ff[0][0])} e le ${hhmm(ff[ff.length - 1][1])}` : `alle ${hhmm(ff[0][0])}`;
}

const round2 = (x) => Math.round(x * 100) / 100;
const num = (x, d = 1) => new Intl.NumberFormat('it-IT', { maximumFractionDigits: d }).format(x);
const euro = (x) => new Intl.NumberFormat('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(x);
const pct = (x) => `${Math.round(x * 100)}%`;
