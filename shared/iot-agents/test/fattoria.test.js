// Test dello scenario "Acqua comune" (example/fattoria/): piano dei turni, bilancio idrico,
// agente meteo (Open-Meteo con fetch finto), agenti nel nucleo e configurazioni della mappa.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createCore } from '../src/core.js';
import { silentLogger } from '../src/log.js';
import { resolveStart, formatClock } from '../sim/sim-core.js';
import { CAMPI, SERBATOIO, livelloUmidita, parametri } from '../example/fattoria/campi.js';
import { pianificaNotte, fabbisognoCampo, finestraNotte, litriCalendario, testoTurno, turnoCambiato } from '../example/fattoria/piano.js';
import { createFisica, attachFattoria } from '../example/fattoria/simulatore.js';
import { createAgents, MeteoAgent } from '../example/fattoria/agents/index.js';
import { livelloConIsteresi } from '../example/fattoria/agents/campo.js';
import { rispostaConsorzio } from '../example/fattoria/agents/consorzio.js';
import { aggregaSensori, livelloPerSoglie } from '../example/mappa.js';

const TZ = 'Europe/Rome';
const NOW = Date.UTC(2026, 6, 15, 10, 0); // 15/07/2026, in stagione irrigua
const ore = (hhmm) => resolveStart(hhmm, { now: NOW, timezone: TZ });
const conf = JSON.parse(await readFile(new URL('../example/fattoria/sim-config.json', import.meta.url), 'utf8'));
const theta0 = Object.fromEntries(conf.devices.filter((d) => CAMPI[d.location.zone]).map((d) => [d.location.zone, d.readings.soil_moisture_pct.value]));
const SERENO = { et0Domani: 5.8, pioggiaDomani: 0 };

test('dati della fattoria: 10 campi con poligono, coltura con Kc e superficie plausibile', () => {
  assert.equal(Object.keys(CAMPI).length, 10);
  for (const [z, c] of Object.entries(CAMPI)) {
    assert.ok(c.poligono.length >= 4, z);
    assert.ok(c.area > 5000 && c.area < 30000, `${z}: ${c.area} m²`);
    const p = parametri(c);
    assert.ok(p.kc >= 0.6 && p.kc <= 1.2, `${z}: Kc ${p.kc}`);
    assert.ok(p.k > 0 && p.obiettivo > p.soglia, z);
  }
  assert.equal(livelloUmidita(15).id, 'stress');
  assert.equal(livelloUmidita(20).id, 'asciutto');
  assert.equal(livelloUmidita(28).id, 'ottimale');
  assert.equal(livelloUmidita(36).id, 'saturo');
  assert.equal(livelloConIsteresi(17.9, 'asciutto').id, 'asciutto', 'isteresi vicino alla soglia');
  assert.equal(livelloConIsteresi(17.4, 'asciutto').id, 'stress');
});

test('finestra notturna dei turni: 22:00-06:00 della notte giusta', () => {
  const sera = finestraNotte(ore('18:00'), TZ);
  assert.equal(formatClock(sera.inizio, TZ), '22:00');
  assert.equal(sera.fine - sera.inizio, 8 * 3_600_000);
  const notte = finestraNotte(ore('23:30'), TZ);
  assert.equal(formatClock(notte.inizio, TZ), '22:00');
  assert.ok(notte.inizio < ore('23:30'));
});

test('piano: lo stress viene prima, olivo e campo saturo senza turno, turni in sequenza nella notte', () => {
  const p = pianificaNotte({ umidita: theta0, previsione: SERENO, ora: ore('18:00'), disponibileL: 900_000, tz: TZ });
  const t = Object.fromEntries(p.turni.map((x) => [x.zona, x]));
  assert.equal(t.campo_03.stato, 'turno');
  assert.equal(formatClock(t.campo_03.inizio, TZ), '22:00', 'il campo in stress apre la notte');
  assert.equal(t.campo_01.stato, 'nessuno');
  assert.match(t.campo_01.motivo, /tollera/);
  assert.equal(t.campo_09.stato, 'nessuno');
  assert.match(t.campo_09.motivo, /saturo/);
  const attivi = p.turni.filter((x) => x.litri > 0).sort((a, b) => a.inizio - b.inizio);
  for (let i = 1; i < attivi.length; i++) assert.ok(attivi[i].inizio >= attivi[i - 1].fine, 'un turno alla volta');
  assert.ok(attivi.at(-1).fine <= p.fineNotte);
  assert.ok(p.totaleL <= 900_000);
  assert.equal(p.calendarioL, Object.values(CAMPI).reduce((s, c) => s + litriCalendario(c), 0));
  assert.ok(p.risparmioL > 0, `risparmio ${p.risparmioL}`);
  assert.match(testoTurno(t.campo_03, SERENO), /^stanotte irriga il campo 3 .* dalle 22:00 per .*litri/);
});

