// Piano dei turni d'acqua della notte: regole deterministiche, nessun LLM. Lo usa l'agente
// consorzio (orchestratore); funzioni pure, provate da test/fattoria.test.js.
//
// Per ogni campo, con l'umidità del suolo misurata (θ, % vol) e la previsione di domani:
//   ETc   = ET0 domani × Kc                                   (FAO-56, mm)
//   Peff  = 0,8 × pioggia prevista, se ≥ 2 mm                 (pioggia efficace, indicativa)
//   θdom  = θ − (ETc − Peff) × k                              (umidità domani sera senza irrigare; k = 0,1/(zr·fw))
//   se θdom ≥ soglia della coltura → nessun turno ("domani piove", "suolo ancora umido", "l'olivo tollera")
//   altrimenti mm = (obiettivo − θdom) / k, senza superare 33 % stanotte; litri = mm / efficienza × superficie
//   (un campo già in stress con la pioggia in arrivo riceve comunque un turno breve per uscirne).
// Priorità: stress idrico (100) > asciutto (60) > ottimale (30), + 25 × sensibilità della fase,
// − 10 se domani piove. L'acqua disponibile si assegna in ordine di priorità; se non basta il
// turno è ridotto (almeno il 30 % del fabbisogno) o rinviato. I turni sono uno dopo l'altro
// dalle 22:00 alle 06:00, col modulo consortile (35 l/s), 5 minuti tra un turno e l'altro.
// Confronto: un turno a calendario fisso, ogni notte, dimensionato sul picco di luglio
// (ET0 6,5 mm × Kc / efficienza), senza guardare pioggia e umidità del suolo.

import { hourOf, formatClock } from '../../sim/sim-core.js';
import { CAMPI, COLTURE, SERBATOIO, SOGLIE_UMIDITA, parametri } from './campi.js';

export const PARAMETRI = Object.freeze({
  oraInizio: 22, // inizio della finestra notturna dei turni (meno evaporazione, energia meno cara)
  oraFine: 6,
  pausaMin: 5, // minuti tra un turno e l'altro (cambio di idrante)
  efficienza: 0.9, // efficienza dell'irrigazione a goccia (indicativa)
  pioggiaMinima: 2, // mm: sotto questa soglia la pioggia non conta
  quotaPioggiaEfficace: 0.8, // indicativa
  thetaMax: 33, // non portare il suolo oltre (sotto la saturazione)
  uscitaStress: 20, // % vol: il turno breve porta almeno qui un campo in stress
  quotaMinima: 0.3, // sotto il 30 % del fabbisogno il turno è rinviato
  et0Calendario: 6.5, // mm/giorno, picco di luglio per il turno a calendario (indicativo)
});

const H = 3_600_000;
const arrotonda = (litri) => Math.round(litri / 500) * 500;
const r1 = (v) => Math.round(v * 10) / 10;

/** Finestra notturna dei turni che contiene `ora` o, di giorno, quella della notte che viene. */
export function finestraNotte(ora, tz = 'Europe/Rome') {
  const h = hourOf(ora, tz);
  const { oraInizio, oraFine } = PARAMETRI;
  let inizio;
  if (h >= oraInizio) inizio = ora - (h - oraInizio) * H;
  else if (h < oraFine) inizio = ora - (h + 24 - oraInizio) * H;
  else inizio = ora + (oraInizio - h) * H;
  inizio = Math.round(inizio / 60_000) * 60_000;
  return { inizio, fine: inizio + (24 - oraInizio + oraFine) * H };
}

/** Litri di un turno a calendario fisso per il campo (confronto per il KPI). */
export function litriCalendario(campo) {
  return arrotonda((campo.area * PARAMETRI.et0Calendario * campo.kc) / PARAMETRI.efficienza);
}

/** Pioggia efficace (mm) dalla previsione. */
export function pioggiaEfficace(previsione) {
  const p = previsione?.pioggiaDomani ?? 0;
  return p >= PARAMETRI.pioggiaMinima ? p * PARAMETRI.quotaPioggiaEfficace : 0;
}

