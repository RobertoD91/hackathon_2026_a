#!/usr/bin/env node
// Knowledge graph della città il giorno della regata: la scena 8 del video e la pagina navigabile.
//
// Costruisce c5-presentazione/grafo/grafo.json SOLO dai dati e dal codice della repository: ogni arco
// segue una regola scritta in meta.regole e dice da quale file viene. Nessuna relazione scritta a mano.
//   - luoghi e coordinate: citta-api/fonti/luoghi.js (i 10 luoghi) e citta-api/src/punti.js (luoghi noti);
//     zone, eventi della giornata e flussi: c5-agentic-city/dati/scenario_regata.json; luoghi per i
//     turisti: c5-agentic-city/dati/luoghi.json; imprese (di fantasia): c5-agentic-city/dati/imprese.json;
//   - stazioni vicine: snapshot GTFS citta-api/dati/trasporti.json con stazioniVicine() dell'API;
//   - agenti e chi parla con chi: i topic MQTT pubblicati e ascoltati nel codice di c5-agentic-city/citta/;
//   - sensori: zona e grandezze dal firmware del badge WHY2025 e dalle regole di Tasmota (firmware/);
//   - fonti: catalogo dell'API (citta-api/fonti/dati.js) e degli snapshot; loghi della scena 4 se ci sono.
// Calcola anche il layout, deterministico (stesse posizioni a ogni esecuzione, nessun numero casuale),
// in coordinate del fotogramma 1920×1080 del video, e lo salva nel JSON. Infine riscrive il blocco dati
// della scena del video (c5-presentazione/scene/grafo.html, tra <script id="dati-grafo"> e </script>):
// la scena è servita da sola dal renderer (scene/rendi_html.mjs serve solo scene/) e il montaggio la
// rigenera quando il file cambia.
//
//   node c5-presentazione/grafo/genera.mjs              # scrive grafo.json e aggiorna la scena
//   node c5-presentazione/grafo/genera.mjs --controlla  # esce con 1 se grafo.json o la scena non sono aggiornati

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LUOGHI, CATEGORIE, distanzaKm } from '../../citta-api/fonti/luoghi.js';
import { PUNTI } from '../../citta-api/src/punti.js';
import { stazioniVicine, zonaPerTesto } from '../../citta-api/fonti/normalizza.js';
import { FONTI } from '../../citta-api/fonti/dati.js';

const QUI = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(QUI, '../..');
const CONTROLLA = process.argv.includes('--controlla');

const F = {
  scenario: 'c5-agentic-city/dati/scenario_regata.json',
  imprese: 'c5-agentic-city/dati/imprese.json',
  turismo: 'c5-agentic-city/dati/luoghi.json',
  agenti: 'c5-agentic-city/citta/agenti',
  sala: 'c5-agentic-city/citta/sala.py',
  sensoriPy: 'c5-agentic-city/citta/sensori.py',
  api: 'c5-agentic-city/citta/api.py',
  skillDati: 'c5-agentic-city/openclaw/skills/napoli-citta-dati/SKILL.md',
  skillCitta: 'c5-agentic-city/openclaw/skills/twinciro-citta/SKILL.md',
  trasporti: 'citta-api/dati/trasporti.json',
  aria: 'citta-api/dati/aria.json',
  eventi: 'citta-api/dati/eventi.json',
  luoghiApi: 'citta-api/fonti/luoghi.js',
  punti: 'citta-api/src/punti.js',
  datiApi: 'citta-api/fonti/dati.js',
  firmware: 'firmware/README.md',
  badge: 'firmware/why2025-badge/overlay/main/badge/telemetry_cfg.h',
  tasmota: 'firmware/tasmota/README.md',
  catalogo: 'c5-presentazione/scene/fonti/catalogo.json', // facoltativo: loghi delle fonti (scena 4)
  json: 'c5-presentazione/grafo/grafo.json',
  scena: 'c5-presentazione/scene/grafo.html',
};
const leggi = (f) => fs.readFileSync(path.join(REPO, f), 'utf8');
const esiste = (f) => fs.existsSync(path.join(REPO, f));
const json = (f) => JSON.parse(leggi(f));

const scenario = json(F.scenario);
const imprese = json(F.imprese).imprese;
const turismo = json(F.turismo);
const trasporti = json(F.trasporti);
const aria = json(F.aria);
const eventiApi = json(F.eventi);
const catalogo = esiste(F.catalogo) ? json(F.catalogo) : null;

// ------------------------------------------------------------------ tipi

const TIPI_NODO = {
  luogo: { nome: 'Luoghi e zone', colore: '#38d6f0', forma: 'cerchio', strato: 1 },
  evento: { nome: 'Eventi', colore: '#f45d5d', forma: 'rombo', strato: 2 },
  stazione: { nome: 'Stazioni', colore: '#a78bfa', forma: 'quadrato', strato: 3 },
  impresa: { nome: 'Imprese', colore: '#4ade80', forma: 'triangolo', strato: 3 },
  agente: { nome: 'Agenti', colore: '#ffb547', forma: 'esagono', strato: 4 },
  sensore: { nome: 'Sensori', colore: '#f1f5f9', forma: 'onde', strato: 5 },
  fonte: { nome: 'Fonti', colore: '#cbd5e1', forma: 'logo', strato: 5 },
};

const TIPI_ARCO = {
  'vicino a': { colore: '#38d6f0', strato: 1 },
  'si svolge a': { colore: '#f45d5d', strato: 2 },
  'flusso verso': { colore: '#f45d5d', strato: 2 },
  'servito da': { colore: '#a78bfa', strato: 3 },
  'offerta a': { colore: '#4ade80', strato: 3 },
  monitora: { colore: '#ffb547', strato: 4 },
  'parla con': { colore: '#ffb547', strato: 4 },
  alimenta: { colore: '#cbd5e1', strato: 5 },
};

const VICINO_KM = 1.2; // "vicino a": entro 1,2 km in linea d'aria, lo stesso raggio delle stazioni vicine dell'API
const STAZIONI = { n: 3, maxKm: 1.2, nLargo: 2, maxKmLargo: 2.5 }; // come /citta/trasporti/vicino (RAGGIO_LARGO_M)
const piedi = (m) => Math.max(1, Math.round((m * 1.3) / 75)); // stessa stima dell'API (4,5 km/h, percorso 1,3 × la linea d'aria)
const it = (n) => Math.round(n).toLocaleString('it-IT');

const REGOLE = {
  'vicino a': `Due luoghi a meno di ${String(VICINO_KM).replace('.', ',')} km in linea d'aria (coordinate di citta-api/fonti/luoghi.js, src/punti.js e dello scenario; distanzaKm dell'API; per le zone con due punti di riferimento vale il più vicino). Un luogo per i turisti è vicino alla zona a cui lo assegna c5-agentic-city/dati/luoghi.json e al luogo che nomina (zonaPerTesto dell'API).`,
  'si svolge a': "Il luogo che l'evento dello scenario nomina (zonaPerTesto sulle parole dei luoghi dell'API), altrimenti la zona dell'evento.",
  'flusso verso': "I flussi di persone degli eventi nello scenario, con la quota di persone verso ogni zona; «fuorigrotta» è lo stadio Maradona (assistente.py e parole del luogo nell'API).",
  'servito da': `Le ${STAZIONI.n} stazioni su ferro più vicine entro ${String(STAZIONI.maxKm).replace('.', ',')} km (se non ce ne sono, le ${STAZIONI.nLargo} più vicine entro ${String(STAZIONI.maxKmLargo).replace('.', ',')} km): stazioniVicine() dell'API sullo snapshot GTFS, come /citta/trasporti/vicino.`,
  'offerta a': "L'impresa (di fantasia) propone sconti nelle sue ore vuote nella sua zona: imprese.json, agente Imprese; l'agente Turismo li suggerisce a chi è in una zona affollata.",
  monitora: 'Folla → ogni zona dello scenario (stima delle persone), Eventi → gli eventi del calendario, Imprese → le imprese, Meteo&Mare → la regata (vento e onda decidono se si fa); un sensore → la zona configurata nel suo firmware.',
  'parla con': "Uno pubblica sul bus MQTT un topic che l'altro ascolta o legge (topic letti nel codice di c5-agentic-city/citta/; per la sala operativa e il drone, gli endpoint dell'API della città che usano).",
  alimenta: "Una fonte che dà i dati a un luogo, a una stazione, a un evento o a un agente (citta-api: meteo e aria per luogo, GTFS per stazione, calendari degli eventi; c5-agentic-city: Open-Meteo per Meteo&Mare, presenze da rete mobile simulate per Folla); un sensore che manda le sue letture a un agente (topic napoli/sensori/...).",
};

