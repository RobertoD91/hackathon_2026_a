// Scenario "Acqua comune" (fattoria): configurazione della dashboard e della mappa.
// Stesso componente della mappa di Napoli (../mappa.js), con poligoni per gli appezzamenti,
// tre modalità (umidità del suolo, temperatura, turni d'acqua) e la rete irrigua come livello
// sovrapposto. Piano dei turni e previsione arrivano dagli eventi degli agenti (`eventi`).

import { aggregaSensori, colonna } from '../mappa.js';
import { formatClock } from '../../sim/sim-core.js';
import {
  CAMPI,
  CATEGORIE,
  COLTURE,
  SERBATOIO,
  STAZIONE,
  LIVELLI_UMIDITA,
  LIVELLI_TEMPERATURA,
  SOGLIE_UMIDITA,
  livelloUmidita,
  livelloTemperatura,
  parametri,
} from './campi.js';
import { durata, fmt, litriTesto } from './piano.js';

const COLORI_UMIDITA = {
  stress: { colore: '#e5413a', critico: true },
  asciutto: { colore: '#f0a020', inchiostro: '#3a2a00', critico: true },
  ottimale: { colore: '#1fb46a' },
  saturo: { colore: '#2f6fd0' },
};
const COLORI_TEMPERATURA = {
  fresco: { colore: '#3d8bd9' },
  mite: { colore: '#1fb46a' },
  caldo: { colore: '#ff8a2a', critico: true },
  torrido: { colore: '#e5413a', critico: true },
};
const LIVELLI_TURNI = [
  { id: 'nessuno', label: 'Nessun turno', colore: '#8f8e86' },
  { id: 'irrigato', label: 'Irrigato', colore: '#2f6fd0' },
  { id: 'programmato', label: 'Turno stanotte', colore: '#1fb46a' },
  { id: 'tagliato', label: 'Ridotto o rinviato', colore: '#e5413a', critico: true },
];
const conColori = (livelli, colori) => livelli.map((l) => ({ id: l.id, label: l.label, ...colori[l.id] }));

/** Luoghi della mappa: i 10 campi (poligoni), la vasca e la stazione meteo. */
export const LUOGHI = {
  ...Object.fromEntries(
    Object.entries(CAMPI).map(([z, c]) => [
      z,
      {
        nome: `${c.nome} · ${c.agricoltore}`,
        categoria: COLTURE[c.coltura].categoria,
        lat: c.lat,
        lon: c.lon,
        poligono: c.poligono,
        parole: [c.agricoltore, COLTURE[c.coltura].nome, c.fase, `campo ${c.n}`],
        campo: c,
      },
    ]),
  ),
  [SERBATOIO.zona]: { nome: SERBATOIO.nome, categoria: 'servizi', lat: SERBATOIO.lat, lon: SERBATOIO.lon, icona: '≋', parole: ['acqua', 'serbatoio', 'vasca', 'pozzo'] },
  [STAZIONE.zona]: { nome: STAZIONE.nome, categoria: 'servizi', lat: STAZIONE.lat, lon: STAZIONE.lon, icona: '☀', parole: ['meteo', 'previsione', 'pioggia'] },
};

// ---------------------------------------------------------------- turni (dati dagli eventi del consorzio)

/** Stato del turno del campo adesso: { livello, testo, turno, inCorso }. */
function statoTurno(zona, c) {
  const t = c.extra.piano?.[zona];
  if (!t) return null;
  const ora = c.ora();
  const v = c.extra.valvole?.[zona] ?? (t.stato === 'avviato' ? { inizio: t.inizio, fine: t.fine, litri: t.litri } : null);
  if (v) {
    const inCorso = ora >= v.inizio && ora < v.fine;
    return {
      livello: 'irrigato',
      inCorso,
      turno: t,
      testo: inCorso ? `in irrigazione fino alle ${formatClock(v.fine)}` : `irrigato dalle ${formatClock(v.inizio)} alle ${formatClock(v.fine)}`,
    };
  }
  if (t.type === 'turno') {
    const quando = `stanotte ${formatClock(t.inizio)} · ${durata(t.minuti)}`;
    return t.stato === 'ridotto'
      ? { livello: 'tagliato', turno: t, testo: `${quando} (ridotto)` }
      : { livello: 'programmato', turno: t, testo: quando };
  }
  if (t.type === 'rinvio') return { livello: 'tagliato', turno: t, testo: 'rinviato a domani notte' };
  return { livello: 'nessuno', turno: t, testo: 'nessun turno' };
}

