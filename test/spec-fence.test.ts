import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inFence } from '../spec/fence.ts';

const FENCE = ['/products/*', '/cart', '/orders/*'];

test('inFence: exact paths and * prefixes', () => {
  assert.equal(inFence(FENCE, '/cart'), true);
  assert.equal(inFence(FENCE, '/products/1'), true);
  assert.equal(inFence(FENCE, '/orders/'), true);
  assert.equal(inFence(FENCE, '/cart/extra'), false);
  assert.equal(inFence(FENCE, '/checkout'), false);
  assert.equal(inFence(FENCE, '/'), false);
});

test('inFence: a query or hash on the path is ignored', () => {
  assert.equal(inFence(FENCE, '/cart?coupon=X'), true);
  assert.equal(inFence(FENCE, '/cart#top'), true);
  assert.equal(inFence(FENCE, '/checkout?from=/cart'), false);
});

test('inFence: no fence lets every path in', () => {
  assert.equal(inFence(null, '/anywhere'), true);
  assert.equal(inFence(undefined, '/anywhere'), true);
  assert.equal(inFence([], '/anywhere'), true);
});
