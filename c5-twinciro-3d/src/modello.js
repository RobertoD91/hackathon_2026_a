// Modello delle presenze di TwinCiro 3D: stima quante persone ci sono in ogni luogo a una certa ora
// (ieri, adesso, nelle prossime 48 ore) e come cambia in uno scenario "what-if".
//
// È una SIMULAZIONE DICHIARATA guidata da dati reali:
//   stima = capienza × profilo(giorno, ora)            ← ipotesi: curva della giornata tipo del luogo
//         × stagione turistica                          ← REALE: arrivi mensili ISTAT (provincia di Napoli)
//         × correzione "rete mobile D-1"                ← SIMULATA: scostamento di ieri, nel formato dei dati
//                                                          aggregati e anonimi degli operatori (Fastweb + Vodafone)
//         × meteo dell'ora                              ← REALE: previsione oraria Open-Meteo
//         + eventi in calendario                        ← REALE: partite, crociere, eventi del Comune
//         ± scenario what-if dell'operatore             ← scelto dall'operatore (eventi, pioggia, linee chiuse, misure)
//
// Quante persone muove ogni evento e quanto pesa la pioggia sono ipotesi scritte qui sotto (IPOTESI).
// Funzioni pure e deterministiche (stesso istante → stessa stima), senza rete: le provano i test.

import { LUOGHI3D, livelloFolla, distanzaKm } from './luoghi3d.js';
import * as N from '../../shared/iot-agents/example/fonti/normalizza.js';

export const ORA = 3_600_000;
export const GIORNO = 24 * ORA;

/** Ipotesi del modello: raccolte qui perché siano facili da leggere, discutere e tarare. */
export const IPOTESI = Object.freeze({
  spettatoriPartita: 45_000, // presenze in zona stadio durante una partita in casa
  passeggeriNave: 2_600, // passeggeri medi di una nave da crociera
  quotaSbarco: 0.75, // quanti scendono a terra
  eventoGrande: 2_500, // evento del Comune "grande" (sportivo, festival) senza dato di affluenza
  eventoPiccolo: 120, // mostra, presentazione, convegno
  eventoSpeciale: 30_000, // giornata di regate dell'America's Cup sul lungomare
  // dove vanno i croceristi tra le 9:30 e le 16:30 (quote di chi è sbarcato)
  diffusioneCrociere: { plebiscito: 0.14, toledo: 0.14, centro_storico: 0.2, sangregorio: 0.07, castel_ovo: 0.07, mann: 0.05, duomo: 0.05 },
  diffusioneSpeciale: { mergellina: 0.18, castel_ovo: 0.1, chiaia: 0.1 },
  diffusioneVicini: 0.1, // quota dell'evento che passa dai luoghi entro 1,2 km (arrivo e deflusso)
  persistenzaIeri: 0.6, // quanto dello scostamento di ieri (rete mobile D-1) resta oggi
  pioggia: [
    [4, 0.5],
    [1, 0.32],
    [0.2, 0.15],
  ], // [mm/h minimi, riduzione all'aperto]
  ventoForte: 50, // km/h di raffica: -20% sul mare
  incertezzaBase: 0.08,
  incertezzaOra: 0.006, // per ogni ora di distanza da adesso
  incertezzaMax: 0.3,
  diversione: 0.25, // misura "diversione dei flussi": quota massima spostata da un luogo critico
  scaglionamento: 0.82, // misura "ingressi scaglionati": picco dell'evento × 0,82 (arrivi su più ore)
  navette: 0.55, // misura "navette e metro potenziata": deflusso verso i luoghi vicini × 0,55
  lineaChiusaMeno: 0.14, // luogo servito solo dalla linea chiusa: -14% di arrivi
  lineaChiusaPiu: 0.16, // luogo con una linea alternativa: +16% (chi cambia percorso passa di lì)
});

