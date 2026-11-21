// The pure half of apiCalls: no Bombadil imports, so node can test it.
// spec/index.ts calls it inside `extract`. `import type` is erased, so the
// bundle Bombadil runs in the page doesn't pull in the app-side module.
import type { CallOutcome, MockCall, MockEndpoint } from '../src/app/faults.ts';

export type { CallOutcome, MockCall, MockEndpoint } from '../src/app/faults.ts';

/** The `api` snapshot: calls since the last state, and the inventory on a document's first state. */
export type ApiSnapshot = {
  calls: { key: string; variant?: string; outcome: CallOutcome }[];
  inventory?: { key: string; variants: string[] }[];
};

export type ApiWindow = { __mockCalls?: MockCall[]; __mockEndpoints?: MockEndpoint[]; __fuzzApi?: { seen: number; inventory: boolean } };

/** What `win`'s mock layer has logged since the last call, as an ApiSnapshot. Keeps its place on `win`. */
export const freshApiCalls = (win: ApiWindow): ApiSnapshot => {
  const mark = (win.__fuzzApi ??= { seen: 0, inventory: false });
  const all = win.__mockCalls ?? [];
  // A mock layer that replaced its array starts over.
  if (all.length < mark.seen) mark.seen = 0;
  const calls = all.slice(mark.seen).map(({ key, variant, outcome }) => (variant === undefined ? { key, outcome } : { key, variant, outcome }));
  mark.seen = all.length;
  const out: ApiSnapshot = { calls };
  if (!mark.inventory && win.__mockEndpoints) {
    mark.inventory = true;
    out.inventory = win.__mockEndpoints.map(({ key, variants }) => ({ key, variants: [...(variants ?? [])] }));
  }
  return out;
};
