// Interfaccia del feed simulato. Funziona in due modi:
//  - servita da server.js: la simulazione passa da POST api/simulate (con LLM se configurato);
//  - pagina statica (GitHub Pages): la stessa simulazione mock gira nel browser.

import * as C from './src/core/index.js';
import { formatProb } from './src/core/predict.js';

const LS = { ads: 'c1fs.ads.v1', calib: 'c1fs.calib.v1', reali: 'c1fs.reali.v1', view: 'c1fs.view', cfg: 'c1fs.cfg.v1' };
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
};

const state = {
  data: null,
  view: store.get(LS.view, 'annunci'),
  ads: [],
  cfg: { perSegmento: 200, dividiPerGenere: true, seme: 42, usaLlm: true, ...store.get(LS.cfg, {}) },
  backend: null,
  sim: null,
  simAds: [],
  pred: null,
  calib: store.get(LS.calib, null),
  reali: store.get(LS.reali, { vincitore: '', annunci: {} }),
  feedAd: null,
  feedSeg: 'tutti',
  feedShow: 12,
  btPrima: null,
};

const $ = (s, el = document) => el.querySelector(s);
const main = $('#app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (x, d = 2) => (Number.isFinite(x) ? `${x.toLocaleString('it-IT', { minimumFractionDigits: d, maximumFractionDigits: d })}%` : '–');
const eur = (x) => (Number.isFinite(x) ? `${x.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €` : '–');
const n2 = (x, d = 2) => (Number.isFinite(x) ? x.toLocaleString('it-IT', { minimumFractionDigits: d, maximumFractionDigits: d }) : '–');
const color = (i) => `var(--v${i % 6})`;
const letterOf = (i) => String.fromCharCode(65 + (i % 26));

// ------------------------------------------------------------------ avvio
async function init() {
  state.data = await C.loadData();
  state.ads = store.get(LS.ads, null) || [];
  if (!state.ads.length) await loadExample('sneakers', false);
  state.backend = await detectBackend();
  renderBadge();
  document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => go(b.dataset.view)));
  $('#file-import').addEventListener('change', onImportFile);
  $('#file-results').addEventListener('change', onResultsFile);
  // un solo listener per tipo: le viste vengono ridisegnate ma `main` resta lo stesso
  main.addEventListener('input', (e) => (state.view === 'annunci' ? onAdInput(e) : state.view === 'verifica' ? onBtInput(e) : null));
  main.addEventListener('change', (e) => (state.view === 'annunci' ? onAdInput(e) : state.view === 'verifica' ? onBtInput(e) : null));
  if (state.view === 'simulazione' || state.view === 'verifica') state.view = 'annunci';
  render();
}

async function detectBackend() {
  // solo se la pagina è servita da server.js (che valorizza il meta): niente 404 su GitHub Pages
  const meta = document.querySelector('meta[name="c1-backend"]');
  if (!meta || meta.content !== 'api') return null;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2000);
    const res = await fetch('api/health', { signal: ctrl.signal, cache: 'no-store' });
    clearTimeout(t);
    if (!res.ok) return null;
    const j = await res.json();
    return j.ok ? j : null;
  } catch {
    return null;
  }
}

function renderBadge() {
  const b = $('#mode-badge');
  const be = state.backend;
  if (!be) { b.textContent = 'Modalità browser · simulazione euristica'; b.className = 'mode-badge'; b.title = 'Pagina statica: nessun backend, la simulazione mock gira nel browser.'; return; }
  if (be.llm) { b.textContent = `Server · LLM ${be.provider} (${be.model})`; b.className = 'mode-badge llm'; } else { b.textContent = 'Server · simulazione euristica'; b.className = 'mode-badge'; }
  b.title = 'Pagina servita da server.js';
}

function go(view) {
  state.view = view;
  store.set(LS.view, view);
  render();
  window.scrollTo({ top: 0 });
}

function render() {
  document.querySelectorAll('.tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.view === state.view)));
  if (state.view === 'annunci') renderAds();
  else if (state.view === 'simulazione') renderSim();
  else if (state.view === 'verifica') renderBacktest();
  else renderMethod();
}

function toast(msg, err = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = `toast${err ? ' err' : ''}`;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.add('hidden'), err ? 6000 : 3200);
}

function saveAds() {
  if (!store.set(LS.ads, state.ads)) {
    // immagini troppo grandi per localStorage: salviamo senza le immagini caricate
    store.set(LS.ads, state.ads.map((a) => ({ ...a, immagine: a.immagine?.startsWith('data:') ? '' : a.immagine })));
  }
}

// ------------------------------------------------------------------ esempi e import
async function loadExample(name, notify = true) {
  const file = name === 'pizza' ? 'esempi/annunci-esempio.csv' : 'esempi/annunci-esempio.json';
  const res = await fetch(file);
  const text = await res.text();
  state.ads = C.importAds(text, file);
  await Promise.all(state.ads.map((a) => refreshImageStats(a)));
  saveAds();
  state.sim = null; state.pred = null;
  if (notify) { toast(`Caricati ${state.ads.length} annunci d'esempio`); render(); }
}

async function onImportFile(e) {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const ads = C.importAds(await file.text(), file.name);
    state.ads = ads;
    await Promise.all(state.ads.map((a) => refreshImageStats(a)));
    saveAds();
    state.sim = null; state.pred = null;
    // se il file contiene già i risultati veri li mettiamo nella verifica
    const conRisultati = ads.filter((a) => a.risultati);
    if (conRisultati.length) {
      state.reali = { vincitore: '', annunci: Object.fromEntries(conRisultati.map((a) => [a.id, a.risultati])) };
      store.set(LS.reali, state.reali);
    }
    toast(`Importati ${ads.length} annunci da ${file.name}${conRisultati.length ? ` (con ${conRisultati.length} risultati veri)` : ''}`);
    render();
  } catch (err) {
    toast(`Import non riuscito: ${err.message}`, true);
  }
}

function download(name, obj) {
  const blob = new Blob([JSON.stringify(obj, (k, v) => (v instanceof Map ? Object.fromEntries(v) : v), 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ------------------------------------------------------------------ immagini
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('immagine non caricabile'));
    img.src = src;
  });
}

/** Statistiche semplici dell'immagine (stesso calcolo usato per gli esempi). */
async function computeImageStats(src) {
  const img = await loadImage(src);
  const cv = document.createElement('canvas');
  cv.width = 64; cv.height = 64;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, 64, 64);
  const d = ctx.getImageData(0, 0, 64, 64).data;
  const n = d.length / 4;
  let sl = 0; let sl2 = 0; let ss = 0;
  const rg = []; const yb = [];
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i]; const g = d[i + 1]; const b = d[i + 2];
    const l = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    sl += l; sl2 += l * l;
    const mx = Math.max(r, g, b); const mn = Math.min(r, g, b);
    ss += mx ? (mx - mn) / mx : 0;
    rg.push(r - g); yb.push(0.5 * (r + g) - b);
  }
  const m = sl / n;
  const ms = (a) => { const mu = a.reduce((s, x) => s + x, 0) / a.length; return [mu, Math.sqrt(a.reduce((s, x) => s + (x - mu) ** 2, 0) / a.length)]; };
  const [mrg, srg] = ms(rg); const [myb, syb] = ms(yb);
  const col = Math.sqrt(srg ** 2 + syb ** 2) + 0.3 * Math.sqrt(mrg ** 2 + myb ** 2);
  const r3 = (x) => Math.round(x * 1000) / 1000;
  return { luminosita: r3(m), contrasto: r3(Math.sqrt(Math.max(0, sl2 / n - m * m))), saturazione: r3(ss / n), colori: r3(Math.min(col / 150, 1)) };
}

