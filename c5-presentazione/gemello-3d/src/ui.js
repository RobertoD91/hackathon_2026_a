// Pannelli di TwinCIRO 3D: funzioni che dallo stato dell'app producono l'HTML di barra, elenco dei
// luoghi, scheda (stile Seoul Real-Time City Data), linea del tempo, sala operativa, chat e fonti.
// Niente stato qui dentro: gli eventi li collega app.js (deleghe sugli attributi data-*).

import { LUOGHI3D, CATEGORIE, COLORI_LIVELLO, ETICHETTE_LIVELLO, LIVELLI_FOLLA, distanzaKm } from './luoghi3d.js';
import { barrePrevisione, composizione, strisciaOre, curvaTempo, corto, giornoBreve, esc, num } from './grafici.js';
import { ORA, GIORNO, IPOTESI } from './modello.js';
import { SOGLIA_PRIVACY, IPOTESI_GRIGLIA } from './griglia.js';
import { stazioniVicine, LINEE_EXTRA } from './rete.js';
import { AGENTI, giornoParlato, etichettaLinea, avvisiRegionali, allertaRegionaleA } from './agenti.js';
import * as N from '../../../citta-api/fonti/normalizza.js';

const L = LUOGHI3D;
const virgola = (v, d = 1) => (typeof v === 'number' ? new Intl.NumberFormat('it-IT', { maximumFractionDigits: d, minimumFractionDigits: 0 }).format(v) : '–');
const pct = (q) => `${Math.round(q * 100)}%`;
const maiuscola = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

const pallino = (livello) => `<i class="pallino" style="background:${COLORI_LIVELLO[livello]}"></i>`;
const etichettaLivello = (s) => `<span class="livello livello-${s.livello}">${pallino(s.livello)}${esc(ETICHETTE_LIVELLO[s.livello])}</span>`;
const tag = (tipo, testo) => `<span class="tag tag-${tipo}">${esc(testo)}</span>`;

/** Etichetta dell'ora scelta: "Adesso", "Previsione · dom 15 nov 11:00 (+19 h)", "Ieri · ...". */
export function etichettaOra(ts, adesso) {
  const ore = Math.round((ts - adesso) / ORA);
  const quando = `${giornoBreve(ts)} ${N.dataBreve(ts, adesso)}, ${N.oraBreve(ts)}`;
  if (Math.abs(ts - adesso) < 8 * 60_000) return { tipo: 'adesso', titolo: 'Adesso', quando, delta: '' };
  if (ts > adesso) return { tipo: 'previsione', titolo: 'Previsione', quando, delta: `+${ore < 1 ? Math.round((ts - adesso) / 60_000) + ' min' : ore + ' h'}` };
  return { tipo: 'passato', titolo: 'Già passato', quando, delta: `−${-ore < 1 ? Math.round((adesso - ts) / 60_000) + ' min' : -ore + ' h'}` };
}

/** Meteo di un luogo a un istante: reale per luogo se è adesso, previsione oraria della città altrimenti. */
export function meteoPer(s, zona, ts) {
  if (Math.abs(ts - s.adesso) < 45 * 60_000 && s.dati.meteo) {
    const diretta = s.dati.meteo[zona];
    if (diretta) return { ...diretta, tipo: 'adesso' };
    if (zona) {
      const vicina = Object.keys(s.dati.meteo).sort((a, b) => distanzaKm(L[zona], L[a]) - distanzaKm(L[zona], L[b]))[0];
      if (vicina) return { ...s.dati.meteo[vicina], tipo: 'adesso' };
    }
    const prima = Object.values(s.dati.meteo)[0];
    if (prima) return { ...prima, tipo: 'adesso' };
  }
  const m = s.modello.meteoDi(ts);
  return m ? { ...m, tipo: 'previsione' } : null;
}

// avviso in vigore oppure già emesso per domani (campo `domani` di citta-api/fonti/dati.js)
const allertaAttiva = (s, ts) => allertaRegionaleA(s.dati.allerta, ts);

/** Avvisi Meteoalarm (EUMETNET) validi a un istante: [{ fenomeno, colore, inizio, fine }]. */
export const meteoalarmA = (s, ts) => (s.dati.allerta?.meteoalarm || []).filter((m) => m.livello >= 2 && m.inizio <= ts && m.fine >= ts);

// ------------------------------------------------------------------ barra in alto

export function rendiStato(s) {
  const e = etichettaOra(s.ts, s.adesso);
  const m = meteoPer(s, null, s.ts);
  const a = allertaAttiva(s, s.ts);
  const sc = scenarioAttivo(s.scenario);
  return `
    <span class="chip chip-ora chip-${e.tipo}" title="Ora mostrata sulla mappa">${e.tipo === 'adesso' ? '<i class="vivo"></i>' : ''}<b>${e.titolo}</b><span>${esc(e.quando)}</span>${e.delta ? `<small>${e.delta}</small>` : ''}</span>
    ${m ? `<span class="chip" title="${m.tipo === 'adesso' ? 'Meteo reale adesso' : 'Previsione oraria'} (Open-Meteo)">${Math.round(m.temperatura)} °C · ${esc(m.cielo || '')}${(m.pioggia ?? 0) >= 0.2 ? ` · ${virgola(m.pioggia)} mm` : ''}</span>` : ''}
    ${a ? `<span class="chip chip-allerta chip-allerta-${a.colore}" title="${esc(a.fenomeni || a.descrizione || '')}">Allerta ${esc(a.colore)} fino alle ${N.oraBreve(a.al)}</span>` : ''}
    ${meteoalarmA(s, s.ts).slice(0, 1).map((w) => `<span class="chip chip-allerta chip-allerta-${w.colore}" title="${esc(w.titolo || '')} (Meteoalarm, dato reale)">${esc(w.fenomeno)}: allerta ${esc(w.colore)}</span>`).join('')}
    ${sc ? `<button type="button" class="chip chip-scenario" data-azione="azzera-scenario" title="Torna alla situazione reale">What-if attivo<b>×</b></button>` : ''}`;
}

export function scenarioAttivo(sc) {
  if (!sc) return false;
  return Boolean(sc.eventi?.length || sc.lineeChiuse?.length || sc.pioggia || sc.navi || Object.values(sc.misure || {}).some(Boolean));
}

