/**
 * bombadil-kit/rtk: fault injection for RTK Query.
 *
 *   import { withFaults } from 'bombadil-kit/rtk';
 *   const baseQuery = withFaults(mockBaseQuery, import.meta.env, { spare: [/^\/mock\//, /^\/translations/] });
 *
 * Wraps any baseQuery (a custom mock one, or fetchBaseQuery). Without
 * VITE_MOCK_FAULT_RATE in `env` it returns `baseQuery` itself, so it costs
 * nothing outside the fuzzer. Pass the app's `import.meta.env`: Vite only
 * fills that in in the app's own code, not in a dependency.
 */
import type { BaseQueryApi, BaseQueryFn, FetchArgs, FetchBaseQueryError } from '@reduxjs/toolkit/query';
import { createFaultInjector, parseFaultConfig } from './faults.ts';

export interface WithFaultsOptions {
  /** Paths never to fail. Default: /^\/mock\// (the mock's control API). */
  spare?: RegExp[];
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

export const withFaults = <Args extends string | FetchArgs, Result, ExtraOptions, Meta>(
  baseQuery: BaseQueryFn<Args, Result, FetchBaseQueryError, ExtraOptions, Meta>,
  env: Record<string, unknown>,
  { spare, onFault }: WithFaultsOptions = {},
): BaseQueryFn<Args, Result, FetchBaseQueryError, ExtraOptions, Meta> => {
  const config = parseFaultConfig(env);
  if (!config) return baseQuery;
  const inject = createFaultInjector({ ...config, ...(spare ? { spare } : {}) });
  return (args: Args, api: BaseQueryApi, extraOptions: ExtraOptions) => {
    const { method, path } = requestOf(args);
    const fault = inject(method, path) as FetchBaseQueryError | undefined;
    if (fault) {
      onFault?.(method, path, fault);
      return { error: fault };
    }
    return baseQuery(args, api, extraOptions);
  };
};
