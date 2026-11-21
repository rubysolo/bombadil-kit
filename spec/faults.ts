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
 * spinnersClear's deadline, in ms, for a spinner seen at `now`: `within`
 * seconds, plus the largest `delayMs` among slow faults still in flight
 * (`at + delayMs` not yet passed). `null` once any hang was injected since the
 * page loaded: a hung request legitimately spins forever.
 */
export const spinnerDeadline = (faults: readonly InjectedFault[], now: number, within: number): number | null => {
  if (faults.some((f) => f.kind === 'hang')) return null;
  const slow = faults
    .filter((f) => f.kind === 'slow' && now < f.at + (f.delayMs ?? 0))
    .reduce((max, f) => Math.max(max, f.delayMs ?? 0), 0);
  return within * 1000 + slow;
};

/**
 * failedWritesShown's trigger: a failed write the first time a state sees it
 * (freshFailedWrite, minus those in `triggered`, which it adds to). Once per
 * write, not on every state while it's fresh: an alert that shows and is then
 * cleared by a successful retry, or dismissed, has done its job.
 */
export const newFailedWrite = (
  faults: readonly InjectedFault[],
  now: number,
  quiet: readonly RegExp[],
  triggered: { has(f: InjectedFault): boolean; add(f: InjectedFault): unknown },
  fresh = 1500,
) => {
  const fault = freshFailedWrite(
    faults.filter((f) => !triggered.has(f)),
    now,
    quiet,
    fresh,
  );
  if (fault) triggered.add(fault);
  return fault;
};

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

export interface ConsoleExcuse {
  /** ms an injected error (or a slow answer) excuses console errors for. Default 5000. */
  grace?: number;
  /** ms a hang excuses them for, from when it started. Default `grace`. */
  hangGrace?: number;
  /**
   * The marker the mock layer puts in the failures it injects (built-in
   * faults: `new RegExp(INJECTED_MARKER)`). Given, an error is excused only
   * if its text matches, whatever the timing; `grace`/`hangGrace` are unused.
   */
  injected?: RegExp;
}

const json = (value: unknown) => {
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return '';
  }
};

/**
 * Whether consoleQuietUnlessFaulted lets one console error through. With
 * `injected`: its text matches, either the first argument (what the report
 * shows, one string once bombadil-kit/console formats it) or all of them as
 * JSON. Bombadil records an argument that isn't a string as its class name
 * (`"Object"`), so a marker inside a logged object or error is only seen
 * through installFuzzConsole. Without `injected`: faultInFlight.
 */
export const consoleErrorExcused = (
  args: readonly unknown[],
  faults: readonly InjectedFault[],
  now: number,
  { grace = 5000, hangGrace = grace, injected }: ConsoleExcuse = {},
) => {
  if (!injected) return faultInFlight(faults, now, grace, hangGrace);
  const first = typeof args[0] === 'string' ? args[0] : json(args[0]);
  // search, not test: a /g regex's lastIndex would make test() alternate.
  return args.length > 0 && (first.search(injected) !== -1 || json(args).search(injected) !== -1);
};

/**
 * consoleQuietUnlessFaulted's extract: the args of each console error not
 * excused. Messages, not a count: the report names a finding by the first
 * string it carried and tells findings apart by it, so a count would leave
 * every console finding on a route blank and merged into one.
 */
export const unexcusedConsoleErrors = <Args extends readonly unknown[]>(
  entries: readonly { level: string; args: Args }[],
  faults: readonly InjectedFault[],
  now: number,
  excuse: ConsoleExcuse = {},
) => entries.filter((e) => e.level === 'error' && !consoleErrorExcused(e.args, faults, now, excuse)).map((e) => e.args);
