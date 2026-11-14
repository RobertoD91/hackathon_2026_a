// TwinCiro 3D: avvio e stato dell'applicazione. Tutto gira nel browser (pagina statica, GitHub Pages):
// dati reali da shared/iot-agents/example (snapshot + fonti live), modello delle presenze, agenti a regole.
//
// Parametri dell'indirizzo (servono a CiroGPT per mandare un link che apre il gemello sul punto giusto):
//   ?luogo=plebiscito          apre la scheda di un luogo
//   ?ora=+3 | ?ora=2026-11-15T11:00   ora mostrata (ore da adesso, oppure data e ora di Napoli)
//   ?domanda=come arrivo al Maradona?  fa la domanda a CiroGPT all'apertura
//   ?vista=celle  ?scheda=operatore  ?camera=vesuvio
//   ?adesso=2026-11-14T15:30   blocca "adesso" (per registrare il video o ripetere una prova)
//   ?rilievo=0                 senza rilievo (dispositivi lenti)   ?prova  senza animazioni (test automatici)

import { LUOGHI3D } from './luoghi3d.js';
import { creaModello, flussi, ORA, GIORNO } from './modello.js';
import { creaGriglia } from './griglia.js';
import { creaRete } from './rete.js';
import { creaMappa } from './mappa.js';
import { caricaTutto, fonti as F } from './dati.js';
import { rispondi, SUGGERIMENTI_BASE, SUGGERIMENTI_WHATIF } from './agenti.js';
import * as UI from './ui.js';
import * as N from '../../shared/iot-agents/example/fonti/normalizza.js';

const $ = (id) => document.getElementById(id);
const parametri = new URLSearchParams(location.search);
const PROVA = parametri.has('prova');
const adessoFisso = parametri.get('adesso') ? N.daIsoLocale(parametri.get('adesso')) : null;
const ora = () => adessoFisso ?? Date.now();

/** Stato dell'applicazione. */
const s = {
  dati: null,
  rete: null,
  griglia: null,
  modelloBase: null,
  modello: null,
  scenario: null,
  adesso: ora(),
  ts: ora(),
  vivo: true,
  zona: null,
  scheda: 'luogo',
  vista: 'luoghi',
  strati: { trasporti: true, flussi: true, eventi: true, edifici: true },
  categoria: '',
  cerca: '',
  orbita: false,
  riproduzione: false,
  percorso: null,
};
let mappa = null;
let contestoModello = null;
let timerRiproduzione = null;
let oraTempo = null; // ora per cui è stata disegnata la linea del tempo

// ------------------------------------------------------------------ aggiornamenti

function aggiornaMappa() {
  if (!mappa) return;
  const quadro = s.modello.quadro(s.ts);
  mappa.aggiornaLuoghi(quadro);
  if (s.vista === 'celle' && s.griglia) mappa.aggiornaGriglia(s.griglia.calcola(quadro, s.ts));
  mappa.aggiornaFlussi(s.strati.flussi ? flussi(s.modello, s.ts, { stazioni: s.dati.trasporti?.stazioni || [] }) : []);
  mappa.mostraEventi(s.modello.eventiTra(s.ts - 2 * ORA, s.ts + 6 * ORA));
}

/**
 * Sostituisce il contenuto di un pannello senza far perdere all'utente quello che stava facendo:
 * restano aperti i riquadri <details>, le scelte dei menu e gli elenchi caricati a richiesta (prossimi passaggi).
 */
function sostituisci(el, html, chiave) {
  const stessa = el.dataset.chiave === chiave;
  const aperti = stessa ? [...el.querySelectorAll('details')].map((d) => d.open) : [];
  const scelte = stessa ? Object.fromEntries([...el.querySelectorAll('form select[name]')].map((x) => [x.name, x.value])) : {};
  const caricati = stessa ? Object.fromEntries([...el.querySelectorAll('.passaggi[id]')].filter((x) => x.innerHTML).map((x) => [x.id, x.innerHTML])) : {};
  el.innerHTML = html;
  el.dataset.chiave = chiave;
  if (!stessa) return void (el.scrollTop = 0);
  el.querySelectorAll('details').forEach((d, i) => (d.open = Boolean(aperti[i])));
  for (const x of el.querySelectorAll('form select[name]')) if (scelte[x.name] !== undefined && [...x.options].some((o) => o.value === scelte[x.name])) x.value = scelte[x.name];
  for (const [id, contenuto] of Object.entries(caricati)) {
    const lista = document.getElementById(id);
    if (lista) lista.innerHTML = contenuto;
  }
}

