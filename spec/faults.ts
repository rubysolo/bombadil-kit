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
 * A deadline, in ms, for a spinner seen at `now`: `within` seconds, plus the
 * largest `delayMs` among slow faults still in flight (`at + delayMs` not yet
 * passed). `null` once any hang was injected since the page loaded: a hung
 * request legitimately spins forever. spinnersClear no longer adds the slow
 * extension to a total (spinnerTime leaves slow time out instead); kept for
 * specs of an app's own.
 */
export const spinnerDeadline = (faults: readonly InjectedFault[], now: number, within: number): number | null => {
  if (faults.some((f) => f.kind === 'hang')) return null;
  const slow = faults
    .filter((f) => f.kind === 'slow' && now < f.at + (f.delayMs ?? 0))
    .reduce((max, f) => Math.max(max, f.delayMs ?? 0), 0);
  return within * 1000 + slow;
};

/** Whether a hang was injected since the page loaded: spinnersClear's excuse. */
export const hungSince = (faults: readonly InjectedFault[]) => faults.some((f) => f.kind === 'hang');

/** How much of `from`..`to` (ms) a slow fault was in flight, `at` to `at + delayMs`; overlapping faults count once. */
export const slowOverlap = (faults: readonly InjectedFault[], from: number, to: number): number => {
  const spans = faults
    .filter((f) => f.kind === 'slow' && (f.delayMs ?? 0) > 0)
    .map((f) => [Math.max(from, f.at), Math.min(to, f.at + f.delayMs!)] as const)
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  let total = 0;
  let end = from;
  for (const [a, b] of spans) {
    if (b <= end) continue;
    total += b - Math.max(a, end);
    end = b;
  }
  return total;
};

/** What failedWritesShown remembers across states, on the page's `window`: a page load starts it over, with __mockFaults. */
export interface WriteWatch {
  /**
   * Failed writes not yet told: the history entry they're owed an alert on,
   * since when (`deliveredAt`, or when first seen), and until when leaving
   * that entry drops it instead (absent: never). `delivered`: the fault has a
   * `deliveredAt`, so leaving drops it until a state on its entry is captured
   * at or after `leaveBy`, whenever the next page is first captured.
   */
  pending: { fault: InjectedFault; entry: number; since: number; leaveBy?: number; delivered?: boolean }[];
  /** Every failed write already taken up, so each is owed one alert, not one per state. */
  seen: { has(f: InjectedFault): boolean; add(f: InjectedFault): unknown };
}

/** How a fault reads in a finding: `POST /orders → 500`. */
export const faultLine = (f: InjectedFault) => `${f.method} ${f.path} → ${String(f.status)}`;

/** When a failed request's error reached the app: `deliveredAt` if the mock layer knows it, else `at`. */
export const deliveredAt = (f: InjectedFault) => f.deliveredAt ?? f.at;

/**
 * failedWritesShown, for one captured state. A failed write (fresh, not
 * `quiet`, an error) is owed an alert on the history entry the walker is on
 * when it's first seen: where the user is when the failure lands. An alert
 * there settles it. `within` ms passing, or leaving that entry, makes it
 * unannounced: returns the fault, once. Leaving before the error could have
 * reached the app drops it instead: with no state on its page captured at or
 * after `deliveredAt` when the fault has one (the walker leaves between two
 * captures, and the next page's first one can come after delivery), else
 * within `leaveGrace` ms of when it was first seen (a mock layer
 * may log the fault when the call starts and answer after a delay; a walker
 * that clicks away right after Save is gone by then). `within` counts from
 * `deliveredAt`, else from first seen. An alert on another page doesn't
 * count; that's how a write that fails silently hid behind an unrelated
 * error.
 */
export const unannouncedWrite = (
  watch: WriteWatch,
  faults: readonly InjectedFault[],
  now: number,
  quiet: readonly RegExp[],
  entry: number,
  alertShown: boolean,
  within = 5000,
  fresh = 1500,
  leaveGrace = 1000,
): InjectedFault | null => {
  for (const f of faults) {
    if (watch.seen.has(f) || !isErrorFault(f) || !isWriteFault(f) || now - deliveredAt(f) >= fresh) continue;
    watch.seen.add(f);
    if (quiet.some((q) => q.test(`${f.method} ${f.path}`))) continue;
    const since = f.deliveredAt ?? now;
    watch.pending.push(
      f.deliveredAt === undefined
        ? { fault: f, entry, since, leaveBy: now + leaveGrace }
        : { fault: f, entry, since, leaveBy: f.deliveredAt, delivered: true },
    );
  }
  // Captured on its page after the error landed: the walker saw it, so it's owed.
  for (const p of watch.pending) if (p.delivered && p.entry === entry && p.leaveBy !== undefined && now >= p.leaveBy) delete p.leaveBy;
  if (alertShown) watch.pending = watch.pending.filter((p) => p.entry !== entry);
  // Left before the error could have reached the app: nothing was owed.
  watch.pending = watch.pending.filter((p) => p.entry === entry || p.leaveBy === undefined || (!p.delivered && now >= p.leaveBy));
  const late = watch.pending.find((p) => p.entry !== entry || now - p.since > within);
  if (!late) return null;
  watch.pending = watch.pending.filter((p) => p !== late);
  return late.fault;
};

/**
 * A path segment that names a record rather than an endpoint: all digits, a
 * longer one with digits in it (a UUID, `P12345`), or an upper-case slug
 * (`TEST-BASIC-ORDER`).
 */
const isRecordSegment = (seg: string) =>
  /^\d+$/.test(seg) || (seg.length >= 4 && /\d/.test(seg)) || /^[A-Z][A-Z0-9]*(?:[-_][A-Z0-9]+)+$/.test(seg);

/**
 * The endpoint a request hit, for a finding's id: `METHOD /path` with record
 * segments as `:id`. One bug, one finding, whatever the status or the record:
 * `POST /orders/TEST-BASIC-ORDER/design_requests` → `POST /orders/:id/design_requests`.
 */
export const requestPattern = (method: string, path: string) =>
  `${method} ${path.split('/').map((seg) => (isRecordSegment(seg) ? ':id' : seg)).join('/')}`;

/**
 * consoleQuietUnlessFaulted's excuse: a fault that may still be making the app
 * log. An error for `grace` ms after it reached the app (`deliveredAt`); a
 * slow response until `grace` ms after it answers; a hang for `hangGrace` ms after it started (a hung
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
        return now - deliveredAt(f) < grace;
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
