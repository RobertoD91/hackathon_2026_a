// Agenti di TwinCiro 3D: un orchestratore (la voce di CiroGPT nel gemello) che capisce la domanda,
// la passa agli agenti specializzati e mette insieme le risposte.
//
//   Mobilità   → percorsi (Transitous dal vivo, riserva sul grafo GTFS), stazioni, corse
//   Folla      → stima e previsione per luogo, aree critiche, flussi
//   Eventi     → calendario reale (Comune, Serie A, crociere) e scenari
//   Meteo      → meteo dell'ora, previsione, allerta della Protezione Civile, aria
//   Turismo    → cosa visitare adesso senza folla
//   Simulatore → scenari what-if per la sala operativa
//
// Qui gli agenti ragionano A REGOLE: testo deterministico costruito sui dati, che funziona senza
// rete e senza chiavi (è lo schema del resto della repo: il testo a regole è sempre il `fallback`).
// Ogni risposta porta con sé i `passi` (chi ha detto cosa) e le `azioni` da eseguire sulla mappa 3D.
// Modulo isomorfo: lo provano i test.

import { LUOGHI3D, ETICHETTE_LIVELLO, distanzaKm } from './luoghi3d.js';
import { ORA, GIORNO, IPOTESI, flussi, creaModello } from './modello.js';
import { stazioniVicine } from './rete.js';
import { trovaPercorso } from './percorsi.js';
import * as N from '../../shared/iot-agents/example/fonti/normalizza.js';

export const AGENTI = Object.freeze({
  orchestratore: { nome: 'Orchestratore', colore: '#e879f9' },
  mobilita: { nome: 'Mobilità', colore: '#38bdf8' },
  folla: { nome: 'Folla', colore: '#facc15' },
  eventi: { nome: 'Eventi', colore: '#86efac' },
  meteo: { nome: 'Meteo e ambiente', colore: '#93c5fd' },
  turismo: { nome: 'Turismo', colore: '#fb923c' },
  simulatore: { nome: 'Simulatore what-if', colore: '#c4b5fd' },
});

// ------------------------------------------------------------------ formati

const nf = new Intl.NumberFormat('it-IT');
export const num = (n) => nf.format(Math.round(n));
const circa = (n) => (n >= 1000 ? `${num(Math.round(n / 100) * 100)}` : `${num(Math.round(n / 10) * 10)}`);
const pct = (q) => `${Math.round(q * 100)}%`;
/** Quota rispetto alla soglia, a parole: "71% della soglia", "7 volte la soglia". */
const soglia = (q) => (q >= 2 ? `${q >= 10 ? Math.round(q) : (Math.round(q * 10) / 10).toString().replace('.', ',')} volte la soglia` : `${pct(q)} della soglia`);
const hh = (ts) => N.oraBreve(ts);
const GIORNI = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];

/** "oggi", "domani", "ieri" oppure "lunedì 16 nov". */
export function giornoParlato(ts, adesso) {
  const g = N.giornoLocale(ts);
  if (g === N.giornoLocale(adesso)) return 'oggi';
  if (g === N.giornoLocale(adesso + GIORNO)) return 'domani';
  if (g === N.giornoLocale(adesso - GIORNO)) return 'ieri';
  const p = N.partiLocali(ts);
  return `${GIORNI[new Date(Date.UTC(p.anno, p.mese - 1, p.giorno)).getUTCDay()]} ${N.dataBreve(ts, adesso)}`;
}
const quando = (ts, adesso) => (Math.abs(ts - adesso) < 20 * 60_000 ? 'adesso' : `${giornoParlato(ts, adesso)} alle ${hh(ts)}`);
const nomeLuogo = (z) => LUOGHI3D[z]?.parlato ?? LUOGHI3D[z]?.breve ?? LUOGHI3D[z]?.nome ?? z;

// ------------------------------------------------------------------ capire la domanda

/** Luoghi citati in un testo, nell'ordine in cui compaiono: [{ zona, pos }]. */
export function luoghiCitati(testo, luoghi = LUOGHI3D) {
  const t = ` ${N.piatto(testo)} `;
  const trovati = [];
  for (const [zona, l] of Object.entries(luoghi)) {
    let migliore = null;
    for (const p of [l.nome, l.breve, ...(l.parole || [])]) {
      const q = N.piatto(p);
      if (q.length < 4) continue;
      const pos = t.indexOf(` ${q} `);
      if (pos >= 0 && (!migliore || q.length > migliore.lun)) migliore = { zona, pos, lun: q.length };
    }
    if (migliore) trovati.push(migliore);
  }
  // se due luoghi rivendicano lo stesso pezzo di testo vince la parola più lunga
  trovati.sort((a, b) => b.lun - a.lun);
  const tenuti = [];
  for (const x of trovati) if (!tenuti.some((y) => x.pos < y.pos + y.lun && y.pos < x.pos + x.lun)) tenuti.push(x);
  return tenuti.sort((a, b) => a.pos - b.pos);
}

/** Momento citato nel testo: { ts, giorno (inizio del giorno), esplicito }. */
export function momentoCitato(testo, adesso) {
  const t = ` ${N.piatto(testo)} `;
  let base = adesso;
  let esplicito = false;
  let giornoIntero = false;
  if (/ dopodomani | day after tomorrow /.test(t)) { base = adesso + 2 * GIORNO; esplicito = giornoIntero = true; }
  else if (/ domani | tomorrow /.test(t)) { base = adesso + GIORNO; esplicito = giornoIntero = true; }
  else if (/ ieri | yesterday /.test(t)) { base = adesso - GIORNO; esplicito = giornoIntero = true; }
  const g0 = N.inizioGiorno(N.giornoLocale(base));
  let ts = base;
  const alle = / (?:alle|all|at|ore|h) (?:ore )?(\d{1,2})(?: (\d{2}))? /.exec(t);
  const tra = / (?:tra|fra|in) (\d{1,2}) (ore|ora|hours|hour|minuti|minutes) /.exec(t);
  if (alle && +alle[1] < 24) { ts = g0 + (+alle[1]) * ORA + (+(alle[2] || 0)) * 60_000; esplicito = true; giornoIntero = false; }
  else if (tra) { ts = adesso + (+tra[1]) * (/min/.test(tra[2]) ? 60_000 : ORA); esplicito = true; }
  else if (/ stasera | tonight | questa sera | in serata | di sera /.test(t)) { ts = g0 + 20 * ORA; esplicito = true; giornoIntero = false; }
  else if (/ stanotte | notte /.test(t)) { ts = g0 + 23 * ORA; esplicito = true; giornoIntero = false; }
  else if (/ pomeriggio | afternoon /.test(t)) { ts = g0 + 16 * ORA; esplicito = true; giornoIntero = false; }
  else if (/ mattina | stamattina | morning | mattinata /.test(t)) { ts = g0 + 10.5 * ORA; esplicito = true; giornoIntero = false; }
  else if (/ pranzo | lunch /.test(t)) { ts = g0 + 13 * ORA; esplicito = true; giornoIntero = false; }
  else if (giornoIntero) ts = g0 + 11 * ORA;
  return { ts, giorno: g0, esplicito, giornoIntero };
}