// ------------------------------------------------------------------ sinistra: indicatori ed elenco

export function rendiKpi(s) {
  const sin = s.modello.sintesi(s.ts);
  const g0 = N.inizioGiorno(N.giornoLocale(s.ts));
  const eventi = eventiUnici(s.modello.eventiTra(g0 + 5 * ORA, g0 + GIORNO - 60_000)).filter((e) => e.persone >= 1000 && e.zona);
  return `
    <div class="kpi-voce" data-tip="Somma delle stime dei ${sin.classifica.length} luoghi monitorati (simulazione dichiarata)"><b>${corto(sin.totale)}</b><span>persone nei luoghi</span></div>
    <div class="kpi-voce ${sin.perLivello.affollato ? 'kpi-critico' : ''}" data-tip="Luoghi oltre l’85% della soglia"><b>${sin.perLivello.affollato}<small>/${sin.classifica.length}</small></b><span>luoghi affollati</span></div>
    <div class="kpi-voce" data-tip="${esc(eventi.map((e) => e.titolo).join(' · ') || 'Nessun grande evento')}"><b>${eventi.length}</b><span>${eventi.length === 1 ? 'grande evento' : 'grandi eventi'} ${esc(giornoParlato(s.ts, s.adesso))}</span></div>`;
}

export function rendiCategorie(attiva) {
  return [['', 'Tutti'], ...Object.entries(CATEGORIE)].map(([id, nome]) => `<button type="button" data-categoria="${id}" aria-pressed="${attiva === id}">${esc(nome.split(' ')[0])}</button>`).join('');
}

export function rendiElenco(s) {
  const q = s.modello.quadro(s.ts);
  const cerca = N.piatto(s.cerca || '');
  const righe = Object.keys(L)
    .filter((z) => (!s.categoria || L[z].categoria === s.categoria) && (!cerca || N.piatto(`${L[z].nome} ${L[z].parole.join(' ')}`).includes(cerca)))
    .map((z) => q[z])
    .sort((a, b) => b.quota - a.quota);
  if (!righe.length) return '<li class="vuoto">Nessun luogo corrisponde alla ricerca.</li>';
  return righe
    .map(
      (x) => `<li><button type="button" class="riga-luogo ${s.zona === x.zona ? 'sel' : ''}" data-zona="${x.zona}">
        ${pallino(x.livello)}
        <span class="riga-nome"><b>${esc(L[x.zona].breve)}</b><small>${esc(ETICHETTE_LIVELLO[x.livello])}</small></span>
        <span class="riga-num"><b>${corto(x.persone)}</b><small>${pct(x.quota)}</small></span>
        <span class="riga-barra"><i style="width:${Math.min(100, x.quota * 100).toFixed(0)}%;background:${COLORI_LIVELLO[x.livello]}"></i></span>
      </button></li>`,
    )
    .join('');
}

// ------------------------------------------------------------------ barra degli strumenti e legenda

export function rendiStrumenti(s) {
  const st = s.strati;
  const b = (id, nome, tip) => `<button type="button" data-strato="${id}" aria-pressed="${Boolean(st[id])}" data-tip="${esc(tip)}">${nome}</button>`;
  return `
    <div class="segmenti" role="group" aria-label="Rappresentazione">
      <button type="button" data-vista="luoghi" aria-pressed="${s.vista === 'luoghi'}" data-tip="Una colonna per luogo: altezza = persone stimate, colore = livello">Luoghi</button>
      <button type="button" data-vista="celle" aria-pressed="${s.vista === 'celle'}" data-tip="Presenze per cella esagonale, come nei dati aggregati di rete mobile">Celle</button>
    </div>
    <div class="interruttori" role="group" aria-label="Strati">
      ${b('trasporti', 'Trasporti', 'Metro, funicolari e treni: linee e stazioni (GTFS ANM ed EAV)')}
      ${b('flussi', 'Flussi', 'Flussi pedonali stimati nell’ora successiva')}
      ${b('eventi', 'Eventi', 'Grandi eventi del giorno')}
      ${b('edifici', 'Edifici', 'Edifici 3D di OpenStreetMap')}
    </div>
    <div class="interruttori" role="group" aria-label="Camera">
      <button type="button" data-camera="golfo" data-tip="Vista dal mare">Golfo</button>
      <button type="button" data-camera="centro" data-tip="Centro storico da vicino">Centro</button>
      <button type="button" data-camera="vesuvio" data-tip="Verso il Vesuvio">Vesuvio</button>
      <button type="button" data-camera="alto" data-tip="Dall’alto, come una mappa">2D</button>
      <button type="button" data-azione="orbita" aria-pressed="${Boolean(s.orbita)}" data-tip="La camera gira lentamente attorno alla città">Orbita</button>
    </div>`;
}

export function rendiLegenda(s) {
  const livelli = LIVELLI_FOLLA.map((l) => `<li>${pallino(l.id)}${esc(l.label)}</li>`).join('');
  if (s.vista === 'celle')
    return `<h3>Presenze per cella</h3>
      <div class="rampa"><i></i><span>poche</span><span>molte</span></div>
      <ul class="livelli"><li>${pallino('vivace')}${pallino('affollato')}cella sotto pressione</li></ul>
      <p>Altezza = presenze stimate. Celle sotto ${SOGLIA_PRIVACY} presenze nascoste (privacy). ${tag('simulato', 'simulato')}</p>`;
  return `<h3>Affollamento dei luoghi</h3>
    <ul class="livelli">${livelli}</ul>
    <p>Altezza della colonna = persone stimate. Anello = soglia “affollato” del luogo scelto. ${tag('simulato', 'stima simulata')}</p>`;
}

// ------------------------------------------------------------------ scheda: città

export function eventiUnici(lista) {
  const visti = new Set();
  return lista.filter((e) => !visti.has(e.titolo) && visti.add(e.titolo));
}

