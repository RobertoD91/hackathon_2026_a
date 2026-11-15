// Test end-to-end del server HTTP su una porta libera casuale.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHub } from '../src/hub.js';
import { Agent } from '../src/agent.js';
import { silentLogger } from '../src/log.js';
import { createAgents } from '../agents/index.js';

class Orch extends Agent {
  name = 'orchestrator';
  subscribes = ['reading'];
  async onEvent(e, ctx) {
    if (e.data.readings.button === true) ctx.notify('whatsapp', 'gruppo', `pulsante ${e.data.deviceId}`);
  }
  async onChat({ from, text }) {
    return `eco ${from}: ${text}`;
  }
}

let hub;
let base;
const post = (p, body, headers = {}) =>
  fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });

before(async () => {
  hub = createHub({
    port: 0,
    host: '127.0.0.1',
    staticDir: new URL('../', import.meta.url),
    agents: [new Orch()],
    log: silentLogger,
    llm: { provider: 'mock' },
    token: null,
  });
  await hub.start();
  base = hub.url;
});
after(() => hub.stop());

test('POST /api/readings: 202 e 400', async () => {
  let res = await post('/api/readings', { deviceId: 'esp32-1', readings: { temperature_c: 21.5 }, meta: { net: '5g' } });
  assert.equal(res.status, 202);
  assert.deepEqual(await res.json(), { ok: true, accepted: 1 });
  res = await post('/api/readings', { deviceId: 'esp32-1' });
  assert.equal(res.status, 400);
  const j = await res.json();
  assert.equal(j.ok, false);
  assert.match(j.error, /readings/);
  res = await post('/api/readings', '{rotto');
  assert.equal(res.status, 400);
  res = await post('/api/readings', [{ deviceId: 'a', readings: { x: 1 } }, { deviceId: 'b', readings: { x: 2 } }]);
  assert.equal((await res.json()).accepted, 2);
  res = await post('/api/readings', 'x'.repeat(70_000));
  assert.equal(res.status, 413);
});

test('GET /api/state', async () => {
  const s = await (await fetch(base + '/api/state')).json();
  assert.equal(s.ok, true);
  assert.equal(s.devices['esp32-1'].readings.temperature_c, 21.5);
  assert.equal(s.devices['esp32-1'].meta.net, '5g');
  assert.ok(s.stats.rejected >= 1);
  assert.equal(s.agents[0].name, 'orchestrator');
});

test('SSE: /api/stream riceve gli eventi (con filtro types)', async () => {
  const ctrl = new AbortController();
  const res = await fetch(base + '/api/stream?types=scenario', { signal: ctrl.signal });
  assert.equal(res.headers.get('content-type'), 'text/event-stream; charset=utf-8');
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  await post('/api/readings', { deviceId: 'x', readings: { a: 1 } }); // filtrato
  const r = await post('/api/scenario', { name: 'metro_guasto', params: { linea: 1 } });
  assert.equal(r.status, 202);
  let buf = '';
  while (!buf.includes('metro_guasto')) buf += dec.decode((await reader.read()).value);
  ctrl.abort();
  const data = JSON.parse(buf.split('\n').find((l) => l.startsWith('data:')).slice(5));
  assert.equal(data.type, 'scenario');
  assert.equal(data.source, 'scenario');
  assert.deepEqual(data.data, { name: 'metro_guasto', params: { linea: 1 }, active: true });
});

test('POST /api/scenario non valido', async () => {
  assert.equal((await post('/api/scenario', { params: {} })).status, 400);
});

test('POST /api/chat → orchestratore', async () => {
  const res = await post('/api/chat', { from: '+39333', text: 'ciao' });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, reply: 'eco +39333: ciao' });
  assert.equal((await post('/api/chat', { from: 'x' })).status, 400);
});

