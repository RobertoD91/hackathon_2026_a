// Registra la mappa "Napoli in tempo reale" (shared/iot-agents/example) con dati veri:
// ricerca di Castel dell'Ovo e scheda del luogo, modalità Meteo e Aria con le centraline ARPAC,
// livello metro/funicolari, poi il pannello "Oggi a Napoli" con gli eventi reali.
//
//   node scene/registra_mappa.mjs <url della mappa> <uscita.mp4> [secondi=24]
//
// Usa lo screencast di Chromium (CDP) a 1920×1080 con JPEG di qualità alta: più nitido di
// recordVideo di Playwright (VP8 a 1 Mbit/s). I fotogrammi arrivano solo quando la pagina cambia,
// quindi si rimontano a 30 fps costanti con le loro durate reali (concat di ffmpeg).
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const [url, uscita, secondiArg] = process.argv.slice(2);
if (!url || !uscita) {
  console.error('uso: node registra_mappa.mjs <url> <uscita.mp4> [secondi]');
  process.exit(2);
}
const SECONDI = Number(secondiArg || 24);
const cartella = `${uscita}.fotogrammi`;
fs.rmSync(cartella, { recursive: true, force: true });
fs.mkdirSync(cartella, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  // 1536×864 CSS × 1,25 = 1920×1080 fisici: testo più grande e nitido
  viewport: { width: 1536, height: 864 }, deviceScaleFactor: 1.25, locale: 'it-IT', timezoneId: 'Europe/Rome',
});
const page = await context.newPage();
page.on('pageerror', (e) => console.error('[pagina]', e.message));
await page.goto(url, { waitUntil: 'networkidle', timeout: 90_000 }).catch((e) => console.error('goto:', e.message));
await page.waitForTimeout(5000); // fonti live, tessere della mappa, primo giro del simulatore

// Video più pulito: niente barre di scorrimento; la pagina parte dal banner delle allerte, sopra la mappa.
// I primi 80 px CSS (96 px nel video) restano sotto la testata scura che il montaggio mette in alto.
await page.addStyleTag({ content: 'html{scrollbar-width:none} ::-webkit-scrollbar{display:none}' });
const y0 = await page.evaluate(() => {
  const el = document.querySelector('#nf-allerta:not([hidden])') || document.querySelector('#citymap');
  return Math.max(0, el.getBoundingClientRect().top + window.scrollY - 80);
});
await page.evaluate((y) => window.scrollTo(0, y), y0);
await page.waitForTimeout(800);

const cdp = await context.newCDPSession(page);
const fotogrammi = [];
cdp.on('Page.screencastFrame', async (f) => {
  fotogrammi.push({ ts: f.metadata.timestamp, data: f.data });
  try { await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }); } catch { /* chiuso */ }
});
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
const t0 = Date.now();
const finoA = async (s) => { const d = s * 1000 - (Date.now() - t0); if (d > 0) await page.waitForTimeout(d); };
const clic = async (sel) => {
  const el = page.locator(sel).first();
  if (await el.count()) await el.click({ timeout: 3000 }).catch((e) => console.error('clic', sel, e.message));
  else console.error('non trovato:', sel);
};

// 1. Cerco Castel dell'Ovo e apro la scheda (meteo, aria, stazioni vicine con i prossimi passaggi).
await finoA(1.2);
await clic('.cm-search input');
await page.keyboard.type("Castel dell'Ovo", { delay: 65 });
await finoA(3.2);
await page.keyboard.press('Enter');
// 2. Scorro la scheda del luogo.
await finoA(6.0);
await page.evaluate(() => document.querySelector('.cm-detail')?.scrollBy({ top: 260, behavior: 'smooth' }));
// 3. Allargo la vista e passo a Meteo, poi ad Aria con le centraline ARPAC.
await finoA(8.4);
await clic('.cm-detail [data-chiudi]');
await clic('.leaflet-control-zoom-out');
await page.waitForTimeout(450);
await clic('.leaflet-control-zoom-out');
await finoA(10.0);
await clic('.cm-modi button[data-modo="meteo"]');
await finoA(12.6);
await clic('.cm-modi button[data-modo="aria"]');
await page.waitForTimeout(500);
await clic('.cm-layers input[data-strato="centraline"]');
// 4. Scendo al pannello "Oggi a Napoli": eventi reali, prossimi giorni, avvisi e rischi.
await finoA(16.0);
await page.evaluate(() => {
  const el = document.querySelector('#oggi');
  window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 90, behavior: 'smooth' });
});
await finoA(SECONDI);
await cdp.send('Page.stopScreencast');
await browser.close();

// Rimontaggio a 30 fps costanti: ogni fotogramma dura fino al successivo.
if (fotogrammi.length < 2) {
  console.error('Troppi pochi fotogrammi dallo screencast');
  process.exit(1);
}
const righe = ['ffconcat version 1.0'];
fotogrammi.forEach((f, i) => {
  const nome = `f_${String(i).padStart(5, '0')}.jpg`;
  fs.writeFileSync(path.join(cartella, nome), Buffer.from(f.data, 'base64'));
  const durata = i + 1 < fotogrammi.length ? fotogrammi[i + 1].ts - f.ts : 0.5;
  righe.push(`file ${nome}`, `duration ${Math.max(0.001, durata).toFixed(4)}`);
});
righe.push(`file f_${String(fotogrammi.length - 1).padStart(5, '0')}.jpg`);
fs.writeFileSync(path.join(cartella, 'elenco.txt'), righe.join('\n') + '\n');
const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(cartella, 'elenco.txt'),
  '-vf', 'fps=30,scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,format=yuv420p',
  '-c:v', 'libx264', '-preset', 'medium', '-crf', '17', '-an', uscita], { stdio: 'inherit' });
fs.rmSync(cartella, { recursive: true, force: true });
console.log(`Mappa: ${fotogrammi.length} fotogrammi in ${(fotogrammi.at(-1).ts - fotogrammi[0].ts).toFixed(1)} s → ${uscita}`);
process.exit(r.status ?? 1);
