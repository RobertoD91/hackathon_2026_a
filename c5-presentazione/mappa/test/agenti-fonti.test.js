// Test dell'agente "fonti" e dell'orchestratore della mappa sui dati reali (fonti e snapshot
// dell'API dati città, citta-api/fonti/, impostati a mano: nessuna rete).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as N from '../../../citta-api/fonti/normalizza.js';
import * as D from '../../../citta-api/fonti/dati.js';
import { createCore } from '../src/core.js';
import { silentLogger } from '../src/log.js';
import { FontiAgent } from '../agents/fonti.js';
import { Orchestrator, rispostaReale, rispostaDeterministica } from '../agents/orchestrator.js';

const T = N.daOraLocale(2026, 11, 14, 15, 0); // sabato 14/11/2026, 15:00 a Napoli

test('agente fonti: scenari degli eventi reali sull\'ora simulata, stagione, contesto all\'orchestratore', async () => {
  const oggi = '2026-11-14';
  D.impostaSnapshot('eventi', {
    meta: { generato: '2026-11-14T01:00:00Z' },
    partite: [{ giorno: oggi, ora: '20:45', casa: 'Napoli', ospite: 'Torino', fonte: 'openfootball' }],
    crociere: [],
    comune: [{ titolo: 'Tri Gold Caracciolo 2026', inizio: N.daOraLocale(2026, 11, 14, 9), fine: N.daOraLocale(2026, 11, 15, 13), zona: 'lungomare', grande: true, tipo: 'Evento sportivo' }],
    speciali: [],
  });
  D.impostaSnapshot('trasporti', { stazioni: [{ id: 'anm-6240', nome: 'Chiaia', linee: ['L6'], tipo: 'metro' }, { id: 'anm-6231', nome: 'Mostra', linee: ['L6'], tipo: 'metro' }], vicine: { plebiscito: [{ id: 'anm-6240', m: 97, piedi: 2 }], lungomare: [], maradona: [{ id: 'anm-6231', m: 420, piedi: 7 }] } });
  D.impostaSnapshot('riferimenti', { stagionalita: { anno: 2025, mediaArrivi: 364_316, mesi: { 11: { arrivi: 189_942 } } } });
  let simT = N.daOraLocale(2026, 11, 14, 15, 0);
  const core = createCore({ log: silentLogger, llm: { provider: 'mock' } });
  core.addAgent(new FontiAgent({ rete: false, ogniMs: 20 }));
  core.addAgent(new Orchestrator());
  // l'ora simulata la dà il simulatore (meta.simTime delle letture)
  const lettura = () => core.ingestReading({ deviceId: 'x', location: { zone: 'lungomare' }, readings: { people_count: 10 }, meta: { simulated: true, simTime: simT, speed: 1 } });
  lettura();
  await core.start();
  await new Promise((ok) => setTimeout(ok, 80));
  await core.idle();
  const attivi = () => core.state.activeScenarios().map((s) => s.name).sort();
  assert.deepEqual(attivi(), ['evento_lungomare', 'stagione_bassa'], 'alle 15:00 il triathlon sì, la partita (20:45) non ancora');
  assert.equal(core.state.scenario('evento_lungomare').params.eventi[0], 'Tri Gold Caracciolo 2026');
  assert.equal(core.state.metric('eventi_oggi').value, 2);
  assert.ok(core.state.decisions().some((d) => d.source === 'fonti' && /Tri Gold/.test(d.data.summary)));

  // alle 18:00 inizia la finestra della partita (3 ore prima del calcio d'inizio)
  simT = N.daOraLocale(2026, 11, 14, 18, 0);
  lettura();
  await new Promise((ok) => setTimeout(ok, 80));
  await core.idle();
  assert.ok(attivi().includes('evento_maradona'), `attivi: ${attivi()}`);
  assert.equal(core.state.scenario('evento_maradona').params.eventi[0], 'Napoli - Torino');
  // il giorno dopo alle 15:00 il triathlon è finito (fino alle 13:00) e non c'è più la partita
  simT = N.daOraLocale(2026, 11, 15, 15, 0);
  lettura();
  await new Promise((ok) => setTimeout(ok, 80));
  await core.idle();
  assert.deepEqual(attivi(), ['stagione_bassa']);
  simT = N.daOraLocale(2026, 11, 14, 15, 0);
  lettura();
  await new Promise((ok) => setTimeout(ok, 80));
  await core.idle();

  // l'orchestratore usa i dati reali nella chat e nei consigli anti-folla
  const r = await core.chat({ from: 'u', text: 'Come arrivo al Maradona?' });
  assert.match(r.reply, /Mostra \(L6\) 7 min a piedi/);
  assert.match((await core.chat({ from: 'u', text: 'che eventi ci sono oggi?' })).reply, /Tri Gold Caracciolo 2026/);
  core.publish('agent.message', { to: 'orchestrator', text: 'affollato', payload: { tipo: 'affollamento', zona: 'lungomare', luogo: 'Lungomare Caracciolo', persone: 5200, alternativa: { zona: 'plebiscito', nome: 'Piazza del Plebiscito', km: 1.2 } } }, { source: 'folla' });
  await core.idle();
  const msg = core.state.notifications({ channel: 'whatsapp' }).map((n) => n.data.text).find((t) => t.includes('Lungomare'));
  assert.match(msg, /Oggi c'è "Tri Gold Caracciolo 2026"/);
  assert.match(msg, /Stazione più vicina a Piazza del Plebiscito: Chiaia \(L6\), 2 min a piedi/);
  await core.stop();
  for (const n of ['eventi', 'trasporti', 'riferimenti']) D.impostaSnapshot(n, null);
});

test('orchestratore: risposte sui dati reali (aria, allerta) e nessuna risposta senza dati', () => {
  const r = { aria: { a: { aqi: 21 }, b: { aqi: 19 } }, allerta: { livello: 2, colore: 'gialla', al: N.daOraLocale(2026, 11, 14, 12), scaduta: false }, meteo: { vomero: { temperatura: 16.4, cielo: 'Quasi sereno', vento: 6 } } };
  assert.match(rispostaReale("com'è l'aria?", r), /discreta \(indice europeo 21/);
  assert.match(rispostaReale('piove al Vomero?', r), /Allerta gialla .* fino alle 12:00 del 14 nov.*Vomero · Piazza Vanvitelli: quasi sereno, 16.4 °C/);
  assert.equal(rispostaReale('come arrivo al Maradona?', {}), null);
  assert.equal(rispostaReale('ciao', r), null);
  assert.equal(rispostaReale('cosa dice il termometro?', { vicine: { plebiscito: [] } }), null, '"termometro" non è una domanda sulla metro');
  assert.equal(N.descriviTipiAllerta(['mare', 'piogge']), 'mare agitato, piogge');
  // la temperatura dei sensori (simulata in demo) è accompagnata da quella reale, con la virgola
  const stato = { zones: () => ['plebiscito'], average: () => 18.84, simTime: () => T, metric: () => null, activeScenarios: () => [], devices: () => [] };
  const t = rispostaDeterministica("che temperatura c'è?", stato, { meteo: { a: { temperatura: 16.9 }, b: { temperatura: 17.1 } } });
  assert.match(t, /Plebiscito 18,8 °C/);
  assert.match(t, /Temperatura reale adesso: 17 °C \(Open-Meteo\)/);
});
