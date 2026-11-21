// Type-level: `npm run typecheck` fails if withFaults stops passing its
// baseQuery's types through. node runs it as an ordinary (trivial) test.
import { test } from 'node:test';
import { createApi, type BaseQueryError, type BaseQueryFn, type FetchArgs, type FetchBaseQueryError } from '@reduxjs/toolkit/query';
import { withFaults } from '../src/app/rtk.ts';

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const check = <T extends true>() => undefined as unknown as T;

const mockBaseQuery: BaseQueryFn<string | FetchArgs, unknown, FetchBaseQueryError> = async () => ({ data: [] });

test('withFaults inline in createApi keeps the baseQuery types (error is FetchBaseQueryError, not unknown)', () => {
  const api = createApi({
    baseQuery: withFaults(mockBaseQuery, {}),
    endpoints: (b) => ({ items: b.query<string[], void>({ query: () => '/items' }) }),
  });
  type BQ = typeof api.endpoints.items.Types.BaseQuery;
  check<Same<BaseQueryError<BQ>, FetchBaseQueryError>>();
  check<Same<Parameters<BQ>[0], string | FetchArgs>>();
});