function aggiornaScheda() {
  if (s.scheda === 'luogo') sostituisci($('scheda-luogo'), s.zona ? UI.rendiSchedaLuogo(s, s.zona) : UI.rendiSchedaCitta(s), s.zona || 'citta');
  else if (s.scheda === 'operatore' && !s.riproduzione) sostituisci($('scheda-operatore'), UI.rendiOperatore(s), 'operatore');
}

function aggiornaTempo(forza = false) {
  const oraCorrente = Math.floor(s.adesso / ORA);
  if (forza || oraTempo !== oraCorrente || !$('cursore')) {
    oraTempo = oraCorrente;
    $('tempo').innerHTML = UI.rendiTempo(s);
  } else {
    $('cursore').value = s.ts;
    const b = $('tempo').querySelector('[data-azione="adesso"]');
    b?.classList.toggle('acceso', s.vivo);
  }
}

let inAttesa = false;
/** Ridisegna tutto ciò che dipende dall'ora o dallo scenario (al massimo una volta per fotogramma). */
function aggiorna({ tempo = false, subito = false } = {}) {
  if (tempo) oraTempo = null;
  const fai = () => {
    inAttesa = false;
    aggiornaMappa();
    $('stato').innerHTML = UI.rendiStato(s);
    $('kpi').innerHTML = UI.rendiKpi(s);
    $('elenco').innerHTML = UI.rendiElenco(s);
    aggiornaScheda();
    aggiornaTempo();
  };
  if (subito || PROVA) return fai();
  if (inAttesa) return;
  inAttesa = true;
  requestAnimationFrame(fai);
}

function aggiornaStrumenti() {
  $('strumenti').innerHTML = UI.rendiStrumenti(s);
  $('legenda').innerHTML = UI.rendiLegenda(s);
}

// ------------------------------------------------------------------ azioni

function impostaOra(ts, { vivo = false } = {}) {
  s.ts = Math.min(s.adesso + 2 * GIORNO, Math.max(s.adesso - GIORNO, ts));
  s.vivo = vivo;
  aggiorna();
}

function seleziona(zona, { vola = true, scheda = true } = {}) {
  s.zona = zona && LUOGHI3D[zona] ? zona : null;
  mappa?.seleziona(s.zona, { vola });
  if (scheda && s.zona) mostraScheda('luogo', false);
  aggiorna();
  $('sinistra').classList.remove('aperto');
}

function mostraScheda(nome, ridisegna = true) {
  s.scheda = nome;
  for (const b of document.querySelectorAll('[data-scheda]')) b.setAttribute('aria-selected', String(b.dataset.scheda === nome));
  for (const n of ['luogo', 'ciro', 'operatore']) $(`scheda-${n}`).hidden = n !== nome;
  if (ridisegna) aggiornaScheda();
  if (nome === 'ciro') $('chat-input').focus({ preventScroll: true });
}

function impostaScenario(sc) {
  s.scenario = UI.scenarioAttivo(sc) ? sc : null;
  s.modello = s.scenario ? creaModello(contestoModello, s.scenario) : s.modelloBase;
  aggiorna({ tempo: true });
}

function riproduci(on = !s.riproduzione) {
  s.riproduzione = on;
  clearInterval(timerRiproduzione);
  if (on) {
    s.vivo = false;
    if (s.ts >= s.adesso + 2 * GIORNO - ORA) s.ts = s.adesso;
    timerRiproduzione = setInterval(() => {
      s.ts += 10 * 60_000;
      if (s.ts >= s.adesso + 2 * GIORNO) return riproduci(false);
      aggiorna();
    }, 110);
  }
  aggiornaTempo(true);
  aggiornaScheda();
}

