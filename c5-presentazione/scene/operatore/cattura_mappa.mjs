// Fotografa la mappa "Napoli in tempo reale" (c5-presentazione/mappa/) per la scena operatore.html:
// la dashboard come la vede l'operatore, in una situazione affollata.
//
// - Serve la radice della repo su 127.0.0.1 (come `python3 -m http.server`) e apre la mappa in modalità demo
//   (simulatore e agenti nel browser; folla e sensori SIMULATI, meteo, aria, trasporti, eventi e allerte VERI).
// - Preme i pulsanti degli scenari "Arrivo navi da crociera" e "Partita al Maradona" (pannello Scenari della
//   pagina) e aspetta che la folla salga, prima che la timeline della pagina porti l'ondata di calore.
// - Salva operatore/mappa.jpg (la pagina dall'alto fino alle decisioni degli agenti e alle notifiche) e
//   operatore/mappa.json (cosa c'era a schermo, ora della cattura e posizioni dei pannelli nell'immagine).
//
//   NODE_PATH=$(npm root -g) node c5-presentazione/scene/operatore/cattura_mappa.mjs [--uscita cartella] [--attesa 18]
import { createRequire } from 'node:module';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const QUI = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(QUI, '../../..');

const arg = process.argv.slice(2);
const opz = (nome, def) => { const i = arg.indexOf(`--${nome}`); return i >= 0 ? arg[i + 1] : def; };
const USCITA = path.resolve(opz('uscita', QUI));
const ATTESA = Number(opz('attesa', 18));          // secondi dopo i pulsanti degli scenari
const LARGHEZZA = Number(opz('larghezza', 1280));   // CSS px: testo più grande nel video che a 1920
const SCALA = 1920 / LARGHEZZA;                     // immagine larga 1920 px
const SCENARI = ['Arrivo navi da crociera', 'Partita al Maradona'];

// Server statico della radice della repo (solo lettura, niente file nascosti)
const tipi = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]);
  let f = path.join(REPO, rel);
  if (f.endsWith(path.sep)) f = path.join(f, 'index.html');
  if (!f.startsWith(REPO) || rel.split('/').some((p) => p.startsWith('.')) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
    res.writeHead(404); res.end(); return;
  }
  res.writeHead(200, { 'Content-Type': tipi[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(f).pipe(res);
}).listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
const url = `http://127.0.0.1:${server.address().port}/c5-presentazione/mappa/?demo=1`;

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: LARGHEZZA, height: Math.round(1080 / SCALA) }, deviceScaleFactor: SCALA,
  locale: 'it-IT', timezoneId: 'Europe/Rome',
});
const page = await context.newPage();
const errori = [];
page.on('pageerror', (e) => errori.push(e.message));
await page.goto(url, { waitUntil: 'networkidle', timeout: 90_000 }).catch((e) => console.error('goto:', e.message));
await page.waitForFunction(() => document.querySelectorAll('.kpi').length >= 6, null, { timeout: 30_000 });
await page.waitForTimeout(1500);
// niente barre di scorrimento nell'immagine
await page.addStyleTag({ content: 'html{scrollbar-width:none} ::-webkit-scrollbar{display:none}' });

for (const nome of SCENARI) {
  const b = page.locator('.scenario-btn', { hasText: nome }).first();
  if (!(await b.count())) throw new Error(`pulsante dello scenario non trovato: ${nome}`);
  await b.click();
}
const premuti = new Date();
await page.waitForTimeout(ATTESA * 1000);
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(400);

