import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshApiCalls, type ApiWindow } from '../spec/api.ts';

test('freshApiCalls: only the calls since the last state; the inventory once per document', () => {
  const win: ApiWindow = {
    __mockCalls: [{ key: 'OrderController.getOrder', variant: 'locked', outcome: 'ok', at: 1 }],
    __mockEndpoints: [{ key: 'OrderController.getOrder', variants: ['default', 'locked'] }, { key: 'OrderController.save', variants: [] }],
  };
  assert.deepEqual(freshApiCalls(win), {
    calls: [{ key: 'OrderController.getOrder', variant: 'locked', outcome: 'ok' }],
    inventory: [{ key: 'OrderController.getOrder', variants: ['default', 'locked'] }, { key: 'OrderController.save', variants: [] }],
  });
  assert.deepEqual(freshApiCalls(win), { calls: [] });
  win.__mockCalls!.push({ key: 'OrderController.save', outcome: 'hang', at: 2 }, { key: 'OrderController.save', outcome: 'error', at: 3 });
  assert.deepEqual(freshApiCalls(win), {
    calls: [
      { key: 'OrderController.save', outcome: 'hang' },
      { key: 'OrderController.save', outcome: 'error' },
    ],
  });
});

test('freshApiCalls: no mock layer is no calls; one that replaces its array starts over', () => {
  const win: ApiWindow = {};
  assert.deepEqual(freshApiCalls(win), { calls: [] });
  win.__mockCalls = [{ key: 'GET /a', outcome: 'ok', at: 1 }, { key: 'GET /b', outcome: 'ok', at: 2 }];
  assert.equal(freshApiCalls(win).calls.length, 2);
  win.__mockCalls = [{ key: 'GET /c', outcome: 'slow', at: 3 }];
  assert.deepEqual(freshApiCalls(win).calls, [{ key: 'GET /c', outcome: 'slow' }]);
  // An inventory that shows up after the first state is still sent, once.
  win.__mockEndpoints = [{ key: 'GET /c', variants: [] }];
  assert.ok(freshApiCalls(win).inventory);
  assert.equal(freshApiCalls(win).inventory, undefined);
});

test('freshApiCalls: a capped log with seq loses nothing', () => {
  const win: ApiWindow = { __mockCalls: [] };
  let seq = 0;
  const log = (key: string) => {
    win.__mockCalls!.push({ key, outcome: 'ok', at: seq, seq: ++seq });
    if (win.__mockCalls!.length > 3) win.__mockCalls!.shift();
  };
  const read = () => freshApiCalls(win).calls.map((c) => c.key);
  log('a'); log('b'); log('c');
  assert.deepEqual(read(), ['a', 'b', 'c']);
  // Past the cap the length stays 3; the length rule would skip these.
  log('d'); log('e');
  assert.deepEqual(read(), ['d', 'e']);
  assert.deepEqual(read(), []);
  log('f'); log('g'); log('h'); log('i');
  // More than the cap between two states: the one shifted out is gone, the rest arrive.
  assert.deepEqual(read(), ['g', 'h', 'i']);
  // A log whose seq starts over (a new array, a new counter) starts over.
  win.__mockCalls = [{ key: 'z', outcome: 'ok', at: 0, seq: 1 }];
  assert.deepEqual(read(), ['z']);
});

test('freshApiCalls: without seq, a log that only grows is read by length', () => {
  const win: ApiWindow = { __mockCalls: [{ key: 'a', outcome: 'ok', at: 1 }] };
  assert.equal(freshApiCalls(win).calls.length, 1);
  win.__mockCalls!.push({ key: 'b', outcome: 'ok', at: 2 }, { key: 'c', outcome: 'ok', at: 3 });
  assert.deepEqual(freshApiCalls(win).calls.map((c) => c.key), ['b', 'c']);
  assert.deepEqual(freshApiCalls(win).calls, []);
});