function impostaVista(v) {
  s.vista = v;
  mappa?.impostaVista(v);
  aggiornaStrumenti();
  aggiornaMappa();
}

const inizioOggi = () => N.inizioGiorno(N.giornoLocale(s.adesso));

/** Scenario attuale come oggetto modificabile. */
const copiaScenario = () => ({ eventi: [...(s.scenario?.eventi || [])], lineeChiuse: [...(s.scenario?.lineeChiuse || [])], pioggia: s.scenario?.pioggia || null, navi: s.scenario?.navi || null, misure: { ...(s.scenario?.misure || {}) } });

function predefinito(nome) {
  const sc = copiaScenario();
  const domani = inizioOggi() + GIORNO;
  if (nome === 'concerto') {
    sc.eventi.push({ id: `pre:concerto:${domani}`, titolo: 'Concerto al Plebiscito', zona: 'plebiscito', inizio: domani + 21 * ORA, durataOre: 3, persone: 20_000 });
    impostaScenario(sc);
    seleziona('plebiscito', { scheda: false });
    impostaOra(domani + 21 * ORA);
  } else if (nome === 'linea1') {
    if (!sc.lineeChiuse.includes('L1')) sc.lineeChiuse.push('L1');
    impostaScenario(sc);
  } else if (nome === 'pioggia') {
    sc.pioggia = { da: domani + 9 * ORA, a: domani + 15 * ORA, mm: 5 };
    impostaScenario(sc);
    impostaOra(domani + 12 * ORA);
  } else if (nome === 'navi') {
    sc.navi = { giorno: N.giornoLocale(domani + 12 * ORA), n: 5 };
    impostaScenario(sc);
    seleziona('beverello', { scheda: false });
    impostaOra(domani + 11 * ORA);
  }
}

// ------------------------------------------------------------------ CiroGPT

const pausa = (ms) => new Promise((r) => setTimeout(r, PROVA ? 0 : ms));

async function chiedi(testo) {
  testo = String(testo || '').trim();
  if (!testo) return;
  mostraScheda('ciro', false);
  const chat = $('chat');
  chat.insertAdjacentHTML('beforeend', UI.messaggioUtente(testo));
  chat.insertAdjacentHTML('beforeend', UI.messaggioAttesa());
  const attesa = chat.lastElementChild;
  attesa.scrollIntoView({ block: 'end' });
  $('spunti').innerHTML = '';
  let r;
  try {
    r = await rispondi(testo, { modello: s.modello, modelloBase: s.modelloBase, contestoModello, rete: s.rete, dati: s.dati, adesso: s.adesso, ts: s.ts, zona: s.zona, soloLocale: parametri.has('locale'), timeoutMs: 7000 });
  } catch (err) {
    console.error(err);
    r = { testo: 'Scusa, qualcosa è andato storto mentre gli agenti lavoravano. Riprova.', passi: [{ agente: 'orchestratore', testo: `Errore: ${err.message}` }], azioni: [], suggerimenti: SUGGERIMENTI_BASE };
  }
  // la collaborazione tra agenti si vede: i passaggi compaiono uno alla volta
  attesa.innerHTML = '<ol class="traccia-viva"></ol>';
  const viva = attesa.firstElementChild;
  for (const p of r.passi) {
    viva.insertAdjacentHTML('beforeend', UI.passoAgente(p));
    attesa.scrollIntoView({ block: 'end' });
    await pausa(420);
  }
  await pausa(250);
  attesa.outerHTML = UI.messaggioCiro(r);
  $('spunti').innerHTML = UI.rendiSpunti(r.suggerimenti?.length ? r.suggerimenti : SUGGERIMENTI_BASE);
  chat.scrollTop = chat.scrollHeight; // dopo gli spunti, che tolgono spazio alla chat
  eseguiAzioni(r.azioni || []);
  return r;
}

