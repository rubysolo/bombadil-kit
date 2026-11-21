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