const info = await page.evaluate(() => {
  const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { y: Math.round(b.top + scrollY), h: Math.round(b.height), x: Math.round(b.left), w: Math.round(b.width) }; };
  const testo = (el) => (el ? el.innerText.replace(/\s*\n\s*/g, ' · ').trim() : null);
  const pannello = (id) => document.getElementById(id)?.closest('section');
  return {
    ora_simulata: document.getElementById('clock')?.textContent,
    velocita: document.getElementById('speed')?.textContent,
    modo: document.getElementById('mode')?.textContent,
    kpi: [...document.querySelectorAll('.kpi')].map((k) => ({
      nome: k.querySelector('.kpi-label')?.textContent.trim(), valore: k.querySelector('.kpi-value')?.innerText.replace(/\s+/g, ' ').trim(),
      agente: k.querySelector('.kpi-meta span')?.textContent.trim() })),
    allerta: document.getElementById('nf-allerta')?.hidden ? null : testo(document.getElementById('nf-allerta')),
    scenari_attivi: [...document.querySelectorAll('#active-scenarios .chip')].map((c) => c.textContent.replace(/^●\s*/, '').trim()),
    legenda: [...document.querySelectorAll('#citymap .cm-legend li')].map(testo).filter(Boolean),
    decisioni: [...document.querySelectorAll('#decisions li.decision')].slice(0, 8).map(testo),
    notifiche: [...document.querySelectorAll('#notifications li.note')].slice(0, 6).map(testo),
    // posizioni in px CSS dall'alto della pagina
    pos: {
      testata: r(document.querySelector('header.top')), kpi: r(document.getElementById('kpis')), allerta: r(document.getElementById('nf-allerta')),
      mappa: r(document.getElementById('citymap')), legenda: r(document.getElementById('cm-legend')), oggi: r(document.getElementById('oggi')),
      decisioni: r(pannello('decisions')), notifiche: r(pannello('notifications')), scenari: r(pannello('scenario-buttons')),
    },
    altezza_pagina: document.documentElement.scrollHeight,
  };
});
// Dall'alto dei KPI (la testata della pagina non serve alla scena) al fondo di decisioni e notifiche
const inizio = Math.max(0, info.pos.kpi.y - 12);
const fine = Math.max(info.pos.decisioni.y + info.pos.decisioni.h, info.pos.notifiche.y + info.pos.notifiche.h) + 24;
fs.mkdirSync(USCITA, { recursive: true });
await page.screenshot({ path: path.join(USCITA, 'mappa.jpg'), type: 'jpeg', quality: 80, fullPage: true,
  clip: { x: 0, y: inizio, width: LARGHEZZA, height: fine - inizio } });
const caldo = info.decisioni.filter((d) => /caldo/i.test(d)).length;
const meta = {
  catturato_il: new Date().toISOString(),
  ora_locale: new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', dateStyle: 'full', timeStyle: 'short' }).format(premuti),
  come: `scene/operatore/cattura_mappa.mjs: pagina c5-presentazione/mappa/?demo=1 servita in locale, viewport ${LARGHEZZA} px CSS × ${SCALA.toFixed(2)}; ` +
    `pulsanti degli scenari ${SCENARI.map((s) => `"${s}"`).join(' e ')}, foto dopo ${ATTESA} s.`,
  nota: 'Folla, sensori, decisioni e notifiche sono della SIMULAZIONE della mappa (modalità demo, agenti nel browser, ' +
    'notifiche WhatsApp simulate); meteo, aria, trasporti, eventi e allerte sono dati veri letti dalla pagina. ' +
    'Gli orari delle decisioni nella pagina sono quelli reali della cattura, l\'ora in alto è quella simulata.',
  url_pubblico: 'https://robertodisanto.it/hackathon_2026_a/c5-presentazione/mappa/',
  // l'immagine parte dal punto "origine" della pagina (px CSS): posizione nell'immagine = (pos − origine) × scala
  immagine: { file: 'mappa.jpg', larghezza: 1920, altezza: Math.round((fine - inizio) * SCALA), scala: SCALA, origine: inizio,
    larghezza_css: LARGHEZZA },
  ...info,
  errori_pagina: errori,
};
fs.writeFileSync(path.join(USCITA, 'mappa.json'), JSON.stringify(meta, null, 2) + '\n');
console.log(`mappa.jpg (${(fs.statSync(path.join(USCITA, 'mappa.jpg')).size / 1024).toFixed(0)} KB, 1920×${meta.immagine.altezza}) · ` +
  `ora simulata ${info.ora_simulata} · ${info.kpi.map((k) => `${k.nome}: ${k.valore}`).slice(0, 2).join(' · ')}` +
  (caldo ? ` · ATTENZIONE: ${caldo} decisioni sul caldo, riduci --attesa` : ''));
if (errori.length) console.error('errori della pagina:', errori);
await browser.close();
server.close();
