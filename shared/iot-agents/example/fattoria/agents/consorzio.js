// Agente "consorzio" (orchestratore della fattoria): ha poca acqua e la deve dividere.
// - Pianifica i turni della notte (piano.js: priorità a stress idrico, fase colturale, pioggia
//   prevista) con l'acqua della vasca e la dotazione del consorzio; ripianifica quando cambiano
//   previsione, livello dei campi o acqua disponibile, e alle 21:30 fa il piano definitivo.
// - Avvisa ogni agricoltore su WhatsApp (via OpenClaw) solo quando il suo turno cambia.
// - Apre l'acqua all'ora del turno: decisione con l'azione `apri_valvola` (la eseguirebbe
//   un ESP32 con relè; in simulazione la legge il bilancio idrico di simulatore.js).
// - Risponde in chat ("quando irrigo il campo 3?").
// Regole deterministiche; l'LLM, se c'è, riformula solo i testi (con fallback).

import { Agent } from '../../../src/agent.js';
import { formatClock } from '../../../sim/sim-core.js';
import { CAMPI, COLTURE, SERBATOIO, trovaCampo, livelloUmidita } from '../campi.js';
import {
  pianificaNotte,
  finestraNotte,
  turnoCambiato,
  testoTurno,
  riassuntoPiano,
  etichettaTurno,
  durata,
  litriTesto,
  fmt,
  fraseMeteo,
} from '../piano.js';

const H = 3_600_000;
const GRUPPO = 'gruppo-acqua-comune'; // gruppo WhatsApp della comunità (lo risolve OpenClaw)
const SYSTEM = `Sei il consorzio irriguo "Acqua comune" di una piccola comunità agricola dell'Agro Nocerino-Sarnese.
Scrivi in italiano, in modo chiaro e cordiale, come un messaggio WhatsApp a un agricoltore: al massimo 2 frasi,
senza cambiare orari, minuti, litri o millimetri e senza inventare dati.`;

export class Consorzio extends Agent {
  name = 'orchestrator';
  description = 'Consorzio "Acqua comune": divide l\'acqua della notte tra i campi, avvisa gli agricoltori, risponde in chat.';
  subscribes = ['reading', 'agent.message', 'scenario'];

  #previsione = null;
  #piano = null;
  #avviati = {}; // zona → turno partito stanotte
  #notificati = new Map(); // zona → ultimo turno comunicato all'agricoltore
  #ultimo = null; // ultima ora simulata vista
  #definitivo = false;
  #riepilogo = false;
  #riduzione = null; // params dello scenario riduzione_acqua, se attivo
  #primaLettura = null;

