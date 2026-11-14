// Genera dati/griglia.json: la griglia esagonale di Napoli usata dallo strato 3D "Presenze per cella".
//
// Per ogni cella (esagono di raggio R metri) salva il VOLUME EDIFICATO (m³, somma di area × altezza
// degli edifici di OpenStreetMap il cui centro cade nella cella). Le celle in mare e quelle senza
// edifici non vengono salvate. Il volume edificato è il dato reale che distribuisce sul territorio
// le presenze di fondo (residenti e lavoratori) del modello: vedi src/griglia.js.
//
// Fonte: tessere vettoriali OpenFreeMap (schema OpenMapTiles, dati © OpenStreetMap, ODbL), zoom 14.
//
// Uso (una tantum, serve la rete; le due librerie NON sono dipendenze del progetto):
//   mkdir /tmp/gg && cd /tmp/gg && npm i @mapbox/vector-tile@1 pbf@3
//   NODE_USE_ENV_PROXY=1 node <repo>/c5-twinciro-3d/strumenti/genera-griglia.mjs [uscita.json]
// (le librerie vengono cercate nella cartella da cui si lancia lo script)

import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(path.join(process.cwd(), 'x.js'));
const { VectorTile } = require('@mapbox/vector-tile');
const Pbf = require('pbf');

const QUI = path.dirname(fileURLToPath(import.meta.url));
const USCITA = process.argv[2] || path.join(QUI, '..', 'dati', 'griglia.json');

// Parametri della griglia (gli stessi di src/griglia.js, che li rilegge dal file)
const ORIGINE = { lon: 14.2488, lat: 40.8359 }; // Piazza del Plebiscito
const R = 150; // raggio dell'esagono (centro → vertice), metri
const RIQUADRO = { o: 14.13, e: 14.34, s: 40.79, n: 40.905 };
const Z = 14;

const KX = 111_320 * Math.cos((ORIGINE.lat * Math.PI) / 180);
const KY = 110_540;
const inMetri = (lon, lat) => [(lon - ORIGINE.lon) * KX, (lat - ORIGINE.lat) * KY];
const inGradi = (x, y) => [ORIGINE.lon + x / KX, ORIGINE.lat + y / KY];

/** Coordinate assiali (q, r) della cella che contiene il punto (x, y) in metri; esagoni "a punta in su". */
function cella(x, y) {
  const qf = ((Math.sqrt(3) / 3) * x - y / 3) / R;
  const rf = ((2 / 3) * y) / R;
  let q = Math.round(qf), r = Math.round(rf);
  const s = Math.round(-qf - rf);
  const dq = Math.abs(q - qf), dr = Math.abs(r - rf), ds = Math.abs(s + qf + rf);
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  return [q, r];
}
const centro = (q, r) => [R * Math.sqrt(3) * (q + r / 2), R * 1.5 * r];

const tileX = (lon) => Math.floor(((lon + 180) / 360) * 2 ** Z);
const tileY = (lat) => {
  const f = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(f) + 1 / Math.cos(f)) / Math.PI) / 2) * 2 ** Z);
};

function dentroAnello(p, anello) {
  let dentro = false;
  for (let i = 0, j = anello.length - 1; i < anello.length; j = i++) {
    const [xi, yi] = anello[i], [xj, yj] = anello[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) dentro = !dentro;
  }
  return dentro;
}
const dentroPoligono = (p, poligono) => dentroAnello(p, poligono[0]) && !poligono.slice(1).some((buco) => dentroAnello(p, buco));
const poligoni = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []);

/** Area (m²) e centro di un anello in lon/lat. */
function areaCentro(anello) {
  let a = 0, cx = 0, cy = 0;
  const p = anello.map(([lon, lat]) => inMetri(lon, lat));
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const f = p[j][0] * p[i][1] - p[i][0] * p[j][1];
    a += f; cx += (p[j][0] + p[i][0]) * f; cy += (p[j][1] + p[i][1]) * f;
  }
  a /= 2;
  if (Math.abs(a) < 1e-6) return { area: 0, c: p[0] };
  return { area: Math.abs(a), c: [cx / (6 * a), cy / (6 * a)] };
}

const tilejson = await (await fetch('https://tiles.openfreemap.org/planet')).json();
const modello = tilejson.tiles[0];
console.log('tessere:', modello);

