// Scena 3D di TwinCIRO 3D: MapLibre GL JS con rilievo (colline, Vesuvio), edifici estrusi di
// OpenStreetMap e gli strati dei dati, tutti in 3D:
//   - luoghi: colonne (altezza = persone stimate, colore = livello) con l'anello della soglia "affollato";
//   - celle:  esagoni estrusi delle presenze per cella (stile dati di rete mobile);
//   - linee di metro, funicolari e treni con le stazioni; flussi pedonali animati; percorsi; eventi.
// Base: tessere vettoriali OpenFreeMap (dati © OpenStreetMap), rilievo Mapzen Terrain Tiles su AWS.
// Nessuna chiave API. `maplibregl` è globale (script da cdnjs in index.html).

import { COLORI_LIVELLO, ETICHETTE_LIVELLO } from './luoghi3d.js';
import { SOGLIA_PRIVACY, livelloPressione } from './griglia.js';

const FONT = ['Noto Sans Regular'];
const FONT_B = ['Noto Sans Bold'];
const FONT_I = ['Noto Sans Italic'];
const TERRA = '#0b1424';

/** Viste predefinite della camera. */
export const VISTE = Object.freeze({
  golfo: { center: [14.2440, 40.8420], zoom: 13.05, pitch: 60, bearing: 14 },
  centro: { center: [14.2515, 40.8445], zoom: 14.35, pitch: 60, bearing: -24 },
  vesuvio: { center: [14.285, 40.838], zoom: 11.9, pitch: 76, bearing: 98 },
  alto: { center: [14.238, 40.842], zoom: 12.3, pitch: 0, bearing: 0 },
});