function rigaEvento(e, adesso) {
  return `<li class="evento ${e.persone >= 1000 ? 'evento-grande' : ''}">
    <b>${esc(e.titolo)}</b>
    <small>${e.zona ? `<button type="button" class="collegamento" data-zona="${e.zona}">${esc(L[e.zona].breve)}</button> · ` : ''}${N.oraBreve(e.inizio)}–${N.oraBreve(e.fine)}${e.persone >= 1000 ? ` · ~${num(e.persone)} persone (ipotesi)` : ''} ${e.reale ? tag('reale', e.fonte === 'comune-napoli' ? 'Comune di Napoli' : e.fonte === 'openfootball' ? 'Serie A' : e.fonte === 'cruisetimetables' ? 'scali navi' : 'calendario') : tag('whatif', 'what-if')}</small>
  </li>`;
}

export function rendiSchedaCitta(s) {
  const sin = s.modello.sintesi(s.ts);
  const e = etichettaOra(s.ts, s.adesso);
  const g0 = N.inizioGiorno(N.giornoLocale(s.ts));
  const oggi = eventiUnici(s.modello.eventiTra(g0 + 5 * ORA, g0 + GIORNO - 60_000));
  const domani = eventiUnici(s.modello.eventiTra(g0 + GIORNO + 5 * ORA, g0 + 2 * GIORNO - 60_000)).filter((x) => x.persone >= 1000);
  const m = meteoPer(s, null, s.ts);
  const regionali = avvisiRegionali(s.dati.allerta).filter((a) => a.al > s.adesso);
  const allerta = regionali.length ? regionali.map((a) => `Allerta ${a.colore} della Protezione Civile${a.tipi?.length ? ` (${N.descriviTipiAllerta(a.tipi)})` : ''} dalle ${N.oraBreve(a.dal)} del ${N.dataBreve(a.dal, s.adesso)} alle ${N.oraBreve(a.al)} del ${N.dataBreve(a.al, s.adesso)}.`).join(' ') : 'Nessuna allerta regionale in corso per Napoli.';
  const avvisi = (s.dati.allerta?.meteoalarm || []).filter((w) => w.livello >= 2 && w.fine >= s.ts && w.inizio <= s.ts + GIORNO);
  const meteoalarm = avvisi.length ? ` Meteoalarm: ${avvisi.map((w) => `${w.fenomeno.toLowerCase()}, allerta ${w.colore} dalle ${N.oraBreve(w.inizio)} del ${N.dataBreve(w.inizio, s.adesso)} alle ${N.oraBreve(w.fine)} del ${N.dataBreve(w.fine, s.adesso)}`).join('; ')}.` : '';
  const aqi = Math.max(...Object.values(s.dati.aria || {}).map((x) => x.aqi).filter((x) => typeof x === 'number'), -1);
  const cima = sin.classifica.slice(0, 5);
  const massimo = Math.max(1, ...cima.map((x) => x.quota));
  return `
    <div class="scheda-testa">
      <div><h2>Napoli</h2><p class="sotto">${e.titolo} · ${esc(e.quando)}</p></div>
    </div>
    <section>
      <h3>Dove c’è più folla</h3>
      <ol class="classifica">
        ${cima
          .map(
            (x) => `<li><button type="button" data-zona="${x.zona}">
              <span class="classifica-nome">${esc(L[x.zona].breve)}</span>
              <span class="classifica-barra"><i style="width:${((Math.min(x.quota, massimo) / massimo) * 100).toFixed(0)}%;background:${COLORI_LIVELLO[x.livello]}"></i></span>
              <span class="classifica-num">${corto(x.persone)} · ${esc(ETICHETTE_LIVELLO[x.livello])}</span>
            </button></li>`,
          )
          .join('')}
      </ol>
      <p class="nota">${sin.perLivello.affollato} affollati, ${sin.perLivello.vivace} un po’ affollati, ${sin.perLivello.normale} normali, ${sin.perLivello.tranquillo} tranquilli. Tocca una colonna sulla mappa per la scheda del luogo.</p>
    </section>
    <section>
      <h3>Eventi ${esc(giornoParlato(s.ts, s.adesso))} ${tag('reale', 'dati reali')}</h3>
      <ul class="eventi">${oggi.length ? oggi.slice(0, 6).map((x) => rigaEvento(x, s.adesso)).join('') : '<li class="vuoto">Nessun evento in calendario.</li>'}</ul>
      ${domani.length ? `<h4>Il giorno dopo</h4><ul class="eventi">${domani.slice(0, 4).map((x) => rigaEvento(x, s.adesso)).join('')}</ul>` : ''}
    </section>
    <section>
      <h3>Meteo, allerte e aria ${tag('reale', 'dati reali')}</h3>
      <div class="tessere">
        ${m ? `<div class="tessera"><b>${Math.round(m.temperatura)} °C</b><span>${esc(m.cielo || '')}</span><small>${m.tipo === 'adesso' ? 'adesso' : 'previsione'}</small></div>` : '<div class="tessera"><b>–</b><span>meteo non disponibile</span></div>'}
        ${m ? `<div class="tessera"><b>${virgola(m.pioggia ?? 0)} mm</b><span>pioggia nell’ora</span><small>${m.raffiche != null ? `raffiche ${Math.round(m.raffiche)} km/h` : m.vento != null ? `vento ${Math.round(m.vento)} km/h` : ''}</small></div>` : ''}
        ${aqi >= 0 ? `<div class="tessera"><b>${aqi}</b><span>aria ${esc(N.livelloAria(N.classeAqi(aqi)).label.toLowerCase())}</span><small>indice europeo</small></div>` : ''}
      </div>
      <p class="nota">${esc(allerta + meteoalarm)}</p>
    </section>
    <section class="invito">
      <h3>Chiedi agli agenti</h3>
      <p>Qui rispondono gli agenti a regole della pagina, con questo stesso gemello: percorsi, folla, eventi, meteo. L’assistente vero è TwinCIRO su WhatsApp.</p>
      <div class="spunti">
        <button type="button" data-chiedi="Sono appena arrivato al Porto: come raggiungo Fuorigrotta?">Dal Porto a Fuorigrotta</button>
        <button type="button" data-chiedi="Eventi di domani: come evolvono i flussi e quali aree saranno critiche?">Eventi di domani: aree critiche</button>
      </div>
    </section>`;
}

// ------------------------------------------------------------------ scheda: luogo

