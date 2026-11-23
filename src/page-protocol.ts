// The page protocol: what the app's mock layer (bombadil-kit/faults) and the
// spec (bombadil-kit/spec) share on the page's `window`, and the cookies the
// runner (`bombadil-kit run`) hands the page.
//
// One module for both sides of the seam, so neither keeps its own copy of the
// other's fields. It imports nothing and touches no DOM global when loaded:
// src/app/faults.ts and src/runner/run.ts import it from dist, and Bombadil
// bundles it into the spec from source (spec/ imports `../src/page-protocol.ts`;
// the package ships `src` beside `spec` for that).

// ---------------------------------------------------------------- the window

/** See InjectedFault's `kind`. */
export type FaultKind = 'error' | 'slow' | 'hang';

export interface InjectedFault {
  /** The HTTP method, or whatever the transport has instead (an RPC mock might log `'RPC'`). */
  method: string;
  /** The endpoint: a path, or e.g. `Controller.method`. */
  path: string;
  /** What the request failed with (a Fault's status); a status of the mock layer's own for faults that aren't HTTP. */
  status: number | 'FETCH_ERROR' | 'TIMEOUT_ERROR' | (string & {});
  /**
   * `Date.now()` when the fault was injected. For `slow` and `hang`: when the
   * request started. For `'error'`: when the failure reached the app if the
   * layer knows it, else when the call started (most layers log it there,
   * before their response delay); then set `deliveredAt`.
   */
  at: number;
  /**
   * For `'error'`: `Date.now()` when the failure reached the app, if the layer
   * logged it earlier (at the call's start, before a delay), or `at` when it
   * knows the two are the same. failedWritesShown counts `within` from it and
   * drops a write the walker left before it (no `leaveGrace`), and
   * consoleQuietUnlessFaulted counts its `grace` from it, instead of `at`. It
   * may be in the future when logged.
   */
  deliveredAt?: number;
  /**
   * Whether the request changes data. Overrides the `method !== 'GET'` guess;
   * transports without HTTP verbs (RPC, Salesforce remoting, GraphQL) set it.
   */
  write?: boolean;
  /**
   * `'error'` (the default when absent): the request failed. `'slow'`: it
   * answered, `delayMs` late. `'hang'`: it never answers.
   * failedWritesShown only counts errors; consoleQuietUnlessFaulted excuses
   * a hang like an error, from `at`.
   */
  kind?: FaultKind;
  /** For `slow`: how late the answer came, in ms. */
  delayMs?: number;
}

/** How a mock call ended; see MockCall. */
export type CallOutcome = 'ok' | 'error' | 'slow' | 'hang';

/**
 * One call the mock API answered (or didn't), for the report's API coverage.
 * The mock layer pushes these onto window.__mockCalls; createFaultInjector
 * does it for every request it sees, keyed `METHOD /path`.
 */
export interface MockCall {
  /** What identifies the endpoint: `GET /orders/:id`, `OrderController.getOrder`. */
  key: string;
  /** The named response the mock answered with (`empty`, `locked`), if it has them. */
  variant?: string;
  outcome: CallOutcome;
  /** `Date.now()` when the call was made. */
  at: number;
  /**
   * Optional. Counts up by at least 1 per call, across the page. With it, a
   * mock layer may cap its log (drop the oldest); without it, the log must
   * only grow, or apiCalls misses the calls past the cap.
   */
  seq?: number;
}

/** An endpoint the mock API has, so the report can show the ones never called. */
export interface MockEndpoint {
  key: string;
  /** Its named responses; `[]` if it has one. */
  variants: string[];
}

/** The fields the app's mock layer keeps on `window` and the spec reads. All optional: an app may keep none. */
export interface MockWindow {
  /** Every fault the injector has answered with since the page loaded. */
  __mockFaults?: InjectedFault[];
  /** Every call the mock API saw since the page loaded. */
  __mockCalls?: MockCall[];
  /** The mock API's endpoints. */
  __mockEndpoints?: MockEndpoint[];
  /** Mocked requests in flight (startMockRequest). */
  __mockPending?: number;
  /** ms any mocked request was in flight, closed spans only; see busyMs. */
  __mockBusyMs?: number;
  /** When __mockPending last went from 0 to 1. */
  __mockBusySince?: number;
}

// ----------------------------------------------------------- the busy clock

