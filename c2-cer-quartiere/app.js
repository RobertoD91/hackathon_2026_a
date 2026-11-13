// Dashboard della CER. Funziona in due modi senza cambiare codice:
// - "live": servita dal hub (node c2-cer-quartiere/server.js) → dati via /api/state e SSE;
// - "demo": su GitHub Pages o senza backend → simulatore e agenti girano nel browser.
// Solo percorsi relativi (la pagina è servita anche sotto /hackathon_2026_a/...).
//
// Parametri dell'URL: ?demo=1 (forza la demo), ?previsione=simulata|open-meteo|auto (solo demo),
// ?api=http://host:8703 (hub remoto), ?tema=scuro|chiaro.

import { connectHub } from '../shared/iot-agents/src/client.js';
import { escapeHtml as esc } from '../shared/iot-agents/src/ui-helpers.js';
import { PARAMETRI } from './model/parametri.js';
import { FAMIGLIE, CER } from './model/quartiere.js';

const $ = (id) => document.getElementById(id);
const q = new URLSearchParams(location.search);
if (q.get('tema') === 'scuro') document.documentElement.dataset.theme = 'dark';
if (q.get('tema') === 'chiaro') document.documentElement.dataset.theme = 'light';

const fmt = (x, d = 1) =>
  typeof x === 'number' && Number.isFinite(x) ? new Intl.NumberFormat('it-IT', { maximumFractionDigits: d }).format(x) : '—';
const fmtFix = (x, d = 2) =>
  typeof x === 'number' && Number.isFinite(x) ? new Intl.NumberFormat('it-IT', { minimumFractionDigits: d, maximumFractionDigits: d }).format(x) : '—';
const pct = (x) => `${fmt((x || 0) * 100, 0)}%`;
const hhmm = (h) => {
  const m = Math.round(h * 60);
  return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};
const signed = (x, d = 1) => `${x >= 0 ? '+' : '−'}${fmt(Math.abs(x), d)}`;

const GRUPPO = CER.gruppoWhatsapp;
const famById = Object.fromEntries(FAMIGLIE.map((f) => [f.id, f]));

const model = {
  stato: null,
  speed: 1,
  vista: 'con',
  flowFilter: 'tutto',
  flow: [],
  convs: new Map(),
  current: 'famiglia-russo',
};

// ------------------------------------------------------------------ connessione

const hub = await connectHub({
  simConfig: './sim-config.json',
  demoAgents: async () => (await import('./agents/index.js')).createAgents({ previsione: q.get('previsione') || 'auto' }),
});

async function start() {
  $('mode').textContent = hub.mode === 'live' ? 'LIVE · hub' : 'DEMO · nel browser';
  $('mode').classList.add(hub.mode);
  $('demo-note').hidden = hub.mode !== 'demo';
  hub.onStatus((s) => {
    const el = $('conn');
    el.className = `conn ${s}`;
    el.textContent = { connected: 'collegato al hub', reconnecting: 'riconnessione…', demo: 'simulazione locale' }[s] || s;
  });

  initConvs();
  renderScenarioButtons();
  renderParams();
  bindUi();

  const init = await hub.getState();
  model.speed = init.speed || 1;
  const storico = [
    ...(init.messages || []),
    ...(init.decisions || []),
    ...(init.notifications || []),
    ...(init.chats || []),
  ].sort((a, b) => a.ts - b.ts);
  for (const e of storico) onEvent(e, { storico: true });
  for (const s of init.scenarios?.active || []) active[s.name] = s;
  renderActive();
  renderFlow();
  renderConvs();
  renderPhone();
  hub.on('*', (e) => onEvent(e));
  window.addEventListener('resize', () => schedule('chart', 'map'));
}

// ------------------------------------------------------------------ eventi

const active = {};
const pending = new Map();

function onEvent(e, { storico = false } = {}) {
  switch (e.type) {
    case 'cer.stato':
      model.stato = e.data;
      schedule('clock', 'kpi', 'map', 'chart', 'fam');
      break;
    case 'reading':
      if (typeof e.data.meta?.speed === 'number') model.speed = e.data.meta.speed;
      break;
    case 'agent.decision':
      addFlow({ kind: 'dec', src: e.source, level: e.data.level || 'info', summary: e.data.summary, why: e.data.reasoning, ts: e.ts }, storico);
      break;
    case 'agent.message':
      onMessage(e, storico);
      break;
    case 'notify':
      onNotify(e, storico);
      break;
    case 'chat':
      onChat(e.data, storico);
      break;
    case 'scenario':
      if (e.data.active === false) delete active[e.data.name];
      else active[e.data.name] = e.data;
      if (!storico) renderActive();
      break;
  }
}

const nomeAgente = (src) => {
  if (src === 'orchestrator') return 'Comunità';
  if (src === 'produzione') return 'Produzione';
  if (src?.startsWith('casa-')) return `Casa ${famById[src.slice(5)]?.nome ?? src.slice(5)}`;
  if (src === '*') return 'tutti';
  return src || '?';
};
const classeAgente = (src) => (src === 'orchestrator' ? 'orchestrator' : src === 'produzione' ? 'produzione' : src?.startsWith('casa-') ? 'casa' : 'altro');

function onMessage(e, storico) {
  const p = e.data.payload || {};
  const testo = e.data.text;
  addFlow({ kind: 'msg', src: e.source, to: e.data.to, summary: testo, ts: e.ts, tipo: p.tipo }, storico);
  // le risposte (simulate) delle famiglie compaiono nella loro chat WhatsApp
  if (p.tipo === 'risposta' && p.famiglia) {
    const key = `famiglia-${p.famiglia}`;
    for (const r of p.rifiutate || []) pushConv(key, { dir: 'out', text: `No grazie: ${r.motivo}`, tag: 'risposta simulata della famiglia' }, storico);
    if ((p.accettate || []).length) pushConv(key, { dir: 'out', text: p.versione > 1 ? 'Ok, ricevuto.' : 'Va bene, grazie!', tag: 'risposta simulata della famiglia' }, storico);
  }
}

