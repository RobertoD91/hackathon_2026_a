// Test degli agenti con il nucleo vero (createCore) e il simulatore, senza HTTP né rete.
//   node --test c2-cer-quartiere/test/

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createCore, silentLogger } from '../../shared/iot-agents/src/index.js';
import { ProduzioneAgent } from '../agents/produzione.js';
import { CasaAgent } from '../agents/casa.js';
import { FAMIGLIE } from '../model/quartiere.js';
import { giornata } from './giornata.js';

const attendi = (ms) => new Promise((r) => setTimeout(r, ms));

test('giornata intera accelerata: con gli agenti la CER condivide più energia', { timeout: 60_000 }, async () => {
  const { eventi, finale } = await giornata({ fattore: 15 });
  assert.ok(finale, 'nessun evento cer.stato');
  const k = finale.kpi;
  assert.ok(k.oreSimulate > 16, `ore simulate ${k.oreSimulate}`);

  // stessa giornata: stessa produzione, (quasi) stessa energia consumata
  assert.equal(k.con.prodottaKwh, k.senza.prodottaKwh);
  assert.ok(Math.abs(k.con.consumataKwh - k.senza.consumataKwh) / k.senza.consumataKwh < 0.03, 'si sposta il consumo, non lo si aumenta');

  // il cuore: più energia condivisa, euro e CO₂
  assert.ok(k.delta.condivisaKwh > 8, `kWh condivisi in più: ${k.delta.condivisaKwh}`);
  assert.ok(k.con.quotaCondivisa > k.senza.quotaCondivisa + 0.1);
  assert.ok(k.delta.incentivoEuro > 0 && k.delta.co2Kg > 0);
  assert.ok(k.delta.bollettaEuro > 0, 'meno consumi nelle ore care della sera');
  assert.ok(k.con.equita >= k.senza.equita, 'la distribuzione del sole non peggiora');

  // il flusso tra agenti
  const msg = eventi.filter((e) => e.type === 'agent.message');
  assert.ok(msg.some((e) => e.data.payload?.tipo === 'richieste' && e.source.startsWith('casa-')));
  assert.ok(msg.some((e) => e.data.payload?.tipo === 'previsione' && e.source === 'produzione'));
  assert.ok(msg.some((e) => e.data.payload?.tipo === 'proposta' && e.source === 'orchestrator'));
  assert.ok(msg.some((e) => e.data.payload?.tipo === 'risposta' && e.data.payload.rifiutate.length > 0), 'qualche famiglia dice di no');

  // la nuvola della timeline: vista dai sensori, non dal pulsante
  const dec = eventi.filter((e) => e.type === 'agent.decision');
  assert.ok(dec.some((e) => e.source === 'produzione' && /Nuvola/.test(e.data.summary)), 'nuvola non rilevata');
  assert.ok(dec.some((e) => e.source === 'produzione' && /Torna il sole/.test(e.data.summary)));

  // l'auto elettrica della timeline viene pianificata (non parte a piena potenza alle 7:30)
  const auto = finale.famiglie.find((f) => f.id === 'sorrentino').carichi.find((c) => c.tipo === 'auto');
  assert.ok(auto, 'auto elettrica della timeline mancante');
  assert.notEqual(auto.stato, 'in_attesa');

  // le persone: WhatsApp alle famiglie e al gruppo, con orari
  const wa = eventi.filter((e) => e.type === 'notify' && e.data.channel === 'whatsapp');
  assert.ok(wa.filter((e) => e.data.to.startsWith('famiglia-')).length >= 8);
  assert.ok(wa.some((e) => /alle \d\d:\d\d/.test(e.data.text)));
  assert.ok(wa.some((e) => /tra un'ora c'è sole|tra poco c'è sole/.test(e.data.text)), 'manca il promemoria "tra un\'ora c\'è sole"');
  assert.ok(wa.some((e) => e.data.to === 'cer-rione-sole' && /Riepilogo/.test(e.data.text)));

  // la proiezione a fine giornata esiste e, a giornata finita, coincide quasi con il conto vero
  assert.ok(finale.kpi.fineGiornata);
  assert.ok(Math.abs(finale.kpi.fineGiornata.con.condivisaKwh - k.con.condivisaKwh) < 1.5);

  // la serie per il grafico
  assert.equal(finale.serie.prod.length, 72);
  assert.ok(Math.max(...finale.serie.prod.filter((x) => x !== null)) > 5);
});

test('chat: risposte con orari e numeri, anche senza LLM', { timeout: 30_000 }, async () => {
  const { risposte } = await giornataConChat();
  assert.match(risposte.auto, /Conviene caricare l'auto tra le \d\d:\d\d e le \d\d:\d\d/);
  assert.match(risposte.lavatrice, /lavatrice/);
  assert.match(risposte.risparmi, /kWh condivisi/);
  assert.match(risposte.produzione, /i tetti producono/);
  assert.match(risposte.aiuto, /CER Rione Sole/);
  assert.match(risposte.famiglia, /Russo/);
});

async function giornataConChat() {
  const out = {};
  const { readFile } = await import('node:fs/promises');
  const { createSimulator } = await import('../../shared/iot-agents/src/index.js');
  const { createAgents } = await import('../agents/index.js');
  const cfg = JSON.parse(await readFile(new URL('../sim-config.json', import.meta.url), 'utf8'));
  cfg.start = '09:00';
  cfg.speed = 216 * 15;
  cfg.intervalSec = 2 / 15;
  cfg.loopSec = 100;
  cfg.timeline = [];
  const core = createCore({ agents: createAgents({ previsione: 'simulata', tickMs: 1000 / 15 }), log: silentLogger, llm: { provider: 'mock' } });
  await core.start();
  const sim = createSimulator(cfg, { emit: (r) => core.ingestReading(r), selfTrigger: false });
  sim.start({ tickMs: 20 });
  await attendi(2500); // fino alle ~11
  out.auto = (await core.chat({ from: 'famiglia-deluca', text: 'Quando conviene caricare l\'auto?' })).reply;
  out.lavatrice = (await core.chat({ from: 'dashboard', text: 'quando faccio la lavatrice?' })).reply;
  out.risparmi = (await core.chat({ from: 'dashboard', text: 'Quanto abbiamo risparmiato oggi?' })).reply;
  out.produzione = (await core.chat({ from: 'dashboard', text: 'quanto producono i pannelli?' })).reply;
  out.aiuto = (await core.chat({ from: 'dashboard', text: 'come funziona la CER?' })).reply;
  out.famiglia = (await core.chat({ from: 'famiglia-russo', text: 'qual è il nostro programma di oggi?' })).reply;
  sim.stop();
  await core.stop();
  return { risposte: out };
}

test('produzione: usa Open-Meteo quando risponde e lo dichiara', async () => {
  const cop = new Array(24).fill(0).map((_, h) => (h >= 10 && h < 15 ? 100 : 0));
  const fetchFinto = async (url) => {
    assert.match(url, /api\.open-meteo\.com/);
    assert.match(url, /cloud_cover/);
    return { ok: true, json: async () => ({ hourly: { time: ['2026-11-14T00:00'], cloud_cover: cop, temperature_2m: new Array(24).fill(15) } }) };
  };
  const agente = new ProduzioneAgent({ previsione: 'auto', fetch: fetchFinto });
  const core = createCore({ agents: [agente], log: silentLogger, llm: { provider: 'mock' } });
  await core.start();
  await attendi(20);
  assert.equal(agente.meteo.fonte, 'open-meteo');
  const sole = { alba: 7, tramonto: 17, gMezzogiorno: 750 };
  const prev = agente.previsione(6, sole);
  // a cielo coperto (10-15) la previsione è un quarto del sereno, più avanti torna piena
  const k12 = prev[(12 - 6) * 4];
  const k16 = prev[(16 - 6) * 4];
  assert.ok(k12 < 4, `ore 12 coperte: ${k12} kW`);
  assert.ok(k16 > 2, `ore 16 serene: ${k16} kW`);
  const dec = core.state.decisions();
  assert.ok(dec.some((e) => /Open-Meteo/.test(e.data.summary)));
  await core.stop();
});

test('produzione: senza rete usa la previsione simulata e lo dichiara', async () => {
  const agente = new ProduzioneAgent({ previsione: 'auto', fetch: async () => { throw new Error('rete assente'); } });
  const core = createCore({ agents: [agente], log: silentLogger, llm: { provider: 'mock' } });
  await core.start();
  await attendi(20);
  assert.equal(agente.meteo.fonte, 'simulata');
  assert.match(agente.meteo.nota, /non raggiungibile/);
  assert.ok(core.state.decisions().some((e) => /simulata/.test(e.data.summary)));
  await core.stop();
});

test('produzione: un ESP32 vero ha la precedenza sul simulato della stessa zona', async () => {
  const agente = new ProduzioneAgent({ previsione: 'simulata', luxGain: { 'esp32-tetto-b': 2 } });
  const core = createCore({ agents: [agente], log: silentLogger, llm: { provider: 'mock' } });
  await core.start();
  core.ingestReading({ deviceId: 'sim-tetto-b', location: { zone: 'scala-b' }, readings: { light_lux: 40000 }, meta: { simulated: true } });
  core.ingestReading({ deviceId: 'esp32-tetto-b', location: { zone: 'scala-b' }, readings: { light_lux: 6000, temperature_c: 21 }, meta: { net: 'wifi' } });
  await core.idle();
  const { letturaTetti } = await import('../model/tetti.js');
  const b = letturaTetti(core.state, { luxGain: { 'esp32-tetto-b': 2 } }).find((t) => t.id === 'tetto-b');
  assert.equal(b.deviceId, 'esp32-tetto-b');
  assert.equal(b.reale, true);
  assert.equal(b.lux, 12000, 'luce moltiplicata da LUX_GAIN');
  assert.equal(b.temp, 21);
  await core.stop();
});

test('casa: rifiuta le proposte fuori dalla sua finestra e risponde sempre', async () => {
  const f = FAMIGLIE.find((x) => x.id === 'marino'); // lavatrice tra le 8 e le 18
  const casa = new CasaAgent(f);
  const risposte = [];
  const orch = {
    name: 'orchestrator',
    subscribes: ['agent.message'],
    onEvent: (e) => {
      if (e.data.payload?.tipo === 'risposta') risposte.push(e.data.payload);
    },
  };
  const core = createCore({ agents: [casa, orch], log: silentLogger, llm: { provider: 'mock' } });
  await core.start();
  core.publish('agent.message', { to: '*', text: 'nuovo giorno', payload: { tipo: 'nuovo_giorno', giorno: 1 } }, { source: 'orchestrator-test' });
  await core.idle();
  const { profiloBlocco } = await import('../model/energia.js');
  core.publish(
    'agent.message',
    { to: 'casa-marino', text: 'proposta', payload: { tipo: 'proposta', famiglia: 'marino', versione: 1, carichi: [{ id: 'marino:lavatrice', profilo: profiloBlocco(20, 2, 0.5) }] } },
    { source: 'orchestrator-test' },
  );
  await core.idle();
  assert.equal(risposte.length, 1);
  assert.equal(risposte[0].rifiutate[0].id, 'marino:lavatrice');
  assert.match(risposte[0].rifiutate[0].motivo, /orari/);
  assert.equal(core.state.notifications().length, 0, 'nessun messaggio alla famiglia per una proposta rifiutata');
  await core.stop();
});
