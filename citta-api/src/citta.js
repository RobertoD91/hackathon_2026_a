// Le risposte dell'API, già "masticate" per un LLM: campi in italiano con l'unità nel nome
// (temperatura_c, vento_kmh, distanza_m...), orari locali di Napoli 'AAAA-MM-GG HH:MM', una
// `fonte` con lo stato del dato e un campo `testo` con la stessa informazione in una o due frasi
// pronte da citare. I dati arrivano da fonti/dati.js tramite la cache in sorgenti.js.

import * as N from '../fonti/normalizza.js';
import { FONTI } from '../fonti/dati.js';
import { LUOGHI, CATEGORIE, distanzaKm } from '../fonti/luoghi.js';
import { cercaLuoghi, cercaStazioni, SOGLIA } from './ricerca.js';
import { scenariAttivi } from './folla.js';
import { PUNTI } from './punti.js';
import { STATI, LEGENDA_STATI, oraLocale, giornoTesto, quando, finoA, intervallo, delle, it, tondo, fonteBreve, citazione, statoDato, nomeSe, ErroreApi } from './formato.js';

/** "Open-Meteo" nei testi solo quando il meteo viene davvero da Open-Meteo (non dalla riserva MET Norway). */
const nomeMeteo = (f) => nomeSe(f, /open-meteo/i, 'Open-Meteo');
/** Stato e ora del modello dell'aria tra parentesi: "(modello CAMS, dato delle 14:00)". */
const conStato = (testo, f, ora) => {
  const s = statoDato(f, ora);
  return s ? `${testo}, ${s}` : testo;
};

const H = 3_600_000;
const ZONE = Object.keys(LUOGHI);
/** Centro approssimato del Comune e raggio entro cui si accettano coordinate. */
const CENTRO = { lat: 40.8518, lon: 14.2681 };
const RAGGIO_KM = 20;
/** Raggio usato quando entro 1200 m non c'è nessuna stazione (e non è stato chiesto un raggio). */
const RAGGIO_LARGO_M = 2500;

const CONDIZIONI = { tranquillo: 'bel tempo', normale: 'variabile', vivace: 'pioggia o vento', affollato: 'maltempo' };
const CLASSI_EAQI = ['buona', 'discreta', 'moderata', 'scadente', 'molto scadente', 'pessima'];
const NOMI_FONTI_EVENTI = {
  'comune-napoli': 'Comune di Napoli',
  openfootball: 'openfootball (calendario Serie A)',
  thesportsdb: 'TheSportsDB',
  cruisetimetables: 'Cruise Timetables',
  americascup: "America's Cup (sito ufficiale)",
};
const NOTA_FOLLA =
  'Stima del simulatore della demo (curva oraria per luogo con capienze indicative), modificata da eventi reali di oggi e stagionalità ISTAT: NON è una misura. In produzione: presenze anonime e aggregate dalle celle di Fastweb + Vodafone e sensori ESP32.';

// ------------------------------------------------------------------ pezzi comuni

/** Meteo di un luogo in forma compatta. */
export function meteoDi(m) {
  if (!m) return null;
  return {
    temperatura_c: tondo(m.temperatura),
    percepita_c: tondo(m.percepita),
    cielo: m.cielo ?? null,
    pioggia_mm: tondo(m.pioggia),
    umidita_pct: tondo(m.umidita, 0),
    vento_kmh: tondo(m.vento, 0),
    vento_nodi: typeof m.vento === 'number' ? Math.round(m.vento / 1.852) : null,
    raffiche_kmh: tondo(m.raffiche, 0),
    condizioni: CONDIZIONI[N.livelloMeteo(m, null)?.livello] ?? null,
    ora_dato: oraLocale(m.ts),
  };
}

function testoMeteo(nome, m) {
  if (!m) return `${nome}: meteo non disponibile.`;
  const p = [`${it(m.temperatura_c)} °C${m.percepita_c != null && Math.abs(m.percepita_c - m.temperatura_c) >= 1 ? ` (percepiti ${it(m.percepita_c)})` : ''}`];
  if (m.cielo && m.cielo !== 'n/d') p.push(m.cielo.toLowerCase());
  if (m.vento_kmh != null) p.push(`vento ${it(m.vento_kmh, 0)} km/h (${m.vento_nodi} nodi)${m.raffiche_kmh != null ? ` con raffiche a ${it(m.raffiche_kmh, 0)} km/h` : ''}`);
  if (m.pioggia_mm) p.push(`pioggia ${it(m.pioggia_mm)} mm nell'ultima ora`);
  if (m.umidita_pct != null) p.push(`umidità ${it(m.umidita_pct, 0)} %`);
  return `${nome}: ${p.join(', ')}.`;
}

/** Media delle ultime 24 ore di una serie [[ts, valore], ...] (come l'indice europeo per i PM). */
function media24(m) {
  const serie = (m?.serie || []).filter((p) => typeof p[1] === 'number');
  if (!serie.length) return null;
  const ultimo = serie[serie.length - 1][0];
  const giorno = serie.filter((p) => p[0] > ultimo - 24 * H);
  return tondo(giorno.reduce((t, p) => t + p[1], 0) / giorno.length);
}

function centralinaDi(s, km, cl, recente) {
  const misure = {};
  for (const [k, m] of Object.entries(s.misure || {})) {
    misure[k] = { ultimo_ugm3: m.ultimo?.valore ?? null, ora_dato: oraLocale(m.ultimo?.ts) };
    if (/^PM/.test(k)) misure[k].media_24h_ugm3 = media24(m);
  }
  const out = {
    nome: s.nome,
    codice: s.id,
    tipo: s.tipo ?? null,
    distanza_km: km ?? null,
    classe: cl ? CLASSI_EAQI[cl.classe] : null,
    inquinante_peggiore: cl?.inquinante ?? null,
    valore_ugm3: cl?.valore ?? null,
    // per PM10 e PM2.5 l'indice europeo usa la media delle ultime 24 ore, non l'ultima misura
    valore_tipo: cl ? (/^PM/.test(cl.inquinante) ? 'media delle ultime 24 ore' : 'misura oraria') : null,
    ora_dato: oraLocale(cl?.ts),
    recente: recente ?? null,
    misure,
  };
  // istante della misura per i testi ("oggi alle 04:00"), fuori dal JSON
  Object.defineProperty(out, 'ts', { value: cl?.ts ?? null, enumerable: false });
  return out;
}

/**
 * Aria di un luogo con la stessa regola della mappa (c5-presentazione/mappa/napoli-fonti.js, ariaDelLuogo):
 * centralina ARPAC entro 1,5 km con misura di meno di 48 ore, altrimenti il modello CAMS.
 */
export function ariaDi(zona, centraline, modello, ora) {
  const a = centraline;
  const v = a?.vicine?.[zona];
  let st = null;
  if (v && v.km <= 1.5) {
    const s = a.stazioni?.find((x) => x.id === v.id);
    const cl = s ? N.classeCentralina(s.misure) : null;
    if (cl) st = { s, km: v.km, cl, recente: ora - cl.ts < 48 * H };
  }
  const m = modello?.[zona];
  let origine = null;
  let classe = null;
  if (st?.recente) [origine, classe] = ['centralina', st.cl.classe];
  else if (m?.aqi != null) [origine, classe] = ['modello', N.classeAqi(m.aqi)];
  else if (st) [origine, classe] = ['centralina', st.cl.classe];
  if (classe == null) return null;
  return {
    livello: N.livelloAria(classe).label,
    classe_eaqi: classe,
    classe_nome: CLASSI_EAQI[classe],
    origine: origine === 'centralina' ? 'centralina ARPAC vicina (misura oraria non validata)' : 'modello Copernicus CAMS (stima di fondo, celle di circa 11 km)',
    centralina: st ? centralinaDi(st.s, st.km, st.cl, st.recente) : null,
    modello: m
      ? { indice_europeo: m.aqi, pm10_ugm3: tondo(m.pm10), pm25_ugm3: tondo(m.pm25), no2_ugm3: tondo(m.no2), o3_ugm3: tondo(m.o3), ora_dato: oraLocale(m.ts) }
      : null,
  };
}