function onNotify(e, storico) {
  const d = e.data;
  if (d.channel === 'whatsapp') {
    pushConv(d.to, { dir: 'in', text: d.text, ora: d.ora }, storico);
  } else {
    addFlow({ kind: 'dec', src: e.source, level: 'good', summary: `Al ${d.to === CER.referente ? 'referente della CER' : d.to}`, why: d.text, ts: e.ts }, storico);
  }
}

function onChat(d, storico) {
  const k = `${d.from}|${d.text}`;
  if (pending.has(k)) {
    const p = pending.get(k);
    pending.delete(k);
    p.text = d.reply;
    p.pending = false;
    schedule('phone');
    return;
  }
  const key = model.convs.has(d.from) ? d.from : d.from === CER.referente ? GRUPPO : d.from;
  pushConv(key, { dir: 'out', text: d.text, tag: d.from.startsWith('famiglia-') ? null : d.from }, storico);
  pushConv(key, { dir: 'in', text: d.reply }, storico);
}

// ------------------------------------------------------------------ rendering a richiesta

const dirty = new Set();
function schedule(...parts) {
  const was = dirty.size;
  parts.forEach((p) => dirty.add(p));
  if (!was) requestAnimationFrame(flush);
}
function flush() {
  const parts = [...dirty];
  dirty.clear();
  for (const p of parts) RENDER[p]?.();
}
const RENDER = {
  clock: renderClock,
  kpi: renderKpi,
  map: renderMap,
  chart: renderChart,
  fam: renderFamilies,
  flow: renderFlow,
  phone: () => {
    renderConvs();
    renderPhone();
  },
};

// ------------------------------------------------------------------ orologio

function fase(h, sole) {
  if (!sole) return '';
  if (h < sole.alba - 0.3) return 'Prima dell\'alba';
  if (h < sole.alba + 1.2) return 'Alba';
  if (h < 11) return 'Mattina';
  if (h < 13.5) return 'Mezzogiorno';
  if (h < sole.tramonto - 0.8) return 'Pomeriggio';
  if (h < sole.tramonto + 0.6) return 'Tramonto';
  return 'Sera';
}

function renderClock() {
  const s = model.stato;
  if (!s) return;
  $('clock').textContent = s.orario;
  $('phase').textContent = fase(s.ora, s.sole);
  $('daybar').style.left = `calc(${Math.max(0, Math.min(1, (s.ora - 6) / 18)) * 100}% - 2px)`;
  const sp = model.speed;
  $('speed').textContent = sp > 1 ? `giornata accelerata ×${fmt(sp, 0)} · un'ora ogni ${fmt(3600 / sp, 0)} s` : 'tempo reale';
  const p = s.previsione;
  $('fonte').textContent = p ? (p.fonte === 'open-meteo' ? 'previsione Open-Meteo + sensori' : 'previsione simulata + sensori') : 'previsione …';
  $('fonte').title = p?.nota || '';
}

// ------------------------------------------------------------------ KPI