function sezioneStima(st) {
  const c = st.componenti;
  const riga = (nome, valore, tipo, etichetta, nota = '') => `<tr><th>${nome}${nota ? `<small>${nota}</small>` : ''}</th><td>${valore}</td><td>${tag(tipo, etichetta)}</td></tr>`;
  const segno = (v) => `${v >= 0 ? '+' : '−'}${Math.abs(Math.round(v * 100))}%`;
  const m = c.meteoDato;
  return `<details class="stima">
    <summary>Come nasce questa stima</summary>
    <table>
      ${riga('Giornata tipo', `${num(c.storico)}`, 'ipotesi', 'ipotesi', `profilo orario × stagione turistica (indice ISTAT ${virgola(c.indiceStagione, 2)})`)}
      ${riga('Rete mobile, giorno prima', segno(c.reteMobile), 'simulato', 'simulato', 'presenze aggregate e anonime: formato Fastweb + Vodafone')}
      ${riga('Meteo dell’ora', segno(c.meteo - 1), m ? 'reale' : 'assente', m ? (m.scenario ? 'what-if' : 'reale') : 'manca', m ? `${virgola(m.pioggia ?? 0)} mm di pioggia` : 'previsione non disponibile')}
      ${riga('Eventi', c.daEventi ? `+${num(c.daEventi)}` : '0', 'reale', 'calendario reale', c.eventi.length ? esc(c.eventi.map((x) => x.titolo).join(', ')) : 'nessun evento a quest’ora')}
      ${c.linee ? riga('Linea chiusa', segno(c.linee), 'whatif', 'what-if') : ''}
      ${c.misure ? riga('Misure degli agenti', `${c.misure > 0 ? '+' : '−'}${num(Math.abs(c.misure))}`, 'whatif', 'what-if') : ''}
      ${riga('Sensori sul campo', 'n/d', 'assente', 'non collegati', 'badge WHY2025 e scheda Tasmota: li legge la città Python via MQTT, non questa pagina')}
      <tr class="totale"><th>Stima</th><td>${num(st.persone)}</td><td>±${Math.round(st.incertezza * 100)}%</td></tr>
    </table>
    <p class="nota">Fusione dei dati: ogni fonte corregge la precedente. Solo conteggi aggregati, nessun dato personale.</p>
  </details>`;
}

export function rendiSchedaLuogo(s, zona) {
  const l = L[zona];
  const st = s.modello.stima(zona, s.ts);
  const e = etichettaOra(s.ts, s.adesso);
  const dopo = s.modello.stima(zona, s.ts + ORA);
  const tendenza = dopo.persone > st.persone * 1.12 ? ['↗', 'in aumento'] : dopo.persone < st.persone * 0.88 ? ['↘', 'in calo'] : ['→', 'stabile'];
  const da = Math.floor(s.ts / ORA) * ORA - 5 * ORA;
  const serie = s.modello.serie(zona, da, 24);
  const base = scenarioAttivo(s.scenario) ? s.modelloBase.serie(zona, da, 24) : null;
  const futuro = serie.filter((x) => x.ts >= Math.floor(s.adesso / ORA) * ORA);
  const picco = (futuro.length ? futuro : serie).reduce((p, x) => (x.quota > p.quota ? x : p));
  const m = meteoPer(s, zona, s.ts);
  const aria = s.dati.aria?.[zona] ?? Object.values(s.dati.aria || {})[0] ?? null;
  const centralina = centralinaVicina(s, l);
  const stazioni = s.rete ? stazioniVicine(s.rete, l, { n: 3, ts: s.ts }) : [];
  const g0 = N.inizioGiorno(N.giornoLocale(s.ts));
  const eventi = eventiUnici(s.modello.eventiTra(g0 + 5 * ORA, g0 + 2 * GIORNO - 60_000)).filter((x) => x.zona === zona);
  const rif = (s.dati.riferimenti?.perZona?.[zona] || []).filter((r) => r.totale > 0).slice(0, 2);
  const colore = (sigla) => s.rete?.linee.get(sigla)?.colore || '#94a3b8';
  return `
    <div class="scheda-testa">
      <div><h2>${esc(l.nome)}</h2><p class="sotto">${esc(CATEGORIE[l.categoria])} · ${e.titolo.toLowerCase()} · ${esc(e.quando)}</p></div>
      <button type="button" class="chiudi" data-azione="chiudi-luogo" aria-label="Chiudi la scheda">×</button>
    </div>
    <section class="adesso">
      <div class="grande">
        ${etichettaLivello(st)}
        <div class="numero"><b>${num(st.min)}–${num(st.max)}</b><span>persone stimate</span></div>
      </div>
      <div class="misuratore" data-tip="${pct(st.quota)} della soglia “affollato” (${num(l.capienza)} persone)"><i style="width:${Math.min(100, (st.quota / 1.3) * 100).toFixed(0)}%;background:${COLORI_LIVELLO[st.livello]}"></i><u style="left:${(100 / 1.3).toFixed(1)}%"></u></div>
      <p class="nota"><b>${pct(st.quota)}</b> della soglia “affollato” (${num(l.capienza)} persone) · ${tendenza[0]} ${tendenza[1]} nella prossima ora ${tag('simulato', 'simulato')}</p>
    </section>
    <section>
      <h3>Ora per ora <small>${base ? 'trattino = senza lo scenario' : 'tocca una barra per spostare l’ora'}</small></h3>
      ${barrePrevisione(serie, { capienza: l.capienza, adesso: s.adesso, selezionato: s.ts, base })}
      <p class="nota">Picco previsto: <b>${giornoBreve(picco.ts)} alle ${N.oraBreve(picco.ts)}</b>, ${num(picco.persone)} persone (${esc(ETICHETTE_LIVELLO[picco.livello].toLowerCase())}).</p>
    </section>
    <section>
      <h3>Chi c’è <small>formato dei dati di rete mobile</small> ${tag('simulato', 'simulato')}</h3>
      ${composizione(st.composizione)}
    </section>
    ${sezioneStima(st)}
    <section>
      <h3>Meteo e aria ${tag('reale', 'dati reali')}</h3>
      <div class="tessere">
        ${m ? `<div class="tessera"><b>${Math.round(m.temperatura)} °C</b><span>${esc(m.cielo || '')}</span><small>${m.tipo === 'adesso' ? 'adesso, Open-Meteo' : 'previsione oraria'}</small></div>` : '<div class="tessera"><b>–</b><span>meteo non disponibile</span></div>'}
        ${aria ? `<div class="tessera"><b>${aria.aqi}</b><span>aria ${esc(N.livelloAria(N.classeAqi(aria.aqi)).label.toLowerCase())}</span><small>modello CAMS</small></div>` : ''}
        ${centralina ? `<div class="tessera" data-tip="${esc(`Centralina ARPAC ${centralina.nome}, ${virgola(centralina.km)} km`)}"><b>${virgola(centralina.valore, 0)}</b><span>${esc(centralina.inquinante)} µg/m³</span><small>ARPAC ${esc(centralina.breve)}</small></div>` : ''}
      </div>
    </section>
    <section>
      <h3>Come arrivare ${tag('reale', 'orari GTFS')}</h3>
      ${
        stazioni.length
          ? `<ul class="stazioni">${stazioni
              .map(
                (x) => `<li>
                  <div><b>${esc(x.nome)}</b> ${x.linee.map((sg) => `<span class="linea" style="--c:${colore(sg)}">${esc(sg)}</span>`).join('')}</div>
                  <small>${x.piedi} min a piedi · ${x.corseOra == null ? 'corse n/d' : x.corseOra === 0 ? 'nessuna corsa a quest’ora' : `${x.corseOra} corse nell’ora`}</small>
                  ${x.transitous?.length ? `<button type="button" class="collegamento" data-passaggi="${esc(x.id)}">Prossimi passaggi dal vivo</button><ol class="passaggi" id="passaggi-${esc(x.id)}"></ol>` : ''}
                </li>`,
              )
              .join('')}</ul>`
          : '<p class="nota">Nessuna stazione di metro, funicolare o treno entro 1,2 km: qui si arriva in bus o in auto.</p>'
      }
      <div class="spunti">
        <button type="button" data-chiedi="Come arrivo a ${esc(l.parlato || l.breve)}?">Portami qui</button>
        <button type="button" data-chiedi="Cosa posso visitare vicino a ${esc(l.parlato || l.breve)} senza folla?">Alternative tranquille</button>
      </div>
    </section>
    ${eventi.length ? `<section><h3>Eventi qui</h3><ul class="eventi">${eventi.map((x) => rigaEvento(x, s.adesso)).join('')}</ul></section>` : ''}
    ${rif.length ? `<section><h3>Per dare la scala ${tag('reale', 'dati reali')}</h3><ul class="riferimenti">${rif.map((r) => `<li><b>${num(r.totale)}</b> ${r.tipo === 'visitatori' ? `visitatori nel ${r.anno}` : esc(r.etichetta.toLowerCase())} <small>${r.tipo === 'visitatori' ? esc(r.etichetta) + ' · ' : ''}${esc(r.fonte)}</small></li>`).join('')}</ul></section>` : ''}`;
}

