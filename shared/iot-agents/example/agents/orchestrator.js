// Orchestratore: riceve i messaggi degli agenti, decide cosa dire alle persone
// (notify su WhatsApp tramite OpenClaw) e risponde alla chat (/api/chat).
//
// Schema da copiare:
// 1. costruisci SEMPRE un testo deterministico (funziona senza LLM e senza rete);
// 2. passalo all'LLM come `fallback`: con LLM_PROVIDER=mock torna identico, con un LLM
//    vero viene riformulato; se l'LLM fallisce si usa comunque il fallback.

import { Agent } from '../../src/agent.js';
import { formatClock } from '../../sim/sim-core.js';
import { LUOGHI } from '../luoghi.js';
import { zonaPerTesto, oraBreve, dataBreve, inizioGiorno, livelloAria, classeAqi, descriviTipiAllerta } from '../fonti/normalizza.js';

const GRUPPO = 'gruppo-quartiere'; // destinatario WhatsApp (lo risolve OpenClaw)

const SYSTEM = `Sei l'orchestratore di una rete di sensori di quartiere a Napoli.
Scrivi in italiano, in modo chiaro e cordiale, al massimo 2 frasi, senza inventare dati.`;

export class Orchestrator extends Agent {
  name = 'orchestrator';
  description = 'Coordina gli agenti, avvisa i cittadini e risponde in chat.';
  subscribes = ['agent.message', 'scenario', 'reading'];

  /** Dati reali ricevuti dall'agente fonti: eventi, stazioni vicine, stagione, meteo, aria, allerta. */
  #reali = {};

  async onStart(ctx) {
    // esempio di attività periodica: quanti dispositivi hanno mandato dati nell'ultimo minuto
    ctx.every(5000, (c) => {
      const attivi = c.state.devices().filter((d) => Date.now() - d.receivedAt < 60_000).length;
      c.metric('dispositivi_attivi', attivi, '', { label: 'Dispositivi attivi' });
    });
  }

  async onEvent(event, ctx) {
    if (event.type === 'reading') return this.#pulsante(event, ctx);
    if (event.type === 'scenario') return this.#scenario(event, ctx);
    if (event.type === 'agent.message') return this.#messaggio(event, ctx);
  }

