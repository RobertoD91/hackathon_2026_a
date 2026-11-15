// Dashboard della mappa "Napoli in tempo reale". Funziona in due modi senza cambiare codice:
// - "live": servita dal hub (node c5-presentazione/mappa/server.js) → /api/state e SSE;
// - "demo": su GitHub Pages o senza backend → simulatore e agenti girano nel browser.
// Usa solo percorsi relativi (la pagina è servita anche sotto /hackathon_2026_a/...).
//
//   <script type="module">
//     import { avviaDashboard } from './app.js';
//     import scenario from './napoli.js';
//     avviaDashboard(scenario);
//   </script>
//
// Lo scenario (vedi napoli.js):
// {
//   id, simConfig: URL del sim-config.json, demoAgents: async () => [agenti],
//   firma: 'folla',                  // il hub live deve avere questo agente, altrimenti si va in demo
//   notaAltroHub: 'HTML',            // testo mostrato se il hub esegue un altro scenario
//   mappa: { ...configurazione di mappa.js },
//   kpi?: ['nome_metrica', ...],     // ordine dei KPI (gli altri dopo)
//   etichettaScenario?: (nome) → testo | null,   // etichetta degli scenari in corso non a catalogo
//   simulatoreDemo?: async (hub, simConfig) → { stop },  // simulatore proprio in demo (al posto di quello generico)
//   eventi?: (evento, api) → void,   // ogni evento (anche quelli dello stato iniziale): aggiorna mappa.setExtra...
//   avvio?: (api) → void | Promise,   // dopo la creazione della mappa (es. fonti dati esterne: Napoli)
// }

import { connectHub, formatClock } from './src/client.js';
import { readingLabel, formatReading, formatNumber, formatTime, escapeHtml, sparklineSvg } from './src/ui-helpers.js';
import { createMappa } from './mappa.js';

const $ = (id) => document.getElementById(id);
const CHAT_FROM = `dashboard-${Math.random().toString(36).slice(2, 6)}`;
const MAX_DECISIONS = 40;
const MAX_NOTES = 30;
const MAX_EVENTS = 60;

// Modello locale: si inizializza da getState() e si aggiorna con gli eventi.
const model = {
  devices: {},
  metrics: {},
  metricHistory: {},
  decisions: [],
  notifications: [],
  active: {},
  clock: { sim: Date.now(), real: Date.now(), speed: 1 },
};

let hub = null;
let scen = null;
let catalogo = [];
let mappa = null;
const ora = () => model.clock.sim + (Date.now() - model.clock.real) * model.clock.speed;
const api = {
  model,
  ora,
  get hub() {
    return hub;
  },
  get mappa() {
    return mappa;
  },
};

// ------------------------------------------------------------------ avvio