function centralinaVicina(s, l) {
  const st = s.dati.centraline?.stazioni;
  if (!st?.length) return null;
  const v = st.map((x) => ({ x, km: distanzaKm(l, x) })).sort((a, b) => a.km - b.km)[0];
  const c = N.classeCentralina(v.x.misure);
  if (!c || v.km > 4) return null;
  return { nome: v.x.nome, breve: v.x.nome.replace(/^NA\d+\s*/, '').toLowerCase().replace(/(^|\s)\S/g, (t) => t.toUpperCase()), km: v.km, valore: c.valore, inquinante: c.inquinante };
}

export function rendiPassaggi(lista, nota) {
  if (!lista.length) return `<li class="vuoto">${esc(nota || 'Nessun passaggio nei prossimi minuti.')}</li>`;
  return lista
    .slice(0, 5)
    .map((p) => `<li><b>${N.oraBreve(p.ts)}</b> ${esc(p.linea)} <span>${esc(p.verso)}</span>${p.tempoReale ? tag('reale', p.ritardoMin ? `+${p.ritardoMin} min` : 'in orario') : ''}</li>`)
    .join('');
}

// ------------------------------------------------------------------ linea del tempo

export function rendiTempo(s) {
  const da = s.adesso - GIORNO, a = s.adesso + 2 * GIORNO;
  const punti = [];
  for (let t = Math.floor(da / ORA) * ORA; t <= a; t += ORA) {
    const sin = s.modello.sintesi(t);
    punti.push({ ts: t, totale: sin.totale, critici: sin.perLivello.affollato });
  }
  const tacche = [];
  for (let g = N.inizioGiorno(N.giornoLocale(da)); g < a; g = N.inizioGiorno(N.giornoLocale(g + GIORNO + 3 * ORA))) {
    // etichetta al centro della parte visibile di ogni giorno (se è abbastanza larga)
    const inizio = Math.max(da, g), fine = Math.min(a, g + GIORNO);
    if (fine - inizio >= 6 * ORA) tacche.push(`<span style="left:${((((inizio + fine) / 2 - da) / (a - da)) * 100).toFixed(2)}%">${esc(maiuscola(giornoParlato(g + 12 * ORA, s.adesso)))}</span>`);
  }
  const eventi = eventiUnici(s.modello.eventiTra(da, a).filter((e) => e.persone >= 1000 && e.zona))
    .map((e) => `<button type="button" class="tacca-evento ${e.reale ? '' : 'ipotetico'}" style="left:${(((Math.max(da, e.inizio) - da) / (a - da)) * 100).toFixed(2)}%" data-ts="${e.inizio}" data-zona="${e.zona}" data-tip="${esc(`${e.titolo} · ${L[e.zona].breve} · ${giornoBreve(e.inizio)} ${N.oraBreve(e.inizio)}`)}" aria-label="${esc(e.titolo)}"></button>`)
    .join('');
  return `
    <div class="tempo-comandi">
      <button type="button" class="tondo" data-azione="riproduci" aria-label="${s.riproduzione ? 'Ferma' : 'Fai scorrere il tempo'}" data-tip="${s.riproduzione ? 'Ferma' : 'Fai scorrere le prossime ore'}">
        ${s.riproduzione ? '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>' : '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M7 4.5v15l13-7.5z"/></svg>'}
      </button>
      <button type="button" class="bottone-tenue ${s.vivo ? 'acceso' : ''}" data-azione="adesso" data-tip="Torna al tempo reale">Adesso</button>
    </div>
    <div class="tempo-pista">
      <div class="tempo-giorni">${tacche.join('')}</div>
      <div class="tempo-grafico">
        ${curvaTempo(punti, { da, a, adesso: s.adesso })}
        <div class="tempo-eventi">${eventi}</div>
        <input type="range" id="cursore" min="${da}" max="${a}" step="${15 * 60_000}" value="${s.ts}" aria-label="Ora mostrata sulla mappa" />
      </div>
      <div class="tempo-zone"><span>ieri: rete mobile D-1 ${tag('simulato', 'simulato')}</span><span>prossime 48 ore: previsione</span></div>
    </div>`;
}