/**
 * Counts a mocked request in flight on `win` from `clock()` now; call what it
 * returns when the request answers, fails or is abandoned (more calls do
 * nothing). Overlapping requests count once on the busy clock.
 */
export const openRequest = (win: MockWindow, clock: () => number): (() => void) => {
  const pending = win.__mockPending ?? 0;
  if (pending === 0) win.__mockBusySince = clock();
  win.__mockPending = pending + 1;
  let done = false;
  return () => {
    if (done) return;
    done = true;
    win.__mockPending = Math.max(0, (win.__mockPending ?? 1) - 1);
    if (win.__mockPending === 0) {
      const at = clock();
      win.__mockBusyMs = (win.__mockBusyMs ?? 0) + at - (win.__mockBusySince ?? at);
    }
  };
};

/**
 * ms any mocked request on `win` had been in flight at `at`, since the page
 * loaded, overlaps counted once. Undefined if the app doesn't count
 * (no `__mockPending`). A page load restarts it.
 */
export const busyMs = (win: MockWindow, at: number): number | undefined => {
  if (win.__mockPending === undefined) return undefined;
  const open = win.__mockPending > 0 ? at - (win.__mockBusySince ?? at) : 0;
  return (win.__mockBusyMs ?? 0) + open;
};

// --------------------------------------------------------------- the cookies

/** The cookies the runner hands the page, by name. */
export const COOKIES = {
  /** The flow's fence (flows.json `allow`): `fenced`, `visits`. */
  fence: 'fuzz_fence',
  /** The repo's absolute path: `appRenders`, for repo-relative files. */
  root: 'fuzz_root',
  /** The app's directory in the repo: `appRenders`, Vite URLs. */
  app: 'fuzz_app',
  /** The run's seed, fault rate and mock date, for an app's mock that server.env can't reach (a prebuilt bundle). */
  seed: 'fuzz_seed',
  faults: 'fuzz_faults',
  refDate: 'fuzz_ref_date',
} as const;

/** What the cookies carry. Absent: the runner didn't set it. */
export interface PageCookies {
  /** Path patterns, a trailing `*` a prefix. Absent or empty: no fence. */
  fence?: string[];
  root?: string;
  app?: string;
  seed?: number;
  faults?: number;
  refDate?: string;
}

/**
 * `cookies` as `NAME=VALUE` strings (Bombadil's `--cookie`), in COOKIES'
 * order. The paths are URI-encoded; the seed, rate and date go as they are,
 * for an app's mock that reads them without decoding.
 */
export const encodeCookies = (cookies: PageCookies): string[] => {
  const out: string[] = [];
  const put = (name: string, value: string) => out.push(`${name}=${value}`);
  if (cookies.fence !== undefined) put(COOKIES.fence, encodeURIComponent(cookies.fence.join(',')));
  if (cookies.root !== undefined) put(COOKIES.root, encodeURIComponent(cookies.root));
  if (cookies.app !== undefined) put(COOKIES.app, encodeURIComponent(cookies.app));
  if (cookies.seed !== undefined) put(COOKIES.seed, String(cookies.seed));
  if (cookies.faults !== undefined) put(COOKIES.faults, String(cookies.faults));
  if (cookies.refDate !== undefined) put(COOKIES.refDate, cookies.refDate);
  return out;
};

/** One cookie's value from a `document.cookie` string, decoded; null if it isn't set. */
export const readCookie = (cookie: string, name: string): string | null => {
  for (const part of cookie.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0 || part.slice(0, eq).trim() !== name) continue;
    const raw = part.slice(eq + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return null;
};

/** The runner's cookies from a `document.cookie` string; the rest are ignored. */
export const decodeCookies = (cookie: string): PageCookies => {
  const out: PageCookies = {};
  const read = (name: string) => readCookie(cookie, name);
  const number = (name: string) => {
    const value = read(name);
    const n = value === null || value === '' ? Number.NaN : Number(value);
    return Number.isFinite(n) ? n : undefined;
  };
  const fence = read(COOKIES.fence);
  if (fence) out.fence = fence.split(',');
  const root = read(COOKIES.root);
  if (root !== null) out.root = root;
  const app = read(COOKIES.app);
  if (app !== null) out.app = app;
  const seed = number(COOKIES.seed);
  if (seed !== undefined) out.seed = seed;
  const faults = number(COOKIES.faults);
  if (faults !== undefined) out.faults = faults;
  const refDate = read(COOKIES.refDate);
  if (refDate !== null) out.refDate = refDate;
  return out;
};
