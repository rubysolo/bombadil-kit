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

/** Where `spinnerTime` keeps its tally: ms of spinner per path, and the last capture that showed one. */
export type SpinnerStore = { paths: Record<string, number>; last?: { path: string; at: number } };

/**
 * spinnersClear's measure: how long a spinner has shown on `path`, added up
 * across visits, since the path was last seen without one. A random walker
 * leaves a page within a fraction of a second, so a spinner that never clears
 * is never seen for long in one visit; it is seen on every visit. A capture
 * that shows a spinner is credited with the time until the next capture,
 * wherever that is: it was on screen until then.
 */
export const spinnerTime = (store: SpinnerStore, path: string, spinning: boolean, now: number): number => {
  const last = store.last;
  if (last && last.path in store.paths) store.paths[last.path]! += now - last.at;
  if (!spinning) {
    delete store.paths[path];
    delete store.last;
    return 0;
  }
  store.paths[path] ??= 0;
  store.last = { path, at: now };
  return store.paths[path];
};
