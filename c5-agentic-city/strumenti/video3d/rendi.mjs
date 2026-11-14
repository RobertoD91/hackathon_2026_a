// Rende i fotogrammi del video 3D con Chromium headless (WebGL software) e deck.gl.
//   node strumenti/video3d/rendi.mjs <cartella_lavoro> <fotogrammi.ndjson> <cartella_fotogrammi> [--prova N]
// La cartella di lavoro contiene pagina.html, scena.json e lib/deck.min.js.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import readline from 'node:readline';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [lavoro, fileFotogrammi, uscita] = process.argv.slice(2);
const iProva = process.argv.indexOf('--prova');
const limite = iProva > 0 ? Number(process.argv[iProva + 1]) : Infinity;
fs.mkdirSync(uscita, { recursive: true });

const tipi = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const f = path.join(lavoro, decodeURIComponent(req.url.split('?')[0]));
  if (!f.startsWith(path.resolve(lavoro)) || !fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': tipi[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
}).listen(0);
const porta = server.address().port;

const fumo = (x) => x * x * (3 - 2 * x); // smoothstep
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.on('console', (m) => { if (m.type() === 'error') console.error('[pagina]', m.text()); });
await page.goto(`http://localhost:${porta}/pagina.html`);
await page.evaluate(() => window.prepara());

const righe = fs.readFileSync(fileFotogrammi, 'utf8').trim().split('\n');
const meta = JSON.parse(fs.readFileSync(fileFotogrammi + '.meta.json', 'utf8'));
const fotogrammi = righe.slice(0, Math.min(righe.length, limite));
const n = fotogrammi.length;
const intro = meta.intro_fotogrammi ?? 120, outro = meta.outro_fotogrammi ?? 150;
let i = 0;
const inizio = Date.now();

// Camera: arrivo dall'alto e da lontano, poi orbita lenta attorno al lungomare, alla fine si allarga.
function camera(k, N) {
  const p = k / Math.max(1, N - 1);
  const arrivo = fumo(Math.min(1, p / 0.12));
  const fine = fumo(Math.max(0, (p - 0.88) / 0.12));
  return {
    longitude: 14.2395 + 0.003 * Math.sin(p * Math.PI * 2),
    latitude: 40.8312 + 0.0015 * Math.cos(p * Math.PI * 2),
    zoom: 13.6 + 1.25 * arrivo - 0.55 * fine,
    pitch: 20 + 42 * arrivo - 10 * fine,
    bearing: -25 + 200 * p,
  };
}

const iCampioni = process.argv.indexOf('--campioni');
const indici = iCampioni > 0 ? process.argv[iCampioni + 1].split(',').map(Number) : [...Array(n).keys()];
for (const k of indici) {
  const f = JSON.parse(fotogrammi[k]);
  let cartello = null;
  if (k < intro) {
    const a = 1 - fumo(Math.max(0, (k - intro * 0.55) / (intro * 0.45)));
    cartello = { opacita: 0.75 * a, html: `<div style="opacity:${a}"><h1>NAPOLI 2027</h1><p>America's Cup davanti a via Caracciolo · ${meta.inizio}–${meta.fine}</p><p>Il traffico che vedi è quello della città guidata dagli agenti</p></div>` };
  } else if (k >= n - outro) {
    const a = fumo(Math.min(1, (k - (n - outro)) / (outro * 0.4)));
    cartello = { opacita: 0.7 * a, html: `<div style="opacity:${a}"><p>Durante la regata, con gli agenti</p><p class="grande">${meta.finale}</p><p>Media su 4 giornate simulate diverse: −9% ore in coda · gemello SUMO su strade OpenStreetMap</p></div>` };
  }
  await page.evaluate(([f, cam, c]) => window.disegna(f, cam, c), [f, camera(k, n), cartello]);
  await page.screenshot({ path: path.join(uscita, `f_${String(k).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 90 });
  if (k % 50 === 0) console.log(`${k}/${n} · ${f.ora} · ${((Date.now() - inizio) / 1000).toFixed(0)}s`);
}
await browser.close();
server.close();
console.log(`fatto: ${n} fotogrammi`);
