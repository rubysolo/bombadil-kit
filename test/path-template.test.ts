import { test } from 'node:test';
import assert from 'node:assert/strict';
import { endpointOf, templateOf } from '../src/path-template.ts';

test('templateOf: record segments become :id, endpoint names stay', () => {
  const cases: [string, string][] = [
    ['/orders/1187/store', '/orders/:id/store'],
    ['/orders/ORD12345', '/orders/:id'],
    ['/orders/P12345/payment', '/orders/:id/payment'],
    ['/orders/P12', '/orders/:id'],
    ['/orders/TEST-BASIC-ORDER/design_requests', '/orders/:id/design_requests'],
    ['/orders/ACTIVE-STORE/team-detail', '/orders/:id/team-detail'],
    ['/users/3f9c2a10-7b1e-4c2d-9a51-0e8f6b7c2d11', '/users/:id'],
    ['/users/3F9C2A10-7B1E-4C2D-9A51-0E8F6B7C2D11', '/users/:id'],
    ['/files/a8f3c9e1d2', '/files/:id'],
    ['/runs/01hgw2bbg0000000000000000', '/runs/:id'],
    ['/orders/order-12345', '/orders/:id'],
    // Not records: a lowercase word with a short number, one capitalised word.
    ['/api/oauth2/token', '/api/oauth2/token'],
    ['/api/v2/design_requests', '/api/v2/design_requests'],
    ['/text/utf8', '/text/utf8'],
    ['/buckets/s3', '/buckets/s3'],
    ['/admin/version10', '/admin/version10'],
    ['/API/orders', '/API/orders'],
    ['/export/CSV', '/export/CSV'],
    ['/cart', '/cart'],
    ['/', '/'],
  ];
  for (const [path, want] of cases) assert.equal(templateOf(path, []), want, path);
});

test('templateOf: the first known template that matches wins', () => {
  const known = ['/orders/:orderNumber/prepare-store', '/orders/*', '/login'];
  assert.equal(templateOf('/orders/ACTIVE-STORE/prepare-store', known), '/orders/:orderNumber/prepare-store');
  assert.equal(templateOf('/orders/oauth2', known), '/orders/*');
  assert.equal(templateOf('/login', known), '/login');
  // Same segment count only: a template names a whole path.
  assert.equal(templateOf('/orders/1187/store/x', known), '/orders/:id/store/x');
});

test('templateOf: query and fragment are dropped', () => {
  assert.equal(templateOf('/orders/1187?tab=2#top', []), '/orders/:id');
  assert.equal(templateOf('/login?next=/orders/1187', ['/login']), '/login');
  assert.equal(templateOf('?x=1', []), '/');
});

test("templateOf: a key that isn't a path is kept as it is", () => {
  assert.equal(templateOf('OrderController.saveOrder', []), 'OrderController.saveOrder');
});

test('endpointOf: the inventory for that method first, else blurred', () => {
  const endpoints = ['GET /orders/:orderNumber', 'POST /orders/:orderNumber/design_requests', 'DELETE /cart/:id'];
  assert.equal(endpointOf('POST', '/orders/TEST-BASIC-ORDER/design_requests', endpoints), 'POST /orders/:orderNumber/design_requests');
  assert.equal(endpointOf('PUT', '/orders/TEST-BASIC-ORDER/design_requests', endpoints), 'PUT /orders/:id/design_requests');
  assert.equal(endpointOf('GET', '/orders/ORD1?x=1', endpoints), 'GET /orders/:orderNumber');
  assert.equal(endpointOf('POST', '/api/oauth2/token', []), 'POST /api/oauth2/token');
});