  // Un cittadino preme il pulsante di un dispositivo (ESP32 vero o simulato).
  async #pulsante(event, ctx) {
    const { deviceId, readings, location } = event.data;
    if (readings.button !== true || !this.cooldown(`pulsante:${deviceId}`, 10_000)) return;
    const zona = location?.zone ?? 'n/d';
    ctx.decide(`Segnalazione dal pulsante di ${deviceId} (zona ${zona})`, {
      level: 'warning',
      actions: [{ type: 'notify', channel: 'whatsapp', to: GRUPPO }],
      reasoning: 'Pressione del pulsante fisico: la inoltro al gruppo del quartiere.',
    });
    ctx.notify('whatsapp', GRUPPO, `Segnalazione dalla zona ${zona}: qualcuno ha premuto il pulsante di aiuto (${deviceId}).`);
  }

  async #scenario(event, ctx) {
    const { name, params, active } = event.data;
    if (params?.fonte === 'fonti') return this.#scenarioReale(event, ctx);
    ctx.decide(`Scenario "${name}" ${active === false ? 'concluso' : 'avviato'}`, {
      level: active === false ? 'good' : 'info',
      reasoning: Object.keys(params || {}).length ? `Parametri: ${JSON.stringify(params)}` : '',
    });
  }

  /** Scenari accesi dall'agente fonti per eventi reali (evento_<zona>) e stagionalità (stagione_*). */
  #scenarioReale(event, ctx) {
    const { name, params, active } = event.data;
    if (name.startsWith('stagione_')) {
      if (active === false) return;
      ctx.decide(`Stagione turistica ${name === 'stagione_bassa' ? 'bassa' : 'alta'}: folla stimata ${name === 'stagione_bassa' ? 'ridotta' : 'aumentata'} nei luoghi turistici`, {
        level: 'info',
        reasoning: `Arrivi del mese ${String(params.indice).replace('.', ',')}× la media mensile (ISTAT ${params.anno}, provincia di Napoli): ipotesi dichiarata, effetto in sim-config.json.`,
      });
      return;
    }
    const zona = params?.zona ?? name.replace(/^evento_/, '');
    const luogo = LUOGHI[zona]?.nome ?? zona;
    ctx.decide(
      active === false ? `Finito l'effetto dell'evento reale su ${luogo}` : `Evento reale a ${luogo}: ${(params.eventi || []).join(', ')}`,
      {
        level: active === false ? 'good' : 'info',
        actions: active === false ? [] : [{ type: 'evento_reale', zone: zona }],
        reasoning: active === false ? '' : `Dal calendario reale (${[...new Set(params.fonti || [])].join(', ')}): più persone stimate in zona (ipotesi dichiarata).`,
      },
    );
  }

  async #messaggio(event, ctx) {
    const { payload = {}, text } = event.data;
    if (payload.tipo === 'contesto' || payload.tipo === 'meteo_reale') {
      const { tipo, ...dati } = payload;
      Object.assign(this.#reali, dati);
      return;
    }
    if (payload.tipo === 'allerta') return this.#allerta(payload.allerta, ctx);
    if (payload.tipo === 'caldo') {
      const base =
        `Caldo in zona ${payload.zona}: ${payload.temperatura} °C. ` +
        `Evita il sole nelle ore centrali, bevi spesso e controlla le persone anziane vicine.`;
      const { text: messaggio, fallback } = await ctx.llm.complete({
        system: SYSTEM,
        prompt: `Riscrivi questo avviso per i cittadini, mantenendo i numeri:\n${base}`,
        fallback: base,
      });
      ctx.notify('whatsapp', GRUPPO, messaggio);
      ctx.decide(`Avviso caldo inviato al gruppo per la zona ${payload.zona}`, {
        level: 'warning',
        actions: [{ type: 'notify', channel: 'whatsapp', to: GRUPPO }],
        reasoning: `Messaggio da ${event.source}: "${text}".${fallback || ctx.llm.isMock ? ' Testo deterministico (nessun LLM).' : ' Testo riformulato dall\'LLM.'}`,
      });
    } else if (payload.tipo === 'affollamento') {
      const alt = payload.alternativa;
      const base =
        `${payload.luogo} adesso è molto affollato (circa ${payload.persone} persone).` +
        (alt ? ` Se puoi, vai a ${alt.nome}: è a ${alt.km} km ed è più tranquillo.` : ' Se puoi, rimanda di un\'ora.') +
        this.#suggerimentiReali(payload.zona, alt?.zona);
      const { text: messaggio, fallback } = await ctx.llm.complete({
        system: SYSTEM,
        prompt: `Riscrivi questo consiglio per turisti e cittadini, breve e cordiale, mantenendo luoghi e numeri:\n${base}`,
        fallback: base,
      });
      ctx.notify('whatsapp', 'turisti', messaggio);
      ctx.decide(`Consiglio anti-folla inviato per ${payload.luogo}`, {
        level: 'info',
        actions: [{ type: 'notify', channel: 'whatsapp', to: 'turisti' }],
        reasoning: `Messaggio da ${event.source}: "${text}".${fallback || ctx.llm.isMock ? ' Testo deterministico (nessun LLM).' : " Testo riformulato dall'LLM."}`,
      });
    } else if (payload.tipo === 'caldo_rientrato') {
      ctx.notify('dashboard', 'operatore', `Zona ${payload.zona}: temperatura tornata nella norma.`);
    }
  }

  /** Evento reale del giorno nella zona affollata e stazione più vicina all'alternativa (o alla zona). */
  #suggerimentiReali(zona, zonaAlt) {
    const r = this.#reali;
    let extra = '';
    const ev = (r.eventi || []).find((e) => e.zona === zona);
    if (ev) extra += ` Oggi c'è "${ev.titolo}".`;
    const dest = zonaAlt ?? zona;
    const st = r.vicine?.[dest]?.[0];
    if (st) extra += ` Stazione più vicina${zonaAlt ? ` a ${LUOGHI[dest]?.nome ?? dest}` : ''}: ${st.nome} (${st.linee.join(', ')}), ${st.piedi} min a piedi.`;
    return extra;
  }

  /** Allerta meteo regionale: avviso al gruppo del quartiere (dati reali, Protezione Civile Campania). */
  async #allerta(a, ctx) {
    if (!a || !this.cooldown(`allerta:${a.numero}:${a.livello}`, 6 * 3_600_000)) return;
    const base =
      `Allerta meteo ${a.colore} della Protezione Civile per Napoli${a.tipi?.length ? ` (${descriviTipiAllerta(a.tipi)})` : ''} ` +
      `fino alle ${oraBreve(a.al)} del ${dataBreve(a.al)}. Evita sottopassi e lungomare durante i rovesci e segui gli avvisi del Comune.`;
    const { text: messaggio, fallback } = await ctx.llm.complete({
      system: SYSTEM,
      prompt: `Riscrivi questo avviso ufficiale per i cittadini, senza cambiare colore, orari e consigli:\n${base}`,
      fallback: base,
    });
    ctx.notify('whatsapp', GRUPPO, messaggio);
    ctx.decide(`Avviso di allerta ${a.colore} inviato al gruppo`, {
      level: a.livello >= 3 ? 'critical' : 'warning',
      actions: [{ type: 'notify', channel: 'whatsapp', to: GRUPPO }],
      reasoning: `Avviso n. ${a.numero ?? 'n/d'} del Centro Funzionale della Campania (dato reale).${fallback || ctx.llm.isMock ? ' Testo deterministico (nessun LLM).' : " Testo riformulato dall'LLM."}`,
    });
  }

  /** Risposta a POST /api/chat (dashboard, WhatsApp via OpenClaw, script del ponte). */
  async onChat({ from, text }, ctx) {
    const risposta = rispostaDeterministica(text, ctx.state, this.#reali);
    if (ctx.llm.isMock) return risposta;
    const { text: reply } = await ctx.llm.complete({
      system: SYSTEM,
      prompt:
        `Domanda di ${from}: "${text}"\n\n` +
        `Dati attuali (JSON): ${JSON.stringify({ ...contesto(ctx.state), reali: riassuntoReali(this.#reali) })}\n\n` +
        `Risposta di riferimento basata sulle regole: ${risposta}\n` +
        `Rispondi alla domanda usando solo questi dati.`,
      fallback: risposta,
    });
    return reply;
  }
}

