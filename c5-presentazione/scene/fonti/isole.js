// Le fonti di TwinCIRO come "isole": dati e posizioni comuni alle scene motivazione.html e fonti.html.
// Tutto viene da fonti/catalogo.json (righe di docs/fonti-dati-napoli.md): nessun nome o numero scritto a mano.
// Le posizioni sparse dipendono solo da un seme, quindi le due scene partono dalla stessa disposizione.

export const W = 1920;
export const H = 1080;
export const FONDO_LIBERO = 950;          // sotto restano liberi i 130 px dei sottotitoli

export const fumo = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : 1 - Math.pow(1 - x, 3));            // uscita morbida
export const curva = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const tra = (t, a, b) => clamp((t - a) / (b - a), 0, 1);
export const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// Generatore pseudo-casuale con seme (mulberry32): stesse posizioni a ogni fotogramma e in ogni scena
export function casuale(seme) {
  let a = seme >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export async function carica() {
  const cat = await (await fetch('fonti/catalogo.json', { cache: 'no-store' })).json();
  const pubbliche = cat.fonti.filter((f) => f.pubblica);
  const ordine = cat.domini.map((d) => d.id);
  pubbliche.sort((a, b) => ordine.indexOf(a.dominio) - ordine.indexOf(b.dominio));   // stabile: resta l'ordine del catalogo
  return {
    cat,
    fonti: pubbliche,
    domini: cat.domini,
    confermate: pubbliche.filter((f) => f.funziona).length,
    daRiprovare: pubbliche.filter((f) => !f.funziona).length,
    mancante: cat.fonti.find((f) => f.id === 'presenze-rete-mobile'),
  };
}

// Colore del cartellino per formato (sfondo; il testo è sempre scuro)
const COLORI = {
  JSON: '#38d6f0', GeoJSON: '#2dd4bf', CSV: '#4ade80', TSV: '#a3e635', XLSX: '#86efac', Parquet: '#a78bfa',
  GTFS: '#f472b6', 'GTFS-RT': '#fb7185', NeTEx: '#e879f9', SIRI: '#f0abfc', PDF: '#ff7a7a', RSS: '#fb923c',
  CAP: '#fbbf24', SDMX: '#facc15', Shapefile: '#c4b5fd', GeoTIFF: '#93c5fd', ArcGIS: '#60a5fa', SPARQL: '#f9a8d4',
  WebSocket: '#fdba74',
};
export const coloreFormato = (f) => COLORI[f] || '#cbd5e1';

export const CSS = `
  .isola { position: absolute; left: 0; top: 0; width: 0; height: 0; will-change: transform, opacity; }
  .isola .corpo { position: absolute; left: -32px; top: -32px; height: 64px; width: 64px; border-radius: 32px;
    background: rgb(22 33 59 / 0.96); border: 1.5px solid #2b3b66; box-shadow: 0 10px 26px rgb(0 0 0 / 0.35); }
  .isola .logo { position: absolute; left: -32px; top: -32px; width: 64px; height: 64px; border-radius: 50%;
    background: #fff; display: grid; place-items: center; box-shadow: 0 6px 18px rgb(0 0 0 / 0.35), 0 0 0 2px rgb(255 255 255 / 0.10); }
  .isola .logo.scuro { background: #0f1830; }
  .isola .logo img { width: 46px; height: 46px; object-fit: contain; display: block; }
  .isola .nome { position: absolute; top: -26px; height: 52px; display: flex; align-items: center;
    font-size: 18px; line-height: 1.12; font-weight: 650; color: #eef2fb; letter-spacing: -0.005em; }
  .isola .nome span { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .isola .formato { position: absolute; left: 0; top: 40px; transform: translateX(-50%); white-space: nowrap;
    font: 700 16px/1 'DejaVu Sans Mono', monospace; color: #0a1020; padding: 4px 8px 3px; border-radius: 7px;
    box-shadow: 0 4px 12px rgb(0 0 0 / 0.35); }
  .isola.testo .formato { top: 34px; }
`;

// Colonne del muro (fonti.html): a sinistra meteo e territorio, a destra mobilità ed eventi (27 e 29 fonti, stessa altezza).
// Anche nella disposizione sparsa le fonti di ogni colonna stanno dalla loro metà dello schermo: quando convergono
// nessuna attraversa il centro, dove compare TwinCIRO.
export const COLONNE = [['meteo', 'territorio'], ['mobilita', 'eventi']];
export const lato = (f) => (COLONNE[0].includes(f.dominio) ? 0 : 1);

// Misure della pillola nel muro (fonti.html)
export const PILL = { w: 203, h: 52, logo: 40, gx: 10, gy: 10 };

// Crea l'elemento di una fonte. Senza icona è un cartellino di testo (solo il nome), come chiede il catalogo.
export function creaIsola(f) {
  const el = document.createElement('div');
  el.className = 'isola' + (f.icona ? '' : ' testo');
  el.dataset.dominio = f.dominio;
  const formato = f.formati[0] || '';
  el.innerHTML = `<div class="corpo"></div>${f.icona ? `<div class="logo${f.icona_sfondo === 'scuro' ? ' scuro' : ''}"><img src="fonti/${esc(f.icona)}" alt=""></div>` : ''}`
    + `<div class="nome"><span>${esc(f.nome)}</span></div>`
    + (formato ? `<div class="formato" style="background:${coloreFormato(formato)}">${esc(formato)}</div>` : '');
  el._corpo = el.querySelector('.corpo');
  el._logo = el.querySelector('.logo');
  el._nome = el.querySelector('.nome');
  el._formato = el.querySelector('.formato');
  return el;
}

const lerp = (a, b, u) => a + (b - a) * u;

// Punto di aggancio dell'isola dentro la pillola del muro: il centro del logo, o il centro della pillola senza icona
export const aggancio = (el, posto) => (el._logo
  ? { x: posto.x + PILL.h / 2, y: posto.y + posto.h / 2 }
  : { x: posto.x + posto.w / 2, y: posto.y + posto.h / 2 });

// Mette un'isola nello stato richiesto. u: 0 = isola (tondo col logo), 1 = pillola del muro (logo e nome);
// le fonti senza icona restano un cartellino col nome. o: opacità, of: opacità del cartellino del formato.
export function disponi(el, { x, y, r = 0, s = 1, u = 0, o = 1, of = 1, filtro = '', larghezza = PILL.w }) {
  el.style.transform = `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px) rotate(${r.toFixed(3)}deg) scale(${s.toFixed(4)})`;
  el.style.opacity = o.toFixed(3);
  el.style.filter = filtro;
  const c = el._corpo.style, n = el._nome.style;
  if (el._logo) {
    const meta = lerp(32, PILL.h / 2, u);
    c.left = `${-meta}px`; c.top = `${-meta}px`;
    c.width = `${lerp(64, larghezza, u)}px`; c.height = `${2 * meta}px`;
    c.borderRadius = `${lerp(32, 14, u)}px`;
    el._logo.style.transform = `scale(${lerp(1, PILL.logo / 64, u).toFixed(4)})`;
    n.left = `${PILL.logo / 2 + 10}px`; n.width = `${larghezza - PILL.h / 2 - PILL.logo / 2 - 18}px`;
    n.opacity = tra(u, 0.5, 1).toFixed(3);
    n.transform = `translateX(${((1 - tra(u, 0.5, 1)) * -10).toFixed(2)}px)`;
  } else {
    c.left = `${-larghezza / 2}px`; c.top = `${-PILL.h / 2}px`; c.width = `${larghezza}px`; c.height = `${PILL.h}px`;
    c.borderRadius = '14px';
    n.left = `${-larghezza / 2 + 14}px`; n.width = `${larghezza - 28}px`; n.opacity = '1';
  }
  if (el._formato) el._formato.style.opacity = of.toFixed(3);
}

// Disposizione sparsa: griglia larga con righe sfalsate, scarti casuali, poi le isole si allontanano finché non si toccano.
// Restituisce, per ogni fonte, il centro (x, y), la rotazione r (gradi), la scala s e la fase dell'ondeggiamento.
export function sparse(fonti, { seme = 20261114, x0 = 70, x1 = 1850, y0 = 215, y1 = 862 } = {}) {
  const rnd = casuale(seme);
  const n = fonti.length;
  const colonne = Math.max(4, Math.round(Math.sqrt(n * (x1 - x0) / (y1 - y0) * 1.05)));
  const righe = Math.ceil(n / colonne) + 1;
  const cw = (x1 - x0) / colonne;
  const ch = (y1 - y0) / (righe - 1);
  const celle = [[], []];
  for (let r = 0; r < righe; r++) for (let c = 0; c < colonne; c++) {
    const x = x0 + cw * (c + 0.5) + (r % 2 ? cw * 0.28 : -cw * 0.12);
    celle[x < W / 2 ? 0 : 1].push({ x, y: y0 + ch * r });
  }
  // celle in ordine casuale dentro ogni metà: le isole dello stesso dominio finiscono lontane tra loro
  for (const metà of celle) for (let i = metà.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [metà[i], metà[j]] = [metà[j], metà[i]]; }
  const usate = [0, 0];
  const pos = fonti.map((f) => {
    const l = celle[lato(f)].length > usate[lato(f)] ? lato(f) : 1 - lato(f);
    const c = celle[l][usate[l]++];
    const s = 0.84 + rnd() * 0.3;
    const testo = !f.icona;
    const w = (testo ? PILL.w : 72) * s + 26;
    const h = (testo ? PILL.h : 64) * s + 40;
    return {
      x: c.x + (rnd() - 0.5) * cw * 0.55, y: c.y + (rnd() - 0.5) * ch * 0.35,
      r: (rnd() - 0.5) * (testo ? 8 : 14), s, w, h, fase: rnd() * Math.PI * 2, periodo: 2.6 + rnd() * 1.6,
      lontana: rnd() < 0.25,
    };
  });
  // rilassamento: separa le isole che si sovrappongono (rettangoli con margine), restando nell'area
  for (let giro = 0; giro < 160; giro++) {
    let mosse = 0;
    for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) {
      const A = pos[a], B = pos[b];
      const dx = B.x - A.x, dy = B.y - A.y;
      const ox = (A.w + B.w) / 2 - Math.abs(dx), oy = (A.h + B.h) / 2 - Math.abs(dy);
      if (ox > 0 && oy > 0) {
        mosse++;
        if (ox / (A.w + B.w) < oy / (A.h + B.h)) { const m = (ox / 2 + 0.5) * Math.sign(dx || 1); A.x -= m; B.x += m; }
        else { const m = (oy / 2 + 0.5) * Math.sign(dy || 1); A.y -= m; B.y += m; }
      }
    }
    for (const p of pos) {
      p.x = clamp(p.x, x0 + p.w / 2 - 40, x1 - p.w / 2 + 40);
      p.y = clamp(p.y, y0 - 10, y1);
    }
    if (!mosse) break;
  }
  return pos;
}