// Curve della giornata tipo: picchi [ora, larghezza in ore, ampiezza] in frazione della capienza
// (1 = soglia "affollato"), per giorno feriale, sabato e festivo. `notte` è il minimo notturno.
export const PROFILI = Object.freeze({
  piazza: { fer: [[12, 2.2, 0.45], [18.5, 2.2, 0.55]], sab: [[12.5, 2.4, 0.6], [19, 2.8, 0.85]], fes: [[12, 2.4, 0.75], [18, 2.6, 0.7]], notte: 0.04 },
  shopping: { fer: [[12.5, 2, 0.5], [18.5, 2, 0.75]], sab: [[12.5, 2.2, 0.7], [18.5, 2.4, 1.15]], fes: [[12.5, 2.2, 0.65], [18.5, 2.4, 0.9]], notte: 0.05 },
  mare: { fer: [[13, 2, 0.25], [18.5, 2.4, 0.4]], sab: [[12.5, 2.4, 0.45], [18.5, 3, 0.75]], fes: [[12, 2.6, 0.85], [17.5, 2.8, 0.8]], notte: 0.04 },
  porto: { fer: [[8.5, 1.5, 0.4], [17.5, 2, 0.45]], sab: [[9, 1.8, 0.5], [17.5, 2.2, 0.5]], fes: [[9.5, 2, 0.45], [18, 2.2, 0.5]], notte: 0.03 },
  attrazione: { fer: [[11.5, 1.8, 0.55], [16, 2, 0.5]], sab: [[11.5, 2, 0.8], [16.5, 2.2, 0.85]], fes: [[11.5, 2, 0.9], [16, 2.2, 0.8]], notte: 0.02 },
  museo: { fer: [[11.5, 1.8, 0.5], [15.5, 1.8, 0.4]], sab: [[11.5, 1.9, 0.7], [15.5, 1.9, 0.6]], fes: [[11.5, 1.9, 0.85], [15.5, 1.9, 0.6]], notte: 0 },
  parco: { fer: [[11, 2, 0.2], [16, 2, 0.25]], sab: [[11.5, 2.2, 0.45], [16, 2.2, 0.5]], fes: [[11.5, 2.2, 0.75], [15.5, 2.2, 0.6]], notte: 0 },
  stazione: { fer: [[8, 1.4, 0.8], [13.5, 1.8, 0.45], [18, 1.8, 0.85]], sab: [[9.5, 2, 0.5], [18, 2.4, 0.6]], fes: [[11, 2.5, 0.4], [18.5, 2.4, 0.55]], notte: 0.06 },
  quartiere: { fer: [[11.5, 2, 0.45], [18.5, 2, 0.6]], sab: [[12, 2.2, 0.55], [19, 2.4, 0.72]], fes: [[12, 2.2, 0.5], [18.5, 2.2, 0.45]], notte: 0.04 },
  movida: { fer: [[13, 1.8, 0.35], [21.5, 2, 0.6]], sab: [[13, 2, 0.4], [19, 1.8, 0.5], [23.3, 1.9, 1.15]], fes: [[13, 2, 0.45], [20.5, 2.2, 0.55]], notte: 0.05 },
  mercato: { fer: [[10.5, 1.8, 0.75], [18, 1.8, 0.55]], sab: [[11, 2, 0.95], [18.5, 2, 0.6]], fes: [[11.5, 2, 0.45], [18.5, 2, 0.35]], notte: 0.04 },
  uffici: { fer: [[9, 1.5, 0.55], [13.3, 1.2, 0.7], [17.5, 1.4, 0.5]], sab: [[11, 2.5, 0.15]], fes: [[11, 2.5, 0.08]], notte: 0.02 },
  aeroporto: { fer: [[6.5, 1.8, 0.6], [13, 2.5, 0.55], [19, 2.2, 0.6]], sab: [[7, 2, 0.6], [13, 2.5, 0.55], [19, 2.2, 0.5]], fes: [[8, 2, 0.5], [14, 2.5, 0.55], [19.5, 2.2, 0.65]], notte: 0.08 },
  stadio: { fer: [[18.5, 2.2, 0.12]], sab: [[11.5, 2.5, 0.12], [18, 2.2, 0.12]], fes: [[11.5, 2.5, 0.14]], notte: 0.01 },
  sede: { fer: [[11, 2.5, 0.06]], sab: [[11.5, 2.5, 0.1]], fes: [[11.5, 2.5, 0.12]], notte: 0 }, // sede di eventi: quasi vuota senza eventi
});