async function refreshImageStats(ad) {
  if (!ad.immagine) return;
  try { ad.imageStats = await computeImageStats(ad.immagine); } catch { /* resta quello che c'era */ }
}

/** Ridimensiona l'immagine caricata (max 900 px, JPEG) per localStorage e per l'LLM. */
async function fileToDataUrl(file) {
  const src = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
  const img = await loadImage(src);
  const k = Math.min(1, 900 / Math.max(img.width, img.height));
  const cv = document.createElement('canvas');
  cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
  cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
  return cv.toDataURL('image/jpeg', 0.85);
}

// ------------------------------------------------------------------ vista 1: annunci
const opts = (dict, sel) => Object.entries(dict).map(([k, v]) => `<option value="${esc(k)}"${k === sel ? ' selected' : ''}>${esc(v)}</option>`).join('');
const ctaOpts = (sel) => {
  const keys = Object.keys(C.CTA);
  const all = keys.includes(sel) || !sel ? keys : [...keys, sel];
  return all.map((k) => `<option${k === sel ? ' selected' : ''}>${esc(k)}</option>`).join('');
};

function renderAds() {
  const be = state.backend;
  main.innerHTML = `
    <div class="section-title"><h2>Le varianti da confrontare</h2><span class="muted">Inserisci gli annunci oppure importa un file JSON/CSV. La diagnosi sotto ogni scheda si aggiorna mentre scrivi.</span></div>
    <div class="toolbar">
      <button class="btn" data-action="example" data-name="sneakers">Esempio: sneakers (3 varianti)</button>
      <button class="btn" data-action="example" data-name="pizza">Esempio: pizzeria (CSV)</button>
      <button class="btn" data-action="import">Importa JSON/CSV…</button>
      <button class="btn" data-action="export-ads">Esporta JSON</button>
      <span class="spacer"></span>
      <button class="btn primary big" data-action="simulate">Simula il pubblico ▶</button>
    </div>
    <div class="card settings-row">
      <label class="inline-field">Persone virtuali per segmento
        <select data-cfg="perSegmento">${[100, 200, 300, 500].map((n) => `<option${n === Number(state.cfg.perSegmento) ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
      <label class="inline-field"><input type="checkbox" data-cfg="dividiPerGenere"${state.cfg.dividiPerGenere ? ' checked' : ''}> Segmenti per età e genere</label>
      <label class="inline-field">Seme <input type="number" data-cfg="seme" value="${esc(state.cfg.seme)}" style="width:80px"></label>
      ${be?.llm ? `<label class="inline-field"><input type="checkbox" data-cfg="usaLlm"${state.cfg.usaLlm ? ' checked' : ''}> Usa l'LLM (${esc(be.model)})</label>` : ''}
      <span class="note">${segmentCount()} segmenti × ${state.cfg.perSegmento} = ${(segmentCount() * state.cfg.perSegmento).toLocaleString('it-IT')} persone per annuncio</span>
    </div>
    <div class="ad-grid">
      ${state.ads.map((a, i) => adCard(a, i)).join('')}
      ${state.ads.length < 6 ? '<button class="add-card" data-action="add">+ Aggiungi variante</button>' : ''}
    </div>`;
  bindAds();
}

function segmentCount() {
  return state.data.popolazione.fasce_eta.length * (state.cfg.dividiPerGenere ? 2 : 1);
}

function adCard(a, i) {
  const t = a.target;
  return `
  <article class="card ad-card" data-i="${i}">
    <header>
      <span class="letter" style="background:${color(i)}">${letterOf(i)}</span>
      <input data-f="nome" value="${esc(a.nome)}" aria-label="Nome della variante">
      ${state.ads.length > 1 ? `<button class="btn ghost" data-action="remove" data-i="${i}" title="Elimina variante">✕</button>` : ''}
    </header>
    <div class="ad-body">
      <label class="ad-img${a.immagine ? ' has' : ''}" data-drop="${i}">
        ${a.immagine ? `<img src="${esc(a.immagine)}" alt="">` : ''}
        <span class="ad-img-label">${a.immagine ? 'Cambia immagine' : 'Trascina qui l\'immagine<br>o fai clic per caricarla'}</span>
        <input type="file" accept="image/*" data-img="${i}" hidden>
      </label>
      <div class="grid-2">
        <label class="field"><span>Inserzionista</span><input data-f="marchio" value="${esc(a.marchio)}" placeholder="es. Passo Verde"></label>
        <label class="field"><span>Titolo</span><input data-f="titolo" value="${esc(a.titolo)}"></label>
      </div>
      <label class="field"><span>Testo</span><textarea data-f="testo" rows="4">${esc(a.testo)}</textarea></label>
      <div class="counter" data-counter="${i}"></div>
      <div class="grid-2">
        <label class="field"><span>Call to action</span><select data-f="cta">${ctaOpts(a.cta)}</select></label>
        <label class="field"><span>Settore</span><select data-f="settore">${opts(C.SETTORI, a.settore)}</select></label>
      </div>
      <div class="grid-3">
        <label class="field"><span>Piattaforma</span><select data-f="piattaforma">${opts(C.PIATTAFORME, a.piattaforma)}</select></label>
        <label class="field"><span>Obiettivo</span><select data-f="obiettivo">${opts(C.OBIETTIVI, a.obiettivo)}</select></label>
        <label class="field"><span>Posizionamento</span><select data-f="posizionamento">${opts(C.POSIZIONAMENTI, a.posizionamento)}</select></label>
      </div>
      <div class="grid-3">
        <label class="field"><span>Età</span><div style="display:flex;gap:4px;align-items:center"><input type="number" min="18" max="79" data-f="target.etaMin" value="${t.etaMin}"> – <input type="number" min="18" max="79" data-f="target.etaMax" value="${t.etaMax}"></div></label>
        <label class="field"><span>Genere</span><select data-f="target.genere">${opts({ tutti: 'Tutti', F: 'Donne', M: 'Uomini' }, t.genere)}</select></label>
        <label class="field"><span>Area</span><select data-f="target.area">${opts(C.AREE_TARGET, t.area)}</select></label>
      </div>
      <div class="grid-2">
        <label class="field"><span>Inizio campagna</span><input type="date" data-f="dataInizio" value="${esc(a.dataInizio)}"></label>
        <label class="field"><span>Descrizione immagine</span><input data-f="descrizioneImmagine" value="${esc(a.descrizioneImmagine)}" placeholder="es. ragazza che sorride"></label>
      </div>
    </div>
    <div class="ad-diagnosis"><small>Diagnosi immediata</small><div class="chips" data-diag="${i}"></div></div>
  </article>`;
}

function updateDiagnosis(i) {
  const a = state.ads[i];
  const f = C.extractFeatures(a);
  const diag = main.querySelector(`[data-diag="${i}"]`);
  if (diag) diag.innerHTML = C.featureChips(f).map((c) => `<span class="chip ${c.ok ? 'ok' : 'ko'}">${esc(c.testo)}</span>`).join('');
  const cnt = main.querySelector(`[data-counter="${i}"]`);
  if (cnt) {
    cnt.textContent = `${f.nParole} parole${f.nParole > 25 ? ' · lungo per i più giovani' : ''}`;
    cnt.classList.toggle('long', f.nParole > 25);
  }
}

function bindAds() {
  state.ads.forEach((_, i) => updateDiagnosis(i));
  main.querySelectorAll('[data-img]').forEach((inp) => inp.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (file) await setImage(Number(inp.dataset.img), file);
  }));
  main.querySelectorAll('[data-drop]').forEach((el) => {
    el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('drag'); });
    el.addEventListener('dragleave', () => el.classList.remove('drag'));
    el.addEventListener('drop', async (e) => {
      e.preventDefault();
      el.classList.remove('drag');
      const file = e.dataTransfer.files[0];
      if (file && file.type.startsWith('image/')) await setImage(Number(el.dataset.drop), file);
    });
  });
}

async function setImage(i, file) {
  try {
    const url = await fileToDataUrl(file);
    state.ads[i].immagine = url;
    state.ads[i].imageStats = await computeImageStats(url);
    saveAds();
    renderAds();
  } catch (err) {
    toast(`Immagine non valida: ${err.message}`, true);
  }
}

function onAdInput(e) {
  const el = e.target;
  if (el.dataset.cfg) {
    const k = el.dataset.cfg;
    state.cfg[k] = el.type === 'checkbox' ? el.checked : k === 'seme' ? el.value : Number(el.value);
    store.set(LS.cfg, state.cfg);
    if (e.type === 'change') renderAds();
    return;
  }
  const card = el.closest('[data-i]');
  if (!card || !el.dataset.f) return;
  const i = Number(card.dataset.i);
  const ad = state.ads[i];
  const path = el.dataset.f.split('.');
  let v = el.value;
  if (el.type === 'number') v = Number(v);
  if (path.length === 2) ad[path[0]][path[1]] = v; else ad[path[0]] = v;
  updateDiagnosis(i);
  clearTimeout(onAdInput.t);
  onAdInput.t = setTimeout(saveAds, 300);
}

main.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  if (btn.tagName === 'A') e.preventDefault();
  const act = btn.dataset.action;
  if (act === 'example') { await loadExample(btn.dataset.name); }
  else if (act === 'import') $('#file-import').click();
  else if (act === 'export-ads') download('annunci.json', { annunci: state.ads });
  else if (act === 'add') {
    const base = state.ads.at(-1) || {};
    const nuovo = C.normalizeAd({ ...base, id: undefined, nome: undefined, titolo: '', testo: '', immagine: '', imageStats: null, descrizioneImmagine: '' }, state.ads.length);
    nuovo.id = `ad-${Date.now().toString(36)}`;
    state.ads.push(nuovo);
    saveAds(); renderAds();
  } else if (act === 'remove') {
    state.ads.splice(Number(btn.dataset.i), 1);
    saveAds(); renderAds();
  } else if (act === 'simulate') await simulate();
  else if (act === 'go') go(btn.dataset.view);
  else if (act === 'feed-ad') { state.feedAd = btn.dataset.id; state.feedShow = 12; renderSim(); }
  else if (act === 'feed-seg') { state.feedSeg = btn.dataset.seg; state.feedShow = 12; renderSim(); }
  else if (act === 'more') { state.feedShow += 20; renderSim(); }
  else if (act === 'export-pred') download('previsione.json', { creata: new Date().toISOString(), annunci: state.simAds.map(({ immagine, ...a }) => ({ ...a, immagine: immagine?.startsWith('data:') ? '(caricata)' : immagine })), previsione: summarizePrediction() });
  else if (act === 'bt-demo') await loadDemoResults();
  else if (act === 'bt-file') $('#file-results').click();
  else if (act === 'bt-fit') fitFromResults();
  else if (act === 'bt-reset') { state.calib = null; store.set(LS.calib, null); recompute(); toast('Calibrazione riportata ai valori di riferimento'); renderBacktest(); }
  else if (act === 'bt-clear') { state.reali = { vincitore: '', annunci: {} }; store.set(LS.reali, state.reali); state.btPrima = null; renderBacktest(); }
  else if (act === 'bt-export-calib') download('calibrazione.json', currentCalib());
});

// segmento dalla tabella CTR (click sulla riga)
main.addEventListener('click', (e) => {
  const tr = e.target.closest('tr[data-seg]');
  if (!tr) return;
  state.feedSeg = state.feedSeg === tr.dataset.seg ? 'tutti' : tr.dataset.seg;
  state.feedShow = 12;
  renderSim();
});

// ------------------------------------------------------------------ simulazione
function showProgress(on, done = 0, total = 1, msg = '') {
  $('#progress').classList.toggle('hidden', !on);
  $('#progress-bar').style.width = `${Math.round((done / Math.max(total, 1)) * 100)}%`;
  $('#progress-msg').textContent = msg;
}

async function simulate() {
  if (!state.ads.length) return toast('Aggiungi almeno un annuncio', true);
  const ads = state.ads.map((a, i) => ({ ...C.normalizeAd(a, i), immagine: a.immagine, imageStats: a.imageStats }));
  const seen = new Set();
  ads.forEach((a, i) => { if (seen.has(a.id)) a.id = `${a.id}-${i}`; seen.add(a.id); });
  const config = { perSegmento: Number(state.cfg.perSegmento), dividiPerGenere: state.cfg.dividiPerGenere, seme: state.cfg.seme, usaLlm: state.cfg.usaLlm };
  showProgress(true, 0, 1, 'Preparo il pubblico sintetico…');
  try {
    let sim;
    if (state.backend) sim = await simulateOnServer(ads, config);
    else {
      await new Promise((r) => setTimeout(r, 30));
      sim = await C.runSimulation({ ads, data: state.data, config, onProgress: (d, t, m) => showProgress(true, d, t, m) });
    }
    state.sim = sim;
    state.simAds = ads;
    recompute();
    state.feedAd = state.pred.vincitore?.id || ads[0].id;
    state.feedSeg = 'tutti';
    state.feedShow = 12;
    showProgress(false);
    if (sim.llmErrori?.length) toast(`${sim.llmErrori.length} chiamate LLM non riuscite: per quei segmenti vale la stima euristica`, true);
    go('simulazione');
  } catch (err) {
    showProgress(false);
    toast(`Simulazione non riuscita: ${err.message}`, true);
  }
}

async function simulateOnServer(ads, config) {
  const res = await fetch('api/simulate', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/x-ndjson' },
    body: JSON.stringify({ annunci: ads.map((a) => ({ ...a, immagineLlm: a.immagine?.startsWith('data:') ? a.immagine : undefined, immagine: a.immagine?.startsWith('data:') ? '' : a.immagine })), config }),
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { msg = (await res.json()).error || msg; } catch { /* niente */ }
    throw new Error(msg);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let result = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      if (msg.type === 'progress') showProgress(true, msg.done, msg.total, msg.msg);
      else if (msg.type === 'result') result = msg.result;
      else if (msg.type === 'error') throw new Error(msg.error);
    }
  }
  if (!result) throw new Error('risposta incompleta dal server');
  return result;
}

function currentCalib() {
  const def = C.defaultCalibration(state.data.benchmark);
  const modo = state.sim ? (state.sim.modo === 'mock' ? 'mock' : 'llm') : 'mock';
  if (state.calib && (state.calib.modo || 'mock') === modo) return state.calib;
  return { ...def, modo };
}

function recompute() {
  if (!state.sim) return;
  state.pred = C.buildPrediction(state.sim, state.data.benchmark, currentCalib());
}

const simAdOf = (id) => state.sim.annunci.find((a) => a.id === id);
const inputAdOf = (id) => state.simAds.find((a) => a.id === id);
const idxOf = (id) => state.simAds.findIndex((a) => a.id === id);

// ------------------------------------------------------------------ vista 2: feed + previsione
function renderSim() {
  if (!state.sim || !state.pred) {
    main.innerHTML = `<div class="card empty"><h2>Nessuna simulazione ancora</h2><p>Prepara gli annunci e premi «Simula il pubblico»: migliaia di persone virtuali li vedranno nel loro feed.</p><button class="btn primary big" data-action="simulate">Simula il pubblico ▶</button></div>`;
    return;
  }
  const pred = state.pred;
  if (!state.feedAd || !simAdOf(state.feedAd)) state.feedAd = pred.vincitore.id;
  main.innerHTML = `
    <div class="sim-layout">
      <section class="feed-col" aria-label="Feed simulato">${feedHtml()}</section>
      <section class="pred-col" aria-label="Previsione">
        ${winnerHtml()}
        ${state.sim.annunci.length > 1 ? `<div class="card"><div class="card-head"><h2>Perché</h2><small>sintesi automatica dai motivi delle persone virtuali</small></div><div class="card-pad" style="padding-top:0"><ul class="sintesi">${pred.sintesi.map((s) => `<li>${esc(s)}</li>`).join('')}</ul></div></div>` : ''}
        ${ctrTableHtml()}
        ${cpmHtml()}
        ${whyHtml()}
        <div class="disclaimer"><span>⚠️</span><div><b>Cosa è stimato.</b> Il tasso di click delle persone virtuali non è un CTR: lo convertiamo con una tabella di CTR di riferimento per piattaforma e obiettivo (${esc(calibLabel())}). Il confronto tra varianti è più affidabile del valore assoluto. CPM da regole esplicite, non da un'asta reale. <a href="#" data-action="go" data-view="metodo">Dettagli</a></div></div>
        <div class="toolbar"><span class="spacer"></span><button class="btn" data-action="export-pred">Esporta la previsione (JSON)</button><button class="btn" data-action="go" data-view="verifica">Verifica con i risultati veri →</button></div>
      </section>
    </div>`;
}

function calibLabel() {
  const c = currentCalib();
  return c.fonte === 'taratura' ? `tarata in sede su ${c.punti} valori: scala ${c.scala}, esponente ${c.esponente}` : 'valori indicativi, non ancora tarati';
}

function winnerHtml() {
  const pred = state.pred;
  const v = pred.vincitore;
  const pa = pred.annunci.find((a) => a.id === v.id);
  const ad = inputAdOf(v.id);
  const max = Math.max(...pred.annunci.map((a) => a.ctrMax)) * 1.05;
  const multi = pred.annunci.length > 1;
  return `
  <div class="card">
    <div class="winner">
      ${ad?.immagine ? `<img class="thumb" src="${esc(ad.immagine)}" alt="">` : '<div class="thumb"></div>'}
      <div>
        <div class="kicker">${multi ? 'Annuncio vincente previsto' : 'Previsione'}</div>
        <h2>${esc(v.nome)}</h2>
        <div class="facts">
          <div><b class="num">${pct(pa.ctr)}</b><small>CTR previsto (${pct(pa.ctrMin)}–${pct(pa.ctrMax)})</small></div>
          ${multi ? `<div><b class="num">${esc(formatProb(v.probabilita))}</b><small>probabilità che sia la migliore</small></div>` : ''}
          ${multi && v.margine != null ? `<div><b class="num">+${Math.round(v.margine * 100)}%</b><small>CTR rispetto alla seconda</small></div>` : ''}
          <div><b class="num">${eur(pa.cpm.min)}–${eur(pa.cpm.max)}</b><small>fascia di CPM</small></div>
        </div>
      </div>
    </div>
    <div class="card-pad" style="padding-top:0">
      <div class="bars">
        ${pred.classifica.map((id) => {
          const a = pred.annunci.find((x) => x.id === id);
          const i = idxOf(id);
          return `<div class="bar-row">
            <div class="name"><span class="dot" style="background:${color(i)}"></span><span title="${esc(a.nome)}">${esc(a.nome)}</span></div>
            <div class="bar-track" title="Barra: CTR previsto. Segmento: fascia di incertezza">
              <div class="bar-fill" style="width:${(a.ctr / max) * 100}%;background:${color(i)};opacity:.85"></div>
              <div class="bar-range" style="left:${(a.ctrMin / max) * 100}%;width:${((a.ctrMax - a.ctrMin) / max) * 100}%"></div>
            </div>
            <div class="val num">${pct(a.ctr)}${multi ? `<small>${Math.round((pred.probVittoria[id] || 0) * 100)}% di vittorie</small>` : ''}</div>
          </div>`;
        }).join('')}
      </div>
    </div>
  </div>`;
}

function ctrTableHtml() {
  const pred = state.pred;
  const sim = state.sim;
  const all = [];
  for (const a of pred.annunci) for (const s of sim.segmenti) all.push(a.ctrSegmenti[s.id]);
  const lo = Math.min(...all); const hi = Math.max(...all);
  const heat = (v) => `rgba(109,40,217,${(0.05 + 0.32 * ((v - lo) / Math.max(hi - lo, 1e-9))).toFixed(3)})`;
  const ref = pred.annunci[0];
  return `
  <div class="card">
    <div class="card-head"><h2>CTR previsto per segmento</h2><small>clicca una riga per filtrare il feed · ★ = variante migliore nel segmento</small></div>
    <div class="table-wrap"><table class="ctr num">
      <thead><tr><th>Segmento</th><th>Quota impression</th>${pred.annunci.map((a) => `<th><span class="dot" style="background:${color(idxOf(a.id))}"></span> ${esc(a.nome)}</th>`).join('')}</tr></thead>
      <tbody>
        ${pred.perSegmento.map((s) => {
          const out = s.fuoriTarget;
          return `<tr data-seg="${esc(s.id)}" class="${out ? 'out' : ''}${state.feedSeg === s.id ? ' sel' : ''}">
            <td><b>${esc(s.label)}</b></td>
            <td>${out ? '–' : pct((ref.quotaImpression[s.id] || 0) * 100, 0)}</td>
            ${s.righe.map((r) => `<td class="${r.id === s.migliore && pred.annunci.length > 1 ? 'best' : ''}"><span class="heat" style="background:${heat(r.ctr)};padding:2px 6px">${pct(r.ctr)}</span></td>`).join('')}
          </tr>`;
        }).join('')}
      </tbody>
      <tfoot><tr><td>Totale target</td><td>100%</td>${pred.annunci.map((a) => `<td>${pct(a.ctr)}</td>`).join('')}</tr></tfoot>
    </table></div>
  </div>`;
}

function cpmHtml() {
  const pred = state.pred;
  const max = Math.max(...pred.annunci.map((a) => a.cpm.max)) * 1.15;
  const v = pred.annunci.find((a) => a.id === (state.feedAd || pred.vincitore.id)) || pred.annunci[0];
  const reali = state.reali.annunci || {};
  return `
  <div class="card">
    <div class="card-head"><h2>Fascia di CPM</h2><small>euro per 1000 impression · regole esplicite, vedi i fattori sotto</small></div>
    <div class="cpm-grid">
      ${pred.annunci.map((a) => {
        const i = idxOf(a.id);
        const r = reali[a.id]?.cpm;
        return `<div class="cpm-row">
          <div class="bar-row" style="display:contents"><div class="name"><span class="dot" style="background:${color(i)}"></span><span>${esc(a.nome)}</span></div></div>
          <div><div class="cpm-track">
            <div class="cpm-band" style="left:${(a.cpm.min / max) * 100}%;width:${((a.cpm.max - a.cpm.min) / max) * 100}%;background:${color(i)}"></div>
            <div class="cpm-center" style="left:${(a.cpm.centro / max) * 100}%"></div>
            ${Number.isFinite(r) ? `<div class="cpm-real" style="left:${(Math.min(r, max) / max) * 100}%" title="CPM reale ${eur(r)}"></div>` : ''}
          </div></div>
          <div class="val num" style="text-align:right;font-weight:800">${eur(a.cpm.min)}–${eur(a.cpm.max)}</div>
        </div>`;
      }).join('')}
      <div class="cpm-row"><div></div><div class="cpm-axis"><span>0 €</span><span>${eur(max / 2)}</span><span>${eur(max)}</span></div><div></div></div>
    </div>
    <div class="card-head" style="padding-top:0"><h2 style="font-size:15px">Perché questa fascia · ${esc(v.nome)}</h2><small>base ${esc(v.cpm.piattaforma)}: ${eur(v.cpm.base[0])}–${eur(v.cpm.base[1])}</small></div>
    <div class="factors">
      ${v.cpm.fattori.map((f) => `<div class="factor"><span class="m num ${f.mult > 1.005 ? 'up' : f.mult < 0.995 ? 'down' : 'eq'}">×${f.mult.toLocaleString('it-IT')}</span><div><b>${esc(f.nome)}</b><span>${esc(f.motivo)}</span></div></div>`).join('')}
    </div>
  </div>`;
}

function whyHtml() {
  const pred = state.pred;
  const segs = pred.perSegmento.filter((s) => state.feedSeg === 'tutti' ? !s.fuoriTarget : s.id === state.feedSeg);
  return `
  <div class="card">
    <div class="card-head"><h2>Il perché, segmento per segmento</h2><small>${state.feedSeg === 'tutti' ? 'segmenti del target' : 'segmento selezionato'} · + aiuta, − pesa contro${state.sim.modo !== 'mock' ? ' · in viola le voci dell\'LLM' : ''}</small></div>
    <div class="why-list">
      ${segs.map((s) => `
        <div class="why-seg${state.feedSeg === s.id ? ' sel' : ''}">
          <div><h3>${esc(s.label)}</h3>${pred.annunci.length > 1 ? `<span class="chip">meglio: ${esc(pred.annunci.find((a) => a.id === s.migliore)?.nome)}</span>` : ''}${s.fuoriTarget ? '<span class="chip ko">fuori target</span>' : ''}</div>
          <div class="why-ads">
            ${s.righe.map((r) => `<div class="why-ad"><b><span class="dot" style="background:${color(idxOf(r.id))}"></span>${esc(r.nome)} · ${pct(r.ctr)}</b><ul>
              ${r.motivi.pos.slice(0, 2).map((m) => `<li class="p">${esc(m.testo)}</li>`).join('')}
              ${r.motivi.neg.slice(0, 2).map((m) => `<li class="n">${esc(m.testo)}</li>`).join('')}
              ${(r.voci || []).slice(0, 2).map((v) => `<li class="v">«${esc(v)}»</li>`).join('')}
            </ul></div>`).join('')}
          </div>
        </div>`).join('') || '<p class="muted">Nessun segmento.</p>'}
    </div>
  </div>`;
}

function feedComments(simAd, seg) {
  const base = seg === 'tutti' ? simAd.commenti.filter((c) => !simAd.segmenti[c.seg]?.fuoriTarget) : simAd.commenti.filter((c) => c.seg === seg);
  const llm = base.filter((c) => c.fonte === 'llm');
  const rest = base.filter((c) => c.fonte !== 'llm');
  // alterna i segmenti per mostrare voci diverse
  const bySeg = new Map();
  for (const c of rest) bySeg.set(c.seg, [...(bySeg.get(c.seg) || []), c]);
  const mixed = [];
  const lists = [...bySeg.values()];
  for (let k = 0; mixed.length < rest.length; k++) for (const l of lists) if (l[k]) mixed.push(l[k]);
  return [...llm, ...mixed];
}

function avatarColor(name) {
  const h = [...name].reduce((s, c) => (s * 31 + c.charCodeAt(0)) >>> 0, 7) % 360;
  return `hsl(${h} 55% 48%)`;
}

function feedHtml() {
  const sim = state.sim;
  const pred = state.pred;
  const simAd = simAdOf(state.feedAd);
  const ad = inputAdOf(state.feedAd) || simAd.ad;
  const pa = pred.annunci.find((a) => a.id === simAd.id);
  const seg = state.feedSeg;
  const segData = seg === 'tutti' ? null : simAd.segmenti[seg];
  const stats = segData || simAd.totale;
  const reaz = stats.reazioni;
  const nPersone = segData ? segData.persone : Object.values(simAd.segmenti).filter((s) => !s.fuoriTarget).reduce((a, s) => a + s.persone, 0);
  const comments = feedComments(simAd, seg);
  const plat = ad.piattaforma;
  const isFb = plat === 'facebook' || plat === 'linkedin';
  const marchio = ad.marchio || 'Inserzionista';
  const ctr = seg === 'tutti' ? pa.ctr : pa.ctrSegmenti[seg];
  const img = ad.immagine ? `<img class="post-img" src="${esc(ad.immagine)}" alt="Immagine dell'annuncio">` : '<div class="post-noimg">Annuncio senza immagine</div>';
  const hasCta = ad.cta && ad.cta !== 'Nessuna';
  const likes = reaz.like + reaz.commento + Math.round(reaz.click * 0.4);

  const post = isFb ? `
      <div class="post-head"><div class="av">${esc(marchio.slice(0, 2).toUpperCase())}</div><div><b>${esc(marchio)}</b><small>Sponsorizzato · 🌐</small></div></div>
      <div class="post-caption">${esc(ad.testo)}</div>
      ${img}
      <div class="fb-link"><div><small>${esc(marchio.toLowerCase().replace(/\s+/g, ''))}.it</small><b>${esc(ad.titolo || marchio)}</b></div>${hasCta ? `<span class="fbbtn">${esc(ad.cta)}</span>` : ''}</div>
      <div class="post-meta" style="padding-top:8px">👍❤️ ${likes.toLocaleString('it-IT')} persone virtuali · ${reaz.commento} commenti</div>`
    : `
      <div class="post-head"><div class="av">${esc(marchio.slice(0, 2).toUpperCase())}</div><div><b>${esc(marchio.toLowerCase().replace(/\s+/g, '.'))}</b><small>Sponsorizzato</small></div></div>
      ${img}
      <div class="post-cta${hasCta ? '' : ' none'}">${hasCta ? `${esc(ad.cta)} <span>›</span>` : 'Nessuna call to action'}</div>
      <div class="post-actions" aria-hidden="true"><span>♡</span><span>💬</span><span>➤</span><span>⌑</span></div>
      <div class="post-likes">Piace a ${likes.toLocaleString('it-IT')} persone virtuali</div>
      <div class="post-caption"><b>${esc(marchio.toLowerCase().replace(/\s+/g, '.'))}</b>${ad.titolo ? `<b>${esc(ad.titolo)}</b> ` : ''}${esc(ad.testo)}</div>
      <div class="post-meta">Mostra tutti i ${reaz.commento} commenti</div>`;

  return `
    <div class="variant-tabs">${pred.annunci.map((a) => `<button data-action="feed-ad" data-id="${esc(a.id)}" aria-pressed="${a.id === state.feedAd}"><span class="dot" style="background:${color(idxOf(a.id))}"></span>${esc(a.nome)}${a.id === pred.vincitore.id && pred.annunci.length > 1 ? '<span class="win">vince</span>' : ''}</button>`).join('')}</div>
    <div class="seg-filter">
      <button data-action="feed-seg" data-seg="tutti" aria-pressed="${seg === 'tutti'}">Tutto il target</button>
      ${sim.segmenti.map((s) => `<button data-action="feed-seg" data-seg="${esc(s.id)}" aria-pressed="${seg === s.id}" class="${simAd.segmenti[s.id].fuoriTarget ? 'out' : ''}" title="${simAd.segmenti[s.id].fuoriTarget ? 'Fuori dal target dichiarato' : ''}">${esc(s.label)}</button>`).join('')}
    </div>
    <div class="phone">
      <div class="phone-bar ${esc(plat)}"><span class="plat">${esc(C.PIATTAFORME[plat] || plat)}</span><span aria-hidden="true">♡ ✉</span></div>
      <div class="phone-scroll">
        <div class="ghost-post"><div class="av" style="width:30px;height:30px;border-radius:50%;background:#ddd"></div><div class="ph"></div></div>
        ${segData?.fuoriTarget ? '<div class="out-note">Segmento fuori dal target dichiarato: è una stima «e se lo vedessero anche loro».</div>' : ''}
        ${post}
        <div class="comments">
          ${comments.slice(0, state.feedShow).map((c) => `
            <div class="comment">
              <div class="av" style="background:${avatarColor(c.nome)}">${esc(c.nome.split(' ').map((x) => x[0]).join(''))}</div>
              <div class="body">
                <div class="who">${esc(c.nome)}<small>${c.eta} anni · ${esc(c.citta)}</small>${c.reazione === 'click' ? '<span class="tag click">ha cliccato</span>' : ''}${c.fonte === 'llm' ? '<span class="tag llm">LLM</span>' : ''}</div>
                <div>${esc(c.testo)}</div>
                ${c.motivo ? `<span class="why">perché: ${esc(c.motivo)}</span>` : ''}
              </div>
            </div>`).join('') || '<p class="muted" style="padding:12px">Nessun commento in questo segmento.</p>'}
          ${comments.length > state.feedShow ? `<button class="more" data-action="more">Mostra altri commenti (${comments.length - state.feedShow})</button>` : ''}
        </div>
        <div class="ghost-post"><div class="av" style="width:30px;height:30px;border-radius:50%;background:#ddd"></div><div class="ph"></div></div>
      </div>
    </div>
    <div class="feed-stats num">
      <div><b>${nPersone.toLocaleString('it-IT')}</b><small>persone virtuali</small></div>
      <div><b>${pct(stats.stop * 100, 0)}</b><small>si fermano</small></div>
      <div><b>${pct(stats.click * 100, 1)}</b><small>tasso click simulato</small></div>
      <div><b>${pct(ctr)}</b><small>CTR previsto</small></div>
    </div>`;
}

function summarizePrediction() {
  const p = state.pred;
  return {
    vincitore: p.vincitore,
    sintesi: p.sintesi,
    annunci: p.annunci.map((a) => ({
      id: a.id, nome: a.nome, ctrPct: round(a.ctr, 3), ctrFasciaPct: [round(a.ctrMin, 3), round(a.ctrMax, 3)],
      ctrSegmentiPct: Object.fromEntries(Object.entries(a.ctrSegmenti).map(([k, v]) => [k, round(v, 3)])),
      cpmEur: { min: a.cpm.min, max: a.cpm.max, centro: a.cpm.centro, fattori: a.cpm.fattori },
    })),
    perSegmento: p.perSegmento.map((s) => ({ segmento: s.label, migliore: s.migliore, frase: s.frase, fuoriTarget: s.fuoriTarget })),
    calibrazione: p.calibrazione,
    modo: state.sim.modo,
    modello: state.sim.modello,
  };
}
const round = (x, d) => Math.round(x * 10 ** d) / 10 ** d;

// ------------------------------------------------------------------ vista 3: verifica
function renderBacktest() {
  if (!state.sim || !state.pred) {
    main.innerHTML = `<div class="card empty"><h2>Prima serve una previsione</h2><p>Simula gli annunci, poi qui inserisci i risultati veri (vincitore, CTR, CPM) e vedi quanto ci abbiamo preso. Con i risultati degli annunci d'esempio puoi anche tarare il modello.</p><button class="btn primary big" data-action="go" data-view="annunci">Vai agli annunci</button></div>`;
    return;
  }
  const pred = state.pred;
  const r = state.reali;
  const bt = C.evaluateBacktest(pred, r);
  const calib = currentCalib();
  main.innerHTML = `
    <div class="section-title"><h2>Verifica sui risultati veri</h2><span class="muted">Quando Bhblasted rivela i risultati: inseriscili qui. I calcoli si aggiornano mentre scrivi.</span></div>
    <div class="toolbar">
      <button class="btn" data-action="bt-file">Carica risultati da file…</button>
      <button class="btn" data-action="bt-demo">Risultati demo (inventati)</button>
      <button class="btn" data-action="bt-clear">Svuota</button>
      <span class="spacer"></span>
      <button class="btn" data-action="bt-export-calib">Esporta calibrazione</button>
      <button class="btn" data-action="bt-reset">Calibrazione di default</button>
      <button class="btn primary" data-action="bt-fit">Tara il modello su questi risultati</button>
    </div>
    <div class="bt-layout">
      <div class="card card-pad">
        <h2 style="margin:0 0 6px;font-size:17px">Risultati veri</h2>
        <label class="field" style="max-width:360px;margin:10px 0"><span>Annuncio vincente reale</span>
          <select data-bt="vincitore"><option value="">dedotto dal CTR più alto</option>${pred.annunci.map((a) => `<option value="${esc(a.id)}"${r.vincitore === a.id ? ' selected' : ''}>${esc(a.nome)}</option>`).join('')}</select></label>
        ${pred.annunci.map((a) => {
          const v = r.annunci?.[a.id] || {};
          return `<div class="bt-ad">
            <div class="name"><span class="dot" style="background:${color(idxOf(a.id))}"></span>${esc(a.nome)}</div>
            <label class="field"><span>CTR reale %</span><input type="number" step="0.01" min="0" data-bt-ad="${esc(a.id)}" data-k="ctr" value="${v.ctr ?? ''}" placeholder="${pct(a.ctr)}"></label>
            <label class="field"><span>CPM reale €</span><input type="number" step="0.01" min="0" data-bt-ad="${esc(a.id)}" data-k="cpm" value="${v.cpm ?? ''}" placeholder="${n2(a.cpm.centro)}"></label>
            <details${Object.keys(v.ctrSegmenti || {}).length ? ' open' : ''}><summary>CTR reale per segmento (facoltativo)</summary>
              <div class="bt-segs">${state.sim.segmenti.map((s) => `<label class="field"><span>${esc(s.label)}</span><input type="number" step="0.01" min="0" data-bt-ad="${esc(a.id)}" data-seg="${esc(s.id)}" value="${v.ctrSegmenti?.[s.id] ?? ''}"></label>`).join('')}</div>
            </details>
          </div>`;
        }).join('')}
      </div>
      <div class="pred-col">
        <div class="card card-pad">
          <h2 style="margin:0 0 12px;font-size:17px">Quanto ci abbiamo preso</h2>
          ${btTiles(bt)}
          ${state.btPrima ? `<p class="muted" style="margin:10px 0 0;font-size:13px">Prima della taratura: errore CTR medio ${state.btPrima.ctr ? `${n2(state.btPrima.ctr.maePuntiPct)} pp` : '–'}${state.btPrima.cpm ? `, CPM nella fascia ${state.btPrima.cpm.dentro}/${state.btPrima.cpm.totale}` : ''}. Attenzione: misurato sugli stessi annunci usati per tarare.</p>` : ''}
        </div>
        <div class="card">
          <div class="card-head"><h2>Dettaglio per annuncio</h2></div>
          <div class="table-wrap"><table class="ctr bt-table num">
            <thead><tr><th>Annuncio</th><th>CTR previsto</th><th>CTR reale</th><th>Errore</th><th>CPM previsto</th><th>CPM reale</th><th>Nella fascia</th></tr></thead>
            <tbody>${bt.righe.map((x) => `<tr>
              <td><span class="dot" style="background:${color(idxOf(x.id))}"></span> ${esc(x.nome)}${bt.vincitore?.reale === x.id ? ' 🏆' : ''}</td>
              <td>${pct(x.ctrPrevisto)}</td><td>${x.ctrReale != null ? pct(x.ctrReale) : '–'}</td>
              <td>${x.erroreAss != null ? `${x.erroreAss > 0 ? '+' : ''}${n2(x.erroreAss)} pp${x.erroreRel != null ? ` (${x.erroreRel > 0 ? '+' : ''}${Math.round(x.erroreRel * 100)}%)` : ''}` : '–'}</td>
              <td>${eur(x.cpm.min)}–${eur(x.cpm.max)}</td><td>${x.cpmReale != null ? eur(x.cpmReale) : '–'}</td>
              <td>${x.cpmDentro == null ? '–' : x.cpmDentro ? '<span class="yes">sì</span>' : `<span class="no">no</span> (${x.cpmScarto > 0 ? '+' : ''}${Math.round(x.cpmScarto * 100)}%)`}</td>
            </tr>`).join('')}</tbody>
          </table></div>
        </div>
        <div class="calib"><b>Calibrazione attiva:</b> ${calib.fonte === 'taratura' ? `tarata su ${calib.punti} valori (${new Date(calib.creata).toLocaleString('it-IT')})` : 'valori di riferimento indicativi'} · scala ${n2(calib.scala, 3)} · esponente ${n2(calib.esponente, 2)} · incertezza ±${Math.round((Math.exp(calib.incertezza) - 1) * 100)}% · CPM ×${n2(calib.cpmScala, 2)}.
          <br><span class="muted">La taratura resta salvata in questo browser e vale per le prossime simulazioni (stessa modalità: ${state.sim.modo === 'mock' ? 'euristica' : 'LLM'}).</span></div>
      </div>
    </div>`;
}