const theta = (a) => a?.media?.soil_moisture_pct ?? null;

/** Modalità della mappa. */
export const INDICATORI = [
  {
    id: 'umidita',
    label: 'Umidità',
    livelli: conColori(LIVELLI_UMIDITA, COLORI_UMIDITA),
    valuta: (a) => (theta(a) != null ? { livello: livelloUmidita(theta(a)).id, valore: 40 - theta(a) } : null),
  },
  {
    id: 'temperatura',
    label: 'Temperatura',
    livelli: conColori(LIVELLI_TEMPERATURA, COLORI_TEMPERATURA),
    valuta: (a, l) => (l.campo && a?.media?.temperature_c != null ? { livello: livelloTemperatura(a.media.temperature_c).id, valore: a.media.temperature_c } : null),
  },
  {
    id: 'turni',
    label: 'Turni',
    livelli: LIVELLI_TURNI,
    valuta: (a, l, z, c) => {
      const s = l.campo ? statoTurno(z, c) : null;
      if (!s) return null;
      const peso = { tagliato: 4, programmato: 3, irrigato: 2, nessuno: 1 }[s.livello];
      return { livello: s.livello, valore: peso + (s.turno.priorita ?? 0) / 1000 };
    },
  },
];

/** Livello sovrapposto: tracciato schematico della rete irrigua; si anima il ramo del campo che sta irrigando. */
export const SOVRAPPOSTI = [
  {
    id: 'rete',
    label: 'Rete irrigua (schema)',
    attivo: true,
    crea: ({ L }) => {
      const gruppo = L.layerGroup();
      gruppo.rami = {};
      for (const [z, campo] of Object.entries(CAMPI)) {
        gruppo.rami[z] = L.polyline(campo.rete, { color: '#2f6fd0', weight: 3, opacity: 0.55, interactive: false, className: 'fa-condotta' }).addTo(gruppo);
      }
      return gruppo;
    },
    aggiorna: (gruppo, c) => {
      for (const [z, ramo] of Object.entries(gruppo.rami)) ramo.getElement?.()?.classList.toggle('attiva', Boolean(statoTurno(z, c)?.inCorso));
    },
  },
];

// ---------------------------------------------------------------- scheda di dettaglio

function scalaUmidita(th) {
  const min = 10;
  const max = 40;
  const pos = (v) => ((Math.min(max, Math.max(min, v)) - min) / (max - min)) * 100;
  const fasce = [
    [min, SOGLIE_UMIDITA.stress, COLORI_UMIDITA.stress.colore],
    [SOGLIE_UMIDITA.stress, SOGLIE_UMIDITA.asciutto, COLORI_UMIDITA.asciutto.colore],
    [SOGLIE_UMIDITA.asciutto, SOGLIE_UMIDITA.saturo, COLORI_UMIDITA.ottimale.colore],
    [SOGLIE_UMIDITA.saturo, max, COLORI_UMIDITA.saturo.colore],
  ];
  return `<div class="fa-scala" role="img" aria-label="umidità del suolo ${fmt(th)} %">
    ${fasce.map(([a, b, col]) => `<span style="left:${pos(a)}%;width:${pos(b) - pos(a)}%;background:${col}"></span>`).join('')}
    <i style="left:${pos(th)}%"></i>
  </div>
  <div class="fa-scala-assi"><span>10 %</span><span>18</span><span>24</span><span>34</span><span>40 %</span></div>`;
}