/**
 * Fabbisogno del campo per stanotte.
 * @returns {{serve: boolean, motivo: string, litri: number, mm: number, thetaDomani: number, etc: number, pEff: number}}
 */
export function fabbisognoCampo(campo, theta, previsione) {
  const p = parametri(campo);
  const etc = (previsione?.et0Domani ?? 0) * p.kc;
  const pEff = pioggiaEfficace(previsione);
  const thetaDomani = Math.min(40, theta - (etc - pEff) * p.k);
  const base = { thetaDomani: r1(thetaDomani), etc: r1(etc), pEff: r1(pEff), mm: 0, litri: 0 };
  if (theta >= SOGLIE_UMIDITA.saturo) return { ...base, serve: false, motivo: `il suolo è saturo (${fmt(theta)} %)` };
  let mm;
  let motivo;
  if (thetaDomani >= p.soglia) {
    if (theta < SOGLIE_UMIDITA.stress) {
      mm = (PARAMETRI.uscitaStress - theta) / p.k;
      motivo = `turno breve per uscire dallo stress${pEff > 0 ? `: domani piove (${fmt(previsione.pioggiaDomani)} mm)` : ''}`;
    } else {
      let perche;
      if (pEff > 0 && pEff >= etc) perche = `domani piove (${fmt(previsione.pioggiaDomani)} mm previsti)`;
      else if (theta < SOGLIE_UMIDITA.asciutto) perche = `${COLTURE[campo.coltura].breve}: tollera il suolo asciutto (soglia ${p.soglia} %)`;
      else perche = `il suolo è ancora umido (${fmt(theta)} %)`;
      return { ...base, serve: false, motivo: perche };
    }
  } else {
    mm = (p.obiettivo - thetaDomani) / p.k;
    motivo =
      theta < SOGLIE_UMIDITA.stress
        ? 'stress idrico'
        : `domani sera scenderebbe al ${fmt(thetaDomani)} % (soglia ${p.soglia} %)`;
  }
  mm = Math.min(mm, (PARAMETRI.thetaMax - theta) / p.k);
  const litri = arrotonda((mm / PARAMETRI.efficienza) * campo.area);
  if (mm <= 0.3 || litri <= 0) return { ...base, serve: false, motivo: 'fabbisogno trascurabile' };
  return { ...base, serve: true, motivo, mm: r1(mm), litri };
}

/** Priorità del campo (più alta = prima): stress, fase colturale, pioggia prevista. */
export function priorita(campo, theta, fabbisogno) {
  const p = parametri(campo);
  let v = theta < SOGLIE_UMIDITA.stress ? 100 : theta < SOGLIE_UMIDITA.asciutto ? 60 : 30;
  v += 25 * p.sensibilita;
  if (fabbisogno.pEff > 0) v -= 10;
  return Math.round(v);
}

/**
 * Pianifica i turni della notte.
 * @param {{umidita: Record<string, number>, previsione: object, ora: number, disponibileL: number,
 *          avviati?: Record<string, object>, campi?: object, moduloLmin?: number, tz?: string}} opts
 *   - umidita: zona → umidità del suolo (% vol) misurata
 *   - disponibileL: acqua della notte (litri), compresa quella dei turni già avviati
 *   - avviati: zona → turno già partito stanotte (resta com'è)
 * @returns piano { creato, inizioNotte, fineNotte, turni: [...], totaleL, disponibileL, calendarioL, risparmioL, tagliati, inStress }
 */
