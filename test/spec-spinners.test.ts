import { test } from 'node:test';
import assert from 'node:assert/strict';
import { visibleOutside } from '../spec/dom.ts';
import { hungSince, slowOverlap, spinnerDeadline, type InjectedFault } from '../spec/faults.ts';
import { spinnerTime, type SpinnerStore } from '../spec/settled.ts';

// Just enough of an Element: a box, and `closest` against the selectors it sits inside.
const el = ({ size = 10, inside = [] as string[] } = {}) =>
  ({
    getBoundingClientRect: () => ({ width: size, height: size }),
    closest: (selector: string) => (inside.includes(selector) ? {} : null),
  }) as unknown as Element;

const modal = '[aria-labelledby="payroll-submitted-modal-title"]';

test('visibleOutside: a zero-size spinner is not visible', () => {
  assert.equal(visibleOutside([el({ size: 0 })]), false);
  assert.equal(visibleOutside([el({ size: 0 }), el()]), true);
  assert.equal(visibleOutside([]), false);
});

test('visibleOutside: a spinner inside `exclude` is ignored; one outside it still counts', () => {
  const inModal = el({ inside: [modal] });
  assert.equal(visibleOutside([inModal]), true);
  assert.equal(visibleOutside([inModal], modal), false);
  assert.equal(visibleOutside([inModal, el()], modal), true);
  assert.equal(visibleOutside([inModal, el({ size: 0 })], modal), false);
});

const t = 1_000_000;
const fault = (over: Partial<InjectedFault> = {}): InjectedFault => ({ method: 'RPC', path: 'Payroll.save', status: 500, at: t, ...over });

test('spinnerDeadline: no faults, or only errors, is `within`', () => {
  assert.equal(spinnerDeadline([], t, 15), 15_000);
  assert.equal(spinnerDeadline([fault(), fault({ kind: 'error' })], t + 100, 15), 15_000);
});

test('spinnerDeadline: any hang since the page loaded excuses the spinner (null)', () => {
  assert.equal(spinnerDeadline([fault({ kind: 'hang' })], t, 15), null);
  assert.equal(spinnerDeadline([fault({ kind: 'hang' })], t + 3_600_000, 15), null);
  assert.equal(spinnerDeadline([fault(), fault({ kind: 'slow', delayMs: 4000 }), fault({ kind: 'hang' })], t, 15), null);
});

test('spinnerDeadline: a slow fault still in flight adds its delayMs; the largest one wins', () => {
  const slow2 = fault({ kind: 'slow', delayMs: 2000 });
  const slow8 = fault({ kind: 'slow', delayMs: 8000, at: t + 500 });
  assert.equal(spinnerDeadline([slow2], t + 100, 15), 17_000);
  assert.equal(spinnerDeadline([slow2, slow8], t + 1000, 15), 23_000);
  // slow2 answered at t + 2000; slow8 still out until t + 8500
  assert.equal(spinnerDeadline([slow8, slow2], t + 3000, 15), 23_000);
});

test('spinnerDeadline: a slow fault that already answered adds nothing', () => {
  const slow = fault({ kind: 'slow', delayMs: 2000 });
  assert.equal(spinnerDeadline([slow], t + 2000, 15), 15_000);
  assert.equal(spinnerDeadline([slow], t + 10_000, 15), 15_000);
  assert.equal(spinnerDeadline([fault({ kind: 'slow' })], t, 15), 15_000);
});

// spinnerTime: one store per tab, states fed in order. A capture that shows a
// spinner is credited with the time until the next capture, wherever that is:
// the spinner was on screen until then.
test('spinnerTime: a spinner adds up on its path across visits until the path is seen without one', () => {
  const store: SpinnerStore = { paths: {} };
  assert.equal(spinnerTime(store, '/cart', true, t), 0);
  assert.equal(spinnerTime(store, '/cart', true, t + 100), 100);
  // The walker leaves at +130: /cart gets those 30ms too. The time away doesn't count.
  assert.equal(spinnerTime(store, '/', false, t + 130), 0);
  assert.equal(spinnerTime(store, '/cart', true, t + 1000), 130);
  assert.equal(spinnerTime(store, '/cart', true, t + 1150), 280);
  // Seen once without it: the page loaded, the tally starts over.
  assert.equal(spinnerTime(store, '/cart', false, t + 1200), 0);
  assert.equal(spinnerTime(store, '/cart', true, t + 2000), 0);
  assert.equal(spinnerTime(store, '/cart', true, t + 2050), 50);
});

test('spinnerTime: a visit with one capture still counts, up to the next capture', () => {
  const store: SpinnerStore = { paths: {} };
  for (let i = 0; i < 10; i++) {
    spinnerTime(store, '/cart', true, t + i * 100);
    spinnerTime(store, '/', false, t + i * 100 + 40);
  }
  assert.equal(spinnerTime(store, '/cart', true, t + 2000), 400);
});

