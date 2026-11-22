import { test } from 'node:test';
import assert from 'node:assert/strict';
import { consoleErrorExcused, unexcusedConsoleErrors, faultInFlight, freshFailedWrite, isWriteFault, unannouncedWrite, faultLine, requestPattern, type InjectedFault, type WriteWatch } from '../spec/faults.ts';
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

test('faultInFlight: an error with `deliveredAt` excuses `grace` ms from delivery, not from `at`', () => {
  const f = fault({ deliveredAt: t + 3000 });
  assert.equal(faultInFlight([f], t + 7999), true);
  assert.equal(faultInFlight([f], t + 8000), false);
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

test('unexcusedConsoleErrors: the args of each error not excused, so the report can name and tell them apart', () => {
  const entries = [
    { level: 'error', args: [`Save failed (${INJECTED_MARKER})`] },
    { level: 'warning', args: ['not an error'] },
    { level: 'error', args: ['Warning: Each child in a list should have a unique "key" prop.'] },
    { level: 'error', args: ['Warning: Cannot update a component while rendering a different component'] },
  ];
  assert.deepEqual(unexcusedConsoleErrors(entries, [fault()], t + 100, { injected }), [
    ['Warning: Each child in a list should have a unique "key" prop.'],
    ['Warning: Cannot update a component while rendering a different component'],
  ]);
  assert.deepEqual(unexcusedConsoleErrors(entries, [fault()], t + 100), []);
  assert.equal(unexcusedConsoleErrors(entries, [], t).length, 3);
});

// unannouncedWrite: one watch per page load, states fed in order (`entry`: the history entry).
const watch = (): WriteWatch => ({ pending: [], seen: new Set() });
const line = 'POST /orders → 500';
const lineOf = (f: InjectedFault | null) => (f ? faultLine(f) : null);

test('unannouncedWrite: an alert on the page the failure landed on settles it, once per write', () => {
  const f = fault();
  // Shown in the same state: settled. A retry or Dismiss clearing it later changes nothing.
  const w = watch();
  assert.equal(unannouncedWrite(w, [f], t + 10, [], 1, true), null);
  assert.equal(unannouncedWrite(w, [f], t + 40, [], 1, false), null);
  assert.equal(unannouncedWrite(w, [f], t + 1400, [], 2, false), null);
  // Shown a few states later, still on that page: settled.
  const w2 = watch();
  assert.equal(unannouncedWrite(w2, [f], t + 10, [], 1, false), null);
  assert.equal(unannouncedWrite(w2, [f], t + 200, [], 1, true), null);
  assert.equal(unannouncedWrite(w2, [f], t + 6000, [], 3, false), null);
});

test('unannouncedWrite: leaving the page before an alert shows there is unannounced, even if the next page has one', () => {
  const w = watch();
  assert.equal(unannouncedWrite(w, [fault()], t + 10, [], 1, false), null);
  assert.equal(lineOf(unannouncedWrite(w, [fault()], t + 2010, [], 2, true)), line);
  // Reported once, not on every state after.
  assert.equal(unannouncedWrite(w, [fault()], t + 2050, [], 2, false), null);
});

test('unannouncedWrite: leaving within `leaveGrace` of the failure drops it; the app had no time to answer', () => {
  // The walker clicked away right after Save: +50ms is not a finding.
  const f = fault();
  const w = watch();
  assert.equal(unannouncedWrite(w, [f], t + 10, [], 1, false), null);
  assert.equal(unannouncedWrite(w, [f], t + 50, [], 2, false), null);
  // Dropped, not deferred: nothing is owed on the old page or the new one.
  assert.equal(unannouncedWrite(w, [f], t + 6000, [], 2, false), null);
  assert.deepEqual(w.pending, []);
  // leaveGrace is the last argument, in ms.
  const strict = watch();
  assert.equal(unannouncedWrite(strict, [f], t + 10, [], 1, false, 5000, 1500, 0), null);
  assert.equal(lineOf(unannouncedWrite(strict, [f], t + 50, [], 2, false, 5000, 1500, 0)), line);
});

test('unannouncedWrite: with `deliveredAt`, leaving before delivery drops it and leaving after reports it', () => {
  // Logged when the call started, delivered 3s later (an injected slow error).
  const f = fault({ deliveredAt: t + 3000 });
  // Leaving at +2s, before the error reached the app: dropped.
  const early = watch();
  assert.equal(unannouncedWrite(early, [f], t + 10, [], 1, false), null);
  assert.equal(unannouncedWrite(early, [f], t + 2000, [], 2, false), null);
  assert.deepEqual(early.pending, []);
  // Staying: `within` counts from delivery, so +7s is still in time and +8.1s isn't.
  const stay = watch();
  assert.equal(unannouncedWrite(stay, [f], t + 10, [], 1, false), null);
  assert.equal(unannouncedWrite(stay, [f], t + 7000, [], 1, false), null);
  assert.equal(lineOf(unannouncedWrite(stay, [f], t + 8100, [], 1, false)), line);
  // Leaving after delivery without an alert: unannounced, with no leaveGrace on top (the layer said when).
  const late = watch();
  assert.equal(unannouncedWrite(late, [f], t + 10, [], 1, false), null);
  assert.equal(unannouncedWrite(late, [f], t + 3050, [], 1, false), null);
  assert.equal(lineOf(unannouncedWrite(late, [f], t + 3100, [], 2, false)), line);
  // Delivered when logged (withFaults): leaving at +40ms is unannounced, as before leaveGrace.
  const now = fault({ deliveredAt: t });
  const quick = watch();
  assert.equal(unannouncedWrite(quick, [now], t + 10, [], 1, false), null);
  assert.equal(lineOf(unannouncedWrite(quick, [now], t + 40, [], 2, false)), line);
});

test('unannouncedWrite: with `deliveredAt`, left means no state on its page was captured after delivery', () => {
  // withFaults with 50ms latency: Save at +0, the walker clicks away at +30,
  // the next page is first captured at +60. The error landed at +50, after
  // the walker was gone, though the capture that shows it left comes later.
  const f = fault({ deliveredAt: t + 50 });
  const w = watch();
  assert.equal(unannouncedWrite(w, [f], t + 10, [], 1, false), null);
  assert.equal(unannouncedWrite(w, [f], t + 60, [], 2, false), null);
  assert.deepEqual(w.pending, []);
  // A state on its page at or after delivery: owed from then on.
  const seen = watch();
  assert.equal(unannouncedWrite(seen, [f], t + 10, [], 1, false), null);
  assert.equal(unannouncedWrite(seen, [f], t + 50, [], 1, false), null);
  assert.equal(lineOf(unannouncedWrite(seen, [f], t + 90, [], 2, false)), line);
});

test('unannouncedWrite: no alert within `within` ms on that page is unannounced', () => {
  const w = watch();
  assert.equal(unannouncedWrite(w, [fault()], t + 10, [], 1, false), null);
  assert.equal(unannouncedWrite(w, [fault()], t + 4999, [], 1, false), null);
  assert.equal(lineOf(unannouncedWrite(w, [fault()], t + 5011, [], 1, false)), line);
  assert.equal(unannouncedWrite(watch(), [fault()], t + 10, [], 1, false, 100), null);
});

test('unannouncedWrite: the page is where the failure is first seen, so a notice there counts', () => {
  // The walker moved on before the failure was logged: the next page owes the alert.
  const w = watch();
  assert.equal(unannouncedWrite(w, [], t, [], 1, false), null);
  const late = fault({ at: t + 300 });
  assert.equal(unannouncedWrite(w, [late], t + 310, [], 2, false), null);
  assert.equal(unannouncedWrite(w, [late], t + 330, [], 2, true), null);
});

test('unannouncedWrite: only fresh, unquiet error writes; each one owes its own alert', () => {
  assert.equal(unannouncedWrite(watch(), [fault()], t + 1500, [], 1, false), null);
  const quiet = watch();
  unannouncedWrite(quiet, [fault()], t + 10, [/^POST \/orders$/], 1, false);
  assert.equal(unannouncedWrite(quiet, [fault()], t + 40, [/^POST \/orders$/], 2, false), null);
  const slow = watch();
  unannouncedWrite(slow, [fault({ kind: 'slow', delayMs: 10 }), fault({ method: 'GET' })], t + 10, [], 1, false);
  assert.equal(unannouncedWrite(slow, [], t + 40, [], 2, false), null);
  const two = watch();
  const a = fault({ path: '/a' });
  const b = fault({ path: '/b', at: t + 100 });
  assert.equal(unannouncedWrite(two, [a], t + 10, [], 1, true), null);
  assert.equal(unannouncedWrite(two, [a, b], t + 110, [], 1, false), null);
  assert.equal(lineOf(unannouncedWrite(two, [a, b], t + 1200, [], 2, false)), 'POST /b → 500');
});

test('requestPattern: record segments become :id, endpoint names stay', () => {
  assert.equal(requestPattern('POST', '/orders/TEST-BASIC-ORDER/design_requests'), 'POST /orders/:id/design_requests');
  assert.equal(requestPattern('PUT', '/orders/12345/items/9'), 'PUT /orders/:id/items/:id');
  assert.equal(requestPattern('PATCH', '/users/3f9c2a10-7b1e-4c2d-9a51-0e8f6b7c2d11'), 'PATCH /users/:id');
  assert.equal(requestPattern('POST', '/orders/P12345/payment'), 'POST /orders/:id/payment');
  assert.equal(requestPattern('POST', '/api/v2/design_requests'), 'POST /api/v2/design_requests');
  assert.equal(requestPattern('DELETE', '/session'), 'DELETE /session');
  assert.equal(requestPattern('REMOTE', 'OrderController.saveOrder'), 'REMOTE OrderController.saveOrder');
});

test("failedWritesShown's snapshot: one id per endpoint and page, whatever the status or record", async () => {
  const { detailKey, detailText, findingId } = await import('../src/report/findings.ts');
  const snap = (f: InjectedFault) => [{ name: 'unannounced', value: { request: requestPattern(f.method, f.path), fault: faultLine(f) } }];
  const id = (f: InjectedFault) => findingId('app', 'failedWritesAreShown', '/orders/:orderNumber/add-artwork', detailKey(snap(f)));
  const a = fault({ path: '/orders/TEST-BASIC-ORDER/design_requests', status: 500 });
  const b = fault({ path: '/orders/TEST-ARTWORK-PENDING/design_requests', status: 'TIMEOUT_ERROR' });
  assert.equal(id(a), id(b));
  assert.notEqual(id(a), id(fault({ path: '/orders/TEST-BASIC-ORDER/payment' })));
  assert.equal(detailText(snap(a)), 'POST /orders/:id/design_requests');
});