// ------------------------------------------------------------------ sala operativa

export const LINEE_WHATIF = ['L1', 'L2', 'L6', 'Cumana', 'Circumflegrea', 'Circumvesuviana', 'F1', 'F3', 'F4'];

export function rendiOperatore(s) {
  const da = Math.floor(s.adesso / ORA) * ORA;
  const attivo = scenarioAttivo(s.scenario);
  const ind = s.modello.indicatori(da, 48);
  const base = attivo ? s.modelloBase.indicatori(da, 48) : null;
  const sc = s.scenario || {};
  const righe = ind.dettaglio.slice(0, 8);
  // con le misure accese il confronto che conta è "con e senza misure"; altrimenti scenario contro realtà
  const senza = attivo && s.modelloSenzaMisure ? s.modelloSenzaMisure.indicatori(da, 48) : null;
  const confronto = (nome, chiave, formato = num) => {
    const ora = ind[chiave];
    const rif = senza ? senza[chiave] : base?.[chiave];
    const d = rif == null ? 0 : ora - rif;
    const classe = !d ? '' : d < 0 ? 'meglio' : 'peggio';
    const riga = rif == null ? 'situazione reale' : d ? `${d > 0 ? '+' : '−'}${formato(Math.abs(d))} rispetto a ${formato(rif)} ${senza ? 'senza misure' : 'reali'}` : senza ? 'come senza misure' : 'come senza scenario';
    return `<div class="indicatore ${classe}"><span>${nome}</span><b>${formato(ora)}</b><small>${riga}</small>${senza && base ? `<small class="secondo">situazione reale: ${formato(base[chiave])}</small>` : ''}</div>`;
  };
  const giorni = [0, 1, 2].map((i) => ({ i, nome: maiuscola(giornoParlato(s.adesso + i * GIORNO, s.adesso)) }));
  const pioggia = sc.pioggia ? Math.round((sc.pioggia.da - N.inizioGiorno(N.giornoLocale(s.adesso))) / ORA) : '';
  return `
    <div class="scheda-testa">
      <div><h2>Sala operativa</h2><p class="sotto">Previsione a 48 ore e scenari what-if</p></div>
      ${attivo ? '<button type="button" class="bottone-tenue" data-azione="azzera-scenario">Situazione reale</button>' : ''}
    </div>
    <section>
      <h3>Indicatori, prossime 48 ore ${attivo ? tag('whatif', 'scenario') : tag('reale', 'previsione')}</h3>
      <div class="indicatori">
        ${confronto('Luoghi critici', 'luoghiCritici')}
        ${confronto('Ore sopra soglia', 'oreCritiche')}
        ${confronto('Persone oltre soglia', 'eccesso', corto)}
      </div>
      <p class="nota">“Persone oltre soglia” somma, ora per ora, chi eccede la soglia “affollato”: misura quanta pressione c’è, non solo dove.</p>
    </section>
    <section>
      <h3>Criticità previste <small>una cella per ora, da adesso</small></h3>
      <ul class="criticita">
        ${righe
          .map(
            (x) => `<li>
              <button type="button" class="collegamento" data-zona="${x.zona}">${esc(L[x.zona].breve)}</button>
              ${strisciaOre(s.modello.serie(x.zona, da, 36), { selezionato: s.ts })}
              <small data-ts="${x.picco.ts}" data-zona="${x.zona}" class="salta">${pct(x.picco.quota)} · ${giornoBreve(x.picco.ts)} ${N.oraBreve(x.picco.ts)}</small>
            </li>`,
          )
          .join('')}
      </ul>
      <p class="nota">Picco rispetto alla soglia e quando arriva. Tocca una cella per portare lì la mappa.</p>
    </section>
    <section class="whatif">
      <h3>What-if: prova uno scenario</h3>
      <div class="predefiniti">
        <button type="button" data-predefinito="concerto">Concerto al Plebiscito domani sera</button>
        <button type="button" data-predefinito="linea1">Linea 1 chiusa</button>
        <button type="button" data-predefinito="pioggia">Pioggia forte domani</button>
        <button type="button" data-predefinito="navi">5 navi da crociera domani</button>
      </div>
      <form id="form-evento" class="modulo">
        <h4>Nuovo evento</h4>
        <label>Luogo<select name="zona">${Object.keys(L).map((z) => `<option value="${z}" ${z === (s.zona || 'plebiscito') ? 'selected' : ''}>${esc(L[z].breve)}</option>`).join('')}</select></label>
        <label>Giorno<select name="giorno">${giorni.map((g) => `<option value="${g.i}" ${g.i === 1 ? 'selected' : ''}>${esc(g.nome)}</option>`).join('')}</select></label>
        <label>Ora<select name="ora">${Array.from({ length: 17 }, (_, i) => i + 8).map((h) => `<option value="${h}" ${h === 21 ? 'selected' : ''}>${h}:00</option>`).join('')}</select></label>
        <label>Durata<select name="durata">${[2, 3, 4, 6].map((h) => `<option value="${h}" ${h === 3 ? 'selected' : ''}>${h} ore</option>`).join('')}</select></label>
        <label>Persone<select name="persone">${[2000, 5000, 10_000, 20_000, 45_000].map((n) => `<option value="${n}" ${n === 10_000 ? 'selected' : ''}>${num(n)}</option>`).join('')}</select></label>
        <button type="submit" class="bottone">Aggiungi evento</button>
      </form>
      ${sc.eventi?.length ? `<ul class="scenario-eventi">${sc.eventi.map((e, i) => `<li>${esc(e.titolo)} · ${esc(L[e.zona].breve)} · ${giornoBreve(e.inizio)} ${N.oraBreve(e.inizio)} · ${num(e.persone)} persone <button type="button" data-togli-evento="${i}" aria-label="Togli l’evento">×</button></li>`).join('')}</ul>` : ''}
      <div class="modulo">
        <h4>Linea chiusa</h4>
        <div class="gettoni">${LINEE_WHATIF.map((sg) => `<button type="button" data-linea="${sg}" aria-pressed="${Boolean(sc.lineeChiuse?.includes(sg))}" style="--c:${s.rete?.linee.get(sg)?.colore || '#94a3b8'}" data-tip="${esc(etichettaLinea(sg))}">${esc(sg)}</button>`).join('')}</div>
      </div>
      <div class="modulo due">
        <label>Pioggia forte<select name="pioggia" id="sel-pioggia">
          <option value="">nessuna</option>
          <option value="15" ${pioggia === 15 ? 'selected' : ''}>oggi 15–21</option>
          <option value="33" ${pioggia === 33 ? 'selected' : ''}>domani 9–15</option>
          <option value="39" ${pioggia === 39 ? 'selected' : ''}>domani 15–21</option>
        </select></label>
        <label>Navi da crociera domani<select name="navi" id="sel-navi">
          <option value="">calendario reale</option>
          ${[0, 1, 2, 3, 4, 5].map((n) => `<option value="${n}" ${sc.navi?.n === n ? 'selected' : ''}>${n}</option>`).join('')}
        </select></label>
      </div>
      <div class="modulo">
        <h4>Misure degli agenti</h4>
        <label class="spunta"><input type="checkbox" data-misura="diversione" ${sc.misure?.diversione ? 'checked' : ''} /><span><b>Diversione dei flussi</b><small>TwinCIRO propone a chi è in arrivo un’alternativa vicina e libera (fino al ${Math.round(IPOTESI.diversione * 100)}% in meno nei luoghi critici)</small></span></label>
        <label class="spunta"><input type="checkbox" data-misura="scaglionamento" ${sc.misure?.scaglionamento ? 'checked' : ''} /><span><b>Ingressi scaglionati</b><small>gli arrivi agli eventi si distribuiscono su più ore (picco × ${virgola(IPOTESI.scaglionamento, 2)})</small></span></label>
        <label class="spunta"><input type="checkbox" data-misura="navette" ${sc.misure?.navette ? 'checked' : ''} /><span><b>Navette e metro potenziata</b><small>il deflusso pesa meno sui luoghi vicini (× ${virgola(IPOTESI.navette, 2)})</small></span></label>
      </div>
    </section>`;
}

