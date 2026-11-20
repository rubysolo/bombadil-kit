import { test } from 'node:test';
import assert from 'node:assert/strict';
import { faultInFlight, freshFailedWrite, isWriteFault, type InjectedFault } from '../spec/faults.ts';

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
  assert.equal(faultInFlight([fault({ kind: 'hang' }), fault({ at: t + 10 })], t + 60_000), true);
});

test('faultInFlight: a slow one until at + delayMs + grace; a hang indefinitely', () => {
  const slow = fault({ kind: 'slow', delayMs: 8000 });
  assert.equal(faultInFlight([slow], t + 12_999), true);
  assert.equal(faultInFlight([slow], t + 13_000), false);
  assert.equal(faultInFlight([fault({ kind: 'slow' })], t + 5000), false);
  assert.equal(faultInFlight([fault({ kind: 'hang' })], t + 3_600_000), true);
});