function renderKpi() {
  const s = model.stato;
  if (!s) return;
  const { con, senza, delta, annuo } = s.kpi;
  const euroCon = con.incentivoEuro + delta.bollettaEuro;
  const maxKwh = Math.max(con.prodottaKwh, con.condivisaKwh, 0.1);
  const maxEuro = Math.max(euroCon, senza.incentivoEuro, 0.01);
  const maxCo2 = Math.max(con.co2EvitataKg, senza.co2EvitataKg, 0.01);
  const cards = [
    {
      label: 'Quota di energia condivisa',
      value: pct(con.quotaCondivisa),
      con: [con.quotaCondivisa, pct(con.quotaCondivisa)],
      senza: [senza.quotaCondivisa, pct(senza.quotaCondivisa)],
      delta: `${signed(delta.quotaPunti, 0)} punti`,
      neg: delta.quotaPunti < 0,
      note: 'del sole dei tetti usato nel quartiere nella stessa ora',
    },
    {
      label: 'kWh autoconsumati nella CER',
      value: `${fmt(con.condivisaKwh)}<small>kWh</small>`,
      con: [con.condivisaKwh / maxKwh, `${fmt(con.condivisaKwh)}`],
      senza: [senza.condivisaKwh / maxKwh, `${fmt(senza.condivisaKwh)}`],
      delta: `${signed(delta.condivisaKwh)} kWh`,
      neg: delta.condivisaKwh < 0,
      note: `su ${fmt(con.prodottaKwh)} kWh prodotti finora`,
    },
    {
      label: 'Euro per la comunità',
      value: `${fmtFix(euroCon)}<small>€</small>`,
      con: [euroCon / maxEuro, `${fmtFix(euroCon)} €`],
      senza: [senza.incentivoEuro / maxEuro, `${fmtFix(senza.incentivoEuro)} €`],
      delta: `${signed(delta.totaleEuro, 2)} €`,
      neg: delta.totaleEuro < 0,
      note: `incentivo ${signed(delta.incentivoEuro, 2)} € · bolletta ${signed(delta.bollettaEuro, 2)} €`,
    },
    {
      label: 'CO₂ evitata',
      value: `${fmt(con.co2EvitataKg)}<small>kg</small>`,
      con: [con.co2EvitataKg / maxCo2, `${fmt(con.co2EvitataKg)} kg`],
      senza: [senza.co2EvitataKg / maxCo2, `${fmt(senza.co2EvitataKg)} kg`],
      delta: `${signed(delta.co2Kg)} kg`,
      neg: delta.co2Kg < 0,
      note: 'consumi coperti dal sole nella stessa ora × fattore ISPRA',
    },
  ];
  $('kpis').innerHTML = cards
    .map(
      (c) => `<article class="kpi">
        <div class="kpi-label">${esc(c.label)}</div>
        <div class="kpi-value">${c.value}</div>
        <div class="bars">
          <div class="bar con"><span>con</span><span class="track"><i class="fill" style="width:${Math.max(0, Math.min(1, c.con[0])) * 100}%"></i></span><b>${esc(c.con[1])}</b></div>
          <div class="bar senza"><span>senza</span><span class="track"><i class="fill" style="width:${Math.max(0, Math.min(1, c.senza[0])) * 100}%"></i></span><b>${esc(c.senza[1])}</b></div>
        </div>
        <div class="delta${c.neg ? ' neg' : ''}">${esc(c.delta)} <span class="kpi-note">con gli agenti</span></div>
        <div class="kpi-note">${esc(c.note)}</div>
      </article>`,
    )
    .join('');
  const fine = s.ora >= (s.sole?.tramonto ?? 17) + 0.5;
  const fg = s.kpi.fineGiornata;
  const previsto =
    fg && !fine
      ? `Previsto a fine giornata (piani attuali + previsione meteo): quota condivisa <strong>${pct(fg.con.quotaCondivisa)}</strong> con gli agenti contro ` +
        `<strong>${pct(fg.senza.quotaCondivisa)}</strong> senza, <strong>${signed(fg.delta.condivisaKwh)} kWh</strong> e <strong>${signed(fg.delta.totaleEuro, 2)} €</strong>.` +
        (delta.condivisaKwh < -0.05 ? ' Per ora il confronto è in negativo perché gli agenti hanno spostato dei carichi più avanti, verso il sole pieno.' : '')
      : '';
  $('annuo').innerHTML = fine
    ? `Se ogni giorno fosse come oggi, in un anno gli agenti varrebbero per la CER <strong>${signed(annuo.condivisaKwh, 0)} kWh</strong> condivisi, ` +
      `<strong>${signed(annuo.euro, 0)} €</strong> e <strong>${fmt(annuo.co2Kg / 1000, 1)} t</strong> di CO₂ evitata. Stima grezza: a novembre si produce meno della media annua.`
    : `${previsto} La proiezione su un anno compare dopo il tramonto.`;
  const p = s.previsione;
  $('hero-sub').textContent = `Dalle 6:00 alle ${s.orario} · ${fmt(con.prodottaKwh)} kWh prodotti dai tetti${p ? ` · ${p.fonte === 'open-meteo' ? 'previsione Open-Meteo' : 'previsione simulata'}` : ''}`;
}

// ------------------------------------------------------------------ mappa del quartiere

const EDIFICI = [
  { scala: 'A', x: 24, w: 168, piani: 3, tetto: 'tetto-a' },
  { scala: 'B', x: 216, w: 168, piani: 4, tetto: 'tetto-b' },
  { scala: 'C', x: 408, w: 168, piani: 3, tetto: 'tetto-c', pensilina: true },
];
const SUOLO = 352;
const PIANO_H = 54;

function cielo(h, sole) {
  const { alba, tramonto } = sole || { alba: 7, tramonto: 17 };
  if (h < alba - 0.4 || h > tramonto + 0.6) return ['#1d2947', '#33456e'];
  if (h < alba + 0.9) return ['#f4a261', '#ffd9a8'];
  if (h > tramonto - 0.7) return ['#e76f51', '#f9c58d'];
  return ['#8fc8f5', '#dff1ff'];
}

