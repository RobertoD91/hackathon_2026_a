// Server statico per provare TwinCIRO 3D in locale: serve la radice della repo (come GitHub Pages),
// perché la pagina importa i moduli e gli snapshot dell'API dati città (citta-api/fonti/, citta-api/dati/).
//   node c5-presentazione/gemello-3d/server.js [porta]      → http://localhost:8705/c5-presentazione/gemello-3d/
// Nessuna dipendenza. In produzione basta GitHub Pages: non c'è backend.
// Non serve i file e le cartelle nascosti (.git, .env...) né le cartelle segreti/, che Pages non pubblica.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RADICE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PAGINA = '/c5-presentazione/gemello-3d/';
const PORTA = Number(process.argv[2] || process.env.PORT || 8705);
const TIPI = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.mp4': 'video/mp4', '.ico': 'image/x-icon' };

http
  .createServer((req, res) => {
    let percorso;
    try {
      percorso = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    } catch {
      res.writeHead(400).end();
      return;
    }
    if (percorso === '/') {
      res.writeHead(302, { location: PAGINA }).end();
      return;
    }
    let file = path.join(RADICE, percorso);
    const relativo = path.relative(RADICE, file);
    if (relativo.startsWith('..') || path.isAbsolute(relativo) || relativo.split(path.sep).some((p) => p.startsWith('.') || p === 'segreti')) {
      res.writeHead(403).end();
      return;
    }
    fs.stat(file, (err, st) => {
      if (!err && st.isDirectory()) {
        if (!percorso.endsWith('/')) {
          res.writeHead(302, { location: `${percorso}/` }).end();
          return;
        }
        file = path.join(file, 'index.html');
      }
      fs.readFile(file, (e, dati) => {
        if (e) {
          res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Non trovato');
          return;
        }
        res.writeHead(200, { 'content-type': TIPI[path.extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-cache' }).end(dati);
      });
    });
  })
  .listen(PORTA, () => console.log(`TwinCIRO 3D: http://localhost:${PORTA}${PAGINA}`));
