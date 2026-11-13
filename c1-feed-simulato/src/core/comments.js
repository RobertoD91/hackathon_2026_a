// Commenti plausibili delle persone virtuali (modalità mock).
// Il commento nasce dal motivo che pesa di più per quella persona,
// con un tono diverso per fascia d'età. Scelta deterministica.

import { makeRng, pick } from './rng.js';
import { motivoTesto } from './reasons.js';

const T = {
  'offerta+': {
    giovane: ['Ok a quel prezzo ci sto 🔥', 'Con questo sconto lo prendo, ciao 😍', '@{amico} guarda, è in offerta!', 'Prezzo onesto, ci faccio un pensierino'],
    adulto: ['A questo prezzo conviene, ci penso.', 'Lo sconto vale fino a quando?', 'Interessante, salvo il post per dopo.', 'Buon prezzo, lo giro a mia sorella.'],
    senior: ['Il prezzo mi sembra buono. Si può pagare alla consegna?', 'Ottima offerta, la segnalo a mia figlia.', 'Vale anche nei negozi o solo online?'],
  },
  'no_offerta-': {
    giovane: ['Bello ma quanto costa?? 💸', 'Prezzo in DM? No grazie', 'Senza prezzo non clicco'],
    adulto: ['Carino, ma il prezzo?', 'Non dite quanto costa, peccato.', 'Mi piacerebbe sapere il prezzo prima di cliccare.'],
    senior: ['Quanto costa? Non è scritto.', 'Gentilmente, potete indicare il prezzo?'],
  },
  'offerta_sospetta-': {
    giovane: ['Troppo bello per essere vero 🤨', 'Mmm puzza di truffa', 'Ok ma dov\'è la fregatura?'],
    adulto: ['Sconti così mi fanno pensare male.', 'Qualcuno l\'ha comprato davvero? Recensioni?', 'Mi sembra esagerato, non mi fido.'],
    senior: ['Attenzione, queste offerte spesso sono truffe.', 'Non mi fido di sconti così alti.'],
  },
  'testo_lungo-': {
    giovane: ['Troppo testo, scrollato 😴', 'tl;dr', 'Non ho letto tutto ma la foto è carina'],
    adulto: ['Troppo lungo, alla fine cosa offrite?', 'Ho perso il filo a metà.', 'Riassunto?'],
    senior: ['Molto testo, non si capisce bene cosa vendete.'],
  },
  'testo_breve+': {
    giovane: ['Diretto, mi piace', 'Chiaro e veloce 👌'],
    adulto: ['Semplice e chiaro.', 'Bene, si capisce subito.'],
    senior: ['Chiaro, grazie.'],
  },
  'interesse+': {
    giovane: ['Proprio quello che cercavo 😍', 'Mi servivano!!', '@{amico} questo fa per noi', 'Lo voglio 🙌'],
    adulto: ['Era da un po\' che ne cercavo uno così.', 'Interessante, ci do un\'occhiata.', 'Questo mi interessa, link?'],
    senior: ['Molto interessante, dove si trova?', 'Bello, lo terrei in considerazione.', 'Lo farei vedere a mio nipote.'],
  },
  'no_interesse-': {
    giovane: ['Non fa per me', 'Perché vedo questa pubblicità? 😂', 'skip'],
    adulto: ['Non mi riguarda, ma bella foto.', 'Non è il mio genere.'],
    senior: ['Non mi interessa, grazie.', 'Non sono cose per me.'],
  },
  'immagine_forte+': {
    giovane: ['Che foto 😍', 'Colori top', 'La foto spacca 🔥'],
    adulto: ['Bella foto, mi ha fermato.', 'Immagine molto curata.'],
    senior: ['Bella immagine.', 'Che bei colori.'],
  },
  'immagine_debole-': {
    giovane: ['Foto un po\' triste', 'Non si vede niente 😅'],
    adulto: ['L\'immagine è un po\' scura.', 'Foto poco chiara.'],
    senior: ['Non si vede bene la foto.'],
  },
  'volti+': {
    giovane: ['Lei è bellissima, il look pure', 'Mood ✨'],
    adulto: ['Bella l\'idea della foto in strada.', 'Sembra una foto vera, mi piace.'],
    senior: ['Che bella ragazza sorridente.'],
  },
  'cta_forte+': {
    giovane: ['Ordinato 🛒', 'Fatto, preso!', 'Cliccato 👀'],
    adulto: ['Ho appena dato un\'occhiata al sito.', 'Ordinato, vediamo come arriva.'],
    senior: ['Ho cliccato, speriamo bene.'],
  },
  'cta_debole-': {
    giovane: ['Ok ma dove si compra?', 'Link?'],
    adulto: ['Dove si trova? Non c\'è un link.', 'E quindi? Cosa devo fare?'],
    senior: ['Come si ordina?', 'Dove si compra?'],
  },
  'cta_incoerente-': {
    adulto: ['Pensavo di poterlo comprare subito, invece...', 'Il pulsante non porta dove mi aspettavo.'],
    giovane: ['Bottone a caso 🤷'],
    senior: ['Non ho capito cosa succede se clicco.'],
  },
  'urgenza+': {
    giovane: ['Fino a quando?? Corro', 'Ultimi giorni, vado 🏃'],
    adulto: ['Scade presto, meglio decidere ora.', 'Grazie per l\'avviso della scadenza.'],
    senior: ['Fino a quando vale l\'offerta?'],
  },
  'riprova+': {
    adulto: ['Se lo consigliano in tanti ci provo.', 'Le recensioni sembrano buone.'],
    senior: ['Se lo hanno comprato in tanti, sarà buono.', 'Mi fido delle recensioni.'],
    giovane: ['Ne parlano tutti, ok'],
  },
  'maiuscole-': {
    giovane: ['Perché urlate 😂', 'Sembra spam'],
    adulto: ['Troppi punti esclamativi, sembra spam.'],
    senior: ['Sembra una di quelle pubblicità ingannevoli.'],
  },
  'emoji_troppe-': {
    adulto: ['Un po\' troppe emoji per i miei gusti.'],
    senior: ['Troppi disegnini, non si legge.'],
    giovane: ['Emoji overload 😵'],
  },
  'emoji_ok+': {
    giovane: ['Vibes giuste ✨', 'Mi piace il tono 😄'],
    adulto: ['Simpatico il tono.'],
    senior: ['Simpatico.'],
  },
  'fuori_target-': {
    giovane: ['Non credo sia pensato per me', 'Pubblicità sbagliata 😂'],
    adulto: ['Non sono il vostro cliente, credo.'],
    senior: ['Non è per la mia età.'],
  },
  'chiarezza+': {
    adulto: ['Si capisce subito, bravi.'],
    giovane: ['Chiarissimo'],
    senior: ['Finalmente una pubblicità chiara.'],
  },
  'poco_chiaro-': {
    giovane: ['Non ho capito cosa vendete 😅'],
    adulto: ['Ma cos\'è esattamente?', 'Non si capisce cosa offrite.'],
    senior: ['Non ho capito di cosa si tratta.'],
  },
  'stagione+': {
    giovane: ['Black Friday arrivo 🛍️'],
    adulto: ['Me lo segno per il Black Friday.', 'Regalo di Natale risolto?'],
    senior: ['Potrebbe essere un bel regalo per Natale.'],
  },
  'no_immagine-': {
    giovane: ['Niente foto? 👀'],
    adulto: ['Senza una foto non capisco com\'è.'],
    senior: ['Si può vedere una foto?'],
  },
  'formato_piattaforma-': {
    giovane: ['Su TikTok nessuno legge tutto questo 😂'],
    adulto: ['Formato poco adatto, si legge male.'],
    senior: ['Si legge male sul telefono.'],
  },
  'beneficio+': {
    adulto: ['Mi interessa il fatto che sia comodo.'],
    giovane: ['Comodo, ci sta'],
    senior: ['Se è pratico, bene.'],
  },
};

