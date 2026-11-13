// Mappa "Napoli in tempo reale", ispirata a Seoul Real-Time City Data (data.seoul.go.kr/SeoulRtd):
// luoghi colorati su 4 livelli, vista mappa o lista, ricerca, filtro per categoria,
// scheda di dettaglio e cerchio che pulsa sul luogo più critico di ogni categoria.
// Leaflet arriva da CDN (window.L); se manca, resta disponibile la vista lista.

import { CATEGORIE, LUOGHI, LIVELLI_FOLLA, LIVELLI_CALDO, livelloFolla, livelloCaldo, distanzaKm } from './luoghi.js';
import { escapeHtml, formatNumber, formatTime, sparklineSvg } from '../src/ui-helpers.js';

const CENTRO = [40.8435, 14.2420];
const STORIA_MAX = 60;

export function createMappa(root) {
  const $ = (sel) => root.querySelector(sel);
  const ui = {
    map: $('#cm-map'),
    list: $('#cm-list'),
    legend: $('#cm-legend'),
    cats: $('#cm-cats'),
    detail: $('#cm-detail'),
    search: $('#cm-search'),
    results: $('#cm-results'),
  };
  const stato = {
    vista: 'mappa', // mappa | lista
    modo: 'folla', // folla | caldo
    categoria: 'tutte',
    selezionato: null,
    zone: {}, // zona → aggregato
    storia: {}, // zona → [[ts, persone]]
  };

  // ---------------------------------------------------------------- mappa Leaflet
  const L = window.L;
  let map = null;
  const marker = {};
  if (L) {
    map = L.map(ui.map, { zoomControl: false, attributionControl: true, scrollWheelZoom: false }).setView(CENTRO, 13);
    L.control.zoom({ position: 'topright' }).addTo(map);
    const scuro = matchMedia('(prefers-color-scheme: dark)').matches && document.documentElement.dataset.theme !== 'light';
    // Tessere OpenStreetMap standard (gratuite con attribuzione, adatte a una demo a basso traffico).
    // Tema scuro: filtro CSS sulle tessere (classe cm-dark sul contenitore).
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    ui.map.classList.toggle('cm-dark', scuro);
    const zoomClass = () => ui.map.classList.toggle('cm-zoom-alto', map.getZoom() >= 14);
    map.on('zoomend', zoomClass);
    zoomClass();
    map.on('click', () => seleziona(null));
    for (const [zona, l] of Object.entries(LUOGHI)) {
      marker[zona] = L.marker([l.lat, l.lon], { icon: icona(zona), riseOnHover: true, keyboard: true, title: l.nome })
        .on('click', (e) => {
          L.DomEvent.stopPropagation(e);
          seleziona(zona);
        })
        .addTo(map);
    }
    // la mappa nasce dentro un layout che può cambiare dimensione
    new ResizeObserver(() => map.invalidateSize()).observe(ui.map);
  } else {
    stato.vista = 'lista';
    ui.map.innerHTML = '<p class="empty">Mappa non disponibile (Leaflet non caricato): uso la vista lista.</p>';
  }

  // ---------------------------------------------------------------- controlli
  root.querySelectorAll('[data-vista]').forEach((b) =>
    b.addEventListener('click', () => {
      stato.vista = b.dataset.vista;
      render();
    }),
  );
  root.querySelectorAll('[data-modo]').forEach((b) =>
    b.addEventListener('click', () => {
      stato.modo = b.dataset.modo;
      render();
    }),
  );
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

  function seleziona(zona, { vola = false, vista } = {}) {
    stato.selezionato = zona;
    if (vista) stato.vista = vista;
    ui.search.value = '';
    renderRisultati();
    if (zona && vola && map) map.flyTo([LUOGHI[zona].lat, LUOGHI[zona].lon], 15, { duration: 0.6 });
    render();
  }

  // ---------------------------------------------------------------- dati
  /** Aggrega i sensori per zona. `devices` è il modello della dashboard (deviceId → dispositivo). */
  function update(devices) {
    const agg = {};
    for (const d of Object.values(devices)) {
      const z = d.zone;
      if (!LUOGHI[z]) continue;
      const a = (agg[z] ||= { persone: 0, conPersone: 0, temp: [], umid: [], sensori: 0, reali: 0, ts: 0 });
      const r = d.readings || {};
      if (typeof r.people_count === 'number') {
        a.persone += r.people_count;
        a.conPersone++;
      }
      if (typeof r.temperature_c === 'number') a.temp.push(r.temperature_c);
      if (typeof r.humidity_pct === 'number') a.umid.push(r.humidity_pct);
      a.sensori++;
      if (!d.simulated) a.reali++;
      a.ts = Math.max(a.ts, d.ts || 0);
    }
    for (const [z, a] of Object.entries(agg)) {
      a.temperatura = media(a.temp);
      a.umidita = media(a.umid);
      if (a.conPersone) {
        const h = (stato.storia[z] ||= []);
        if (!h.length || a.ts > h[h.length - 1][0]) h.push([a.ts, a.persone]);
        if (h.length > STORIA_MAX) h.shift();
      }
    }
    stato.zone = agg;
    render();
  }

  /** Livello del luogo nella modalità corrente: { id, label, valore (0..1+ per ordinare) } */
  function livello(zona) {
    const a = stato.zone[zona];
    if (!a) return null;
    if (stato.modo === 'folla') {
      if (!a.conPersone) return null;
      const l = livelloFolla(a.persone, LUOGHI[zona].capienza);
      return { ...l, valore: a.persone / LUOGHI[zona].capienza };
    }
    if (a.temperatura == null) return null;
    const l = livelloCaldo(a.temperatura);
    return { ...l, valore: a.temperatura };
  }

  /** Il luogo più critico di ogni categoria (livello almeno "vivace"): pulsa, come a Seoul. */
  function piuCritici() {
    const top = {};
    for (const [z, l] of Object.entries(LUOGHI)) {
      const lv = livello(z);
      if (!lv || (lv.id !== 'vivace' && lv.id !== 'affollato')) continue;
      if (!top[l.categoria] || lv.valore > top[l.categoria].valore) top[l.categoria] = { zona: z, valore: lv.valore };
    }
    return new Set(Object.values(top).map((t) => t.zona));
  }

  const visibile = (zona) => stato.categoria === 'tutte' || LUOGHI[zona].categoria === stato.categoria;

  // ---------------------------------------------------------------- rendering
  function icona(zona, lv, pulsa = false, sel = false) {
    const l = LUOGHI[zona];
    const cls = `cm-pin lvl-${lv?.id ?? 'nd'}${pulsa ? ' pulsa' : ''}${sel ? ' sel' : ''}`;
    return L.divIcon({
      className: 'cm-icon',
      html: `<div class="${cls}"><span class="cm-dot"></span><span class="cm-label">${escapeHtml(l.nome.split(' · ')[0])}</span></div>`,
      iconSize: [0, 0],
    });
  }

  function render() {
    root.querySelectorAll('[data-vista]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.vista === stato.vista)));
    root.querySelectorAll('[data-modo]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.modo === stato.modo)));
    ui.map.hidden = stato.vista !== 'mappa';
    ui.list.hidden = stato.vista !== 'lista';
    if (map && stato.vista === 'mappa') map.invalidateSize();

    const critici = piuCritici();
    if (map) {
      for (const zona of Object.keys(LUOGHI)) {
        const m = marker[zona];
        const vis = visibile(zona);
        if (vis && !map.hasLayer(m)) m.addTo(map);
        if (!vis && map.hasLayer(m)) m.remove();
        if (vis) {
          m.setIcon(icona(zona, livello(zona), critici.has(zona), stato.selezionato === zona));
          m.setZIndexOffset(stato.selezionato === zona ? 1000 : critici.has(zona) ? 500 : 0);
        }
      }
    }
    renderLegenda();
    renderCategorie();
    renderLista(critici);
    renderDettaglio();
  }

  function renderLegenda() {
    const livelli = stato.modo === 'folla' ? LIVELLI_FOLLA : LIVELLI_CALDO;
    const conteggi = Object.fromEntries(livelli.map((l) => [l.id, 0]));
    for (const z of Object.keys(LUOGHI)) {
      if (!visibile(z)) continue;
      const lv = livello(z);
      if (lv) conteggi[lv.id]++;
    }
    ui.legend.innerHTML = [...livelli]
      .reverse()
      .map((l) => `<li><span class="cm-sw lvl-${l.id}"></span>${escapeHtml(l.label)}<b>${conteggi[l.id]}</b></li>`)
      .join('');
  }

  function renderCategorie() {
    const voci = [['tutte', 'Tutti i luoghi'], ...Object.entries(CATEGORIE)];
    ui.cats.innerHTML = voci
      .map(([id, label]) => `<button type="button" data-cat="${id}" aria-pressed="${stato.categoria === id}">${escapeHtml(label)}</button>`)
      .join('');
  }

  function renderLista(critici) {
    const righe = Object.keys(LUOGHI)
      .filter(visibile)
      .map((z) => ({ z, l: LUOGHI[z], a: stato.zone[z], lv: livello(z) }))
      .sort((x, y) => (y.lv?.valore ?? -1) - (x.lv?.valore ?? -1));
    ui.list.innerHTML = `<table class="cm-table">
      <thead><tr><th>Luogo</th><th>Categoria</th><th>Livello</th><th class="num">Persone stimate</th><th class="num">Temperatura</th><th>Aggiornato</th></tr></thead>
      <tbody>${righe
        .map(
          ({ z, l, a, lv }) => `<tr data-zona="${z}" tabindex="0" class="${stato.selezionato === z ? 'sel' : ''}">
            <td>${critici.has(z) ? '<span class="cm-ring" title="il più critico della categoria"></span>' : ''}${escapeHtml(l.nome)}</td>
            <td>${escapeHtml(CATEGORIE[l.categoria])}</td>
            <td>${lv ? `<span class="cm-badge lvl-${lv.id}">${escapeHtml(lv.label)}</span>` : '<span class="muted">in attesa</span>'}</td>
            <td class="num">${a?.conPersone ? `${formatNumber(a.persone, 0)} <small>/ ${formatNumber(l.capienza, 0)}</small>` : '–'}</td>
            <td class="num">${a?.temperatura != null ? `${formatNumber(a.temperatura, 1)} °C` : '–'}</td>
            <td>${a?.ts ? formatTime(a.ts) : '–'}</td>
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
    const trovati = Object.entries(LUOGHI).filter(([, l]) => l.nome.toLowerCase().includes(q) || CATEGORIE[l.categoria].toLowerCase().includes(q));
    ui.results.hidden = false;
    ui.results.innerHTML = trovati.length
      ? trovati.map(([z, l]) => `<li><button type="button" data-zona="${z}">${escapeHtml(l.nome)}<small>${escapeHtml(CATEGORIE[l.categoria])}</small></button></li>`).join('')
      : '<li class="muted">Nessun luogo trovato</li>';
  }

  function renderDettaglio() {
    const z = stato.selezionato;
    if (!z) {
      ui.detail.hidden = true;
      return;
    }
    const l = LUOGHI[z];
    const a = stato.zone[z];
    const folla = a?.conPersone ? livelloFolla(a.persone, l.capienza) : null;
    const caldo = a?.temperatura != null ? livelloCaldo(a.temperatura) : null;
    const quota = a?.conPersone ? Math.min(1, a.persone / l.capienza) : 0;
    const h = stato.storia[z] || [];
    const alt = folla && (folla.id === 'vivace' || folla.id === 'affollato') ? alternativa(z) : null;
    ui.detail.hidden = false;
    ui.detail.innerHTML = `
      <div class="cm-d-head">
        <div><div class="cm-d-cat">${escapeHtml(CATEGORIE[l.categoria])}</div><h3>${escapeHtml(l.nome)}</h3></div>
        <button type="button" class="cm-close" data-chiudi aria-label="Chiudi">×</button>
      </div>
      ${
        a
          ? `<div class="cm-d-levels">
              ${folla ? `<span class="cm-badge lvl-${folla.id}">Folla: ${escapeHtml(folla.label)}</span>` : ''}
              ${caldo ? `<span class="cm-badge lvl-${caldo.id}">${escapeHtml(caldo.label)}</span>` : ''}
            </div>
            ${
              a.conPersone
                ? `<div class="cm-d-num"><b>${formatNumber(a.persone, 0)}</b> persone stimate <small>· soglia ${formatNumber(l.capienza, 0)}</small></div>
                   <div class="cm-bar"><span class="lvl-${folla.id}" style="width:${(quota * 100).toFixed(0)}%"></span></div>
                   ${h.length > 2 ? `<div class="cm-d-spark">${sparklineSvg(h, { width: 260, height: 40 })}<small>andamento recente</small></div>` : ''}`
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
            }`
          : '<p class="muted">In attesa dei dati dei sensori di questo luogo…</p>'
      }`;
  }

  function alternativa(zona) {
    const da = LUOGHI[zona];
    return (
      Object.entries(LUOGHI)
        .filter(([z]) => z !== zona && z !== 'maradona' && stato.zone[z]?.conPersone)
        .map(([z, l]) => ({ zona: z, nome: l.nome, km: distanzaKm(da, l), ...livelloFolla(stato.zone[z].persone, l.capienza) }))
        .filter((c) => c.id === 'tranquillo' || c.id === 'normale')
        .sort((x, y) => x.km - y.km)[0] ?? null
    );
  }

  render();
  return { update };
}

function media(arr) {
  return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null;
}
