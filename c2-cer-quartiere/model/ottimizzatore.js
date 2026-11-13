// Ottimizzatore dell'agente comunità: sposta i carichi delle famiglie nelle ore in cui
// il sole dei tetti non è già usato dal quartiere, per massimizzare l'energia condivisa.
//
// Algoritmo goloso, deterministico e spiegabile (niente LLM):
// 1. si parte dal "sole libero" previsto per ogni quarto d'ora: produzione prevista meno
//    consumi non spostabili (e meno i carichi già partiti);
// 2. le famiglie si servono a turno (round robin), nell'ordine di equità ricevuto: prima chi
//    finora ha beneficiato di meno. Così ognuno ha un carico al sole prima che qualcuno ne abbia due;
// 3. un carico a blocco (lavatrice) prova tutte le partenze nella finestra della famiglia e sceglie
//    quella con più kWh "coperti dal sole"; un carico divisibile (auto, scaldabagno) riempie
//    i quarti d'ora con più sole libero e, se il sole non basta, quelli con il prezzo più basso;
// 4. si propone un cambio solo se conviene davvero: almeno `soglia` kWh condivisi in più
//    rispetto all'abitudine o al piano già accettato, oppure (se il sole è già tutto prenotato)
//    almeno `sogliaEuro` di bolletta in meno senza togliere sole agli altri. Niente messaggi inutili.

import { N_SLOT, GIORNO, slotDa, oraDiSlot, vuoto, profiloBlocco, profiloAbitudine } from './energia.js';
import { prezzoEnergia } from './parametri.js';

/** kWh di un profilo coperti dal sole libero `residuo` (kW per intervallo). */
export function kwhAlSole(profilo, residuo, da = 0) {
  let e = 0;
  for (let s = da; s < N_SLOT; s++) e += Math.min(profilo[s], Math.max(0, residuo[s])) * GIORNO.passo;
  return e;
}

/** Costo della componente energia di un profilo (€), con il prezzo orario. */
export function costo(profilo, prezzo = prezzoEnergia) {
  let c = 0;
  for (let s = 0; s < N_SLOT; s++) if (profilo[s]) c += profilo[s] * GIORNO.passo * prezzo(oraDiSlot(s));
  return c;
}

/** Ordine round robin: il 1° carico di ogni famiglia, poi il 2°... Famiglie nell'ordine dato. */
export function ordineRoundRobin(richieste, ordineFamiglie = []) {
  const perFam = new Map();
  for (const r of richieste) {
    if (!perFam.has(r.famiglia)) perFam.set(r.famiglia, []);
    perFam.get(r.famiglia).push(r);
  }
  for (const list of perFam.values()) list.sort((a, b) => b.kwh - a.kwh || a.id.localeCompare(b.id));
  const fams = [...perFam.keys()].sort((a, b) => {
    const ia = ordineFamiglie.indexOf(a);
    const ib = ordineFamiglie.indexOf(b);
    return (ia < 0 ? 1e9 : ia) - (ib < 0 ? 1e9 : ib) || a.localeCompare(b);
  });
  const out = [];
  for (let giro = 0; ; giro++) {
    let any = false;
    for (const f of fams) {
      const r = perFam.get(f)[giro];
      if (r) {
        out.push(r);
        any = true;
      }
    }
    if (!any) return out;
  }
}

function sottrai(residuo, profilo) {
  for (let s = 0; s < N_SLOT; s++) residuo[s] -= profilo[s];
}

/** Miglior partenza di un carico a blocco nella finestra [da, entro). */
function migliorBlocco(r, residuo, primo, prezzo) {
  const n = Math.round(r.durataH / GIORNO.passo);
  const da = Math.max(primo, slotDa(r.finestra[0]));
  const entro = Math.min(N_SLOT, Math.floor((r.finestra[1] - GIORNO.inizio) / GIORNO.passo + 1e-9));
  const abit = slotDa(r.abitudine);
  let best = null;
  for (let s = da; s + n <= entro; s++) {
    const prof = profiloBlocco(oraDiSlot(s), r.durataH, r.potenzaKw);
    const sole = kwhAlSole(prof, residuo);
    // a parità di sole: meno costo, poi più vicino all'abitudine
    const score = sole - 0.02 * costo(prof, prezzo) - 0.001 * Math.abs(s - abit);
    if (!best || score > best.score + 1e-9) best = { score, profilo: prof, sole };
  }
  return best;
}