function eseguiAzioni(azioni) {
  for (const a of azioni) {
    if (a.tipo === 'scenario') impostaScenario(a.scenario);
    else if (a.tipo === 'ora') impostaOra(a.ts);
    else if (a.tipo === 'seleziona') seleziona(a.zona, { scheda: false });
    else if (a.tipo === 'evidenzia') mappa?.evidenzia(a.zone);
    else if (a.tipo === 'inquadra') mappa?.inquadra(a.zone);
    else if (a.tipo === 'percorso') {
      s.percorso = a.percorso;
      mappa?.evidenzia([a.da, a.a].filter(Boolean));
      mappa?.mostraPercorso(a.percorso);
    }
  }
}

async function mostraPassaggi(idStazione) {
  const lista = $(`passaggi-${idStazione}`);
  const st = s.rete.stazioni.get(idStazione);
  if (!lista || !st) return;
  lista.innerHTML = '<li class="vuoto">Chiedo a Transitous…</li>';
  const r = await F.passaggi(st, { n: 5 });
  lista.innerHTML = UI.rendiPassaggi(r.dati, r.fonte.tipo === 'assente' ? `Non disponibile: ${r.fonte.nota}` : '');
}

// ------------------------------------------------------------------ eventi dell'interfaccia

function collega() {
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-chiedi],[data-azione],[data-scheda],[data-vista],[data-strato],[data-camera],[data-categoria],[data-predefinito],[data-linea],[data-togli-evento],[data-passaggi],[data-ts],[data-zona]');
    if (!t) return;
    const d = t.dataset;
    if (d.chiedi) return void chiedi(d.chiedi);
    if (d.scheda) return mostraScheda(d.scheda);
    if (d.vista) return impostaVista(d.vista);
    if (d.strato) {
      s.strati[d.strato] = !s.strati[d.strato];
      mappa?.impostaStrato(d.strato, s.strati[d.strato]);
      aggiornaStrumenti();
      return aggiornaMappa();
    }
    if (d.camera) {
      s.orbita = false;
      mappa?.orbita(false);
      aggiornaStrumenti();
      return mappa?.volaA(d.camera);
    }
    if (d.categoria !== undefined) {
      s.categoria = d.categoria;
      $('categorie').innerHTML = UI.rendiCategorie(s.categoria);
      return void ($('elenco').innerHTML = UI.rendiElenco(s));
    }
    if (d.predefinito) return predefinito(d.predefinito);
    if (d.linea) {
      const sc = copiaScenario();
      sc.lineeChiuse = sc.lineeChiuse.includes(d.linea) ? sc.lineeChiuse.filter((x) => x !== d.linea) : [...sc.lineeChiuse, d.linea];
      return impostaScenario(sc);
    }
    if (d.togliEvento !== undefined) {
      const sc = copiaScenario();
      sc.eventi.splice(Number(d.togliEvento), 1);
      return impostaScenario(sc);
    }
    if (d.passaggi) return void mostraPassaggi(d.passaggi);
    if (d.azione) {
      if (d.azione === 'chiudi-luogo') return seleziona(null);
      if (d.azione === 'azzera-scenario') return impostaScenario(null);
      if (d.azione === 'riproduci') return riproduci();
      if (d.azione === 'adesso') {
        riproduci(false);
        return impostaOra(s.adesso, { vivo: true });
      }
      if (d.azione === 'orbita') {
        s.orbita = !s.orbita;
        mappa?.orbita(s.orbita);
        return aggiornaStrumenti();
      }
      if (d.azione === 'togli-percorso') {
        s.percorso = null;
        mappa?.mostraPercorso(null);
        mappa?.evidenzia([]);
        return void t.remove();
      }
      return;
    }
    // salti nel tempo (barre, celle della sala operativa, tacche degli eventi) e scelta di un luogo
    if (d.ts) {
      riproduci(false);
      impostaOra(Number(d.ts));
      if (d.zona && d.zona !== s.zona) seleziona(d.zona, { scheda: s.scheda !== 'operatore' });
      return;
    }
    if (d.zona) return seleziona(d.zona);
  });

  document.addEventListener('input', (e) => {
    if (e.target.id === 'cursore') {
      riproduci(false);
      return impostaOra(Number(e.target.value));
    }
    if (e.target.id === 'cerca') {
      s.cerca = e.target.value;
      $('elenco').innerHTML = UI.rendiElenco(s);
    }
  });

  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.misura) {
      const sc = copiaScenario();
      sc.misure[t.dataset.misura] = t.checked;
      return impostaScenario(sc);
    }
    if (t.id === 'sel-pioggia') {
      const sc = copiaScenario();
      sc.pioggia = t.value ? { da: inizioOggi() + Number(t.value) * ORA, a: inizioOggi() + (Number(t.value) + 6) * ORA, mm: 5 } : null;
      return impostaScenario(sc);
    }
    if (t.id === 'sel-navi') {
      const sc = copiaScenario();
      sc.navi = t.value === '' ? null : { giorno: N.giornoLocale(inizioOggi() + GIORNO + 12 * ORA), n: Number(t.value) };
      return impostaScenario(sc);
    }
  });

  document.addEventListener('submit', (e) => {
    if (e.target.id === 'chat-form') {
      e.preventDefault();
      const campo = $('chat-input');
      const testo = campo.value;
      campo.value = '';
      return void chiedi(testo);
    }
    if (e.target.id === 'form-evento') {
      e.preventDefault();
      const f = new FormData(e.target);
      const inizio = inizioOggi() + Number(f.get('giorno')) * GIORNO + Number(f.get('ora')) * ORA;
      const sc = copiaScenario();
      const zona = String(f.get('zona'));
      sc.eventi.push({ id: `op:${zona}:${inizio}:${sc.eventi.length}`, titolo: `Evento a ${LUOGHI3D[zona].breve}`, zona, inizio, durataOre: Number(f.get('durata')), persone: Number(f.get('persone')) });
      impostaScenario(sc);
      seleziona(zona, { scheda: false });
      impostaOra(inizio + ORA);
    }
  });

  // suggerimenti al passaggio del mouse (attributo data-tip)
  const tip = $('tc-tip');
  document.addEventListener('mousemove', (e) => {
    const t = e.target.closest?.('[data-tip]');
    if (!t || !t.dataset.tip) return void (tip.hidden = true);
    tip.textContent = t.dataset.tip;
    tip.hidden = false;
    const r = tip.getBoundingClientRect();
    tip.style.left = `${Math.max(8, Math.min(window.innerWidth - r.width - 8, e.clientX + 14))}px`;
    tip.style.top = `${e.clientY + 18 + r.height > window.innerHeight ? e.clientY - r.height - 10 : e.clientY + 18}px`;
  });
  document.addEventListener('mouseleave', () => (tip.hidden = true));

  $('btn-fonti').addEventListener('click', () => {
    $('fonti').innerHTML = UI.rendiFonti(s);
    $('fonti').showModal();
  });
  $('btn-luoghi').addEventListener('click', () => {
    const aperto = $('sinistra').classList.toggle('aperto');
    $('btn-luoghi').setAttribute('aria-expanded', String(aperto));
  });
  window.addEventListener('resize', margini);
}

