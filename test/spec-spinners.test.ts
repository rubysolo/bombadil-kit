import { test } from 'node:test';
import assert from 'node:assert/strict';
import { visibleOutside } from '../spec/dom.ts';
import { spinnerDeadline, type InjectedFault } from '../spec/faults.ts';
import { spinnerStuck, spinnerTime, type SpinnerStore } from '../spec/settled.ts';

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
// spinner is credited with the time until the next capture on its page, or
// until the walker left it (`left`: when, and the busy clock then).
test('spinnerTime: a spinner adds up on its path across visits until the path is seen without one', () => {
  const store: SpinnerStore = { paths: {} };
  assert.equal(spinnerTime(store, '/cart', true, t).idle, 0);
  assert.equal(spinnerTime(store, '/cart', true, t + 100).idle, 100);
  // The walker leaves at +120 and the next capture is at +130: /cart gets 20ms more.
  assert.equal(spinnerTime(store, '/', false, t + 130, undefined, { at: t + 120 }).idle, 0);
  assert.equal(spinnerTime(store, '/cart', true, t + 1000).idle, 120);
  assert.equal(spinnerTime(store, '/cart', true, t + 1150).idle, 270);
  // Seen once without it: the page loaded, the tally starts over.
  assert.equal(spinnerTime(store, '/cart', false, t + 1200).idle, 0);
  assert.equal(spinnerTime(store, '/cart', true, t + 2000).idle, 0);
  assert.equal(spinnerTime(store, '/cart', true, t + 2050).idle, 50);
});

test('spinnerTime: a visit with one capture still counts, up to when the walker left', () => {
  const store: SpinnerStore = { paths: {} };
  for (let i = 0; i < 10; i++) {
    spinnerTime(store, '/cart', true, t + i * 100);
    spinnerTime(store, '/', false, t + i * 100 + 40, undefined, { at: t + i * 100 + 30 });
  }
  assert.equal(spinnerTime(store, '/cart', true, t + 2000).idle, 300);
});

test('spinnerTime: leaving without a known moment (a reload) credits nothing for that gap', () => {
  const store: SpinnerStore = { paths: {} };
  spinnerTime(store, '/cart', true, t);
  spinnerTime(store, '/', false, t + 500);
  assert.equal(spinnerTime(store, '/cart', true, t + 600).idle, 0);
});

test('spinnerTime: each path keeps its own tally', () => {
  const store: SpinnerStore = { paths: {} };
  spinnerTime(store, '/a', true, t);
  assert.equal(spinnerTime(store, '/a', true, t + 300).idle, 300);
  assert.equal(spinnerTime(store, '/b', true, t + 330, undefined, { at: t + 330 }).idle, 0);
  assert.equal(spinnerTime(store, '/b', true, t + 400).idle, 70);
  assert.equal(spinnerTime(store, '/a', true, t + 500, undefined, { at: t + 500 }).idle, 330);
  assert.equal(spinnerTime(store, '/b', false, t + 600, undefined, { at: t + 600 }).idle, 0);
  // Leaving /a for /b at +600 credited /a those 100ms.
  assert.equal(spinnerTime(store, '/a', true, t + 700, undefined, { at: t + 690 }).idle, 430);
  assert.equal(spinnerTime(store, '/a', true, t + 760).idle, 490);
});

// `busy`: ms mock requests have been in flight since the page loaded (window.__mockBusyMs).
test('spinnerTime: a request in flight until the walker leaves (then aborted) credits nothing', () => {
  const store: SpinnerStore = { paths: {} };
  let busy = 0;
  for (let i = 0; i < 50; i++) {
    const at = t + i * 100;
    spinnerTime(store, '/reviews/1', true, at, busy);
    // In flight 40ms; the walker leaves at +40 (busy then: +40), the abort lands, idle until the next capture at +55.
    spinnerTime(store, '/products/1', false, at + 55, busy + 40, { at: at + 40, busy: busy + 40 });
    busy += 40;
  }
  assert.equal(spinnerTime(store, '/reviews/1', true, t + 6000, busy).idle, 0);
});