function renderMap() {
  const s = model.stato;
  if (!s) return;
  const vista = model.vista;
  const W = 600;
  const H = 400;
  const [c1, c2] = cielo(s.ora, s.sole);
  const { alba, tramonto } = s.sole;
  const f = (s.ora - alba) / (tramonto - alba);
  const visibile = f > -0.02 && f < 1.02;
  const sx = 30 + Math.max(0, Math.min(1, f)) * 540;
  const sy = 170 - 135 * Math.sin(Math.PI * Math.max(0, Math.min(1, f)));
  const nuvola = s.previsione?.cielo === 'nuvola' || s.scenari.includes('nuvola');
  const tetti = Object.fromEntries(s.tetti.map((t) => [t.id, t]));
  const cons = vista === 'con' ? s.ora_kw.con : s.ora_kw.senza;
  const condivisa = Math.min(s.ora_kw.prod, cons);
  const caldo = s.scenari.includes('ondata_calore');

  let svg = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient>
    <radialGradient id="sunglow"><stop offset="0" stop-color="#ffe08a"/><stop offset="1" stop-color="#ffe08a" stop-opacity="0"/></radialGradient></defs>
    <rect width="${W}" height="${H}" fill="url(#sky)"/>`;
  if (visibile) {
    svg += `<circle cx="${sx}" cy="${sy}" r="46" fill="url(#sunglow)" opacity="${nuvola ? 0.25 : 0.8}"/>
      <circle cx="${sx}" cy="${sy}" r="17" fill="${caldo ? '#ff8c42' : '#ffc53d'}" opacity="${nuvola ? 0.55 : 1}"/>`;
  } else {
    svg += `<circle cx="520" cy="50" r="12" fill="#e9edf5"/><circle cx="526" cy="46" r="11" fill="${c1}"/>`;
  }
  if (nuvola) {
    const cx = visibile ? sx : 300;
    const cy = visibile ? sy + 6 : 70;
    svg += `<g fill="#f2f4f7" opacity="0.96"><ellipse cx="${cx - 26}" cy="${cy + 6}" rx="40" ry="20"/><ellipse cx="${cx + 18}" cy="${cy - 6}" rx="44" ry="27"/><ellipse cx="${cx + 52}" cy="${cy + 8}" rx="34" ry="18"/><rect x="${cx - 60}" y="${cy + 4}" width="140" height="22" rx="11"/></g>`;
  }
  svg += `<rect x="0" y="${SUOLO}" width="${W}" height="${H - SUOLO}" fill="#9aa48f"/><rect x="0" y="${SUOLO}" width="${W}" height="5" fill="#7d8673"/>`;

  // contatore della CER (in basso): energia condivisa adesso
  svg += `<g><rect x="140" y="${SUOLO + 10}" width="320" height="32" rx="16" fill="#ffffff" opacity="0.94"/>
    <text x="300" y="${SUOLO + 32}" text-anchor="middle" font-size="13" font-weight="700" fill="#0b5443">condivisa ora ${fmt(condivisa)} kW · consumi ${fmt(cons)} kW</text></g>`;

  for (const ed of EDIFICI) {
    const top = SUOLO - ed.piani * PIANO_H - 14;
    const t = tetti[ed.tetto];
    const fr = t ? Math.max(0, Math.min(1, t.kw / (t.kWp * 0.65))) : 0;
    const pannello = `rgb(${Math.round(30 + 40 * fr)},${Math.round(50 + 110 * fr)},${Math.round(95 + 140 * fr)})`;
    // edificio
    svg += `<rect x="${ed.x}" y="${top}" width="${ed.w}" height="${SUOLO - top}" rx="4" fill="#e9e3d6" stroke="#b9b0a0"/>`;
    svg += `<text x="${ed.x + ed.w / 2}" y="${SUOLO - 4}" text-anchor="middle" font-size="11" fill="#5c564b" font-weight="700">SCALA ${ed.scala}</text>`;
    // pannelli
    const py = top - 22;
    const n = ed.pensilina ? 4 : 5;
    const pw = (ed.w - 20) / n;
    for (let i = 0; i < n; i++) {
      const px = ed.x + 10 + i * pw;
      svg += `<polygon points="${px + 4},${py + 20} ${px + pw - 2},${py + 20} ${px + pw - 8},${py + 4} ${px + 10},${py + 4}" fill="${pannello}" stroke="#14213d" stroke-width="1"/>`;
    }
    if (ed.pensilina) svg += `<text x="${ed.x + ed.w - 6}" y="${py + 16}" text-anchor="end" font-size="9" fill="#ffffff">pensilina</text>`;
    // etichetta del tetto: kW prodotti, potenza di picco, sensore
    if (t) {
      svg += `<g><rect x="${ed.x + 4}" y="${py - 44}" width="${ed.w - 8}" height="40" rx="10" fill="#ffffff" opacity="0.94"/>
        <text x="${ed.x + 14}" y="${py - 26}" font-size="15" font-weight="800" fill="#8a5d00">${esc(fmt(t.kw))} kW</text>
        <text x="${ed.x + ed.w - 14}" y="${py - 26}" text-anchor="end" font-size="11.5" fill="#49505c">su ${t.kWp} kWp</text>
        <text x="${ed.x + 14}" y="${py - 11}" font-size="10.5" fill="#49505c">${t.reale ? 'ESP32 vero' : 'ESP32 simulato'}${typeof t.temp === 'number' ? ` · ${esc(fmt(t.temp))} °C` : ''}</text></g>`;
      if (condivisa > 0.05 && t.kw > 0.05) {
        svg += `<path class="flowline" d="M${ed.x + ed.w / 2},${py + 22} L${ed.x + ed.w / 2},${top + 10}" stroke="#ffc53d" stroke-width="3" fill="none" opacity="0.9"/>`;
      }
    }
    // appartamenti
    for (const fam of s.famiglie.filter((x) => x.scala === ed.scala)) {
      const y = SUOLO - fam.piano * PIANO_H - 4;
      const carichi = fam.carichi.filter((c) => (vista === 'con' ? c.attivoCon : c.attivoSenza));
      const kw = vista === 'con' ? fam.kwCon : fam.kwSenza;
      const alSole = carichi.length && s.ora_kw.prod >= cons * 0.98;
      const luce = s.ora < alba || s.ora > tramonto ? '#ffe9a8' : '#f7f4ec';
      const bg = carichi.length ? (alSole ? '#ffe39a' : '#cfe0f7') : luce;
      svg += `<g class="win" tabindex="0" role="button" data-fam="${esc(fam.id)}" aria-label="Famiglia ${esc(fam.nome)}">
        <rect class="wbg" x="${ed.x + 10}" y="${y}" width="${ed.w - 20}" height="${PIANO_H - 10}" rx="6" fill="${bg}" stroke="#8d8576"/>
        <text x="${ed.x + 18}" y="${y + 17}" font-size="12.5" font-weight="750" fill="#15191f">${esc(fam.nome)}${fam.fragile ? ' ♥' : ''}</text>
        <text x="${ed.x + ed.w - 18}" y="${y + 17}" text-anchor="end" font-size="11.5" fill="#49505c">${fmt(kw)} kW</text>
        <text x="${ed.x + 18}" y="${y + 35}" font-size="11" fill="${alSole ? '#6b4700' : '#1c4f8f'}" font-weight="650">${esc(carichi.map((c) => c.nome.toLowerCase()).join(', ') || '')}${carichi.length ? (alSole ? ' · col sole' : ' · dalla rete') : ''}</text>
      </g>`;
    }
  }
  svg += '</svg>';
  $('map').innerHTML = svg;
}

// ------------------------------------------------------------------ grafico

let chartGeom = null;

function niceMax(v) {
  // multipli di 4: le 4 righe della griglia cadono su numeri tondi
  const steps = [4, 8, 12, 16, 20, 24, 32, 40, 60, 80];
  return steps.find((s) => s >= v) ?? Math.ceil(v / 20) * 20;
}

function renderChart() {
  const s = model.stato;
  const box = $('chart');
  if (!s) return;
  const W = Math.max(300, box.clientWidth || 640);
  const H = Math.round(Math.max(230, Math.min(340, W * 0.46)));
  const m = { l: 40, r: W < 520 ? 10 : 118, t: 18, b: 28 };
  const { prod, con, senza } = s.serie;
  const prev = s.previsione?.kw || [];
  const n = prod.length;
  const ora = s.ora;
  const curSlot = Math.floor((ora - 6) / 0.25);
  const all = [...prod, ...con, ...senza, ...prev.slice(Math.max(0, curSlot))].filter((v) => typeof v === 'number');
  const ymax = niceMax(Math.max(4, ...all) * 1.08);
  const X = (h) => m.l + ((h - 6) / 18) * (W - m.l - m.r);
  const Y = (v) => H - m.b - (v / ymax) * (H - m.t - m.b);
  const hs = (i) => 6 + (i + 0.5) * 0.25;
  const path = (arr, from = 0, to = n) => {
    let d = '';
    let pen = false;
    for (let i = from; i < to; i++) {
      const v = arr[i];
      if (typeof v !== 'number') {
        pen = false;
        continue;
      }
      d += `${pen ? 'L' : 'M'}${X(hs(i)).toFixed(1)},${Y(v).toFixed(1)}`;
      pen = true;
    }
    return d;
  };
  const area = (vals) => {
    // aree per tratti continui
    let out = '';
    let run = [];
    const close = () => {
      if (run.length > 1) out += `M${X(hs(run[0][0])).toFixed(1)},${Y(0)} ` + run.map(([i, v]) => `L${X(hs(i)).toFixed(1)},${Y(v).toFixed(1)}`).join(' ') + ` L${X(hs(run[run.length - 1][0])).toFixed(1)},${Y(0)} Z `;
      run = [];
    };
    vals.forEach((v, i) => (typeof v === 'number' ? run.push([i, v]) : close()));
    close();
    return out;
  };
  const shared = prod.map((p, i) => (typeof p === 'number' && typeof con[i] === 'number' ? Math.min(p, con[i]) : null));

  let g = '';
  for (let k = 0; k <= 4; k++) {
    const v = (ymax / 4) * k;
    g += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--line)" stroke-width="1"/>`;
    g += `<text x="${m.l - 6}" y="${Y(v) + 4}" text-anchor="end">${fmt(v, 1)}</text>`;
  }
  g += `<text x="${m.l + 4}" y="${m.t + 2}" font-weight="650" dy="0">kW</text>`;
  for (let h = 6; h <= 24; h += 3) g += `<text x="${X(h)}" y="${H - 8}" text-anchor="${h === 24 ? 'end' : h === 6 ? 'start' : 'middle'}">${h}:00</text>`;
  // sole previsto (futuro)
  const prevFut = prev.map((v, i) => (i >= curSlot ? v : null));
  g += `<path d="${area(prod)}" fill="var(--sun-soft)"/>`;
  g += `<path d="${area(shared)}" fill="var(--shared-soft)"/>`;
  g += `<path d="${path(prevFut)}" fill="none" stroke="var(--sun)" stroke-width="2" stroke-dasharray="5 5" opacity="0.9"/>`;
  g += `<path d="${path(prod)}" fill="none" stroke="var(--sun)" stroke-width="2.5"/>`;
  g += `<path d="${path(senza)}" fill="none" stroke="var(--senza)" stroke-width="2.25" stroke-dasharray="6 4"/>`;
  g += `<path d="${path(con)}" fill="none" stroke="var(--con)" stroke-width="2.5"/>`;
  // adesso
  if (ora >= 6 && ora <= 24) {
    g += `<line x1="${X(ora)}" x2="${X(ora)}" y1="${m.t}" y2="${H - m.b}" stroke="var(--ink-2)" stroke-width="1.5" stroke-dasharray="2 3"/>`;
    g += `<text x="${X(ora) + 4}" y="${m.t + 10}" font-weight="700" fill="var(--ink-2)">adesso</text>`;
  }
  // etichette dirette (ultimo punto di ogni serie)
  if (m.r > 60) {
    const last = (arr) => {
      for (let i = arr.length - 1; i >= 0; i--) if (typeof arr[i] === 'number') return [i, arr[i]];
      return null;
    };
    const labels = [
      ['produzione', last(prod), 'var(--sun-ink)'],
      ['con agenti', last(con), 'var(--con)'],
      ['senza agenti', last(senza), 'var(--ink-3)'],
    ]
      .filter((l) => l[1])
      .map(([t, [i, v], c]) => ({ t, x: X(hs(i)), y: Y(v), c }))
      .sort((a, b) => a.y - b.y);
    for (let i = 1; i < labels.length; i++) if (labels[i].y - labels[i - 1].y < 15) labels[i].y = labels[i - 1].y + 15;
    for (const l of labels) {
      g += `<line x1="${l.x + 3}" x2="${l.x + 10}" y1="${l.y}" y2="${l.y}" stroke="${l.c}" stroke-width="2"/>`;
      g += `<text class="dl" x="${l.x + 13}" y="${l.y + 4}">${l.t}</text>`;
    }
  }
  g += `<line id="xhair" x1="0" x2="0" y1="${m.t}" y2="${H - m.b}" stroke="var(--ink)" stroke-width="1" opacity="0"/>`;
  g += `<rect id="hit" x="${m.l}" y="${m.t}" width="${W - m.l - m.r}" height="${H - m.t - m.b}" fill="transparent"/>`;
  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Grafico di produzione, consumi con e senza agenti ed energia condivisa nella giornata">${g}</svg>`;
  chartGeom = { m, W, H, X, prod, con, senza, prev, shared };
  renderChartTable();
}

