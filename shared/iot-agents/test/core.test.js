import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCore } from '../src/core.js';
import { Agent } from '../src/agent.js';
import { silentLogger } from '../src/log.js';

const newCore = (agents, extra = {}) => createCore({ agents, log: silentLogger, llm: { provider: 'mock' }, ...extra });
const reading = (deviceId, readings, zone = 'z1') => ({ deviceId, readings, location: { zone } });

class Recorder extends Agent {
  constructor(name, subscribes) {
    super();
    this.name = name;
    this.subscribes = subscribes;
    this.got = [];
  }
  async onEvent(e) {
    this.got.push(e);
  }
}

test('formato degli eventi e aggiornamento dello stato', async () => {
  const core = newCore([]);
  const r = core.ingestReading(reading('d1', { temperature_c: 20, light_lux: 100 }));
  assert.equal(r.ok, true);
  const e = r.event;
  assert.match(e.id, /^evt_/);
  assert.equal(typeof e.ts, 'number');
  assert.equal(e.type, 'reading');
  assert.equal(e.source, 'd1');
  assert.equal(core.state.device('d1').readings.temperature_c, 20);
  // lettura parziale: le altre grandezze restano
  core.ingestReading(reading('d1', { temperature_c: 22 }));
  assert.deepEqual({ ...core.state.device('d1').readings }, { temperature_c: 22, light_lux: 100 });
  assert.equal(core.state.device('d1').history.temperature_c.length, 2);
  core.ingestReading(reading('d2', { temperature_c: 30 }, 'z2'));
  assert.equal(core.state.average('temperature_c'), 26);
  assert.equal(core.state.average('temperature_c', { zone: 'z2' }), 30);
  assert.deepEqual(core.state.zones().sort(), ['z1', 'z2']);
  assert.ok(Object.isFrozen(core.state.device('d1')), 'lo stato visto dagli agenti è congelato');
});

test('ts degli eventi strettamente crescenti', () => {
  const core = newCore([]);
  const ts = Array.from({ length: 50 }, () => core.publish('metric', { name: 'x', value: 1 }).ts);
  for (let i = 1; i < ts.length; i++) assert.ok(ts[i] > ts[i - 1]);
});

test('dispatch secondo subscribes e routing di agent.message', async () => {
  const a = new Recorder('a', ['reading']);
  const b = new Recorder('b', ['agent.message']);
  const c = new Recorder('c', ['*']);
  const core = newCore([a, b, c]);
  core.ingestReading(reading('d1', { x: 1 }));
  core.publish('agent.message', { to: 'b', text: 'per b' }, { source: 'z' });
  core.publish('agent.message', { to: 'a', text: 'per a' }, { source: 'z' });
  core.publish('agent.message', { to: '*', text: 'per tutti' }, { source: 'z' });
  core.publish('notify', { channel: 'dashboard', to: 'op', text: 'x' }, { source: 'z' });
  await core.idle();
  assert.deepEqual(a.got.map((e) => e.type), ['reading']);
  assert.deepEqual(b.got.map((e) => e.data.text), ['per b', 'per tutti']);
  // anche con '*' un agent.message arriva solo se indirizzato all'agente o a '*'
  assert.deepEqual(c.got.map((e) => e.data.text ?? e.type), ['reading', 'per tutti', 'x']);
});

test('un agente non riceve i propri eventi', async () => {
  class Eco extends Agent {
    name = 'eco';
    subscribes = ['metric'];
    count = 0;
    async onEvent(e, ctx) {
      this.count++;
      ctx.metric('eco', 1); // se ricevesse i propri eventi sarebbe un ciclo infinito
    }
  }
  const eco = new Eco();
  const core = newCore([eco]);
  core.publish('metric', { name: 'x', value: 1 }, { source: 'altro' });
  await core.idle();
  assert.equal(eco.count, 1);
  assert.equal(core.state.metric('eco').source, 'eco');
});

test('ciclo tra due agenti interrotto da maxDepth', async () => {
  class PingPong extends Agent {
    constructor(name, other) {
      super();
      this.name = name;
      this.other = other;
      this.subscribes = ['agent.message'];
      this.count = 0;
    }
    async onEvent(_e, ctx) {
      this.count++;
      ctx.send(this.other, 'ping');
    }
  }
  const a = new PingPong('a', 'b');
  const b = new PingPong('b', 'a');
  const core = newCore([a, b], { maxDepth: 6 });
  core.publish('agent.message', { to: 'a', text: 'via' }, { source: 'test' });
  await core.idle();
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(a.count + b.count <= 7, `troppi messaggi: ${a.count + b.count}`);
  assert.ok(a.count + b.count >= 5);
});

test('un agente che va in errore non blocca gli altri', async () => {
  class Rotto extends Agent {
    name = 'rotto';
    subscribes = ['reading'];
    async onEvent() {
      throw new Error('boom');
    }
  }
  const sano = new Recorder('sano', ['reading']);
  const core = newCore([new Rotto(), sano]);
  core.ingestReading(reading('d1', { x: 1 }));
  core.ingestReading(reading('d1', { x: 2 }));
  await core.idle();
  assert.equal(sano.got.length, 2);
  const info = core.state.agents().find((a) => a.name === 'rotto');
  assert.equal(info.errors, 2);
  assert.equal(info.lastError.message, 'boom');
});