  async onEvent(event, ctx) {
    if (event.type === 'reading') {
      const { readings, location } = event.data;
      if (location?.zone === SERBATOIO.zona && typeof readings.fill_pct === 'number' && this.cooldown('serbatoio', 3000)) {
        ctx.metric('serbatoio_pct', Math.round(readings.fill_pct), '%', { label: 'Livello della vasca' });
      }
      if (CAMPI[location?.zone]) this.#primaLettura ??= Date.now();
      return this.#tick(ctx);
    }
    if (event.type === 'scenario' && event.data.name === 'riduzione_acqua') {
      this.#riduzione = event.data.active === false ? null : { quota: 0.6, ...(event.data.params || {}) };
      if (this.#piano) return this.#pianifica(ctx, this.#riduzione ? 'acqua disponibile ridotta' : 'acqua disponibile di nuovo normale');
      return;
    }
    if (event.type === 'agent.message') {
      const p = event.data.payload || {};
      if (p.tipo === 'previsione') {
        const prima = this.#previsione;
        this.#previsione = p.previsione;
        const cambiata = !prima || prima.et0Domani !== p.previsione.et0Domani || prima.pioggiaDomani !== p.previsione.pioggiaDomani;
        if (this.#piano && cambiata) return this.#pianifica(ctx, 'previsione aggiornata');
        return this.#tick(ctx);
      }
      if (p.tipo === 'stato_campo' && this.#piano && (p.livello === 'stress' || p.prima === 'stress' || p.livello === 'saturo')) {
        const c = CAMPI[p.zona];
        return this.#pianifica(ctx, `${c?.nome ?? p.zona} ${p.livello === 'stress' ? 'in stress idrico' : 'cambia livello'}`);
      }
    }
  }

  // ---------------------------------------------------------------- orologio: piano, turni, riepilogo

  async #tick(ctx) {
    const ora = ctx.state.simTime();
    if (this.#ultimo !== null && ora < this.#ultimo - 2 * H) {
      this.#reset(); // la giornata simulata è ricominciata
      this.#ultimo = ora;
    } else this.#ultimo = Math.max(this.#ultimo ?? ora, ora);

    if (this.#piano && ora > this.#piano.fineNotte + 10 * H) this.#reset(); // senza giornata a ciclo: piano della notte dopo
    if (!this.#piano) {
      const conDati = Object.keys(CAMPI).filter((z) => ctx.state.values('soil_moisture_pct', { zone: z }).length).length;
      const attesa = this.#primaLettura !== null && Date.now() - this.#primaLettura > 15_000;
      if (this.#previsione && conDati && (conDati === Object.keys(CAMPI).length || attesa)) await this.#pianifica(ctx, 'primo piano della notte');
      return;
    }
    const piano = this.#piano;
    if (!this.#definitivo && ora >= piano.inizioNotte - 30 * 60_000 && ora < piano.inizioNotte) {
      this.#definitivo = true;
      await this.#pianifica(ctx, 'piano definitivo delle 21:30');
    }
    for (const t of this.#piano.turni) {
      if ((t.stato === 'turno' || t.stato === 'ridotto') && !this.#avviati[t.zona] && t.inizio <= ora) this.#avvia(ctx, t);
    }
    if (!this.#riepilogo && ora >= this.#piano.fineNotte) {
      this.#riepilogo = true;
      await this.#riepiloga(ctx);
    }
  }

  #reset() {
    this.#piano = null;
    this.#avviati = {};
    this.#notificati.clear();
    this.#definitivo = false;
    this.#riepilogo = false;
  }

  /** Acqua per la notte (litri): vasca sopra la riserva + ricarica del pozzo, al massimo la dotazione. */
  #acquaDisponibile(ctx, ora) {
    const quota = this.#riduzione ? Number(this.#riduzione.quota) || 0.6 : 1;
    const dotazione = SERBATOIO.dotazioneM3 * 1000 * quota;
    const fill = ctx.state.average('fill_pct', { zone: SERBATOIO.zona });
    if (typeof fill !== 'number') return dotazione;
    const cap = SERBATOIO.capacitaM3 * 1000;
    const { fine } = finestraNotte(ora);
    const ricarica = SERBATOIO.ricaricaM3h * 1000 * Math.max(0, (fine - ora) / H) * (this.#riduzione ? 0.5 : 1);
    // l'acqua dei turni già partiti è già uscita (in parte) dalla vasca: va contata nel totale della notte
    const usata = Object.values(this.#avviati).reduce((s, t) => s + (t.litri * Math.min(1, Math.max(0, ora - t.inizio) / (t.fine - t.inizio))), 0);
    const daVasca = (fill / 100) * cap - (SERBATOIO.riservaPct / 100) * cap + ricarica + usata;
    return Math.max(0, Math.floor(Math.min(dotazione, daVasca) / 500) * 500);
  }

  async #pianifica(ctx, motivo) {
    if (!this.#previsione) return;
    const ora = ctx.state.simTime();
    const umidita = {};
    for (const z of Object.keys(CAMPI)) {
      const v = ctx.state.average('soil_moisture_pct', { zone: z });
      if (typeof v === 'number') umidita[z] = v;
    }
    const prev = this.#previsione;
    const piano = pianificaNotte({ umidita, previsione: prev, ora, disponibileL: this.#acquaDisponibile(ctx, ora), avviati: this.#avviati });
    this.#piano = piano;

    // posizione in classifica di priorità (1 = primo)
    const classifica = piano.turni.filter((t) => typeof t.priorita === 'number').sort((a, b) => b.priorita - a.priorita);
    const azioni = piano.turni.map((t) => ({
      type: t.stato === 'turno' || t.stato === 'ridotto' ? 'turno' : t.stato === 'rinviato' ? 'rinvio' : 'nessun_turno',
      zone: t.zona,
      stato: t.avviato ? 'avviato' : t.stato,
      litri: t.litri,
      minuti: t.minuti,
      inizio: t.inizio ?? null,
      fine: t.fine ?? null,
      motivo: t.motivo,
      priorita: t.priorita ?? null,
      posto: classifica.indexOf(t) + 1 || null,
      fabbisognoL: t.fabbisognoL ?? 0,
      calendarioL: t.calendarioL,
      label: etichettaTurno(t),
    }));
    const fonte = prev.fonte === 'open-meteo' ? 'Open-Meteo (reale)' : `simulata (${prev.motivo})`;
    ctx.decide(riassuntoPiano(piano), {
      level: piano.tagliati ? 'warning' : 'good',
      actions: azioni,
      reasoning:
        `${motivo[0].toUpperCase()}${motivo.slice(1)}. Priorità: stress idrico, fase colturale, pioggia prevista. ` +
        `Domani ET0 ${fmt(prev.et0Domani)} mm e pioggia ${fmt(prev.pioggiaDomani)} mm, previsione ${fonte}` +
        `${this.#riduzione ? '; dotazione ridotta del 40 %' : ''}. Kc da FAO-56.`,
    });
    ctx.metric('litri_risparmiati', piano.risparmioL, 'L', { label: 'Acqua risparmiata vs calendario' });
    ctx.metric('acqua_assegnata', Math.round(piano.totaleL / 1000), 'm³', { label: 'Acqua assegnata stanotte' });
    ctx.metric('turni_tagliati', piano.tagliati, '', { label: 'Turni ridotti o rinviati' });

    // un messaggio a ogni agricoltore il cui turno è nuovo o cambiato
    for (const t of piano.turni) {
      if (t.avviato) continue;
      const prima = this.#notificati.get(t.zona);
      if (!turnoCambiato(prima, t)) continue;
      this.#notificati.set(t.zona, t);
      const base = testoTurno(t, prev, { aggiornamento: Boolean(prima) });
      const testo = await this.#riformula(ctx, base);
      ctx.notify('whatsapp', t.contatto, testo[0].toUpperCase() + testo.slice(1));
    }
  }

  #avvia(ctx, t) {
    this.#avviati[t.zona] = { stato: t.stato, motivo: t.motivo, litri: t.litri, minuti: t.minuti, inizio: t.inizio, fine: t.fine, fabbisognoL: t.fabbisognoL, priorita: t.priorita };
    const c = CAMPI[t.zona];
    ctx.decide(`Acqua aperta al ${c.nome}: ${durata(t.minuti)}, ${litriTesto(t.litri)}`, {
      level: 'info',
      actions: [{ type: 'apri_valvola', zone: t.zona, litri: t.litri, minuti: t.minuti, inizio: t.inizio, label: `C${c.n} acqua ${formatClock(t.inizio)}-${formatClock(t.fine)}` }],
      reasoning: `${c.agricoltore}, ${COLTURE[c.coltura].breve} in ${c.fase}: ${t.motivo}. Chiusura alle ${formatClock(t.fine)}.`,
    });
  }

  async #riepiloga(ctx) {
    const turni = Object.values(this.#avviati);
    const litri = turni.reduce((s, t) => s + t.litri, 0);
    const risparmio = (this.#piano?.calendarioL ?? 0) - litri;
    const fill = ctx.state.average('fill_pct', { zone: SERBATOIO.zona });
    const base =
      `Buongiorno! Stanotte ${turni.length} turni d'acqua, ${fmt(litri / 1000, 0)} m³ in tutto: ` +
      `${risparmio >= 0 ? 'risparmiati' : 'usati in più'} ${litriTesto(Math.abs(risparmio))} rispetto ai turni a calendario.` +
      (typeof fill === 'number' ? ` La vasca è al ${Math.round(fill)} %.` : '');
    ctx.decide(`Notte conclusa: ${turni.length} turni, ${fmt(litri / 1000, 0)} m³`, {
      level: 'good',
      actions: [{ type: 'riepilogo', label: `${fmt(litri / 1000, 0)} m³ · ${risparmio >= 0 ? '−' : '+'}${fmt(Math.abs(risparmio) / 1000, 0)} m³ vs calendario` }],
      reasoning: 'Confronto: turno fisso ogni notte per ogni campo, dimensionato sul picco di luglio (ET0 6,5 mm × Kc), senza guardare pioggia e suolo.',
    });
    ctx.notify('whatsapp', GRUPPO, await this.#riformula(ctx, base));
  }

  async #riformula(ctx, base) {
    if (ctx.llm.isMock) return base;
    const { text } = await ctx.llm.complete({ system: SYSTEM, prompt: `Riscrivi questo messaggio mantenendo tutti i dati:\n${base}`, fallback: base });
    return text || base;
  }

  // ---------------------------------------------------------------- chat

  /** Risposta a POST /api/chat (dashboard, WhatsApp via OpenClaw). */
  async onChat({ from, text }, ctx) {
    const risposta = rispostaConsorzio(text, { state: ctx.state, piano: this.#piano, previsione: this.#previsione, avviati: this.#avviati });
    if (ctx.llm.isMock) return risposta;
    const { text: reply } = await ctx.llm.complete({
      system: SYSTEM,
      prompt:
        `Domanda di ${from}: "${text}"\n\nRisposta di riferimento basata sulle regole e sui dati: ${risposta}\n` +
        'Rispondi alla domanda usando solo questi dati, in modo breve.',
      fallback: risposta,
    });
    return reply;
  }

  /** Per i test e per la chat: il piano corrente (sola lettura). */
  get piano() {
    return this.#piano;
  }
}

/** Risposte a regole: funzionano sempre, anche senza LLM. */
export function rispostaConsorzio(text, { state, piano, previsione, avviati = {} }) {
  const t = text.toLowerCase();
  const ora = state.simTime();
  const theta = (z) => state.average('soil_moisture_pct', { zone: z });
  const meteo = previsione ? `${fraseMeteo(previsione)} (previsione ${previsione.fonte === 'open-meteo' ? 'Open-Meteo' : 'simulata'})` : '';

  // campo indicato per numero ("campo 3", "il 3"), per agricoltore o per coltura
  const num = /campo\s*n?\.?\s*(\d{1,2})\b/.exec(t)?.[1] ?? /\b(?:il|del|al)\s+(\d{1,2})\b/.exec(t)?.[1];
  let trovato = num ? trovaCampo(num) : null;
  if (!trovato) trovato = Object.entries(CAMPI).find(([, c]) => t.includes(c.agricoltore.toLowerCase())) ?? null;
  if (!trovato) {
    const perColtura = Object.entries(CAMPI).filter(([, c]) => t.includes(COLTURE[c.coltura].breve.split(' ')[0].toLowerCase()));
    if (perColtura.length === 1) trovato = perColtura[0];
  }

  if (trovato) {
    const [zona, c] = trovato;
    const th = theta(zona);
    const intro = `${c.nome} (${COLTURE[c.coltura].breve}, ${c.fase}, ${c.agricoltore})`;
    const suolo = typeof th === 'number' ? ` Umidità del suolo adesso: ${fmt(th)} % (${livelloUmidita(th).label.toLowerCase()}).` : '';
    if (!piano) return `${intro}: il piano di stanotte non è ancora pronto, aspetto i dati dei sensori.${suolo}`;
    const turno = piano.turni.find((x) => x.zona === zona);
    const a = avviati[zona];
    let quando;
    if (a && ora < a.fine) quando = `sta irrigando adesso, fino alle ${formatClock(a.fine)} (${litriTesto(a.litri)}).`;
    else if (a) quando = `irrigato stanotte dalle ${formatClock(a.inizio)} alle ${formatClock(a.fine)}, ${litriTesto(a.litri)}.`;
    else if (turno?.stato === 'turno' || turno?.stato === 'ridotto')
      quando = `irriga stanotte alle ${formatClock(turno.inizio)} per ${durata(turno.minuti)}: ${litriTesto(turno.litri)}${turno.stato === 'ridotto' ? ' (turno ridotto: acqua limitata)' : ''}.`;
    else if (turno?.stato === 'rinviato') quando = `stanotte niente turno: ${turno.motivo}. Il turno passa a domani notte.`;
    else quando = `stanotte non serve irrigare: ${turno?.motivo ?? 'nessun dato'}.`;
    return `${intro}: ${quando}${suolo} ${meteo}`.trim();
  }

  if (/quando|turn|irrig|piano|stanotte|programma/.test(t)) {
    if (!piano) return 'Il piano di stanotte non è ancora pronto: aspetto i dati dei sensori e la previsione.';
    const attivi = piano.turni.filter((x) => x.litri > 0);
    const elenco = attivi.map((x) => `campo ${x.n} alle ${formatClock(x.inizio)} per ${durata(x.minuti)}`).join(', ');
    const altri = piano.turni.filter((x) => !x.litri).map((x) => x.n);
    return (
      `Stanotte ${attivi.length} turni: ${elenco || 'nessuno'}.` +
      (altri.length ? ` Senza turno: campi ${altri.join(', ')}.` : '') +
      ' Per il tuo campo chiedi ad esempio "quando irrigo il campo 3?".'
    );
  }
  if (/vasca|serbatoio|pozzo|riserva|acqua disponibile/.test(t)) {
    const fill = state.average('fill_pct', { zone: SERBATOIO.zona });
    if (typeof fill !== 'number') return 'Non ho ancora la lettura del livello della vasca.';
    return (
      `La vasca consortile è al ${Math.round(fill)} % (${fmt((fill / 100) * SERBATOIO.capacitaM3, 0)} m³ su ${SERBATOIO.capacitaM3}).` +
      (piano ? ` Stanotte assegnati ${fmt(piano.totaleL / 1000, 0)} m³ su ${fmt(piano.disponibileL / 1000, 0)} disponibili.` : '')
    );
  }
  if (/risparm|calendario|litri|consum/.test(t)) {
    if (!piano) return 'Il piano di stanotte non è ancora pronto.';
    return `Stanotte assegniamo ${litriTesto(piano.totaleL)}: con i turni a calendario sarebbero ${litriTesto(piano.calendarioL)}, quindi ${piano.risparmioL >= 0 ? 'risparmiamo' : 'usiamo in più'} ${litriTesto(Math.abs(piano.risparmioL))}.`;
  }
  if (/piov|pioggia|meteo|previsio|tempo|caldo|et0/.test(t)) {
    if (!previsione) return 'Non ho ancora la previsione.';
    const reale = previsione.fonte !== 'open-meteo' && previsione.reale
      ? ` Open-Meteo, per la data reale di domani: pioggia ${fmt(previsione.reale.pioggiaDomani)} mm, ET0 ${fmt(previsione.reale.et0Domani)} mm.`
      : '';
    return `Domani: pioggia ${fmt(previsione.pioggiaDomani)} mm, evapotraspirazione ${fmt(previsione.et0Domani)} mm. Fonte: ${previsione.fonte === 'open-meteo' ? 'Open-Meteo' : `previsione simulata (${previsione.motivo})`}.${reale}`;
  }
  if (/stress|secc|asciutt|sete/.test(t)) {
    const lista = Object.entries(CAMPI)
      .map(([z, c]) => ({ c, th: theta(z) }))
      .filter((x) => typeof x.th === 'number' && livelloUmidita(x.th).id === 'stress');
    return lista.length
      ? `In stress idrico: ${lista.map((x) => `${x.c.nome} (${fmt(x.th)} %)`).join(', ')}. Hanno la precedenza nei turni di stanotte.`
      : 'Nessun campo in stress idrico in questo momento.';
  }
  if (/ciao|salve|buongiorno|buonasera|stato|situazione|come va/.test(t)) {
    const stress = Object.keys(CAMPI).filter((z) => typeof theta(z) === 'number' && theta(z) < 18).length;
    const fill = state.average('fill_pct', { zone: SERBATOIO.zona });
    return (
      `Ciao! Sono le ${formatClock(ora)}. Seguo ${Object.keys(CAMPI).length} campi: ${stress} in stress idrico.` +
      (typeof fill === 'number' ? ` Vasca al ${Math.round(fill)} %.` : '') +
      (piano ? ` Stanotte ${piano.turni.filter((x) => x.litri > 0).length} turni.` : '')
    );
  }
  return 'Posso dirti quando irrigare un campo ("quando irrigo il campo 3?"), i turni di stanotte, il livello della vasca, la pioggia prevista o quanta acqua risparmiamo.';
}
