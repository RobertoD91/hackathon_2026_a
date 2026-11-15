// Bus di eventi in memoria. Isomorfo (nessuna dipendenza da node:events).
//
//   const bus = new EventBus();
//   const off = bus.subscribe((evt) => console.log(evt), { types: ['reading'] });
//   bus.emit(evento);   // l'evento deve essere già nel formato del contratto
//   off();
//
// I listener sono sincroni e isolati: se uno lancia un'eccezione gli altri
// ricevono comunque l'evento. Per pubblicare eventi nuovi usa `hub.publish`
// (che crea id e ts), non `bus.emit` direttamente.

export class EventBus {
  #listeners = new Set();
  #onError;

  /** @param {{onError?: (err: Error, event: object) => void}} [opts] */
  constructor({ onError } = {}) {
    this.#onError = onError || ((err) => console.error('[bus] errore in un listener:', err));
  }

  /**
   * Registra un listener. `types` (facoltativo) filtra per tipo di evento;
   * `'*'` o assente = tutti. Restituisce la funzione per disiscriversi.
   * @param {(event: object) => void} fn
   * @param {{types?: string[]}} [opts]
   */
  subscribe(fn, { types } = {}) {
    const filter = types && !types.includes('*') ? new Set(types) : null;
    const entry = { fn, filter };
    this.#listeners.add(entry);
    return () => this.#listeners.delete(entry);
  }

  /** Consegna l'evento a tutti i listener interessati. */
  emit(event) {
    for (const { fn, filter } of [...this.#listeners]) {
      if (filter && !filter.has(event.type)) continue;
      try {
        fn(event);
      } catch (err) {
        this.#onError(err, event);
      }
    }
  }

  get size() {
    return this.#listeners.size;
  }
}
