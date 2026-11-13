// Utilità dei test: fa girare una giornata intera accelerata (nucleo + agenti + simulatore)
// senza HTTP e senza rete. Usata da agenti.test.js; si può lanciare anche a mano:
//   node c2-cer-quartiere/test/giornata.js        → stampa i KPI di fine giornata

import { readFile } from 'node:fs/promises';
import { createCore, createSimulator, silentLogger } from '../../shared/iot-agents/src/index.js';
import { createAgents } from '../agents/index.js';

/**
 * @param {{fattore?: number, previsione?: string, scenari?: boolean, durataS?: number}} [o]
 *   fattore: quante volte più veloce della demo (predefinito 10: la giornata dura 30 s)
 */
export async function giornata({ fattore = 10, previsione = 'simulata', scenari = true, durataS, onStato } = {}) {
  const cfg = JSON.parse(await readFile(new URL('../sim-config.json', import.meta.url), 'utf8'));
  cfg.speed *= fattore;
  cfg.intervalSec /= fattore;
  cfg.loopSec = cfg.loopSec / fattore + 5; // niente secondo giro durante il test
  for (const d of cfg.devices) for (const def of Object.values(d.readings)) for (const eff of Object.values(def.effects || {})) if (eff.rampSec) eff.rampSec /= fattore;
  cfg.timeline = scenari ? cfg.timeline.map((t) => ({ ...t, at: t.at / fattore, duration: t.duration / fattore })) : [];
  const core = createCore({ agents: createAgents({ previsione, tickMs: 1000 / fattore }), log: silentLogger, llm: { provider: 'mock' } });
  const eventi = [];
  let ultimo = null;
  core.subscribe((e) => {
    if (e.type === 'cer.stato') {
      ultimo = e.data;
      onStato?.(e.data);
    } else eventi.push(e);
  });
  await core.start();
  const sim = createSimulator(cfg, {
    emit: (r) => core.ingestReading(r),
    emitScenario: (s) => core.scenario(s.name, s.params, { active: s.active, duration: s.duration }),
    selfTrigger: false,
  });
  core.bus.subscribe((e) => sim.onScenarioEvent(e.data), { types: ['scenario'] });
  sim.start({ tickMs: 20 });
  const ms = (durataS ?? (cfg.loopSec - 5)) * 1000 - 300;
  await new Promise((r) => setTimeout(r, ms));
  sim.stop();
  const finale = ultimo;
  await core.stop();
  return { core, eventi, finale };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { eventi, finale } = await giornata({ previsione: process.argv[2] || 'simulata' });
  const k = finale.kpi;
  console.log('ora finale', finale.orario, 'ore simulate', k.oreSimulate);
  console.log('con  ', k.con);
  console.log('senza', k.senza);
  console.log('delta', k.delta, 'annuo', k.annuo);
  for (const f of finale.famiglie) console.log(f.nome.padEnd(11), f.condivisaKwhSenza, '→', f.condivisaKwh, 'kWh', f.euro, '€', f.carichi.map((c) => `${c.tipo}:${c.stato}:${c.piano.map((p) => p.join('-')).join(',')}`).join(' '));
  const dec = eventi.filter((e) => e.type === 'agent.decision').map((e) => `${e.source}: ${e.data.summary}`);
  console.log(dec.join('\n'));
  console.log('notifiche whatsapp', eventi.filter((e) => e.type === 'notify' && e.data.channel === 'whatsapp').length);
}