test('piano: con la pioggia restano solo i turni brevi per uscire dallo stress', () => {
  const p = pianificaNotte({ umidita: theta0, previsione: { et0Domani: 3.5, pioggiaDomani: 18 }, ora: ore('18:00'), disponibileL: 900_000, tz: TZ });
  const attivi = p.turni.filter((x) => x.litri > 0);
  assert.deepEqual(attivi.map((x) => x.zona), ['campo_03']);
  assert.match(attivi[0].motivo, /stress.*piove/);
  assert.ok(p.turni.filter((x) => /domani piove/.test(x.motivo)).length >= 5);
  assert.ok(p.risparmioL > 700_000);
});

test('piano: con poca acqua i campi meno urgenti sono ridotti o rinviati, mai lo stress', () => {
  const pieno = pianificaNotte({ umidita: theta0, previsione: SERENO, ora: ore('18:00'), disponibileL: 900_000, tz: TZ });
  const poca = pianificaNotte({ umidita: theta0, previsione: SERENO, ora: ore('18:00'), disponibileL: 450_000, tz: TZ });
  assert.ok(poca.totaleL <= 450_000);
  assert.ok(poca.tagliati > 0);
  assert.equal(poca.turni.find((x) => x.zona === 'campo_03').stato, 'turno');
  const rinviato = poca.turni.find((x) => x.stato === 'rinviato' || x.stato === 'ridotto');
  assert.ok(rinviato.priorita <= pieno.turni.find((x) => x.zona === 'campo_03').priorita);
  assert.ok(turnoCambiato(pieno.turni.find((x) => x.zona === rinviato.zona), rinviato));
});

test('fabbisogno: più caldo domani = più acqua', () => {
  const c = CAMPI.campo_04;
  const normale = fabbisognoCampo(c, 22, { et0Domani: 5.8, pioggiaDomani: 0 });
  const caldo = fabbisognoCampo(c, 22, { et0Domani: 7.8, pioggiaDomani: 0 });
  assert.ok(caldo.litri > normale.litri);
});

test('bilancio idrico: di giorno il suolo si asciuga, il turno lo bagna, la vasca scende e la giornata ricomincia', () => {
  const f = createFisica(conf.fisica, { timezone: TZ });
  const lettura = (zona, t, readings) => ({ deviceId: zona, location: { zone: zona }, readings, meta: { simTime: t, simulated: true } });
  const t0 = ore('12:00');
  const H = 3_600_000;
  // una lettura all'ora per campo e vasca, in ordine di tempo (il bilancio fa al massimo 2 h per passo)
  const campo = {};
  let vasca;
  for (let h = 0; h <= 10; h++) {
    if (h === 9) f.irriga({ zone: 'campo_03', litri: 60_000, minuti: 30, inizio: t0 + 9 * H }); // 21:00, sole tramontato
    campo[h] = f.applica(lettura('campo_03', t0 + h * H, { soil_moisture_pct: 20 })).readings.soil_moisture_pct;
    vasca = f.applica(lettura('serbatoio', t0 + h * H, { fill_pct: 60 })).readings.fill_pct;
  }
  assert.ok(campo[2] < 19.5, `di giorno asciuga: ${campo[2]}`);
  assert.ok(campo[9] < campo[2], 'continua ad asciugare fino al tramonto');
  // 60.000 l su 11.980 m² = 5 mm × efficienza 0,9 × k 0,83 = +3,8 punti (di notte niente evapotraspirazione)
  assert.ok(Math.abs(campo[10] - campo[9] - 3.76) < 0.3, `turno: ${campo[9]} → ${campo[10]}`);
  const atteso = 60 + ((SERBATOIO.ricaricaM3h * 10 - 60) / SERBATOIO.capacitaM3) * 100;
  assert.ok(Math.abs(vasca - atteso) < 0.2, `vasca ${vasca} vs ${atteso}`);
  // la giornata simulata ricomincia (loopSec): si torna ai valori della configurazione
  const nuovo = f.applica(lettura('campo_03', t0 - 2 * H, { soil_moisture_pct: 20 })).readings.soil_moisture_pct;
  assert.ok(Math.abs(nuovo - 20) < 0.3, `reset: ${nuovo}`);
});