const RE = {
  percorso: / come (?:ci )?(?:arriv|raggiung|vado|si va|si arriva|faccio ad arrivare)| portami | percorso | raggiungere | per andare | strada per | devo andare | voglio andare | how (?:can|do|could) i (?:get|reach|go)| how to (?:get|reach)| get to | way to | directions /,
  impatto: /(?:event|partit|concert|regat|manifestaz|gara|festival|crocier|nav[ei] ).*(?:fluss|critic|folla|affoll|impatt|evolv|succede)|fluss.*(?:pedonal|evolv|folla)|aree? .*critic|zone .*critic|critical areas|pedestrian flow|which areas|most critical|punti critici|criticita/,
  eventi: / che eventi| quali eventi| eventi (?:di |per |ci sono )?(?:oggi|domani|stasera|in programma)| cosa c e (?:oggi|domani|stasera|da fare)| in programma | what s on | events (?:today|tomorrow|tonight)| calendario /,
  tranquilli: / meno (?:folla|gente|affollat)| tranquill| senza folla| evitare la folla| poca gente| less crowded| quiet | cosa (?:posso |possiamo |potrei |mi consigli di )?(?:visitare|vedere|fare)| consigli| consigliami| what (?:can i|to|should i) (?:visit|see|do)| dove (?:posso )?andare /,
  classifica: / piu affollat| dove c e (?:piu )?(?:folla|gente)| most crowded| situazione (?:in citta|generale|della citta|adesso)| com e la citta| panoramica | overview | quadro (?:della citta|generale)| come va (?:la citta|napoli)/,
  folla: / folla | affollat| gente | pien[oa] | coda | code | fila | quanta | quante persone| crowd| busy | situazione | com e | conviene andare | quando andare | momento migliore | best time /,
  meteo: / meteo | piov| pioggia | ombrello | temperatura | caldo | freddo | vento | weather | rain | tempo fa | che tempo /,
  aria: / aria | smog | inquin| pm10 | polveri | air quality /,
  allerta: / allert| protezione civile | alert | rischio /,
  passaggi: / prossim[oaie] (?:treno|treni|metro|corsa|corse|passagg|funicolare|partenz)| quando passa | next (?:train|metro|departure)| orari /,
  whatif: / cosa succede se | che succede se | what if | simula | ipotizz| se chiud| chiude la | chiudesse | sciopero | se piove | se piovesse | se arrivano | aggiungi (?:un )?evento| se ci fosse | e se /,
  saluto: /^ (?:ciao|salve|buongiorno|buonasera|hello|hi|hey|ue|ehi)(?: ciro| cirogpt)? $/,
  misure: / diversion| scaglion| navett| misure | mitig| intervent| cosa (?:possiamo|si puo) fare| come (?:riduc|evit|gest)/,
};

const LINEE_PARLATE = [
  [/ linea 1 | l1 | metro 1 | metro linea 1 /, 'L1'],
  [/ linea 2 | l2 | metro 2 | metro linea 2 /, 'L2'],
  [/ linea 6 | l6 | metro 6 | metro linea 6 /, 'L6'],
  [/ cumana /, 'Cumana'],
  [/ circumflegrea /, 'Circumflegrea'],
  [/ circumvesuviana | vesuviana /, 'Circumvesuviana'],
  [/ funicolare centrale /, 'F3'],
  [/ funicolare (?:di )?chiaia /, 'F1'],
  [/ funicolare (?:di )?mergellina /, 'F4'],
];

/** Analisi della domanda: intento, luoghi, momento, parametri degli scenari. */
export function capisci(testo, adesso) {
  const t = ` ${N.piatto(testo)} `;
  const luoghi = luoghiCitati(testo);
  const m = momentoCitato(testo, adesso);
  const linee = LINEE_PARLATE.filter(([re]) => re.test(t)).map(([, s]) => s);
  const migliaia = / (\d{1,3})(?: |\.)?(\d{3})? ?(mila|k|persone|spettatori|people) /.exec(t);
  let persone = null;
  if (migliaia) persone = migliaia[2] ? Number(migliaia[1] + migliaia[2]) : Number(migliaia[1]) * (/mila|k/.test(migliaia[3]) ? 1000 : 1);
  let intento = 'aiuto';
  if (RE.saluto.test(t)) intento = 'saluto';
  else if (RE.whatif.test(t) && (linee.length || / piov| piogg| event| concert| partit| nav[ei] | sciopero | chiud/.test(t))) intento = 'whatif';
  else if (RE.percorso.test(t)) intento = 'percorso';
  else if (RE.impatto.test(t)) intento = 'impatto';
  else if (RE.misure.test(t)) intento = 'misure';
  else if (RE.passaggi.test(t)) intento = 'passaggi';
  else if (RE.eventi.test(t)) intento = 'eventi';
  else if (RE.tranquilli.test(t)) intento = 'tranquilli';
  else if (RE.classifica.test(t)) intento = 'classifica';
  else if (RE.allerta.test(t)) intento = 'meteo';
  else if (RE.aria.test(t)) intento = 'aria';
  else if (RE.meteo.test(t)) intento = 'meteo';
  else if (luoghi.length && RE.folla.test(t)) intento = 'folla';
  else if (luoghi.length === 2) intento = 'percorso';
  else if (luoghi.length === 1) intento = 'folla';
  else if (RE.folla.test(t)) intento = 'classifica';

  // partenza e arrivo: "da X a Y", "sono (arrivato) a X ... raggiungere Y"
  let da = null, a = null;
  if (intento === 'percorso' && luoghi.length) {
    const partenza = /(?: sono (?:appena )?(?:arrivat[oaie] )?(?:a|al|allo|alla|all|in|nel|nella|ai|alle)| mi trovo| parto da| partendo da| da| dal| dallo| dalla| dall| from| arrived at| i am at| i m at| i am in) $/;
    const origine = luoghi.find((l) => partenza.test(t.slice(0, l.pos + 1)));
    if (luoghi.length >= 2) {
      da = (origine ?? luoghi[0]).zona;
      a = luoghi.find((l) => l.zona !== da).zona;
    } else if (origine && / da | dal | dalla | dallo | dall | from /.test(t) && !/ sono | arrivat| mi trovo | i am | i m /.test(t)) da = origine.zona;
    else a = luoghi[0].zona;
  }
  return { intento, testo, luoghi: luoghi.map((l) => l.zona), da, a, momento: m, linee, persone, pioggia: / piov| piogg| rain /.test(t), inglese: / (?:how|what|where|which|the|is|are|can|will) /.test(t) && !/ (?:come|cosa|dove|quali|che) /.test(t) };
}

