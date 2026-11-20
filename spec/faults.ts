// The pure half of the properties that read window.__mockFaults: no Bombadil
// imports, so node can test it. spec/index.ts calls these inside `extract`.
//
// The shape is bombadil-kit/faults' InjectedFault (src/app/faults.ts); a mock
// layer of the app's own can push the same entries.

export type FaultKind = 'error' | 'slow' | 'hang';

export type InjectedFault = {
  method: string;
  path: string;
  status: unknown;
  at: number;
  write?: boolean;
  kind?: FaultKind;
  delayMs?: number;
};

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
 * after it answers; a hang for as long as the page lives.
 */
export const faultInFlight = (faults: readonly InjectedFault[], now: number, grace = 5000) =>
  faults.some((f) => {
    switch (f.kind ?? 'error') {
      case 'hang':
        return true;
      case 'slow':
        return now - f.at < (f.delayMs ?? 0) + grace;
      default:
        return now - f.at < grace;
    }
  });