export async function avviaDashboard(scenario) {
  scen = scenario;
  const conf = await caricaConfig(scenario.simConfig);
  catalogo = conf?.scenarios || [];

  hub = await connectHub({ simConfig: conf, demoAgents: scenario.demoAgents });
  let initial = await hub.getState();
  let altroHub = false;
  const agenti = Array.isArray(initial.agents) ? initial.agents.map((a) => a.name) : Object.keys(initial.agents || {});
  if (hub.mode === 'live' && scenario.firma && !agenti.includes(scenario.firma)) {
    // il hub raggiungibile esegue un altro scenario (senza l'agente indicato in `firma`)
    hub.close();
    altroHub = true;
    hub = await connectHub({ simConfig: conf, demoAgents: scenario.demoAgents, forceDemo: true });
    initial = await hub.getState();
  }
  if (hub.mode === 'demo' && scenario.simulatoreDemo) {
    await scenario.simulatoreDemo(hub, conf);
    initial = await hub.getState();
  }

  $('mode').textContent = hub.mode === 'live' ? 'LIVE · hub' : 'DEMO · nel browser';
  $('mode').classList.add(hub.mode);
  $('demo-note').hidden = hub.mode !== 'demo';
  if (altroHub && scenario.notaAltroHub) $('demo-note').innerHTML = scenario.notaAltroHub;
  const stato = (s) => {
    const el = $('conn');
    el.className = `conn ${s}`;
    el.textContent = { connected: 'collegato', reconnecting: 'riconnessione…', demo: 'simulazione locale' }[s] || s;
  };
  stato(hub.status);
  hub.onStatus(stato);

  model.devices = structuredClone(initial.devices || {});
  for (const m of Object.values(initial.metrics || {})) setMetric(m);
  model.decisions = (initial.decisions || []).slice(-MAX_DECISIONS);
  model.notifications = (initial.notifications || []).slice(-MAX_NOTES);
  for (const s of initial.scenarios?.active || []) model.active[s.name] = s;
  model.clock = { sim: initial.simTime, real: initial.now, speed: initial.speed || 1 };
  for (const c of initial.chats || []) addChatPair(c.data);

  mappa = createMappa($('citymap'), scenario.mappa, { ora });
  // lo stato iniziale passa dallo stesso aggancio degli eventi (in ordine di tempo)
  if (scenario.eventi) {
    const storici = [...(initial.messages || []), ...(initial.decisions || [])].sort((a, b) => a.ts - b.ts);
    for (const e of storici) chiamaEventi(e);
    for (const m of Object.values(initial.metrics || {})) chiamaEventi({ type: 'metric', ts: m.ts, source: m.source, data: m });
  }
  renderScenarioButtons();
  renderAll();
  hub.on('*', onEvent);
  if (scenario.avvio) {
    Promise.resolve()
      .then(() => scenario.avvio(api))
      .catch((err) => console.error('[dashboard] aggancio avvio dello scenario in errore:', err));
  }
  setInterval(renderClock, 1000);
}

async function caricaConfig(src) {
  if (!src || typeof src === 'object') return src || null;
  try {
    return await (await fetch(src, { cache: 'no-cache' })).json();
  } catch (err) {
    console.warn('[dashboard] configurazione del simulatore non caricata:', err);
    return null;
  }
}

function chiamaEventi(e) {
  try {
    scen.eventi?.(e, api);
  } catch (err) {
    console.error('[dashboard] aggancio eventi dello scenario in errore:', err);
  }
}

// ------------------------------------------------------------------ eventi

function onEvent(e) {
  logEvent(e);
  switch (e.type) {
    case 'reading':
      applyReading(e.data);
      schedule('devices');
      break;
    case 'metric':
      setMetric({ ...e.data, ts: e.ts, source: e.source });
      schedule('kpis');
      break;
    case 'agent.decision':
      model.decisions.push(e);
      if (e.data.metrics) {
        for (const [name, v] of Object.entries(e.data.metrics)) {
          if (typeof v === 'number') setMetric({ name, value: v, ts: e.ts, source: e.source });
          else if (v && typeof v.value === 'number') setMetric({ name, ...v, ts: e.ts, source: e.source });
        }
        schedule('kpis');
      }
      model.decisions = model.decisions.slice(-MAX_DECISIONS);
      schedule('decisions');
      break;
    case 'notify':
      model.notifications.push(e);
      model.notifications = model.notifications.slice(-MAX_NOTES);
      schedule('notifications');
      break;
    case 'scenario':
      if (e.data.active === false) delete model.active[e.data.name];
      else model.active[e.data.name] = { ...e.data, since: e.ts };
      schedule('scenarios');
      break;
    case 'chat':
      onChatEvent(e.data);
      break;
  }
  if (scen.eventi) chiamaEventi(e);
}

