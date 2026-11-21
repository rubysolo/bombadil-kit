import { test } from 'node:test';
import assert from 'node:assert/strict';
import { visibleOutside } from '../spec/dom.ts';
import { spinnerDeadline, type InjectedFault } from '../spec/faults.ts';
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
