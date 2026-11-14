// Agente "fonti": porta sul bus i DATI REALI di Napoli, così gli altri agenti ragionano anche su
// quelli (l'orchestratore cita la stazione più vicina e l'evento del giorno nei consigli WhatsApp).
// Isomorfo (Node e browser): legge gli snapshot di ../dati/ e, se la rete è attiva, le fonti live
// con CORS (Open-Meteo, Centro Funzionale Campania) tramite ../fonti/dati.js.
//
// Cosa fa:
// - all'avvio: eventi reali di oggi (partite al Maradona, navi da crociera, eventi del Comune, regate
//   dell'America's Cup), stazioni vicine ai luoghi e stagionalità turistica (ISTAT) → decisione,
//   metrica `eventi_oggi` e messaggio `contesto` all'orchestratore;
// - ogni 2 s, sull'ora SIMULATA: accende/spegne gli scenari `evento_<zona>` quando l'ora è nella
//   finestra di un evento reale (effetti sulla folla in sim-config.json, ipotesi dichiarate) e lo
//   scenario `stagione_bassa`/`stagione_alta` dal mese (arrivi ISTAT rispetto alla media annua);
// - ogni 15 minuti, se c'è rete: meteo reale, indice europeo dell'aria, allerta regionale →
//   metriche e, se l'allerta è gialla o più, messaggio `allerta` all'orchestratore.
//
// Opzioni: { rete: true|false (predefinito: true, false sotto `node --test`), ogniMs, liveMs }.

import { Agent } from '../../src/agent.js';
import * as D from '../fonti/dati.js';
import * as N from '../fonti/normalizza.js';
import { LUOGHI } from '../luoghi.js';

const sottoTest = () => Boolean(globalThis.process?.env?.NODE_TEST_CONTEXT);

export class FontiAgent extends Agent {
  name = 'fonti';
  description = 'Dati reali di Napoli (eventi del giorno, stagione, meteo, allerta, aria, stazioni) per gli altri agenti.';
  subscribes = [];

  #rete;
  #ogniMs;
  #liveMs;
  #eventi = null;
  #trasporti = null;
  #riferimenti = null;
  #giorno = null;
  #oggi = [];
  #attivi = new Map(); // scenario → firma dei parametri
  #allerta = null;

  /** @param {{rete?: boolean, ogniMs?: number, liveMs?: number}} [opts] */
  constructor(opts = {}) {
    super();
    this.#rete = opts.rete ?? !sottoTest();
    this.#ogniMs = opts.ogniMs ?? 2000;
    this.#liveMs = opts.liveMs ?? 15 * 60_000;
  }