function chartHover(ev) {
  const tip = $('tooltip');
  const g = chartGeom;
  const svg = $('chart').querySelector('svg');
  if (!g || !svg) return;
  const r = svg.getBoundingClientRect();
  const px = ((ev.clientX - r.left) / r.width) * g.W;
  const h = 6 + ((px - g.m.l) / (g.W - g.m.l - g.m.r)) * 18;
  const i = Math.floor((h - 6) / 0.25);
  if (i < 0 || i >= g.prod.length) {
    tip.hidden = true;
    return;
  }
  const xh = svg.querySelector('#xhair');
  xh.setAttribute('x1', g.X(6 + (i + 0.5) * 0.25));
  xh.setAttribute('x2', g.X(6 + (i + 0.5) * 0.25));
  xh.setAttribute('opacity', '0.5');
  const row = (c, label, v) => `<div class="tt-r"><i style="border-color:${c}"></i><span>${label}</span><b>${typeof v === 'number' ? `${fmt(v)} kW` : '—'}</b></div>`;
  tip.innerHTML =
    `<div class="tt-h">${hhmm(6 + i * 0.25)}–${hhmm(6 + (i + 1) * 0.25)}</div>` +
    row('var(--sun)', 'produzione', g.prod[i] ?? null) +
    (g.prod[i] == null ? row('var(--sun)', 'previsione', g.prev[i]) : '') +
    row('var(--con)', 'consumi con agenti', g.con[i]) +
    row('var(--senza)', 'consumi senza agenti', g.senza[i]) +
    row('var(--shared)', 'condivisa (con)', g.shared[i]);
  tip.hidden = false;
  tip.style.left = `${Math.min(window.innerWidth - 270, ev.clientX + 14)}px`;
  tip.style.top = `${ev.clientY + 14}px`;
}

