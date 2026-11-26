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
 * A layer with its own latency should answer a fault after that wait too, so
 * a failing request takes as long as a working one, and pass the wait as
 * `deliverIn` (withFaults: its `latency` option).
 */
export interface FaultConfig {
  /** Share of requests to fail, 0–1. */
  rate: number;
  seed: number;
  /** Paths never to fail (the mock's control API, what every page needs to render). */
  spare?: RegExp[];
  /** Whether a request changes data, for transports without HTTP verbs; fills InjectedFault's `write`. */
  isWrite?: (method: string, path: string) => boolean;
  /**
   * The caller answers with the fault at once: logs `deliveredAt` = `at`, so
   * failedWritesShown gives no `leaveGrace`. A layer that answers after a
   * delay passes it per call instead: `inject(method, path, delayMs)`.
   */
  delivered?: boolean;
}

/** A failure, in RTK Query's FetchBaseQueryError shape (other clients: map it). */
export type Fault =
  | { status: number; data?: unknown }
  | { status: 'FETCH_ERROR'; error: string }
  | { status: 'TIMEOUT_ERROR'; error: string };
// Its statuses are the page protocol's FaultStatus (test/app.test.ts checks both ways).

// The window fields and their types are the page protocol, shared with the
// spec: see src/page-protocol.ts.
// Imported, then exported, like the spec does (one rule for every bundler).
import {
  busyMs,
  openRequest,
  COOKIES,
  decodeCookies,
  type CallOutcome,
  type FaultKind,
  type FaultStatus,
  type InjectedFault,
  type MockCall,
  type MockEndpoint,
  type MockWindow,
  type PageCookies,
} from '../page-protocol.ts';

export type { CallOutcome, FaultKind, FaultStatus, InjectedFault, MockCall, MockEndpoint, MockWindow, PageCookies };
/** The runner's cookies (fuzz_seed, fuzz_faults, fuzz_ref_date…), for a mock that reads them: `decodeCookies(document.cookie)`. */
export { COOKIES, decodeCookies };

declare global {
  // The mock layer's fields: __mockFaults, __mockCalls, __mockEndpoints, __mockPending, __mockBusyMs, __mockBusySince.
  interface Window extends MockWindow {}
}

/**
 * Call when a mocked request starts; call what it returns when the request
 * answers, fails or is abandoned (an abort on unmount). Keeps
 * window.__mockPending and the time anything was in flight (mockBusyMs), so
 * spinnersClear can tell a spinner waiting on a slow request from one stuck
 * with nothing in flight. withFaults does this for RTK Query; a mock layer of
 * the app's own calls it per request.
 */
export const startMockRequest = (clock: () => number = Date.now): (() => void) =>
  typeof window === 'undefined' ? () => {} : openRequest(window, clock);

/** ms any mocked request has been in flight since the page loaded, overlaps counted once (spinnersClear reads the same clock). */
export const mockBusyMs = (clock: () => number = Date.now): number =>
  typeof window === 'undefined' ? 0 : (busyMs(window, clock()) ?? 0);

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
 * `(method, path, deliverIn?)` → the fault to answer with, or undefined to let it through.
 * `deliverIn`: the ms the caller will wait before answering with it (or a
 * function, called only for a fault); logs `deliveredAt` = `at` + that
 * (withFaults passes its `latency`).
 * Each request goes onto window.__mockCalls as `METHOD /path`, `'error'` if
 * it faulted it, else `'ok'` (spared ones too: the app did call them).
 */
// Shared by every injector on the page, so their entries' seq never repeats.
let callSeq = 0;

export const createFaultInjector = ({ rate, seed, spare = [/^\/mock\//], isWrite, delivered }: FaultConfig) => {
  const random = prng(seed);
  const call = (method: string, path: string, outcome: CallOutcome) => {
    if (typeof window !== 'undefined') (window.__mockCalls ??= []).push({ key: `${method.toUpperCase()} ${path}`, outcome, at: Date.now(), seq: ++callSeq });
  };
  return (method: string, path: string, deliverIn?: number | (() => number)): Fault | undefined => {
    if (spare.some((re) => re.test(path)) || random() >= rate) {
      call(method, path, 'ok');
      return undefined;
    }
    const fault = FAULTS[Math.floor(random() * FAULTS.length)]!;
    call(method, path, 'error');
    if (typeof window !== 'undefined') {
      const logged: InjectedFault = { method: method.toUpperCase(), path, status: fault.status, at: Date.now() };
      if (window.location) logged.href = window.location.href;
      if (isWrite) logged.write = isWrite(method, path);
      if (deliverIn !== undefined) logged.deliveredAt = logged.at + Math.max(0, typeof deliverIn === 'function' ? deliverIn() : deliverIn);
      else if (delivered) logged.deliveredAt = logged.at;
      (window.__mockFaults ??= []).push(logged);
    }
    return fault;
  };
};
