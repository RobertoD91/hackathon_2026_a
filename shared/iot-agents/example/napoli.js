// Scenario "Napoli connessa": configurazione della dashboard e della mappa "Napoli in tempo
// reale" (stile Seoul Real-Time City Data). Luoghi, capienze e soglie stanno in luoghi.js
// (li usa anche l'agente folla); qui ci sono colori, testi, colonne e scheda di dettaglio.
//
// Punti di estensione per altri livelli di Napoli (trasporti, eventi, qualità dell'aria...):
// - una nuova modalità della mappa = un elemento in `INDICATORI` (4 livelli con colori e una
//   funzione `valuta`); i dati possono arrivare dai sensori (aggregato della zona) o da
//   `ctx.extra` (riempito con `mappa.setExtra(nome, dati)`, vedi `eventi` qui sotto);
// - un livello sovrapposto (linee della metro, eventi, stazioni di qualità dell'aria) = un
//   elemento in `SOVRAPPOSTI` con `crea({ L, map, ctx })` e, se cambia nel tempo, `aggiorna`;
// - le stesse cose si possono aggiungere a mappa avviata: `mappa.aggiungiIndicatore(...)`,
//   `mappa.aggiungiSovrapposto(...)` (es. da un modulo che legge una fonte esterna).

import { CATEGORIE, LUOGHI, LIVELLI_FOLLA, LIVELLI_CALDO, livelloFolla, livelloCaldo } from './luoghi.js';
import { aggregaSensori, colonna, distanzaKm } from './mappa.js';

/** Colori dei 4 livelli (gli stessi per affollamento e temperatura). */
const COLORI = {
  tranquillo: { colore: '#1fb46a' },
  normale: { colore: '#f2c200', inchiostro: '#3a2e00' },
  vivace: { colore: '#ff8a2a', critico: true },
  affollato: { colore: '#e5413a', critico: true },
};
const conColori = (livelli) => livelli.map((l) => ({ id: l.id, label: l.label, ...COLORI[l.id] }));

/** Modalità della mappa (pulsanti nella legenda). */
export const INDICATORI = [
  {
    id: 'folla',
    label: 'Affollamento',
    livelli: conColori(LIVELLI_FOLLA),
    valuta: (a, l) => (a?.conPersone ? { livello: livelloFolla(a.persone, l.capienza).id, valore: a.persone / l.capienza } : null),
  },
  {
    id: 'caldo',
    label: 'Temperatura',
    livelli: conColori(LIVELLI_CALDO),
    valuta: (a) => (a?.temperatura != null ? { livello: livelloCaldo(a.temperatura).id, valore: a.temperatura } : null),
  },
];

/** Livelli sovrapposti (per ora nessuno: vedi il commento in cima). */
export const SOVRAPPOSTI = [];

/** Aggregato di zona: persone stimate (somma), temperatura e umidità (medie). */
function aggrega(dispositivi) {
  const g = aggregaSensori(dispositivi);
  return {
    ...g,
    persone: g.somma.people_count ?? 0,
    conPersone: g.n.people_count ?? 0,
    temperatura: g.media.temperature_c ?? null,
    umidita: g.media.humidity_pct ?? null,
  };
}

/** Il luogo più vicino "tranquillo" o "normale" (stadio escluso). */
function alternativa(zona, c) {
  const da = LUOGHI[zona];
  return (
    Object.entries(LUOGHI)
      .filter(([z]) => z !== zona && z !== 'maradona' && c.stato.zone[z]?.conPersone)
      .map(([z, l]) => ({ zona: z, nome: l.nome, km: distanzaKm(da, l), ...livelloFolla(c.stato.zone[z].persone, l.capienza) }))
      .filter((x) => x.id === 'tranquillo' || x.id === 'normale')
      .sort((x, y) => x.km - y.km)[0] ?? null
  );
}