const risposta = (status, body) => async () => ({ ok: status === 200, status, json: async () => body });
const OPEN_METEO = {
  daily: {
    time: ['2026-07-15', '2026-07-16'],
    et0_fao_evapotranspiration: [6.1, 6.4],
    precipitation_sum: [0, 3.2],
    precipitation_probability_max: [5, 60],
    temperature_2m_max: [33, 31],
  },
};

async function previsioneDa(opts, scenari = []) {
  const meteo = new MeteoAgent({ oraReale: () => NOW, ...opts });
  const core = createCore({ agents: [meteo], log: silentLogger, llm: { provider: 'mock' } });
  const messaggi = [];
  core.subscribe((e) => messaggi.push(e.data.payload.previsione), { types: ['agent.message'] });
  await core.start();
  await new Promise((r) => setTimeout(r, 30)); // la risposta (finta) di Open-Meteo arriva dopo onStart
  for (const [name, params] of scenari) core.scenario(name, params);
  await core.idle();
  await core.stop();
  return messaggi.at(-1);
}

test('meteo: in stagione usa Open-Meteo; con 429 o senza rete usa la previsione simulata e lo dichiara', async () => {
  const reale = await previsioneDa({ fetch: risposta(200, OPEN_METEO) });
  assert.equal(reale.fonte, 'open-meteo');
  assert.equal(reale.et0Domani, 6.4);
  assert.equal(reale.pioggiaDomani, 3.2);
  const troppe = await previsioneDa({ fetch: risposta(429, {}) });
  assert.equal(troppe.fonte, 'simulata');
  assert.match(troppe.motivo, /429/);
  const offline = await previsioneDa({ rete: false });
  assert.equal(offline.fonte, 'simulata');
  const giu = await previsioneDa({ fetch: async () => { throw new Error('ECONNREFUSED'); } });
  assert.match(giu.motivo, /non raggiungibile/);
});

test('meteo: fuori stagione mostra i valori reali ma usa la simulata, salvo il pulsante "previsione reale"', async () => {
  const novembre = Date.UTC(2026, 10, 14, 10, 0);
  const fuori = await previsioneDa({ fetch: risposta(200, OPEN_METEO), oraReale: () => novembre });
  assert.equal(fuori.fonte, 'simulata');
  assert.match(fuori.motivo, /fuori stagione/);
  assert.equal(fuori.reale.pioggiaDomani, 3.2);
  const chiesta = await previsioneDa({ fetch: risposta(200, OPEN_METEO), oraReale: () => novembre }, [['meteo_reale', {}]]);
  assert.equal(chiesta.fonte, 'open-meteo');
  const pioggia = await previsioneDa({ rete: false }, [['pioggia_in_arrivo', { mm: 18 }], ['ondata_calore', {}]]);
  assert.equal(pioggia.pioggiaDomani, 18);
  assert.deepEqual(pioggia.modifiche, ['ondata di calore', 'pioggia in arrivo']);
});