/**
 * Valore di una centralina per i testi: "NO2 95 µg/m³ oggi alle 05:00", oppure per i PM (l'indice
 * europeo usa la media delle 24 ore) "PM10 30,8 µg/m³ di media nelle 24 ore fino alle 04:00".
 */
function misuraCentralina(inquinante, valore, ts, ora) {
  if (/^PM/.test(inquinante || '')) return `${inquinante} ${it(valore)} µg/m³ di media nelle 24 ore${Number.isFinite(ts) ? ` ${finoA(ts, ora)}` : ''}`;
  const q = quando(ts, ora);
  return `${inquinante} ${it(valore)} µg/m³${q ? ` ${q.startsWith('alle') ? `oggi ${q}` : q}` : ''}`;
}

function testoAria(nome, a, ora, fonteModello) {
  if (!a) return `${nome}: qualità dell'aria non disponibile.`;
  if (a.centralina && a.origine.startsWith('centralina')) {
    const c = a.centralina;
    return `${nome}: aria ${a.classe_nome} (indice europeo), centralina ARPAC ${c.nome} a ${it(c.distanza_km)} km: ${misuraCentralina(c.inquinante_peggiore, c.valore_ugm3, c.ts, ora)} (misure non validate, con qualche ora di ritardo).`;
  }
  return `${nome}: aria ${a.classe_nome} (${conStato(`indice europeo ${a.modello?.indice_europeo ?? 'n/d'}, modello Copernicus CAMS`, fonteModello, ora)}).`;
}

/** Allerta in forma compatta (null se non c'è nessun avviso). */
export function allertaDi(d, ora) {
  const a = d?.regionale;
  const nessuno = Boolean(d?.nessunAvvisoInVigore);
  const regionale = a
    ? {
        livello: a.livello,
        colore: a.colore,
        attiva: !nessuno && !a.scaduta && a.livello >= 2,
        ...(nessuno ? { nota: 'il Centro Funzionale oggi non ha avvisi in vigore: questo è l\'ultimo avviso emesso' } : {}),
        in_corso: a.inCorso,
        scaduta: a.scaduta,
        fenomeni_tipo: N.descriviTipiAllerta(a.tipi) || null,
        descrizione: a.descrizione,
        fenomeni: a.fenomeni ?? null,
        rischi: a.rischi ?? null,
        dal: oraLocale(a.dal),
        al: oraLocale(a.al),
        avviso_n: a.numero,
        emesso: oraLocale(a.emissione),
        domani: a.domani ? { livello: a.domani.livello, descrizione: a.domani.descrizione } : null,
        zona: 'Zona 1 (Napoli, isole, area vesuviana)',
      }
    : null;
  const dm = d?.domani;
  const domani = dm
    ? {
        livello: dm.livello,
        colore: dm.colore,
        fenomeni_tipo: N.descriviTipiAllerta(dm.tipi) || null,
        descrizione: dm.descrizione,
        dal: oraLocale(dm.dal),
        al: oraLocale(dm.al),
        avviso_n: dm.numero,
        emesso: oraLocale(dm.emissione),
        zona: 'Zona 1 (Napoli, isole, area vesuviana)',
      }
    : null;
  const meteoalarm = (d?.meteoalarm || [])
    .filter((w) => w.fine > ora)
    .map((w) => ({ fenomeno: w.fenomeno, livello: w.livello, colore: w.colore, dal: oraLocale(w.inizio), al: oraLocale(w.fine), in_corso: w.inizio <= ora, titolo: w.titolo }));
  return { regionale, domani, meteoalarm };
}

/** Testo dell'allerta dai dati grezzi di fonti/dati.js (`d`) e dalla forma compatta (`x`). */
function testoAllerta(d, x, ora) {
  const a = d?.regionale;
  const r = x.regionale;
  const parti = [];
  if (r?.attiva) {
    parti.push(
      `ALLERTA ${r.colore.toUpperCase()} per Napoli (Protezione Civile Regione Campania, Zona 1, avviso n. ${r.avviso_n ?? 'n/d'}): ${r.fenomeni_tipo || r.descrizione}, ` +
        `${r.in_corso ? 'in corso' : 'prevista'}${a.al ? ` ${finoA(a.al, ora)}` : ''}.`,
    );
  } else if (r) {
    const ultimo = r.avviso_n ? `l'ultimo avviso (n. ${r.avviso_n}, ${r.colore}) ${r.scaduta ? `è scaduto ${quando(a.al, ora).replace(/^alle/, 'oggi alle')}` : 'non è più in vigore'}` : null;
    parti.push(`Nessuna allerta meteo regionale in corso per Napoli${ultimo ? `: ${ultimo}` : ''}.`);
  } else if (d?.nessunAvvisoInVigore) parti.push('Nessuna allerta meteo regionale in vigore per Napoli.');
  else parti.push('Allerta regionale: dato non disponibile.');
  const dm = x.domani;
  if (dm?.livello >= 2 && d?.domani) {
    parti.push(
      `Per domani la Protezione Civile ha già emesso l'avviso n. ${dm.avviso_n ?? 'n/d'}: allerta ${dm.colore} per ${dm.fenomeni_tipo || dm.descrizione}` +
        `${d.domani.dal && d.domani.al ? `, ${intervallo(d.domani.dal, d.domani.al, ora)}` : ''}.`,
    );
  } else if (r?.domani?.livello >= 2) parti.push(`Domani: ${r.domani.descrizione || `livello ${r.domani.livello}`}.`);
  const ma = (d?.meteoalarm || []).filter((w) => w.fine > ora && w.livello >= 2);
  if (ma.length) {
    const frase = (w) => `${w.fenomeno.toLowerCase()} ${w.colore} ${w.inizio <= ora ? `in corso ${finoA(w.fine, ora)}` : intervallo(w.inizio, w.fine, ora)}`;
    parti.push(`Meteoalarm (avvisi per tutta la Campania): ${ma.slice(0, 3).map(frase).join('; ')}.`);
  }
  return parti.join(' ');
}

/** Orario di un evento in parole, senza inventare orari che le fonti non danno. */
function orarioEvento(e, ora) {
  // senza parentesi: nei testi l'orario sta già dentro "(luogo, orario; fonte)"
  if (e.fonte === 'cruisetimetables') return 'navi in porto in giornata, orari di arrivo e partenza non pubblicati dalla fonte';
  if (e.fonte === 'americascup') return 'giornata di regate, orario da confermare';
  if (e.lungo && e.fine) return N.giornoLocale(e.fine) === N.giornoLocale(ora) ? `in corso, ultimo giorno fino alle ${N.oraBreve(e.fine)}` : `in corso fino al ${N.dataBreve(e.fine, ora)}`;
  if (e.inizio) return `dalle ${N.oraBreve(e.inizio)}${e.fine && e.fonte === 'comune-napoli' ? ` alle ${N.oraBreve(e.fine)}` : ''}`;
  return 'orario da definire';
}

