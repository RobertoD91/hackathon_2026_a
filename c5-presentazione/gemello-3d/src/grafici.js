// Grafici di TwinCIRO 3D: SVG e HTML scritti a mano, senza librerie.
// Regole seguite: un solo asse per grafico; il colore dei 4 livelli è uno stato e arriva sempre
// insieme alla sua etichetta (nel suggerimento e nella scheda); i testi usano i colori del testo,
// mai quelli delle serie; griglia e assi restano in secondo piano; ogni segno ha un suggerimento
// al passaggio del mouse (attributo data-tip, mostrato da app.js).

import { COLORI_LIVELLO, ETICHETTE_LIVELLO } from './luoghi3d.js';
import * as N from '../../../citta-api/fonti/normalizza.js';

const nf = new Intl.NumberFormat('it-IT');
const num = (n) => nf.format(Math.round(n));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const GIORNI_BREVI = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab'];

/** 'sab', 'dom'... del giorno locale di un istante. */
export function giornoBreve(ts) {
  const p = N.partiLocali(ts);
  return GIORNI_BREVI[new Date(Date.UTC(p.anno, p.mese - 1, p.giorno)).getUTCDay()];
}

/** Persone in forma corta: 850 · 2,7 mila · 45 mila. */
export function corto(n) {
  if (n >= 10_000) return `${Math.round(n / 1000)} mila`;
  if (n >= 1000) return `${(Math.round(n / 100) / 10).toString().replace('.', ',')} mila`;
  return num(n);
}

/**
 * Barre orarie di un luogo (stile "previsione a 12 ore" di Seoul): altezza = persone stimate,
 * colore = livello, linea tratteggiata = soglia "affollato".
 * @param {Array} serie    stime orarie (modello.serie)
 * @param {object} o       { capienza, adesso, selezionato, base (stime senza scenario, facoltative) }
 */
export function barrePrevisione(serie, { capienza, adesso, selezionato, base = null, larghezza = 344, altezza = 156 } = {}) {
  const m = { s: 14, d: 8, g: 22, sx: 34 };
  const w = larghezza - m.sx - m.d;
  const h = altezza - m.s - m.g;
  const massimo = Math.max(capienza * 1.12, ...serie.map((s) => s.persone), ...(base || []).map((s) => s.persone)) * 1.06;
  const y = (v) => m.s + h - (v / massimo) * h;
  const passo = w / serie.length;
  const lb = Math.max(3, passo - 2); // 2 px di fuga tra le barre
  const oraAdesso = Math.floor(adesso / 3_600_000) * 3_600_000;
  const oraSel = Math.floor(selezionato / 3_600_000) * 3_600_000;
  let barre = '';
  let assi = '';
  serie.forEach((s, i) => {
    const x = m.sx + i * passo + (passo - lb) / 2;
    const yy = y(s.persone);
    const hh = Math.max(1.5, m.s + h - yy);
    const passato = s.ts < oraAdesso;
    const sel = s.ts === oraSel;
    const r = Math.min(3.5, lb / 2, hh);
    const quando = `${giornoBreve(s.ts)} ${N.oraBreve(s.ts)}`;
    const tip = `${quando} · ${num(s.persone)} persone (${num(s.min)}–${num(s.max)}) · ${ETICHETTE_LIVELLO[s.livello]}${passato ? ' · già passato' : s.ts === oraAdesso ? ' · adesso' : ' · previsione'}`;
    // barra con la cima arrotondata e la base dritta sulla linea dello zero
    barre += `<path d="M${x.toFixed(1)},${(m.s + h).toFixed(1)}V${(yy + r).toFixed(1)}q0,${-r} ${r},${-r}h${(lb - 2 * r).toFixed(1)}q${r},0 ${r},${r}V${(m.s + h).toFixed(1)}z" fill="${COLORI_LIVELLO[s.livello]}" opacity="${passato ? 0.42 : 1}"/>`;
    if (sel) barre += `<rect x="${(x - 1.5).toFixed(1)}" y="${(yy - 2).toFixed(1)}" width="${(lb + 3).toFixed(1)}" height="${(hh + 2).toFixed(1)}" rx="4" fill="none" stroke="#ffffff" stroke-width="1.6"/>`;
    if (base?.[i] && Math.abs(base[i].persone - s.persone) > massimo * 0.01) {
      const yb = y(base[i].persone);
      barre += `<line x1="${(x - 1).toFixed(1)}" x2="${(x + lb + 1).toFixed(1)}" y1="${yb.toFixed(1)}" y2="${yb.toFixed(1)}" stroke="#e9eff9" stroke-width="1.6" stroke-dasharray="2 1.5"/>`;
    }
    barre += `<rect class="tocco" x="${(m.sx + i * passo).toFixed(1)}" y="${m.s}" width="${passo.toFixed(1)}" height="${h}" fill="transparent" data-ts="${s.ts}" data-tip="${esc(tip)}"/>`;
    const ora = N.partiLocali(s.ts).ora;
    if (ora % 3 === 0) assi += `<text x="${(x + lb / 2).toFixed(1)}" y="${altezza - 7}" text-anchor="middle">${ora === 0 ? giornoBreve(s.ts) : String(ora).padStart(2, '0')}</text>`;
    if (ora === 0 && i > 0) assi += `<line x1="${(m.sx + i * passo).toFixed(1)}" x2="${(m.sx + i * passo).toFixed(1)}" y1="${m.s}" y2="${m.s + h}" class="giorno"/>`;
  });
  const ys = y(capienza);
  const tacche = [0.5, 1].map((f) => capienza * f).filter((v) => v < massimo);
  const griglia = tacche.map((v) => `<line x1="${m.sx}" x2="${larghezza - m.d}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" class="${v === capienza ? 'soglia' : 'riga'}"/><text x="${m.sx - 5}" y="${(y(v) + 3.5).toFixed(1)}" text-anchor="end">${corto(v)}</text>`).join('');
  return `<svg class="grafico barre" viewBox="0 0 ${larghezza} ${altezza}" role="img" aria-label="Persone stimate ora per ora; la linea tratteggiata è la soglia affollato">
    ${griglia}
    <line x1="${m.sx}" x2="${larghezza - m.d}" y1="${m.s + h}" y2="${m.s + h}" class="zero"/>
    <text x="${larghezza - m.d}" y="${(ys - 4).toFixed(1)}" text-anchor="end" class="nota">soglia “affollato”</text>
    ${barre}${assi}
  </svg>`;
}