// ------------------------------------------------------------------ agenti specializzati

function descriviTratta(t, i, n) {
  if (t.modo === 'piedi') {
    const dove = i === n - 1 ? 'fino a destinazione' : `fino a ${t.a.nome}`;
    return `a piedi ${t.minuti} min ${dove}`;
  }
  const mezzo = { metro: 'metro', funicolare: 'funicolare', treno: 'treno', bus: 'bus', tram: 'tram', traghetto: 'traghetto' }[t.modo] || 'mezzo';
  const linea = /^(L\d|F\d)$/.test(t.linea) ? `${mezzo === 'metro' ? 'Linea' : 'Funicolare'} ${t.linea.slice(1)}` : `${mezzo} ${t.linea}`;
  const verso = t.verso ? ` verso ${t.verso}` : '';
  const parte = t.partenza && t.tempoReale !== undefined ? `, parte alle ${hh(t.partenza)}` : '';
  return `${linea}${verso} da ${t.da.nome} a ${t.a.nome} (${t.minuti} min, ${t.fermate} ${t.fermate === 1 ? 'fermata' : 'fermate'}${parte})`;
}

export function descriviPercorso(it) {
  return it.tratte.map((t, i) => descriviTratta(t, i, it.tratte.length)).join(' → ');
}

/** Agente Mobilità: percorso migliore e alternative tra due punti. */
async function agenteMobilita(ctx, da, a, ts) {
  const scenario = ctx.modello.scenario || {};
  const r = await trovaPercorso(ctx.rete, da, a, { ts, lineeChiuse: scenario.lineeChiuse || [], soloLocale: ctx.soloLocale, timeoutMs: ctx.timeoutMs });
  if (!r.migliore) return { testo: 'Non trovo un percorso con i mezzi che conosco.', percorso: null, alternative: [], fonte: r.fonte };
  const m = r.migliore;
  let testo = `${m.minuti} minuti${m.cambi ? `, ${m.cambi} ${m.cambi === 1 ? 'cambio' : 'cambi'}` : m.soloPiedi ? '' : ', senza cambi'}: ${descriviPercorso(m)}. Arrivo alle ${hh(m.arrivo)}.`;
  if (scenario.lineeChiuse?.length) testo += ` Ho escluso ${scenario.lineeChiuse.join(', ')} (chiusa nello scenario).`;
  if (r.alternative[0]) testo += ` Alternativa: ${r.alternative[0].soloPiedi ? 'a piedi' : r.alternative[0].linee.join(' + ')}, ${r.alternative[0].minuti} min.`;
  if (m.tratte.some((t) => t.indicativa)) testo += ' Alibus: tracciato e frequenza indicativi.';
  testo += ` Fonte: ${r.nota}.`;
  return { testo, percorso: m, alternative: r.alternative, fonte: r.fonte };
}

/** Agente Folla: stato di un luogo a un istante, con tendenza e momento migliore. */
function agenteFollaLuogo(ctx, zona, ts) {
  const s = ctx.modello.stima(zona, ts);
  const dopo = ctx.modello.stima(zona, ts + ORA);
  const tendenza = dopo.persone > s.persone * 1.12 ? 'in aumento' : dopo.persone < s.persone * 0.88 ? 'in calo' : 'stabile';
  const g0 = N.inizioGiorno(N.giornoLocale(ts));
  const chiusura = LUOGHI3D[zona].visita && LUOGHI3D[zona].profilo !== 'piazza' && LUOGHI3D[zona].profilo !== 'mare' ? 19 : 22;
  const giornata = ctx.modello.serie(zona, Math.max(ts, g0 + 9 * ORA), 13).filter((x) => x.ts <= g0 + chiusura * ORA && x.ts >= ts);
  const picco = giornata.reduce((p, x) => (x.quota > (p?.quota ?? -1) ? x : p), null);
  const migliore = giornata.reduce((p, x) => (x.quota < (p?.quota ?? 9) ? x : p), null);
  return { stima: s, tendenza, picco, migliore };
}

/** Agente Folla: alternative più tranquille vicino a un luogo. */
function alternativeTranquille(ctx, zona, ts, { n = 2, maxKm = 2.2 } = {}) {
  const q = ctx.modello.quadro(ts);
  return Object.keys(LUOGHI3D)
    .filter((z) => z !== zona && q[z].quota < 0.6 && LUOGHI3D[z].visita)
    .map((z) => ({ zona: z, km: distanzaKm(LUOGHI3D[zona], LUOGHI3D[z]), stima: q[z] }))
    .filter((x) => x.km <= maxKm)
    .sort((x, y) => x.km - y.km)
    .slice(0, n);
}

/** Agente Meteo: frase sul meteo di un istante, con l'allerta in corso. */
function agenteMeteo(ctx, ts) {
  const m = ctx.modello.meteoDi(ts) ?? (Math.abs(ts - ctx.adesso) < 2 * ORA ? Object.values(ctx.dati?.meteo || {})[0] : null);
  const a = ctx.dati?.allerta?.regionale;
  const inAllerta = a && a.livello >= 2 && !a.scaduta && a.dal <= ts && a.al >= ts;
  let testo;
  if (!m) testo = 'Non ho la previsione per quell’ora.';
  else {
    const mm = m.pioggia ?? 0;
    const pioggia = mm >= 4 ? `pioggia forte (${mm.toFixed(1).replace('.', ',')} mm/h)` : mm >= 1 ? `pioggia (${mm.toFixed(1).replace('.', ',')} mm/h)` : mm >= 0.2 ? 'pioggia debole' : 'niente pioggia';
    testo = `${(m.cielo || 'cielo n/d').toLowerCase()}, ${Math.round(m.temperatura)} °C, ${pioggia}${m.raffiche >= 40 ? `, raffiche a ${Math.round(m.raffiche)} km/h` : ''}`;
    testo = testo[0].toUpperCase() + testo.slice(1) + '.';
    if (m.scenario) testo += ' (pioggia dello scenario what-if)';
  }
  if (inAllerta) testo += ` Allerta ${a.colore} della Protezione Civile${a.tipi?.length ? ` (${N.descriviTipiAllerta(a.tipi)})` : ''} fino alle ${hh(a.al)} del ${N.dataBreve(a.al, ctx.adesso)}.`;
  // avvisi Meteoalarm (EUMETNET) validi a quell'ora: dato reale, arriva dallo snapshot
  const w = (ctx.dati?.allerta?.meteoalarm || []).filter((x) => x.livello >= 2 && x.inizio <= ts && x.fine >= ts)[0];
  if (w) testo += ` Meteoalarm segnala ${w.fenomeno.toLowerCase()} (allerta ${w.colore}) fino alle ${hh(w.fine)} del ${N.dataBreve(w.fine, ctx.adesso)}.`;
  return { testo, meteo: m, allerta: inAllerta ? a : w ? { colore: w.colore } : null };
}