// ------------------------------------------------------------------ chat

export function messaggioUtente(testo) {
  return `<li class="msg msg-utente"><p>${esc(testo)}</p></li>`;
}

export function messaggioAttesa() {
  return '<li class="msg msg-ciro attesa"><div class="agenti-lavoro"><span class="giro"></span>Gli agenti stanno lavorando…</div></li>';
}

export function passoAgente(p) {
  const a = AGENTI[p.agente] || { nome: p.agente, colore: '#94a3b8' };
  return `<li><i style="background:${a.colore}"></i><b>${esc(a.nome)}</b><span>${esc(p.testo)}</span></li>`;
}

const MEZZI = { metro: 'Metro', funicolare: 'Funicolare', treno: 'Treno', bus: 'Bus', tram: 'Tram', traghetto: 'Traghetto', mezzo: 'Mezzo' };

/** Itinerario in forma di schema: una riga per tratta, con il colore della linea. */
export function rendiItinerario(p, fonte) {
  const righe = p.tratte
    .map((t, i) => {
      if (t.modo === 'piedi') return `<li class="a-piedi"><i></i><b>A piedi ${t.minuti} min</b><small>${i === p.tratte.length - 1 ? 'fino a destinazione' : `fino a ${esc(t.a.nome)}`}${t.metri ? ` · ${num(t.metri)} m` : ''}</small></li>`;
      return `<li style="--c:${esc(t.colore || '#38bdf8')}"><i></i><b><span class="linea" style="--c:${esc(t.colore || '#38bdf8')}">${esc(t.linea || MEZZI[t.modo])}</span>${esc(MEZZI[t.modo] || 'Mezzo')}${t.verso ? ` verso ${esc(t.verso)}` : ''} · ${t.minuti} min</b><small>${esc(t.da.nome)} → ${esc(t.a.nome)} · ${t.fermate} ${t.fermate === 1 ? 'fermata' : 'fermate'}${t.partenza ? ` · parte alle ${N.oraBreve(t.partenza)}` : ''} ${t.tempoReale ? tag('reale', 'tempo reale') : ''}${t.indicativa ? tag('ipotesi', 'indicativo') : ''}</small></li>`;
    })
    .join('');
  return `<ol class="itinerario">${righe}</ol>
    <p class="itinerario-fine"><b>${p.minuti} min</b> · partenza ${N.oraBreve(p.partenza)} · arrivo ${N.oraBreve(p.arrivo)} ${fonte === 'transitous' ? tag('reale', 'Transitous, dal vivo') : tag('ipotesi', 'orari GTFS, motore di riserva')}</p>`;
}

export function messaggioCiro(r) {
  const agenti = [...new Set(r.passi.map((p) => p.agente))];
  const viaggio = r.azioni?.find((a) => a.tipo === 'percorso');
  return `<li class="msg msg-ciro">
    <div class="msg-agenti">${agenti.map((a) => `<span style="--c:${AGENTI[a]?.colore || '#94a3b8'}">${esc(AGENTI[a]?.nome || a)}</span>`).join('')}</div>
    <p>${esc(r.testo)}</p>
    ${viaggio ? rendiItinerario(viaggio.percorso, viaggio.fonte) : ''}
    <details class="traccia"><summary>Come hanno lavorato gli agenti (${r.passi.length} passaggi)</summary><ol>${r.passi.map(passoAgente).join('')}</ol></details>
    ${r.azioni?.some((a) => a.tipo === 'percorso') ? '<button type="button" class="collegamento" data-azione="togli-percorso">Togli il percorso dalla mappa</button>' : ''}
  </li>`;
}

