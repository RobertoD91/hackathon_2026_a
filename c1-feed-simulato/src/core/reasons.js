// Testi dei motivi: ogni codice del modello euristico ha una frase in italiano
// per quando aiuta (+) e per quando pesa contro (−).

export const MOTIVI = {
  no_immagine: { neg: 'senza immagine l\'annuncio non ferma lo scroll' },
  immagine_forte: { pos: 'l\'immagine ha colori forti e contrasto: ferma lo scroll', neg: 'l\'immagine non spicca nel feed' },
  immagine_debole: { pos: 'l\'immagine regge', neg: 'l\'immagine è scura o spenta e si confonde nel feed' },
  volti: { pos: 'una persona nell\'immagine attira lo sguardo' },
  interesse: { pos: 'il prodotto rientra nei suoi interessi', posAgg: 'il prodotto interessa a una parte ampia del target' },
  no_interesse: { neg: 'il settore non rientra nei suoi interessi', negAgg: 'il prodotto interessa a pochi nel target' },
  offerta: { pos: 'l\'offerta (sconto o prezzo) è chiara e dà un motivo per cliccare' },
  no_offerta: { neg: 'non c\'è un prezzo né un\'offerta: manca un motivo per cliccare subito' },
  offerta_sospetta: { neg: 'lo sconto sembra troppo bello per essere vero' },
  testo_lungo: { neg: 'il testo è troppo lungo: il messaggio non arriva nei primi 2 secondi' },
  testo_breve: { pos: 'il testo è breve e si legge al volo' },
  formato_piattaforma: { neg: 'il formato non è adatto alla piattaforma (testo lungo in un formato verticale o troppe emoji su LinkedIn)' },
  chiarezza: { pos: 'si capisce subito cosa offre', neg: 'il messaggio principale non è chiaro' },
  poco_chiaro: { pos: 'il messaggio è comprensibile', neg: 'non si capisce subito cosa offre l\'annuncio' },
  emoji_ok: { pos: 'le emoji rendono il post più vicino al suo modo di scrivere', neg: 'le emoji non aiutano' },
  emoji_troppe: { pos: 'le emoji non disturbano', neg: 'troppe emoji: il tono sembra poco serio' },
  maiuscole: { neg: 'troppi punti esclamativi o maiuscole: sembra spam' },
  fuori_target: { neg: 'è fuori dal target dichiarato: l\'annuncio non parla a questo pubblico' },
  stagione: { pos: 'nel periodo del Black Friday chi scorre il feed cerca offerte' },
  cta_forte: { pos: 'la call to action è chiara e invita ad agire', neg: 'la call to action è debole' },
  cta_debole: { pos: 'la call to action è sufficiente', neg: 'manca una call to action chiara' },
  cta_coerente: { pos: 'la call to action è coerente con l\'obiettivo' },
  cta_incoerente: { neg: 'la call to action non corrisponde all\'obiettivo della campagna' },
  urgenza: { pos: 'la scadenza spinge ad agire subito' },
  riprova: { pos: 'recensioni e numeri di clienti danno fiducia', neg: 'la riprova sociale non convince' },
  beneficio: { pos: 'il beneficio concreto è esplicito' },
};

export function motivoTesto(code, segno, aggregato = false) {
  const m = MOTIVI[code];
  if (!m) return code;
  if (aggregato && (segno >= 0 ? m.posAgg : m.negAgg)) return segno >= 0 ? m.posAgg : m.negAgg;
  return (segno >= 0 ? m.pos : m.neg) || m.pos || m.neg;
}

/**
 * Aggrega i contributi per segmento: media pesata (sull'esposizione) di ogni codice.
 * @param {Map<string, number>} somme code → somma dei contributi
 * @param {number} pesoTotale
 */
export function topMotivi(somme, pesoTotale, n = 3) {
  const arr = [...somme.entries()].map(([code, v]) => ({ code, valore: v / (pesoTotale || 1) }));
  const pos = arr.filter((x) => x.valore > 0.03).sort((a, b) => b.valore - a.valore).slice(0, n)
    .map((x) => ({ ...x, testo: motivoTesto(x.code, 1) }));
  const neg = arr.filter((x) => x.valore < -0.03).sort((a, b) => a.valore - b.valore).slice(0, n)
    .map((x) => ({ ...x, testo: motivoTesto(x.code, -1) }));
  return { pos, neg };
}