const limita = (v, a, b) => Math.min(b, Math.max(a, v));
const campana = (h, [mu, sigma, amp]) => amp * Math.exp(-(((h - mu) / sigma) ** 2) / 2);

/** Tipo di giorno ('fer' | 'sab' | 'fes') di un istante, nel fuso di Napoli. */
export function tipoGiorno(ts) {
  const p = N.partiLocali(ts);
  const dow = new Date(Date.UTC(p.anno, p.mese - 1, p.giorno)).getUTCDay();
  if (dow === 0 || N.festivo(N.giornoLocale(ts))) return 'fes';
  return dow === 6 ? 'sab' : 'fer';
}

/** Valore del profilo (frazione della capienza) a un istante: somma dei picchi di oggi e della coda di ieri sera. */
export function valoreProfilo(nomeProfilo, ts) {
  const pr = PROFILI[nomeProfilo] || PROFILI.piazza;
  const p = N.partiLocali(ts);
  const h = p.ora + p.minuto / 60;
  let v = pr.notte;
  for (const picco of pr[tipoGiorno(ts)]) v += campana(h, picco);
  for (const picco of pr[tipoGiorno(ts - GIORNO)]) v += campana(h + 24, picco); // dopo mezzanotte: coda della sera prima
  return v;
}

/** Rumore deterministico in [-1, 1] da una stringa e un intero (stessa chiave → stesso valore). */
export function rumore(chiave, n) {
  let h = 2166136261 ^ n;
  for (let i = 0; i < chiave.length; i++) h = Math.imul(h ^ chiave.charCodeAt(i), 16777619);
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  h ^= h >>> 15;
  return ((h >>> 0) / 4294967295) * 2 - 1;
}

/** Salita e discesa lineari attorno a una finestra: 0 fuori, 1 tra inizio e fine. */
function rampa(t, inizio, fine, salita = 1.5 * ORA, discesa = ORA) {
  if (t <= inizio - salita || t >= fine + discesa) return 0;
  if (t < inizio) return (t - (inizio - salita)) / salita;
  if (t > fine) return (fine + discesa - t) / discesa;
  return 1;
}

/** Gobba attorno a un istante (arrivi prima dell'evento, deflusso dopo). */
const gobba = (t, centro, mezza) => Math.max(0, 1 - Math.abs(t - centro) / mezza);

// ------------------------------------------------------------------ eventi

/**
 * Eventi reali di un giorno (snapshot dati/eventi.json) trasformati in impatti sul modello:
 * [{ id, titolo, tipo, zona, inizio, fine, persone, fonte, nota, reale, lungo, diffusione? }].
 * Gli eventi del Comune vengono riabbinati ai luoghi 3D (più fitti di quelli della mappa 2D).
 */
export function impattiDelGiorno(datiEventi, giorno, luoghi = LUOGHI3D) {
  const lista = N.eventiDelGiorno(datiEventi, giorno) || [];
  const g0 = N.inizioGiorno(giorno);
  return lista.map((e, i) => {
    let zona = e.zona;
    let grande = true; // partite, crociere e grandi eventi spostano sempre folla
    let persone = IPOTESI.eventoPiccolo;
    let diffusione = null;
    let inizio = e.inizio ?? g0 + 10 * ORA;
    let fine = e.fine ?? inizio + 2 * ORA;
    if (e.fonte === 'comune-napoli') {
      zona = N.zonaPerTesto(`${e.nota || ''} ${e.titolo}`, luoghi) || e.zona || null;
      grande = N.eventoGrande(e.titolo, e.tipo);
      persone = grande ? IPOTESI.eventoGrande : IPOTESI.eventoPiccolo;
      // evento di più giorni (mostra, rassegna, gara su due giornate): conta nelle ore diurne di oggi
      inizio = Math.max(inizio, g0 + 9 * ORA);
      fine = Math.min(fine, g0 + 20 * ORA);
      if (fine <= inizio) fine = inizio + 2 * ORA;
    } else if (e.zona === 'maradona') {
      persone = IPOTESI.spettatoriPartita;
      if (e.inizio == null) {
        inizio = g0 + 18 * ORA; // orario non ancora fissato: ipotesi tardo pomeriggio
        fine = inizio + 2 * ORA;
      }
      inizio -= 0.5 * ORA; // lo stadio si riempie prima del calcio d'inizio
    } else if (e.tipo === 'Crociere') {
      const navi = /^(\d+) navi/.exec(e.titolo)?.[1] ?? 1;
      const sbarcati = Number(navi) * IPOTESI.passeggeriNave * IPOTESI.quotaSbarco;
      persone = Math.round(sbarcati * 0.3);
      diffusione = Object.entries(IPOTESI.diffusioneCrociere).map(([z, q]) => ({ zona: z, persone: Math.round(sbarcati * q), inizio: g0 + 9.5 * ORA, fine: g0 + 16.5 * ORA }));
    } else {
      persone = IPOTESI.eventoSpeciale;
      diffusione = Object.entries(IPOTESI.diffusioneSpeciale).map(([z, q]) => ({ zona: z, persone: Math.round(persone * q), inizio, fine }));
    }
    return {
      id: `${giorno}:${i}`,
      titolo: e.titolo,
      tipo: e.tipo,
      zona,
      inizio,
      fine,
      persone,
      fonte: e.fonte,
      nota: e.nota || '',
      reale: true,
      grande,
      lungo: Boolean(e.lungo),
      diffusione,
    };
  });
}

