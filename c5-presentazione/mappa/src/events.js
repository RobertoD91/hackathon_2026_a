// Formato unico degli eventi del bus (CONTRATTO.md, sezione 2).
// Modulo isomorfo: funziona in Node e nel browser.

/** Tipi di evento previsti dal contratto. */
export const EVENT_TYPES = Object.freeze([
  'reading',
  'scenario',
  'agent.message',
  'agent.decision',
  'notify',
  'metric',
  'chat',
]);

let counter = 0;

/** Id leggibile e unico nel processo: `evt_<tempo base36>_<contatore>_<casuale>`. */
export function newEventId(ts = Date.now()) {
  counter = (counter + 1) % 1_000_000;
  const rnd = Math.floor(Math.random() * 36 ** 4).toString(36).padStart(4, '0');
  return `evt_${ts.toString(36)}_${counter.toString(36)}_${rnd}`;
}

/**
 * Crea un evento nel formato del contratto.
 * @param {{type: string, source: string, data?: object, ts?: number, id?: string}} e
 */
export function createEvent({ type, source, data = {}, ts = Date.now(), id }) {
  if (typeof type !== 'string' || !type) throw new TypeError('evento senza "type"');
  if (typeof source !== 'string' || !source) throw new TypeError('evento senza "source"');
  return { id: id || newEventId(ts), ts, type, source, data: data ?? {} };
}

/**
 * Orologio monotono: restituisce un timestamp in ms sempre strettamente crescente.
 * Serve a `GET /api/notifications?since=<ts>`: con ts tutti diversi il polling
 * non perde e non duplica eventi creati nello stesso millisecondo.
 */
export function createMonotonicClock(now = () => Date.now()) {
  let last = 0;
  return () => {
    const t = Math.max(now(), last + 1);
    last = t;
    return t;
  };
}
