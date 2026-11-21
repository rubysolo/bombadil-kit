import { test } from 'node:test';
import assert from 'node:assert/strict';
import { consoleErrorExcused, faultInFlight, freshFailedWrite, isWriteFault, type InjectedFault } from '../spec/faults.ts';
import { FAULTS, INJECTED_MARKER } from '../src/app/faults.ts';

const t = 1_000_000;
const fault = (over: Partial<InjectedFault> = {}): InjectedFault => ({ method: 'POST', path: '/orders', status: 500, at: t, ...over });

test('isWriteFault: `write` when set, else anything but GET', () => {
  assert.equal(isWriteFault(fault()), true);
  assert.equal(isWriteFault(fault({ method: 'GET' })), false);
  assert.equal(isWriteFault(fault({ write: false })), false);
  assert.equal(isWriteFault(fault({ method: 'GET', write: true })), true);
  assert.equal(isWriteFault(fault({ method: 'RPC', path: 'OrderController.save', write: true })), true);
});

test('freshFailedWrite: write: false on a POST is ignored; write: true on a GET counts', () => {
  assert.equal(freshFailedWrite([fault({ write: false })], t + 100), undefined);
  const read = fault({ method: 'GET', path: 'OrderController.save', write: true });
  assert.equal(freshFailedWrite([read], t + 100), read);
});

test('freshFailedWrite: only fresh, unquiet error faults; kind absent is an error', () => {
  assert.ok(freshFailedWrite([fault()], t + 100));
  assert.ok(freshFailedWrite([fault({ kind: 'error' })], t + 100));
  assert.equal(freshFailedWrite([fault()], t + 1500), undefined);
  assert.equal(freshFailedWrite([fault()], t + 100, [/^POST \/orders$/]), undefined);
  assert.equal(freshFailedWrite([fault({ method: 'GET' })], t + 100), undefined);
});

test('freshFailedWrite: slow and hang writes never trigger', () => {
  const slow = fault({ kind: 'slow', delayMs: 4000 });
  const hang = fault({ kind: 'hang' });
  for (const now of [t, t + 100, t + 1000]) {
    assert.equal(freshFailedWrite([slow, hang], now), undefined);
    assert.equal(freshFailedWrite([fault({ kind: 'slow', write: true, method: 'GET' })], now), undefined);
  }
  const error = fault({ path: '/payments' });
  assert.equal(freshFailedWrite([slow, hang, error], t + 100), error);
});

test('faultInFlight: an error for `grace` ms; checks every fault, not only the last', () => {
  assert.equal(faultInFlight([], t), false);
  assert.equal(faultInFlight([fault()], t + 4999), true);
  assert.equal(faultInFlight([fault()], t + 5000), false);
  assert.equal(faultInFlight([fault()], t + 1500, 1000), false);
  assert.equal(faultInFlight([fault({ at: t + 3000 }), fault({ at: t })], t + 4000, 2000), true);
});

test('faultInFlight: a slow one until at + delayMs + grace', () => {
  const slow = fault({ kind: 'slow', delayMs: 8000 });
  assert.equal(faultInFlight([slow], t + 12_999), true);
  assert.equal(faultInFlight([slow], t + 13_000), false);
  assert.equal(faultInFlight([fault({ kind: 'slow' })], t + 5000), false);
});

test('faultInFlight: a hang like an error, for hangGrace (default grace) after at, not for the rest of the page', () => {
  const hang = fault({ kind: 'hang' });
  assert.equal(faultInFlight([hang], t + 4999), true);
  assert.equal(faultInFlight([hang], t + 5000), false);
  assert.equal(faultInFlight([hang], t + 60_000), false);
  assert.equal(faultInFlight([hang], t + 20_000, 5000, 30_000), true);
  assert.equal(faultInFlight([hang], t + 30_000, 5000, 30_000), false);
  assert.equal(faultInFlight([hang], t + 1500, 1000), false);
});

const injected = new RegExp(INJECTED_MARKER);

test('consoleErrorExcused: with `injected`, an error carrying the marker is excused, whenever it lands', () => {
  const args = [`Save failed: {"status":500,"data":{"error":"Internal Server Error (${INJECTED_MARKER})"}}`];
  assert.equal(consoleErrorExcused(args, [fault()], t + 100, { injected }), true);
  assert.equal(consoleErrorExcused(args, [], t, { injected }), true);
  assert.equal(consoleErrorExcused(args, [fault()], t + 60_000, { injected }), true);
});

test('consoleErrorExcused: with `injected`, an error near a fault without the marker is not excused', () => {
  const react = ['Warning: Cannot update a component while rendering a different component'];
  assert.equal(consoleErrorExcused(react, [fault()], t + 100, { injected }), false);
  assert.equal(consoleErrorExcused(react, [fault({ kind: 'hang' })], t + 100, { injected }), false);
  assert.equal(consoleErrorExcused([], [fault()], t + 100, { injected }), false);
});

test('consoleErrorExcused: `injected` also matches the raw args, for apps without installFuzzConsole', () => {
  const raw = ['Save failed', { status: 'FETCH_ERROR', error: `TypeError: Failed to fetch (${INJECTED_MARKER})` }];
  assert.equal(consoleErrorExcused(raw, [], t, { injected }), true);
  // What Bombadil hands the spec for console.error('Save failed', err): the object's class name.
  assert.equal(consoleErrorExcused(['Save failed', 'Object'], [fault()], t + 100, { injected }), false);
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  assert.equal(consoleErrorExcused(['oops', circular], [fault()], t, { injected }), false);
});

test('consoleErrorExcused: a global `injected` regex gives the same answer every time', () => {
  const g = new RegExp(INJECTED_MARKER, 'g');
  for (let i = 0; i < 3; i++) assert.equal(consoleErrorExcused([`x ${INJECTED_MARKER}`], [], t, { injected: g }), true);
});

test('consoleErrorExcused: without `injected`, the old timing excuse', () => {
  const react = ['Warning: something unrelated'];
  assert.equal(consoleErrorExcused(react, [fault()], t + 4999), true);
  assert.equal(consoleErrorExcused(react, [fault()], t + 5000), false);
  assert.equal(consoleErrorExcused(react, [fault()], t + 1500, { grace: 1000 }), false);
  assert.equal(consoleErrorExcused(react, [fault({ kind: 'hang' })], t + 20_000, { hangGrace: 30_000 }), true);
  assert.equal(consoleErrorExcused([`x ${INJECTED_MARKER}`], [], t), false);
});

test('the built-in faults carry INJECTED_MARKER, so `injected` excuses each of them', () => {
  for (const f of FAULTS) assert.match(JSON.stringify(f), injected, `status ${String(f.status)}`);
});
