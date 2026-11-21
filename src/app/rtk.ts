/**
 * bombadil-kit/rtk: fault injection for RTK Query.
 *
 *   import { withFaults } from 'bombadil-kit/rtk';
 *   const baseQuery = withFaults(mockBaseQuery, import.meta.env, { spare: [/^\/mock\//, /^\/translations/] });
 *
 * Wraps any baseQuery (a custom mock one, or fetchBaseQuery). In fuzz mode
 * (VITE_MOCK_FAULT_RATE set, `0` included) it fails that share of requests
 * and counts every request in flight (startMockRequest), for spinnersClear.
 * A fault answers after `latency` ms (VITE_MOCK_LATENCY_MS by default), as
 * long as a request that goes through: a failing request shows its spinner,
 * and the walker can leave before its error lands.
 * Without it, it returns `baseQuery` itself, so it costs nothing outside the
 * fuzzer. Pass the app's `import.meta.env`: Vite only
 * fills that in in the app's own code, not in a dependency.
 */
import type { BaseQueryApi, BaseQueryFn, FetchArgs, FetchBaseQueryError } from '@reduxjs/toolkit/query';
import { createFaultInjector, parseFaultConfig, startMockRequest } from './faults.ts';

export interface WithFaultsOptions {
  /** Paths never to fail. Default: /^\/mock\// (the mock's control API). */
  spare?: RegExp[];
  /** Whether a request changes data, when its method doesn't say; see InjectedFault's `write`. */
  isWrite?: (method: string, path: string) => boolean;
  /** Called with each fault, e.g. to log it. */
  onFault?: (method: string, path: string, fault: FetchBaseQueryError) => void;
  /**
   * ms a fault takes to answer, or a function returning it, called once per fault.
   * Default: VITE_MOCK_LATENCY_MS from `env` (the runner's `{latency}`), else 0.
   * Match the wrapped baseQuery's own delay, so a failing request takes as
   * long as a working one.
   */
  latency?: number | (() => number);
}

/** Resolves after `ms`, or as soon as `signal` aborts. */
const wait = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (ms <= 0 || signal?.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    }
    signal?.addEventListener('abort', done);
  });

const requestOf = (args: string | FetchArgs) => {
  const url = typeof args === 'string' ? args : args.url;
  const method = (typeof args === 'string' ? 'GET' : (args.method ?? 'GET')).toUpperCase();
  // The path only: the API's base URL and the query string don't say which endpoint.
  const path = url.replace(/^[a-z]+:\/\/[^/]+/i, '').split('?')[0]!;
  return { method, path };
};

// One type parameter for the whole baseQuery, returned as is: createApi infers
// its BaseQuery from `baseQuery: withFaults(…)` inline. Spelled out as
// BaseQueryFn<Args, Result, …> it can't, and every endpoint's error is unknown.
type AnyFaultableBaseQuery = BaseQueryFn<any, any, FetchBaseQueryError, any, any>;

export const withFaults = <BaseQuery extends AnyFaultableBaseQuery>(
  baseQuery: BaseQuery,
  env: Record<string, unknown>,
  { spare, isWrite, onFault, latency }: WithFaultsOptions = {},
): BaseQuery => {
  // Fuzz mode: the runner always sets the rate, `0` included. Off it, nothing is wrapped.
  if (env.VITE_MOCK_FAULT_RATE === undefined || env.VITE_MOCK_FAULT_RATE === '') return baseQuery;
  // At rate 0 it fails nothing, but still logs every call (__mockCalls) for flow milestones.
  const config = parseFaultConfig(env) ?? { rate: 0, seed: 1 };
  const inject = createFaultInjector({ ...config, ...(spare ? { spare } : {}), ...(isWrite ? { isWrite } : {}) });
  const envLatency = Number(env.VITE_MOCK_LATENCY_MS ?? 0) || 0;
  const faultMs = typeof latency === 'function' ? latency : () => latency ?? envLatency;
  const wrapped = async (args: string | FetchArgs, api: BaseQueryApi, extraOptions: unknown) => {
    const { method, path } = requestOf(args);
    // In flight until it answers, a fault included, for spinnersClear.
    const done = startMockRequest();
    try {
      // Logged now with deliveredAt when it will answer: failedWritesShown
      // drops a failed write the walker left before it landed.
      let ms: number | undefined;
      const delay = () => (ms ??= Math.max(0, faultMs()));
      const fault = inject(method, path, delay) as FetchBaseQueryError | undefined;
      if (!fault) return await baseQuery(args, api, extraOptions);
      onFault?.(method, path, fault);
      await wait(delay(), api?.signal);
      return { error: fault };
    } finally {
      done();
    }
  };
  return wrapped as unknown as BaseQuery;
};
