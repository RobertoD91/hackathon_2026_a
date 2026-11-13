// Orchestratore: riceve i messaggi degli agenti, decide cosa dire alle persone
// (notify su WhatsApp tramite OpenClaw) e risponde alla chat (/api/chat).
//
// Schema da copiare:
// 1. costruisci SEMPRE un testo deterministico (funziona senza LLM e senza rete);
// 2. passalo all'LLM come `fallback`: con LLM_PROVIDER=mock torna identico, con un LLM
//    vero viene riformulato; se l'LLM fallisce si usa comunque il fallback.

import { Agent } from '../../src/agent.js';
import { formatClock } from '../../sim/sim-core.js';

const GRUPPO = 'gruppo-quartiere'; // destinatario WhatsApp (lo risolve OpenClaw)

const SYSTEM = `Sei l'orchestratore di una rete di sensori di quartiere a Napoli.
Scrivi in italiano, in modo chiaro e cordiale, al massimo 2 frasi, senza inventare dati.`;

export class Orchestrator extends Agent {
  name = 'orchestrator';
  description = 'Coordina gli agenti, avvisa i cittadini e risponde in chat.';
  subscribes = ['agent.message', 'scenario', 'reading'];

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
    ctx.decide(`Scenario "${name}" ${active === false ? 'concluso' : 'avviato'}`, {
      level: active === false ? 'good' : 'info',
      reasoning: Object.keys(params || {}).length ? `Parametri: ${JSON.stringify(params)}` : '',
    });
  }

  async #messaggio(event, ctx) {
    const { payload = {}, text } = event.data;
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
    } else if (payload.tipo === 'caldo_rientrato') {
      ctx.notify('dashboard', 'operatore', `Zona ${payload.zona}: temperatura tornata nella norma.`);
    }
  }

  /** Risposta a POST /api/chat (dashboard, WhatsApp via OpenClaw, script del ponte). */
  async onChat({ from, text }, ctx) {
    const risposta = rispostaDeterministica(text, ctx.state);
    if (ctx.llm.isMock) return risposta;
    const { text: reply } = await ctx.llm.complete({
      system: SYSTEM,
      prompt:
        `Domanda di ${from}: "${text}"\n\n` +
        `Dati attuali (JSON): ${JSON.stringify(contesto(ctx.state))}\n\n` +
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

/** Risposte a regole: funzionano sempre, anche senza LLM. */
export function rispostaDeterministica(text, state) {
  const t = text.toLowerCase();
  const zone = state.zones();
  if (zone.length === 0) return 'Non ho ancora ricevuto dati dai sensori. Riprova tra qualche secondo.';
  const perZona = (key, unit, dec = 1) =>
    zone
      .map((z) => {
        const v = state.average(key, { zone: z });
        return v === null ? null : `${z} ${dec ? r1(v) : Math.round(v)} ${unit}`;
      })
      .filter(Boolean)
      .join(', ');

  if (/temperatur|caldo|fresco|gradi/.test(t)) {
    return `Temperature ora (${formatClock(state.simTime())}): ${perZona('temperature_c', '°C')}.`;
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
      `Temperatura media ${r1(state.average('temperature_c'))} °C.` +
      (att.length ? ` In corso: ${att.join(', ')}.` : ' Nessuna emergenza in corso.')
    );
  }
  return 'Posso dirti temperatura, luce ed energia risparmiata per zona, o gli scenari in corso. Prova: "che temperatura c\'è?"';
}

const r1 = (v) => (typeof v === 'number' ? Math.round(v * 10) / 10 : null);
