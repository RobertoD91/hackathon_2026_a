// Bilancio della CER: due conti in parallelo sulla STESSA giornata (stessa luce, stessa
// temperatura, stesse famiglie). "senza" = ogni famiglia usa gli elettrodomestici alle solite ore;
// "con" = segue i consigli degli agenti che ha accettato.
//
// Energia condivisa (regola GSE): per ogni ora, il minimo tra l'energia prodotta dagli impianti
// della CER e l'energia consumata dai membri. Si somma sulle ore.

import { P, euroPerKwhCondiviso, prezzoEnergia } from './parametri.js';
import { GIORNO, N_SLOT, slotDi } from './energia.js';
import { indiceJain } from './ottimizzatore.js';

const MODI = ['con', 'senza'];

export class Bilancio {
  /** @param {{famiglie: {id: string}[]}} opts */
  constructor({ famiglie }) {
    this.famiglie = famiglie.map((f) => f.id);
    this.reset();
  }

  reset() {
    const ore = () => new Array(24).fill(0);
    this.ore = { prod: ore() };
    this.serie = { prod: new Array(N_SLOT).fill(0), durata: new Array(N_SLOT).fill(0) };
    for (const m of MODI) {
      this.ore[m] = ore();
      this.ore[`${m}Fam`] = Object.fromEntries(this.famiglie.map((id) => [id, ore()]));
      this.serie[m] = new Array(N_SLOT).fill(0);
      this[`costo_${m}`] = Object.fromEntries(this.famiglie.map((id) => [id, 0]));
    }
    this.oreSimulate = 0;
  }

  /**
   * Aggiunge un intervallo.
   * @param {{h: number, dtH: number, prodKw: number, consumi: {con: Object<string, number>, senza: Object<string, number>}}} x
   *   h = ora decimale di inizio, dtH = durata in ore, consumi = kW per famiglia
   */
  aggiungi({ h, dtH, prodKw, consumi }) {
    if (!(dtH > 0) || h < GIORNO.inizio || h >= GIORNO.fine) return;
    const ora = Math.floor(h);
    const s = slotDi(h);
    const prodE = Math.max(0, prodKw) * dtH;
    this.ore.prod[ora] += prodE;
    this.serie.prod[s] += prodE;
    this.serie.durata[s] += dtH;
    const prezzo = prezzoEnergia(h);
    for (const m of MODI) {
      let tot = 0;
      for (const id of this.famiglie) {
        const e = Math.max(0, consumi[m]?.[id] ?? 0) * dtH;
        this.ore[`${m}Fam`][id][ora] += e;
        this[`costo_${m}`][id] += e * prezzo;
        tot += e;
      }
      this.ore[m][ora] += tot;
      this.serie[m][s] += tot;
    }
    this.oreSimulate += dtH;
  }

  /** Copia indipendente (per proiettare il resto della giornata senza toccare il conto vero). */
  clona() {
    const b = new Bilancio({ famiglie: this.famiglie.map((id) => ({ id })) });
    b.ore = structuredClone(this.ore);
    b.serie = structuredClone(this.serie);
    for (const m of MODI) b[`costo_${m}`] = { ...this[`costo_${m}`] };
    b.oreSimulate = this.oreSimulate;
    return b;
  }

  /** KPI di un modo ('con' | 'senza'). */
  kpi(m) {
    let prodotta = 0;
    let consumata = 0;
    let condivisa = 0;
    const famCond = Object.fromEntries(this.famiglie.map((id) => [id, 0]));
    const famCons = Object.fromEntries(this.famiglie.map((id) => [id, 0]));
    for (let h = 0; h < 24; h++) {
      const p = this.ore.prod[h];
      const c = this.ore[m][h];
      const cond = Math.min(p, c);
      prodotta += p;
      consumata += c;
      condivisa += cond;
      for (const id of this.famiglie) {
        const cf = this.ore[`${m}Fam`][id][h];
        famCons[id] += cf;
        if (c > 0) famCond[id] += (cond * cf) / c; // ripartizione proporzionale ai consumi dell'ora
      }
    }
    const costoEnergia = Object.values(this[`costo_${m}`]).reduce((a, b) => a + b, 0);
    const copertureFam = this.famiglie.map((id) => (famCons[id] > 0 ? famCond[id] / famCons[id] : 0));
    return {
      prodottaKwh: prodotta,
      consumataKwh: consumata,
      condivisaKwh: condivisa,
      quotaCondivisa: prodotta > 0 ? condivisa / prodotta : 0,
      copertura: consumata > 0 ? condivisa / consumata : 0,
      incentivoEuro: condivisa * euroPerKwhCondiviso(),
      costoEnergiaEuro: costoEnergia,
      co2EvitataKg: condivisa * P('fattoreEmissione'),
      equita: indiceJain(copertureFam),
      famiglie: Object.fromEntries(
        this.famiglie.map((id) => [
          id,
          {
            consumoKwh: famCons[id],
            condivisaKwh: famCond[id],
            incentivoEuro: famCond[id] * euroPerKwhCondiviso(),
            costoEnergiaEuro: this[`costo_${m}`][id],
          },
        ]),
      ),
    };
  }

  /** Confronto completo: KPI dei due modi, differenze e proiezione annua (indicativa). */
  risultati() {
    const con = this.kpi('con');
    const senza = this.kpi('senza');
    const bolletta = senza.costoEnergiaEuro - con.costoEnergiaEuro;
    const incentivo = con.incentivoEuro - senza.incentivoEuro;
    const delta = {
      condivisaKwh: con.condivisaKwh - senza.condivisaKwh,
      quotaPunti: (con.quotaCondivisa - senza.quotaCondivisa) * 100,
      incentivoEuro: incentivo,
      bollettaEuro: bolletta,
      totaleEuro: incentivo + bolletta,
      co2Kg: con.co2EvitataKg - senza.co2EvitataKg,
    };
    const giorni = P('giorniAnno');
    const famiglie = Object.fromEntries(
      this.famiglie.map((id) => {
        const a = con.famiglie[id];
        const b = senza.famiglie[id];
        return [
          id,
          {
            condivisaKwh: a.condivisaKwh,
            condivisaKwhSenza: b.condivisaKwh,
            consumoKwh: a.consumoKwh,
            euroCon: a.incentivoEuro,
            euroSenza: b.incentivoEuro,
            bollettaEuro: b.costoEnergiaEuro - a.costoEnergiaEuro,
          },
        ];
      }),
    );
    return {
      con: strip(con),
      senza: strip(senza),
      delta,
      annuo: { condivisaKwh: delta.condivisaKwh * giorni, euro: delta.totaleEuro * giorni, co2Kg: delta.co2Kg * giorni },
      famiglie,
      oreSimulate: this.oreSimulate,
    };
  }

  /** Serie per il grafico: kW medi per quarto d'ora (null dove non ci sono dati). */
  serieKw() {
    const out = { prod: [], con: [], senza: [] };
    for (let s = 0; s < N_SLOT; s++) {
      const d = this.serie.durata[s];
      for (const k of Object.keys(out)) out[k].push(d > 0 ? round(this.serie[k][s] / d) : null);
    }
    return out;
  }
}

function strip(k) {
  const { famiglie, ...rest } = k;
  return Object.fromEntries(Object.entries(rest).map(([n, v]) => [n, typeof v === 'number' ? round(v, 4) : v]));
}

const round = (x, d = 3) => Math.round(x * 10 ** d) / 10 ** d;