function dettaglioCampo(r, c) {
  const campo = r.luogo.campo;
  const p = parametri(campo);
  const a = r.agg;
  const th = theta(a);
  const s = statoTurno(r.zona, c);
  const t = s?.turno;
  const { escapeHtml } = c;
  const turno = s
    ? `<div class="fa-turno fa-${s.livello}${s.inCorso ? ' fa-in-corso' : ''}">
        <b>${s.inCorso ? 'Acqua aperta' : 'Prossimo turno'}</b> ${escapeHtml(s.testo)}
        ${t.motivo && s.livello !== 'irrigato' ? `<small>${escapeHtml(t.motivo)}</small>` : ''}
      </div>`
    : '<div class="fa-turno"><b>Prossimo turno</b> il consorzio sta preparando il piano…</div>';
  return `<div class="cm-d-levels">
      ${r.livelli.umidita ? c.badge(r.livelli.umidita) : ''}
      ${r.livelli.temperatura ? c.badge(r.livelli.temperatura) : ''}
    </div>
    ${
      th != null
        ? `<div class="cm-d-num"><b>${fmt(th)} %</b> umidità del suolo <small>· soglia ${p.soglia} %</small></div>
           ${scalaUmidita(th)}
           ${r.storia.length > 2 ? `<div class="cm-d-spark">${c.sparkline(r.storia, { width: 260, height: 36 })}<small>umidità del suolo, andamento recente</small></div>` : ''}`
        : '<p class="muted">In attesa della sonda di umidità…</p>'
    }
    ${turno}
    <dl class="cm-d-grid">
      <dt>Coltura</dt><dd>${escapeHtml(COLTURE[campo.coltura].nome)}</dd>
      <dt>Fase</dt><dd>${escapeHtml(campo.fase)} · Kc ${fmt(p.kc, 2)} <small>(FAO-56)</small></dd>
      <dt>Superficie</dt><dd>${fmt(campo.area / 10_000, 2)} ha</dd>
      <dt>Litri assegnati</dt><dd>${t ? `${litriTesto(t.litri)}${t.fabbisognoL && t.fabbisognoL !== t.litri ? ` <small>su ${fmt(t.fabbisognoL, 0)} necessari</small>` : ''}` : '–'}</dd>
      <dt>A calendario</dt><dd>${t ? `${litriTesto(t.calendarioL)} <small>ogni notte</small>` : '–'}</dd>
      <dt>Priorità</dt><dd>${t?.posto ? `${t.posto}ª <small>(punteggio ${t.priorita})</small>` : '–'}</dd>
      <dt>Temperatura</dt><dd>${a?.media?.temperature_c != null ? `${fmt(a.media.temperature_c)} °C` : '–'}</dd>
      <dt>Sensori</dt><dd>${a ? `${a.sensori} ${a.reali ? `(${a.reali} reali)` : '(simulati)'}` : '–'}</dd>
      <dt>Aggiornato</dt><dd>${a?.ts ? c.formatTime(a.ts) : '–'}</dd>
    </dl>
    ${campo.nota ? `<p class="fa-nota">${escapeHtml(campo.nota)}</p>` : ''}`;
}

function dettaglioVasca(r, c) {
  const a = r.agg;
  const fill = a?.media?.fill_pct;
  const m = c.extra.metriche || {};
  const piano = Object.values(c.extra.piano || {})
    .filter((t) => t.litri > 0 && t.inizio)
    .sort((x, y) => x.inizio - y.inizio);
  return `${
    fill != null
      ? `<div class="cm-d-num"><b>${fmt(fill, 0)} %</b> pieno <small>· ${fmt((fill / 100) * SERBATOIO.capacitaM3, 0)} m³ su ${fmt(SERBATOIO.capacitaM3, 0)}</small></div>
         ${c.barra(fill / 100, { id: 'vasca', colore: '#2f6fd0' })}
         ${r.storia.length > 2 ? `<div class="cm-d-spark">${c.sparkline(r.storia, { width: 260, height: 36 })}<small>livello della vasca</small></div>` : ''}`
      : '<p class="muted">In attesa del sensore di livello…</p>'
  }
    <dl class="cm-d-grid">
      <dt>Assegnata stanotte</dt><dd>${m.acqua_assegnata ? `${fmt(m.acqua_assegnata.value, 0)} m³` : '–'}</dd>
      <dt>Dotazione</dt><dd>${fmt(SERBATOIO.dotazioneM3, 0)} m³ a notte</dd>
      <dt>Riserva</dt><dd>${SERBATOIO.riservaPct} % (non si usa)</dd>
      <dt>Pozzo</dt><dd>${SERBATOIO.ricaricaM3h} m³/h</dd>
      <dt>Turni</dt><dd>uno alla volta, ${SERBATOIO.moduloLs} l/s</dd>
    </dl>
    ${
      piano.length
        ? `<ol class="fa-sequenza">${piano
            .map((t) => `<li><button type="button" data-zona="${c.escapeHtml(t.zone)}">Campo ${CAMPI[t.zone].n}</button> ${formatClock(t.inizio)} · ${durata(t.minuti)} · ${fmt(t.litri / 1000, 0)} m³</li>`)
            .join('')}</ol>`
        : ''
    }`;
}

