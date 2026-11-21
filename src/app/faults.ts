/**
 * bombadil-kit/faults: seeded fault injection for an app's mock API, the app
 * side of the contract with bombadil-kit/spec's failedWritesShown,
 * consoleQuietUnlessFaulted and spinnersClear: every injected fault is pushed
 * onto window.__mockFaults as { method, path, status, at } (InjectedFault). A mock
 * layer of the app's own (RPC, Salesforce remoting, GraphQL, one that delays
 * or hangs requests) can push the same entries.
 *
 * Off unless VITE_MOCK_FAULT_RATE is set (bombadil-kit.json's server.env sets
 * it from --faults). Choices come from a PRNG seeded by VITE_MOCK_FAULT_SEED:
 * a seed and the same sequence of requests fail the same way; a page load
 * restarts the sequence.
 *
 * With RTK Query, use bombadil-kit/rtk's withFaults instead of this directly.
 */
export interface FaultConfig {
  /** Share of requests to fail, 0–1. */
  rate: number;
  seed: number;
  /** Paths never to fail (the mock's control API, what every page needs to render). */
  spare?: RegExp[];
  /** Whether a request changes data, for transports without HTTP verbs; fills InjectedFault's `write`. */
  isWrite?: (method: string, path: string) => boolean;
}

/** A failure, in RTK Query's FetchBaseQueryError shape (other clients: map it). */
export type Fault =
  | { status: number; data?: unknown }
  | { status: 'FETCH_ERROR'; error: string }
  | { status: 'TIMEOUT_ERROR'; error: string };

/** See InjectedFault's `kind`. */
export type FaultKind = 'error' | 'slow' | 'hang';

export interface InjectedFault {
  /** The HTTP method, or whatever the transport has instead (an RPC mock might log `'RPC'`). */
  method: string;
  /** The endpoint: a path, or e.g. `Controller.method`. */
  path: string;
  /** What the request failed with; a status of the mock layer's own for faults that aren't HTTP. */
  status: Fault['status'] | (string & {});
  /** `Date.now()` when the fault was injected (for `slow` and `hang`: when the request started). */
  at: number;
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
}

/** An endpoint the mock API has, so the report can show the ones never called. */
export interface MockEndpoint {
  key: string;
  /** Its named responses; `[]` if it has one. */
  variants: string[];
}

declare global {
  interface Window {
    /** Every fault the injector has answered with since the page loaded. */
    __mockFaults?: InjectedFault[];
    /** Every call the mock API saw since the page loaded. */
    __mockCalls?: MockCall[];
    /** The mock API's endpoints. */
    __mockEndpoints?: MockEndpoint[];
  }
}

/** Reads VITE_MOCK_FAULT_RATE and VITE_MOCK_FAULT_SEED; pass `import.meta.env`. */
export const parseFaultConfig = (env: Record<string, unknown>): FaultConfig | undefined => {
  const rate = Number.parseFloat(String(env.VITE_MOCK_FAULT_RATE ?? ''));
  if (!Number.isFinite(rate) || rate <= 0) return undefined;
  const seed = Number.parseInt(String(env.VITE_MOCK_FAULT_SEED ?? ''), 10);
  return { rate: Math.min(rate, 1), seed: Number.isNaN(seed) ? 1 : seed };
};

/** mulberry32: small, fast, and good enough to pick which request fails. */
export const prng = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/**
 * Text every built-in fault carries, so a console error that logs one can be
 * told from any other: `consoleQuietUnlessFaulted({ injected: new RegExp(INJECTED_MARKER) })`.
 */
export const INJECTED_MARKER = 'Injected by the mock fault injector';

/** The ways real requests fail. */
export const FAULTS: Fault[] = [
  { status: 500, data: { error: `Internal Server Error (${INJECTED_MARKER})` } },
  { status: 503, data: `Service Unavailable (${INJECTED_MARKER})` },
  { status: 422, data: { errors: [INJECTED_MARKER] } },
  { status: 'FETCH_ERROR', error: `TypeError: Failed to fetch (${INJECTED_MARKER})` },
  { status: 'TIMEOUT_ERROR', error: `AbortError: signal timed out (${INJECTED_MARKER})` },
];

/**
 * `(method, path)` → the fault to answer with, or undefined to let it through.
 * Each request goes onto window.__mockCalls as `METHOD /path`, `'error'` if
 * it faulted it, else `'ok'` (spared ones too: the app did call them).
 */
export const createFaultInjector = ({ rate, seed, spare = [/^\/mock\//], isWrite }: FaultConfig) => {
  const random = prng(seed);
  const call = (method: string, path: string, outcome: CallOutcome) => {
    if (typeof window !== 'undefined') (window.__mockCalls ??= []).push({ key: `${method.toUpperCase()} ${path}`, outcome, at: Date.now() });
  };
  return (method: string, path: string): Fault | undefined => {
    if (spare.some((re) => re.test(path)) || random() >= rate) {
      call(method, path, 'ok');
      return undefined;
    }
    const fault = FAULTS[Math.floor(random() * FAULTS.length)]!;
    call(method, path, 'error');
    if (typeof window !== 'undefined') {
      const logged: InjectedFault = { method: method.toUpperCase(), path, status: fault.status, at: Date.now() };
      if (isWrite) logged.write = isWrite(method, path);
      (window.__mockFaults ??= []).push(logged);
    }
    return fault;
  };
};
