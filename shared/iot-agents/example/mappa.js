// Componente mappa "in tempo reale" configurabile, ispirato a Seoul Real-Time City Data
// (data.seoul.go.kr/SeoulRtd): luoghi colorati su livelli (di solito 4), vista mappa o lista,
// ricerca, filtro per categoria, scheda di dettaglio, cerchio che pulsa sul luogo più critico
// di ogni categoria, poligoni (es. appezzamenti) e livelli sovrapposti accendibili.
//
// Il componente non sa nulla di Napoli o della fattoria: tutto arriva dalla configurazione
// dello scenario (vedi napoli.js e fattoria/scenario.js). Leaflet arriva da CDN (window.L);
// se manca, resta disponibile la vista lista.
//
//   import { createMappa } from './mappa.js';
//   const mappa = createMappa(document.getElementById('citymap'), config, { ora: () => Date.now() });
//   mappa.update(devices);              // modello della dashboard: deviceId → dispositivo
//   mappa.setExtra('piano', dati);      // dati che non vengono dai sensori (piani, previsioni, API esterne)
//   mappa.aggiungiIndicatore({...});    // nuova modalità (pulsante nella legenda)
//   mappa.aggiungiSovrapposto({...});   // nuovo livello sovrapposto (casella nella legenda)
//
// Configurazione:
// {
//   titolo, sottotitolo, nota,           // testi (nota: HTML o funzione (ctx) → HTML)
//   cerca: 'Cerca un luogo…', ariaMappa: 'Mappa di Napoli', ariaLista?: 'Luogo',
//   vista: { centro: [lat, lon], zoom: 13, zoomMobile?: 12, adattaMobile?: true (su telefono inquadra tutti i luoghi),
//            zoomSnap?: 1 (0.25 = zoom frazionario), zoomEtichette: 14, zoomVolo: 15 },
//   tema?: { gradiente: 'linear-gradient(...)', accento: '#4a6fe0', accentoTesto: '#3f5fcf' },
//   categorie: { id: 'Etichetta' }, tutte: 'Tutti i luoghi',
//   luoghi: { zona: { nome, categoria, lat, lon, poligono?: [[lat, lon], ...], icona?: '…', parole?: [...], ... } },
//     (la chiave è la `location.zone` dei sensori; il punto lat/lon è il marker, anche per i poligoni)
//   aggrega?: (dispositivi, luogo, zona) → aggregato     predefinito: aggregaSensori()
//   storia?: (aggregato, luogo, zona) → numero | null    valore da tenere per la sparkline del dettaglio
//   indicatori: [{ id, label,
//                  livelli: [{ id, label, colore: '#hex', inchiostro?: '#hex', critico?: true }],  dal meno al più critico
//                  valuta: (aggregato, luogo, zona, ctx) → { livello: id, valore: numero } | null }],
//                  (valore serve a ordinare: più alto = più critico; il luogo critico che pulsa è
//                   quello col valore più alto tra i livelli `critico` della sua categoria)
//   colonne: [{ titolo, classe?: 'num', mobile?: false, cella: (riga, ctx) → HTML }],  vista lista
//   dettaglio: (riga, ctx) → HTML,       corpo della scheda (la testata con categoria e nome la fa il componente)
//   etichetta?: (riga, ctx) → testo,     cartellino del marker (predefinito: il nome fino a " · ")
//   classe?: (riga, ctx) → 'classi',     classi CSS in più per marker e poligono (es. un'animazione)
//   escludiAlternative?: [...],          (libero: lo usano le funzioni della configurazione)
//   sovrapposti?: [{ id, label, attivo?: true, crea: ({ L, map, ctx }) → L.Layer, aggiorna?: (layer, ctx) → void }],
// }
//
// `riga` (un luogo pronto da disegnare): { zona, luogo, agg, lv, livelli: { idIndicatore: lv }, critico, storia }
// dove `lv` è il livello nell'indicatore corrente: { id, label, colore, inchiostro, critico, valore } oppure null.
// `ctx`: { stato, extra, luoghi, categorie, indicatore, ora(), riga(zona), livello(zona, idIndicatore),
//          badge(lv, testo?), barra(quota, lv), sparkline, escapeHtml, formatNumber, formatTime, distanzaKm }.

