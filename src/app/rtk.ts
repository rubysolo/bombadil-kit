/**
 * bombadil-kit/rtk: fault injection for RTK Query.
 *
 *   import { withFaults } from 'bombadil-kit/rtk';
 *   const baseQuery = withFaults(mockBaseQuery, import.meta.env, { spare: [/^\/mock\//, /^\/translations/] });
 *
 * Wraps any baseQuery (a custom mock one, or fetchBaseQuery). In fuzz mode
 * (VITE_MOCK_FAULT_RATE set, `0` included) it fails that share of requests
 * and counts the rest in flight (startMockRequest), for spinnersClear.
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
}

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
  { spare, isWrite, onFault }: WithFaultsOptions = {},
): BaseQuery => {
  // Fuzz mode: the runner always sets the rate, `0` included. Off it, nothing is wrapped.
  if (env.VITE_MOCK_FAULT_RATE === undefined || env.VITE_MOCK_FAULT_RATE === '') return baseQuery;
  // At rate 0 it fails nothing, but still logs every call (__mockCalls) for flow milestones.
  const config = parseFaultConfig(env) ?? { rate: 0, seed: 1 };
  // It answers with the fault right here, so the fault is delivered when logged.
  const inject = createFaultInjector({ ...config, delivered: true, ...(spare ? { spare } : {}), ...(isWrite ? { isWrite } : {}) });
  const wrapped = async (args: string | FetchArgs, api: BaseQueryApi, extraOptions: unknown) => {
    const { method, path } = requestOf(args);
    const fault = inject(method, path) as FetchBaseQueryError | undefined;
    if (fault) {
      onFault?.(method, path, fault);
      return { error: fault };
    }
    // In flight until it answers, for spinnersClear.
    const done = startMockRequest();
    try {
      return await baseQuery(args, api, extraOptions);
    } finally {
      done();
    }
  };
  return wrapped as unknown as BaseQuery;
};