test('GET /api/notifications?since= per il ponte OpenClaw', async () => {
  const first = await (await fetch(base + '/api/notifications?channel=whatsapp')).json();
  const since = first.next;
  await post('/api/readings', { deviceId: 'btn-1', readings: { button: true } });
  await hub.idle();
  const n = await (await fetch(`${base}/api/notifications?since=${since}&channel=whatsapp`)).json();
  assert.equal(n.notifications.length, 1);
  assert.equal(n.notifications[0].data.text, 'pulsante btn-1');
  assert.equal(n.notifications[0].data.to, 'gruppo');
  const again = await (await fetch(`${base}/api/notifications?since=${n.next}&channel=whatsapp`)).json();
  assert.equal(again.notifications.length, 0, 'nessun duplicato');
  assert.equal(again.next, n.next);
  assert.equal((await fetch(base + '/api/notifications?since=ieri')).status, 400);
});

test('CORS e 404 delle API', async () => {
  const opt = await fetch(base + '/api/readings', { method: 'OPTIONS' });
  assert.equal(opt.status, 204);
  assert.equal(opt.headers.get('access-control-allow-origin'), '*');
  const res = await fetch(base + '/api/nulla');
  assert.equal(res.status, 404);
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
});

test('file statici a specchio della repo, niente file nascosti o fuori dalle cartelle ammesse', async () => {
  const root = await fetch(base + '/', { redirect: 'manual' });
  assert.equal(root.status, 302);
  assert.equal(root.headers.get('location'), '/c5-presentazione/mappa/');
  const page = await fetch(base + '/c5-presentazione/mappa/');
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /text\/html/);
  const js = await fetch(base + '/c5-presentazione/mappa/src/client.js');
  assert.match(js.headers.get('content-type'), /javascript/);
  // moduli isomorfi dell'API dati città importati dalla pagina (una sola copia, in citta-api/)
  for (const p of ['/citta-api/simulatore/sim-core.js', '/citta-api/simulatore/sim-config.json', '/citta-api/fonti/dati.js', '/citta-api/dati/meteo.json']) {
    assert.equal((await fetch(base + p)).status, 200, p);
  }
  const noSlash = await fetch(base + '/c5-presentazione/mappa', { redirect: 'manual' });
  assert.equal(noSlash.status, 301);
  for (const p of ['/CLAUDE.md', '/.git/config', '/c5-presentazione/mappa/test/http.test.js', '/c5-presentazione/mappa/../../CLAUDE.md', '/citta-api/server.js', '/citta-api/src/config.js', '/c5-presentazione/copione.md']) {
    assert.equal((await fetch(base + p)).status, 404, p);
  }
});

test('token: le POST richiedono Authorization se HUB_TOKEN è impostato', async () => {
  const h = createHub({ port: 0, host: '127.0.0.1', token: 'segreto', log: silentLogger, llm: { provider: 'mock' } });
  await h.start();
  const body = JSON.stringify({ deviceId: 'a', readings: { x: 1 } });
  const url = h.url + '/api/readings';
  assert.equal((await fetch(url, { method: 'POST', body })).status, 401);
  assert.equal((await fetch(url, { method: 'POST', body, headers: { authorization: 'Bearer segreto' } })).status, 202);
  assert.equal((await fetch(url + '?token=segreto', { method: 'POST', body })).status, 202);
  assert.equal((await fetch(h.url + '/api/state')).status, 200, 'le GET restano libere');
  await h.stop();
});

test('agenti dell\'esempio: chat deterministica con dati reali', async () => {
  const h = createHub({ port: 0, host: '127.0.0.1', agents: createAgents(), log: silentLogger, llm: { provider: 'mock' } });
  await h.start();
  for (const [id, zone, t] of [['a', 'centro', 31], ['b', 'centro', 33], ['c', 'collina', 20]]) {
    await fetch(h.url + '/api/readings', {
      method: 'POST',
      body: JSON.stringify({ deviceId: id, location: { zone }, readings: { temperature_c: t, light_lux: 20000 } }),
    });
  }
  await h.idle();
  const { reply } = await (await fetch(h.url + '/api/chat', { method: 'POST', body: JSON.stringify({ from: 'u', text: 'che temperatura c\'è?' }) })).json();
  assert.match(reply, /centro 32 °C/);
  assert.match(reply, /collina 20 °C/);
  const s = h.state.snapshot();
  assert.ok(s.decisions.some((d) => d.source === 'clima' && /Caldo in zona centro/.test(d.data.summary)));
  assert.ok(s.notifications.some((n) => n.data.channel === 'whatsapp' && /centro/.test(n.data.text)));
  await h.stop();
});