import { escapeHtml, formatNumber, formatTime, sparklineSvg } from '../src/ui-helpers.js';

const STORIA_MAX = 60;
const MOBILE = '(max-width: 760px)';

/** Aggregato generico dei sensori di una zona: conteggi, somme e medie di ogni grandezza numerica. */
export function aggregaSensori(dispositivi) {
  const a = { sensori: 0, reali: 0, ts: 0, n: {}, somma: {}, media: {} };
  for (const d of dispositivi) {
    for (const [k, v] of Object.entries(d.readings || {})) {
      if (typeof v !== 'number') continue;
      a.n[k] = (a.n[k] || 0) + 1;
      a.somma[k] = (a.somma[k] || 0) + v;
    }
    a.sensori++;
    if (!d.simulated) a.reali++;
    a.ts = Math.max(a.ts, d.ts || 0);
  }
  for (const k of Object.keys(a.n)) a.media[k] = a.somma[k] / a.n[k];
  return a;
}

/** Livello per soglie crescenti: `soglie[i]` è il limite superiore (escluso) del livello i. */
export function livelloPerSoglie(valore, livelli, soglie) {
  const i = soglie.findIndex((s) => valore < s);
  return livelli[i === -1 ? livelli.length - 1 : i];
}

/** Distanza approssimata in km (equirettangolare: va bene su scala cittadina). */
export function distanzaKm(a, b) {
  const rad = Math.PI / 180;
  const x = (b.lon - a.lon) * rad * Math.cos(((a.lat + b.lat) / 2) * rad);
  const y = (b.lat - a.lat) * rad;
  return Math.sqrt(x * x + y * y) * 6371;
}

/** Colonne pronte per la vista lista. */
export const colonna = {
  luogo: (titolo = 'Luogo') => ({
    titolo,
    cella: (r) => `${r.critico ? '<span class="cm-ring" title="il più critico della categoria"></span>' : ''}${escapeHtml(r.luogo.nome)}`,
  }),
  categoria: (titolo = 'Categoria') => ({ titolo, mobile: false, cella: (r, c) => escapeHtml(c.categorie[r.luogo.categoria]) }),
  livello: (titolo = 'Livello') => ({ titolo, cella: (r, c) => (r.lv ? c.badge(r.lv) : '<span class="muted">in attesa</span>') }),
  aggiornato: (titolo = 'Aggiornato') => ({ titolo, mobile: false, cella: (r) => (r.agg?.ts ? formatTime(r.agg.ts) : '–') }),
};

const stileLivello = (lv) => (lv?.colore ? `--lv:${lv.colore};--lv-ink:${lv.inchiostro || '#fff'}` : '');
const badge = (lv, testo) => `<span class="cm-badge lvl-${escapeHtml(lv.id)}" style="${stileLivello(lv)}">${escapeHtml(testo ?? lv.label)}</span>`;
const barra = (quota, lv) =>
  `<div class="cm-bar"><span class="lvl-${escapeHtml(lv?.id ?? 'nd')}" style="width:${(Math.max(0, Math.min(1, quota)) * 100).toFixed(0)}%;${stileLivello(lv)}"></span></div>`;

/**
 * @param {HTMLElement} root  contenitore (di solito <section class="panel citymap">), viene riempito
 * @param {object} config     configurazione dello scenario (vedi sopra)
 * @param {{ora?: () => number}} [opts]  ora (simulata) corrente, per le funzioni della configurazione
 */