function applyReading(r) {
  const prev = model.devices[r.deviceId] || { history: {}, readings: {}, count: 0 };
  const history = { ...prev.history };
  for (const [k, v] of Object.entries(r.readings)) {
    if (typeof v !== 'number') continue;
    history[k] = [...(history[k] || []), [r.ts, v]].slice(-60);
  }
  model.devices[r.deviceId] = {
    ...prev,
    deviceId: r.deviceId,
    zone: r.location?.zone ?? prev.zone ?? null,
    location: r.location || prev.location,
    readings: { ...prev.readings, ...r.readings },
    meta: r.meta || {},
    simulated: r.meta?.simulated === true,
    ts: r.ts,
    count: prev.count + 1,
    history,
    flash: true,
  };
  if (typeof r.meta?.simTime === 'number') {
    model.clock = { sim: r.meta.simTime, real: Date.now(), speed: r.meta.speed || 1 };
  }
}

function setMetric(m) {
  model.metrics[m.name] = m;
  const h = (model.metricHistory[m.name] ||= []);
  h.push([m.ts ?? Date.now(), m.value]);
  if (h.length > 30) h.shift();
}

// ------------------------------------------------------------------ rendering

const dirty = new Set();
function schedule(part) {
  dirty.add(part);
  if (dirty.size === 1) requestAnimationFrame(flush);
}
function flush() {
  for (const p of dirty) RENDER[p]();
  dirty.clear();
}
const RENDER = {
  devices: () => {
    renderDevices();
    mappa?.update(model.devices);
  },
  kpis: renderKpis,
  decisions: renderDecisions,
  notifications: renderNotifications,
  scenarios: renderActiveScenarios,
};
function renderAll() {
  Object.values(RENDER).forEach((f) => f());
  renderClock();
}

function renderClock() {
  const { speed } = model.clock;
  $('clock').textContent = formatClock(ora());
  $('speed').textContent = speed !== 1 ? `×${formatNumber(speed, 0)}` : 'tempo reale';
}

function renderKpis() {
  const ordine = scen.kpi || [];
  const pos = (n) => (ordine.includes(n) ? ordine.indexOf(n) : ordine.length);
  const list = Object.values(model.metrics).sort((a, b) => pos(a.name) - pos(b.name));
  $('kpis').innerHTML = list.length
    ? list
        .map((m) => {
          const h = model.metricHistory[m.name] || [];
          return `<article class="kpi">
            <div class="kpi-label" title="${escapeHtml(m.name)}">${escapeHtml(m.label || m.name.replace(/_/g, ' '))}</div>
            <div class="kpi-value">${formatNumber(m.value)}<span class="kpi-unit">${escapeHtml(m.unit || '')}</span></div>
            <div class="kpi-meta"><span>${escapeHtml(m.source || '')}</span>${h.length > 2 ? sparklineSvg(h, { width: 72, height: 22 }) : ''}</div>
          </article>`;
        })
        .join('')
    : '<p class="empty">Le metriche arrivano dagli agenti tra pochi secondi…</p>';
}

function renderDevices() {
  const devs = Object.values(model.devices).sort((a, b) => String(a.zone).localeCompare(String(b.zone)) || a.deviceId.localeCompare(b.deviceId));
  $('dev-count').textContent = devs.length ? `· ${devs.length}` : '';
  $('devices').innerHTML = devs.length
    ? devs
        .map((d) => {
          const tag = d.simulated
            ? '<span class="tag">simulato</span>'
            : `<span class="tag real">reale${d.meta?.net ? ' · ' + escapeHtml(d.meta.net) : ''}</span>`;
          const rows = Object.entries(d.readings)
            .map(([k, v]) => {
              const spark = typeof v === 'number' ? sparklineSvg(d.history?.[k] || [], { width: 110, height: 26 }) : '<span></span>';
              const cls = k === 'button' && v === true ? 'r-value r-pressed' : 'r-value';
              return `<span class="r-label">${escapeHtml(readingLabel(k))}</span><span class="${cls}">${escapeHtml(formatReading(k, v))}</span>
                <span data-device="${escapeHtml(d.deviceId)}" data-key="${escapeHtml(k)}">${spark}</span>`;
            })
            .join('');
          const flash = d.flash ? ' flash' : '';
          d.flash = false;
          return `<article class="device${flash}">
            <div class="device-head"><div><div class="device-id">${escapeHtml(d.deviceId)}</div>
            <div class="device-zone">zona ${escapeHtml(d.zone ?? 'n/d')} · ${formatTime(d.ts)}</div></div>${tag}</div>
            <div class="readings">${rows}</div></article>`;
        })
        .join('')
    : '<p class="empty">In attesa dei primi dati dai sensori…</p>';
  setTimeout(() => document.querySelectorAll('.device.flash').forEach((el) => el.classList.remove('flash')), 400);
}