function renderChartTable() {
  const s = model.stato;
  const det = $('chart-table').closest('details');
  if (!det.open) return;
  const { prod, con, senza } = s.serie;
  let rows = '';
  for (let h = 6; h < 24; h++) {
    const idx = [0, 1, 2, 3].map((k) => (h - 6) * 4 + k);
    const avg = (arr) => {
      const v = idx.map((i) => arr[i]).filter((x) => typeof x === 'number');
      return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
    };
    const p = avg(prod);
    if (p === null) continue;
    const c = avg(con);
    const z = avg(senza);
    rows += `<tr><td>${h}:00</td><td class="num">${fmt(p)}</td><td class="num">${fmt(c)}</td><td class="num">${fmt(z)}</td><td class="num">${fmt(Math.min(p, c))}</td><td class="num">${fmt(Math.min(p, z))}</td></tr>`;
  }
  $('chart-table').innerHTML = `<table><thead><tr><th>ora</th><th class="num">prod. kW</th><th class="num">cons. con</th><th class="num">cons. senza</th><th class="num">cond. con</th><th class="num">cond. senza</th></tr></thead><tbody>${rows}</tbody></table>`;
}

// ------------------------------------------------------------------ flusso degli agenti

function addFlow(item, storico) {
  item.ora = item.ora ?? (storico ? '' : model.stato?.orario ?? '');
  model.flow.push(item);
  if (model.flow.length > 120) model.flow.splice(0, model.flow.length - 120);
  if (!storico) schedule('flow');
}

const LIVELLO = { good: '✓', warning: '▲', critical: '■', info: 'ⓘ' };

function renderFlow() {
  const items = model.flow.filter((x) => model.flowFilter === 'tutto' || x.kind === 'dec').slice(-60).reverse();
  $('flow').innerHTML = items.length
    ? items
        .map((x) => {
          const who =
            x.kind === 'msg'
              ? `<span class="ag ${classeAgente(x.src)}">${esc(nomeAgente(x.src))}</span>→<span class="ag ${classeAgente(x.to)}">${esc(nomeAgente(x.to))}</span>`
              : `<span class="lvl">${LIVELLO[x.level] || 'ⓘ'}</span><span class="ag ${classeAgente(x.src)}">${esc(nomeAgente(x.src))}</span>`;
          return `<li class="${x.kind === 'msg' ? 'msg' : esc(x.level)}"><div class="who">${who}<span>${esc(x.ora)}</span></div>
            <div class="${x.kind === 'msg' ? '' : 'sum'}">${esc(x.summary)}</div>${x.why ? `<div class="why">${esc(x.why)}</div>` : ''}</li>`;
        })
        .join('')
    : '<li class="empty">Gli agenti si stanno presentando…</li>';
}

// ------------------------------------------------------------------ telefono (WhatsApp) e chat

function initConvs() {
  model.convs.set(GRUPPO, { key: GRUPPO, title: 'Gruppo CER Rione Sole', short: 'Gruppo', sub: 'gruppo WhatsApp delle 10 famiglie · via OpenClaw', avatar: 'CER', from: CER.referente, items: [], unread: 0 });
  for (const f of FAMIGLIE) {
    model.convs.set(`famiglia-${f.id}`, {
      key: `famiglia-${f.id}`,
      title: `Famiglia ${f.nome}`,
      short: f.nome,
      sub: `scala ${f.scala}, piano ${f.piano} · ${f.descrizione.toLowerCase()} · agente casa-${f.id}`,
      avatar: f.nome.slice(0, 2).toUpperCase(),
      from: `famiglia-${f.id}`,
      items: [],
      unread: 0,
    });
  }
  const iniziale = q.get('famiglia');
  if (iniziale && model.convs.has(`famiglia-${iniziale}`)) model.current = `famiglia-${iniziale}`;
}