test('agenti della fattoria nel nucleo: piano, WhatsApp agli agricoltori, valvola aperta alle 22:00, chat', async () => {
  const core = createCore({ agents: createAgents({ meteo: { rete: false } }), log: silentLogger, llm: { provider: 'mock' } });
  await core.start();
  const invia = (t) => {
    for (const d of conf.devices) {
      const readings = d.location.zone === 'serbatoio' ? { fill_pct: 62 } : CAMPI[d.location.zone] ? { soil_moisture_pct: theta0[d.location.zone] } : { temperature_c: 30 };
      const r = core.ingestReading({ deviceId: d.id, location: d.location, readings, meta: { simulated: true, simTime: t, speed: 1 } });
      assert.equal(r.ok, true, r.error);
    }
  };
  invia(ore('18:00'));
  await core.idle();
  const s = core.state.snapshot();
  const piano = s.decisions.find((d) => d.source === 'orchestrator' && /Piano irriguo/.test(d.data.summary));
  assert.ok(piano, 'decisione con il piano');
  assert.equal(piano.data.actions.length, 10);
  assert.ok(piano.data.actions.some((a) => a.type === 'turno' && a.zone === 'campo_03'));
  const wa = s.notifications.filter((n) => n.data.channel === 'whatsapp');
  assert.equal(wa.length, 10, 'un messaggio per agricoltore');
  assert.match(wa.find((n) => n.data.to === 'agricoltore-aniello').data.text, /campo 3 .*dalle 22:00/);
  assert.ok(core.state.metric('litri_risparmiati'));
  assert.equal(core.state.metric('serbatoio_pct').value, 62);

  const { reply } = await core.chat({ from: 'aniello', text: 'Quando irrigo il campo 3?' });
  assert.match(reply, /Campo 3 .*stanotte alle 22:00/);

  invia(ore('22:10'));
  await core.idle();
  const valvola = core.state.decisions().find((d) => d.data.actions?.some((a) => a.type === 'apri_valvola' && a.zone === 'campo_03'));
  assert.ok(valvola, 'il consorzio apre l\'acqua del campo 3');
  assert.match((await core.chat({ from: 'aniello', text: 'quando irrigo il campo 3?' })).reply, /sta irrigando adesso/);
  await core.stop();
});

test('rispostaConsorzio: risposte senza piano e domande generali', () => {
  const state = { simTime: () => ore('16:00'), average: () => null, values: () => [] };
  assert.match(rispostaConsorzio('quando irrigo il campo 3?', { state, piano: null, previsione: null }), /non è ancora pronto/);
  assert.match(rispostaConsorzio('boh', { state, piano: null, previsione: null }), /quando irrigo il campo 3/);
});

test('attachFattoria: simulatore + bilancio idrico collegati al nucleo', async () => {
  const core = createCore({ log: silentLogger, llm: { provider: 'mock' } });
  const veloce = { ...conf, intervalSec: 0.2, timeline: [] };
  const att = attachFattoria(core, veloce);
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(core.state.devices().length, 12);
  core.publish('agent.decision', { summary: 'prova', actions: [{ type: 'apri_valvola', zone: 'campo_03', litri: 1000, minuti: 5, inizio: core.state.simTime() }] });
  assert.equal(att.fisica.valvole.length, 1, 'la valvola arriva al bilancio idrico');
  att.stop();
  await core.stop();
});

test('mappa: aggregato generico dei sensori e livelli per soglie (configurazioni di Napoli e fattoria)', async () => {
  const a = aggregaSensori([
    { readings: { people_count: 100, temperature_c: 20 }, simulated: true, ts: 1 },
    { readings: { people_count: 50, temperature_c: 22, button: true }, simulated: false, ts: 5 },
  ]);
  assert.equal(a.somma.people_count, 150);
  assert.equal(a.media.temperature_c, 21);
  assert.equal(a.sensori, 2);
  assert.equal(a.reali, 1);
  assert.equal(a.ts, 5);
  assert.equal(livelloPerSoglie(5, ['a', 'b', 'c'], [3, 6]), 'b');
  assert.equal(livelloPerSoglie(9, ['a', 'b', 'c'], [3, 6]), 'c');

  const { MAPPA: napoli } = await import('../example/napoli.js');
  const folla = napoli.indicatori.find((i) => i.id === 'folla');
  assert.equal(folla.livelli.length, 4);
  const agg = napoli.aggrega([{ readings: { people_count: 2700, temperature_c: 15 }, ts: 1 }]);
  assert.equal(folla.valuta(agg, napoli.luoghi.plebiscito).livello, 'affollato');
  assert.equal(napoli.indicatori.find((i) => i.id === 'caldo').valuta(agg).livello, 'tranquillo');

  const { MAPPA: fattoria } = await import('../example/fattoria/scenario.js');
  assert.equal(Object.keys(fattoria.luoghi).length, 12);
  const umidita = fattoria.indicatori.find((i) => i.id === 'umidita');
  assert.deepEqual(umidita.livelli.map((l) => l.label), ['Stress idrico', 'Asciutto', 'Ottimale', 'Saturo']);
  assert.equal(umidita.valuta(aggregaSensori([{ readings: { soil_moisture_pct: 16 } }])).livello, 'stress');
});