function btTiles(bt) {
  const tiles = [];
  if (bt.vincitore) {
    const nome = (id) => state.pred.annunci.find((a) => a.id === id)?.nome || id;
    tiles.push(`<div class="tile ${bt.vincitore.corretto ? 'ok' : 'ko'}"><b>${bt.vincitore.corretto ? 'Giusto' : 'Sbagliato'}</b><small>vincitore: previsto ${esc(nome(bt.vincitore.previsto))}, reale ${esc(nome(bt.vincitore.reale))}</small></div>`);
  }
  if (bt.ctr) tiles.push(`<div class="tile ${bt.ctr.mapePct != null && bt.ctr.mapePct <= 30 ? 'ok' : ''}"><b class="num">${n2(bt.ctr.maePuntiPct)} pp</b><small>errore CTR medio${bt.ctr.mapePct != null ? ` (${Math.round(bt.ctr.mapePct)}% relativo)` : ''} su ${bt.ctr.n} annunci</small></div>`);
  if (bt.cpm) tiles.push(`<div class="tile ${bt.cpm.dentro === bt.cpm.totale ? 'ok' : bt.cpm.dentro === 0 ? 'ko' : ''}"><b class="num">${bt.cpm.dentro}/${bt.cpm.totale}</b><small>CPM dentro la fascia</small></div>`);
  if (bt.ordine != null) tiles.push(`<div class="tile"><b class="num">${n2(bt.ordine)}</b><small>correlazione dell'ordine (Spearman)</small></div>`);
  if (bt.segmenti) tiles.push(`<div class="tile"><b class="num">${n2(bt.segmenti.maePuntiPct)} pp</b><small>errore CTR per segmento su ${bt.segmenti.n} valori${bt.segmenti.spearman != null ? ` · ordine ${n2(bt.segmenti.spearman)}` : ''}</small></div>`);
  return tiles.length ? `<div class="score-tiles">${tiles.join('')}</div>` : '<p class="muted">Inserisci almeno un CTR o un CPM reale.</p>';
}