const LEVELS = {
  info: '<span class="level info">ⓘ info</span>',
  good: '<span class="level good">✓ ok</span>',
  warning: '<span class="level warning">▲ attenzione</span>',
  critical: '<span class="level critical">■ critico</span>',
};

function renderDecisions() {
  const items = [...model.decisions].reverse();
  $('decisions').innerHTML = items.length
    ? items
        .map((e) => {
          const d = e.data || {};
          const level = LEVELS[d.level] ? d.level : 'info';
          const actions = (d.actions || [])
            .map((a) => {
              const t = typeof a === 'string' ? a : a.label || [a.type, a.zone || a.to].filter(Boolean).join(' ');
              return `<span class="action">${escapeHtml(t)}</span>`;
            })
            .join('');
          return `<li class="decision ${level}">
            <div class="decision-head">${LEVELS[level]}<span class="agent">${escapeHtml(e.source)}</span><span class="when">${formatTime(e.ts)}</span></div>
            <div class="decision-summary">${escapeHtml(d.summary)}</div>
            ${d.reasoning ? `<div class="decision-reason">${escapeHtml(d.reasoning)}</div>` : ''}
            ${actions ? `<div class="actions">${actions}</div>` : ''}
          </li>`;
        })
        .join('')
    : '<li class="empty">Nessuna decisione per ora.</li>';
}

function renderNotifications() {
  const items = [...model.notifications].reverse();
  $('notifications').innerHTML = items.length
    ? items
        .map((e) => {
          const d = e.data || {};
          return `<li class="note"><div class="note-head"><span class="channel ${escapeHtml(d.channel)}">${escapeHtml(d.channel === 'whatsapp' ? 'WhatsApp' : d.channel)}</span>
            → ${escapeHtml(d.to)} · ${escapeHtml(e.source)} <span class="when">${formatTime(e.ts)}</span></div>${escapeHtml(d.text)}</li>`;
        })
        .join('')
    : '<li class="empty">Le notifiche WhatsApp (via OpenClaw) compariranno qui.</li>';
}

function renderScenarioButtons() {
  const box = $('scenario-buttons');
  if (!catalogo.length) {
    box.innerHTML = '<p class="empty">Nessuno scenario nel catalogo (sim-config.json → "scenarios").</p>';
    return;
  }
  box.innerHTML = catalogo
    .map(
      (s, i) =>
        `<button class="scenario-btn" data-i="${i}" title="${escapeHtml(s.description || '')}">${escapeHtml(s.label || s.name)}${
          s.duration ? `<small>${s.duration} s</small>` : ''
        }</button>`,
    )
    .join('');
  box.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('button[data-i]');
    if (!btn) return;
    const s = catalogo[Number(btn.dataset.i)];
    btn.disabled = true;
    try {
      await hub.scenario(s.name, s.params || {}, { duration: s.duration });
    } catch (err) {
      alert(`Scenario non avviato: ${err.message}`);
    } finally {
      setTimeout(() => (btn.disabled = false), 800);
    }
  });
}

function renderActiveScenarios() {
  const act = Object.values(model.active);
  const label = (name) => catalogo.find((s) => s.name === name)?.label || scen.etichettaScenario?.(name) || name;
  $('active-scenarios').innerHTML = act.length
    ? act.map((s) => `<span class="chip">● ${escapeHtml(label(s.name))}</span>`).join('')
    : '<span class="chip none">Nessuno scenario in corso</span>';
}