/** Profilo di un carico divisibile: prima il sole libero, poi le ore meno care. */
function migliorDivisibile(r, residuo, primo, prezzo) {
  const da = Math.max(primo, slotDa(r.finestra[0]));
  const entro = Math.min(N_SLOT, Math.floor((r.finestra[1] - GIORNO.inizio) / GIORNO.passo + 1e-9));
  if (entro <= da) return null;
  const prof = vuoto();
  let resta = r.kwh;
  const slots = [];
  for (let s = da; s < entro; s++) slots.push(s);
  const perSole = [...slots].sort((a, b) => residuo[b] - residuo[a] || a - b);
  for (const s of perSole) {
    if (resta <= 1e-6 || residuo[s] < 0.05) break;
    const kw = Math.min(r.potenzaKw, residuo[s], resta / GIORNO.passo);
    prof[s] = kw;
    resta -= kw * GIORNO.passo;
  }
  if (resta > 1e-6) {
    const perPrezzo = [...slots].sort((a, b) => prezzo(oraDiSlot(a)) - prezzo(oraDiSlot(b)) || a - b);
    for (const s of perPrezzo) {
      if (resta <= 1e-6) break;
      const kw = Math.min(r.potenzaKw - prof[s], resta / GIORNO.passo);
      if (kw <= 0) continue;
      prof[s] += kw;
      resta -= kw * GIORNO.passo;
    }
  }
  if (resta > 0.05) return null; // la finestra non basta
  return { profilo: prof, sole: kwhAlSole(prof, residuo) };
}

/**
 * Pianifica i carichi.
 * @param {{ora: number, surplus: number[], richieste: object[], ordineFamiglie?: string[],
 *          soglia?: number, prezzo?: (h: number) => number}} input
 *   - ora: ora decimale attuale; si pianifica dal quarto d'ora successivo
 *   - surplus: kW di sole libero previsto per intervallo (produzione − consumi fissi), anche negativo
 *   - richieste: da `richiesta()` di energia.js; facoltativo `attuale` = profilo già accettato
 *   - ordineFamiglie: id delle famiglie, chi ha più bisogno prima (equità)
 * @returns {{assegnazioni: object[], residuo: number[]}}
 *   assegnazioni[i] = { id, famiglia, tipo, profilo, cambia, scelta: 'sole'|'prezzo'|'abitudine'|'attuale', risparmioEuro,
 *                       kwhSole, kwhSoleAbitudine, kwhSoleRiferimento, guadagnoKwh }
 *   guadagnoKwh = kWh al sole in più rispetto al riferimento (piano accettato o, se non c'è, abitudine)
 */
export function pianifica({ ora, surplus, richieste, ordineFamiglie = [], soglia = 0.3, sogliaEuro = 0.15, prezzo = prezzoEnergia }) {
  const residuo = surplus.map((v) => Math.max(0, v));
  const primo = slotDa(ora);
  const assegnazioni = [];
  for (const r of ordineRoundRobin(richieste, ordineFamiglie)) {
    const abitudine = profiloAbitudine(r, { da: oraDiSlot(primo) });
    const soleAbit = kwhAlSole(abitudine, residuo);
    const best = r.divisibile ? migliorDivisibile(r, residuo, primo, prezzo) : migliorBlocco(r, residuo, primo, prezzo);
    let scelta = 'abitudine';
    let profilo = abitudine;
    let sole = soleAbit;
    const base = r.attuale ? { profilo: r.attuale, sole: kwhAlSole(r.attuale, residuo) } : null;
    if (base) {
      scelta = 'attuale';
      profilo = base.profilo;
      sole = base.sole;
    }
    const riferimento = sole;
    const costoRif = costo(profilo, prezzo);
    if (best && best.sole - sole >= soglia) {
      scelta = 'sole';
    } else if (best && best.sole >= sole - 0.05 && costoRif - costo(best.profilo, prezzo) >= sogliaEuro) {
      scelta = 'prezzo'; // il sole è già prenotato, ma si risparmia in bolletta senza toglierne a nessuno
    }
    if (scelta === 'sole' || scelta === 'prezzo') {
      profilo = best.profilo;
      sole = best.sole;
    }
    sottrai(residuo, profilo);
    assegnazioni.push({
      id: r.id,
      famiglia: r.famiglia,
      tipo: r.tipo,
      profilo,
      scelta,
      cambia: scelta === 'sole' || scelta === 'prezzo',
      kwhSole: round2(sole),
      kwhSoleAbitudine: round2(soleAbit),
      kwhSoleRiferimento: round2(riferimento),
      guadagnoKwh: round2(sole - riferimento),
      risparmioEuro: round2(costoRif - costo(profilo, prezzo)),
    });
  }
  return { assegnazioni, residuo };
}

/** Indice di equità di Jain: 1 = tutti uguali, 1/n = tutto a uno solo. */
export function indiceJain(valori) {
  const v = valori.filter((x) => Number.isFinite(x));
  if (!v.length) return 1;
  const s = v.reduce((a, b) => a + b, 0);
  const s2 = v.reduce((a, b) => a + b * b, 0);
  return s2 === 0 ? 1 : (s * s) / (v.length * s2);
}

const round2 = (x) => Math.round(x * 100) / 100;