function eventoDi(e, ora) {
  const reale = !['cruisetimetables', 'americascup'].includes(e.fonte); // per questi gli orari sono segnaposto
  return {
    titolo: e.titolo,
    tipo: e.tipo,
    // luogo monitorato della mappa o, per gli eventi del Comune fuori dai 10 luoghi, l'indirizzo dato dal Comune
    luogo: e.zona ? LUOGHI[e.zona]?.nome ?? null : e.fonte === 'comune-napoli' && e.nota ? e.nota.split(' · ')[0] : null,
    zona: e.zona ?? null,
    orario: orarioEvento(e, ora),
    inizio: reale && !e.lungo ? oraLocale(e.inizio) : null,
    fine: reale && !e.lungo ? oraLocale(e.fine) : null,
    in_corso: reale && e.inizio != null ? e.inizio <= ora && ora <= (e.fine ?? e.inizio + 2 * H) : null,
    nota: e.nota || null,
    fonte: NOMI_FONTI_EVENTI[e.fonte] || e.fonte,
    sposta_folla: Boolean(e.scenario),
  };
}

function prossimoDi(p) {
  return { giorno: p.giorno, giorno_testo: giornoTesto(p.giorno), titolo: p.titolo, tipo: p.tipo, luogo: p.zona ? LUOGHI[p.zona]?.nome ?? null : null, zona: p.zona ?? null, nota: p.nota || null };
}

/** 'AAAA-MM-GG' è un giorno del calendario? (Date.parse accetta anche '2026-02-30') */
export function dataEsiste(g) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(g));
  if (!m) return false;
  const [a, me, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const x = new Date(Date.UTC(a, me - 1, d));
  return x.getUTCFullYear() === a && x.getUTCMonth() === me - 1 && x.getUTCDate() === d;
}

/** 'lun 16/11' (con l'anno se diverso da quello di `ora`). */
const breveGiorno = (g, ora) => {
  const [a, m, d] = g.split('-');
  return `${giornoTesto(g).split(' ')[0].slice(0, 3)} ${Number(d)}/${Number(m)}${a !== N.giornoLocale(ora).slice(0, 4) ? `/${a}` : ''}`;
};

/** Stazioni vicine a un punto, in forma compatta. */
function stazioniDi(punto, stazioni, ora, { n = 4, maxKm = 1.2 } = {}) {
  return N.stazioniVicine(punto, stazioni || [], { n, maxKm }).map((s) => {
    const c = N.corseInOra(s, ora);
    return {
      id: s.id,
      nome: s.nome,
      tipo: s.tipo,
      linee: s.linee,
      operatore: s.operatore,
      distanza_m: s.m,
      minuti_a_piedi: s.piedi,
      corse_programmate_in_quest_ora: c?.corse ?? null,
      tipo_giorno: c?.tipo ?? null,
      prossimi_passaggi_disponibili: Boolean(s.transitous?.length),
    };
  });
}

const MODI_FERRO = /SUBWAY|METRO|FUNICULAR|RAIL|SUBURBAN/;
const compatta = (s) => N.piatto(s).replace(/ /g, '');
const operatoreBreve = (a) => (/eav/i.test(a || '') ? 'EAV' : /trenitalia/i.test(a || '') ? 'Trenitalia' : /napoletana|anm/i.test(a || '') ? 'ANM' : a || null);
const VERSO_CUMANA = /torregaveta|bagnoli|pozzuoli|fuorigrotta|arco felice|lucrino|baia|fusaro|cuma/i;
const VERSO_CIRCUMFLEGREA = /licola|quarto|pianura|soccavo|monte sant|grotta del sole|pisani|traiano/i;

/**
 * Nome leggibile della linea di un passaggio: per i treni EAV Transitous dà numeri ("9.", "5"),
 * quindi si usa la rete della stazione (Cumana, Circumflegrea...) e, se sono due, la destinazione.
 */
function nomeLinea(p, stazione) {
  if (!/eav/i.test(p.operatore || '') || /^L\d|^F\d/.test(p.linea)) return p.linea;
  const reti = stazione.linee.filter((l) => !/^[LF]\d/.test(l));
  if (reti.length === 1) return reti[0];
  // Montesanto (capolinea di Cumana e Circumflegrea), anche cercata come stazione della L2
  if (VERSO_CUMANA.test(p.verso)) return 'Cumana';
  if (VERSO_CIRCUMFLEGREA.test(p.verso)) return 'Circumflegrea';
  return `EAV ${p.linea}`.trim();
}

/** Perché mancano i prossimi passaggi, in parole (le note di fonti/dati.js parlano anche di CORS, che qui non c'entra). */
function motivoPassaggi(f) {
  const n = f?.nota || '';
  if (f?.stato !== 'assente') return 'nessuna corsa di metro, funicolare o treno nei prossimi minuti secondo Transitous';
  if (/non trovata su Transitous/i.test(n)) return 'la stazione non è su Transitous';
  if (/in pausa/i.test(n)) return 'Transitous è in pausa per qualche minuto dopo troppe richieste o errori';
  return 'Transitous non risponde adesso';
}

/** Avvisi EAV che citano una delle stazioni. */
function avvisiPer(avvisi, nomiStazioni) {
  const nomi = nomiStazioni.map((n) => N.piatto(n));
  return (avvisi || []).filter((a) => a.stazioni.some((s) => nomi.some((n) => n.includes(N.piatto(s)) || N.piatto(s).includes(n))));
}

function avvisoDi(a) {
  return { titolo: a.titolo, tipo: a.tipo, pubblicato: oraLocale(a.ts), stazioni: a.stazioni, link: a.link };
}

function riferimentiDi(voci, ora) {
  const mese = N.partiLocali(ora).mese - 1;
  return (voci || []).slice(0, 6).map((v) => {
    const out = { tipo: v.tipo, etichetta: v.etichetta, anno: v.anno ?? null };
    if (v.tipo === 'visitatori') {
      out.visitatori_anno = v.totale ?? null;
      if (v.mesi?.[mese] != null) out.visitatori_stesso_mese = v.mesi[mese];
    } else if (v.tipo === 'mare') out.classe_balneazione = v.valore ?? null;
    else out.valore = v.totale ?? v.valore ?? null;
    if (v.nota) out.nota = v.nota;
    out.fonte = v.fonte;
    return out;
  });
}

// ------------------------------------------------------------------ servizio

/**
 * @param {{sorgenti: object, archivio: object, ora?: () => number, stimaFolla?: Function}} o
 */