test('eventi consegnati in ordine, uno alla volta per agente', async () => {
  class Lento extends Agent {
    name = 'lento';
    subscribes = ['reading'];
    seen = [];
    busy = false;
    async onEvent(e) {
      assert.equal(this.busy, false, 'chiamate sovrapposte');
      this.busy = true;
      await new Promise((r) => setTimeout(r, 2));
      this.seen.push(e.data.readings.n);
      this.busy = false;
    }
  }
  const lento = new Lento();
  const core = newCore([lento]);
  for (let n = 0; n < 10; n++) core.ingestReading(reading('d', { n }));
  await core.idle();
  assert.deepEqual(lento.seen, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
});

test('coda piena: si scartano le letture più vecchie', async () => {
  class Bloccato extends Agent {
    name = 'bloccato';
    subscribes = ['reading', 'scenario'];
    seen = [];
    async onEvent(e) {
      await new Promise((r) => setTimeout(r, 1));
      this.seen.push(e.type === 'reading' ? e.data.readings.n : e.type);
    }
  }
  const ag = new Bloccato();
  const core = newCore([ag], { queueLimit: 5 });
  core.scenario('s1');
  for (let n = 0; n < 20; n++) core.ingestReading(reading('d', { n }));
  await core.idle();
  assert.ok(ag.seen.includes('scenario'), 'lo scenario non va perso');
  assert.ok(ag.seen.length < 21);
  assert.equal(ag.seen.at(-1), 19);
});

test('ctx: decide, notify, metric, send con source = nome agente', async () => {
  class Tutto extends Agent {
    name = 'tutto';
    subscribes = ['reading'];
    async onEvent(_e, ctx) {
      ctx.decide('decisione', { level: 'warning', actions: [{ type: 'x' }] });
      ctx.notify('whatsapp', 'gruppo', 'ciao');
      ctx.metric('kwh', 3.5, 'kWh');
      ctx.send('orchestrator', 'msg', { a: 1 });
    }
  }
  const core = newCore([new Tutto()]);
  const seen = [];
  core.subscribe((e) => seen.push(e), { types: ['agent.decision', 'notify', 'metric', 'agent.message'] });
  core.ingestReading(reading('d', { x: 1 }));
  await core.idle();
  assert.deepEqual(seen.map((e) => e.type), ['agent.decision', 'notify', 'metric', 'agent.message']);
  assert.ok(seen.every((e) => e.source === 'tutto'));
  assert.equal(seen[0].data.summary, 'decisione');
  assert.deepEqual(seen[0].data.actions, [{ type: 'x' }]);
  assert.deepEqual(seen[1].data, { channel: 'whatsapp', to: 'gruppo', text: 'ciao' });
  assert.equal(core.state.metric('kwh').value, 3.5);
  assert.equal(core.state.notifications({ channel: 'whatsapp' }).length, 1);
  assert.equal(core.state.decisions().length, 1);
});

test('chat instradata all\'orchestratore', async () => {
  class Orch extends Agent {
    name = 'orchestrator';
    async onChat({ from, text }, ctx) {
      return `ciao ${from}, hai scritto "${text}" (${ctx.state.devices().length} dispositivi)`;
    }
  }
  const core = newCore([new Orch()]);
  core.ingestReading(reading('d', { x: 1 }));
  const r = await core.chat({ from: 'mario', text: 'test' });
  assert.equal(r.reply, 'ciao mario, hai scritto "test" (1 dispositivi)');
  assert.equal(core.state.chats().at(-1).data.reply, r.reply);
});

test('chat senza orchestratore o con errore: risposta di cortesia', async () => {
  const r1 = await newCore([]).chat({ text: 'ciao' });
  assert.equal(r1.ok, false);
  assert.match(r1.reply, /orchestratore/);
  class Rotto extends Agent {
    name = 'orchestrator';
    async onChat() {
      throw new Error('x');
    }
  }
  const r2 = await newCore([new Rotto()]).chat({ text: 'ciao' });
  assert.equal(r2.ok, false);
  assert.match(r2.reply, /Scusa/);
});

test('scenario con durata: evento di fine automatico', async () => {
  const core = newCore([]);
  core.scenario('metro_guasto', { linea: 1 }, { duration: 0.05 });
  assert.equal(core.state.isActive('metro_guasto'), true);
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(core.state.isActive('metro_guasto'), false);
  assert.equal(core.state.snapshot().scenarios.recent.at(-1).data.active, false);
  await core.stop();
});

test('nomi di agente duplicati o non validi', () => {
  assert.throws(() => newCore([new Recorder('a', []), new Recorder('a', [])]), /duplicato/);
  assert.throws(() => newCore([{ subscribes: [] }]), /name/);
  assert.throws(() => newCore([{ name: 'x', subscribes: ['reading'] }]), /onEvent/);
});

test('onStart, ctx.every e stop', async () => {
  class Timer extends Agent {
    name = 'timer';
    ticks = 0;
    async onStart(ctx) {
      ctx.every(10, () => this.ticks++);
    }
  }
  const t = new Timer();
  const core = newCore([t]);
  await core.start();
  await new Promise((r) => setTimeout(r, 55));
  await core.stop();
  const n = t.ticks;
  assert.ok(n >= 2);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(t.ticks, n, 'il timer si ferma con stop()');
});

test('oggetto semplice come agente e cooldown', async () => {
  const got = [];
  const core = newCore([{ name: 'semplice', subscribes: ['reading'], onEvent: (e) => got.push(e) }]);
  core.ingestReading(reading('d', { x: 1 }));
  await core.idle();
  assert.equal(got.length, 1);
  const a = new Agent();
  assert.equal(a.cooldown('k', 1000, 0), true);
  assert.equal(a.cooldown('k', 1000, 500), false);
  assert.equal(a.cooldown('k', 1000, 1500), true);
});