// ------------------------------------------------------------------ modello

/**
 * @param {object} contesto
 * @param {object|null} contesto.eventi        snapshot dati/eventi.json (o null)
 * @param {object|null} contesto.riferimenti   snapshot dati/riferimenti.json (stagionalità ISTAT)
 * @param {(ts:number)=>({pioggia?:number, raffiche?:number, temperatura?:number, codice?:number}|null)} [contesto.meteoA]
 * @param {Array} [contesto.stazioni]          stazioni dello snapshot trasporti (per le linee chiuse)
 * @param {number} [contesto.adesso]           istante "adesso" (default Date.now())
 * @param {object|null} [scenario]             what-if: { eventi, lineeChiuse, pioggia, navi, misure }
 */
export function creaModello(contesto = {}, scenario = null) {
  const luoghi = contesto.luoghi || LUOGHI3D;
  const zone = Object.keys(luoghi);
  const adesso = () => contesto.adesso ?? Date.now();
  const cacheEventi = new Map(); // giorno → impatti
  const cacheQuadri = new Map(); // quarto d'ora → quadro
  const sc = scenario || {};
  const misure = sc.misure || {};

  // luoghi vicini (entro 1,2 km) per la diffusione degli eventi e per la misura "diversione"
  const vicini = Object.fromEntries(
    zone.map((z) => [
      z,
      zone
        .filter((x) => x !== z)
        .map((x) => ({ zona: x, km: distanzaKm(luoghi[z], luoghi[x]) }))
        .filter((x) => x.km <= 1.5)
        .sort((a, b) => a.km - b.km),
    ]),
  );

  // effetto di una linea chiusa sui luoghi: stazioni entro 500 m
  const effettoLinee = {};
  if (sc.lineeChiuse?.length && contesto.stazioni?.length) {
    for (const z of zone) {
      const vicine = contesto.stazioni.filter((s) => distanzaKm(luoghi[z], s) <= 0.5);
      if (!vicine.length) continue;
      const chiuse = vicine.filter((s) => s.linee.some((l) => sc.lineeChiuse.includes(l)));
      const aperte = vicine.filter((s) => s.linee.some((l) => !sc.lineeChiuse.includes(l)));
      if (!chiuse.length) effettoLinee[z] = 0;
      else effettoLinee[z] = aperte.length ? IPOTESI.lineaChiusaPiu : -IPOTESI.lineaChiusaMeno;
    }
    // chi non può usare la linea chiusa passa dalle stazioni vicine delle altre linee
    for (const z of zone) {
      if (effettoLinee[z] !== undefined) continue;
      const hub = contesto.stazioni.some((s) => distanzaKm(luoghi[z], s) <= 0.5 && !s.linee.some((l) => sc.lineeChiuse.includes(l)));
      const vicinoAChiusa = contesto.stazioni.some((s) => distanzaKm(luoghi[z], s) <= 1.1 && s.linee.some((l) => sc.lineeChiuse.includes(l)));
      if (hub && vicinoAChiusa) effettoLinee[z] = IPOTESI.lineaChiusaPiu / 2;
    }
  }

  function eventiDi(giorno) {
    if (!cacheEventi.has(giorno)) {
      let lista = contesto.eventi ? impattiDelGiorno(contesto.eventi, giorno, luoghi) : [];
      // what-if: numero di navi scelto dall'operatore per quel giorno
      if (sc.navi && sc.navi.giorno === giorno) {
        lista = lista.filter((e) => e.tipo !== 'Crociere');
        if (sc.navi.n > 0) {
          const finto = impattiDelGiorno({ crociere: [{ giorno, navi: Array.from({ length: sc.navi.n }, (_, i) => `Nave ${i + 1}`) }] }, giorno, luoghi);
          lista.push(...finto.map((e) => ({ ...e, reale: false, id: `whatif-navi:${giorno}`, nota: 'scenario what-if' })));
        }
      }
      for (const e of sc.eventi || []) {
        const fine = e.inizio + (e.durataOre ?? 3) * ORA;
        if (N.giornoLocale(e.inizio) === giorno) {
          // contato nel giorno in cui inizia (eventiAttorno guarda anche il giorno prima)
          lista.push({ id: e.id || `whatif:${e.zona}:${e.inizio}`, titolo: e.titolo || 'Evento ipotetico', tipo: 'What-if', zona: e.zona, inizio: e.inizio, fine, persone: e.persone, fonte: 'what-if', nota: 'scenario what-if', reale: false, grande: true, lungo: false, diffusione: null });
        }
      }
      cacheEventi.set(giorno, lista);
    }
    return cacheEventi.get(giorno);
  }

  /** Eventi che possono pesare sull'istante `ts` (oggi e ieri, per gli eventi a cavallo di mezzanotte). */
  function eventiAttorno(ts) {
    return [...eventiDi(N.giornoLocale(ts - GIORNO)), ...eventiDi(N.giornoLocale(ts))];
  }

  function fattoreStagione(l, mese) {
    const s = N.stagione(contesto.riferimenti, mese);
    const indice = s?.indice ?? 1;
    return { fattore: (1 + l.turisti * (indice - 1) * 0.8) * (l.mesi?.[mese] ?? 1), indice, stranieriPct: s?.stranieriPct ?? 45 };
  }

  function meteoDi(ts) {
    let m = contesto.meteoA?.(ts) ?? null;
    const p = sc.pioggia;
    if (p && ts >= p.da && ts <= p.a) m = { ...(m || {}), pioggia: Math.max(m?.pioggia ?? 0, p.mm), scenario: true };
    return m;
  }

  function fattoreMeteo(l, m) {
    if (!m) return 1;
    let f = 1;
    const mm = m.pioggia ?? 0;
    const fascia = IPOTESI.pioggia.find(([min]) => mm >= min);
    if (fascia) f *= l.aperto >= 0.3 ? 1 - l.aperto * fascia[1] : 1 + 0.12; // al chiuso (musei) con la pioggia arriva più gente
    if ((m.raffiche ?? 0) >= IPOTESI.ventoForte && (l.profilo === 'mare' || l.profilo === 'porto')) f *= 0.8;
    return f;
  }

  /** Scostamento "rete mobile D-1": quello di ieri resta in parte oggi e si spegne nei giorni successivi. */
  function correzioneRete(zona, ts) {
    const giornoIdx = Math.floor((ts + N.scartoRoma(ts)) / GIORNO);
    const oggiIdx = Math.floor((adesso() + N.scartoRoma(adesso())) / GIORNO);
    if (giornoIdx < oggiIdx) return rumore(`rete:${zona}`, giornoIdx) * 0.12; // passato: il dato "osservato" di quel giorno
    const avanti = giornoIdx - oggiIdx;
    return rumore(`rete:${zona}`, oggiIdx - 1) * 0.12 * IPOTESI.persistenzaIeri * Math.exp(-avanti / 2);
  }

  function contributiEventi(zona, ts) {
    const out = [];
    for (const e of eventiAttorno(ts)) {
      const picco = misure.scaglionamento && e.persone >= 1000 ? IPOTESI.scaglionamento : 1;
      const salita = (misure.scaglionamento ? 2.5 : 1.5) * ORA;
      if (e.zona === zona) {
        const q = rampa(ts, e.inizio, e.fine, salita, ORA);
        if (q > 0) out.push({ id: e.id, titolo: e.titolo, persone: Math.round(e.persone * picco * q), reale: e.reale, diretto: true });
      }
      for (const d of e.diffusione || []) {
        if (d.zona !== zona) continue;
        const q = rampa(ts, d.inizio, d.fine, ORA, ORA);
        if (q > 0) out.push({ id: e.id, titolo: e.titolo, persone: Math.round(d.persone * q), reale: e.reale, diretto: false });
      }
      // arrivo e deflusso attraverso i luoghi vicini (solo eventi che spostano folla)
      if (e.zona && e.zona !== zona && e.persone >= 1000 && luoghi[e.zona]) {
        const v = vicini[zona].find((x) => x.zona === e.zona);
        if (v && v.km <= 1.2) {
          const q = Math.max(gobba(ts, e.inizio - 0.75 * ORA, ORA), gobba(ts, e.fine + 0.5 * ORA, ORA));
          const quota = IPOTESI.diffusioneVicini * Math.exp(-v.km / 0.5) * (misure.navette ? IPOTESI.navette : 1);
          const n = Math.round(e.persone * quota * q);
          if (n > 0) out.push({ id: e.id, titolo: e.titolo, persone: n, reale: e.reale, diretto: false });
        }
      }
    }
    return out;
  }

  function stimaGrezza(zona, ts) {
    const l = luoghi[zona];
    const mese = N.partiLocali(ts).mese;
    const st = fattoreStagione(l, mese);
    const profilo = valoreProfilo(l.profilo, ts);
    const storico = l.capienza * profilo * st.fattore;
    const rete = correzioneRete(zona, ts);
    const m = meteoDi(ts);
    const fMeteo = fattoreMeteo(l, m);
    const oraIdx = Math.floor(ts / ORA);
    const fraz = (ts % ORA) / ORA;
    const fine = (rumore(`ora:${zona}`, oraIdx) * (1 - fraz) + rumore(`ora:${zona}`, oraIdx + 1) * fraz) * 0.05;
    const fLinee = 1 + (effettoLinee[zona] ?? 0);
    const base = storico * (1 + rete) * fMeteo * (1 + fine) * fLinee;
    const eventi = contributiEventi(zona, ts);
    const daEventi = eventi.reduce((s, e) => s + e.persone, 0) * (fMeteo < 1 ? 0.5 + fMeteo / 2 : 1); // la pioggia riduce anche gli eventi, ma meno
    return {
      zona,
      ts,
      persone: Math.max(0, base + daEventi),
      componenti: {
        storico: Math.round(storico),
        profilo,
        stagione: st.fattore,
        indiceStagione: st.indice,
        reteMobile: rete,
        meteo: fMeteo,
        meteoDato: m,
        linee: effettoLinee[zona] ?? 0,
        eventi,
        daEventi: Math.round(daEventi),
        misure: 0,
      },
      stranieriPct: st.stranieriPct,
    };
  }

  function completa(g) {
    const l = luoghi[g.zona];
    const persone = Math.round(g.persone);
    const oreDaAdesso = Math.abs(g.ts - adesso()) / ORA;
    const inc = Math.min(IPOTESI.incertezzaMax, IPOTESI.incertezzaBase + IPOTESI.incertezzaOra * oreDaAdesso);
    const livello = livelloFolla(persone, l.capienza);
    return {
      zona: g.zona,
      ts: g.ts,
      persone,
      min: Math.round(persone * (1 - inc)),
      max: Math.round(persone * (1 + inc)),
      incertezza: inc,
      quota: l.capienza > 0 ? persone / l.capienza : 0,
      livello: livello.id,
      etichetta: livello.label,
      componenti: g.componenti,
      composizione: composizione(l, g),
    };
  }

  /** Composizione nel formato dei dati di rete mobile (residenti, pendolari, turisti italiani e stranieri): simulata. */
  function composizione(l, g) {
    const tipo = tipoGiorno(g.ts);
    const h = N.partiLocali(g.ts).ora;
    const tot = Math.max(1, g.persone);
    const croceristi = g.componenti.eventi.filter((e) => /crocier|nav[ei]/i.test(e.titolo)).reduce((s, e) => s + e.persone, 0);
    let turisti = limita(l.turisti * (0.6 + 0.4 * g.componenti.indiceStagione) + croceristi / tot, 0.02, 0.92);
    const lavoro = ['stazione', 'uffici', 'aeroporto', 'mercato', 'shopping'].includes(l.profilo);
    let pendolari = (1 - turisti) * (tipo === 'fer' && h >= 7 && h <= 19 ? (lavoro ? 0.48 : 0.2) : lavoro ? 0.18 : 0.07);
    const residenti = Math.max(0, 1 - turisti - pendolari);
    const stranieri = turisti * (g.stranieriPct / 100);
    return { residenti, pendolari, turistiItaliani: turisti - stranieri, turistiStranieri: stranieri };
  }

  /** Stime di tutti i luoghi a un istante (con le misure dello scenario applicate). */
  function quadro(ts) {
    const chiave = Math.floor(ts / (ORA / 4));
    if (cacheQuadri.has(chiave) && cacheQuadri.get(chiave).ts === ts) return cacheQuadri.get(chiave).stime;
    const grezze = Object.fromEntries(zone.map((z) => [z, stimaGrezza(z, ts)]));
    if (misure.diversione) {
      // CiroGPT propone alternative vicine e tranquille a chi sta andando verso un luogo critico
      const ordine = [...zone].sort((a, b) => grezze[b].persone / luoghi[b].capienza - grezze[a].persone / luoghi[a].capienza);
      for (const z of ordine) {
        const g = grezze[z];
        const cap = luoghi[z].capienza;
        if (g.persone / cap <= 0.85) break;
        let sposta = Math.min(g.persone - 0.8 * cap, g.persone * IPOTESI.diversione);
        const dove = vicini[z]
          .map((v) => ({ zona: v.zona, libero: 0.6 * luoghi[v.zona].capienza - grezze[v.zona].persone }))
          .filter((v) => v.libero > 0);
        const libero = dove.reduce((s, v) => s + v.libero, 0);
        if (!libero || sposta <= 0) continue;
        sposta = Math.min(sposta, libero);
        g.persone -= sposta;
        g.componenti.misure -= Math.round(sposta);
        for (const v of dove) {
          const n = (sposta * v.libero) / libero;
          grezze[v.zona].persone += n;
          grezze[v.zona].componenti.misure += Math.round(n);
        }
      }
    }
    const stime = Object.fromEntries(zone.map((z) => [z, completa(grezze[z])]));
    if (cacheQuadri.size > 4000) cacheQuadri.clear();
    cacheQuadri.set(chiave, { ts, stime });
    return stime;
  }

  const stima = (zona, ts) => quadro(ts)[zona];

  /** Serie oraria di un luogo: `ore` valori a partire da `da` (allineato all'ora). */
  function serie(zona, da, ore, passo = ORA) {
    const t0 = Math.floor(da / passo) * passo;
    return Array.from({ length: ore }, (_, i) => stima(zona, t0 + i * passo));
  }

  /** Sintesi della città a un istante. */
  function sintesi(ts) {
    const q = quadro(ts);
    const lista = zone.map((z) => q[z]).sort((a, b) => b.quota - a.quota);
    const perLivello = { tranquillo: 0, normale: 0, vivace: 0, affollato: 0 };
    for (const s of lista) perLivello[s.livello]++;
    return { ts, totale: lista.reduce((s, x) => s + x.persone, 0), perLivello, classifica: lista };
  }

  /**
   * Criticità previste in una finestra: per ogni luogo il picco, quando arriva e quante ore resta
   * sopra la soglia "affollato". Ordinate dal luogo più critico.
   */
  function criticita(da, ore) {
    const t0 = Math.floor(da / ORA) * ORA;
    return zone
      .map((z) => {
        let picco = null;
        let oreCritiche = 0;
        let oreVivaci = 0;
        let personeOre = 0;
        for (let i = 0; i < ore; i++) {
          const s = stima(z, t0 + i * ORA);
          if (!picco || s.quota > picco.quota) picco = s;
          if (s.quota >= 0.85) {
            oreCritiche++;
            personeOre += s.persone - 0.85 * luoghi[z].capienza;
          } else if (s.quota >= 0.6) oreVivaci++;
        }
        return { zona: z, picco, oreCritiche, oreVivaci, eccesso: Math.round(personeOre) };
      })
      .sort((a, b) => b.picco.quota - a.picco.quota);
  }

  /** Indicatori di una finestra (per confrontare scenario e situazione di partenza). */
  function indicatori(da, ore) {
    const c = criticita(da, ore);
    return {
      luoghiCritici: c.filter((x) => x.oreCritiche > 0).length,
      oreCritiche: c.reduce((s, x) => s + x.oreCritiche, 0),
      eccesso: c.reduce((s, x) => s + x.eccesso, 0),
      piccoMassimo: c[0]?.picco ?? null,
      dettaglio: c,
    };
  }

  /** Eventi (reali e dello scenario) tra due istanti, senza doppioni, in ordine di inizio. */
  function eventiTra(da, a) {
    const visti = new Set();
    const out = [];
    for (let t = da - GIORNO; t <= a + GIORNO; t += GIORNO) {
      for (const e of eventiDi(N.giornoLocale(t))) {
        if (visti.has(e.id) || e.fine < da || e.inizio > a) continue;
        visti.add(e.id);
        out.push(e);
      }
    }
    return out.sort((x, y) => Number(y.grande) - Number(x.grande) || x.inizio - y.inizio);
  }

  return { luoghi, zone, scenario: sc, adesso, stima, quadro, serie, sintesi, criticita, indicatori, eventiDi, eventiTra, meteoDi, vicini };
}