function onBtInput(e) {
  const el = e.target;
  if (state.view !== 'verifica') return;
  if (el.dataset.bt === 'vincitore') state.reali.vincitore = el.value;
  else if (el.dataset.btAd) {
    const id = el.dataset.btAd;
    const v = el.value === '' ? undefined : Number(el.value);
    const rec = state.reali.annunci[id] || (state.reali.annunci[id] = {});
    if (el.dataset.seg) { rec.ctrSegmenti = rec.ctrSegmenti || {}; if (v === undefined) delete rec.ctrSegmenti[el.dataset.seg]; else rec.ctrSegmenti[el.dataset.seg] = v; } else rec[el.dataset.k] = v;
  } else return;
  store.set(LS.reali, state.reali);
  if (e.type === 'change' || el.tagName === 'SELECT') { rerenderBtKeepFocus(); return; }
  clearTimeout(onBtInput.t);
  onBtInput.t = setTimeout(rerenderBtKeepFocus, 500);
}

function rerenderBtKeepFocus() {
  const a = document.activeElement;
  const sel = a && a.dataset ? (a.dataset.btAd ? `[data-bt-ad="${a.dataset.btAd}"]${a.dataset.seg ? `[data-seg="${a.dataset.seg}"]` : `[data-k="${a.dataset.k}"]`}` : a.dataset.bt ? '[data-bt="vincitore"]' : null) : null;
  renderBacktest();
  if (sel) { const el = main.querySelector(sel); if (el) { el.focus(); if (el.type === 'number') { /* cursore in fondo */ } } }
}