/** Eventi di un giorno, senza doppioni: prima quelli che spostano folla. */
function eventiDelGiorno(ctx, g0) {
  const visti = new Set();
  return ctx.modello.eventiTra(g0 + 5 * ORA, g0 + GIORNO - 60_000).filter((e) => !visti.has(e.titolo) && visti.add(e.titolo));
}

const descriviEvento = (e) => `${e.titolo}${e.zona ? ` (${nomeLuogo(e.zona)}, ${hh(e.inizio)}–${hh(e.fine)}${e.persone >= 1000 ? `, ~${circa(e.persone)} persone ipotizzate` : ''})` : ''}${e.reale ? '' : ' [what-if]'}`;

// ------------------------------------------------------------------ orchestratore

/**
 * Risponde a una domanda.
 * @param {string} testo
 * @param {object} ctx { modello, modelloBase, rete, dati, adesso, ts (ora selezionata), zona (luogo selezionato), soloLocale }
 * @returns {Promise<{testo:string, passi:Array<{agente:string, testo:string}>, azioni:Array<object>, suggerimenti:string[], intento:string}>}
 */
export async function rispondi(testo, ctx) {
  const c = capisci(testo, ctx.adesso);
  const passi = [];
  const azioni = [];
  const dice = (agente, frase) => passi.push({ agente, testo: frase });
  const fine = (risposta, suggerimenti = []) => ({ testo: risposta, passi, azioni, suggerimenti, intento: c.intento, analisi: c });
  // l'ora della domanda: quella detta a voce, altrimenti quella scelta sulla linea del tempo
  const ts = c.momento.esplicito ? c.momento.ts : ctx.ts ?? ctx.adesso;
  const L = LUOGHI3D;

  switch (c.intento) {
    case 'saluto':
      dice('orchestratore', 'Saluto: rispondo io, senza coinvolgere altri agenti.');
      return fine('Ciao, sono CiroGPT dentro il gemello 3D di Napoli. Chiedimi come arrivare in un posto, dove c’è meno folla, cosa succede domani con gli eventi, oppure prova uno scenario what-if.', SUGGERIMENTI_BASE);

    case 'percorso': {
      let da = c.da, a = c.a;
      let nota = '';
      if (!a) return fine('Dimmi dove vuoi andare, per esempio: “come arrivo al Maradona?”', SUGGERIMENTI_BASE);
      if (!da) {
        da = ctx.zona && ctx.zona !== a ? ctx.zona : a === 'garibaldi' ? 'beverello' : 'garibaldi';
        nota = ctx.zona && ctx.zona !== a ? ` Parto dal luogo selezionato sulla mappa (${nomeLuogo(da)}).` : ` Non so dove sei: parto da ${nomeLuogo(da)}. Dimmi “da dove” per un percorso preciso.`;
      }
      dice('orchestratore', `Richiesta di percorso: ${nomeLuogo(da)} → ${nomeLuogo(a)}, partenza ${quando(ts, ctx.adesso)}. Chiedo a Mobilità, Folla, Eventi e Meteo.`);
      const mob = await agenteMobilita(ctx, { ...L[da], nome: nomeLuogo(da) }, { ...L[a], nome: nomeLuogo(a) }, ts);
      dice('mobilita', mob.testo);
      const arrivo = mob.percorso?.arrivo ?? ts + 30 * 60_000;
      const f = agenteFollaLuogo(ctx, a, arrivo);
      let follaTxt = `All’arrivo (${hh(arrivo)}) ${nomeLuogo(a)} è “${f.stima.etichetta.toLowerCase()}”: circa ${circa(f.stima.persone)} persone, ${soglia(f.stima.quota)}, ${f.tendenza}.`;
      const alt = f.stima.quota >= 0.85 ? alternativeTranquille(ctx, a, arrivo) : [];
      if (alt.length) follaTxt += ` Più tranquilli lì vicino: ${alt.map((x) => `${nomeLuogo(x.zona)} (${x.km.toFixed(1).replace('.', ',')} km)`).join(', ')}.`;
      dice('folla', follaTxt);
      const ev = ctx.modello.eventiTra(arrivo - 2 * ORA, arrivo + 5 * ORA).filter((e) => e.zona === a && e.persone >= 1000);
      dice('eventi', ev.length ? `A destinazione: ${ev.map(descriviEvento).join('; ')}.` : `Nessun grande evento a ${nomeLuogo(a)} nelle prossime ore.`);
      const met = agenteMeteo(ctx, ts);
      dice('meteo', met.testo);
      if (mob.percorso) azioni.push({ tipo: 'percorso', percorso: mob.percorso, da, a, fonte: mob.fonte });
      else azioni.push({ tipo: 'seleziona', zona: a });
      const partendo = Math.abs(ts - ctx.adesso) > 20 * 60_000 ? `Partendo ${quando(ts, ctx.adesso)}, da` : 'Da';
      const riassunto = (p) => (p.soloPiedi ? 'si va a piedi' : `${p.linee.map(etichettaLinea).join(', poi ')}${p.tratte[0].modo === 'piedi' && p.tratte[1] ? ` da ${p.tratte[1].da.nome}` : ''}`);
      let risposta = mob.percorso ? `${partendo} ${nomeLuogo(da)} a ${nomeLuogo(a)} ci vogliono ${mob.percorso.minuti} minuti: ${riassunto(mob.percorso)}. Arrivi alle ${hh(mob.percorso.arrivo)}.` : mob.testo;
      risposta += ` ${nomeLuogo(a)} sarà ${f.stima.etichetta.toLowerCase()} (${soglia(f.stima.quota)})`;
      risposta += ev.length ? `, attenzione: ${ev[0].titolo}.` : '.';
      if (alt.length) risposta += ` Se vuoi evitare la folla: ${nomeLuogo(alt[0].zona)}.`;
      const mm = met.meteo?.pioggia ?? 0;
      if (mm >= 0.2) risposta += ` Porta l’ombrello: ${mm >= 1 ? 'piove' : 'pioggia debole'}.`;
      if (met.allerta) risposta += ` Allerta ${met.allerta.colore} in corso.`;
      risposta += nota;
      dice('orchestratore', 'Metto insieme: percorso, folla all’arrivo, eventi e meteo. Disegno il percorso sulla mappa 3D.');
      return fine(risposta, [mob.percorso?.linee[0] ? `E se la ${etichettaLinea(mob.percorso.linee[0])} fosse chiusa?` : 'Cosa posso visitare lì vicino senza folla?', `Com’è la folla a ${nomeLuogo(a)} stasera?`, 'Cosa posso visitare lì vicino senza folla?']);
    }

    case 'impatto':
    case 'misure': {
      const g0 = c.momento.esplicito ? c.momento.giorno : N.inizioGiorno(N.giornoLocale(ts));
      const giorno = giornoParlato(g0 + 12 * ORA, ctx.adesso);
      dice('orchestratore', `Domanda da sala operativa: flussi e aree critiche di ${giorno}. Chiedo a Eventi, Folla, Mobilità e Meteo.`);
      const tutti = eventiDelGiorno(ctx, g0);
      const grandi = tutti.filter((e) => e.persone >= 1000 && e.zona);
      dice('eventi', grandi.length ? `${giorno[0].toUpperCase() + giorno.slice(1)} ${grandi.length === 1 ? 'c’è un grande evento' : `ci sono ${grandi.length} grandi eventi`}: ${grandi.map(descriviEvento).join('; ')}. Le affluenze sono ipotesi dichiarate.` : `Nessun grande evento in calendario per ${giorno}: la previsione segue la giornata tipo.`);
      const crit = ctx.modello.criticita(g0 + 6 * ORA, 18);
      const critiche = crit.filter((x) => x.oreCritiche > 0).slice(0, 5);
      const vivaci = crit.filter((x) => x.oreCritiche === 0 && x.picco.quota >= 0.7).slice(0, 3);
      const riga = (x) => `${nomeLuogo(x.zona)} (picco ${soglia(x.picco.quota)} alle ${hh(x.picco.ts)}, ${x.oreCritiche} ${x.oreCritiche === 1 ? 'ora' : 'ore'} sopra soglia)`;
      let follaTxt = critiche.length ? `Aree critiche previste: ${critiche.map(riga).join('; ')}.` : 'Nessun luogo supera la soglia “affollato”.';
      if (vivaci.length) follaTxt += ` Da tenere d’occhio: ${vivaci.map((x) => `${nomeLuogo(x.zona)} (${pct(x.picco.quota)} alle ${hh(x.picco.ts)})`).join(', ')}.`;
      // quando e da dove arrivano i flussi verso l'area più critica
      const cima = critiche[0] ?? crit[0];
      let flussoTxt = '';
      const stazioni = ctx.dati?.trasporti?.stazioni || [];
      if (cima) {
        let arrivo = null, uscita = null;
        for (let h = 6; h < 23; h++) {
          for (const fl of flussi(ctx.modello, g0 + h * ORA, { stazioni, minimo: 120 })) {
            if (fl.zona !== cima.zona) continue;
            if (fl.arrivo && (!arrivo || fl.persone > arrivo.persone)) arrivo = { ...fl, h };
            if (!fl.arrivo && (!uscita || fl.persone > uscita.persone)) uscita = { ...fl, h };
          }
        }
        if (arrivo) flussoTxt += ` Verso ${nomeLuogo(cima.zona)} il flusso più forte è tra le ${arrivo.h}:00 e le ${arrivo.h + 1}:00 (circa ${circa(arrivo.persone)} persone l’ora da ${arrivo.da.nome}).`;
        if (uscita) flussoTxt += ` Il deflusso parte verso le ${uscita.h}:00 in direzione ${uscita.a.nome}.`;
      }
      dice('folla', follaTxt + flussoTxt);
      const sotto = critiche.slice(0, 3).map((x) => ({ x, st: stazioniVicine(ctx.rete, L[x.zona], { n: 2, maxMetri: 900, ts: x.picco.ts }) })).filter((y) => y.st.length);
      dice('mobilita', sotto.length ? `Stazioni più sollecitate: ${sotto.map((y) => `${y.st.map((s) => `${s.nome} (${s.linee.join(', ')}, ${s.corseOra ?? '?'} corse/ora al picco${s.corseOra === 0 ? ': fuori servizio a quell’ora' : ''})`).join(' e ')} per ${nomeLuogo(y.x.zona)}`).join('; ')}.` : 'Nessuna stazione su ferro entro 900 metri dalle aree critiche: lì si arriva in bus o in auto.');
      const met = agenteMeteo(ctx, cima ? cima.picco.ts : g0 + 12 * ORA);
      dice('meteo', `Al picco: ${met.testo}`);
      const misure = [];
      if (critiche.length) {
        misure.push(`diversione dei flussi da ${nomeLuogo(critiche[0].zona)} verso i luoghi vicini più liberi`);
        if (grandi.length) misure.push('ingressi scaglionati agli eventi');
        if (sotto.length) misure.push(`più corse a ${sotto[0].st[0].nome} nelle ore di picco`);
      }
      dice('orchestratore', critiche.length ? `Propongo ${misure.length} misure e porto la mappa al picco di ${nomeLuogo(cima.zona)}. Lo scenario si può provare nella Sala operativa.` : 'Nessuna misura necessaria: porto la mappa all’ora di punta.');
      if (cima) {
        azioni.push({ tipo: 'ora', ts: cima.picco.ts });
        azioni.push({ tipo: 'evidenzia', zone: (critiche.length ? critiche : [cima]).map((x) => x.zona) });
        azioni.push({ tipo: 'inquadra', zone: (critiche.length ? critiche : [cima]).slice(0, 4).map((x) => x.zona) });
      }
      let risposta = grandi.length ? `${giorno[0].toUpperCase() + giorno.slice(1)}: ${grandi.map((e) => `${e.titolo} a ${nomeLuogo(e.zona)}`).join(' e ')}. ` : '';
      risposta += critiche.length ? `Le aree più critiche saranno ${critiche.slice(0, 3).map((x) => `${nomeLuogo(x.zona)} (${soglia(x.picco.quota)} alle ${hh(x.picco.ts)})`).join(', ')}.` : `Non prevedo aree critiche: il luogo più pieno sarà ${nomeLuogo(cima.zona)} (${pct(cima.picco.quota)} alle ${hh(cima.picco.ts)}).`;
      risposta += flussoTxt;
      if (misure.length) risposta += ` Misure consigliate: ${misure.join('; ')}.`;
      return fine(risposta, critiche.length ? ['Simula la diversione dei flussi', `E se ${giorno === 'oggi' ? 'oggi' : giorno} piove?`, `Come arrivo a ${nomeLuogo(cima.zona)}?`] : SUGGERIMENTI_BASE);
    }

    case 'eventi': {
      const g0 = c.momento.esplicito ? c.momento.giorno : N.inizioGiorno(N.giornoLocale(ts));
      const giorno = giornoParlato(g0 + 12 * ORA, ctx.adesso);
      dice('orchestratore', `Calendario di ${giorno}: chiedo a Eventi.`);
      const tutti = eventiDelGiorno(ctx, g0);
      dice('eventi', tutti.length ? tutti.map(descriviEvento).join('; ') + '. Fonti: Comune di Napoli, calendario Serie A (openfootball), scali delle navi.' : `Nessun evento in calendario per ${giorno}.`);
      const grandi = tutti.filter((e) => e.persone >= 1000 && e.zona);
      if (grandi.length) azioni.push({ tipo: 'evidenzia', zone: grandi.map((e) => e.zona) }, { tipo: 'inquadra', zone: grandi.map((e) => e.zona) });
      return fine(tutti.length ? `${giorno[0].toUpperCase() + giorno.slice(1)} a Napoli: ${tutti.slice(0, 6).map(descriviEvento).join('; ')}.` : `Per ${giorno} non ho eventi in calendario.`, grandi.length ? [`Come cambiano i flussi ${giorno}?`, `Come arrivo a ${nomeLuogo(grandi[0].zona)}?`] : SUGGERIMENTI_BASE);
    }

    case 'folla': {
      const zona = c.luoghi[0] ?? ctx.zona;
      if (!zona) return fine('Di quale luogo vuoi sapere? Per esempio: “com’è la folla al Plebiscito?”', SUGGERIMENTI_BASE);
      dice('orchestratore', `Affollamento di ${nomeLuogo(zona)} ${quando(ts, ctx.adesso)}: chiedo a Folla ed Eventi.`);
      const f = agenteFollaLuogo(ctx, zona, ts);
      const s = f.stima;
      let txt = `${nomeLuogo(zona)} ${quando(ts, ctx.adesso)}: “${s.etichetta.toLowerCase()}”, tra ${circa(s.min)} e ${circa(s.max)} persone (${soglia(s.quota)}), ${f.tendenza}.`;
      if (f.picco && f.picco.ts !== s.ts) txt += ` Picco previsto alle ${hh(f.picco.ts)} (${pct(f.picco.quota)}).`;
      if (f.migliore && f.migliore.quota < s.quota - 0.1) txt += ` Il momento migliore è alle ${hh(f.migliore.ts)} (${ETICHETTE_LIVELLO[f.migliore.livello].toLowerCase()}).`;
      dice('folla', txt + ' Stima simulata: profilo storico, stagione ISTAT, meteo ed eventi reali.');
      const ev = s.componenti.eventi.filter((e) => e.persone >= 100);
      dice('eventi', ev.length ? `Pesano sulla stima: ${ev.map((e) => `${e.titolo} (+${circa(e.persone)})`).join(', ')}.` : 'Nessun evento pesa su questo luogo a quell’ora.');
      const alt = s.quota >= 0.6 ? alternativeTranquille(ctx, zona, ts) : [];
      if (alt.length) txt += ` Più tranquilli lì vicino: ${alt.map((x) => `${nomeLuogo(x.zona)} (${x.km.toFixed(1).replace('.', ',')} km, ${x.stima.etichetta.toLowerCase()})`).join(', ')}.`;
      azioni.push({ tipo: 'seleziona', zona });
      if (c.momento.esplicito) azioni.push({ tipo: 'ora', ts });
      return fine(txt, [`Come arrivo a ${nomeLuogo(zona)}?`, 'Cosa posso visitare lì vicino senza folla?', 'Qual è il posto più affollato adesso?']);
    }

    case 'classifica': {
      dice('orchestratore', `Quadro della città ${quando(ts, ctx.adesso)}: chiedo a Folla.`);
      const s = ctx.modello.sintesi(ts);
      const cima = s.classifica.slice(0, 4);
      const liberi = [...s.classifica].reverse().filter((x) => L[x.zona].visita).slice(0, 3);
      const txt = `${quando(ts, ctx.adesso)[0].toUpperCase() + quando(ts, ctx.adesso).slice(1)}: circa ${circa(s.totale)} persone nei ${s.classifica.length} luoghi monitorati; ${s.perLivello.affollato} affollati, ${s.perLivello.vivace} un po’ affollati. I più pieni: ${cima.map((x) => `${nomeLuogo(x.zona)} (${pct(x.quota)})`).join(', ')}. I più tranquilli da visitare: ${liberi.map((x) => nomeLuogo(x.zona)).join(', ')}.`;
      dice('folla', txt);
      azioni.push({ tipo: 'evidenzia', zone: cima.filter((x) => x.quota >= 0.85).map((x) => x.zona) });
      if (c.momento.esplicito) azioni.push({ tipo: 'ora', ts });
      return fine(txt, [`Com’è la folla a ${nomeLuogo(cima[0].zona)}?`, 'Cosa posso visitare adesso senza folla?', 'Come cambiano i flussi domani?']);
    }

    case 'tranquilli': {
      const rif = c.luoghi[0] ?? ctx.zona ?? null;
      dice('orchestratore', `Consigli senza folla ${quando(ts, ctx.adesso)}${rif ? ` vicino a ${nomeLuogo(rif)}` : ''}: chiedo a Turismo, Folla e Meteo.`);
      const met = agenteMeteo(ctx, ts);
      const piove = (met.meteo?.pioggia ?? 0) >= 0.3;
      dice('meteo', met.testo + (piove ? ' Meglio un luogo al chiuso.' : ''));
      const q = ctx.modello.quadro(ts);
      const ora = N.partiLocali(ts).ora;
      const candidati = Object.keys(L)
        .filter((z) => z !== rif && L[z].visita && q[z].quota < 0.6)
        .filter((z) => !(['museo', 'attrazione', 'parco'].includes(L[z].profilo) && (ora < 9 || ora >= 18))) // musei e monumenti chiusi la sera
        .map((z) => ({ zona: z, stima: q[z], km: rif ? distanzaKm(L[rif], L[z]) : 0, punteggio: q[z].quota + (rif ? distanzaKm(L[rif], L[z]) * 0.12 : 0) + (piove ? L[z].aperto * 0.5 : 0) - L[z].turisti * 0.2 }))
        .sort((x, y) => x.punteggio - y.punteggio)
        .slice(0, 3);
      dice('folla', `Luoghi sotto il 60% della soglia: ${Object.values(q).filter((x) => x.quota < 0.6).length} su ${Object.keys(q).length}.`);
      if (!candidati.length) {
        dice('turismo', 'A quest’ora i luoghi di visita sono chiusi o pieni.');
        return fine('A quest’ora non ho un luogo di visita tranquillo da consigliarti. Riprova per domani mattina.', SUGGERIMENTI_BASE);
      }
      const txt = candidati.map((x) => `${nomeLuogo(x.zona)} (${x.stima.etichetta.toLowerCase()}, ${soglia(x.stima.quota)}${rif ? `, a ${x.km.toFixed(1).replace('.', ',')} km` : ''})`).join('; ');
      dice('turismo', `Propongo: ${txt}.${piove ? ' Ho preferito i luoghi al chiuso perché piove.' : ''}`);
      azioni.push({ tipo: 'evidenzia', zone: candidati.map((x) => x.zona) }, { tipo: 'inquadra', zone: [...candidati.map((x) => x.zona), ...(rif ? [rif] : [])] });
      return fine(`${quando(ts, ctx.adesso)[0].toUpperCase() + quando(ts, ctx.adesso).slice(1)} ti consiglio: ${txt}.${piove ? ' Piove: ho scelto luoghi al chiuso.' : ''}`, [`Come arrivo a ${nomeLuogo(candidati[0].zona)}?`, 'Qual è il posto più affollato adesso?']);
    }

    case 'meteo': {
      dice('orchestratore', `Meteo ${quando(ts, ctx.adesso)}: chiedo a Meteo e ambiente.`);
      const met = agenteMeteo(ctx, ts);
      let txt = `${quando(ts, ctx.adesso)[0].toUpperCase() + quando(ts, ctx.adesso).slice(1)}: ${met.testo}`;
      const a = ctx.dati?.allerta?.regionale;
      if (!met.allerta && a) txt += a.livello >= 2 && !a.scaduta && a.al > ctx.adesso ? ` Allerta ${a.colore} valida fino alle ${hh(a.al)} del ${N.dataBreve(a.al, ctx.adesso)}.` : ' Nessuna allerta regionale in corso per Napoli.';
      // prossima pioggia nelle 24 ore
      let pioggia = null;
      for (let h = 0; h < 24 && !pioggia; h++) {
        const m = ctx.modello.meteoDi(ts + h * ORA);
        if ((m?.pioggia ?? 0) >= 0.3) pioggia = ts + h * ORA;
      }
      if (pioggia && pioggia > ts) txt += ` Prossima pioggia prevista ${giornoParlato(pioggia, ctx.adesso)} verso le ${hh(pioggia)}.`;
      dice('meteo', txt + ' Fonti: Open-Meteo, Protezione Civile Campania.');
      return fine(txt, ['Cosa posso visitare adesso senza folla?', 'E se domani piove?']);
    }

    case 'aria': {
      dice('orchestratore', 'Qualità dell’aria: chiedo a Meteo e ambiente.');
      const v = Object.values(ctx.dati?.aria || {}).map((x) => x.aqi).filter((x) => typeof x === 'number');
      if (!v.length) {
        dice('meteo', 'L’indice dell’aria non è disponibile in questo momento.');
        return fine('In questo momento non ho il dato sulla qualità dell’aria.', SUGGERIMENTI_BASE);
      }
      const aqi = Math.max(...v);
      const txt = `Qualità dell’aria a Napoli: ${N.livelloAria(N.classeAqi(aqi)).label.toLowerCase()} (indice europeo ${aqi}, modello Copernicus CAMS).`;
      dice('meteo', txt);
      return fine(txt, SUGGERIMENTI_BASE);
    }

    case 'passaggi': {
      const zona = c.luoghi[0] ?? ctx.zona ?? 'garibaldi';
      dice('orchestratore', `Corse vicino a ${nomeLuogo(zona)}: chiedo a Mobilità.`);
      const st = stazioniVicine(ctx.rete, L[zona], { n: 3, ts });
      if (!st.length) {
        dice('mobilita', 'Nessuna stazione su ferro entro 1,2 km.');
        return fine(`Vicino a ${nomeLuogo(zona)} non ci sono stazioni di metro, funicolari o treni.`, SUGGERIMENTI_BASE);
      }
      const txt = st.map((s) => `${s.nome} (${s.linee.join(', ')}) a ${s.piedi} min a piedi, ${s.corseOra ?? '?'} corse nell’ora`).join('; ');
      dice('mobilita', `${txt}. Orari programmati GTFS di ANM ed EAV.`);
      azioni.push({ tipo: 'seleziona', zona });
      return fine(`Stazioni vicino a ${nomeLuogo(zona)} ${quando(ts, ctx.adesso)}: ${txt}. I prossimi passaggi dal vivo sono nella scheda del luogo.`, [`Come arrivo a ${nomeLuogo(zona)}?`]);
    }

    case 'whatif': {
      const scenario = { eventi: [], lineeChiuse: [...(ctx.modello.scenario?.lineeChiuse || [])], pioggia: ctx.modello.scenario?.pioggia || null, navi: ctx.modello.scenario?.navi || null, misure: { ...(ctx.modello.scenario?.misure || {}) } };
      scenario.eventi.push(...(ctx.modello.scenario?.eventi || []));
      const cosa = [];
      const t = ` ${N.piatto(testo)} `;
      for (const l of c.linee) if (!scenario.lineeChiuse.includes(l)) { scenario.lineeChiuse.push(l); cosa.push(`${etichettaLinea(l)} chiusa`); }
      const g0 = c.momento.esplicito ? c.momento.giorno : N.inizioGiorno(N.giornoLocale(ts));
      if (c.pioggia) {
        const da = c.momento.esplicito && !c.momento.giornoIntero ? c.momento.ts - ORA : g0 + 9 * ORA;
        scenario.pioggia = { da, a: da + (c.momento.giornoIntero || !c.momento.esplicito ? 10 : 5) * ORA, mm: 5 };
        cosa.push(`pioggia forte ${giornoParlato(da, ctx.adesso)} dalle ${hh(scenario.pioggia.da)} alle ${hh(scenario.pioggia.a)}`);
      }
      if (/ event| concert| partit| festa | manifestaz| spettacol| notte bianca /.test(t) && (c.luoghi[0] || ctx.zona)) {
        const zona = c.luoghi[0] ?? ctx.zona;
        const inizio = c.momento.esplicito && !c.momento.giornoIntero ? c.momento.ts : g0 + 21 * ORA;
        const persone = c.persone ?? 15_000;
        scenario.eventi.push({ id: `chat:${zona}:${inizio}`, titolo: /concert/.test(t) ? `Concerto a ${nomeLuogo(zona)}` : /partit/.test(t) ? `Partita a ${nomeLuogo(zona)}` : `Evento a ${nomeLuogo(zona)}`, zona, inizio, durataOre: 3, persone });
        cosa.push(`evento a ${nomeLuogo(zona)} ${giornoParlato(inizio, ctx.adesso)} alle ${hh(inizio)} con ${num(persone)} persone`);
      }
      const navi = / (\d) nav[ei] /.exec(t);
      if (navi) { scenario.navi = { giorno: N.giornoLocale(g0 + 12 * ORA), n: Number(navi[1]) }; cosa.push(`${navi[1]} navi da crociera ${giornoParlato(g0 + 12 * ORA, ctx.adesso)}`); }
      if (/ diversion/.test(t)) { scenario.misure.diversione = true; cosa.push('diversione dei flussi'); }
      if (!cosa.length) return fine('Dimmi cosa simulare: per esempio “cosa succede se chiude la Linea 1?”, “e se domani piove?”, “simula un concerto al Plebiscito domani alle 21 con 20 mila persone”.', SUGGERIMENTI_WHATIF);
      dice('orchestratore', `Scenario what-if: ${cosa.join('; ')}. Lo passo al Simulatore e confronto con la situazione di partenza.`);
      const esito = confronta(ctx, scenario);
      dice('simulatore', esito.testo);
      azioni.push({ tipo: 'scenario', scenario });
      if (esito.peggiore) azioni.push({ tipo: 'ora', ts: esito.peggiore.picco.ts }, { tipo: 'evidenzia', zone: esito.zone }, { tipo: 'inquadra', zone: esito.zone.slice(0, 4) });
      dice('orchestratore', 'Scenario applicato alla mappa: nella Sala operativa puoi aggiungere misure o tornare alla situazione reale.');
      return fine(`Scenario: ${cosa.join('; ')}. ${esito.testo}`, ['Simula la diversione dei flussi', 'Torna alla situazione reale', 'Quali aree saranno più critiche?']);
    }

    default: {
      // "simula la diversione", "torna alla situazione reale": comandi della sala operativa
      const t = ` ${N.piatto(testo)} `;
      if (/ torna | reale | annulla | azzera | reset /.test(t) && ctx.modello.scenario && Object.keys(ctx.modello.scenario).length) {
        dice('orchestratore', 'Tolgo lo scenario what-if e torno ai dati reali.');
        azioni.push({ tipo: 'scenario', scenario: null });
        return fine('Fatto: la mappa mostra di nuovo la situazione reale e la sua previsione.', SUGGERIMENTI_BASE);
      }
      if (/ diversion| scaglion| navett/.test(t)) {
        const scenario = { ...(ctx.modello.scenario || {}), misure: { ...(ctx.modello.scenario?.misure || {}) } };
        const cosa = [];
        if (/ diversion/.test(t)) { scenario.misure.diversione = true; cosa.push('diversione dei flussi'); }
        if (/ scaglion/.test(t)) { scenario.misure.scaglionamento = true; cosa.push('ingressi scaglionati'); }
        if (/ navett/.test(t)) { scenario.misure.navette = true; cosa.push('navette e metro potenziata'); }
        dice('orchestratore', `Misure da provare: ${cosa.join(', ')}. Le passo al Simulatore.`);
        const esito = confronta(ctx, scenario);
        dice('simulatore', esito.testo);
        azioni.push({ tipo: 'scenario', scenario });
        return fine(`Misure applicate: ${cosa.join(', ')}. ${esito.testo}`, ['Torna alla situazione reale', 'Quali aree saranno più critiche?']);
      }
      dice('orchestratore', 'Non ho capito a quale agente passare la domanda: rispondo con quello che so fare.');
      return fine('Posso dirti come arrivare in un luogo con i mezzi, quanta folla c’è e ci sarà, cosa visitare senza coda, che eventi ci sono, il meteo e le allerte, e simulare scenari what-if (linea chiusa, pioggia, nuovo evento).', SUGGERIMENTI_BASE);
    }
  }
}