// ------------------------------------------------------------------ chat

const pending = new Map(); // testo → elemento "in attesa"

$('chat-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const input = $('chat-input');
  const text = input.value.trim();
  if (!text || !hub) return;
  input.value = '';
  addMsg('user', text);
  const wait = addMsg('bot pending', '…');
  pending.set(text, wait);
  try {
    const { reply } = await hub.chat(text, { from: CHAT_FROM });
    if (pending.get(text) === wait) {
      wait.textContent = reply;
      wait.classList.remove('pending');
      pending.delete(text);
    }
  } catch (err) {
    wait.textContent = `Errore: ${err.message}`;
    pending.delete(text);
  }
});

// domande di esempio (pulsanti con data-chiedi, se la pagina ne ha)
document.addEventListener('click', (ev) => {
  const b = ev.target.closest?.('[data-chiedi]');
  if (!b) return;
  $('chat-input').value = b.dataset.chiedi;
  $('chat-form').requestSubmit();
});

function onChatEvent(d) {
  if (d.from === CHAT_FROM && pending.has(d.text)) {
    const el = pending.get(d.text);
    el.textContent = d.reply;
    el.classList.remove('pending');
    pending.delete(d.text);
    return;
  }
  if (d.from === CHAT_FROM) return; // già mostrata dalla risposta HTTP
  addChatPair(d); // messaggi arrivati da altri canali (es. WhatsApp tramite OpenClaw)
}

function addChatPair(d) {
  addMsg('user', d.text, d.from !== CHAT_FROM ? d.from : null);
  addMsg('bot', d.reply);
}

function addMsg(cls, text, from) {
  const li = document.createElement('li');
  li.className = `msg ${cls}`;
  if (from) {
    const f = document.createElement('span');
    f.className = 'msg-from';
    f.textContent = from;
    li.append(f);
  }
  li.append(document.createTextNode(text));
  const log = $('chat-log');
  log.append(li);
  log.scrollTop = log.scrollHeight;
  return li;
}

// ------------------------------------------------------------------ flusso eventi

function logEvent(e) {
  const d = e.data || {};
  const short =
    e.type === 'reading'
      ? Object.entries(d.readings || {}).map(([k, v]) => `${k}=${v}`).join(' ')
      : d.summary || d.text || (d.name ? `${d.name} ${d.active === false ? '(fine)' : ''}` : '') || JSON.stringify(d).slice(0, 120);
  const li = document.createElement('li');
  li.innerHTML = `${formatTime(e.ts)} <span class="ev-type">${escapeHtml(e.type)}</span> ${escapeHtml(e.source)} · ${escapeHtml(short)}`;
  const log = $('events');
  log.prepend(li);
  while (log.children.length > MAX_EVENTS) log.lastChild.remove();
}

// ------------------------------------------------------------------ tooltip sulle sparkline

const tip = $('tooltip');
document.addEventListener('mousemove', (ev) => {
  const holder = ev.target.closest?.('[data-device][data-key]');
  const svg = holder?.querySelector('svg');
  const h = holder && model.devices[holder.dataset.device]?.history?.[holder.dataset.key];
  if (!svg || !h || h.length < 2) {
    tip.hidden = true;
    return;
  }
  const rect = svg.getBoundingClientRect();
  const f = Math.min(1, Math.max(0, (ev.clientX - rect.left) / rect.width));
  const t = h[0][0] + f * (h[h.length - 1][0] - h[0][0]);
  const p = h.reduce((best, q) => (Math.abs(q[0] - t) < Math.abs(best[0] - t) ? q : best), h[0]);
  tip.textContent = `${formatReading(holder.dataset.key, p[1])} · ${formatTime(p[0])}`;
  tip.style.left = `${ev.clientX}px`;
  tip.style.top = `${rect.top}px`;
  tip.hidden = false;
});