async function loadDemoResults() {
  const res = await fetch('esempi/risultati-demo.json');
  applyResults(await res.json(), 'risultati-demo.json');
}

async function onResultsFile(e) {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const text = await file.text();
    const t = text.trim();
    if (t.startsWith('{') || t.startsWith('[')) {
      const j = JSON.parse(t);
      if (j && j.scala != null && j.esponente != null && j.riferimentoSimulato) {
        state.calib = j; store.set(LS.calib, j); recompute(); toast('Calibrazione importata'); renderBacktest(); return;
      }
      applyResults(j, file.name);
    } else {
      const rows = C.parseCsv(t);
      applyResults(rows, file.name);
    }
  } catch (err) {
    toast(`File non valido: ${err.message}`, true);
  }
}

/** Accetta { vincitore, annunci: {id: {...}} } oppure un elenco di righe con id/nome + ctr + cpm. */
function applyResults(j, nome) {
  const pred = state.pred;
  const out = { vincitore: '', annunci: {} };
  const num = (v) => { if (v == null || v === '') return undefined; const n = parseFloat(String(v).replace('%', '').replace('€', '').replace(',', '.')); return Number.isFinite(n) ? n : undefined; };
  const findId = (row, i) => {
    const id = row.id ?? row.ID ?? row.annuncio;
    const nomeR = String(row.nome ?? row.name ?? row.variante ?? '').trim().toLowerCase();
    return pred.annunci.find((a) => a.id === id)?.id || pred.annunci.find((a) => nomeR && a.nome.toLowerCase() === nomeR)?.id || pred.annunci[i]?.id;
  };
  if (Array.isArray(j)) {
    j.forEach((row, i) => {
      const id = findId(row, i);
      if (!id) return;
      const ctrSegmenti = {};
      for (const s of state.sim.segmenti) {
        const k = Object.keys(row).find((x) => x.replace(/\s/g, '').toLowerCase() === `ctr_${s.id}`.toLowerCase() || x.trim() === s.label);
        if (k && num(row[k]) !== undefined) ctrSegmenti[s.id] = num(row[k]);
      }
      out.annunci[id] = { ctr: num(row.ctr ?? row.ctr_reale ?? row.CTR), cpm: num(row.cpm ?? row.cpm_reale ?? row.CPM), ctrSegmenti };
      if (/^(si|sì|yes|true|1|x)$/i.test(String(row.vincitore ?? row.winner ?? ''))) out.vincitore = id;
    });
  } else {
    const ann = j.annunci || {};
    const entries = Array.isArray(ann) ? ann.map((row, i) => [findId(row, i), row]) : Object.entries(ann).map(([k, v], i) => [pred.annunci.find((a) => a.id === k)?.id || findId({ nome: k, ...v }, i), v]);
    for (const [id, v] of entries) if (id) out.annunci[id] = { ctr: num(v.ctr), cpm: num(v.cpm), ctrSegmenti: v.ctrSegmenti || {} };
    out.vincitore = pred.annunci.find((a) => a.id === j.vincitore)?.id || '';
  }
  state.reali = out;
  store.set(LS.reali, out);
  state.btPrima = null;
  toast(`Risultati caricati da ${nome}`);
  renderBacktest();
}