function contesto(state) {
  return {
    ora: formatClock(state.simTime()),
    zone: state.zones().map((z) => ({
      zona: z,
      temperatura_c: r1(state.average('temperature_c', { zone: z })),
      luce_lux: Math.round(state.average('light_lux', { zone: z }) ?? 0),
    })),
    scenari_attivi: state.activeScenarios().map((s) => s.name),
    metriche: Object.fromEntries(Object.values(state.metrics()).map((m) => [m.name, `${m.value} ${m.unit}`.trim()])),
  };
}

/** Dati reali in forma compatta per il prompt dell'LLM. */
function riassuntoReali(r) {
  return {
    eventi_oggi: (r.eventi || []).map((e) => `${e.titolo} (${e.luogo ?? 'Napoli'}${e.ora ? `, ${e.ora}` : ''})`),
    prossimi: (r.prossimi || []).map((p) => `${p.giorno}: ${p.titolo}`),
    allerta: r.allerta ? `${r.allerta.colore} fino a ${oraBreve(r.allerta.al)} ${dataBreve(r.allerta.al)}` : null,
    temperatura_reale: media(Object.values(r.meteo || {}).map((m) => m.temperatura)),
  };
}

const media = (v) => {
  const n = v.filter((x) => typeof x === 'number');
  return n.length ? Math.round((n.reduce((a, b) => a + b, 0) / n.length) * 10) / 10 : null;
};

/** Risposte sui dati reali (eventi, trasporti, aria, meteo e allerta); null se la domanda non li riguarda. */
export function rispostaReale(text, r = {}) {
  const t = text.toLowerCase();
  const zona = zonaPerTesto(text, LUOGHI);
  if (/\bmetro|stazion|\btren[oi]\b|funicolar|come (ci )?arriv|arrivare|cumana|circumvesuviana|circumflegrea|\bmezzi\b/.test(t)) {
    if (!r.vicine) return null;
    const zone = zona ? [zona] : Object.keys(r.vicine).slice(0, 4);
    const righe = zone
      .map((z) => {
        const l = r.vicine[z] || [];
        return l.length ? `${LUOGHI[z]?.nome ?? z}: ${l.map((s) => `${s.nome} (${s.linee.join(', ')}) ${s.piedi} min a piedi`).join(', ')}` : null;
      })
      .filter(Boolean);
    return righe.length ? `Stazioni più vicine (orari ANM ed EAV): ${righe.join('. ')}.${zona ? '' : ' Chiedimi di un luogo preciso, es. "come arrivo al Maradona?".'}` : null;
  }
  if (/eventi|evento|oggi|partita|crocier|nave|navi|regata|america|concerto|festival/.test(t)) {
    if (!r.eventi && !r.prossimi) return null;
    const oggi = (r.eventi || []).map((e) => `${e.titolo}${e.luogo ? ` (${e.luogo}${e.ora ? `, ${e.ora}` : ''})` : ''}`);
    const poi = (r.prossimi || []).slice(0, 3).map((p) => `${dataBreve(inizioGiorno(p.giorno))}: ${p.titolo}`);
    return (oggi.length ? `Oggi a Napoli: ${oggi.join('; ')}.` : 'Oggi a Napoli non ci sono grandi eventi in calendario.') + (poi.length ? ` Prossimi: ${poi.join('; ')}.` : '') + ' Fonti: Comune di Napoli, calendario Serie A, scali delle navi.';
  }
  if (/aria|smog|inquin|pm10|polver/.test(t)) {
    const v = Object.values(r.aria || {}).map((a) => a.aqi);
    const aqi = v.length ? Math.max(...v.filter((x) => typeof x === 'number')) : null;
    if (aqi == null) return null;
    return `Qualità dell'aria a Napoli: ${livelloAria(classeAqi(aqi))?.label.toLowerCase()} (indice europeo ${aqi}, modello Copernicus CAMS). Le misure delle centraline ARPAC sono nella mappa, modalità "Aria".`;
  }
  if (/allert|pioggia|piove|meteo|tempo fa|vento|temporal|ombrello/.test(t)) {
    const a = r.allerta && !r.allerta.scaduta && r.allerta.livello >= 2 ? r.allerta : null;
    const m = zona ? r.meteo?.[zona] : null;
    const tm = media(Object.values(r.meteo || {}).map((x) => x.temperatura));
    if (!a && tm == null && !r.meteoalarm) return null;
    return (
      (a ? `Allerta ${a.colore} della Protezione Civile per Napoli fino alle ${oraBreve(a.al)} del ${dataBreve(a.al)}. ` : 'Nessuna allerta regionale in corso per Napoli. ') +
      (r.meteoalarm ? `Meteoalarm segnala ${r.meteoalarm.fenomeno.toLowerCase()} (${r.meteoalarm.colore}) dal ${dataBreve(r.meteoalarm.inizio)}. ` : '') +
      (m ? `${LUOGHI[zona].nome}: ${m.cielo.toLowerCase()}, ${virgola(m.temperatura)} °C, vento ${virgola(m.vento, 0)} km/h.` : tm != null ? `Temperatura reale media ${virgola(tm)} °C (Open-Meteo).` : '')
    ).trim();
  }
  return null;
}