export function createMappa(root, config, opts = {}) {
  const cfg = {
    cerca: 'Cerca un luogo…',
    tutte: 'Tutti i luoghi',
    colonne: [colonna.luogo(), colonna.categoria(), colonna.livello(), colonna.aggiornato()],
    sovrapposti: [],
    ...config,
  };
  cfg.indicatori = [...(cfg.indicatori || [])];
  cfg.sovrapposti = [...cfg.sovrapposti];
  const vista = { zoom: 13, zoomEtichette: 14, zoomVolo: 15, ...(cfg.vista || {}) };
  const LUOGHI = cfg.luoghi;
  const CATEGORIE = cfg.categorie;

  root.innerHTML = scheletro(cfg);
  if (cfg.tema?.gradiente) root.style.setProperty('--cm-grad', cfg.tema.gradiente);
  if (cfg.tema?.accento) root.style.setProperty('--cm-accento', cfg.tema.accento);
  if (cfg.tema?.accentoTesto) root.style.setProperty('--cm-accento-testo', cfg.tema.accentoTesto);

  const $ = (sel) => root.querySelector(sel);
  const ui = {
    map: $('.cm-map'),
    list: $('.cm-list'),
    modi: $('.cm-modi'),
    legend: $('.cm-legend'),
    layers: $('.cm-layers'),
    cats: $('.cm-cats'),
    detail: $('.cm-detail'),
    search: $('.cm-search input'),
    results: $('.cm-results'),
    note: $('.cm-note'),
  };
  const stato = {
    vista: 'mappa', // mappa | lista
    modo: cfg.indicatori[0]?.id ?? null,
    categoria: 'tutte',
    selezionato: null,
    zone: {}, // zona → aggregato
    storia: {}, // zona → [[ts, valore]]
    sovrapposti: Object.fromEntries(cfg.sovrapposti.map((s) => [s.id, s.attivo !== false])),
  };
  const extra = {};

  // ---------------------------------------------------------------- contesto per le funzioni della configurazione
  const ctx = {
    stato,
    extra,
    luoghi: LUOGHI,
    categorie: CATEGORIE,
    get indicatore() {
      return indicatore();
    },
    ora: () => (opts.ora ? opts.ora() : Date.now()),
    riga: (zona) => riga(zona),
    livello: (zona, id) => livello(zona, id),
    badge,
    barra,
    sparkline: sparklineSvg,
    escapeHtml,
    formatNumber,
    formatTime,
    distanzaKm,
  };

  // ---------------------------------------------------------------- mappa Leaflet
  const L = window.L;
  let map = null;
  const marker = {};
  const poligono = {};
  const strati = {}; // id sovrapposto → layer
  if (L) {
    const mobile = matchMedia(MOBILE).matches;
    const zoom0 = (mobile && vista.zoomMobile) || vista.zoom;
    map = L.map(ui.map, { zoomControl: false, attributionControl: true, scrollWheelZoom: false, zoomSnap: vista.zoomSnap ?? 1 }).setView(vista.centro, zoom0);
    L.control.zoom({ position: 'topright' }).addTo(map);
    const scuro = matchMedia('(prefers-color-scheme: dark)').matches && document.documentElement.dataset.theme !== 'light';
    // Tessere OpenStreetMap standard (gratuite con attribuzione, adatte a una demo a basso traffico).
    // Tema scuro: filtro CSS sulle tessere (classe cm-dark sul contenitore).
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    ui.map.classList.toggle('cm-dark', scuro);
    const zoomClass = () => ui.map.classList.toggle('cm-zoom-alto', map.getZoom() >= vista.zoomEtichette);
    map.on('zoomend', zoomClass);
    zoomClass();
    map.on('click', () => seleziona(null));
    for (const s of cfg.sovrapposti) creaSovrapposto(s);
    for (const [zona, l] of Object.entries(LUOGHI)) {
      if (Array.isArray(l.poligono) && l.poligono.length > 2) {
        poligono[zona] = L.polygon(l.poligono, { weight: 2, color: '#9a9993', fillColor: '#9a9993', fillOpacity: 0.4, className: 'cm-poly' })
          .on('click', (e) => {
            L.DomEvent.stopPropagation(e);
            seleziona(zona);
          })
          .addTo(map);
      }
      marker[zona] = L.marker([l.lat, l.lon], { icon: icona(zona), riseOnHover: true, keyboard: true, title: l.nome })
        .on('click', (e) => {
          L.DomEvent.stopPropagation(e);
          seleziona(zona);
        })
        .addTo(map);
    }
    if (mobile && vista.adattaMobile) {
      const punti = Object.values(LUOGHI).flatMap((l) => (l.poligono?.length ? l.poligono : [[l.lat, l.lon]]));
      map.fitBounds(L.latLngBounds(punti), { padding: [16, 16] });
    }
    // la mappa nasce dentro un layout che può cambiare dimensione
    new ResizeObserver(() => map.invalidateSize()).observe(ui.map);
  } else {
    stato.vista = 'lista';
    ui.map.innerHTML = '<p class="empty">Mappa non disponibile (Leaflet non caricato): uso la vista lista.</p>';
  }

  function creaSovrapposto(s) {
    if (!map || strati[s.id]) return;
    try {
      strati[s.id] = s.crea({ L, map, ctx });
      if (strati[s.id] && stato.sovrapposti[s.id]) strati[s.id].addTo(map);
    } catch (err) {
      console.error(`[mappa] livello sovrapposto "${s.id}" non creato:`, err);
    }
  }

  // ---------------------------------------------------------------- controlli
  root.querySelectorAll('[data-vista]').forEach((b) =>
    b.addEventListener('click', () => {
      stato.vista = b.dataset.vista;
      render();
    }),
  );
  ui.modi.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-modo]');
    if (!b) return;
    stato.modo = b.dataset.modo;
    render();
  });
  ui.layers.addEventListener('change', (e) => {
    const c = e.target.closest('input[data-strato]');
    if (!c) return;
    stato.sovrapposti[c.dataset.strato] = c.checked;
    const layer = strati[c.dataset.strato];
    if (layer && map) c.checked ? layer.addTo(map) : layer.remove();
    render();
  });
  ui.cats.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-cat]');
    if (!b) return;
    stato.categoria = b.dataset.cat;
    render();
  });
  ui.list.addEventListener('click', (e) => {
    const tr = e.target.closest('[data-zona]');
    if (tr) seleziona(tr.dataset.zona, { vola: true, vista: 'mappa' });
  });
  ui.list.addEventListener('keydown', (e) => {
    const tr = e.target.closest('[data-zona]');
    if (tr && e.key === 'Enter') seleziona(tr.dataset.zona, { vola: true, vista: 'mappa' });
  });
  ui.search.addEventListener('input', renderRisultati);
  ui.search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const primo = ui.results.querySelector('[data-zona]');
      if (primo) seleziona(primo.dataset.zona, { vola: true, vista: 'mappa' });
      ui.search.blur();
    } else if (e.key === 'Escape') {
      ui.search.value = '';
      renderRisultati();
    }
  });
  ui.results.addEventListener('click', (e) => {
    const b = e.target.closest('[data-zona]');
    if (b) seleziona(b.dataset.zona, { vola: true, vista: 'mappa' });
  });
  ui.detail.addEventListener('click', (e) => {
    if (e.target.closest('[data-chiudi]')) seleziona(null);
    const alt = e.target.closest('[data-zona]');
    if (alt) seleziona(alt.dataset.zona, { vola: true });
  });

  function seleziona(zona, { vola = false, vista: v } = {}) {
    stato.selezionato = zona && LUOGHI[zona] ? zona : null;
    if (v) stato.vista = v;
    ui.search.value = '';
    renderRisultati();
    if (stato.selezionato && vola && map) map.flyTo([LUOGHI[zona].lat, LUOGHI[zona].lon], vista.zoomVolo, { duration: 0.6 });
    render();
  }

  // ---------------------------------------------------------------- dati
  /** Aggrega i sensori per zona. `devices` è il modello della dashboard (deviceId → dispositivo). */
  function update(devices) {
    const perZona = {};
    for (const d of Object.values(devices)) {
      if (LUOGHI[d.zone]) (perZona[d.zone] ||= []).push(d);
    }
    const agg = {};
    for (const [z, lista] of Object.entries(perZona)) {
      const a = cfg.aggrega ? cfg.aggrega(lista, LUOGHI[z], z) : aggregaSensori(lista);
      agg[z] = a;
      const v = cfg.storia ? cfg.storia(a, LUOGHI[z], z) : null;
      if (typeof v === 'number') {
        const h = (stato.storia[z] ||= []);
        if (!h.length || a.ts > h[h.length - 1][0]) h.push([a.ts, v]);
        if (h.length > STORIA_MAX) h.shift();
      }
    }
    stato.zone = agg;
    render();
  }

  function indicatore(id = stato.modo) {
    return cfg.indicatori.find((i) => i.id === id) ?? null;
  }

  /** Livello del luogo in un indicatore (predefinito: quello corrente). */
  function livello(zona, id = stato.modo) {
    const ind = indicatore(id);
    const a = stato.zone[zona];
    if (!ind || !LUOGHI[zona]) return null;
    let r;
    try {
      r = ind.valuta(a, LUOGHI[zona], zona, ctx);
    } catch (err) {
      console.error(`[mappa] indicatore "${ind.id}" in errore su ${zona}:`, err);
      return null;
    }
    if (!r) return null;
    const def = ind.livelli.find((l) => l.id === r.livello);
    return def ? { ...def, valore: r.valore ?? 0 } : null;
  }

  function riga(zona, critici = piuCritici()) {
    return {
      zona,
      luogo: LUOGHI[zona],
      agg: stato.zone[zona],
      lv: livello(zona),
      livelli: Object.fromEntries(cfg.indicatori.map((i) => [i.id, livello(zona, i.id)])),
      critico: critici.has(zona),
      storia: stato.storia[zona] || [],
    };
  }

  /** Il luogo più critico di ogni categoria (solo livelli `critico`): pulsa, come a Seoul. */
  function piuCritici() {
    const top = {};
    for (const [z, l] of Object.entries(LUOGHI)) {
      const lv = livello(z);
      if (!lv || !lv.critico) continue;
      if (!top[l.categoria] || lv.valore > top[l.categoria].valore) top[l.categoria] = { zona: z, valore: lv.valore };
    }
    return new Set(Object.values(top).map((t) => t.zona));
  }

  const visibile = (zona) => stato.categoria === 'tutte' || LUOGHI[zona].categoria === stato.categoria;
  const etichetta = (r) => (cfg.etichetta ? cfg.etichetta(r, ctx) : r.luogo.nome.split(' · ')[0]);
  const classiExtra = (r) => (cfg.classe ? cfg.classe(r, ctx) || '' : '');

  // ---------------------------------------------------------------- rendering
  function icona(zona, r = null) {
    const l = LUOGHI[zona];
    const lv = r?.lv;
    const cls = `cm-pin lvl-${lv?.id ?? 'nd'}${r?.critico ? ' pulsa' : ''}${stato.selezionato === zona ? ' sel' : ''}${l.icona ? ' cm-con-icona' : ''}${r ? ' ' + classiExtra(r) : ''}`;
    const testo = r ? etichetta(r) : l.nome.split(' · ')[0];
    return L.divIcon({
      className: 'cm-icon',
      html: `<div class="${cls.trim()}" style="${stileLivello(lv)}"><span class="cm-dot">${l.icona ? escapeHtml(l.icona) : ''}</span><span class="cm-label">${escapeHtml(testo)}</span></div>`,
      iconSize: [0, 0],
    });
  }

  function render() {
    root.querySelectorAll('[data-vista]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.vista === stato.vista)));
    ui.map.hidden = stato.vista !== 'mappa';
    ui.list.hidden = stato.vista !== 'lista';
    if (map && stato.vista === 'mappa') map.invalidateSize();

    const critici = piuCritici();
    const righe = Object.fromEntries(Object.keys(LUOGHI).map((z) => [z, riga(z, critici)]));
    if (map) {
      for (const zona of Object.keys(LUOGHI)) {
        const m = marker[zona];
        const p = poligono[zona];
        const vis = visibile(zona);
        const r = righe[zona];
        for (const layer of [p, m]) {
          if (!layer) continue;
          if (vis && !map.hasLayer(layer)) layer.addTo(map);
          if (!vis && map.hasLayer(layer)) layer.remove();
        }
        if (!vis) continue;
        m.setIcon(icona(zona, r));
        m.setZIndexOffset(stato.selezionato === zona ? 1000 : critici.has(zona) ? 500 : 0);
        if (p) {
          const colore = r.lv?.colore || '#9a9993';
          const sel = stato.selezionato === zona;
          p.setStyle({ color: sel ? '#1d1d1b' : colore, fillColor: colore, weight: sel ? 4 : 2, fillOpacity: sel ? 0.55 : 0.4 });
          const el = p.getElement?.();
          if (el) el.setAttribute('class', `leaflet-interactive cm-poly ${classiExtra(r)}${sel ? ' sel' : ''}${r.critico ? ' pulsa' : ''}`.trim());
        }
      }
      for (const s of cfg.sovrapposti) {
        if (stato.sovrapposti[s.id] && strati[s.id] && s.aggiorna) {
          try {
            s.aggiorna(strati[s.id], ctx);
          } catch (err) {
            console.error(`[mappa] livello sovrapposto "${s.id}" in errore:`, err);
          }
        }
      }
    }
    renderModi();
    renderLegenda();
    renderSovrapposti();
    renderCategorie();
    renderLista(righe);
    renderDettaglio(righe);
    if (typeof cfg.nota === 'function') ui.note.innerHTML = cfg.nota(ctx);
  }

  function renderModi() {
    const html = cfg.indicatori
      .map((i) => `<button type="button" data-modo="${escapeHtml(i.id)}" aria-pressed="${stato.modo === i.id}">${escapeHtml(i.label)}</button>`)
      .join('');
    if (ui.modi.innerHTML !== html) ui.modi.innerHTML = html;
    ui.modi.hidden = cfg.indicatori.length < 2;
  }

  function renderLegenda() {
    const ind = indicatore();
    if (!ind) {
      ui.legend.innerHTML = '';
      return;
    }
    const conteggi = Object.fromEntries(ind.livelli.map((l) => [l.id, 0]));
    for (const z of Object.keys(LUOGHI)) {
      if (!visibile(z)) continue;
      const lv = livello(z);
      if (lv) conteggi[lv.id]++;
    }
    ui.legend.innerHTML = [...ind.livelli]
      .reverse()
      .map((l) => `<li><span class="cm-sw lvl-${escapeHtml(l.id)}" style="${stileLivello(l)}"></span>${escapeHtml(l.label)}<b>${conteggi[l.id]}</b></li>`)
      .join('');
  }

  function renderSovrapposti() {
    ui.layers.hidden = !cfg.sovrapposti.length || !map;
    const html = cfg.sovrapposti
      .map(
        (s) =>
          `<label><input type="checkbox" data-strato="${escapeHtml(s.id)}"${stato.sovrapposti[s.id] ? ' checked' : ''} />${escapeHtml(s.label)}</label>`,
      )
      .join('');
    if (ui.layers.dataset.html !== html) {
      ui.layers.innerHTML = html;
      ui.layers.dataset.html = html;
    }
  }

  function renderCategorie() {
    const voci = [['tutte', cfg.tutte], ...Object.entries(CATEGORIE)];
    ui.cats.innerHTML = voci
      .map(([id, label]) => `<button type="button" data-cat="${escapeHtml(id)}" aria-pressed="${stato.categoria === id}">${escapeHtml(label)}</button>`)
      .join('');
  }

  function renderLista(righe) {
    const lista = Object.keys(LUOGHI)
      .filter(visibile)
      .map((z) => righe[z])
      .sort((x, y) => (y.lv?.valore ?? -1) - (x.lv?.valore ?? -1));
    const cl = (c) => [c.classe, c.mobile === false ? 'cm-m-hide' : ''].filter(Boolean).join(' ');
    ui.list.innerHTML = `<table class="cm-table">
      <thead><tr>${cfg.colonne.map((c) => `<th${cl(c) ? ` class="${cl(c)}"` : ''}>${escapeHtml(c.titolo)}</th>`).join('')}</tr></thead>
      <tbody>${lista
        .map(
          (r) => `<tr data-zona="${escapeHtml(r.zona)}" tabindex="0" class="${stato.selezionato === r.zona ? 'sel' : ''}">
            ${cfg.colonne.map((c) => `<td${cl(c) ? ` class="${cl(c)}"` : ''}>${c.cella(r, ctx)}</td>`).join('')}
          </tr>`,
        )
        .join('')}</tbody></table>`;
  }

  function renderRisultati() {
    const q = ui.search.value.trim().toLowerCase();
    if (!q) {
      ui.results.hidden = true;
      ui.results.innerHTML = '';
      return;
    }
    const trovati = Object.entries(LUOGHI).filter(([, l]) =>
      [l.nome, CATEGORIE[l.categoria], ...(l.parole || [])].some((s) => String(s ?? '').toLowerCase().includes(q)),
    );
    ui.results.hidden = false;
    ui.results.innerHTML = trovati.length
      ? trovati.map(([z, l]) => `<li><button type="button" data-zona="${escapeHtml(z)}">${escapeHtml(l.nome)}<small>${escapeHtml(CATEGORIE[l.categoria])}</small></button></li>`).join('')
      : '<li class="muted">Nessun luogo trovato</li>';
  }

  function renderDettaglio(righe) {
    const z = stato.selezionato;
    if (!z) {
      ui.detail.hidden = true;
      return;
    }
    const r = righe[z];
    ui.detail.hidden = false;
    ui.detail.innerHTML = `
      <div class="cm-d-head">
        <div><div class="cm-d-cat">${escapeHtml(CATEGORIE[r.luogo.categoria])}</div><h3>${escapeHtml(r.luogo.nome)}</h3></div>
        <button type="button" class="cm-close" data-chiudi aria-label="Chiudi">×</button>
      </div>
      ${cfg.dettaglio ? cfg.dettaglio(r, ctx) : r.agg ? '' : '<p class="muted">In attesa dei dati dei sensori di questo luogo…</p>'}`;
  }

  render();
  if (typeof cfg.nota !== 'function' && cfg.nota !== undefined) ui.note.innerHTML = cfg.nota;

  return {
    update,
    /** Dati non dai sensori, letti dalle funzioni della configurazione come `ctx.extra[nome]`. */
    setExtra(nome, valore) {
      extra[nome] = valore;
      render();
    },
    seleziona,
    /** Aggiunge una modalità (indicatore) a mappa avviata: compare un pulsante nella legenda. */
    aggiungiIndicatore(def) {
      cfg.indicatori = cfg.indicatori.filter((i) => i.id !== def.id).concat(def);
      stato.modo ??= def.id;
      render();
    },
    /** Aggiunge un livello sovrapposto (es. linee dei trasporti, eventi, qualità dell'aria). */
    aggiungiSovrapposto(def) {
      if (cfg.sovrapposti.some((s) => s.id === def.id)) return;
      cfg.sovrapposti.push(def);
      stato.sovrapposti[def.id] = def.attivo !== false;
      creaSovrapposto(def);
      render();
    },
    render,
    ctx,
    get map() {
      return map;
    },
  };
}

