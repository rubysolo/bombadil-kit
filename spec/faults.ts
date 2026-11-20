// The pure half of the properties that read window.__mockFaults: no Bombadil
// imports, so node can test it. spec/index.ts calls these inside `extract`.
//
// The shape is bombadil-kit/faults' InjectedFault; a mock layer of the app's
// own can push the same entries. `import type` is erased, so the bundle
// Bombadil runs in the page doesn't pull in the app-side module.
import type { InjectedFault } from '../src/app/faults.ts';

export type { FaultKind, InjectedFault } from '../src/app/faults.ts';

/** Whether the faulted request changes data: `write` if the mock layer said, else anything but GET. */
export const isWriteFault = (f: InjectedFault) => f.write ?? f.method !== 'GET';

/** A fault that failed the request (`kind` absent means `'error'`), not one that only delayed it. */
export const isErrorFault = (f: InjectedFault) => (f.kind ?? 'error') === 'error';

/**
 * failedWritesShown's trigger: the first write failed within `fresh` ms of
 * `now` that isn't `quiet` (`/^METHOD \/path$/`). Slow and hung writes don't
 * count: a slow one succeeds, a hung one never answers, and spinnersClear
 * judges that.
 */
export const freshFailedWrite = (faults: readonly InjectedFault[], now: number, quiet: readonly RegExp[] = [], fresh = 1500) =>
  faults.find(
    (f) => isErrorFault(f) && isWriteFault(f) && now - f.at < fresh && !quiet.some((q) => q.test(`${f.method} ${f.path}`)),
  );

/**
 * consoleQuietUnlessFaulted's excuse: a fault that may still be making the app
 * log. An error for `grace` ms after it; a slow response until `grace` ms
 * after it answers; a hang for `hangGrace` ms after it started (a hung
 * request logs nothing by itself, and the app's timeout, if any, lands in
 * that window).
 */
export const faultInFlight = (faults: readonly InjectedFault[], now: number, grace = 5000, hangGrace = grace) =>
  faults.some((f) => {
    switch (f.kind ?? 'error') {
      case 'hang':
        return now - f.at < hangGrace;
      case 'slow':
        return now - f.at < (f.delayMs ?? 0) + grace;
      default:
        return now - f.at < grace;
    }
  });