  async onStart(ctx) {
    // solo snapshot locali: l'avvio (anche della demo nel browser) non aspetta la rete
    const [ev, tr, ri] = await Promise.all([D.snapshot('eventi'), D.snapshot('trasporti'), D.snapshot('riferimenti')]);
    this.#eventi = ev;
    this.#trasporti = tr;
    this.#riferimenti = ri;
    if (this.#rete) {
      // calendario della Serie A aggiornato dal vivo: si ricalcola il giorno al prossimo controllo
      D.eventi()
        .then((r) => {
          // stesso calendario in un altro ordine (live + coppe dello snapshot): niente seconda decisione
          const firma = (p) => JSON.stringify((p || []).map((x) => `${x.giorno} ${x.ora ?? ''} ${x.ospite}`).sort());
          if (r.dati && firma(r.dati.partite) !== firma(this.#eventi?.partite)) {
            this.#eventi = r.dati;
            this.#giorno = null;
          }
        })
        .catch(() => {});
    }
    this.aggiornaScenari(ctx);
    ctx.every(this.#ogniMs, (c) => this.aggiornaScenari(c));
    if (this.#rete) {
      this.aggiornaLive(ctx).catch((err) => ctx.log?.warn?.(`fonti live: ${err.message}`));
      ctx.every(this.#liveMs, (c) => this.aggiornaLive(c).catch(() => {}));
    }
  }

  /** Stazioni vicine a ogni luogo, con nome e linee (dallo snapshot GTFS). */
  vicine() {
    const tr = this.#trasporti;
    if (!tr?.vicine) return {};
    const perId = new Map(tr.stazioni.map((s) => [s.id, s]));
    return Object.fromEntries(
      Object.entries(tr.vicine).map(([z, l]) => [z, l.map((v) => ({ ...v, nome: perId.get(v.id)?.nome, linee: perId.get(v.id)?.linee || [], tipo: perId.get(v.id)?.tipo })).filter((v) => v.nome)]),
    );
  }

  /** Eventi di un giorno con il nome del luogo. */
  eventiDel(giorno) {
    return N.eventiDelGiorno(this.#eventi, giorno).map((e) => ({ ...e, luogo: LUOGHI[e.zona]?.nome ?? e.nota ?? null }));
  }

  /** Nuovo giorno simulato: eventi, stagione, contesto all'orchestratore. */
  #nuovoGiorno(ctx, giorno, t) {
    this.#giorno = giorno;
    this.#oggi = this.eventiDel(giorno);
    const prossimi = N.prossimiEventi(this.#eventi, giorno, { max: 4 });
    const st = N.stagione(this.#riferimenti, N.partiLocali(t).mese);
    ctx.metric('eventi_oggi', this.#oggi.length, '', { label: 'Eventi reali oggi' });
    const elenco = this.#oggi.map((e) => `${e.titolo}${e.luogo ? ` (${e.luogo})` : ''}`);
    ctx.decide(
      this.#oggi.length ? `Oggi a Napoli: ${elenco.join('; ')}` : `Oggi a Napoli nessun grande evento in calendario${prossimi[0] ? `; prossimo: ${prossimi[0].titolo} il ${N.dataBreve(N.inizioGiorno(prossimi[0].giorno), t)}` : ''}`,
      {
        level: 'info',
        actions: this.#oggi.filter((e) => e.zona).map((e) => ({ type: 'evento_reale', zone: e.zona, label: `${e.tipo}: ${LUOGHI[e.zona]?.nome ?? e.zona}` })),
        reasoning:
          `Fonti: Comune di Napoli, openfootball (Serie A), Cruise Timetables (crociere), America's Cup (snapshot del ${this.#eventi?.meta?.generato?.slice(0, 10) ?? 'n/d'}).` +
          (st ? ` Stagione turistica: arrivi di questo mese ${String(st.indice).replace('.', ',')}× la media mensile (ISTAT ${st.anno}, provincia di Napoli).` : ''),
      },
    );
    ctx.send('orchestrator', `Contesto reale del ${giorno}: ${this.#oggi.length} eventi`, {
      tipo: 'contesto',
      giorno,
      eventi: this.#oggi.map(({ titolo, tipo, zona, luogo, inizio, fonte, scenario }) => ({ titolo, tipo, zona, luogo, ora: inizio ? N.oraBreve(inizio) : null, fonte, folla: Boolean(scenario) })),
      prossimi: prossimi.map((p) => ({ ...p, luogo: LUOGHI[p.zona]?.nome ?? null })),
      vicine: this.vicine(),
      stagione: st,
    });
  }

  /** Accende e spegne gli scenari degli eventi reali sull'ora simulata (chiamata ogni 2 s). */
  aggiornaScenari(ctx) {
    const t = ctx.simTime();
    const giorno = N.giornoLocale(t);
    if (giorno !== this.#giorno) this.#nuovoGiorno(ctx, giorno, t);
    const voluti = new Map();
    for (const e of this.#oggi) {
      if (!e.scenario || !e.finestra || t < e.finestra[0] || t > e.finestra[1]) continue;
      const v = voluti.get(e.scenario) ?? { zona: e.zona, eventi: [], fonti: [] };
      v.eventi.push(e.titolo);
      v.fonti.push(e.fonte);
      voluti.set(e.scenario, v);
    }
    const st = N.stagione(this.#riferimenti, N.partiLocali(t).mese);
    if (st?.scenario) voluti.set(st.scenario, { indice: st.indice, mese: st.mese, anno: st.anno, fonti: ['istat'] });
    for (const [nome, params] of voluti) {
      const firma = JSON.stringify(params);
      if (this.#attivi.get(nome) === firma && ctx.state.isActive(nome)) continue;
      this.#attivi.set(nome, firma);
      ctx.publish('scenario', { name: nome, params: { fonte: 'fonti', ...params }, active: true });
    }
    for (const nome of [...this.#attivi.keys()]) {
      if (voluti.has(nome)) continue;
      this.#attivi.delete(nome);
      ctx.publish('scenario', { name: nome, params: { fonte: 'fonti' }, active: false });
    }
  }

  /** Meteo, aria e allerta dal vivo → metriche e messaggi. */
  async aggiornaLive(ctx) {
    const [m, a, al] = await Promise.all([D.meteo(), D.ariaModello(), D.allerta()]);
    const temp = Object.values(m.dati).map((x) => x.temperatura).filter((v) => typeof v === 'number');
    if (temp.length) ctx.metric('temperatura_reale', Math.round((temp.reduce((s, v) => s + v, 0) / temp.length) * 10) / 10, '°C', { label: m.fonte.tipo === 'salvato' ? 'Temperatura reale (salvata)' : 'Temperatura reale' });
    const aqi = Object.values(a.dati).map((x) => x.aqi).filter((v) => typeof v === 'number');
    if (aqi.length) ctx.metric('aqi_europeo', Math.max(...aqi), '', { label: 'Indice aria europeo' });
    const r = al.dati?.regionale;
    if (r) ctx.metric('allerta_meteo', r.scaduta ? 1 : r.livello, r.scaduta ? 'verde' : r.colore, { label: 'Allerta meteo (1-4)' });
    const maxMa = (al.dati?.meteoalarm || []).reduce((x, w) => (w.livello > (x?.livello ?? 0) ? w : x), null);
    ctx.send('orchestrator', 'Meteo e aria reali aggiornati', {
      tipo: 'meteo_reale',
      meteo: m.dati,
      fonteMeteo: { nome: m.fonte.nome, tipo: m.fonte.tipo, ts: m.fonte.ts },
      aria: a.dati,
      fonteAria: { nome: a.fonte.nome, tipo: a.fonte.tipo, ts: a.fonte.ts },
      allerta: r,
      meteoalarm: maxMa,
    });
    const attiva = r && !r.scaduta && r.livello >= 2 ? r : null;
    const firma = attiva ? `${attiva.numero}|${attiva.livello}` : null;
    if (firma && firma !== this.#allerta) {
      ctx.decide(`Allerta meteo ${attiva.colore} per Napoli (Zona 1): ${N.descriviTipiAllerta(attiva.tipi) || attiva.descrizione}`, {
        level: attiva.livello >= 3 ? 'critical' : 'warning',
        actions: [{ type: 'allerta', label: `fino alle ${N.oraBreve(attiva.al)} del ${N.dataBreve(attiva.al)}` }],
        reasoning: `Avviso n. ${attiva.numero ?? 'n/d'} della Protezione Civile Regione Campania (Centro Funzionale). ${attiva.fenomeni ?? ''}`.trim(),
      });
      ctx.send('orchestrator', `Allerta ${attiva.colore} per Napoli`, { tipo: 'allerta', allerta: attiva });
    }
    this.#allerta = firma;
  }
}