test('spinnerTime: a stuck spinner: each action starts a 50ms request, the idle rest counts', () => {
  const store: SpinnerStore = { paths: {} };
  let b = 0;
  spinnerTime(store, '/cart', true, t, b);
  for (let i = 1; i <= 10; i++) {
    b += 50;
    spinnerTime(store, '/cart', true, t + i * 300, b);
  }
  assert.equal(spinnerTime(store, '/cart', true, t + 3000, b).idle, 2500);
  // Leaving after 200ms idle: those count; the next page's request after it doesn't.
  spinnerTime(store, '/', false, t + 3300, b + 60, { at: t + 3200, busy: b });
  assert.equal(spinnerTime(store, '/cart', true, t + 4000, b + 60).idle, 2700);
});

test('spinnerTime: without a busy count, every second on the page counts', () => {
  const store: SpinnerStore = { paths: {} };
  spinnerTime(store, '/cart', true, t);
  assert.equal(spinnerTime(store, '/cart', true, t + 300).idle, 300);
});

test('spinnerTime: a reload of the same path is a new page load: the gap across it credits nothing', () => {
  const store: SpinnerStore = { paths: {} };
  spinnerTime(store, '/reviews/1', true, t, 0, undefined, 1);
  assert.equal(spinnerTime(store, '/reviews/1', true, t + 400, 0, undefined, 2).idle, 0);
  assert.equal(spinnerTime(store, '/reviews/1', true, t + 500, 0, undefined, 2).idle, 100);
});

test('spinnerTime: a hang excuses its interval; a reload into a healthy world starts from zero (no busy clock)', () => {
  // A layer that reports faults on __mockFaults but doesn't count requests in flight.
  const store: SpinnerStore = { paths: {} };
  for (let i = 0; i <= 200; i++) spinnerTime(store, '/cart', true, t + i * 100, undefined, undefined, 1, true);
  // The reload: a new page load, a fresh __mockFaults, no hang.
  spinnerTime(store, '/cart', true, t + 20000, undefined, undefined, 2);
  const tally = spinnerTime(store, '/cart', true, t + 20100, undefined, undefined, 2);
  assert.deepEqual(tally, { idle: 100, on: 100 });
  assert.equal(spinnerStuck(tally, 15000), false);
});

test('spinnerTime: `on` is all the spinner time, `idle` the part with nothing in flight', () => {
  // The abandoned slow request: lots of spinner, almost none of it idle.
  const slow: SpinnerStore = { paths: {} };
  let busy = 0;
  for (let i = 0; i < 50; i++) {
    const at = t + i * 100;
    spinnerTime(slow, '/reviews/1', true, at, busy);
    spinnerTime(slow, '/products/1', false, at + 55, busy + 38, { at: at + 40, busy: busy + 38 });
    busy += 38;
  }
  const r = spinnerTime(slow, '/reviews/1', true, t + 6000, busy);
  assert.equal(r.on, 2000);
  assert.equal(r.idle, 100);
  // The stuck one: most of it idle.
  const stuck: SpinnerStore = { paths: {} };
  let b = 0;
  spinnerTime(stuck, '/cart', true, t, b);
  for (let i = 1; i <= 10; i++) {
    b += 50;
    spinnerTime(stuck, '/cart', true, t + i * 300, b);
  }
  assert.deepEqual(spinnerTime(stuck, '/cart', true, t + 3000, b), { idle: 2500, on: 3000 });
});

test('spinnerStuck: enough idle time, and most of the spinner time idle', () => {
  assert.equal(spinnerStuck({ idle: 2500, on: 3000 }, 1000), true);
  assert.equal(spinnerStuck({ idle: 900, on: 1000 }, 1000), false); // not enough evidence yet
  assert.equal(spinnerStuck({ idle: 100, on: 2000 }, 50), false); // waiting on requests: not stuck, however long
  assert.equal(spinnerStuck({ idle: 1200, on: 2000 }, 1000, 0.5), true);
  assert.equal(spinnerStuck({ idle: 1200, on: 3000 }, 1000, 0.5), false);
  assert.equal(spinnerStuck({ idle: 2000, on: 2000 }, null), false); // a hang excuses it
});