/** Spazio occupato dai pannelli: la mappa centra e inquadra nella parte libera. */
function margini() {
  if (!mappa) return;
  const largo = window.innerWidth > 980;
  const p = largo
    ? { left: $('sinistra').offsetWidth + 24, right: $('destra').offsetWidth + 24, top: 70, bottom: $('tempo').offsetHeight + 24 }
    : { left: 0, right: 0, top: 60, bottom: Math.round(window.innerHeight * 0.46) };
  mappa.map.setPadding(p);
}

// ------------------------------------------------------------------ avvio

async function avvia() {
  if (typeof maplibregl === 'undefined') {
    $('caricamento-testo').textContent = 'Non riesco a caricare la libreria della mappa (MapLibre da cdnjs). Controlla la connessione e ricarica.';
    return;
  }
  const [dati, grigliaJson] = await Promise.all([caricaTutto(), fetch(new URL('../dati/griglia.json', import.meta.url)).then((r) => (r.ok ? r.json() : null)).catch(() => null)]);
  s.dati = dati;
  s.rete = creaRete(dati.trasporti);
  s.griglia = grigliaJson ? creaGriglia(grigliaJson) : null;
  contestoModello = { eventi: dati.eventi, riferimenti: dati.riferimenti, meteoA: dati.meteoA, stazioni: dati.trasporti?.stazioni || [], adesso: adessoFisso ?? undefined };
  s.modelloBase = creaModello(contestoModello);
  s.modello = s.modelloBase;

  // parametri dell'indirizzo
  if (['celle', 'luoghi'].includes(parametri.get('vista'))) s.vista = parametri.get('vista');
  const oraChiesta = parametri.get('ora');
  if (oraChiesta) {
    const t = /^[+-]?\d+(\.\d+)?$/.test(oraChiesta.trim()) ? s.adesso + Number(oraChiesta) * ORA : N.daIsoLocale(oraChiesta);
    if (t) {
      s.ts = Math.min(s.adesso + 2 * GIORNO, Math.max(s.adesso - GIORNO, t));
      s.vivo = false;
    }
  }
  if (LUOGHI3D[parametri.get('luogo')]) s.zona = parametri.get('luogo');

  mappa = creaMappa($('mappa'), {
    luoghi: LUOGHI3D,
    trasporti: dati.trasporti,
    griglia: s.griglia,
    rilievo: parametri.get('rilievo') !== '0' && !(PROVA && parametri.get('rilievo') !== '1'),
    animazioni: !PROVA,
    catturabile: PROVA,
    vista: parametri.get('camera') || 'golfo',
  });
  window.twinciro = { stato: s, mappa, chiedi, impostaOra, seleziona, impostaScenario }; // per le prove e per chi vuole curiosare dalla console

  $('categorie').innerHTML = UI.rendiCategorie(s.categoria);
  $('spunti').innerHTML = UI.rendiSpunti(SUGGERIMENTI_BASE);
  $('chat').innerHTML = `<li class="msg msg-ciro"><p>Ciao, sono <b>CiroGPT</b>. Qui parlo con gli agenti della città dentro il gemello 3D: chiedimi un percorso, dove c’è meno folla, cosa succede con gli eventi di domani, oppure uno scenario “e se…”.</p></li>`;
  aggiornaStrumenti();
  collega();
  if (['ciro', 'operatore'].includes(parametri.get('scheda'))) mostraScheda(parametri.get('scheda'), false);
  aggiorna({ subito: true });

  mappa.su('luogo', (zona) => seleziona(zona, { vola: true }));
  mappa.su('orbita', (on) => {
    s.orbita = on;
    aggiornaStrumenti();
  });
  mappa.su('pronta', () => {
    margini();
    mappa.impostaVista(s.vista);
    for (const [nome, on] of Object.entries(s.strati)) if (!on) mappa.impostaStrato(nome, on);
    aggiornaMappa();
    if (s.zona) mappa.seleziona(s.zona, { vola: true });
    $('caricamento').classList.add('via');
    setTimeout(() => $('caricamento').remove(), 700);
    const domanda = parametri.get('domanda');
    if (domanda) chiedi(domanda).finally(() => (window.rispostaPronta = true));
    mappa.map.once('idle', () => (window.pronto = true));
  });

  // il tempo reale avanza: ogni 30 secondi si aggiorna "adesso" (e la mappa, se si sta guardando adesso)
  if (!adessoFisso) {
    setInterval(() => {
      s.adesso = ora();
      if (s.vivo && !s.riproduzione) s.ts = s.adesso;
      if (!s.riproduzione) aggiorna();
    }, 30_000);
  }
}

avvia().catch((err) => {
  console.error(err);
  const t = $('caricamento-testo');
  if (t) t.textContent = `Errore all’avvio: ${err.message}`;
});