export function pianificaNotte(opts) {
  const { umidita, previsione, ora, disponibileL, avviati = {}, campi = CAMPI, tz = 'Europe/Rome' } = opts;
  const modulo = opts.moduloLmin ?? SERBATOIO.moduloLs * 60;
  const { inizio: inizioNotte, fine: fineNotte } = finestraNotte(ora, tz);
  const turni = [];
  const candidati = [];
  let residuo = disponibileL;
  let cursore = inizioNotte;

  for (const t of Object.values(avviati)) {
    residuo -= t.litri;
    cursore = Math.max(cursore, t.fine + PARAMETRI.pausaMin * 60_000);
  }
  // durante la notte i nuovi turni partono da adesso (arrotondato ai 5 minuti)
  if (ora > cursore) cursore = Math.ceil(ora / 300_000) * 300_000;

  for (const [zona, campo] of Object.entries(campi)) {
    const base = {
      zona,
      n: campo.n,
      nome: campo.nome,
      agricoltore: campo.agricoltore,
      contatto: campo.contatto,
      coltura: campo.coltura,
      fase: campo.fase,
      calendarioL: litriCalendario(campo),
    };
    if (avviati[zona]) {
      turni.push({ ...base, ...avviati[zona], avviato: true });
      continue;
    }
    const theta = umidita[zona];
    if (typeof theta !== 'number') {
      turni.push({ ...base, stato: 'nessuno', motivo: 'nessun dato dal sensore', litri: 0, fabbisognoL: 0, minuti: 0 });
      continue;
    }
    const f = fabbisognoCampo(campo, theta, previsione);
    const comune = { ...base, theta: r1(theta), thetaDomani: f.thetaDomani, fabbisognoL: f.litri, priorita: priorita(campo, theta, f) };
    if (!f.serve) turni.push({ ...comune, stato: 'nessuno', motivo: f.motivo, litri: 0, minuti: 0 });
    else candidati.push({ ...comune, motivo: f.motivo });
  }

  candidati.sort((a, b) => b.priorita - a.priorita || a.theta - b.theta || a.n - b.n);
  for (const c of candidati) {
    let litri = c.fabbisognoL;
    let stato = 'turno';
    let motivo = c.motivo;
    if (litri > residuo) {
      if (residuo >= PARAMETRI.quotaMinima * litri) {
        litri = Math.floor(residuo / 500) * 500;
        stato = 'ridotto';
        motivo = `acqua limitata: ${Math.round((litri / c.fabbisognoL) * 100)} % del fabbisogno`;
      } else {
        turni.push({ ...c, stato: 'rinviato', motivo: "acqua insufficiente: precedenza ai campi in stress e alle fasi sensibili", litri: 0, minuti: 0 });
        continue;
      }
    }
    const minuti = Math.max(5, Math.ceil(litri / modulo / 5) * 5);
    if (cursore + minuti * 60_000 > fineNotte) {
      turni.push({ ...c, stato: 'rinviato', motivo: 'finestra notturna piena', litri: 0, minuti: 0 });
      continue;
    }
    turni.push({ ...c, stato, motivo, litri, minuti, inizio: cursore, fine: cursore + minuti * 60_000 });
    residuo -= litri;
    cursore += (minuti + PARAMETRI.pausaMin) * 60_000;
  }

  turni.sort((a, b) => (a.inizio ?? Infinity) - (b.inizio ?? Infinity) || a.n - b.n);
  const totaleL = turni.reduce((s, t) => s + (t.litri || 0), 0);
  const calendarioL = turni.reduce((s, t) => s + t.calendarioL, 0);
  return {
    creato: ora,
    inizioNotte,
    fineNotte,
    turni,
    totaleL,
    disponibileL,
    calendarioL,
    risparmioL: calendarioL - totaleL,
    tagliati: turni.filter((t) => t.stato === 'ridotto' || t.stato === 'rinviato').length,
    inStress: turni.filter((t) => typeof t.theta === 'number' && t.theta < SOGLIE_UMIDITA.stress).length,
  };
}

