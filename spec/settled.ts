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
/** A path's spinner time since it was last seen without one: all of it, and the part with nothing in flight. */
export type SpinnerTally = { idle: number; on: number };

export type SpinnerStore = { paths: Record<string, SpinnerTally>; last?: { path: string; at: number; busy?: number; page?: number } };

/**
 * spinnersClear's measure: how long a spinner has shown on `path` (`on`), and
 * how much of that with no mock request in flight (`idle`), added up across visits, since the path was last seen
 * without one. A random walker leaves a page within a fraction of a second, so
 * a spinner that never clears is never seen for long in one visit; it is seen
 * on every visit.
 *
 * A capture that shows a spinner is credited with the time until the next
 * capture on its page, or, if the walker left first, until it left (`left`:
 * when, and the busy clock then; unknown across a reload, `page` changing,
 * which credits nothing). Minus the part of that a mock request was in flight (`busy`: ms in
 * flight since the page loaded, from bombadil-kit/faults' startMockRequest):
 * a spinner waiting on a slow request the walker never waits out isn't stuck.
 */
export const spinnerTime = (
  store: SpinnerStore,
  path: string,
  spinning: boolean,
  now: number,
  busy?: number,
  left?: { at: number; busy?: number },
  page?: number,
): SpinnerTally => {
  const last = store.last;
  const tally = last && store.paths[last.path];
  if (last && tally) {
    const stayed = path === last.path && last.page === page;
    const end = stayed ? { at: now, busy } : left && left.at >= last.at && left.at <= now ? left : undefined;
    if (end) {
      const shown = Math.max(0, end.at - last.at);
      const waiting = end.busy !== undefined && last.busy !== undefined ? Math.max(0, end.busy - last.busy) : 0;
      tally.on += shown;
      tally.idle += Math.max(0, shown - waiting);
    }
  }
  if (!spinning) {
    delete store.paths[path];
    delete store.last;
    return { idle: 0, on: 0 };
  }
  store.paths[path] ??= { idle: 0, on: 0 };
  store.last = { path, at: now, ...(busy === undefined ? {} : { busy }), ...(page === undefined ? {} : { page }) };
  return { ...store.paths[path] };
};

/**
 * spinnersClear's verdict on a path's tally: stuck once `deadline` ms of
 * spinner time had nothing in flight (enough evidence), and that's at least
 * `share` of all its spinner time. A spinner waiting on requests the walker
 * keeps abandoning is mostly not idle, however long the sweep; a stuck one is
 * mostly idle, so a share doesn't grow with run length the way a total does.
 * `deadline` null (a hang was injected): never stuck. Measured on the example
 * shop: a stuck spinner is 28–33% idle, one waiting on abandoned slow requests
 * 1%, whatever the run length; hence 0.1.
 */
export const spinnerStuck = ({ idle, on }: SpinnerTally, deadline: number | null, share = 0.1) =>
  deadline !== null && idle > deadline && idle >= share * on;