function dettaglioStazione(r, c) {
  const a = r.agg;
  const p = c.extra.previsione;
  const { escapeHtml } = c;
  return `<dl class="cm-d-grid">
      <dt>Temperatura</dt><dd>${a?.media?.temperature_c != null ? `${fmt(a.media.temperature_c)} °C` : '–'}</dd>
      <dt>Umidità aria</dt><dd>${a?.media?.humidity_pct != null ? `${fmt(a.media.humidity_pct, 0)} %` : '–'}</dd>
      <dt>Luce</dt><dd>${a?.media?.light_lux != null ? `${fmt(a.media.light_lux, 0)} lux` : '–'}</dd>
    </dl>
    ${
      p
        ? `<div class="fa-previsione">
            <b>Previsione per domani</b>
            <dl class="cm-d-grid">
              <dt>ET0</dt><dd>${fmt(p.et0Domani)} mm</dd>
              <dt>Pioggia</dt><dd>${fmt(p.pioggiaDomani)} mm${p.probPioggiaDomani != null ? ` <small>(${fmt(p.probPioggiaDomani, 0)} %)</small>` : ''}</dd>
              ${p.tmaxDomani != null ? `<dt>Massima</dt><dd>${fmt(p.tmaxDomani)} °C</dd>` : ''}
              <dt>Fonte</dt><dd>${p.fonte === 'open-meteo' ? 'Open-Meteo (reale)' : 'simulata'}</dd>
            </dl>
            <small>${escapeHtml(p.motivo || '')}${p.modifiche?.length ? ` · scenario: ${escapeHtml(p.modifiche.join(', '))}` : ''}</small>
            ${
              p.fonte !== 'open-meteo' && p.reale
                ? `<small>Open-Meteo reale per ${escapeHtml(p.reale.data || 'domani')}: ET0 ${fmt(p.reale.et0Domani)} mm, pioggia ${fmt(p.reale.pioggiaDomani)} mm.</small>`
                : ''
            }
          </div>`
        : '<p class="muted">In attesa della previsione…</p>'
    }`;
}

function dettaglio(r, c) {
  if (r.luogo.campo) return dettaglioCampo(r, c);
  if (r.zona === SERBATOIO.zona) return dettaglioVasca(r, c);
  return dettaglioStazione(r, c);
}

function etichetta(r) {
  const a = r.agg;
  if (r.luogo.campo) return r.luogo.campo.nome;
  if (r.zona === SERBATOIO.zona) return a?.media?.fill_pct != null ? `Vasca ${fmt(a.media.fill_pct, 0)} %` : 'Vasca';
  return a?.media?.temperature_c != null ? `Meteo ${fmt(a.media.temperature_c)} °C` : 'Meteo';
}

function nota(c) {
  const p = c.extra.previsione;
  const fonte = p
    ? p.fonte === 'open-meteo'
      ? 'previsione reale di <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a> (CC BY 4.0)'
      : `previsione <b>simulata</b> (${c.escapeHtml(p.motivo)}); dati meteo reali da <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a> quando disponibili`
    : 'previsione in arrivo';
  return (
    'Comunità, agricoltori e consorzio fittizi; appezzamenti disegnati sulla mappa OpenStreetMap di San Marzano sul Sarno. ' +
    'Sonde di umidità del suolo simulate (in produzione: sonde capacitive con ESP32) e bilancio idrico semplificato. ' +
    `Kc da FAO-56, soglie e consumi indicativi; giornata simulata di luglio. Meteo: ${fonte}.`
  );
}

