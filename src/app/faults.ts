/**
 * bombadil-kit/faults: seeded fault injection for an app's mock API, the app
 * side of the contract with bombadil-kit/spec's failedWritesShown and
 * consoleQuietUnlessFaulted: every injected fault is pushed onto
 * window.__mockFaults as { method, path, status, at } (InjectedFault). A mock
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

declare global {
  interface Window {
    /** Every fault the injector has answered with since the page loaded. */
    __mockFaults?: InjectedFault[];
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

/** The ways real requests fail. */
export const FAULTS: Fault[] = [
  { status: 500, data: { error: 'Internal Server Error' } },
  { status: 503, data: undefined },
  { status: 422, data: { errors: ['Injected by the mock fault injector'] } },
  { status: 'FETCH_ERROR', error: 'TypeError: Failed to fetch' },
  { status: 'TIMEOUT_ERROR', error: 'AbortError: signal timed out' },
];

/** `(method, path)` → the fault to answer with, or undefined to let it through. */
export const createFaultInjector = ({ rate, seed, spare = [/^\/mock\//], isWrite }: FaultConfig) => {
  const random = prng(seed);
  return (method: string, path: string): Fault | undefined => {
    if (spare.some((re) => re.test(path))) return undefined;
    if (random() >= rate) return undefined;
    const fault = FAULTS[Math.floor(random() * FAULTS.length)]!;
    if (typeof window !== 'undefined') {
      const logged: InjectedFault = { method: method.toUpperCase(), path, status: fault.status, at: Date.now() };
      if (isWrite) logged.write = isWrite(method, path);
      (window.__mockFaults ??= []).push(logged);
    }
    return fault;
  };
};