export const etichettaLinea = (s) => (/^L\d$/.test(s) ? `Linea ${s.slice(1)}` : /^F\d$/.test(s) ? { F1: 'Funicolare di Chiaia', F3: 'Funicolare Centrale', F4: 'Funicolare di Mergellina' }[s] || s : s);

/** Confronto tra lo scenario e la situazione di partenza nelle 48 ore di previsione. */
export function confronta(ctx, scenario, { ore = 48 } = {}) {
  const da = Math.floor(ctx.adesso / ORA) * ORA;
  const prima = ctx.modelloBase.indicatori(da, ore);
  const dopo = creaModello(ctx.contestoModello, scenario).indicatori(da, ore);
  const diff = (a, b) => (b === a ? 'invariato' : `${b > a ? '+' : '−'}${num(Math.abs(b - a))}`);
  const peggiori = dopo.dettaglio
    .map((x) => ({ ...x, prima: prima.dettaglio.find((y) => y.zona === x.zona) }))
    .map((x) => ({ ...x, delta: x.picco.quota - x.prima.picco.quota }))
    .sort((x, y) => y.delta - x.delta);
  const peggiore = peggiori[0]?.delta > 0.03 ? peggiori[0] : null;
  const migliorati = [...peggiori].reverse().filter((x) => x.delta < -0.03).slice(0, 2);
  let testo = `Nelle prossime ${ore} ore i luoghi critici passano da ${prima.luoghiCritici} a ${dopo.luoghiCritici} e le ore sopra soglia da ${prima.oreCritiche} a ${dopo.oreCritiche} (${diff(prima.oreCritiche, dopo.oreCritiche)}).`;
  if (peggiore) testo += ` Peggiora di più ${nomeLuogo(peggiore.zona)}: picco da ${soglia(peggiore.prima.picco.quota)} a ${soglia(peggiore.picco.quota)} (${giornoParlato(peggiore.picco.ts, ctx.adesso)} alle ${hh(peggiore.picco.ts)}).`;
  if (migliorati.length) testo += ` Migliora ${migliorati.map((x) => `${nomeLuogo(x.zona)} (dal ${pct(x.prima.picco.quota)} al ${pct(x.picco.quota)})`).join(' e ')}.`;
  if (!peggiore && !migliorati.length) testo += ' Nessun luogo cambia in modo sensibile.';
  return { testo, prima, dopo, peggiore, zone: peggiori.filter((x) => Math.abs(x.delta) > 0.03).slice(0, 5).map((x) => x.zona) };
}

export const SUGGERIMENTI_BASE = Object.freeze([
  'Sono appena arrivato al Porto: come raggiungo Fuorigrotta?',
  'Domani ci sono due grandi eventi: come evolvono i flussi e quali aree saranno critiche?',
  'Cosa posso visitare adesso senza folla?',
  'Qual è il posto più affollato adesso?',
]);
export const SUGGERIMENTI_WHATIF = Object.freeze(['Cosa succede se chiude la Linea 1?', 'E se domani piove?', 'Simula un concerto al Plebiscito domani alle 21 con 20 mila persone']);

export { IPOTESI };