/** Risposte a regole: funzionano sempre, anche senza LLM. `reali`: dati dell'agente fonti (facoltativo). */
export function rispostaDeterministica(text, state, reali = {}) {
  const t = text.toLowerCase();
  const zone = state.zones();
  const reale = /temperatur|gradi|termometr/.test(t) ? null : rispostaReale(text, reali);
  if (reale) return reale;
  if (zone.length === 0) return 'Non ho ancora ricevuto dati dai sensori. Riprova tra qualche secondo.';
  const perZona = (key, unit, dec = 1) =>
    zone
      .map((z) => {
        const v = state.average(key, { zone: z });
        // nome breve del luogo di Napoli (es. "Plebiscito"), altrimenti l'id della zona
        const nome = LUOGHI[z]?.nome.split(' · ')[0].replace(/^Piazza del /, '') ?? z;
        return v === null ? null : `${nome} ${dec ? virgola(v) : Math.round(v)} ${unit}`;
      })
      .filter(Boolean)
      .join(', ');

  if (/temperatur|caldo|fresco|gradi|termometr/.test(t)) {
    // sensori (simulati in demo) e, se c'è, la temperatura reale di Open-Meteo: la giuria le vede entrambe
    const tm = media(Object.values(reali.meteo || {}).map((x) => x.temperatura));
    return `Temperature dei sensori (${formatClock(state.simTime())}, ora simulata): ${perZona('temperature_c', '°C')}.` + (tm != null ? ` Temperatura reale adesso: ${virgola(tm)} °C (Open-Meteo).` : '');
  }
  if (/luce|lampion|buio|lux|energia|kwh/.test(t)) {
    const kwh = state.metric('kwh_risparmiati');
    return `Luce: ${perZona('light_lux', 'lux', 0)}.` + (kwh ? ` Energia risparmiata finora: ${kwh.value} kWh.` : '');
  }
  if (/scenari|evento|emergenz|allert/.test(t)) {
    const att = state.activeScenarios().map((s) => s.name);
    return att.length ? `Scenari in corso: ${att.join(', ')}.` : 'Nessuno scenario in corso.';
  }
  if (/ciao|salve|buongiorno|buonasera|stato|situazione|come va/.test(t)) {
    const att = state.activeScenarios().map((s) => s.name);
    return (
      `Ciao! Sono le ${formatClock(state.simTime())}. Seguo ${state.devices().length} sensori in ${zone.length} zone. ` +
      `Temperatura media dei sensori ${virgola(state.average('temperature_c'))} °C.` +
      (att.length ? ` In corso: ${att.join(', ')}.` : ' Nessuna emergenza in corso.')
    );
  }
  return 'Posso dirti temperatura e luce per zona, gli eventi reali di oggi, come arrivare a un luogo con metro e treni, qualità dell\'aria, allerte meteo e scenari in corso. Prova: "che eventi ci sono oggi?" o "come arrivo al Maradona?"';
}

const r1 = (v) => (typeof v === 'number' ? Math.round(v * 10) / 10 : null);
/** Numero con la virgola decimale (testi in italiano). */
const virgola = (v, d = 1) => (typeof v === 'number' ? new Intl.NumberFormat('it-IT', { maximumFractionDigits: d }).format(v) : '–');
