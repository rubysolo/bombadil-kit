import { test } from 'node:test';
import assert from 'node:assert/strict';
import { visibleOutside } from '../spec/dom.ts';
import { spinnerDeadline, type InjectedFault } from '../spec/faults.ts';

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
