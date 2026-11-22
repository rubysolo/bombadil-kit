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

export type ApiWindow = { __mockCalls?: MockCall[]; __mockEndpoints?: MockEndpoint[]; __fuzzApi?: { seen: number; inventory: boolean; seq?: number } };

/** What `win`'s mock layer has logged since the last call, as an ApiSnapshot. Keeps its place on `win`. */
export const freshApiCalls = (win: ApiWindow): ApiSnapshot => {
  const mark = (win.__fuzzApi ??= { seen: 0, inventory: false });
  const all = win.__mockCalls ?? [];
  const last = all.at(-1)?.seq;
  let start: number;
  if (typeof last === 'number') {
    // seq: the calls after the last one read, wherever they sit, so a log
    // capped at a fixed length (push, then shift) still loses nothing.
    // A seq that went back means a new log: start over.
    if (mark.seq === undefined || last < mark.seq) mark.seq = 0;
    start = all.length;
    while (start > 0 && (all[start - 1]!.seq ?? 0) > mark.seq) start--;
    mark.seq = last;
  } else {
    // No seq: the log must only grow. One that replaced its array starts over.
    if (all.length < mark.seen) mark.seen = 0;
    start = mark.seen;
  }
  const calls = all.slice(start).map(({ key, variant, outcome }) => (variant === undefined ? { key, outcome } : { key, variant, outcome }));
  mark.seen = all.length;
  const out: ApiSnapshot = { calls };
  if (!mark.inventory && win.__mockEndpoints) {
    mark.inventory = true;
    out.inventory = win.__mockEndpoints.map(({ key, variants }) => ({ key, variants: [...(variants ?? [])] }));
  }
  return out;
};