// Nomi brevi per le etichette (solo presentazione: il nome completo resta in `nome`)
const BREVI = {
  'luogo:centro_storico': 'Centro storico',
  'luogo:garibaldi': 'Napoli Centrale',
  'luogo:maradona': 'Stadio Maradona',
  'luogo:lungomare': 'Lungomare Caracciolo',
  'luogo:plebiscito': 'Piazza del Plebiscito',
  'luogo:gozzo': 'Giro in gozzo',
  'luogo:beverello': 'Molo Beverello',
  'luogo:municipio': 'Piazza Municipio',
};
const breve = (id, nome) => BREVI[id] || String(nome).split(/ · | \/ | \(| – | e (?=[A-Z])/)[0].trim();

// ------------------------------------------------------------------ nodi e archi

const nodi = new Map();
const archi = [];
const relazioni = new Set();

function nodo(id, tipo, campi) {
  if (nodi.has(id)) return Object.assign(nodi.get(id), campi);
  const n = { id, tipo, ...campi };
  nodi.set(id, n);
  return n;
}

function arco(da, a, tipo, campi = {}) {
  if (!nodi.has(da) || !nodi.has(a)) throw new Error(`arco ${tipo} con un nodo che non c'è: ${da} → ${a}`);
  if (da === a) return;
  const chiave = `${da}|${a}|${tipo}`;
  if (relazioni.has(chiave)) return;
  relazioni.add(chiave);
  archi.push({ da, a, tipo, ...campi });
}

// --- luoghi e zone ---------------------------------------------------------------------------------

for (const [k, z] of Object.entries(scenario.zone)) {
  nodo(`luogo:${k}`, 'luogo', {
    nome: z.nome,
    sottotipo: 'zona dello scenario',
    chiave: k,
    lat: z.lat,
    lon: z.lon,
    punti: [{ lat: z.lat, lon: z.lon, da: F.scenario }],
    capienza: z.capienza,
    stato: 'zona dello scenario della regata: coordinate e capienza indicative',
    origine: [F.scenario],
  });
}
for (const [k, l] of Object.entries(LUOGHI)) {
  const id = `luogo:${k}`;
  const prima = nodi.get(id);
  nodo(id, 'luogo', {
    nome: prima ? prima.nome : l.nome,
    nome_api: l.nome,
    sottotipo: prima ? 'zona dello scenario e luogo monitorato' : 'luogo monitorato',
    chiave: k,
    categoria: CATEGORIE[l.categoria],
    // per le stazioni vicine valgono le coordinate dell'API, così la risposta coincide con /citta/trasporti/vicino
    lat: l.lat,
    lon: l.lon,
    punti: [...(prima?.punti || []), { lat: l.lat, lon: l.lon, da: F.luoghiApi }],
    capienza_mappa: l.capienza,
    parole: l.parole,
    stato: prima ? prima.stato : 'luogo reale (coordinate dell\'API dati città); capienza della mappa indicativa',
    origine: [...(prima?.origine || []), F.luoghiApi],
  });
}
for (const [k, p] of Object.entries(PUNTI)) {
  nodo(`luogo:${k}`, 'luogo', {
    nome: p.nome,
    sottotipo: 'luogo noto',
    chiave: k,
    categoria: p.categoria,
    lat: p.lat,
    lon: p.lon,
    punti: [{ lat: p.lat, lon: p.lon, da: F.punti }],
    stato: 'luogo reale senza sensori (coordinate indicative, circa 100 m)',
    origine: [F.punti],
  });
}

// Luoghi per i turisti (agente Turismo): lo stesso id di un luogo che già c'è e che il nome conferma è lo
// stesso nodo; gli altri sono nodi a sé, vicini alla loro zona e al luogo che nominano.
const perTurismo = [];
for (const l of turismo.luoghi) {
  const nominato = zonaPerTesto(l.nome, LUOGHI);
  const id = `luogo:${l.id}`;
  const stesso = nodi.has(id) && (nominato === l.id || l.zona === l.id);
  const n = stesso
    ? nodo(id, 'luogo', { turismo: { nome: l.nome, interessi: l.interessi, dove: l.dove }, origine: [...nodi.get(id).origine, F.turismo] })
    : nodo(id, 'luogo', {
        nome: l.nome,
        sottotipo: 'luogo per i turisti',
        chiave: l.id,
        turismo: { nome: l.nome, interessi: l.interessi, dove: l.dove },
        stato: "luogo reale, proposto dall'agente Turismo come alternativa",
        origine: [F.turismo],
      });
  perTurismo.push({ l, n, nominato });
}
for (const { l, n, nominato } of perTurismo) {
  if (n.id !== `luogo:${l.zona}`) arco(n.id, `luogo:${l.zona}`, 'vicino a', { dettaglio: `nella zona «${scenario.zone[l.zona]?.nome || l.zona}» per l'agente Turismo`, origine: F.turismo });
  if (nominato && n.id !== `luogo:${nominato}`) arco(n.id, `luogo:${nominato}`, 'vicino a', { dettaglio: `il nome cita ${LUOGHI[nominato].nome} (parole del luogo nell'API)`, origine: F.luoghiApi });
}

// Distanza tra due luoghi: il più vicino dei loro punti di riferimento (zona dello scenario e luogo dell'API)
const conPunti = [...nodi.values()].filter((n) => n.tipo === 'luogo' && n.punti?.length);
for (let i = 0; i < conPunti.length; i++) {
  for (let j = i + 1; j < conPunti.length; j++) {
    const a = conPunti[i];
    const b = conPunti[j];
    let km = Infinity;
    for (const p of a.punti) for (const q of b.punti) km = Math.min(km, distanzaKm(p, q));
    if (km <= VICINO_KM) {
      const m = Math.round(km * 1000);
      arco(a.id, b.id, 'vicino a', { m, dettaglio: `${it(m)} m in linea d'aria, circa ${piedi(m)} min a piedi`, origine: F.luoghiApi });
    }
  }
}

// --- eventi della giornata -----------------------------------------------------------------------

const EMOJI_EVENTO = { nave: '🚢', regata: '⛵', partita: '⚽' };
const luogoDi = (testo) => (scenario.zone[testo] ? testo : zonaPerTesto(testo, LUOGHI));
for (const e of scenario.eventi) {
  const id = `evento:${e.id}`;
  nodo(id, 'evento', {
    nome: e.nome,
    breve: e.nome.split(/ alla | davanti | \(/)[0],
    sottotipo: e.tipo,
    emoji: EMOJI_EVENTO[e.tipo] || '📅',
    orario: `${e.inizio}–${e.fine}`,
    persone: e.persone,
    zona_scenario: e.zona,
    stato: 'evento dello scenario simulato della regata (Napoli 2027)',
    origine: [F.scenario],
  });
  const dove = zonaPerTesto(e.nome, LUOGHI) || e.zona;
  arco(id, `luogo:${dove}`, 'si svolge a', {
    dettaglio: `${e.inizio}–${e.fine}, circa ${it(e.persone)} persone` + (dove !== e.zona ? ` (nello scenario è legato alla zona «${scenario.zone[e.zona]?.nome || e.zona}»)` : ''),
    origine: F.scenario,
  });
  for (const f of e.flussi) {
    const verso = luogoDi(f.verso);
    if (!verso) throw new Error(`flusso verso un luogo sconosciuto: ${f.verso}`);
    arco(id, `luogo:${verso}`, 'flusso verso', {
      quota: f.quota,
      dettaglio: `${Math.round(f.quota * 100)}% delle persone dell'evento, circa ${it(e.persone * f.quota)}` + (verso !== f.verso ? ` («${f.verso}» nello scenario)` : ''),
      origine: F.scenario,
    });
  }
}

// --- stazioni vicine ---------------------------------------------------------------------------------

const GIORNI = trasporti.meta?.giorniDiRiferimento || {};
for (const n of [...nodi.values()].filter((x) => x.tipo === 'luogo' && x.lat != null)) {
  let vicine = stazioniVicine(n, trasporti.stazioni, { n: STAZIONI.n, maxKm: STAZIONI.maxKm });
  let largo = false;
  if (!vicine.length) {
    vicine = stazioniVicine(n, trasporti.stazioni, { n: STAZIONI.nLargo, maxKm: STAZIONI.maxKmLargo });
    largo = vicine.length > 0;
  }
  if (!vicine.length) n.nota_stazioni = `nessuna stazione su ferro entro ${String(STAZIONI.maxKmLargo).replace('.', ',')} km nel GTFS di ANM ed EAV`;
  for (const s of vicine) {
    const id = `stazione:${s.id}`;
    nodo(id, 'stazione', {
      nome: s.nome,
      breve: `${s.nome} · ${s.linee.join(' ')}`,
      sottotipo: s.tipo,
      linee: s.linee,
      operatore: s.operatore,
      lat: s.lat,
      lon: s.lon,
      // corse programmate il sabato (la giornata dello scenario è un sabato), dalle 13 alle 21
      corse_sabato: Object.fromEntries((s.corse?.sabato || []).map((c, h) => [h, c]).filter(([h]) => h >= 13 && h <= 21)),
      giorno_gtfs_sabato: GIORNI.sabato || null,
      prossimi_passaggi: Boolean(s.transitous?.length),
      stato: 'stazione reale; orari programmati GTFS, non in tempo reale',
      origine: [F.trasporti],
    });
    arco(n.id, id, 'servito da', { m: s.m, dettaglio: `${it(s.m)} m, circa ${s.piedi} min a piedi${largo ? ' (nessuna stazione entro 1,2 km)' : ''}`, origine: F.trasporti });
  }
}

// --- imprese -----------------------------------------------------------------------------------------

for (const i of imprese) {
  const id = `impresa:${i.id}`;
  nodo(id, 'impresa', {
    nome: i.nome,
    breve: i.nome,
    sottotipo: i.tipo,
    descrizione: i.descrizione,
    posti: i.posti,
    sconto_ore_morte: i.sconto_ore_morte,
    occupazione: i.occupazione,
    stato: 'impresa di fantasia (non è un\'attività reale)',
    origine: [F.imprese],
  });
  arco(id, `luogo:${i.zona}`, 'offerta a', { dettaglio: `−${i.sconto_ore_morte}% nelle ore vuote, ${i.posti} posti`, origine: F.imprese });
}

// --- agenti e topic MQTT (letti nel codice) ----------------------------------------------------------

/** Topic che un file Python pubblica e ascolta (o legge tra i trattenuti). Nelle f-string {…} diventa +. */
function topicDi(testo) {
  const pubblica = new Set();
  const ascolta = new Set();
  for (const m of testo.matchAll(/\bpubblica\(\s*(f?)"([^"]+)"/g)) pubblica.add(m[1] ? m[2].replace(/\{[^}]*\}/g, '+') : m[2]);
  for (const m of testo.matchAll(/\b(?:ascolta|iscriviti)\(\s*f?"([^"]+)"/g)) ascolta.add(m[1]);
  for (const m of testo.matchAll(/for\s+filtro\s+in\s+\(([^)]*)\)\s*:\s*\n\s*(?:self\.)?(?:ascolta|bus\.iscriviti)\(\s*filtro/g)) {
    for (const s of m[1].matchAll(/"([^"]+)"/g)) ascolta.add(s[1]);
  }
  for (const m of testo.matchAll(/\b(?:ultimo|trattenuti)\(\s*"([^"]+)"/g)) ascolta.add(m[1]);
  if (/\bself\.di\(/.test(testo)) pubblica.add('napoli/agenti/dialogo'); // Agente.di() in agenti/base.py
  return { pubblica, ascolta };
}

/** Un topic pubblicato (con + al posto delle parti variabili) arriva a un filtro MQTT (+ e #)? */
function arriva(topic, filtro) {
  const t = topic.split('/');
  const f = filtro.split('/');
  for (let i = 0; i < Math.max(t.length, f.length); i++) {
    if (f[i] === '#' || t[i] === '#') return true;
    if (t[i] === undefined || f[i] === undefined) return false;
    if (t[i] !== '+' && f[i] !== '+' && t[i] !== f[i]) return false;
  }
  return true;
}

const primaRiga = (testo) => (testo.match(/^"""([^\n]+)/)?.[1] || '').trim();
const EMOJI_AGENTE = { meteo: '🌊', eventi: '📅', folla: '👥', traffico: '🚦', turismo: '🧭', imprese: '🍕', orchestratore: '🎛️', twinciro: '💬', drone: '🛸', sala: '🖥️' };
const partecipanti = new Map(); // id del nodo → { pubblica, ascolta }

for (const f of fs.readdirSync(path.join(REPO, F.agenti)).sort()) {
  if (!f.endsWith('.py') || f === '__init__.py' || f === 'base.py') continue;
  const file = `${F.agenti}/${f}`;
  const testo = leggi(file);
  const nome = testo.match(/^\s+nome = "([^"]+)"/m)?.[1];
  const etichetta = testo.match(/^\s+etichetta = "([^"]+)"/m)?.[1];
  const assistente = /^class Assistenti\b/m.test(testo);
  if (!assistente && !(nome && etichetta)) continue;
  const chiave = assistente ? 'twinciro' : nome;
  const id = `agente:${chiave}`;
  nodo(id, 'agente', {
    nome: assistente ? 'TwinCIRO' : etichetta,
    sottotipo: assistente ? 'assistente su WhatsApp' : 'agente della città',
    emoji: EMOJI_AGENTE[chiave] || '🤖',
    descrizione: assistente
      ? `${primaRiga(testo)} Su WhatsApp con OpenClaw: la skill twinciro-citta passa i messaggi a /chiedi e /notifiche della città, la skill napoli-citta-dati legge i dati reali dall'API dati città.`
      : primaRiga(testo),
    stato: 'software della città (c5-agentic-city)',
    origine: assistente ? [file, F.skillCitta, F.skillDati] : [file],
  });
  partecipanti.set(id, topicDi(testo));
}

// Persone nel loop: il pilota del drone e l'operatore della sala, attraverso l'API della città
// (README di c5-agentic-city: napoli/drone/osservazioni dallo strumento drone, napoli/operatore/comandi e
// napoli/eventi/manuale dall'operatore). Topic presi dal codice di api.py, sala.py e sensori.py.
const api = leggi(F.api);
function topicEndpoint(percorso) {
  const re = new RegExp(`path == "${percorso.replace(/\//g, '\\/')}":([\\s\\S]*?)(?=\\n\\s*elif |\\n\\s*else:)`);
  const corpo = api.match(re)?.[1] || '';
  return topicDi(corpo);
}
{
  const t = { pubblica: new Set(), ascolta: new Set() };
  for (const p of ['/drone', '/drone/richieste']) {
    const x = topicEndpoint(p);
    x.pubblica.forEach((v) => t.pubblica.add(v));
    x.ascolta.forEach((v) => t.ascolta.add(v));
  }
  nodo('agente:drone', 'agente', {
    nome: 'Drone',
    sottotipo: 'pilota umano nel loop',
    emoji: EMOJI_AGENTE.drone,
    descrizione: "Verifica dall'alto una zona quando la stima della folla è incerta: l'orchestratore chiede il volo, il pilota vola e l'osservazione torna sul bus (POST /drone).",
    stato: 'persona nel loop (pilota) con lo strumento strumenti/drone_osserva.py',
    origine: [F.api, 'c5-agentic-city/citta/agenti/orchestratore.py'],
  });
  partecipanti.set('agente:drone', t);
}
{
  const sala = leggi(F.sala);
  const t = topicDi(sala);
  if (/SensoriReali\(/.test(sala)) {
    const s = topicDi(leggi(F.sensoriPy));
    s.ascolta.forEach((v) => t.ascolta.add(v));
  }
  for (const p of ['/operatore', '/evento']) topicEndpoint(p).pubblica.forEach((v) => t.pubblica.add(v));
  nodo('agente:sala', 'agente', {
    nome: 'Sala operativa',
    sottotipo: 'operatore umano nel loop',
    emoji: EMOJI_AGENTE.sala,
    descrizione: `${primaRiga(sala)} L'operatore approva o blocca le decisioni dell'orchestratore e segnala gli eventi dal campo (POST /operatore e /evento). Nel video: la Polizia Locale.`,
    stato: 'persona nel loop (operatore) con la sala nel terminale',
    origine: [F.sala, F.sensoriPy, F.api],
  });
  partecipanti.set('agente:sala', t);
}

const ids = [...partecipanti.keys()];
for (let i = 0; i < ids.length; i++) {
  for (let j = i + 1; j < ids.length; j++) {
    const versi = [];
    for (const [da, a] of [[ids[i], ids[j]], [ids[j], ids[i]]]) {
      const topic = [...partecipanti.get(da).pubblica].filter((t) => [...partecipanti.get(a).ascolta].some((f) => arriva(t, f))).sort();
      if (topic.length) versi.push({ da, a, topic });
    }
    if (!versi.length) continue;
    const solo = versi.every((v) => v.topic.every((t) => t === 'napoli/agenti/dialogo'));
    arco(versi[0].da, versi[0].a, 'parla con', {
      messaggi: versi,
      bidirezionale: versi.length === 2,
      dettaglio: versi.map((v) => `${nodi.get(v.da).nome} → ${nodi.get(v.a).nome}: ${v.topic.join(', ')}`).join(' · '),
      ...(solo ? { solo_dialogo: true } : {}),
      origine: 'c5-agentic-city/citta/',
    });
  }
}

// "monitora": ciò che ogni agente stima o segue, dallo scenario e dai dati che il suo codice legge
const AG = (k) => `agente:${k}`;
const agenteCon = (k, test) => nodi.has(AG(k)) && test(leggi(nodi.get(AG(k)).origine[0]));
if (agenteCon('folla', (t) => /self\.scenario\["zone"\]/.test(t) && /napoli\/folla\/\{zona\}/.test(t))) {
  for (const k of Object.keys(scenario.zone)) arco(AG('folla'), `luogo:${k}`, 'monitora', { dettaglio: 'stima delle persone e livello di affollamento (napoli/folla/' + k + ')', origine: 'c5-agentic-city/citta/agenti/folla.py' });
}
if (agenteCon('eventi', (t) => /self\.scenario\["eventi"\]/.test(t))) {
  for (const e of scenario.eventi) arco(AG('eventi'), `evento:${e.id}`, 'monitora', { dettaglio: `annuncia l'evento fino a ${e.anticipo_min || 60} minuti prima e ne prevede i flussi`, origine: 'c5-agentic-city/citta/agenti/eventi.py' });
}
if (agenteCon('imprese', (t) => /imprese\.json/.test(t))) {
  for (const i of imprese) arco(AG('imprese'), `impresa:${i.id}`, 'monitora', { dettaglio: 'posti liberi per fascia di 30 minuti, offerte e prenotazioni', origine: 'c5-agentic-city/citta/agenti/imprese.py' });
}
if (agenteCon('meteo', (t) => /def regata_possibile/.test(t))) {
  const r = scenario.eventi.find((e) => e.tipo === 'regata');
  if (r) arco(AG('meteo'), `evento:${r.id}`, 'monitora', { dettaglio: 'vento tra 6 e 22 nodi, raffiche sotto 30, onda sotto 1,8 m: si può fare la regata?', origine: 'c5-agentic-city/citta/agenti/meteo.py' });
}

// --- sensori (dispositivi veri) ----------------------------------------------------------------------

const firmware = leggi(F.firmware);
const statoRiga = (cartella) => firmware.split('\n').find((r) => r.startsWith('|') && r.includes(`(${cartella}/`))?.split('|').map((c) => c.trim()).filter(Boolean).at(-1) || '';
const esempi = [...(firmware.match(/Esempi:\s*(`[^`]+`(?:,\s*`[^`]+`)*)/)?.[1] || '').matchAll(/`([^`]+)`/g)].map((m) => m[1]);
const grandezze = [];
for (const r of firmware.split('\n')) {
  const c = r.split('|').map((x) => x.trim());
  const g = c[1]?.match(/^`(temperatura|umidita|luce|pressione|persone)`$/)?.[1];
  if (g) grandezze.push({ g, badge: /badge/i.test(c[3]) || !/tasmota/i.test(c[3]), tasmota: /tasmota/i.test(c[3]) || !/badge/i.test(c[3]) });
}
const SENSORI = [
  {
    chiave: esempi.find((e) => e.startsWith('badge')) || 'badge-1',
    nome: 'Badge WHY2025',
    sottotipo: 'badge Cyber Saiyan WHY2025 (ESP32-C3)',
    emoji: '📟',
    zona: leggi(F.badge).match(/#define TELEMETRY_ZONE\s+"([^"]+)"/)?.[1],
    grandezze: grandezze.filter((x) => x.badge).map((x) => x.g),
    stato: statoRiga('why2025-badge'),
    origine: [F.badge, F.firmware],
    descrizione: 'Contapersone a mano (rotella SU = un gruppo visto) e sensori I2C se collegati.',
  },
  {
    chiave: esempi.find((e) => e.startsWith('tasmota')) || 'tasmota-1',
    nome: 'Scheda Tasmota',
    sottotipo: 'ESP32 o ESP8266 con Tasmota',
    emoji: '🔌',
    zona: leggi(F.tasmota).match(/"zona":"([a-z_]+)"/)?.[1],
    grandezze: grandezze.filter((x) => x.tasmota).map((x) => x.g),
    stato: statoRiga('tasmota'),
    origine: [F.tasmota, F.firmware],
    descrizione: 'Letture del sensore pubblicate con le Rules di Tasmota, configurate dalla console web.',
  },
];
for (const s of SENSORI) {
  if (!s.zona || !scenario.zone[s.zona]) throw new Error(`zona del sensore ${s.chiave} non trovata nello scenario: ${s.zona}`);
  const id = `sensore:${s.chiave}`;
  nodo(id, 'sensore', {
    nome: s.nome,
    breve: s.nome,
    sottotipo: s.sottotipo,
    emoji: s.emoji,
    descrizione: s.descrizione,
    zona: s.zona,
    grandezze: s.grandezze,
    stato: `dispositivo reale: ${s.stato || 'vedi firmware/README.md'}`,
    origine: s.origine,
  });
  arco(id, `luogo:${s.zona}`, 'monitora', { dettaglio: `zona configurata nel firmware: ${s.zona}`, origine: s.origine[0] });
  const topic = s.grandezze.map((g) => `napoli/sensori/${s.chiave}/${g}`);
  for (const [ag, t] of partecipanti) {
    const arrivano = topic.filter((x) => [...t.ascolta].some((f) => arriva(x, f)));
    if (arrivano.length) arco(id, ag, 'alimenta', { topic: arrivano, dettaglio: arrivano.join(', '), origine: F.firmware });
  }
}

// --- fonti -------------------------------------------------------------------------------------------

// Loghi: quelli della scena 4 (scene/fonti/loghi, icone ufficiali dei siti), se il file c'è; altrimenti un'emoji
const fontiCatalogo = new Map((catalogo?.fonti || []).map((f) => [f.id, f]));
function icona(idCatalogo) {
  const f = fontiCatalogo.get(idCatalogo);
  if (!f?.icona) return {};
  const file = `c5-presentazione/scene/fonti/${f.icona}`;
  return esiste(file) ? { icona: `fonti/${f.icona}`, icona_sfondo: f.icona_sfondo || 'chiaro' } : {}; // percorso relativo a scene/
}
const metaFonte = (lista, testo) => (lista || []).find((f) => f.nome.includes(testo)) || null;
const aggiungiFonte = (chiave, campi) => {
  const cat = fontiCatalogo.get(campi.catalogo?.[0]);
  return nodo(`fonte:${chiave}`, 'fonte', {
    breve: campi.nome,
    ...icona(campi.catalogo?.[0]),
    ente: cat?.ente || null,
    esito_verifica: cat?.esito || null,
    ...campi,
  });
};

const luoghiApi = Object.keys(LUOGHI).map((k) => `luogo:${k}`);

aggiungiFonte('open-meteo', {
  nome: 'Open-Meteo',
  sottotipo: 'meteo, mare e aria (modello CAMS)',
  url: FONTI.openMeteo.url,
  licenza: FONTI.openMeteo.licenza,
  catalogo: ['open-meteo-previsioni', 'open-meteo-aria', 'open-meteo-mare'],
  stato: 'fonte pubblica reale',
  origine: [F.datiApi, 'c5-agentic-city/citta/agenti/meteo.py'],
});
for (const l of luoghiApi) arco('fonte:open-meteo', l, 'alimenta', { dettaglio: 'meteo del luogo (ICON-2I) e aria di fondo (Copernicus CAMS) nell\'API dati città', origine: F.datiApi });
if (/api\.open-meteo\.com/.test(leggi('c5-agentic-city/citta/agenti/meteo.py'))) {
  arco('fonte:open-meteo', AG('meteo'), 'alimenta', { dettaglio: 'vento, raffiche, temperatura e onda di oggi (modalità --meteo reale)', origine: 'c5-agentic-city/citta/agenti/meteo.py' });
}

aggiungiFonte('centraline', {
  nome: 'Centraline aria ARPAC (EEA)',
  sottotipo: 'qualità dell\'aria misurata',
  url: FONTI.centraline.url,
  licenza: FONTI.centraline.licenza,
  catalogo: ['eea-aria'],
  stato: 'fonte pubblica reale (misure orarie non validate)',
  origine: [F.aria],
});
for (const [k, v] of Object.entries(aria.vicine || {})) {
  // stessa regola di ariaDi() nell'API: centralina entro 1,5 km
  if (v.km <= 1.5 && nodi.has(`luogo:${k}`)) arco('fonte:centraline', `luogo:${k}`, 'alimenta', { dettaglio: `centralina ${v.id} a ${String(v.km).replace('.', ',')} km`, origine: F.aria });
}

const trF = trasporti.meta?.fonti || [];
const gtfsAnm = metaFonte(trF, 'ANM');
const gtfsEav = metaFonte(trF, 'EAV');
aggiungiFonte('gtfs-anm', {
  nome: 'Orari ANM (GTFS)',
  emoji: '🚇',
  sottotipo: 'metro L1, L2, L6 e funicolari',
  url: gtfsAnm?.url,
  licenza: gtfsAnm?.licenza,
  catalogo: ['anm-gtfs'],
  stato: 'fonte pubblica reale (orari programmati)',
  origine: [F.trasporti],
});
aggiungiFonte('gtfs-eav', {
  nome: 'Orari EAV (GTFS)',
  sottotipo: 'Cumana, Circumflegrea, Circumvesuviana',
  url: gtfsEav?.url,
  licenza: gtfsEav?.licenza,
  catalogo: ['eav-gtfs'],
  stato: 'fonte pubblica reale (orari programmati)',
  origine: [F.trasporti],
});
for (const n of nodi.values()) {
  if (n.tipo !== 'stazione') continue;
  const f = n.id.startsWith('stazione:anm-') ? 'fonte:gtfs-anm' : n.id.startsWith('stazione:eav-') ? 'fonte:gtfs-eav' : null;
  if (f) arco(f, n.id, 'alimenta', { dettaglio: `linee ${n.linee.join(', ')}: corse programmate per ora`, origine: F.trasporti });
}

const evF = eventiApi.meta?.fonti || [];
const comune = eventiApi.comune || [];
aggiungiFonte('comune-agenda', {
  nome: 'Agenda del Comune',
  sottotipo: 'eventi del Comune di Napoli',
  url: metaFonte(evF, 'Comune')?.url,
  licenza: metaFonte(evF, 'Comune')?.licenza,
  catalogo: ['comune-agenda'],
  stato: 'fonte pubblica reale',
  origine: [F.eventi],
});
const perZona = {};
for (const e of comune) if (e.zona) (perZona[e.zona] ||= []).push(e.titolo);
for (const [k, titoli] of Object.entries(perZona)) {
  if (nodi.has(`luogo:${k}`)) arco('fonte:comune-agenda', `luogo:${k}`, 'alimenta', { dettaglio: `eventi del Comune abbinati al luogo (snapshot: ${titoli.length}, es. «${titoli[0]}»)`, origine: F.eventi });
}

const partite = (eventiApi.partite || []).filter((p) => p.casa === 'Napoli');
aggiungiFonte('openfootball', {
  nome: 'Serie A (openfootball)',
  sottotipo: 'partite in casa del Napoli',
  url: metaFonte(evF, 'Serie A')?.url,
  licenza: metaFonte(evF, 'Serie A')?.licenza,
  catalogo: ['openfootball'],
  stato: 'fonte pubblica reale',
  origine: [F.eventi],
});
if (partite.length) arco('fonte:openfootball', 'luogo:maradona', 'alimenta', { dettaglio: `partite in casa del Napoli al Maradona (snapshot: ${partite.length})`, origine: F.eventi });

const crociere = eventiApi.crociere || [];
aggiungiFonte('crociere', {
  nome: 'Cruise Timetables',
  sottotipo: 'navi da crociera in porto',
  url: metaFonte(evF, 'crociera')?.url,
  licenza: metaFonte(evF, 'crociera')?.licenza,
  catalogo: ['cruise-timetables'],
  stato: 'fonte privata, citata (il porto non pubblica un calendario aperto degli accosti)',
  origine: [F.eventi],
});
const porto = zonaPerTesto('Stazione Marittima', LUOGHI); // il luogo del porto nell'API (beverello)
if (crociere.length && porto) arco('fonte:crociere', `luogo:${porto}`, 'alimenta', { dettaglio: `navi in porto per giorno (snapshot: ${crociere.length} giorni, es. ${crociere[0].giorno.split('-').reverse().join('/')}: ${crociere[0].navi.join(', ')})`, origine: F.eventi });

const ac = (eventiApi.speciali || []).filter((s) => s.fonte === 'americascup');
aggiungiFonte('americas-cup', {
  nome: "America's Cup 2027",
  sottotipo: 'calendario delle regate a Napoli',
  url: metaFonte(evF, "America's Cup")?.url,
  licenza: metaFonte(evF, "America's Cup")?.licenza,
  catalogo: ['americas-cup'],
  stato: 'fonte pubblica reale (sito ufficiale, citato)',
  origine: [F.eventi],
});
if (ac.length) {
  const giorni = ac.filter((s) => !s.riserva).length;
  const dal = ac[0].giorno.split('-').reverse().join('/');
  const al = ac.at(-1).giorno.split('-').reverse().join('/');
  const regata = scenario.eventi.find((e) => e.tipo === 'regata');
  if (regata) arco('fonte:americas-cup', `evento:${regata.id}`, 'alimenta', { dettaglio: `${giorni} giorni di regata a Napoli dal ${dal} al ${al} (più i giorni di riserva): la giornata dello scenario è una di queste, simulata`, origine: F.eventi });
  for (const k of new Set(ac.map((s) => s.zona))) if (nodi.has(`luogo:${k}`)) arco('fonte:americas-cup', `luogo:${k}`, 'alimenta', { dettaglio: ac[0].nota || 'campo di regata', origine: F.eventi });
}

const skill = leggi(F.skillDati);
const perTwin = [
  ['allerta', 'Allerta meteo Campania', 'Protezione Civile, Centro Funzionale', FONTI.allerta, 'allerta-campania', /allerta/i, 'allerta meteo per Napoli'],
  ['ingv', 'INGV terremoti', 'terremoti in Campania', FONTI.ingv, 'ingv', /terremoti/i, 'ultimi terremoti'],
  ['transitous', 'Transitous', 'prossime partenze dal vivo', FONTI.transitous, 'transitous', /prossime partenze/i, 'prossime partenze di metro e treni'],
];
for (const [k, nome, sottotipo, fonte, cat, re, cosa] of perTwin) {
  aggiungiFonte(k, { nome, sottotipo, url: fonte.url, licenza: fonte.licenza, catalogo: [cat], stato: 'fonte pubblica reale', origine: [F.datiApi, F.skillDati] });
  if (re.test(skill)) arco(`fonte:${k}`, AG('twinciro'), 'alimenta', { dettaglio: `${cosa}, dall'API dati città con la skill napoli-citta-dati`, origine: F.skillDati });
}

if (/celle \(simulato\)/.test(leggi('c5-agentic-city/citta/agenti/folla.py'))) {
  const cat = fontiCatalogo.get('presenze-rete-mobile');
  aggiungiFonte('rete-mobile', {
    nome: 'Presenze da rete mobile',
    breve: 'Rete mobile (simulata)',
    sottotipo: 'persone per zona, anonime e aggregate',
    emoji: '📶',
    catalogo: ['presenze-rete-mobile'],
    stato: 'SIMULATO: è il dato che la rete di Fastweb + Vodafone può dare; oggi non è pubblico',
    simulato: true,
    nota: cat?.nota || null,
    origine: ['c5-agentic-city/citta/agenti/folla.py', F.scenario],
  });
  arco('fonte:rete-mobile', AG('folla'), 'alimenta', { dettaglio: 'presenze per zona simulate: stima del modello più un rumore del 10% (ipotesi dello scenario)', simulato: true, origine: 'c5-agentic-city/citta/agenti/folla.py' });
}

// ------------------------------------------------------------------ pesi e importanza

const lista = [...nodi.values()];
const grado = new Map(lista.map((n) => [n.id, 0]));
for (const a of archi) {
  grado.set(a.da, grado.get(a.da) + 1);
  grado.set(a.a, grado.get(a.a) + 1);
}
for (const n of lista) {
  n.grado = grado.get(n.id);
  n.strato = TIPI_NODO[n.tipo].strato;
  n.breve ||= breve(n.id, n.nome);
}
const etichettati = new Set([
  ...Object.keys(scenario.zone).map((k) => `luogo:${k}`),
  'luogo:maradona', 'luogo:centro_storico', 'luogo:garibaldi',
  ...scenario.eventi.map((e) => `evento:${e.id}`),
  ...lista.filter((n) => n.tipo === 'agente' || n.tipo === 'sensore').map((n) => n.id),
  'fonte:rete-mobile',
]);
for (const n of lista) n.importante = etichettati.has(n.id);

function raggio(n) {
  switch (n.tipo) {
    case 'luogo':
      if (n.capienza) return 12 + 8 * Math.sqrt(n.capienza / 26000);
      return n.sottotipo === 'luogo monitorato' ? 10 : n.sottotipo === 'luogo noto' ? 7.5 : 7;
    case 'evento': return 15 + 7 * Math.sqrt(n.persone / 50000);
    case 'stazione': return 5.5;
    case 'impresa': return 8;
    case 'agente': return n.id === 'agente:twinciro' ? 36 : n.id === 'agente:orchestratore' ? 25 : 21;
    case 'sensore': return 15;
    case 'fonte': return 21;
    default: return 8;
  }
}
for (const n of lista) n.r = Math.round(raggio(n) * 10) / 10;

// ------------------------------------------------------------------ layout deterministico

// Fotogramma 1920×1080 della scena: in alto titolo e legenda, in basso 130 px liberi per i sottotitoli.
// Dall'alto: gli agenti in due file con TwinCIRO al centro; la città da ovest a est con il nord in alto
// (luoghi, stazioni, imprese, sensori); gli eventi verso il mare; le fonti. Nessun numero casuale: stessi
// dati, stesse posizioni.
const AREA = { x0: 70, x1: 1850, y0: 196, y1: 940 };
const AGENTI = { fila: [256, 336], twin: [960, 292], primo: 175, passo: 135 };
const CITTA = { y0: 418, y1: 744, sensori: 716 };
const FASCIA_EVENTI = 794;
const FASCIA_FONTI = 884;
const DIMENSIONE = (n) => (n.id === 'agente:twinciro' ? 31 : n.tipo === 'agente' || n.tipo === 'evento' ? 21 : n.tipo === 'luogo' && n.capienza ? 22 : 19);
const larghezzaTesto = (testo, px) => Math.ceil(testo.length * px * 0.56) + 6;
const media = (vs) => vs.reduce((s, v) => s + v, 0) / (vs.length || 1);
for (const n of lista) n.lato = ['agente', 'evento', 'sensore', 'fonte'].includes(n.tipo) ? 'sotto' : 'destra';

/** Ingombro di un nodo: il simbolo e, per i nodi con l'etichetta, il testo (a destra, a sinistra o sotto). */
function scatola(n, p) {
  const r = n.r + 3;
  if (!n.importante) return { x0: p.x - r, x1: p.x + r, y0: p.y - r, y1: p.y + r };
  const w = larghezzaTesto(n.breve, DIMENSIONE(n));
  const h = DIMENSIONE(n) * 1.25;
  if (n.lato === 'sotto') return { x0: p.x - Math.max(r, w / 2), x1: p.x + Math.max(r, w / 2), y0: p.y - r, y1: p.y + r + h + 2 };
  const y0 = p.y - Math.max(r, h / 2);
  const y1 = p.y + Math.max(r, h / 2);
  return n.lato === 'sinistra' ? { x0: p.x - r - 8 - w, x1: p.x + r, y0, y1 } : { x0: p.x - r, x1: p.x + r + 8 + w, y0, y1 };
}
const sovrapposizione = (a, b) => [Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0), Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0)];

const P = new Map(lista.map((n) => [n.id, { x: 0, y: 0, ax: 0, ay: 0, k: 0 }]));
const vicini = new Map(lista.map((n) => [n.id, []]));
for (const a of archi) {
  vicini.get(a.da).push(a.a);
  vicini.get(a.a).push(a.da);
}
const viciniDi = (n, tipi) => vicini.get(n.id).filter((v) => tipi.includes(nodi.get(v).tipo));

// --- 1. la città: geografia deformata e un rilassamento che toglie le sovrapposizioni ---

// Deformazione monotona di longitudine e latitudine: tiene l'ordine (ovest-est, nord-sud) ma allarga il centro,
// dove luoghi e stazioni distano poche centinaia di metri. alfa = parte lineare, il resto segue il rango.
function deforma(valori, a, b, alfa) {
  const s = [...new Set(valori)].sort((p, q) => p - q);
  const lo = s[0];
  const hi = s.at(-1);
  return (v) => {
    const i = Math.max(0, s.findIndex((x) => x >= v));
    const rango = s.length > 1 ? i / (s.length - 1) : 0.5;
    const lin = hi > lo ? (v - lo) / (hi - lo) : 0.5;
    return a + (b - a) * (alfa * lin + (1 - alfa) * rango);
  };
}
const citta = lista.filter((n) => ['luogo', 'stazione', 'impresa', 'sensore'].includes(n.tipo));
const geo = citta.filter((n) => n.lat != null);
const fx = deforma(geo.map((n) => n.lon), AREA.x0 + 40, AREA.x1 - 150, 0.3);
const fy = deforma(geo.map((n) => -n.lat), CITTA.y0 + 6, CITTA.y1 - 6, 0.35);
for (const n of geo) Object.assign(P.get(n.id), { ax: fx(n.lon), ay: fy(-n.lat), k: n.tipo === 'stazione' ? 0.05 : 0.08 });
const ancora = (n, dy) => {
  const vs = viciniDi(n, ['luogo']).filter((v) => nodi.get(v).lat != null);
  Object.assign(P.get(n.id), { ax: media(vs.map((v) => P.get(v).ax)), ay: media(vs.map((v) => P.get(v).ay)) + dy, k: 0.04 });
};
for (const n of citta.filter((x) => x.lat == null)) ancora(n, n.tipo === 'sensore' ? 66 : n.tipo === 'impresa' ? -34 : -26);
// i sensori della stessa zona uno accanto all'altro, sotto la zona
const sensoriPerZona = {};
for (const n of citta.filter((x) => x.tipo === 'sensore')) (sensoriPerZona[n.zona] ||= []).push(n);
for (const gruppo of Object.values(sensoriPerZona)) gruppo.forEach((n, i) => { P.get(n.id).ax += (i - (gruppo.length - 1) / 2) * 190; });
for (const n of citta) {
  const p = P.get(n.id);
  if (n.importante && p.ax + n.r + 8 + larghezzaTesto(n.breve, DIMENSIONE(n)) > AREA.x1) n.lato = 'sinistra';
  // partenza: l'ancora più uno scarto fisso che dipende dall'id
  let h = 0;
  for (const c of n.id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  p.x = p.ax + ((h % 17) - 8);
  p.y = p.ay + (((h >>> 5) % 13) - 6);
}
const satellite = (n) => n.tipo === 'impresa' || n.tipo === 'sensore' || (n.tipo === 'luogo' && n.lat == null);
const archiCitta = archi.filter((a) => {
  const A = nodi.get(a.da);
  const B = nodi.get(a.a);
  return (satellite(A) && B.tipo === 'luogo') || (satellite(B) && A.tipo === 'luogo');
});
const GIRI = 700;
const PULIZIA = 160; // gli ultimi giri senza ancore: tolgono le sovrapposizioni rimaste
for (let g = 0; g < GIRI + PULIZIA; g++) {
  const caldo = Math.max(0, 1 - g / GIRI);
  for (const n of citta) {
    const p = P.get(n.id);
    const k = p.k * (0.35 + 0.65 * caldo) * (g < GIRI ? 1 : 0);
    p.x += (p.ax - p.x) * k;
    p.y += (p.ay - p.y) * k;
  }
  // i satelliti (imprese, luoghi per i turisti, sensori) restano vicini al loro luogo
  for (const a of archiCitta) {
    const A = nodi.get(a.da);
    const B = nodi.get(a.a);
    const pa = P.get(a.da);
    const pb = P.get(a.a);
    const dx = pb.x - pa.x;
    const dy = pb.y - pa.y;
    const d = Math.hypot(dx, dy) || 1;
    const f = ((d - (A.r + B.r + 34)) / d) * 0.03 * caldo;
    if (satellite(A)) { pa.x += dx * f; pa.y += dy * f; }
    if (satellite(B)) { pb.x -= dx * f; pb.y -= dy * f; }
  }
  // collisioni tra ingombri (etichette comprese), lungo l'asse con meno sovrapposizione
  for (let i = 0; i < citta.length; i++) {
    const A = citta[i];
    const pa = P.get(A.id);
    for (let j = i + 1; j < citta.length; j++) {
      const B = citta[j];
      const pb = P.get(B.id);
      const [ox, oy] = sovrapposizione(scatola(A, pa), scatola(B, pb));
      if (ox <= 0 || oy <= 0) continue;
      if (ox < oy) {
        const s = (ox / 2 + 0.5) * (pa.x <= pb.x ? -1 : 1);
        pa.x += s;
        pb.x -= s;
      } else {
        const s = (oy / 2 + 0.5) * (pa.y <= pb.y ? -1 : 1);
        pa.y += s;
        pb.y -= s;
      }
    }
  }
  for (const n of citta) {
    const p = P.get(n.id);
    const s = scatola(n, p);
    if (s.x0 < AREA.x0) p.x += AREA.x0 - s.x0;
    if (s.x1 > AREA.x1) p.x -= s.x1 - AREA.x1;
    const alto = CITTA.y0 + (p.y - s.y0);
    const basso = (n.tipo === 'sensore' ? CITTA.sensori : CITTA.y1) - (s.y1 - p.y);
    p.y = Math.min(basso, Math.max(alto, p.y));
  }
}

// --- 2. file orizzontali: eventi e fonti, ognuno sotto ciò che collega, senza sovrapposizioni ---

function impacchetta(elementi, gap) {
  elementi.sort((a, b) => a.ax - b.ax || a.n.id.localeCompare(b.n.id));
  for (const e of elementi) e.x = e.ax;
  const dentro = (e) => { e.x = Math.max(AREA.x0 + e.sx, Math.min(AREA.x1 - e.dx, e.x)); };
  for (let g = 0; g < 400; g++) {
    for (let i = 1; i < elementi.length; i++) {
      const a = elementi[i - 1];
      const b = elementi[i];
      const o = a.x + a.dx + gap - (b.x - b.sx);
      if (o > 0) { a.x -= o / 2; b.x += o / 2; }
    }
    for (const e of elementi) { e.x += (e.ax - e.x) * 0.02; dentro(e); }
  }
  for (let i = 1; i < elementi.length; i++) {
    const a = elementi[i - 1];
    const b = elementi[i];
    b.x = Math.max(b.x, a.x + a.dx + gap + b.sx);
  }
  for (let i = elementi.length - 1; i >= 0; i--) {
    const e = elementi[i];
    const limite = i === elementi.length - 1 ? AREA.x1 : elementi[i + 1].x - elementi[i + 1].sx - gap;
    e.x = Math.min(e.x, limite - e.dx);
  }
}
function fila(tipo, y, tipiVicini, gap) {
  const elementi = lista.filter((n) => n.tipo === tipo).map((n) => {
    const vs = viciniDi(n, tipiVicini);
    const s = scatola(n, { x: 0, y });
    return { n, ax: media(vs.map((v) => P.get(v).x)) || (AREA.x0 + AREA.x1) / 2, sx: -s.x0, dx: s.x1 };
  });
  impacchetta(elementi, gap);
  for (const e of elementi) Object.assign(P.get(e.n.id), { x: e.x, y });
}
fila('evento', FASCIA_EVENTI, ['luogo'], 26);

// --- 3. agenti: due file sfalsate attorno a TwinCIRO, nell'ordine che accorcia di più gli archi ---

{
  const twin = P.get('agente:twinciro');
  [twin.x, twin.y] = AGENTI.twin;
  const altri = lista.filter((n) => n.tipo === 'agente' && n.id !== 'agente:twinciro').sort((a, b) => a.id.localeCompare(b.id));
  const posti = (sinistra) => {
    const destra = altri.length - sinistra;
    const p = [];
    for (let k = 0; k < sinistra; k++) p.push({ x: AGENTI.twin[0] - AGENTI.primo - k * AGENTI.passo, y: AGENTI.fila[k % 2] });
    for (let k = 0; k < destra; k++) p.push({ x: AGENTI.twin[0] + AGENTI.primo + k * AGENTI.passo, y: AGENTI.fila[k % 2] });
    return p;
  };
  const indiceAg = new Map(altri.map((n, i) => [n.id, i]));
  const tra = [];
  const fuori = [];
  for (const a of archi) {
    const ia = indiceAg.get(a.da);
    const ib = indiceAg.get(a.a);
    if (ia != null && ib != null) tra.push([ia, ib]);
    else if (ia != null || ib != null) {
      const altro = ia != null ? a.a : a.da;
      const i = ia != null ? ia : ib;
      if (altro === 'agente:twinciro') fuori.push([i, AGENTI.twin[0], 1]);
      else if (nodi.get(altro).tipo !== 'fonte') fuori.push([i, P.get(altro).x, 0.3]);
    }
  }
  let migliore = null;
  for (const sinistra of [Math.ceil(altri.length / 2), Math.floor(altri.length / 2)]) {
    const p = posti(sinistra);
    const ordine = altri.map((_, i) => i);
    const costo = (o) => {
      const xo = new Array(o.length);
      for (let s = 0; s < o.length; s++) xo[o[s]] = p[s].x;
      let c = 0;
      for (const [i, j] of tra) c += Math.abs(xo[i] - xo[j]);
      for (const [i, x, w] of fuori) c += w * Math.abs(xo[i] - x);
      return c;
    };
    // tutte le permutazioni (algoritmo di Heap): con 9 agenti sono 362.880, meno di un secondo
    const c0 = [...ordine];
    const prova = () => {
      const c = costo(c0);
      if (!migliore || c < migliore.c - 1e-9) migliore = { c, ordine: [...c0], p };
    };
    const conta = new Array(c0.length).fill(0);
    prova();
    let i = 0;
    while (i < c0.length) {
      if (conta[i] < i) {
        const j = i % 2 === 0 ? 0 : conta[i];
        [c0[j], c0[i]] = [c0[i], c0[j]];
        prova();
        conta[i]++;
        i = 0;
      } else {
        conta[i] = 0;
        i++;
      }
    }
  }
  migliore.ordine.forEach((idx, s) => Object.assign(P.get(altri[idx].id), migliore.p[s]));
}

fila('fonte', FASCIA_FONTI, ['luogo', 'stazione', 'evento', 'agente'], 18);

for (const n of lista) {
  const p = P.get(n.id);
  n.x = Math.round(p.x * 10) / 10;
  n.y = Math.round(p.y * 10) / 10;
  if (n.importante) n.etichetta = { testo: n.breve, dimensione: DIMENSIONE(n), lato: n.lato };
}

// Controllo: nessuna etichetta sopra un'altra o sopra un simbolo, nessun nodo fuori dall'area
const avvisi = [];
for (let i = 0; i < lista.length; i++) {
  for (let j = i + 1; j < lista.length; j++) {
    const A = lista[i];
    const B = lista[j];
    const [ox, oy] = sovrapposizione(scatola(A, A), scatola(B, B));
    if (ox > 1 && oy > 1) avvisi.push(`sovrapposti: ${A.breve} e ${B.breve} (${Math.round(ox)}×${Math.round(oy)} px)`);
  }
}
for (const n of lista) {
  const s = scatola(n, n);
  if (s.x0 < AREA.x0 - 1 || s.x1 > AREA.x1 + 1 || s.y0 < AREA.y0 - 1 || s.y1 > AREA.y1 + 1) avvisi.push(`fuori dall'area: ${n.breve}`);
}

// ------------------------------------------------------------------ uscita

const conta = (tipo) => lista.filter((n) => n.tipo === tipo).length;
const contaArchi = (tipo) => archi.filter((a) => a.tipo === tipo).length;
const dataDi = (s) => (s?.meta?.generato ? s.meta.generato.slice(0, 10) : null);
const ordine = Object.keys(TIPI_NODO);
lista.sort((a, b) => ordine.indexOf(a.tipo) - ordine.indexOf(b.tipo) || a.id.localeCompare(b.id));
const ordineArchi = Object.keys(TIPI_ARCO);
archi.sort((a, b) => ordineArchi.indexOf(a.tipo) - ordineArchi.indexOf(b.tipo) || a.da.localeCompare(b.da) || a.a.localeCompare(b.a));

const grafo = {
  meta: {
    titolo: 'TwinCIRO · la città come rete di relazioni — giornata della regata',
    descrizione: "Il knowledge graph della città il giorno della regata: luoghi, eventi e flussi di persone, stazioni, imprese, agenti, sensori e fonti, con le relazioni che gli agenti di TwinCIRO usano. È una rappresentazione delle relazioni, non un database interrogato dagli agenti.",
    script: 'c5-presentazione/grafo/genera.mjs',
    scenario: `${scenario.nome}: ${scenario.descrizione}`,
    nota: "Relazioni ricavate dai file della repository, nessuna inventata. Eventi e flussi sono dello scenario simulato della regata (Napoli 2027); le imprese sono di fantasia; le presenze da rete mobile sono simulate; luoghi, stazioni e fonti sono reali.",
    dati_del: { trasporti: dataDi(trasporti), aria: dataDi(aria), eventi: dataDi(eventiApi), catalogo_fonti: catalogo?.verifica || null },
    file: [...new Set(Object.values(F).filter((f) => f !== F.json && f !== F.scena && (f !== F.catalogo || catalogo)))].sort(),
    area: { larghezza: 1920, altezza: 1080, ...AREA },
    conteggi: {
      nodi: lista.length,
      archi: archi.length,
      per_tipo: Object.fromEntries(ordine.map((t) => [t, conta(t)])),
      per_relazione: Object.fromEntries(ordineArchi.map((t) => [t, contaArchi(t)])),
    },
    regole: REGOLE,
  },
  tipi_nodo: TIPI_NODO,
  tipi_arco: TIPI_ARCO,
  nodi: lista.map(({ punti, lato, ...n }) => ({ ...n, coordinate: punti || undefined })), // il lato dell'etichetta è in etichetta.lato
  archi,
};

// Dati compatti per la scena del video (incorporati nella pagina: il renderer serve solo scene/)
const indice = new Map(lista.map((n, i) => [n.id, i]));
const perScena = {
  titolo: grafo.meta.titolo,
  conteggi: grafo.meta.conteggi,
  tipi: Object.fromEntries(ordine.map((t) => [t, { nome: TIPI_NODO[t].nome, colore: TIPI_NODO[t].colore, forma: TIPI_NODO[t].forma, strato: TIPI_NODO[t].strato }])),
  colori_archi: Object.fromEntries(ordineArchi.map((t) => [t, TIPI_ARCO[t].colore])),
  nodi: lista.map((n) => ({
    id: n.id,
    t: n.tipo,
    x: n.x,
    y: n.y,
    r: n.r,
    s: n.strato,
    ...(n.etichetta ? { e: n.etichetta.testo, d: n.etichetta.dimensione, l: n.etichetta.lato } : {}),
    ...(n.emoji ? { m: n.emoji } : {}),
    ...(n.icona ? { i: n.icona } : {}),
    ...(n.icona_sfondo === 'scuro' ? { sf: 1 } : {}),
    ...(n.simulato ? { sim: 1 } : {}),
    ...(n.capienza ? { cap: n.capienza } : {}),
  })),
  archi: archi.map((a) => ({
    a: indice.get(a.da),
    b: indice.get(a.a),
    t: a.tipo,
    ...(a.quota ? { q: a.quota } : {}),
    ...(a.bidirezionale ? { bi: 1 } : {}),
    ...(a.simulato ? { sim: 1 } : {}),
    ...(a.solo_dialogo ? { dia: 1 } : {}),
  })),
};

const testoJson = `${JSON.stringify(grafo, null, 1)}\n`;
const scenaFile = path.join(REPO, F.scena);
let scenaNuova = null;
let scenaVecchia = null;
if (fs.existsSync(scenaFile)) {
  scenaVecchia = fs.readFileSync(scenaFile, 'utf8');
  const re = /(<script id="dati-grafo" type="application\/json">)[\s\S]*?(<\/script>)/;
  if (!re.test(scenaVecchia)) throw new Error(`${F.scena}: manca il blocco <script id="dati-grafo" type="application/json">`);
  // niente "</" dentro il JSON incorporato: non può chiudere lo script
  const dati = JSON.stringify(perScena).replace(/<\//g, '<\\/');
  scenaNuova = scenaVecchia.replace(re, (_, a, b) => `${a}${dati}${b}`);
}

if (CONTROLLA) {
  const jsonVecchio = esiste(F.json) ? leggi(F.json) : '';
  const ok = jsonVecchio === testoJson && (scenaNuova === null || scenaNuova === scenaVecchia);
  console.log(ok ? 'grafo.json e la scena sono aggiornati' : 'da rigenerare: node c5-presentazione/grafo/genera.mjs');
  process.exit(ok ? 0 : 1);
}

fs.writeFileSync(path.join(REPO, F.json), testoJson);
if (scenaNuova !== null && scenaNuova !== scenaVecchia) fs.writeFileSync(scenaFile, scenaNuova);

console.log(`grafo.json: ${lista.length} nodi, ${archi.length} archi (${Math.round(testoJson.length / 1024)} KB)`);
console.log(`  nodi: ${ordine.map((t) => `${conta(t)} ${t}`).join(', ')}`);
console.log(`  archi: ${ordineArchi.map((t) => `${contaArchi(t)} «${t}»`).join(', ')}`);
console.log(scenaNuova === null ? `  ${F.scena} non c'è: scena non aggiornata` : scenaNuova !== scenaVecchia ? `  scena aggiornata: ${F.scena}` : `  scena già aggiornata: ${F.scena}`);
if (!catalogo) console.log(`  ${F.catalogo} non c'è: fonti senza loghi`);
const isolati = lista.filter((n) => n.grado === 0).map((n) => n.breve);
if (isolati.length) console.log(`  senza relazioni: ${isolati.join(', ')}`);
for (const a of avvisi) console.log(`  attenzione: ${a}`);
