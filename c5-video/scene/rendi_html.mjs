// Rende una pagina HTML di scene/ in un video 1920×1080 a 30 fps, fotogramma per fotogramma.
// Il tempo è deterministico: per ogni fotogramma chiama window.imposta(t) (o, se manca, ferma tutte le
// animazioni CSS e le porta al tempo t), poi fa lo screenshot. Niente scatti, testo nitido.
//
//   node scene/rendi_html.mjs "chat.html?durata=50" uscita.mp4 [--durata 50] [--fps 30]
//   node scene/rendi_html.mjs "cartelli.html?id=testata-mappa" uscita.png --png [--t 5] [--trasparente]
//
// La pagina può esporre window.pronta (Promise, anche con {durata}) e window.imposta(t).
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const QUI = path.dirname(fileURLToPath(import.meta.url));

const arg = process.argv.slice(2);
const opz = (nome, def) => { const i = arg.indexOf(`--${nome}`); return i >= 0 ? arg[i + 1] : def; };
const [pagina, uscita] = arg;
if (!pagina || !uscita) {
  console.error('uso: node rendi_html.mjs <pagina?parametri> <uscita.mp4|.png> [--durata s] [--fps 30] [--png --t s --trasparente]');
  process.exit(2);
}
const PNG = arg.includes('--png');
const FPS = Number(opz('fps', 30));

// Server statico della cartella scene/ (fetch di chat.json, scaletta.json, stile.css)
const tipi = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const f = path.join(QUI, decodeURIComponent(req.url.split('?')[0]));
  if (!f.startsWith(QUI) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': tipi[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(f).pipe(res);
}).listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}/`;
const sep = pagina.includes('?') ? '&' : '?';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.error('[pagina]', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.error('[console]', m.text()); });
await page.goto(`${base}${pagina}${sep}fotogrammi=1`, { waitUntil: 'load' });
const info = await page.evaluate(async () => {
  const r = window.pronta ? await window.pronta : null;
  await document.fonts.ready;
  return r || {};
});
const imposta = (t) => page.evaluate((tt) => {
  if (window.imposta) return window.imposta(tt);
  for (const a of document.getAnimations()) { a.pause(); a.currentTime = tt * 1000; }
}, t);

if (PNG) {
  await imposta(Number(opz('t', 30)));
  await page.screenshot({ path: uscita, omitBackground: arg.includes('--trasparente') });
  console.log(`PNG: ${uscita}`);
} else {
  const durata = Number(opz('durata', info.durata || 5));
  const n = Math.round(durata * FPS);
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-pix_fmt', 'yuv420p', '-r', String(FPS), uscita], { stdio: ['pipe', 'inherit', 'inherit'] });
  const inizio = Date.now();
  for (let i = 0; i < n; i++) {
    await imposta(i / FPS);
    const buf = await page.screenshot({ type: 'jpeg', quality: 93 });
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
    if (i % 150 === 0) process.stderr.write(`  ${pagina}: ${i}/${n} fotogrammi\r`);
  }
  ff.stdin.end();
  const codice = await new Promise((r) => ff.on('close', r));
  console.log(`Video: ${uscita} (${n} fotogrammi, ${durata.toFixed(1)} s, rendering ${((Date.now() - inizio) / 1000).toFixed(0)} s)`);
  if (codice !== 0) process.exitCode = 1;
}
await browser.close();
server.close();