/** Il turno è cambiato abbastanza da avvisare di nuovo l'agricoltore? */
export function turnoCambiato(prima, dopo) {
  if (!prima) return true;
  if (prima.stato !== dopo.stato) return true;
  if (dopo.stato !== 'turno' && dopo.stato !== 'ridotto') return false;
  if (Math.abs((prima.inizio ?? 0) - (dopo.inizio ?? 0)) >= 30 * 60_000) return true;
  return Math.abs(prima.litri - dopo.litri) > 0.25 * Math.max(prima.litri, 1);
}

// ------------------------------------------------------------------ testi (deterministici, poi l'LLM può riformularli)

export const fmt = (v, dec = 1) => new Intl.NumberFormat('it-IT', { maximumFractionDigits: dec }).format(v);
export const litriTesto = (l) => `${new Intl.NumberFormat('it-IT', { maximumFractionDigits: 0 }).format(l)} litri`;
export function durata(minuti) {
  if (minuti < 60) return `${minuti} minuti`;
  const h = Math.floor(minuti / 60);
  const m = minuti % 60;
  return m ? `${h} h ${m} min` : `${h} ${h === 1 ? 'ora' : 'ore'}`;
}

/** Frase sul meteo di domani da aggiungere ai messaggi. */
export function fraseMeteo(prev) {
  if (!prev) return '';
  if ((prev.pioggiaDomani ?? 0) >= PARAMETRI.pioggiaMinima) return `Domani piove: ${fmt(prev.pioggiaDomani)} mm previsti.`;
  if ((prev.et0Domani ?? 0) >= 7) return `Domani fa molto caldo: evapotraspirazione ${fmt(prev.et0Domani)} mm.`;
  return `Domani niente pioggia (evapotraspirazione ${fmt(prev.et0Domani ?? 0)} mm).`;
}

/** Messaggio WhatsApp per l'agricoltore del campo. */
export function testoTurno(t, prev, { aggiornamento = false } = {}) {
  const pre = aggiornamento ? 'Aggiornamento: ' : '';
  const col = COLTURE[t.coltura]?.breve ?? t.coltura;
  const meteo = fraseMeteo(prev);
  const quando = (x) => formatClock(x);
  switch (t.stato) {
    case 'turno':
      return `${pre}stanotte irriga il campo ${t.n} (${col}, ${t.fase}) dalle ${quando(t.inizio)} per ${durata(t.minuti)}: ${litriTesto(t.litri)}. ${meteo}`.trim();
    case 'ridotto':
      return `${pre}acqua limitata stanotte: il campo ${t.n} irriga dalle ${quando(t.inizio)} per ${durata(t.minuti)}, ${litriTesto(t.litri)} (${t.motivo.replace('acqua limitata: ', '')}). ${meteo}`.trim();
    case 'rinviato':
      return `${pre}stanotte niente turno per il campo ${t.n}: ${t.motivo}. Il turno passa a domani notte. ${meteo}`.trim();
    default:
      return `${pre}stanotte non serve irrigare il campo ${t.n}: ${t.motivo}. ${meteo}`.trim();
  }
}

/** Riassunto del piano in una riga (decisione del consorzio). */
export function riassuntoPiano(piano) {
  const attivi = piano.turni.filter((t) => t.litri > 0);
  return (
    `Piano irriguo di stanotte: ${attivi.length} turni, ${fmt(piano.totaleL / 1000, 0)} m³ su ${fmt(piano.disponibileL / 1000, 0)} disponibili` +
    ` · ${piano.risparmioL >= 0 ? 'risparmio' : 'in più'} ${litriTesto(Math.abs(piano.risparmioL))} rispetto al calendario`
  );
}

/** Etichetta corta di un turno per le azioni della decisione (es. "C3 22:00 · 2 h 5 min"). */
export function etichettaTurno(t) {
  if (t.stato === 'turno' || t.stato === 'ridotto') return `C${t.n} ${formatClock(t.inizio)} · ${durata(t.minuti).replace(' minuti', '′')}${t.stato === 'ridotto' ? ' (ridotto)' : ''}`;
  if (t.stato === 'rinviato') return `C${t.n} rinviato`;
  return `C${t.n} niente turno`;
}