function pushConv(key, msg, storico) {
  if (!model.convs.has(key)) {
    model.convs.set(key, { key, title: key, short: key.slice(0, 14), sub: 'WhatsApp tramite OpenClaw', avatar: key.replace(/\D/g, '').slice(-2) || '?', from: key, items: [], unread: 0 });
  }
  const c = model.convs.get(key);
  msg.ora = msg.ora || (storico ? '' : model.stato?.orario ?? '');
  c.items.push(msg);
  if (c.items.length > 80) c.items.splice(0, c.items.length - 80);
  if (key !== model.current && !storico) c.unread++;
  if (!storico) schedule('phone');
  return msg;
}

function renderConvs() {
  $('convs').innerHTML = [...model.convs.values()]
    .map(
      (c) => `<button type="button" role="tab" class="conv${c.key === model.current ? ' on' : ''}" data-conv="${esc(c.key)}" aria-selected="${c.key === model.current}">${esc(c.short)}${
        c.unread ? `<span class="dot">${c.unread}</span>` : ''
      }</button>`,
    )
    .join('');
}

const DOMANDE = {
  famiglia: ['Quando conviene caricare l\'auto?', 'Quando faccio la lavatrice?', 'Qual è il nostro programma di oggi?', 'Quanto abbiamo risparmiato oggi?'],
  gruppo: ['Quanto abbiamo risparmiato oggi?', 'Quanto producono i tetti?', 'È equo tra le famiglie?', 'Come funziona la CER?'],
};

function renderPhone() {
  const c = model.convs.get(model.current);
  if (!c) return;
  c.unread = 0;
  $('phone-title').textContent = c.title;
  $('phone-sub').textContent = c.sub;
  $('phone-avatar').textContent = c.avatar;
  $('chat-input').placeholder = c.key === GRUPPO ? 'Scrivi come referente della CER…' : `Scrivi come ${c.title.toLowerCase()}…`;
  const log = $('phone-log');
  log.innerHTML = c.items.length
    ? c.items
        .map(
          (m) => `<li class="bubble ${m.dir === 'out' ? 'out' : ''}${m.pending ? ' pending' : ''}">${m.tag ? `<span class="tag">${esc(m.tag)}</span>` : ''}${esc(m.text)}<span class="t">${esc(m.ora || '')}</span></li>`,
        )
        .join('')
    : '<li class="bubble sys">Nessun messaggio ancora: i consigli arrivano all\'alba e un\'ora prima di ogni elettrodomestico.</li>';
  log.scrollTop = log.scrollHeight;
  const dom = c.key.startsWith('famiglia-') ? DOMANDE.famiglia : DOMANDE.gruppo;
  $('quick').innerHTML = dom.map((d) => `<button type="button" data-q="${esc(d)}">${esc(d)}</button>`).join('');
}

async function invia(text) {
  const c = model.convs.get(model.current);
  if (!text || !c) return;
  pushConv(c.key, { dir: 'out', text });
  const wait = pushConv(c.key, { dir: 'in', text: '…', pending: true });
  const from = c.from;
  pending.set(`${from}|${text}`, wait);
  schedule('phone');
  try {
    const { reply } = await hub.chat(text, { from });
    if (wait.pending) {
      wait.text = reply;
      wait.pending = false;
      pending.delete(`${from}|${text}`);
    }
  } catch (err) {
    wait.text = `Errore: ${err.message}`;
    wait.pending = false;
  }
  schedule('phone');
}

// ------------------------------------------------------------------ famiglie

function renderFamilies() {
  const s = model.stato;
  if (!s) return;
  const max = Math.max(0.1, ...s.famiglie.map((f) => Math.max(f.condivisaKwh, f.condivisaKwhSenza)));
  $('equita').textContent = `equità (Jain) ${fmtFix(s.kpi.con.equita)} con · ${fmtFix(s.kpi.senza.equita)} senza`;
  $('equita').title = 'Quanto è uniforme, tra le famiglie, la quota dei consumi coperta dal sole del quartiere (1 = uguale per tutti).';
  $('families').innerHTML = s.famiglie
    .map((f) => {
      const loads = f.carichi
        .map((c) => {
          const quando = c.piano.length ? (c.piano.length > 1 || c.tipo === 'auto' || c.tipo === 'raffrescamento' ? `${c.piano[0][0]}–${c.piano[c.piano.length - 1][1]}` : c.piano[0][0]) : c.abitudine;
          const st = { accettato: `→ ${quando}`, rifiutato: `${c.abitudine} (ha detto no)`, proposto: `${quando}?`, in_attesa: 'in attesa', abitudine: `${quando}` }[c.stato] || quando;
          const title = c.stato === 'rifiutato' && c.motivo ? ` title="${esc(c.motivo)}"` : '';
          return `<span class="load ${esc(c.stato)}"${title}>${esc(c.nome.toLowerCase())} ${esc(st)}</span>`;
        })
        .join('');
      return `<article class="fam" data-fam="${esc(f.id)}" tabindex="0">
        <div class="fam-top"><div><span class="fam-name">${esc(f.nome)}</span>${f.fragile ? '<span class="fragile">fragile</span>' : ''}
          <div class="fam-desc">scala ${esc(f.scala)}, piano ${f.piano} · ${esc(f.descrizione)}</div></div>
          <span class="fam-euro" title="incentivo maturato in più + bolletta">${f.euro >= 0 ? '+' : '−'}${fmtFix(Math.abs(f.euro))} €</span></div>
        <div class="bars">
          <div class="bar con"><span>con</span><span class="track"><i class="fill" style="width:${(f.condivisaKwh / max) * 100}%"></i></span><b>${fmt(f.condivisaKwh)} kWh</b></div>
          <div class="bar senza"><span>senza</span><span class="track"><i class="fill" style="width:${(f.condivisaKwhSenza / max) * 100}%"></i></span><b>${fmt(f.condivisaKwhSenza)} kWh</b></div>
        </div>
        <div class="loads">${loads}</div>
      </article>`;
    })
    .join('');
}