/**
 * Flussi pedonali stimati (schema dichiarato): dove la stima cresce nell'ora successiva le persone
 * stanno arrivando, dove cala stanno andando via. L'altro capo del flusso è il punto di arrivo più
 * vicino: una stazione vera (snapshot GTFS), il porto, oppure un luogo vicino che si muove al contrario.
 * @returns {Array<{da:{nome,lat,lon,zona?}, a:{nome,lat,lon,zona?}, persone:number, arrivo:boolean, zona:string}>}
 */
export function flussi(modello, ts, { stazioni = [], minimo = 150, max = 16 } = {}) {
  const q0 = modello.quadro(ts);
  const q1 = modello.quadro(ts + ORA);
  const L = modello.luoghi;
  const capo = (z) => ({ nome: L[z].breve || L[z].nome, lat: L[z].lat, lon: L[z].lon, zona: z });
  const porte = modello.zone.filter((z) => ['porto', 'aeroporto'].includes(L[z].profilo));
  const out = [];
  for (const z of modello.zone) {
    const delta = q1[z].persone - q0[z].persone;
    if (Math.abs(delta) < minimo) continue;
    let altro = null;
    // 1) un luogo vicino che si muove in senso opposto (es. dal porto verso il centro)
    const opposto = modello.vicini[z].find((v) => {
      const d = q1[v.zona].persone - q0[v.zona].persone;
      return Math.sign(d) === -Math.sign(delta) && Math.abs(d) >= minimo && porte.includes(v.zona);
    });
    if (opposto) altro = capo(opposto.zona);
    // 2) la stazione più vicina (entro 1,3 km), che non sia il luogo stesso
    if (!altro) {
      const st = stazioni
        .map((s) => ({ s, km: distanzaKm(L[z], s) }))
        .filter((x) => x.km <= 1.3 && x.km >= 0.12)
        .sort((a, b) => a.km - b.km)[0];
      if (st) altro = { nome: st.s.nome, lat: st.s.lat, lon: st.s.lon, stazione: st.s.id };
    }
    // senza una stazione vicina non si sa da dove arrivano (auto, bus): il flusso non viene disegnato
    if (!altro) continue;
    const qui = capo(z);
    out.push(delta > 0 ? { da: altro, a: qui, persone: Math.round(delta), arrivo: true, zona: z } : { da: qui, a: altro, persone: Math.round(-delta), arrivo: false, zona: z });
  }
  return out.sort((a, b) => b.persone - a.persone).slice(0, max);
}