function dettaglio(r, c) {
  const { zona: z, luogo: l, agg: a } = r;
  if (!a) return '<p class="muted">In attesa dei dati dei sensori di questo luogo…</p>';
  const folla = r.livelli.folla;
  const caldo = r.livelli.caldo;
  const quota = a.conPersone ? Math.min(1, a.persone / l.capienza) : 0;
  const h = r.storia;
  const alt = folla && (folla.id === 'vivace' || folla.id === 'affollato') ? alternativa(z, c) : null;
  const { escapeHtml, formatNumber, formatTime } = c;
  return `<div class="cm-d-levels">
      ${folla ? c.badge(folla, `Folla: ${folla.label}`) : ''}
      ${caldo ? c.badge(caldo) : ''}
    </div>
    ${
      a.conPersone
        ? `<div class="cm-d-num"><b>${formatNumber(a.persone, 0)}</b> persone stimate <small>· soglia ${formatNumber(l.capienza, 0)}</small></div>
           ${c.barra(quota, folla)}
           ${h.length > 2 ? `<div class="cm-d-spark">${c.sparkline(h, { width: 260, height: 40 })}<small>andamento recente</small></div>` : ''}`
        : ''
    }
    <dl class="cm-d-grid">
      <dt>Temperatura</dt><dd>${a.temperatura != null ? `${formatNumber(a.temperatura, 1)} °C` : '–'}</dd>
      <dt>Umidità</dt><dd>${a.umidita != null ? `${formatNumber(a.umidita, 0)} %` : '–'}</dd>
      <dt>Sensori</dt><dd>${a.sensori} ${a.reali ? `(${a.reali} reali)` : '(simulati)'}</dd>
      <dt>Aggiornato</dt><dd>${formatTime(a.ts)}</dd>
    </dl>
    ${
      alt
        ? `<div class="cm-d-alt">Più tranquillo qui vicino: <button type="button" data-zona="${alt.zona}">${escapeHtml(alt.nome)}</button> <small>${alt.km.toFixed(1)} km · ${escapeHtml(alt.label)}</small></div>`
        : ''
    }`;
}

/** Configurazione del componente mappa (mappa.js). */
export const MAPPA = {
  titolo: 'Napoli in tempo reale',
  sottotitolo: 'Affollamento e clima dei luoghi principali, aggiornati dai sensori e dagli agenti',
  cerca: 'Cerca un luogo…',
  ariaMappa: 'Mappa di Napoli',
  vista: { centro: [40.8435, 14.242], zoom: 13, zoomEtichette: 14, zoomVolo: 15 },
  categorie: CATEGORIE,
  tutte: 'Tutti i luoghi',
  luoghi: LUOGHI,
  aggrega,
  storia: (a) => (a.conPersone ? a.persone : null),
  indicatori: INDICATORI,
  sovrapposti: SOVRAPPOSTI,
  colonne: [
    colonna.luogo(),
    colonna.categoria(),
    colonna.livello(),
    {
      titolo: 'Persone stimate',
      classe: 'num',
      cella: (r, c) => (r.agg?.conPersone ? `${c.formatNumber(r.agg.persone, 0)} <small>/ ${c.formatNumber(r.luogo.capienza, 0)}</small>` : '–'),
    },
    { titolo: 'Temperatura', classe: 'num', cella: (r, c) => (r.agg?.temperatura != null ? `${c.formatNumber(r.agg.temperatura, 1)} °C` : '–') },
    colonna.aggiornato(),
  ],
  dettaglio,
  nota:
    "Il cerchio che pulsa indica il luogo più critico di ogni categoria. Dati simulati: in produzione l'affollamento " +
    'arriverebbe da dati anonimi e aggregati delle celle telefoniche e dai sensori ESP32 (5G), come fa ' +
    '<a href="https://data.seoul.go.kr/SeoulRtd/" target="_blank" rel="noopener">Seoul Real-Time City Data</a>.',
};

/** Configurazione della dashboard (app.js → avviaDashboard). */
export default {
  id: 'napoli',
  simConfig: new URL('./sim-config.json', import.meta.url).href,
  demoAgents: async () => (await import('./agents/index.js')).createAgents(),
  firma: 'folla', // agente che deve esserci nel hub perché la pagina usi la modalità live
  notaAltroHub:
    'Il hub raggiungibile da qui esegue un altro scenario, quindi Napoli gira nel tuo browser (modalità demo). ' +
    'Per la versione con il hub: <code>node shared/iot-agents/example/server.js</code>.',
  mappa: MAPPA,
};