export function rendiSpunti(lista) {
  return lista.map((t) => `<button type="button" data-chiedi="${esc(t)}">${esc(t)}</button>`).join('');
}

// ------------------------------------------------------------------ fonti e ipotesi

const TIPI_FONTE = { live: ['reale', 'dal vivo'], cache: ['reale', 'dal vivo (cache)'], riserva: ['reale', 'fonte di riserva'], salvato: ['ipotesi', 'ultimo dato salvato'], snapshot: ['reale', 'snapshot'], programmato: ['reale', 'orari programmati'], assente: ['assente', 'non disponibile'] };

export function rendiFonti(s) {
  const fonti = [
    ...s.dati.fonti,
    { nome: 'Transitous (percorsi e prossimi passaggi)', licenza: 'servizio comunitario per progetti open source non commerciali', tipo: 'live', nota: 'chiesto al momento della domanda; riserva: grafo GTFS locale' },
    { nome: 'OpenFreeMap / OpenMapTiles (mappa, edifici 3D)', licenza: 'dati © OpenStreetMap, ODbL', tipo: 'live', nota: 'tessere vettoriali, senza chiave' },
    { nome: 'Terrain Tiles su AWS (rilievo)', licenza: 'dati aperti (Mapzen, SRTM e altri)', tipo: 'live', nota: 'colline e Vesuvio' },
    { nome: 'Volume edificato per cella (OpenStreetMap)', licenza: 'ODbL', tipo: 'snapshot', nota: 'dati/griglia.json, 2.512 celle da 83.833 edifici' },
  ];
  const righe = fonti
    .filter(Boolean)
    .map((f) => {
      const [t, e] = TIPI_FONTE[f.tipo] || ['assente', f.tipo || 'n/d'];
      return `<tr><th>${esc(f.nome)}<small>${esc(f.licenza || '')}</small></th><td>${tag(t, e)}</td><td>${esc(f.nota || '')}${f.ts ? ` <small>dato delle ${N.oraBreve(f.ts)} del ${N.dataBreve(f.ts, s.adesso)}</small>` : ''}</td></tr>`;
    })
    .join('');
  return `
    <form method="dialog"><button class="chiudi" aria-label="Chiudi">×</button></form>
    <h2 id="fonti-titolo">Fonti, ipotesi e privacy</h2>
    <p>TwinCIRO 3D unisce <b>dati reali</b> (meteo, allerte, aria, orari di metro e treni, calendario degli eventi, stagionalità ISTAT, edifici di OpenStreetMap) e una <b>simulazione dichiarata</b> delle presenze. I dati reali arrivano dagli stessi moduli dell’API dati città di TwinCIRO, che sceglie le sue fonti nel catalogo di oltre 50 fonti pubbliche, verificate una per una. Le presenze vere arriverebbero dai dati aggregati e anonimi delle reti mobili (Fastweb + Vodafone) e dai sensori sul campo: il modello ha già le righe per riceverli.</p>
    <p>Questa pagina <b>non legge MQTT</b>: i due dispositivi veri, il badge WHY2025 e la scheda Tasmota, mandano le loro misure alla città Python di TwinCIRO. La chat è fatta di <b>agenti a regole</b> che girano nel browser; l’assistente vero è TwinCIRO su WhatsApp.</p>
    <h3>Fonti e stato in questo momento</h3>
    <div class="tabella-scorri"><table class="tabella">${righe}</table></div>
    <h3>Ipotesi del modello delle presenze</h3>
    <ul class="ipotesi">
      <li>Ogni luogo ha una <b>giornata tipo</b> (feriale, sabato, festivo) e una <b>soglia “affollato”</b> indicativa; la stagione turistica viene dagli arrivi mensili ISTAT.</li>
      <li>Partita in casa: <b>${num(IPOTESI.spettatoriPartita)}</b> presenze in zona stadio. Nave da crociera: <b>${num(IPOTESI.passeggeriNave)}</b> passeggeri, ${Math.round(IPOTESI.quotaSbarco * 100)}% a terra. Grande evento del Comune senza dato di affluenza: <b>${num(IPOTESI.eventoGrande)}</b> persone.</li>
      <li>Pioggia: fino al ${Math.round(IPOTESI.pioggia[0][1] * 100)}% in meno all’aperto con ${IPOTESI.pioggia[0][0]} mm/h; nei musei arriva più gente.</li>
      <li>“Rete mobile, giorno prima”: lo scostamento di ieri resta oggi al ${Math.round(IPOTESI.persistenzaIeri * 100)}%. Oggi è <b>simulato</b> nel formato che forniscono gli operatori (presenze per cella e per ora; residenti, pendolari, turisti italiani e stranieri).</li>
      <li>Celle: presenze di fondo proporzionali al volume edificato (${virgola(IPOTESI_GRIGLIA.personeOgniMilleM3)} persone ogni 1.000 m³), più le stime dei luoghi distribuite entro ${IPOTESI_GRIGLIA.raggio} m.</li>
      <li>Flussi pedonali: schema che collega ogni luogo che si riempie o si svuota alla stazione più vicina o al porto.</li>
      <li>Percorso di riserva: solo metro, funicolari e treni, più l’Alibus (${esc(LINEE_EXTRA[0].nome)}) con tracciato e frequenza indicativi.</li>
    </ul>
    <h3>Privacy by design</h3>
    <ul class="ipotesi">
      <li>Solo <b>conteggi aggregati</b> per luogo e per cella: nessun dato personale, nessun tracciamento di singole persone.</li>
      <li>Le celle sotto <b>${SOGLIA_PRIVACY} presenze</b> non vengono mostrate, come nei dati degli operatori.</li>
      <li>Telecamere e sensori acustici, quando ci saranno, daranno solo un numero (persone contate, livello del rumore): le immagini restano sul dispositivo.</li>
    </ul>`;
}