function fitFromResults() {
  const pred = state.pred;
  const r = state.reali.annunci || {};
  const punti = [];
  const cpmPunti = [];
  for (const a of pred.annunci) {
    const v = r[a.id];
    if (!v) continue;
    if (Number.isFinite(v.ctr)) punti.push({ sim: a.simClick, rif: a.ctrRiferimento, reale: v.ctr });
    for (const [seg, val] of Object.entries(v.ctrSegmenti || {})) {
      const s = simAdOf(a.id).segmenti[seg];
      if (s && Number.isFinite(val)) punti.push({ sim: s.click, rif: a.ctrRiferimento, reale: val });
    }
    if (Number.isFinite(v.cpm)) cpmPunti.push({ previsto: a.cpm.centro, reale: v.cpm });
  }
  if (!punti.length && !cpmPunti.length) return toast('Inserisci almeno un CTR o un CPM reale', true);
  state.btPrima = C.evaluateBacktest(pred, state.reali);
  const modo = state.sim.modo === 'mock' ? 'mock' : 'llm';
  const cur = currentCalib();
  const base = { ...C.defaultCalibration(state.data.benchmark), cpmScala: cur.cpmScala || 1 };
  const calib = { ...C.fitCalibration(punti, base, cpmPunti, modo), modo };
  state.calib = calib;
  store.set(LS.calib, calib);
  recompute();
  toast(`Modello tarato su ${punti.length} CTR e ${cpmPunti.length} CPM: scala ${n2(calib.scala, 3)}, esponente ${n2(calib.esponente)}, CPM ×${n2(calib.cpmScala)}`);
  renderBacktest();
}