export function creaCitta(o) {
  const { sorgenti } = o;
  const ora = o.ora || (() => Date.now());
  const leggi = (n, x) => sorgenti.leggi(n, x);

  async function stazioniTutte() {
    return (await leggi('trasporti')).dati?.stazioni || [];
  }

  /** Punto della domanda: uno dei 10 luoghi, una stazione o coordinate. */
  async function risolvi(q, { obbligatorio = true } = {}) {
    const lat = q.lat != null && q.lat !== '' ? Number(String(q.lat).replace(',', '.')) : null;
    const lon = q.lon != null && q.lon !== '' ? Number(String(q.lon).replace(',', '.')) : null;
    if (lat != null || lon != null) {
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new ErroreApi(400, 'lat e lon devono essere due numeri, es. lat=40.8359&lon=14.2488');
      const p = { lat, lon };
      if (distanzaKm(CENTRO, p) > RAGGIO_KM) throw new ErroreApi(400, `il punto è a più di ${RAGGIO_KM} km dal centro di Napoli: l'API copre solo la città`);
      const vicino = luogoPiuVicino(p);
      return { tipo: 'coordinate', nome: `punto ${lat.toFixed(4)}, ${lon.toFixed(4)}`, lat, lon, zona: vicino.km <= 0.4 ? vicino.zona : null, vicino };
    }
    const testo = String(q.nome ?? q.luogo ?? q.q ?? '').trim();
    if (!testo) {
      if (!obbligatorio) return null;
      throw new ErroreApi(400, 'manca il luogo: usa ?nome=… (es. plebiscito, castel dell\'ovo, maradona) oppure ?lat=…&lon=…', { luoghi: ZONE.map((z) => LUOGHI[z].nome) });
    }
    if (testo.length > 120) throw new ErroreApi(400, 'nome del luogo troppo lungo (massimo 120 caratteri)');
    const r = cercaLuoghi(testo, LUOGHI);
    if (r[0]?.punteggio >= SOGLIA) {
      const l = LUOGHI[r[0].id];
      const altri = r.slice(1).filter((x) => x.punteggio >= SOGLIA && x.punteggio >= r[0].punteggio - 5).map((x) => ({ id: x.id, nome: x.luogo.nome }));
      return { tipo: 'luogo', zona: r[0].id, nome: l.nome, lat: l.lat, lon: l.lon, trovato_con: r[0].con, altri };
    }
    // altri luoghi noti senza sensori (Città della Scienza, aeroporto...): prima delle stazioni
    const pn = cercaLuoghi(testo, PUNTI)[0];
    if (pn?.punteggio >= SOGLIA) {
      const x = PUNTI[pn.id];
      const vicino = luogoPiuVicino(x);
      return { tipo: 'punto', id: pn.id, nome: x.nome, categoria: x.categoria, lat: x.lat, lon: x.lon, zona: vicino.km <= 0.4 ? vicino.zona : null, vicino, trovato_con: pn.con };
    }
    const s = cercaStazioni(testo, await stazioniTutte())[0];
    if (s) {
      const p = { lat: s.stazione.lat, lon: s.stazione.lon };
      const vicino = luogoPiuVicino(p);
      return { tipo: 'stazione', nome: `${s.stazione.nome} (stazione ${s.stazione.linee.join(', ')})`, lat: p.lat, lon: p.lon, zona: vicino.km <= 0.4 ? vicino.zona : null, vicino, stazione: s.stazione };
    }
    throw new ErroreApi(404, `luogo "${testo}" non trovato tra i luoghi monitorati, gli altri luoghi noti e le stazioni`, {
      suggerimenti: ZONE.map((z) => LUOGHI[z].nome),
      altri_luoghi_noti: Object.values(PUNTI).map((x) => x.nome),
      aiuto: 'prova con un nome più semplice (es. "plebiscito", "lungomare", "stadio") o con ?lat=…&lon=…',
    });
  }

  function luogoPiuVicino(p) {
    return ZONE.map((z) => ({ zona: z, nome: LUOGHI[z].nome, km: tondo(distanzaKm(p, LUOGHI[z])) })).sort((a, b) => a.km - b.km)[0];
  }

  /** Zona da usare per meteo e aria di un punto (il luogo stesso o il monitorato più vicino). */
  const zonaDati = (p) => p.zona || p.vicino?.zona;
  const notaVicino = (p) => (p.zona ? null : `dati del luogo monitorato più vicino: ${p.vicino.nome} (${it(p.vicino.km)} km)`);

  const descriviPunto = (p) => ({
    id: p.tipo === 'luogo' ? p.zona : p.stazione?.id ?? p.id ?? null,
    nome: p.nome,
    tipo: p.tipo,
    categoria: p.tipo === 'luogo' ? CATEGORIE[LUOGHI[p.zona].categoria] : p.categoria ?? null,
    lat: p.lat,
    lon: p.lon,
    ...(p.trovato_con ? { trovato_con: p.trovato_con } : {}),
    ...(p.vicino && !p.zona ? { luogo_monitorato_vicino: p.vicino } : {}),
  });

  // -------------------------------------------------------------- meteo

  async function meteo(q) {
    const t = ora();
    const p = await risolvi(q, { obbligatorio: false });
    const m = await leggi('meteo');
    const fonte = fonteBreve(m.fonte);
    if (p) {
      const z = zonaDati(p);
      const x = meteoDi(m.dati?.[z]);
      const nota = notaVicino(p);
      return { luogo: descriviPunto(p), meteo: x, ...(nota ? { nota } : {}), fonte, testo: `${testoMeteo(p.zona ? LUOGHI[z].nome : p.nome, x)} Fonte: ${citazione(m.fonte, t)}.${nota ? ` (${nota})` : ''}` };
    }
    const luoghi = ZONE.map((z) => ({ id: z, nome: LUOGHI[z].nome, ...meteoDi(m.dati?.[z]) })).filter((x) => x.temperatura_c != null);
    const citta = riepilogoMeteo(luoghi);
    return { ora: oraLocale(t), citta, luoghi, fonte, testo: `${testoCitta(citta)} Fonte: ${citazione(m.fonte, t)}.` };
  }

  function riepilogoMeteo(luoghi) {
    if (!luoghi.length) return null;
    const temp = luoghi.map((l) => l.temperatura_c);
    const conta = {};
    for (const l of luoghi) if (l.cielo) conta[l.cielo] = (conta[l.cielo] || 0) + 1;
    const max = (k) => Math.max(...luoghi.map((l) => l[k] ?? -Infinity));
    return {
      temperatura_min_c: Math.min(...temp),
      temperatura_max_c: Math.max(...temp),
      cielo_prevalente: Object.entries(conta).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
      vento_max_kmh: Number.isFinite(max('vento_kmh')) ? max('vento_kmh') : null,
      raffiche_max_kmh: Number.isFinite(max('raffiche_kmh')) ? max('raffiche_kmh') : null,
      pioggia_max_mm: Number.isFinite(max('pioggia_mm')) ? max('pioggia_mm') : null,
    };
  }

  function testoCitta(c) {
    if (!c) return 'Meteo a Napoli: non disponibile.';
    const temp = c.temperatura_min_c === c.temperatura_max_c ? `${it(c.temperatura_min_c)} °C` : `tra ${it(c.temperatura_min_c)} e ${it(c.temperatura_max_c)} °C`;
    return `Meteo a Napoli: ${temp}, ${String(c.cielo_prevalente || 'cielo n/d').toLowerCase()}${c.vento_max_kmh != null ? `, vento fino a ${it(c.vento_max_kmh, 0)} km/h` : ''}${c.raffiche_max_kmh != null ? ` (raffiche fino a ${it(c.raffiche_max_kmh, 0)})` : ''}${c.pioggia_max_mm ? `, pioggia fino a ${it(c.pioggia_max_mm)} mm` : ''}.`;
  }

  // -------------------------------------------------------------- aria

  async function aria(q) {
    const t = ora();
    const p = await risolvi(q, { obbligatorio: false });
    const [c, m] = await Promise.all([leggi('centraline'), leggi('ariaModello')]);
    const fonti = { centraline: fonteBreve(c.fonte), modello: fonteBreve(m.fonte) };
    if (p) {
      const z = zonaDati(p);
      const a = ariaDi(z, c.dati, m.dati, t);
      const nota = notaVicino(p);
      return { luogo: descriviPunto(p), aria: a, ...(nota ? { nota } : {}), fonti, testo: `${testoAria(p.zona ? LUOGHI[z].nome : p.nome, a, t, m.fonte)}${nota ? ` (${nota})` : ''}` };
    }
    const luoghi = ZONE.map((z) => {
      const a = ariaDi(z, c.dati, m.dati, t);
      return { id: z, nome: LUOGHI[z].nome, livello: a?.livello ?? null, classe_nome: a?.classe_nome ?? null, origine: a ? (a.origine.startsWith('centralina') ? 'centralina' : 'modello') : null };
    });
    const conClasse = (c.dati?.stazioni || []).map((s) => ({ s, cl: N.classeCentralina(s.misure) }));
    const centraline = conClasse.map(({ s, cl }) => ({
      nome: s.nome,
      codice: s.id,
      tipo: s.tipo ?? null,
      classe: cl ? CLASSI_EAQI[cl.classe] : null,
      inquinante_peggiore: cl?.inquinante ?? null,
      valore_ugm3: cl?.valore ?? null,
      valore_tipo: cl ? (/^PM/.test(cl.inquinante) ? 'media delle ultime 24 ore' : 'misura oraria') : null,
      ora_dato: oraLocale(cl?.ts),
    }));
    const aqi = Object.values(m.dati || {}).map((x) => x.aqi).filter((v) => typeof v === 'number');
    const citta = aqi.length ? { indice_europeo_max: Math.max(...aqi), classe_nome: CLASSI_EAQI[N.classeAqi(Math.max(...aqi))], origine: 'modello Copernicus CAMS' } : null;
    const pg = conClasse.filter((x) => x.cl).sort((a, b) => b.cl.classe - a.cl.classe)[0];
    return {
      ora: oraLocale(t),
      citta,
      luoghi,
      centraline,
      fonti,
      testo:
        `${citta ? `Aria a Napoli: ${citta.classe_nome} secondo il modello Copernicus CAMS (${conStato(`indice europeo ${citta.indice_europeo_max}`, m.fonte, t)}).` : 'Aria a Napoli: modello non disponibile.'}` +
        `${pg ? ` Centraline ARPAC (misure non validate, con qualche ora di ritardo): la peggiore è ${pg.s.nome} (${CLASSI_EAQI[pg.cl.classe]}, ${misuraCentralina(pg.cl.inquinante, pg.cl.valore, pg.cl.ts, t)}).` : ''}`,
    };
  }

  // -------------------------------------------------------------- allerta, terremoti, traffico

  async function allerta() {
    const t = ora();
    const a = await leggi('allerta');
    const x = allertaDi(a.dati, t);
    const s = o.archivio?.get('meteo');
    return {
      ora: oraLocale(t),
      ...x,
      fonte: fonteBreve(a.fonte),
      fonte_meteoalarm: { nome: FONTI.meteoalarm.nome, stato: 'snapshot', ora_dato: oraLocale(Date.parse(s?.meta?.generato)), licenza: FONTI.meteoalarm.licenza, nota: 'avvisi per tutta la Campania, dallo snapshot (la fonte non ha CORS)' },
      testo: `${testoAllerta(a.dati, x, t)} Fonte: ${citazione(a.fonte, t, 'Protezione Civile Regione Campania')}.`,
    };
  }

  async function terremoti() {
    const t = ora();
    const r = await leggi('terremoti');
    const lista = (r.dati || []).slice(0, 8).map((x) => ({ ora: oraLocale(x.ts), magnitudo: x.magnitudo, tipo_magnitudo: x.tipoMag, luogo: x.luogo, profondita_km: x.profonditaKm }));
    const u = r.dati?.[0];
    return {
      ora: oraLocale(t),
      ultimi: lista,
      massima_ultimi_20: r.dati?.length ? Math.max(...r.dati.map((x) => x.magnitudo ?? 0)) : null,
      fonte: fonteBreve(r.fonte, { nota: [r.fonte?.nota, 'Campi Flegrei, ultimi 30 giorni (al massimo 20 eventi)'].filter(Boolean).join('; ') }),
      testo: u ? `Ultimo terremoto ai Campi Flegrei: magnitudo ${u.tipoMag} ${it(u.magnitudo)} ${quando(u.ts, t)}, profondità ${it(u.profonditaKm)} km (INGV).` : 'Nessun terremoto registrato dall\'INGV ai Campi Flegrei negli ultimi 30 giorni, oppure dato non disponibile.',
    };
  }

  async function traffico() {
    const t = ora();
    const r = await leggi('traffico');
    const eventi = (r.dati || []).map((e) => ({ strada: e.strada, tratto: e.tratto || null, tipo: e.tipo, causa: e.causa || null, da: e.da || null, a: e.a || null, coda_km: e.codaKm ?? null, velocita_media_kmh: e.velocita ?? null, aggiornato: oraLocale(e.ts), fino: oraLocale(e.fino) }));
    return {
      ora: oraLocale(t),
      eventi,
      fonte: fonteBreve(r.fonte),
      nota: "Solo Tangenziale di Napoli e autostrade (Autostrade per l'Italia). Per il traffico delle strade cittadine non esistono dati aperti: non dare numeri.",
      testo: r.dati == null ? 'Traffico su tangenziale e autostrade: dato non disponibile.' : eventi.length ? `Tangenziale e autostrade attorno a Napoli: ${eventi.slice(0, 3).map((e) => `${e.strada}: ${e.tipo}${e.coda_km ? ` (coda ${it(e.coda_km)} km)` : ''}${e.da ? ` tra ${e.da}${e.a ? ` e ${e.a}` : ''}` : ''}`).join('; ')} (Autostrade per l'Italia).` : "Nessun evento di traffico su tangenziale e autostrade attorno a Napoli (Autostrade per l'Italia).",
    };
  }

  // -------------------------------------------------------------- trasporti

  async function trasportiVicino(q) {
    const t = ora();
    const p = await risolvi(q);
    let raggio = Math.min(3000, Math.max(200, Number(q.raggio_m) || 1200));
    const tr = await leggi('trasporti');
    let stazioni = stazioniDi(p, tr.dati?.stazioni, t, { n: 5, maxKm: raggio / 1000 });
    let allargato = false;
    // niente entro 1,2 km (Città della Scienza, Posillipo...) e raggio non chiesto: si allarga, dichiarato
    if (!stazioni.length && !q.raggio_m) {
      raggio = RAGGIO_LARGO_M;
      stazioni = stazioniDi(p, tr.dati?.stazioni, t, { n: 3, maxKm: raggio / 1000 });
      allargato = stazioni.length > 0;
    }
    const nomiEav = (tr.dati?.stazioni || []).filter((s) => s.operatore === 'EAV').map((s) => s.nome);
    const av = await leggi('avvisi', { args: [nomiEav] });
    const avvisi = avvisiPer(av.dati, stazioni.map((s) => s.nome)).slice(0, 3).map(avvisoDi);
    const out = { luogo: descriviPunto(p), raggio_m: raggio, ...(allargato ? { nota: `nessuna stazione entro 1200 m: ricerca allargata a ${RAGGIO_LARGO_M} m` } : {}), stazioni, avvisi, fonte: fonteBreve(tr.fonte), fonte_avvisi: fonteBreve(av.fonte) };
    let pass = null;
    if (/^(1|si|sì|true)$/i.test(String(q.passaggi ?? ''))) {
      const prima = (tr.dati?.stazioni || []).find((s) => s.id === stazioni.find((x) => x.prossimi_passaggi_disponibili)?.id);
      if (prima) {
        pass = await passaggiDi(prima, t, {});
        out.prossimi_passaggi = { stazione: prima.nome, passaggi: pass.passaggi, fonte: pass.fonte };
      }
    }
    const lista = stazioni.map((s) => `${s.nome} (${s.linee.join(', ')}) a ${s.minuti_a_piedi} min a piedi`);
    out.testo = stazioni.length
      ? `${allargato ? `Nessuna stazione entro 1200 m da ${p.nome}; le più vicine` : `Vicino a ${p.nome}`}: ${lista.join('; ')}. Orari GTFS di ANM ed EAV (programmati).${pass?.passaggi?.length ? ` Prossime partenze da ${out.prossimi_passaggi.stazione}: ${pass.passaggi.slice(0, 3).map((x) => `${x.ora} ${x.linea} per ${x.direzione}`).join(', ')}.` : ''}${avvisi.length ? ` Avvisi EAV: ${avvisi.map((a) => a.titolo).join('; ')}.` : ''}`
      : `Nessuna stazione di metro, funicolare o treno entro ${raggio} m da ${p.nome}.`;
    return out;
  }

  async function passaggiDi(stazione, t, { linea = null }) {
    const r = await leggi('passaggi', { chiave: `passaggi:${stazione.id}`, args: [stazione] });
    // Transitous raggruppa le fermate vicine (Montesanto: L2 + Cumana + Circumflegrea): si tengono
    // solo metro, funicolari e treni, con il nome della linea leggibile anche per i treni EAV
    let lista = (r.dati || []).filter((x) => x.ts >= t - 60_000 && (!x.modo || MODI_FERRO.test(x.modo))).map((x) => ({ ...x, nomeLinea: nomeLinea(x, stazione) }));
    // un treno con numero (FR 9583, REG 5790) parte una volta sola: Transitous a volte lo dà due
    // volte, da due fermate raggruppate della stessa stazione; si tiene la prima partenza
    const treni = new Set();
    lista = lista.filter((x) => {
      if (!/\d{3,}/.test(x.linea || '')) return true;
      const k = `${x.linea}|${x.verso}`;
      return !treni.has(k) && treni.add(k);
    });
    if (linea) lista = lista.filter((x) => [x.nomeLinea, x.linea].some((l) => compatta(l) === compatta(linea)));
    return {
      passaggi: lista.map((x) => ({
        ora: N.oraBreve(x.ts),
        tra_min: Math.max(0, Math.round((x.ts - t) / 60_000)),
        linea: x.nomeLinea,
        direzione: x.verso,
        operatore: operatoreBreve(x.operatore),
        tempo_reale: x.tempoReale,
        ritardo_min: x.ritardoMin,
        soppresso: x.soppresso || false,
      })),
      fonte: fonteBreve(r.fonte, { nota: [r.fonte?.nota, 'citare transitous.org/sources'].filter(Boolean).join('; ') }),
    };
  }

  async function passaggi(q) {
    const t = ora();
    const testo = String(q.stazione ?? q.nome ?? '').trim();
    if (!testo) throw new ErroreApi(400, 'manca la stazione: usa ?stazione=… (es. toledo, municipio, montesanto, campi flegrei)');
    if (testo.length > 120 || String(q.linea ?? '').length > 40) throw new ErroreApi(400, 'nome della stazione o della linea troppo lungo');
    const tutte = await stazioniTutte();
    const trovate = cercaStazioni(testo, tutte, { linea: q.linea || null });
    if (!trovate.length) {
      throw new ErroreApi(404, `stazione "${testo}" non trovata${q.linea ? ` sulla linea ${q.linea}` : ''}`, { aiuto: 'usa il nome della stazione di metro, funicolare o treno (es. "Toledo", "Mergellina", "Napoli Centrale") o /citta/trasporti/vicino?luogo=…' });
    }
    const s = trovate[0].stazione;
    const pr = await passaggiDi(s, t, { linea: q.linea || null });
    const c = N.corseInOra(s, t);
    const c2 = N.corseInOra(s, t + H);
    const programmato = { corse_in_quest_ora: c?.corse ?? null, corse_nell_ora_dopo: c2?.corse ?? null, tipo_giorno: c?.tipo ?? null, fonte: 'GTFS ANM ed EAV (orario programmato)' };
    const altre = trovate.slice(1, 4).map((x) => ({ id: x.stazione.id, nome: x.stazione.nome, linee: x.stazione.linee, tipo: x.stazione.tipo }));
    // Transitous può raggruppare altre reti nella stessa stazione (a "Napoli Centrale" di EAV i treni
    // Trenitalia): allora l'operatore si scrive accanto alla corsa e non si elencano le linee della stazione
    const operatoreStazione = operatoreBreve(s.operatore);
    const altroOperatore = (x) => x.operatore && x.operatore !== operatoreStazione;
    const nome = pr.passaggi.some(altroOperatore) ? s.nome : `${s.nome} (${s.linee.join(', ')})`;
    const testoOut = pr.passaggi.length
      ? `Prossime partenze da ${nome}: ${pr.passaggi.slice(0, 5).map((x) => `${x.ora} ${x.linea}${altroOperatore(x) ? ` ${x.operatore}` : ''} per ${x.direzione}${x.soppresso ? ' (soppresso)' : x.tempo_reale ? (x.ritardo_min ? ` (${x.ritardo_min > 0 ? '+' : ''}${x.ritardo_min} min)` : ' (in orario, tempo reale)') : ''}`).join(', ')}. Fonte: Transitous${pr.passaggi.some((x) => x.tempo_reale) ? ' (con dati in tempo reale)' : ' (orari programmati, senza tempo reale)'}.`
      : `Prossimi passaggi da ${nome} non disponibili: ${motivoPassaggi(pr.fonte)}. Orario programmato: ${programmato.corse_in_quest_ora ?? 'n/d'} corse in quest'ora (${programmato.tipo_giorno ?? 'n/d'}), ${programmato.corse_nell_ora_dopo ?? 'n/d'} nell'ora successiva.`;
    return {
      stazione: { id: s.id, nome: s.nome, tipo: s.tipo, linee: s.linee, operatore: s.operatore, lat: s.lat, lon: s.lon },
      ...(altre.length ? { altre_stazioni_con_nome_simile: altre } : {}),
      ora: oraLocale(t),
      passaggi: pr.passaggi,
      fonte: pr.fonte,
      programmato,
      testo: testoOut,
    };
  }

  // -------------------------------------------------------------- eventi

  function giornoDa(s, t) {
    const oggi = N.giornoLocale(t);
    const piu = (k) => N.giornoLocale(N.inizioGiorno(oggi) + k * 24 * H + 12 * H);
    const v = N.piatto(s || 'oggi');
    if (v === 'oggi') return oggi;
    if (v === 'domani') return piu(1);
    if (v === 'dopodomani') return piu(2);
    if (v === 'ieri') return piu(-1);
    const giorni = ['domenica', 'lunedi', 'martedi', 'mercoledi', 'giovedi', 'venerdi', 'sabato'];
    const g = giorni.indexOf(v);
    if (g >= 0) {
      for (let k = 0; k < 7; k++) if (new Date(`${piu(k)}T12:00:00Z`).getUTCDay() === g) return piu(k);
    }
    let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(s).trim());
    if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    m = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?$/.exec(String(s).trim());
    if (m) {
      const a = m[3] ? (m[3].length === 2 ? `20${m[3]}` : m[3]) : oggi.slice(0, 4);
      return `${a}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    }
    throw new ErroreApi(400, `giorno "${s}" non capito: usa oggi, domani, dopodomani, un giorno della settimana, AAAA-MM-GG o GG/MM`);
  }

  async function eventi(q) {
    const t = ora();
    const giorno = giornoDa(q.giorno, t);
    if (!dataEsiste(giorno)) throw new ErroreApi(400, `data non valida: ${giorno} (usa AAAA-MM-GG o GG/MM con un giorno che esiste)`);
    const p = q.luogo ? await risolvi({ nome: q.luogo }) : null;
    // si filtra solo per uno dei 10 luoghi monitorati (o un punto a meno di 400 m): gli eventi degli
    // altri posti non hanno una zona, e filtrarli col luogo monitorato più vicino li nasconderebbe
    const zona = p?.zona ?? null;
    const notaLuogo = p && !zona ? `${p.nome} non è uno dei luoghi monitorati: elenco gli eventi di tutta la città (il luogo monitorato più vicino è ${p.vicino.nome}, a ${it(p.vicino.km)} km)` : null;
    const ev = await leggi('eventi');
    let lista = N.eventiDelGiorno(ev.dati, giorno).map((e) => eventoDi(e, giorno === N.giornoLocale(t) ? t : N.inizioGiorno(giorno) + 12 * H));
    let prossimi = N.prossimiEventi(ev.dati, giorno, { max: 8 }).map(prossimoDi);
    if (zona) {
      lista = lista.filter((e) => e.zona === zona);
      prossimi = prossimi.filter((e) => e.zona === zona);
    }
    const dove = zona ? ` (${LUOGHI[zona].nome})` : '';
    const testo =
      `${giornoTesto(giorno).replace(/^./, (c) => c.toUpperCase())} a Napoli${dove}: ` +
      (lista.length ? lista.slice(0, 6).map((e) => `${e.titolo} (${[e.luogo, e.orario].filter(Boolean).join(', ')}; ${e.fonte})`).join('; ') : 'nessun evento in calendario nelle fonti consultate') +
      '.' +
      (prossimi.length ? ` Prossimi: ${prossimi.slice(0, 5).map((x) => `${breveGiorno(x.giorno, t)} ${x.titolo}${x.luogo ? ` (${x.luogo}${x.nota && x.zona === 'maradona' ? `, ${x.nota}` : ''})` : ''}`).join('; ')}.` : '') +
      (notaLuogo ? ` (${notaLuogo[0].toUpperCase()}${notaLuogo.slice(1)}.)` : '');
    return {
      giorno,
      giorno_testo: giornoTesto(giorno),
      ...(p ? { luogo: descriviPunto(p) } : {}),
      ...(notaLuogo ? { nota_luogo: notaLuogo } : {}),
      eventi: lista,
      prossimi,
      fonte: fonteBreve(ev.fonte),
      nota: 'Eventi del Comune: solo quelli dell\'agenda corrente (10 alla volta). "sposta_folla" è un\'ipotesi della simulazione. Navi da crociera da Cruise Timetables (fonte non ufficiale), regate dal calendario America\'s Cup 2027.',
      testo,
    };
  }

  // -------------------------------------------------------------- folla

  async function follaDi(zona, t, ev, rif) {
    if (!o.stimaFolla || !LUOGHI[zona]) return null;
    const attivi = scenariAttivi({ eventi: ev, riferimenti: rif, ora: t });
    const s = o.stimaFolla(zona, { ora: t, attivi, capienza: LUOGHI[zona].capienza });
    return s ? { ...s, stato: 'simulato', nota: NOTA_FOLLA } : null;
  }

  // -------------------------------------------------------------- luoghi e luogo

  async function luoghi() {
    const tr = await leggi('trasporti');
    const perId = new Map((tr.dati?.stazioni || []).map((s) => [s.id, s]));
    return {
      luoghi: ZONE.map((z) => {
        const l = LUOGHI[z];
        const v = tr.dati?.vicine?.[z]?.[0];
        const s = v && perId.get(v.id);
        return { id: z, nome: l.nome, categoria: CATEGORIE[l.categoria], lat: l.lat, lon: l.lon, si_cerca_anche_con: (l.parole || []).slice(0, 6), stazione_piu_vicina: s ? `${s.nome} (${s.linee.join(', ')}), ${v.piedi} min a piedi` : null };
      }),
      altri_luoghi_noti: Object.values(PUNTI).map((x) => x.nome),
      nota: 'Sono i 10 luoghi monitorati (sensori simulati della demo). /citta/luogo accetta anche nomi di vie, monumenti e stazioni (es. "via toledo", "maschio angioino", "bagnoli"), gli altri luoghi noti (senza sensori: meteo e aria del luogo monitorato più vicino, dichiarato) e lat/lon.',
    };
  }

  async function luogo(q) {
    const t = ora();
    const p = await risolvi(q);
    const z = zonaDati(p);
    const [m, c, am, al, tr, ev, rif] = await Promise.all([leggi('meteo'), leggi('centraline'), leggi('ariaModello'), leggi('allerta'), leggi('trasporti'), leggi('eventi'), leggi('riferimenti')]);
    const nomiEav = (tr.dati?.stazioni || []).filter((s) => s.operatore === 'EAV').map((s) => s.nome);
    const av = await leggi('avvisi', { args: [nomiEav] });
    const mt = meteoDi(m.dati?.[z]);
    const ar = ariaDi(z, c.dati, am.dati, t);
    const all = allertaDi(al.dati, t);
    let stazioni = stazioniDi(p, tr.dati?.stazioni, t);
    // nessuna stazione entro 1,2 km: le 2 più vicine entro 2,5 km (il testo dice i minuti a piedi)
    if (!stazioni.length) stazioni = stazioniDi(p, tr.dati?.stazioni, t, { n: 2, maxKm: RAGGIO_LARGO_M / 1000 });
    const avvisi = avvisiPer(av.dati, stazioni.map((s) => s.nome)).slice(0, 3).map(avvisoDi);
    const oggi = p.zona ? N.eventiDelGiorno(ev.dati, N.giornoLocale(t)).filter((e) => e.zona === p.zona).map((e) => eventoDi(e, t)) : [];
    const prossimi = p.zona ? N.prossimiEventi(ev.dati, N.giornoLocale(t), { max: 12 }).filter((e) => e.zona === p.zona).slice(0, 4).map(prossimoDi) : [];
    const folla = p.zona ? await follaDi(p.zona, t, ev.dati, rif.dati) : null;
    const nota = notaVicino(p);
    const nome = p.zona ? LUOGHI[p.zona].nome : p.nome;
    const parti = [testoMeteo(nome, mt).replace(/\.$/, ` (${citazione(m.fonte, t, nomeMeteo(m.fonte))}).`)];
    // maiuscolo come in /citta/allerta e nel riassunto: la skill di TwinCIRO cerca "ALLERTA"
    if (all.regionale?.attiva) parti.unshift(`ALLERTA ${all.regionale.colore.toUpperCase()} per Napoli: ${all.regionale.fenomeni_tipo || all.regionale.descrizione}.`);
    if (ar) parti.push(`Aria ${ar.classe_nome}${ar.origine.startsWith('centralina') ? ` (centralina ARPAC ${ar.centralina.nome}, misura ${delle(ar.centralina.ts, t)})` : ` (${conStato('modello CAMS', am.fonte, t)})`}.`);
    if (stazioni.length) parti.push(`Stazioni vicine: ${stazioni.slice(0, 3).map((s) => `${s.nome} (${s.linee.join(', ')}) ${s.minuti_a_piedi} min a piedi`).join('; ')}.`);
    if (oggi.length) parti.push(`Oggi qui: ${oggi.map((e) => `${e.titolo} (${e.orario})`).join('; ')}.`);
    else if (prossimi.length) parti.push(`Prossimo evento qui: ${prossimi[0].titolo}, ${prossimi[0].giorno_testo}.`);
    const chiusi = p.zona ? (rif.dati?.perZona?.[p.zona] || []).filter((v) => v.tipo === 'visitatori' && v.chiuso) : [];
    for (const v of chiusi.slice(0, 2)) parti.push(`Dati del Comune: nel ${v.anno} ${v.etichetta} risultava ${v.nota || 'chiuso'} (0 visitatori): verificare l'apertura prima di andare.`);
    if (folla) parti.push(`Folla stimata (simulata, non misurata): ${folla.livello.toLowerCase()}, circa ${it(folla.persone_stimate, 0)} persone.`);
    if (nota) parti.push(`(${nota[0].toUpperCase()}${nota.slice(1)}.)`);
    return {
      luogo: descriviPunto(p),
      ...(p.altri?.length ? { altri_luoghi_possibili: p.altri } : {}),
      ora: oraLocale(t),
      meteo: mt ? { ...mt, fonte: fonteBreve(m.fonte) } : null,
      aria: ar ? { ...ar, fonti: { centraline: fonteBreve(c.fonte), modello: fonteBreve(am.fonte) } } : null,
      allerta: all.regionale?.attiva ? { livello: all.regionale.livello, colore: all.regionale.colore, fenomeni_tipo: all.regionale.fenomeni_tipo, al: all.regionale.al } : null,
      trasporti: { stazioni, avvisi, fonte: fonteBreve(tr.fonte) },
      eventi_oggi: oggi,
      prossimi_eventi: prossimi,
      riferimenti: p.zona ? { voci: riferimentiDi(rif.dati?.perZona?.[p.zona], t), fonte: fonteBreve(rif.fonte) } : null,
      folla,
      ...(nota ? { nota } : {}),
      testo: parti.join(' '),
    };
  }

  // -------------------------------------------------------------- riassunto

  async function riassunto() {
    const t = ora();
    const oggi = N.giornoLocale(t);
    const [m, am, c, al, ev, rif, te, tr] = await Promise.all(['meteo', 'ariaModello', 'centraline', 'allerta', 'eventi', 'riferimenti', 'terremoti', 'trasporti'].map((n) => leggi(n)));
    const nomiEav = (tr.dati?.stazioni || []).filter((s) => s.operatore === 'EAV').map((s) => s.nome);
    const av = await leggi('avvisi', { args: [nomiEav] });

    const luoghiMeteo = ZONE.map((z) => ({ id: z, nome: LUOGHI[z].nome, ...meteoDi(m.dati?.[z]) })).filter((x) => x.temperatura_c != null);
    const citta = riepilogoMeteo(luoghiMeteo);
    const all = allertaDi(al.dati, t);
    const aqi = Object.values(am.dati || {}).map((x) => x.aqi).filter((v) => typeof v === 'number');
    const ariaLuoghi = Object.fromEntries(ZONE.map((z) => [z, ariaDi(z, c.dati, am.dati, t)?.classe_nome ?? null]));
    const eventiOggi = N.eventiDelGiorno(ev.dati, oggi).map((e) => eventoDi(e, t));
    const prossimi = N.prossimiEventi(ev.dati, oggi, { max: 6 }).map(prossimoDi);
    const avvisi = [...(av.dati || [])].sort((a, b) => Number(!a.stazioni.length) - Number(!b.stazioni.length) || (b.ts ?? 0) - (a.ts ?? 0)).slice(0, 3).map(avvisoDi);
    const terremoto = te.dati?.[0] ? { ora: oraLocale(te.dati[0].ts), magnitudo: te.dati[0].magnitudo, tipo_magnitudo: te.dati[0].tipoMag, luogo: te.dati[0].luogo, profondita_km: te.dati[0].profonditaKm } : null;
    const st = N.stagione(rif.dati, N.partiLocali(t).mese);
    const folla = {};
    for (const z of ZONE) {
      const f = await follaDi(z, t, ev.dati, rif.dati);
      if (f) folla[z] = { livello: f.livello, persone_stimate: f.persone_stimate };
    }

    const parti = [`Napoli, ${giornoTesto(oggi)}, ore ${N.oraBreve(t)}.`];
    parti.push(testoAllerta(al.dati, all, t));
    parti.push(`${testoCitta(citta).replace(/\.$/, '')} (${citazione(m.fonte, t, nomeMeteo(m.fonte))}).`);
    if (aqi.length) parti.push(`Aria: ${CLASSI_EAQI[N.classeAqi(Math.max(...aqi))]} secondo il modello Copernicus CAMS (${conStato(`indice europeo ${Math.max(...aqi)}`, am.fonte, t)}).`);
    parti.push(
      eventiOggi.length
        ? `Oggi: ${eventiOggi.slice(0, 5).map((e) => `${e.titolo} (${[e.luogo, e.orario].filter(Boolean).join(', ')})`).join('; ')}.`
        : 'Oggi nessun grande evento in calendario nelle fonti consultate.',
    );
    if (prossimi.length) parti.push(`Prossimi: ${prossimi.slice(0, 4).map((x) => `${breveGiorno(x.giorno, t)} ${x.titolo}${x.zona === 'maradona' && /^\d{1,2}:\d{2}$/.test(x.nota || '') ? ` alle ${x.nota}` : ''}`).join('; ')}.`);
    if (avvisi.length) parti.push(`Avvisi EAV (treni regionali): ${avvisi.map((a) => a.titolo).join('; ')}.`);
    parti.push("Per metro e funicolari ANM non c'è un'API dello stato del servizio: per guasti rimanda all'app ANM Go.");
    if (terremoto) parti.push(`Ultimo terremoto ai Campi Flegrei: ${terremoto.tipo_magnitudo} ${it(terremoto.magnitudo)} ${quando(te.dati[0].ts, t)} (INGV).`);
    if (st) parti.push(`Stagione turistica: gli arrivi di questo mese sono ${it(st.indice, 2)} volte la media mensile (ISTAT ${st.anno}, provincia di Napoli).`);
    parti.push('La folla per luogo è una stima del simulatore, non una misura.');

    const fonti = [
      ['meteo', m],
      ['aria (modello)', am],
      ['aria (centraline)', c],
      ['allerta', al],
      ['eventi', ev],
      ['avvisi EAV', av],
      ['terremoti', te],
      ['trasporti (orari)', tr],
      ['riferimenti', rif],
    ].map(([dato, x]) => ({ dato, nome: x.fonte?.nome ?? null, stato: STATI[x.fonte?.tipo] || 'assente', ora_dato: oraLocale(x.fonte?.ts) }));
    fonti.push({ dato: 'folla', nome: 'simulatore della demo (sim-config.json)', stato: 'simulato', ora_dato: oraLocale(t) });

    return {
      ora: oraLocale(t),
      giorno: giornoTesto(oggi),
      testo: parti.join(' '),
      allerta: all,
      meteo: { citta, luoghi: Object.fromEntries(luoghiMeteo.map((l) => [l.id, `${it(l.temperatura_c)} °C, ${String(l.cielo || 'n/d').toLowerCase()}, vento ${it(l.vento_kmh, 0)} km/h`])), fonte: fonteBreve(m.fonte) },
      aria: { indice_europeo_max: aqi.length ? Math.max(...aqi) : null, luoghi: ariaLuoghi, fonte_modello: fonteBreve(am.fonte), fonte_centraline: fonteBreve(c.fonte) },
      eventi_oggi: eventiOggi,
      prossimi_eventi: prossimi,
      trasporti: { avvisi, fonte_avvisi: fonteBreve(av.fonte), nota: "Nessuna API pubblica dello stato del servizio ANM (metro e funicolari). Prossimi passaggi: /citta/passaggi?stazione=…" },
      terremoti: { ultimo: terremoto, fonte: fonteBreve(te.fonte) },
      stagione: st ? { mese: st.mese, indice: st.indice, arrivi: st.arrivi, stranieri_pct: st.stranieriPct, anno_istat: st.anno } : null,
      folla_stimata: { stato: 'simulato', luoghi: folla, nota: NOTA_FOLLA },
      fonti,
      legenda_stati: LEGENDA_STATI,
    };
  }

  return { riassunto, luoghi, luogo, meteo, aria, allerta, terremoti, traffico, trasportiVicino, passaggi, eventi, risolvi };
}