// ------------------------------------------------------------------ scenari e parametri

const ICONE = {
  nuvola: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 18h10a4 4 0 0 0 .5-8 6 6 0 0 0-11.4 1.6A3.3 3.3 0 0 0 7 18z" fill="#9aa3b2"/></svg>',
  ondata_calore: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 4a2 2 0 0 1 4 0v9.3a4 4 0 1 1-4 0z" fill="#e76f51"/><circle cx="12" cy="17" r="2.2" fill="#fff"/></svg>',
  auto_elettrica: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 15l2-6h12l2 6v4h-2v-2H6v2H4z" fill="#2a78d6"/><path d="M13 3l-3 5h3l-2 4 5-6h-3l2-3z" fill="#eda100"/></svg>',
};

function renderScenarioButtons() {
  const box = $('scenario-buttons');
  box.innerHTML = hub.scenarios
    .map((s, i) => `<button type="button" class="scenario-btn" data-i="${i}" title="${esc(s.description || '')}">${ICONE[s.name] || ''}${esc(s.label || s.name)}</button>`)
    .join('');
  box.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('button[data-i]');
    if (!btn) return;
    const s = hub.scenarios[Number(btn.dataset.i)];
    btn.disabled = true;
    try {
      await hub.scenario(s.name, s.params || {}, { duration: s.duration });
    } catch (err) {
      alert(`Scenario non avviato: ${err.message}`);
    } finally {
      setTimeout(() => (btn.disabled = false), 1500);
    }
  });
}

function renderActive() {
  const label = (n) => hub.scenarios.find((s) => s.name === n)?.label || n;
  const act = Object.keys(active);
  $('active-scenarios').innerHTML = act.length
    ? act.map((n) => `<span class="chip">● ${esc(label(n))} in corso</span>`).join('')
    : '<span class="chip none">nessun evento in corso</span>';
}

function renderParams() {
  const val = (p) =>
    Array.isArray(p.valore) ? `profilo 24 h, ${Math.min(...p.valore)}–${Math.max(...p.valore)} ${p.unita}` : `${String(p.valore).replace('.', ',')} ${p.unita}`.trim();
  $('params').innerHTML =
    '<table><thead><tr><th>Parametro</th><th class="num">Valore</th><th>Fonte</th></tr></thead><tbody>' +
    Object.values(PARAMETRI)
      .map(
        (p) => `<tr><td>${esc(p.etichetta)}<br><span class="stato${/pubblicato/.test(p.stato) ? ' ok' : ''}">${esc(p.stato)}</span></td><td class="num">${esc(val(p))}</td><td>${esc(p.fonte)}</td></tr>`,
      )
      .join('') +
    '</tbody></table>';
}

// ------------------------------------------------------------------ interazioni

function selectConv(key) {
  if (!model.convs.has(key)) return;
  model.current = key;
  renderConvs();
  renderPhone();
}

function bindUi() {
  document.querySelectorAll('[data-vista]').forEach((b) =>
    b.addEventListener('click', () => {
      model.vista = b.dataset.vista;
      document.querySelectorAll('[data-vista]').forEach((x) => x.classList.toggle('on', x === b));
      renderMap();
    }),
  );
  document.querySelectorAll('[data-flow]').forEach((b) =>
    b.addEventListener('click', () => {
      model.flowFilter = b.dataset.flow;
      document.querySelectorAll('[data-flow]').forEach((x) => x.classList.toggle('on', x === b));
      renderFlow();
    }),
  );
  $('convs').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-conv]');
    if (b) selectConv(b.dataset.conv);
  });
  const pickFam = (ev) => {
    const el = ev.target.closest('[data-fam]');
    if (!el) return;
    selectConv(`famiglia-${el.dataset.fam}`);
    if (window.innerWidth < 900) $('h-phone').scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  $('map').addEventListener('click', pickFam);
  $('families').addEventListener('click', pickFam);
  for (const id of ['map', 'families']) {
    $(id).addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        pickFam(ev);
      }
    });
  }
  $('quick').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-q]');
    if (b) invia(b.dataset.q);
  });
  $('chat-form').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const t = $('chat-input').value.trim();
    $('chat-input').value = '';
    invia(t);
  });
  $('chart').addEventListener('pointermove', chartHover);
  $('chart').addEventListener('pointerleave', () => {
    $('tooltip').hidden = true;
    $('chart').querySelector('#xhair')?.setAttribute('opacity', '0');
  });
  $('chart-table').closest('details').addEventListener('toggle', renderChartTable);
  // tooltip sugli appartamenti
  $('map').addEventListener('pointermove', (ev) => {
    const el = ev.target.closest('[data-fam]');
    const tip = $('tooltip');
    if (!el || !model.stato) {
      if (!ev.target.closest('#chart')) tip.hidden = true;
      return;
    }
    const f = model.stato.famiglie.find((x) => x.id === el.dataset.fam);
    if (!f) return;
    tip.innerHTML = `<div class="tt-h">Famiglia ${esc(f.nome)}</div><div>${esc(f.descrizione)}</div><div>sole del quartiere oggi: <b>${fmt(f.condivisaKwh)} kWh</b> (senza agenti ${fmt(f.condivisaKwhSenza)})</div>`;
    tip.hidden = false;
    tip.style.left = `${Math.min(window.innerWidth - 270, ev.clientX + 14)}px`;
    tip.style.top = `${ev.clientY + 14}px`;
  });
  $('map').addEventListener('pointerleave', () => ($('tooltip').hidden = true));
}

start();