// Muro per dominio, nelle due colonne di COLONNE, con TwinCIRO al centro.
export function muro(fonti, { sinistra = [40, 670], destra = [1250, 1880], y0 = 30, y1 = 930, perRiga = 3 } = {}) {
  const colonne = [{ x: sinistra, domini: COLONNE[0] }, { x: destra, domini: COLONNE[1] }];
  const posti = new Map();
  const blocchi = [];
  const testata = 50, spazio = 30;
  for (const col of colonne) {
    const gruppi = col.domini.map((d) => fonti.filter((f) => f.dominio === d));
    const alt = gruppi.map((g) => testata + Math.ceil(g.length / perRiga) * (PILL.h + PILL.gy) - PILL.gy);
    let y = y0 + ((y1 - y0) - (alt.reduce((s, a) => s + a, 0) + spazio * (gruppi.length - 1))) / 2;
    const larg = col.x[1] - col.x[0];
    const pw = (larg - PILL.gx * (perRiga - 1)) / perRiga;
    gruppi.forEach((g, k) => {
      blocchi.push({ dominio: col.domini[k], x: col.x[0], y, w: larg, h: alt[k], n: g.length });
      g.forEach((f, i) => {
        const c = i % perRiga, r = Math.floor(i / perRiga);
        posti.set(f.id, { x: col.x[0] + c * (pw + PILL.gx), y: y + testata + r * (PILL.h + PILL.gy), w: pw, h: PILL.h });
      });
      y += alt[k] + spazio;
    });
  }
  return { posti, blocchi };
}

// Attende che le icone siano caricate e decodificate (il renderer fa lo screenshot subito)
export async function attendiImmagini(radice) {
  await Promise.all([...radice.querySelectorAll('img')].map((im) => (im.complete ? Promise.resolve() : new Promise((r) => { im.onload = im.onerror = r; }))
    .then(() => im.decode?.().catch(() => {}))));
}

// Anteprima nel browser (senza renderer): la scena parte da sola e ricomincia
export function anteprima(imposta, durata) {
  if (new URLSearchParams(location.search).has('fotogrammi')) return;
  const t0 = performance.now();
  const giro = () => { imposta(((performance.now() - t0) / 1000) % (durata + 1.5)); requestAnimationFrame(giro); };
  giro();
}

// Porta le animazioni CSS (classi .a .f .c di stile.css) al tempo t, come fa il renderer quando manca window.imposta
export function fermaCss(t) {
  for (const a of document.getAnimations()) { a.pause(); a.currentTime = t * 1000; }
}