const x0 = tileX(RIQUADRO.o), x1 = tileX(RIQUADRO.e), y0 = tileY(RIQUADRO.n), y1 = tileY(RIQUADRO.s);
const elenco = [];
for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) elenco.push([x, y]);
console.log(`${elenco.length} tessere z${Z} (x ${x0}-${x1}, y ${y0}-${y1})`);

const acqua = new Map(); // "x/y" → [poligoni lon/lat]
const volume = new Map(); // "q,r" → m³
let edifici = 0;

async function scarica([x, y]) {
  const url = modello.replace('{z}', Z).replace('{x}', x).replace('{y}', y);
  for (let tentativo = 0; tentativo < 4; tentativo++) {
    try {
      const res = await fetch(url);
      if (res.status === 204 || res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    } catch (err) {
      if (tentativo === 3) throw new Error(`${url}: ${err.message}`);
      await new Promise((r) => setTimeout(r, 800 * (tentativo + 1)));
    }
  }
}

for (let i = 0; i < elenco.length; i += 6) {
  await Promise.all(
    elenco.slice(i, i + 6).map(async ([x, y]) => {
      const buf = await scarica([x, y]);
      if (!buf) return;
      const t = new VectorTile(new Pbf(buf));
      const w = t.layers.water;
      const lista = [];
      for (let k = 0; w && k < w.length; k++) lista.push(...poligoni(w.feature(k).toGeoJSON(x, y, Z).geometry));
      acqua.set(`${x}/${y}`, lista);
      const b = t.layers.building;
      for (let k = 0; b && k < b.length; k++) {
        const f = b.feature(k);
        const h = Number(f.properties.render_height) || 6;
        const hMin = Number(f.properties.render_min_height) || 0;
        for (const pol of poligoni(f.toGeoJSON(x, y, Z).geometry)) {
          const { area, c } = areaCentro(pol[0]);
          if (area < 12) continue;
          // gli edifici a cavallo di due tessere compaiono in entrambe: si conta solo dove cade il centro
          const [lon, lat] = inGradi(c[0], c[1]);
          if (tileX(lon) !== x || tileY(lat) !== y) continue;
          const [q, r] = cella(c[0], c[1]);
          volume.set(`${q},${r}`, (volume.get(`${q},${r}`) || 0) + area * Math.max(3, h - hMin));
          edifici++;
        }
      }
    }),
  );
  process.stdout.write(`\r${Math.min(i + 6, elenco.length)}/${elenco.length}`);
}
console.log(`\nedifici contati: ${edifici}, celle con edifici: ${volume.size}`);

const inMare = (lon, lat) => (acqua.get(`${tileX(lon)}/${tileY(lat)}`) || []).some((pol) => dentroPoligono([lon, lat], pol));

const celle = [];
let scartateMare = 0;
for (const [chiave, v] of volume) {
  const [q, r] = chiave.split(',').map(Number);
  const [x, y] = centro(q, r);
  const [lon, lat] = inGradi(x, y);
  if (lon < RIQUADRO.o || lon > RIQUADRO.e || lat < RIQUADRO.s || lat > RIQUADRO.n) continue;
  // cella con il centro in mare: resta solo se ha davvero edifici (moli, Castel dell'Ovo)
  if (inMare(lon, lat) && v < 15_000) { scartateMare++; continue; }
  if (v < 2_000) continue; // quasi vuota
  celle.push([q, r, Math.round(v / 1000)]); // migliaia di m³
}
celle.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
const totale = celle.reduce((s, c) => s + c[2], 0);
const out = {
  meta: {
    generato: new Date().toISOString(),
    script: 'c5-twinciro-3d/strumenti/genera-griglia.mjs',
    descrizione: 'Griglia esagonale di Napoli: per cella il volume edificato (migliaia di m³) dagli edifici di OpenStreetMap. Distribuisce sul territorio le presenze di fondo del modello (ipotesi dichiarata).',
    fonte: 'OpenFreeMap / OpenMapTiles, dati © OpenStreetMap contributors (ODbL)',
    edifici,
    volumeTotaleMigliaiaM3: totale,
  },
  origine: ORIGINE,
  raggio: R,
  celle,
};
fs.writeFileSync(USCITA, JSON.stringify(out));
console.log(`celle salvate: ${celle.length} (scartate in mare: ${scartateMare}); ${Math.round(fs.statSync(USCITA).size / 1024)} KB → ${USCITA}`);