test('spinnerTime: each path keeps its own tally', () => {
  const store: SpinnerStore = { paths: {} };
  spinnerTime(store, '/a', true, t);
  assert.equal(spinnerTime(store, '/a', true, t + 300), 300);
  assert.equal(spinnerTime(store, '/b', true, t + 330), 0);
  assert.equal(spinnerTime(store, '/b', true, t + 400), 70);
  assert.equal(spinnerTime(store, '/a', true, t + 500), 330);
  assert.equal(spinnerTime(store, '/b', false, t + 600), 0);
  assert.equal(spinnerTime(store, '/a', true, t + 700), 430);
  assert.equal(spinnerTime(store, '/a', true, t + 760), 490);
});

// spinnersClear, one capture: the tally, and whether it's a violation.
const capture = (store: SpinnerStore, key: string, spinning: boolean, now: number, faults: InjectedFault[] = [], within = 15) => {
  const ms = spinnerTime(store, key, spinning, now, faults);
  return { ms, stuck: !hungSince(faults) && ms > within * 1000 };
};

test('spinnersClear: 20s of spinner excused by a hang, then a reload into a healthy world, is not a violation', () => {
  const store: SpinnerStore = { paths: {} };
  const hung = [fault({ kind: 'hang' })];
  for (let ms = 0; ms <= 20_000; ms += 500) assert.equal(capture(store, '/certificates', true, t + ms, hung).stuck, false);
  // A full reload of the same path: __mockFaults starts over, the tally (sessionStorage) doesn't.
  const first = capture(store, '/certificates', true, t + 20_600);
  assert.equal(first.stuck, false);
  assert.equal(first.ms, 0);
  // The ordinary loading spinner: its own time counts from here.
  assert.equal(capture(store, '/certificates', true, t + 20_900).ms, 300);
});

test('spinnersClear: a stuck spinner across many short visits is still caught, hung visits between them or not', () => {
  const store: SpinnerStore = { paths: {} };
  let now = t;
  let stuck = false;
  for (let visit = 0; visit < 120 && !stuck; visit++) {
    // Every third visit is a page load in a hung world: excused, but it doesn't wipe the evidence.
    const faults = visit % 3 === 2 ? [fault({ kind: 'hang', at: now })] : [];
    capture(store, '/cart', true, now, faults);
    stuck = capture(store, '/cart', true, now + 200, faults).stuck;
    capture(store, '/', false, now + 250);
    now += 1000;
  }
  assert.equal(stuck, true);
  assert.ok(store.paths['/cart']! > 15_000);
});

test('spinnersClear: time a slow fault is in flight is not credited; the rest is', () => {
  const store: SpinnerStore = { paths: {} };
  const slow = [fault({ kind: 'slow', delayMs: 8000 })];
  capture(store, '/cart', true, t, slow);
  assert.equal(capture(store, '/cart', true, t + 8000, slow).ms, 0);
  assert.equal(capture(store, '/cart', true, t + 9000, slow).ms, 1000);
  // Visits that only ever wait on slow requests never add up.
  const other: SpinnerStore = { paths: {} };
  for (let i = 0; i < 100; i++) {
    const at = t + i * 1000;
    const f = [fault({ kind: 'slow', delayMs: 2000, at })];
    capture(other, '/orders', true, at, f);
    capture(other, '/', false, at + 300, f);
  }
  assert.equal(other.paths['/orders'] ?? 0, 0);
});

test('slowOverlap: the part of an interval slow faults were in flight, overlaps once', () => {
  const a = fault({ kind: 'slow', delayMs: 2000 });
  const b = fault({ kind: 'slow', delayMs: 2000, at: t + 1000 });
  assert.equal(slowOverlap([a], t - 1000, t + 5000), 2000);
  assert.equal(slowOverlap([a, b], t, t + 5000), 3000);
  assert.equal(slowOverlap([a, b], t + 2500, t + 5000), 500);
  assert.equal(slowOverlap([a, fault(), fault({ kind: 'hang' }), fault({ kind: 'slow' })], t + 3000, t + 5000), 0);
});

test('spinnersClear: `key` keeps one tally per query-string page', () => {
  const loc = (search: string) => ({ pathname: '/', search }) as Location;
  const byPath = (l: Location) => l.pathname;
  const bySearch = (l: Location) => l.pathname + l.search;
  // /?id=open spins briefly on each visit; /?id=closed loads fine.
  const run = (key: (l: Location) => string) => {
    const store: SpinnerStore = { paths: {} };
    for (let i = 0; i < 40; i++) {
      const at = t + i * 1000;
      capture(store, key(loc('?id=open')), true, at);
      capture(store, key(loc('?id=closed')), false, at + 500);
    }
    return capture(store, key(loc('?id=open')), true, t + 40_000).ms;
  };
  // By pathname, the healthy page's every load wipes the stuck page's tally.
  assert.equal(run(byPath), 0);
  assert.equal(run(bySearch), 20_000);
});
