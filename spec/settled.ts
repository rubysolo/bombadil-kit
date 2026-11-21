// How long a condition has held, for spec/index.ts, with no Bombadil imports
// so node can test it.

/** How long a condition has held: milliseconds, and captured states. A type, not an interface: `extract` needs it to be JSON. */
export type Persisted = { ms: number; states: number };

/** Where `persist` keeps its timers: one per key, on the page's `window`. */
export type PersistStore = Record<string, { entry: number; since: number; states: number }>;

/**
 * Records one captured state in `store[key]`: `active` held, or not, on
 * history entry `entry` at `now`. Returns how long it has held without a
 * break on that entry; a change of entry starts over.
 */
export const persist = (store: PersistStore, key: string, entry: number, active: boolean, now: number): Persisted => {
  if (!active) {
    delete store[key];
    return { ms: 0, states: 0 };
  }
  const held = store[key];
  if (held && held.entry === entry) {
    held.states += 1;
    return { ms: now - held.since, states: held.states };
  }
  store[key] = { entry, since: now, states: 1 };
  return { ms: 0, states: 1 };
};

/**
 * Whether a condition has outlived a render cascade. Bombadil captures a state
 * on DOM mutations, so one render can land several captures within
 * milliseconds; it takes both `minStates` captures and `minMs`.
 */
export const hasSettled = ({ ms, states }: Persisted, { minStates = 3, minMs = 1000 } = {}) =>
  states >= minStates && ms >= minMs;