/** Barra della composizione (formato dei dati di rete mobile): una sola tinta dal chiaro allo scuro, con legenda. */
export const COLORI_COMPOSIZIONE = ['#b7d3f6', '#6da7ec', '#2a78d6', '#184f95'];
export function composizione(c) {
  const voci = [
    ['Residenti', c.residenti],
    ['Pendolari', c.pendolari],
    ['Turisti italiani', c.turistiItaliani],
    ['Turisti stranieri', c.turistiStranieri],
  ];
  const tot = voci.reduce((s, v) => s + v[1], 0) || 1;
  return `<div class="composizione">
    <div class="composizione-barra" role="img" aria-label="${esc(voci.map((v) => `${v[0]} ${Math.round((v[1] / tot) * 100)}%`).join(', '))}">
      ${voci.map((v, i) => `<span style="flex:${Math.max(0.5, (v[1] / tot) * 100).toFixed(1)};background:${COLORI_COMPOSIZIONE[i]}" data-tip="${esc(`${v[0]}: ${Math.round((v[1] / tot) * 100)}%`)}"></span>`).join('')}
    </div>
    <ul class="composizione-legenda">
      ${voci.map((v, i) => `<li><i style="background:${COLORI_COMPOSIZIONE[i]}"></i>${v[0]}<b>${Math.round((v[1] / tot) * 100)}%</b></li>`).join('')}
    </ul>
  </div>`;
}

/** Striscia di ore colorate per livello (sala operativa): una cella per ora, cliccabile. */
export function strisciaOre(serie, { selezionato } = {}) {
  const oraSel = Math.floor((selezionato ?? 0) / 3_600_000) * 3_600_000;
  return `<div class="striscia" style="grid-template-columns:repeat(${serie.length},1fr)">${serie
    .map((s) => `<span class="${s.ts === oraSel ? 'sel' : ''}" style="background:${COLORI_LIVELLO[s.livello]};opacity:${s.livello === 'tranquillo' ? 0.28 : s.livello === 'normale' ? 0.55 : 1}" data-ts="${s.ts}" data-zona="${s.zona}" data-tip="${esc(`${giornoBreve(s.ts)} ${N.oraBreve(s.ts)} · ${num(s.persone)} persone · ${ETICHETTE_LIVELLO[s.livello]}`)}"></span>`)
    .join('')}</div>`;
}

/**
 * Sfondo della linea del tempo: curva delle persone nei luoghi monitorati e, sopra, le ore in cui
 * almeno un luogo è oltre la soglia (più scuro = più luoghi).
 * @param {Array<{ts:number, totale:number, critici:number}>} punti   un punto per ora
 */
export function curvaTempo(punti, { da, a, adesso, larghezza = 1000, altezza = 54 } = {}) {
  const x = (ts) => ((ts - da) / (a - da)) * larghezza;
  const massimo = Math.max(...punti.map((p) => p.totale)) * 1.1 || 1;
  const y = (v) => altezza - 4 - (v / massimo) * (altezza - 16);
  const linea = punti.map((p, i) => `${i ? 'L' : 'M'}${x(p.ts).toFixed(1)},${y(p.totale).toFixed(1)}`).join('');
  const area = `${linea}L${x(punti[punti.length - 1].ts).toFixed(1)},${altezza}L${x(punti[0].ts).toFixed(1)},${altezza}z`;
  const passo = larghezza / Math.max(1, punti.length - 1);
  const critiche = punti
    .filter((p) => p.critici > 0)
    .map((p) => `<rect x="${(x(p.ts) - passo / 2).toFixed(1)}" y="0" width="${(passo + 0.5).toFixed(1)}" height="5" fill="${COLORI_LIVELLO.affollato}" opacity="${Math.min(1, 0.35 + p.critici * 0.2)}"/>`)
    .join('');
  let giorni = '';
  for (let t = N.inizioGiorno(N.giornoLocale(da)); t <= a; t += 86_400_000) {
    const g = N.inizioGiorno(N.giornoLocale(t + 3_600_000 * 3));
    if (g > da && g < a) giorni += `<line x1="${x(g).toFixed(1)}" x2="${x(g).toFixed(1)}" y1="5" y2="${altezza}" class="giorno"/>`;
  }
  return `<svg class="grafico curva" viewBox="0 0 ${larghezza} ${altezza}" preserveAspectRatio="none" aria-hidden="true">
    <path d="${area}" class="area"/><path d="${linea}" class="linea"/>
    ${giorni}${critiche}
    <line x1="${x(adesso).toFixed(1)}" x2="${x(adesso).toFixed(1)}" y1="0" y2="${altezza}" class="adesso"/>
  </svg>`;
}

export { esc, num };