// ------------------------------------------------------------------ vista 4: come funziona
function renderMethod() {
  const d = state.data;
  const fonti = [...(d.popolazione._fonti || []), ...(d.benchmark._fonti || [])];
  const ctrTab = Object.entries(d.benchmark.ctr_riferimento_pct).filter(([k]) => !k.startsWith('_'));
  main.innerHTML = `
    <div class="section-title"><h2>Come funziona</h2><span class="muted">Clienti che non esistono: un pubblico sintetico che guarda il feed prima che l'annuncio vada online.</span></div>
    <div class="steps">
      <div class="step"><h3>Pubblico sintetico</h3><p>Persone virtuali per segmento (età × genere), con area, città, interessi e abitudini estratti da distribuzioni ISTAT arrotondate e da ipotesi dichiarate.</p></div>
      <div class="step"><h3>Il feed</h3><p>Ogni persona vede l'annuncio tra altri post. Il modello stima la probabilità di fermarsi e di cliccare, la reazione, un commento e il motivo.</p></div>
      <div class="step"><h3>Calibrazione</h3><p>Il tasso di click simulato è un punteggio relativo: lo convertiamo in CTR con una tabella di riferimento per piattaforma e obiettivo, tarabile sui risultati veri.</p></div>
      <div class="step"><h3>CPM</h3><p>Fascia stimata con regole esplicite: piattaforma, ampiezza del target, età, posizionamento, obiettivo, periodo (novembre e Black Friday lo alzano).</p></div>
      <div class="step"><h3>Verifica</h3><p>Con i risultati veri misuriamo vincitore giusto/sbagliato, errore sul CTR e CPM dentro o fuori fascia, e ritariamo il modello.</p></div>
    </div>
    <div class="method">
      <div class="card"><h3>Cosa è stimato e cosa è misurato</h3>
        <table class="plain"><tbody>
          <tr><td><b>Misurato</b></td><td>Le caratteristiche dell'annuncio: lunghezza del testo, presenza di offerta/prezzo/urgenza, call to action, luminosità e colori dell'immagine, coerenza con piattaforma e target.</td></tr>
          <tr><td><b>Stimato</b></td><td>Le reazioni delle persone virtuali (modello euristico deterministico, oppure LLM su un campione per segmento), la conversione in CTR, la fascia di CPM.</td></tr>
          <tr><td><b>Indicativo</b></td><td>Tabelle di CTR e CPM di riferimento, uso dei social e interessi per età: valori da verificare e tarare in sede.</td></tr>
          <tr><td><b>Più affidabile</b></td><td>Il confronto tra varianti (quale vince) è più solido del CTR assoluto: per questo mostriamo una fascia di incertezza.</td></tr>
        </tbody></table>
      </div>
      <div class="card"><h3>La formula del CTR</h3>
        <p><code>CTR = CTR di riferimento × settore × scala × (tasso simulato ÷ ${n2(d.benchmark.calibrazione_default.riferimento_simulato.mock)})<sup>esponente</sup></code></p>
        <p>Con annunci d'esempio dai risultati noti, la pagina Verifica stima <i>scala</i> ed <i>esponente</i> con una regressione sui logaritmi (un solo annuncio: solo la scala) e un fattore di scala per il CPM.</p>
        <div style="overflow-x:auto"><table class="plain num" style="font-size:13px"><thead><tr><th>CTR rif. %</th>${Object.keys(ctrTab[0][1]).map((k) => `<th>${esc(C.OBIETTIVI[k] || k)}</th>`).join('')}</tr></thead>
        <tbody>${ctrTab.map(([p, row]) => `<tr><td><b>${esc(C.PIATTAFORME[p] || p)}</b></td>${Object.values(row).map((v) => `<td>${v.toLocaleString('it-IT')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
        <p class="muted"><small>Valori indicativi da verificare.</small></p>
      </div>
      <div class="card"><h3>Fonti e note</h3><ul>${fonti.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>
        <p class="muted"><small>${esc(d.popolazione._nota)}</small></p></div>
      <div class="card"><h3>Modalità</h3>
        <p><b>Euristica (mock):</b> nessuna rete, deterministica: stesso annuncio e stesso seme danno gli stessi numeri. Gira anche nel browser su GitHub Pages.</p>
        <p><b>LLM:</b> con <code>node server.js</code> e <code>LLM_PROVIDER=anthropic</code> oppure <code>openai-compatible</code>, per ogni annuncio e segmento un campione di persone guarda il post (anche l'immagine) e risponde in JSON. L'LLM corregge il livello del segmento e scrive commenti e motivi; i numeri restano ancorati all'euristica.</p>
        <p><b>Ora:</b> ${esc($('#mode-badge').textContent)}</p>
      </div>
    </div>`;
}

init().catch((err) => {
  main.innerHTML = `<div class="card empty"><h2>Errore di avvio</h2><p>${esc(err.message)}</p></div>`;
});
