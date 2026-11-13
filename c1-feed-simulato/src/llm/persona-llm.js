// Passaggio LLM della simulazione: per ogni annuncio e segmento, un campione di
// persone virtuali "guarda" il post dentro un feed e risponde in JSON con
// probabilità di fermarsi e cliccare, reazione, commento e motivo.
// Una chiamata per (annuncio, segmento), con più persone nella stessa chiamata.

import { describePersona } from '../core/audience.js';
import { PIATTAFORME, OBIETTIVI } from '../core/data.js';
import { hashString } from '../core/rng.js';

const SYSTEM = `Simuli il comportamento di utenti italiani reali dei social davanti a un annuncio sponsorizzato nel feed.
Regole:
- Ogni persona scorre veloce: guarda un post per meno di due secondi, a meno che qualcosa la colpisca.
- Le persone reali cliccano poco: su 100 persone che vedono un annuncio, di solito 20-35 si fermano e circa 1-3 cliccano. Non essere gentile con l'annuncio.
- Rispetta età, interessi e abitudini di ogni persona: un annuncio fuori dai suoi interessi viene quasi sempre ignorato.
- I commenti sono brevi, nel tono che quella persona userebbe davvero sul social (anche ironici o critici). Lascia il commento vuoto se la persona non commenterebbe.
- Rispondi SOLO con un oggetto JSON valido, senza testo prima o dopo.`;

function adBlock(ad, haImmagine) {
  const righe = [
    `Piattaforma: ${PIATTAFORME[ad.piattaforma] || ad.piattaforma} (${ad.posizionamento})`,
    ad.marchio ? `Inserzionista: ${ad.marchio}` : null,
    ad.titolo ? `Titolo: ${ad.titolo}` : null,
    `Testo: ${ad.testo || '(nessun testo)'}`,
    `Pulsante: ${ad.cta && ad.cta !== 'Nessuna' ? ad.cta : '(nessun pulsante)'}`,
    haImmagine ? 'Immagine: allegata.' : (ad.descrizioneImmagine ? `Immagine (descrizione): ${ad.descrizioneImmagine}` : 'Immagine: nessuna.'),
  ];
  return righe.filter(Boolean).join('\n');
}

export function buildPrompt(ad, segment, campione, haImmagine) {
  const persone = campione.map(({ p }) => `- id "${p.id}": ${describePersona(p)}`).join('\n');
  return `Stai scorrendo il feed. Prima vedi il post di un amico (foto di una cena), poi questo POST SPONSORIZZATO, poi un meme.

POST SPONSORIZZATO
${adBlock(ad, haImmagine)}
(L'inserzionista punta all'obiettivo "${OBIETTIVI[ad.obiettivo] || ad.obiettivo}"; le persone non lo sanno.)

PERSONE (segmento ${segment.label})
${persone}

Per ogni persona stima:
- p_stop: probabilità (0-1) di fermarsi a guardare il post;
- p_click: probabilità (0-1) di cliccare il pulsante o il link, SE si è fermata;
- reazione: una tra "click", "like", "commento", "ignora";
- commento: commento in italiano come lo scriverebbe lei, oppure "";
- motivo: perché ha reagito così, al massimo 15 parole, in italiano.

Formato:
{"persone":[{"id":"...","p_stop":0.0,"p_click":0.0,"reazione":"ignora","commento":"","motivo":"..."}]}`;
}

/**
 * Crea la funzione `refine` da passare a runSimulation.
 * @param {object} llm adattatore (createLlm)
 * @param {object} opts { cache: Map, imageFor: (ad) => dataUrl|null, concorrenza }
 */
export function makeRefiner(llm, { cache = new Map(), imageFor = () => null } = {}) {
  return async function refine({ ad, segment, campione }) {
    if (llm.isMock) return null;
    const img = imageFor(ad);
    const prompt = buildPrompt(ad, segment, campione, Boolean(img));
    const key = `${llm.provider}|${llm.model}|${hashString(prompt)}|${img ? hashString(img.slice(0, 2000) + img.length) : 0}`;
    if (cache.has(key)) return cache.get(key);
    const res = await llm.complete({ system: SYSTEM, messages: [{ role: 'user', content: prompt }], images: img ? [img] : [], json: true, maxTokens: 3000 });
    const persone = res.json?.persone || (Array.isArray(res.json) ? res.json : null);
    if (!persone) throw new Error('risposta LLM senza JSON valido');
    const out = { persone, modello: res.model || llm.model };
    cache.set(key, out);
    return out;
  };
}