const AMICI = ['giuli_98', 'marco.rx', 'sara_pz', 'fede.ricci', 'ale_nap', 'chiaretta', 'lollo_23'];

function fascia(eta) {
  return eta < 35 ? 'giovane' : eta < 55 ? 'adulto' : 'senior';
}

/**
 * Sceglie reazione e commento per una persona.
 * @returns {{reazione:'click'|'like'|'commento'|'ignora', commento?:string, motivo:string, codice:string}}
 */
export function reactAndComment(p, ev, adHashStr, seme = '42') {
  const rng = makeRng(`rx|${seme}|${p.id}|${adHashStr}`);
  const ferma = rng() < ev.pStop;
  const clicca = ferma && rng() < ev.pClick / Math.max(ev.pStop, 1e-6);
  const like = ferma && rng() < ev.pLike;
  const commenta = ferma && rng() < 0.22;

  // motivo dominante: il contributo con valore assoluto più grande
  const sorted = [...ev.contrib].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  // se ha cliccato o messo like preferiamo un motivo positivo, se ha ignorato uno negativo
  const want = clicca || like ? 1 : -1;
  const dom = sorted.find(([, v]) => Math.sign(v) === want) || sorted[0] || ['chiarezza', 0.1];
  const [code, val] = dom;
  const key = `${code}${val >= 0 ? '+' : '-'}`;
  const motivo = motivoTesto(code, val);

  let reazione = 'ignora';
  if (clicca) reazione = 'click';
  else if (commenta) reazione = 'commento';
  else if (like) reazione = 'like';

  let commento;
  if (commenta || (clicca && rng() < 0.35)) {
    const pool = T[key]?.[fascia(p.eta)] || T[key]?.adulto;
    if (pool) commento = pick(rng, pool).replace('{amico}', pick(rng, AMICI));
  }
  return { reazione, ferma, clicca, like, commento, motivo, codice: key };
}