/** Stile scuro "notte sul golfo" sopra lo schema OpenMapTiles. */
function stile({ rilievo }) {
  const strada = (id, classi, colore, larghezze, extra = {}) => ({
    id, type: 'line', source: 'omt', 'source-layer': 'transportation',
    filter: ['all', ['in', ['get', 'class'], ['literal', classi]], ['!=', ['get', 'brunnel'], 'tunnel']],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': colore, 'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], ...larghezze] },
    ...extra,
  });
  return {
    version: 8,
    name: 'TwinCIRO notte',
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: {
      omt: { type: 'vector', url: 'https://tiles.openfreemap.org/planet', attribution: '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> Dati © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>' },
      ...(rilievo
        ? {
            dem: { type: 'raster-dem', tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'], encoding: 'terrarium', tileSize: 256, maxzoom: 13, attribution: 'Rilievo: <a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noopener">Terrain Tiles</a>' },
            ombre: { type: 'raster-dem', tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'], encoding: 'terrarium', tileSize: 256, maxzoom: 13 },
          }
        : {}),
    },
    // orizzonte più chiaro della terra: le colline e il Vesuvio si stagliano contro il cielo
    sky: { 'sky-color': '#0a1730', 'horizon-color': '#3a66a8', 'fog-color': '#13233f', 'fog-ground-blend': 0.8, 'horizon-fog-blend': 0.25, 'sky-horizon-blend': 0.55, 'atmosphere-blend': 0.5 },
    light: { anchor: 'viewport', color: '#dce8ff', intensity: 0.38, position: [1.25, 205, 38] },
    layers: [
      { id: 'sfondo', type: 'background', paint: { 'background-color': TERRA } },
      ...(rilievo ? [{ id: 'ombre', type: 'hillshade', source: 'ombre', paint: { 'hillshade-shadow-color': '#00030a', 'hillshade-highlight-color': '#4a6ea8', 'hillshade-accent-color': '#0b1424', 'hillshade-exaggeration': 0.85, 'hillshade-illumination-anchor': 'map', 'hillshade-illumination-direction': 315 } }] : []),
      { id: 'verde', type: 'fill', source: 'omt', 'source-layer': 'landcover', filter: ['in', ['get', 'class'], ['literal', ['wood', 'grass', 'farmland']]], paint: { 'fill-color': '#0d2127', 'fill-opacity': 0.55 } },
      { id: 'parchi', type: 'fill', source: 'omt', 'source-layer': 'park', paint: { 'fill-color': '#0e262b', 'fill-opacity': 0.6 } },
      { id: 'abitato', type: 'fill', source: 'omt', 'source-layer': 'landuse', filter: ['in', ['get', 'class'], ['literal', ['residential', 'commercial', 'retail', 'industrial']]], paint: { 'fill-color': '#0f1a2e', 'fill-opacity': 0.7 } },
      { id: 'mare', type: 'fill', source: 'omt', 'source-layer': 'water', paint: { 'fill-color': '#06203f' } },
      { id: 'corsi', type: 'line', source: 'omt', 'source-layer': 'waterway', paint: { 'line-color': '#0a2a50', 'line-width': 1 } },
      { id: 'piste', type: 'line', source: 'omt', 'source-layer': 'aeroway', filter: ['==', ['geometry-type'], 'LineString'], paint: { 'line-color': '#22324f', 'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 11, 1, 16, 26] } },
      strada('strade-minori', ['minor', 'service', 'track'], '#152238', [12.5, 0.3, 14, 1, 18, 8], { minzoom: 12.5 }),
      strada('strade-pedonali', ['path', 'pedestrian'], '#14243a', [14, 0.4, 18, 4], { minzoom: 14, paint: { 'line-color': '#14243a', 'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 14, 0.4, 18, 4], 'line-dasharray': [1.5, 1.5] } }),
      strada('strade-medie', ['tertiary', 'secondary'], '#1c2c48', [10, 0.3, 14, 2, 18, 13]),
      strada('strade-grandi', ['primary', 'trunk'], '#25395d', [8, 0.4, 14, 3, 18, 18]),
      strada('autostrade', ['motorway'], '#2f4773', [6, 0.5, 14, 3.6, 18, 22]),
      { id: 'gallerie', type: 'line', source: 'omt', 'source-layer': 'transportation', filter: ['all', ['==', ['get', 'brunnel'], 'tunnel'], ['in', ['get', 'class'], ['literal', ['motorway', 'trunk', 'primary', 'secondary']]]], paint: { 'line-color': '#1a2942', 'line-width': 1.4, 'line-dasharray': [2, 2] } },
      { id: 'binari', type: 'line', source: 'omt', 'source-layer': 'transportation', filter: ['in', ['get', 'class'], ['literal', ['rail', 'transit']]], paint: { 'line-color': '#22324e', 'line-width': 0.8, 'line-dasharray': [4, 3] } },
      { id: 'edifici-piatti', type: 'fill', source: 'omt', 'source-layer': 'building', minzoom: 12.5, maxzoom: 14, paint: { 'fill-color': '#16233a', 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 12.5, 0, 13.2, 0.9] } },
      {
        id: 'edifici', type: 'fill-extrusion', source: 'omt', 'source-layer': 'building', minzoom: 13.2,
        paint: {
          'fill-extrusion-color': ['interpolate', ['linear'], ['coalesce', ['get', 'render_height'], 8], 0, '#1a2840', 25, '#22334f', 60, '#2c4265', 120, '#3a5683'],
          'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 13.2, 0, 13.8, ['coalesce', ['get', 'render_height'], 8]],
          'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
          'fill-extrusion-opacity': 0.92,
          'fill-extrusion-vertical-gradient': true,
        },
      },
      { id: 'nomi-mare', type: 'symbol', source: 'omt', 'source-layer': 'water_name', filter: ['==', ['geometry-type'], 'Point'], layout: { 'text-field': ['coalesce', ['get', 'name:it'], ['get', 'name']], 'text-font': FONT_I, 'text-size': 12, 'text-letter-spacing': 0.15, 'text-max-width': 6 }, paint: { 'text-color': '#3f72b0', 'text-halo-color': '#06203f', 'text-halo-width': 1 } },
      { id: 'nomi-strade', type: 'symbol', source: 'omt', 'source-layer': 'transportation_name', minzoom: 15.2, layout: { 'symbol-placement': 'line', 'text-field': ['get', 'name'], 'text-font': FONT, 'text-size': 10.5 }, paint: { 'text-color': '#62779b', 'text-halo-color': TERRA, 'text-halo-width': 1.2 } },
      {
        id: 'nomi-quartieri', type: 'symbol', source: 'omt', 'source-layer': 'place', minzoom: 11.5,
        filter: ['in', ['get', 'class'], ['literal', ['suburb', 'quarter', 'neighbourhood', 'village', 'town', 'island']]],
        layout: { 'text-field': ['coalesce', ['get', 'name:it'], ['get', 'name']], 'text-font': FONT, 'text-size': ['interpolate', ['linear'], ['zoom'], 11.5, 9.5, 15, 12.5], 'text-transform': 'uppercase', 'text-letter-spacing': 0.12, 'text-max-width': 7 },
        paint: { 'text-color': '#6c82a6', 'text-halo-color': TERRA, 'text-halo-width': 1.2 },
      },
      { id: 'nomi-citta', type: 'symbol', source: 'omt', 'source-layer': 'place', maxzoom: 12, filter: ['==', ['get', 'class'], 'city'], layout: { 'text-field': ['coalesce', ['get', 'name:it'], ['get', 'name']], 'text-font': FONT_B, 'text-size': 16 }, paint: { 'text-color': '#c6d4ea', 'text-halo-color': TERRA, 'text-halo-width': 1.5 } },
      { id: 'vette', type: 'symbol', source: 'omt', 'source-layer': 'mountain_peak', filter: ['>=', ['coalesce', ['get', 'ele'], 0], 400], layout: { 'text-field': ['concat', ['coalesce', ['get', 'name:it'], ['get', 'name']], '\n', ['to-string', ['get', 'ele']], ' m'], 'text-font': FONT_I, 'text-size': 11 }, paint: { 'text-color': '#93a7c8', 'text-halo-color': TERRA, 'text-halo-width': 1.2 } },
    ],
  };
}

const metriPerPixel = (zoom, lat = 40.84) => (156_543.03 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
const limita = (v, a, b) => Math.min(b, Math.max(a, v));

function cerchio(lon, lat, raggio, n = 28) {
  const kx = 111_320 * Math.cos((lat * Math.PI) / 180);
  const out = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * 2 * Math.PI;
    out.push([lon + (raggio * Math.cos(a)) / kx, lat + (raggio * Math.sin(a)) / 110_540]);
  }
  return out;
}

/** Curva morbida tra due punti (per i flussi): [[lon, lat], ...]. */
function arco(a, b, piega = 0.3, n = 24) {
  const mx = (a.lon + b.lon) / 2, my = (a.lat + b.lat) / 2;
  const dx = b.lon - a.lon, dy = b.lat - a.lat;
  const cx = mx - dy * piega, cy = my + dx * piega;
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    out.push([(1 - t) ** 2 * a.lon + 2 * (1 - t) * t * cx + t * t * b.lon, (1 - t) ** 2 * a.lat + 2 * (1 - t) * t * cy + t * t * b.lat]);
  }
  return out;
}

const vuoto = () => ({ type: 'FeatureCollection', features: [] });

/**
 * Crea la scena.
 * @param {HTMLElement} contenitore
 * @param {object} cfg { luoghi, trasporti, griglia, rilievo, animazioni, vista, catturabile }
 */
export function creaMappa(contenitore, cfg) {
  const { luoghi } = cfg;
  const rilievo = cfg.rilievo !== false;
  const animazioni = cfg.animazioni !== false;
  const ascoltatori = { luogo: [], sfondo: [], stazione: [], pronta: [], orbita: [] };
  const emetti = (nome, ...arg) => ascoltatori[nome].forEach((f) => f(...arg));

  const map = new maplibregl.Map({
    container: contenitore,
    style: stile({ rilievo }),
    ...(VISTE[cfg.vista] || VISTE.golfo),
    minZoom: 10.2,
    maxZoom: 17.5,
    maxPitch: 80,
    maxBounds: [[13.75, 40.55], [14.85, 41.1]],
    attributionControl: { compact: true },
    canvasContextAttributes: { antialias: true, preserveDrawingBuffer: Boolean(cfg.catturabile) },
  });
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');
  map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-right');

  const stato = {
    quadro: null,
    selezionata: null,
    evidenziate: new Set(),
    vista: 'luoghi',
    strati: { trasporti: true, flussi: true, eventi: true, edifici: true },
    flussi: [],
    percorso: null,
    marcatori: { eventi: [], percorso: [] },
    pronta: false,
    orbita: false,
  };

  // ------------------------------------------------------------------ sorgenti e strati dei dati

  function geoLuoghi() {
    const q = stato.quadro;
    const mpp = metriPerPixel(limita(map.getZoom(), 11, 16.5));
    const raggio = 6.5 * mpp;
    const colonne = [], anelli = [], punti = [];
    for (const [zona, l] of Object.entries(luoghi)) {
      const s = q?.[zona];
      const persone = s?.persone ?? 0;
      const scala = 1.05 * mpp;
      const h = Math.sqrt(persone) * scala;
      const hSoglia = Math.sqrt(l.capienza) * scala;
      const colore = COLORI_LIVELLO[s?.livello ?? 'tranquillo'];
      const sel = stato.selezionata === zona;
      const props = { zona, nome: l.breve || l.nome, persone, livello: s?.livello ?? 'tranquillo', etichetta: s ? `${formatoMigliaia(persone)} · ${ETICHETTE_LIVELLO[s.livello]}` : '', colore, quota: s?.quota ?? 0, sel, evid: stato.evidenziate.has(zona) };
      colonne.push({ type: 'Feature', properties: { ...props, h, base: 0 }, geometry: { type: 'Polygon', coordinates: [cerchio(l.lon, l.lat, raggio * (sel ? 1.25 : 1))] } });
      // anello della soglia "affollato": un disco sottile sospeso all'altezza della capienza
      if (sel) anelli.push({ type: 'Feature', properties: { zona, h: hSoglia + 2.2 * mpp, base: hSoglia, sopra: persone >= l.capienza * 0.85 }, geometry: { type: 'Polygon', coordinates: [cerchio(l.lon, l.lat, raggio * 2.1), cerchio(l.lon, l.lat, raggio * 1.6).reverse()] } });
      punti.push({ type: 'Feature', properties: props, geometry: { type: 'Point', coordinates: [l.lon, l.lat] } });
    }
    return { colonne: { type: 'FeatureCollection', features: colonne }, anelli: { type: 'FeatureCollection', features: anelli }, punti: { type: 'FeatureCollection', features: punti } };
  }

  function geoLinee() {
    const t = cfg.trasporti;
    if (!t) return { linee: vuoto(), stazioni: vuoto() };
    return {
      linee: { type: 'FeatureCollection', features: t.linee.map((l) => ({ type: 'Feature', properties: { sigla: l.sigla, nome: l.nome, colore: l.colore, tipo: l.tipo }, geometry: { type: 'MultiLineString', coordinates: l.tratti.map((tr) => tr.map(([lat, lon]) => [lon, lat])) } })) },
      stazioni: { type: 'FeatureCollection', features: t.stazioni.map((s) => ({ type: 'Feature', properties: { id: s.id, nome: s.nome, linee: s.linee.join(' · '), colore: t.linee.find((l) => l.sigla === s.linee[0])?.colore || '#94a3b8' }, geometry: { type: 'Point', coordinates: [s.lon, s.lat] } })) },
    };
  }

  function geoGriglia() {
    const g = cfg.griglia;
    if (!g) return vuoto();
    return { type: 'FeatureCollection', features: g.celle.map((c, i) => ({ type: 'Feature', id: i, properties: {}, geometry: { type: 'Polygon', coordinates: [g.esagono(c)] } })) };
  }

  function aggiungiStrati() {
    const gl = geoLinee();
    const go = geoLuoghi();
    map.addSource('linee', { type: 'geojson', data: gl.linee });
    map.addSource('stazioni', { type: 'geojson', data: gl.stazioni });
    map.addSource('aura', { type: 'geojson', data: go.punti });
    map.addSource('colonne', { type: 'geojson', data: go.colonne });
    map.addSource('anelli', { type: 'geojson', data: go.anelli });
    map.addSource('griglia', { type: 'geojson', data: geoGriglia() });
    map.addSource('flussi', { type: 'geojson', data: vuoto() });
    map.addSource('particelle', { type: 'geojson', data: vuoto() });
    map.addSource('percorso', { type: 'geojson', data: vuoto() });
    map.addSource('cometa', { type: 'geojson', data: vuoto() });

    const prima = 'edifici'; // tutto ciò che è a terra sta sotto gli edifici 3D
    // alone a terra del luogo (area monitorata, ~250 m)
    map.addLayer({
      id: 'aura', type: 'circle', source: 'aura',
      paint: {
        'circle-pitch-alignment': 'map',
        'circle-radius': ['interpolate', ['exponential', 2], ['zoom'], 10, 4.5, 16, 300],
        'circle-color': ['get', 'colore'],
        'circle-opacity': ['case', ['get', 'sel'], 0.5, ['get', 'evid'], 0.5, 0.26],
        'circle-blur': 0.55,
        'circle-stroke-color': ['case', ['get', 'sel'], '#ffffff', ['get', 'colore']],
        'circle-stroke-width': ['case', ['get', 'sel'], 2, ['get', 'evid'], 2, 0.8],
        'circle-stroke-opacity': ['case', ['get', 'sel'], 0.95, 0.55],
      },
    }, prima);
    // linee su ferro: alone + tratto
    map.addLayer({ id: 'linee-alone', type: 'line', source: 'linee', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'colore'], 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 3, 15, 12], 'line-opacity': 0.16, 'line-blur': 4 } }, prima);
    map.addLayer({ id: 'linee', type: 'line', source: 'linee', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'colore'], 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.1, 15, 3.6], 'line-opacity': 0.85 } }, prima);
    // flussi pedonali
    map.addLayer({ id: 'flussi-alone', type: 'line', source: 'flussi', layout: { 'line-cap': 'round' }, paint: { 'line-color': '#5ad1ff', 'line-width': ['interpolate', ['linear'], ['get', 'persone'], 150, 9, 3000, 26], 'line-opacity': 0.22, 'line-blur': 7 } }, prima);
    map.addLayer({ id: 'flussi', type: 'line', source: 'flussi', layout: { 'line-cap': 'round' }, paint: { 'line-color': '#8fe6ff', 'line-width': ['interpolate', ['linear'], ['get', 'persone'], 150, 2.4, 3000, 9], 'line-opacity': 0.8 } }, prima);
    map.addLayer({ id: 'particelle', type: 'circle', source: 'particelle', paint: { 'circle-pitch-alignment': 'map', 'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 2.6, 15, 5.5], 'circle-color': '#ffffff', 'circle-stroke-color': '#0ea5e9', 'circle-stroke-width': 1.2, 'circle-opacity': 1 } }, prima);
    // percorso proposto dall'agente Mobilità
    map.addLayer({ id: 'percorso-alone', type: 'line', source: 'percorso', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'colore'], 'line-width': 16, 'line-opacity': 0.25, 'line-blur': 6 } }, prima);
    map.addLayer({ id: 'percorso-mezzi', type: 'line', source: 'percorso', filter: ['!=', ['get', 'modo'], 'piedi'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'colore'], 'line-width': 6 } }, prima);
    map.addLayer({ id: 'percorso-piedi', type: 'line', source: 'percorso', filter: ['==', ['get', 'modo'], 'piedi'], layout: { 'line-cap': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': 3.2, 'line-dasharray': [0.2, 1.8] } }, prima);
    map.addLayer({ id: 'cometa', type: 'circle', source: 'cometa', paint: { 'circle-radius': 7, 'circle-color': '#ffffff', 'circle-stroke-color': '#38bdf8', 'circle-stroke-width': 3, 'circle-pitch-alignment': 'map' } }, prima);

    // celle esagonali (sopra gli edifici, visibili solo nella vista "celle")
    map.addLayer({
      id: 'griglia', type: 'fill-extrusion', source: 'griglia', layout: { visibility: 'none' },
      paint: {
        'fill-extrusion-color': ['coalesce', ['feature-state', 'c'], TERRA],
        'fill-extrusion-height': ['coalesce', ['feature-state', 'h'], 0],
        'fill-extrusion-opacity': 0.86,
        'fill-extrusion-vertical-gradient': true,
      },
    });
    // colonne dei luoghi e anello della soglia
    map.addLayer({ id: 'colonne', type: 'fill-extrusion', source: 'colonne', paint: { 'fill-extrusion-color': ['get', 'colore'], 'fill-extrusion-height': ['get', 'h'], 'fill-extrusion-base': 0, 'fill-extrusion-opacity': 0.9, 'fill-extrusion-vertical-gradient': true } });
    map.addLayer({ id: 'anelli', type: 'fill-extrusion', source: 'anelli', paint: { 'fill-extrusion-color': ['case', ['get', 'sopra'], '#ffffff', '#c7d6ee'], 'fill-extrusion-height': ['get', 'h'], 'fill-extrusion-base': ['get', 'base'], 'fill-extrusion-opacity': 0.55, 'fill-extrusion-vertical-gradient': false } });

    map.addLayer({ id: 'stazioni', type: 'circle', source: 'stazioni', minzoom: 11.8, paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 11.8, 1.6, 15, 5], 'circle-color': '#0b1424', 'circle-stroke-color': ['get', 'colore'], 'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 11.8, 1, 15, 2.2] } });
    map.addLayer({ id: 'stazioni-nomi', type: 'symbol', source: 'stazioni', minzoom: 14.2, layout: { 'text-field': ['get', 'nome'], 'text-font': FONT, 'text-size': 10.5, 'text-offset': [0, 0.9], 'text-anchor': 'top', 'text-optional': true }, paint: { 'text-color': '#b9c8e0', 'text-halo-color': TERRA, 'text-halo-width': 1.3 } });
    map.addLayer({
      id: 'luoghi-nomi', type: 'symbol', source: 'aura',
      layout: {
        'text-field': ['format', ['get', 'nome'], { 'font-scale': 1 }, '\n', {}, ['get', 'etichetta'], { 'font-scale': 0.84, 'text-font': ['literal', FONT] }],
        'text-font': FONT_B,
        'text-size': ['interpolate', ['linear'], ['zoom'], 11, 10.5, 15, 14],
        'text-variable-anchor': ['top', 'top-left', 'top-right', 'left', 'right'],
        'text-radial-offset': 0.9,
        'text-max-width': 9,
        'text-line-height': 1.25,
        'symbol-sort-key': ['-', 0, ['+', ['get', 'quota'], ['case', ['get', 'sel'], 10, 0]]],
      },
      paint: { 'text-color': ['case', ['get', 'sel'], '#ffffff', '#e6eefb'], 'text-halo-color': 'rgba(4,10,20,0.92)', 'text-halo-width': 1.6 },
    });
  }

  function formatoMigliaia(n) {
    return n >= 10_000 ? `${Math.round(n / 1000)} mila` : n >= 1000 ? `${(n / 1000).toFixed(1).replace('.', ',')} mila` : String(n);
  }

  function ridisegnaLuoghi() {
    if (!stato.pronta) return;
    const g = geoLuoghi();
    map.getSource('aura').setData(g.punti);
    map.getSource('colonne').setData(g.colonne);
    map.getSource('anelli').setData(g.anelli);
  }

  // ------------------------------------------------------------------ celle

  const RAMPA_CELLE = [[SOGLIA_PRIVACY, [13, 54, 107]], [300, [28, 92, 171]], [800, [57, 135, 229]], [1600, [134, 182, 239]], [3200, [205, 226, 251]]];
  function colorePresenze(p) {
    if (p <= RAMPA_CELLE[0][0]) return `rgb(${RAMPA_CELLE[0][1].join(',')})`;
    for (let i = 1; i < RAMPA_CELLE.length; i++) {
      if (p <= RAMPA_CELLE[i][0]) {
        const [a, ca] = RAMPA_CELLE[i - 1], [b, cb] = RAMPA_CELLE[i];
        const t = (p - a) / (b - a);
        return `rgb(${ca.map((v, k) => Math.round(v + (cb[k] - v) * t)).join(',')})`;
      }
    }
    return `rgb(${RAMPA_CELLE[RAMPA_CELLE.length - 1][1].join(',')})`;
  }

  let ultimaGriglia = null;
  function aggiornaGriglia(r) {
    ultimaGriglia = r || ultimaGriglia;
    if (!stato.pronta || !ultimaGriglia || stato.vista !== 'celle' || !cfg.griglia) return;
    const { presenze, pressione } = ultimaGriglia;
    const scala = 6.5; // metri per radice di presenza: l'esagono ha dimensioni reali, quindi anche l'altezza resta in metri
    for (let i = 0; i < presenze.length; i++) {
      const p = presenze[i];
      if (p < SOGLIA_PRIVACY) {
        map.setFeatureState({ source: 'griglia', id: i }, { h: 0, c: TERRA });
        continue;
      }
      const liv = livelloPressione(pressione[i]);
      const c = liv === 'vivace' || liv === 'affollato' ? COLORI_LIVELLO[liv] : colorePresenze(p);
      map.setFeatureState({ source: 'griglia', id: i }, { h: Math.sqrt(p) * scala, c });
    }
  }

  // ------------------------------------------------------------------ flussi e animazioni

  let particelle = [];
  function aggiornaFlussi(lista) {
    stato.flussi = lista || [];
    if (!stato.pronta) return;
    const visibili = stato.strati.flussi ? stato.flussi : [];
    const feat = visibili.map((f, i) => ({ type: 'Feature', properties: { persone: f.persone, i }, geometry: { type: 'LineString', coordinates: arco(f.da, f.a) } }));
    map.getSource('flussi').setData({ type: 'FeatureCollection', features: feat });
    particelle = [];
    feat.forEach((f) => {
      const n = limita(Math.round(f.properties.persone / 220), 1, 7);
      for (let k = 0; k < n; k++) particelle.push({ linea: f.geometry.coordinates, fase: k / n + Math.random() * 0.1, vel: 0.1 + Math.random() * 0.05 });
    });
    if (!animazioni) disegnaParticelle(0.35);
  }

  function puntoSu(linea, t) {
    const x = limita(t, 0, 0.9999) * (linea.length - 1);
    const i = Math.floor(x), f = x - i;
    return [linea[i][0] + (linea[i + 1][0] - linea[i][0]) * f, linea[i][1] + (linea[i + 1][1] - linea[i][1]) * f];
  }

  function disegnaParticelle(sec) {
    if (!stato.pronta) return;
    const feat = particelle.map((p) => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: puntoSu(p.linea, (p.fase + sec * p.vel) % 1) } }));
    map.getSource('particelle').setData({ type: 'FeatureCollection', features: feat });
  }

  let cometa = null; // { linea, lunghezze, totale }
  function disegnaCometa(sec) {
    if (!cometa || !stato.pronta) return;
    const d = ((sec * 0.07) % 1) * cometa.totale;
    let i = 0;
    while (i < cometa.lunghezze.length - 1 && cometa.lunghezze[i + 1] < d) i++;
    const a = cometa.linea[i], b = cometa.linea[i + 1] || a;
    const tr = cometa.lunghezze[i + 1] - cometa.lunghezze[i] || 1;
    const f = limita((d - cometa.lunghezze[i]) / tr, 0, 1);
    map.getSource('cometa').setData({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f] } });
  }

  let ultimoFotogramma = 0;
  function ciclo(ms) {
    if (animazioni) requestAnimationFrame(ciclo);
    if (!stato.pronta) return;
    if (stato.orbita && !map.isMoving()) map.setBearing(map.getBearing() + 0.045);
    if (ms - ultimoFotogramma < 50) return; // ~20 fotogrammi al secondo bastano
    ultimoFotogramma = ms;
    const sec = ms / 1000;
    if (particelle.length && stato.strati.flussi) disegnaParticelle(sec);
    if (cometa) disegnaCometa(sec);
  }

  // ------------------------------------------------------------------ percorso ed eventi

  function marcatore(classe, html, lngLat, titolo) {
    const el = document.createElement('div');
    el.className = classe;
    el.innerHTML = html;
    if (titolo) el.title = titolo;
    // con il rilievo MapLibre attenua i marcatori che ritiene coperti dal terreno: qui devono restare pieni
    return new maplibregl.Marker({ element: el, anchor: 'bottom', opacityWhenCovered: '1' }).setLngLat(lngLat).addTo(map);
  }

  function mostraPercorso(it, { inquadra = true } = {}) {
    stato.percorso = it;
    stato.marcatori.percorso.forEach((m) => m.remove());
    stato.marcatori.percorso = [];
    cometa = null;
    if (!stato.pronta) return;
    if (!it) {
      map.getSource('percorso').setData(vuoto());
      map.getSource('cometa').setData(vuoto());
      return;
    }
    const feat = it.tratte.filter((t) => t.geometria?.length > 1).map((t) => ({ type: 'Feature', properties: { modo: t.modo, colore: t.modo === 'piedi' ? '#ffffff' : t.colore || '#38bdf8', linea: t.linea || '' }, geometry: { type: 'LineString', coordinates: t.geometria } }));
    map.getSource('percorso').setData({ type: 'FeatureCollection', features: feat });
    const tutta = feat.flatMap((f) => f.geometry.coordinates);
    const lunghezze = [0];
    for (let i = 1; i < tutta.length; i++) lunghezze.push(lunghezze[i - 1] + Math.hypot((tutta[i][0] - tutta[i - 1][0]) * 0.757, tutta[i][1] - tutta[i - 1][1]));
    cometa = tutta.length > 1 ? { linea: tutta, lunghezze, totale: lunghezze[lunghezze.length - 1] } : null;
    if (!animazioni) disegnaCometa(4);
    const primo = it.tratte[0], ultimo = it.tratte[it.tratte.length - 1];
    stato.marcatori.percorso.push(marcatore('tc-pin tc-pin-a', '<b>A</b>', [primo.da.lon, primo.da.lat], primo.da.nome));
    stato.marcatori.percorso.push(marcatore('tc-pin tc-pin-b', '<b>B</b>', [ultimo.a.lon, ultimo.a.lat], ultimo.a.nome));
    for (const t of it.tratte) {
      if (t.modo === 'piedi') continue;
      stato.marcatori.percorso.push(marcatore('tc-fermata', `<span style="background:${t.colore}"></span>${t.linea}`, [t.da.lon, t.da.lat], `${t.linea}: sali a ${t.da.nome}`));
    }
    if (inquadra && tutta.length > 1) {
      const b = tutta.reduce((bb, p) => bb.extend(p), new maplibregl.LngLatBounds(tutta[0], tutta[0]));
      map.fitBounds(b, { padding: 70, pitch: 55, bearing: map.getBearing(), duration: animazioni ? 1800 : 0, maxZoom: 14.6 });
    }
  }

  function mostraEventi(lista) {
    stato.marcatori.eventi.forEach((m) => m.remove());
    stato.marcatori.eventi = [];
    if (!stato.strati.eventi) return;
    const perZona = new Map();
    for (const e of lista || []) {
      if (!e.zona || !luoghi[e.zona] || e.persone < 1000) continue;
      if (!perZona.has(e.zona)) perZona.set(e.zona, []);
      if (!perZona.get(e.zona).some((x) => x.titolo === e.titolo)) perZona.get(e.zona).push(e);
    }
    for (const [zona, ev] of perZona) {
      const l = luoghi[zona];
      const m = marcatore(
        `tc-evento${ev.some((e) => !e.reale) ? ' tc-evento-ipotetico' : ''}`,
        `<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M12 2l2.9 6.3 6.9.8-5.1 4.7 1.4 6.8L12 17.2 5.9 20.6l1.4-6.8L2.2 9.1l6.9-.8z"/></svg><span>${ev[0].titolo.replace(/[<>&]/g, '')}${ev.length > 1 ? ` +${ev.length - 1}` : ''}</span>`,
        [l.lon, l.lat],
        ev.map((e) => e.titolo).join(' · '),
      );
      m.getElement().addEventListener('click', (x) => {
        x.stopPropagation();
        emetti('luogo', zona);
      });
      stato.marcatori.eventi.push(m);
    }
  }

  // ------------------------------------------------------------------ interazione

  const suggerimento = document.createElement('div');
  suggerimento.className = 'tc-suggerimento';
  suggerimento.hidden = true;
  contenitore.appendChild(suggerimento);

  function collegaInterazioni() {
    const STRATI_LUOGO = ['luoghi-nomi', 'colonne', 'aura']; // precedenza del clic: etichetta, colonna, alone
    const sotto = (punto) => {
      const f = map.queryRenderedFeatures(punto, { layers: STRATI_LUOGO }).sort((a, b) => STRATI_LUOGO.indexOf(a.layer.id) - STRATI_LUOGO.indexOf(b.layer.id))[0];
      if (f) return { tipo: 'luogo', p: f.properties };
      const st = map.queryRenderedFeatures(punto, { layers: ['stazioni'] })[0];
      return st ? { tipo: 'stazione', p: st.properties } : null;
    };
    map.on('click', (e) => {
      const x = sotto(e.point);
      if (!x) return emetti('sfondo');
      emetti(x.tipo, x.tipo === 'luogo' ? x.p.zona : x.p.id);
    });
    map.on('mousemove', (e) => {
      const x = sotto(e.point);
      map.getCanvas().style.cursor = x ? 'pointer' : '';
      suggerimento.hidden = !x;
      if (!x) return;
      suggerimento.innerHTML = `<b>${x.p.nome}</b><span><i style="background:${x.p.colore}"></i>${x.tipo === 'luogo' ? x.p.etichetta : x.p.linee}</span>`;
      suggerimento.style.transform = `translate(${e.point.x + 14}px, ${e.point.y + 14}px)`;
    });
    map.on('mouseout', () => (suggerimento.hidden = true));
    // colonne e celle hanno dimensioni "a schermo": si ricalcolano quando cambia lo zoom
    let attesa = null;
    map.on('zoom', () => {
      if (attesa) return;
      attesa = setTimeout(() => {
        attesa = null;
        ridisegnaLuoghi();
      }, 90);
    });
    // chi tocca la mappa ferma il giro automatico della camera
    for (const ev of ['mousedown', 'touchstart', 'wheel']) {
      map.getCanvas().addEventListener(ev, () => {
        if (!stato.orbita) return;
        stato.orbita = false;
        emetti('orbita', false);
      }, { passive: true });
    }
  }

  function applicaVista() {
    if (!stato.pronta) return;
    const celle = stato.vista === 'celle';
    map.setLayoutProperty('griglia', 'visibility', celle ? 'visible' : 'none');
    map.setLayoutProperty('edifici', 'visibility', !celle && stato.strati.edifici ? 'visible' : 'none');
    map.setPaintProperty('colonne', 'fill-extrusion-opacity', celle ? 0.0 : 0.9);
    map.setLayoutProperty('colonne', 'visibility', celle ? 'none' : 'visible');
    map.setLayoutProperty('anelli', 'visibility', celle ? 'none' : 'visible');
    for (const id of ['linee', 'linee-alone', 'stazioni', 'stazioni-nomi']) map.setLayoutProperty(id, 'visibility', stato.strati.trasporti ? 'visible' : 'none');
    for (const id of ['flussi', 'flussi-alone', 'particelle']) map.setLayoutProperty(id, 'visibility', stato.strati.flussi ? 'visible' : 'none');
    if (celle) aggiornaGriglia();
  }

  map.on('load', () => {
    if (rilievo) map.setTerrain({ source: 'dem', exaggeration: 1.35 });
    aggiungiStrati();
    collegaInterazioni();
    stato.pronta = true;
    applicaVista();
    ridisegnaLuoghi();
    aggiornaFlussi(stato.flussi);
    if (stato.percorso) mostraPercorso(stato.percorso);
    if (animazioni) requestAnimationFrame(ciclo);
    emetti('pronta');
  });
  map.on('error', (e) => console.warn('[mappa]', e?.error?.message || e));

  return {
    map,
    su: (nome, f) => ascoltatori[nome].push(f),
    get pronta() {
      return stato.pronta;
    },
    aggiornaLuoghi(quadro) {
      stato.quadro = quadro;
      ridisegnaLuoghi();
    },
    aggiornaGriglia,
    aggiornaFlussi,
    mostraPercorso,
    mostraEventi,
    seleziona(zona, { vola = true } = {}) {
      stato.selezionata = zona;
      ridisegnaLuoghi();
      if (zona && vola && luoghi[zona]) {
        const l = luoghi[zona];
        map.flyTo({ center: [l.lon, l.lat], zoom: Math.max(map.getZoom(), 14.4), pitch: 62, bearing: map.getBearing() + 25, duration: animazioni ? 1900 : 0, essential: true });
      }
    },
    evidenzia(zone) {
      stato.evidenziate = new Set(zone || []);
      ridisegnaLuoghi();
    },
    impostaVista(v) {
      stato.vista = v;
      applicaVista();
    },
    impostaStrato(nome, visibile) {
      stato.strati[nome] = visibile;
      applicaVista();
      if (nome === 'flussi') aggiornaFlussi(stato.flussi);
    },
    strati: () => ({ ...stato.strati }),
    vista: () => stato.vista,
    volaA(nome) {
      const v = VISTE[nome];
      if (v) map.flyTo({ ...v, duration: animazioni ? 2200 : 0, essential: true });
    },
    inquadra(zone) {
      const pts = zone.map((z) => luoghi[z]).filter(Boolean);
      if (!pts.length) return;
      const b = pts.reduce((bb, p) => bb.extend([p.lon, p.lat]), new maplibregl.LngLatBounds([pts[0].lon, pts[0].lat], [pts[0].lon, pts[0].lat]));
      map.fitBounds(b, { padding: 80, pitch: 58, maxZoom: 14, duration: animazioni ? 2000 : 0 });
    },
    orbita(on) {
      stato.orbita = on;
    },
    inOrbita: () => stato.orbita,
  };
}