/** Struttura HTML del componente (stessi id e classi della versione originale). */
function scheletro(cfg) {
  const aria = escapeHtml(String(cfg.cerca).replace(/…$/, ''));
  return `
    <div class="cm-head">
      <div class="cm-title">
        <h2 id="h-map">${escapeHtml(cfg.titolo)}</h2>
        <p class="cm-sub">${escapeHtml(cfg.sottotitolo || '')}</p>
      </div>
      <div class="cm-tools">
        <div class="cm-seg" role="group" aria-label="Vista">
          <button type="button" data-vista="lista" aria-pressed="false">☰ Lista</button>
          <button type="button" data-vista="mappa" aria-pressed="true">◉ Mappa</button>
        </div>
        <div class="cm-search">
          <input id="cm-search" type="search" placeholder="${escapeHtml(cfg.cerca)}" aria-label="${aria}" autocomplete="off" />
          <ul id="cm-results" class="cm-results" hidden></ul>
        </div>
      </div>
    </div>
    <div class="cm-body">
      <div id="cm-map" class="cm-map" aria-label="${escapeHtml(cfg.ariaMappa || 'Mappa')}"></div>
      <div id="cm-list" class="cm-list" hidden></div>
      <aside class="cm-side" aria-label="Legenda e filtri">
        <div class="cm-seg small cm-modi" role="group" aria-label="Indicatore"></div>
        <ul id="cm-legend" class="cm-legend"></ul>
        <div class="cm-layers" role="group" aria-label="Livelli sovrapposti" hidden></div>
        <div id="cm-cats" class="cm-cats"></div>
      </aside>
      <aside id="cm-detail" class="cm-detail" aria-live="polite" hidden></aside>
    </div>
    <p class="cm-note"></p>`;
}
