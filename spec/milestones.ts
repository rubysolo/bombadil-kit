// The pure half of milestones: no Bombadil imports, so node can test it.
// spec/index.ts calls it inside `extract`. `import type` is erased, so the
// bundle Bombadil runs in the page doesn't pull in the app-side module.
import type { MockCall } from '../src/app/faults.ts';

/** A milestone's test: true once the workflow got there (a success banner shows, the fields hold the new values). */
export type MilestonePredicate = (doc: Document, win: Window) => boolean;

/**
 * A milestone: its predicate, or the predicate and the mock call that must
 * have answered `ok` since the predicate last went false (or since the page
 * loaded), before or while it holds. `after` is a call's `key`: a string matches it whole, a RegExp
 * tests it.
 */
export type MilestoneDef = MilestonePredicate | { holds: MilestonePredicate; after: string | RegExp };

export type MilestoneWindow = {
  __fuzzMilestones?: Record<string, boolean>;
  /** Per `after` milestone, the __mockCalls length at its predicate's last true state. */
  __fuzzMilestonesSince?: Record<string, number>;
  __mockCalls?: MockCall[];
};

const matches = (after: string | RegExp, key: string): boolean => {
  if (typeof after === 'string') return key === after;
  after.lastIndex = 0;
  return after.test(key);
};

/**
 * The milestones that turned reached since the last call on this window:
 * edge-triggered, so a banner that stays up counts once, and counts again
 * only after it went away and came back. The last values live on `win`, so a
 * new document starts over. A predicate that throws is false. One with
 * `after` is reached only once an `ok` call to it is in `win.__mockCalls`
 * since its predicate last went false: a banner left from an earlier save, or
 * a save the mock answered with an error, doesn't count.
 */
export const reachedMilestones = (defs: Record<string, MilestoneDef>, doc: Document, win: Window): string[] => {
  const w = win as Window & MilestoneWindow;
  const was = (w.__fuzzMilestones ??= {});
  const calls = w.__mockCalls ?? [];
  const reached: string[] = [];
  for (const [name, def] of Object.entries(defs)) {
    const holds = typeof def === 'function' ? def : def.holds;
    let now = false;
    try {
      now = holds(doc, win) === true;
    } catch {
      now = false;
    }
    if (typeof def !== 'function') {
      const since = (w.__fuzzMilestonesSince ??= {});
      // A mock layer that replaced its array starts over.
      if ((since[name] ?? 0) > calls.length) since[name] = 0;
      // Calls count from the predicate's last true state: the ones while it
      // was false, and since. Once reached, it stays reached while it holds.
      if (now) {
        now = !!was[name] || calls.slice(since[name] ?? 0).some((c) => c.outcome === 'ok' && matches(def.after, c.key));
        since[name] = calls.length;
      }
    }
    if (now && !was[name]) reached.push(name);
    was[name] = now;
  }
  return reached;
};