/** Configurazione del componente mappa (../mappa.js). */
export const MAPPA = {
  titolo: 'Acqua comune · Agro Nocerino-Sarnese',
  sottotitolo: "Umidità del suolo e turni d'acqua dei campi di San Marzano sul Sarno, aggiornati dai sensori e dal consorzio",
  cerca: 'Cerca un campo o un agricoltore…',
  ariaMappa: 'Mappa dei campi',
  // desktop: campi a destra della legenda; telefono: tutti i luoghi nella mappa (zoom frazionario)
  vista: { centro: [40.7658, 14.6001], zoom: 17, zoomSnap: 0.25, adattaMobile: true, zoomEtichette: 16, zoomVolo: 18 },
  tema: { gradiente: 'linear-gradient(90deg, #2f7d4f 0%, #3f8f55 45%, #7a9a3a 100%)', accento: '#2f7d4f', accentoTesto: '#2f6b44' },
  categorie: CATEGORIE,
  tutte: 'Tutti',
  luoghi: LUOGHI,
  aggrega: aggregaSensori,
  storia: (a) => a.media.soil_moisture_pct ?? a.media.fill_pct ?? null,
  indicatori: INDICATORI,
  sovrapposti: SOVRAPPOSTI,
  colonne: [
    colonna.luogo('Luogo'),
    { titolo: 'Coltura', mobile: false, cella: (r, c) => (r.luogo.campo ? `${c.escapeHtml(COLTURE[r.luogo.campo.coltura].breve)} <small>${c.escapeHtml(r.luogo.campo.fase)}</small>` : '–') },
    colonna.livello(),
    {
      titolo: 'Umidità',
      classe: 'num',
      cella: (r) => (theta(r.agg) != null ? `${fmt(theta(r.agg))} %` : r.agg?.media?.fill_pct != null ? `${fmt(r.agg.media.fill_pct, 0)} % <small>vasca</small>` : '–'),
    },
    { titolo: 'Turno', cella: (r, c) => (r.luogo.campo ? c.escapeHtml(statoTurno(r.zona, c)?.testo ?? '–') : '–') },
    { titolo: 'Litri', classe: 'num', mobile: false, cella: (r, c) => (r.luogo.campo && c.extra.piano?.[r.zona] ? fmt(c.extra.piano[r.zona].litri, 0) : '–') },
    colonna.aggiornato(),
  ],
  dettaglio,
  etichetta,
  classe: (r, c) => (r.luogo.campo && statoTurno(r.zona, c)?.inCorso ? 'cm-acqua' : ''),
  nota,
};

/** Aggiorna i dati "extra" della mappa dagli eventi degli agenti (anche quelli dello stato iniziale). */
function eventi(e, api) {
  const m = api.mappa;
  if (!m) return;
  const x = m.ctx.extra;
  if (e.type === 'agent.decision' && e.source === 'orchestrator') {
    const azioni = e.data?.actions || [];
    if (azioni.some((a) => a.type === 'turno' || a.type === 'rinvio' || a.type === 'nessun_turno')) {
      const piano = Object.fromEntries(azioni.filter((a) => a.zone).map((a) => [a.zone, a]));
      // nuovo piano: restano solo le valvole dei turni già partiti stanotte
      x.valvole = Object.fromEntries(Object.entries(x.valvole || {}).filter(([z]) => piano[z]?.stato === 'avviato'));
      m.setExtra('piano', piano);
    }
    for (const a of azioni) {
      if (a.type === 'apri_valvola') {
        x.valvole = { ...(x.valvole || {}), [a.zone]: { inizio: a.inizio, fine: a.inizio + a.minuti * 60_000, litri: a.litri } };
        m.setExtra('valvole', x.valvole);
      }
    }
  } else if (e.type === 'agent.message' && e.data?.payload?.tipo === 'previsione') {
    m.setExtra('previsione', e.data.payload.previsione);
  } else if (e.type === 'metric') {
    x.metriche = { ...(x.metriche || {}), [e.data.name]: e.data }; // senza ridisegnare: lo fa la prossima lettura
  }
}

/** Configurazione della dashboard (../app.js → avviaDashboard). */
export default {
  id: 'fattoria',
  simConfig: new URL('./sim-config.json', import.meta.url).href,
  demoAgents: async () => (await import('./agents/index.js')).createAgents(),
  firma: 'campi', // agente che deve esserci nel hub perché la pagina usi la modalità live
  notaAltroHub:
    'Il hub raggiungibile da qui esegue un altro scenario, quindi la fattoria gira nel tuo browser (modalità demo). ' +
    'Per la versione con il hub: <code>node shared/iot-agents/example/server.js --scenario fattoria</code>.',
  // in demo il simulatore generico non basta: serve il bilancio idrico che reagisce ai turni
  simulatoreDemo: async (hub, conf) => {
    hub.sim?.stop();
    const { attachFattoria } = await import('./simulatore.js');
    return attachFattoria(hub.core, conf);
  },
  kpi: ['litri_risparmiati', 'campi_in_stress', 'serbatoio_pct', 'acqua_assegnata', 'turni_tagliati', 'pioggia_domani', 'et0_domani', 'umidita_media'],
  mappa: MAPPA,
  eventi,
};
