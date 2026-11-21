import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeAction, detailKey, detailText, findingId, routeTemplate } from '../src/report/findings.ts';
import { readRun } from '../src/report/runs.ts';
import { always, calling, reaching, rendering, row, timedOut, tmp, writeRun } from './helpers.ts';

test('routeTemplate prefers a known route pattern', () => {
  const known = ['/orders/:orderNumber/prepare-store', '/login'];
  assert.equal(routeTemplate('http://h/orders/ACTIVE-STORE/prepare-store#', known), '/orders/:orderNumber/prepare-store');
  assert.equal(routeTemplate('http://h/login?next=1', known), '/login');
});

test('routeTemplate falls back to replacing ids and order numbers', () => {
  assert.equal(routeTemplate('http://h/orders/1187/store', []), '/orders/:id/store');
  assert.equal(routeTemplate('http://h/orders/ORD12345', []), '/orders/:n');
  assert.equal(routeTemplate('http://h/orders/ACTIVE-STORE/team-detail#', []), '/orders/:n/team-detail');
  assert.equal(routeTemplate('http://h/', []), '/');
});

test('detailKey takes the first string in the snapshots, with digits blurred', () => {
  assert.equal(
    detailKey([{ name: 'freshFailedWrite', value: 'PUT /orders/1187/store → 422' }]),
    'PUT /orders/#/store → #',
  );
  assert.equal(
    detailKey([
      { name: 'faultInFlight', value: false },
      { name: 'consoleErrors', value: [['Warning: Maximum update depth exceeded.', 'x']] },
    ]),
    'Warning: Maximum update depth exceeded.',
  );
  // Only the message line: a stack the app appends (fuzz mode) must not split
  // one bug's id from its history, or change when the code moves a line.
  assert.equal(
    detailKey([{ name: 'consoleErrors', value: [['Warning: Maximum update depth exceeded.\n    at Looper (/src/pages/X.tsx:17:45)']] }]),
    'Warning: Maximum update depth exceeded.',
  );
  // A number (overflow px) is a measurement, not an identity.
  assert.equal(detailKey([{ name: 'horizontalOverflow', value: 76 }]), '');
});

test('detailText keeps a message and the stack the app appended under it', () => {
  const message = 'Warning: Maximum update depth exceeded. ' + 'x'.repeat(200);
  const frames = Array.from({ length: 8 }, (_, i) => `    at fn${i} (http://h/node_modules/.vite/deps/lib.js:${i}:1)`);
  const text = detailText([{ name: 'consoleErrors', value: [[[message, ...frames].join('\n')]] }]);
  assert.ok(text.endsWith('lib.js:7:1)'), 'every frame survives');
});

test('findingId is stable and short', () => {
  const a = findingId('web', 'spinnersSettle', '/cart', '');
  assert.match(a, /^F-[0-9a-f]{6}$/);
  assert.equal(a, findingId('web', 'spinnersSettle', '/cart', ''));
  assert.notEqual(a, findingId('admin', 'spinnersSettle', '/cart', ''));
});

test('describeAction gives a short human line for each action kind', () => {
  assert.equal(describeAction(null), 'start');
  assert.equal(describeAction('Back'), 'back');
  assert.equal(
    describeAction({ Click: { fingerprint: { tag: 'button', text_content: 'SIGN IN' }, point: { x: 1, y: 2 } } }),
    'click button "SIGN IN"',
  );
  assert.equal(describeAction({ Click: { fingerprint: { tag: 'input', name_attr: 'email' }, point: { x: 1, y: 2 } } }), 'click input[name=email]');
  assert.equal(describeAction({ Custom: { name: 'fillPlausible', arguments: [2] } }), 'fillPlausible(2)');
  assert.equal(describeAction({ TypeText: { text: 'abc' } }), 'type 3 chars');
  assert.equal(describeAction({ ScrollDown: { distance: 422 } }), 'scroll down 422px');
  assert.equal(describeAction({ PressKey: { code: 13 } }), 'press key 13');
});

test('readRun groups repeated violations of one bug into one finding', () => {
  const root = tmp();
  const write = (i: number) => timedOut('failedWritesAreShown', [{ name: 'freshFailedWrite', value: `PUT /orders/11${i}/store → 422` }]);
  const dir = writeRun(root, {
    id: 'r1',
    rows: [
      row(0, '/login', null),
      row(1, '/dashboard', { Click: { fingerprint: { tag: 'button', text_content: 'SIGN IN' } } }),
      row(2, '/orders/ACTIVE-STORE/prepare-store', { Click: { fingerprint: { tag: 'a', text_content: 'PREPARE' } } }),
      row(3, '/orders/ACTIVE-STORE/prepare-store', 'Wait', [write(1)]),
      row(4, '/orders/ACTIVE-STORE/prepare-store', 'Wait', [write(2)]),
      row(5, '/login', 'Back', [always('noHorizontalOverflow', [{ name: 'horizontalOverflow', value: 76 }])]),
    ],
  });

  const run = readRun(dir, ['/orders/:orderNumber/prepare-store', '/login', '/dashboard']);
  assert.equal(run.meta.project, 'web');
  assert.equal(run.actions, 5);
  assert.deepEqual(run.routes, { '/login': 2, '/dashboard': 1, '/orders/:orderNumber/prepare-store': 3 });
  assert.equal(run.findings.length, 2);

  const write1 = run.findings.find((f) => f.property === 'failedWritesAreShown')!;
  assert.equal(write1.route, '/orders/:orderNumber/prepare-store');
  assert.equal(write1.detail, 'PUT /orders/#/store → #');
  assert.equal(write1.count, 2);
  assert.equal(write1.summary, 'PUT /orders/111/store → 422');
  // The actions that led to the first violation, oldest first, ending with it.
  assert.deepEqual(write1.steps.map((s) => s.action), ['start', 'click button "SIGN IN"', 'click a "PREPARE"', 'wait']);
  assert.equal(write1.frames.length, 3);
  assert.ok(write1.frames.at(-1)!.endsWith('.jpeg'));

  const overflow = run.findings.find((f) => f.property === 'noHorizontalOverflow')!;
  assert.equal(overflow.detail, '');
  assert.equal(overflow.route, '/login');
});

test('readRun collects every source file the run rendered', () => {
  const dir = writeRun(tmp(), {
    id: 'r1',
    flow: 'deposit',
    rows: [
      rendering(row(0, '/login', null), ['apps/a/src/App.tsx', 'apps/a/src/pages/Login.tsx']),
      rendering(row(1, '/dashboard', 'Wait'), []),
      rendering(row(2, '/dashboard', 'Wait'), ['apps/a/src/pages/Dashboard.tsx', 'apps/a/src/App.tsx']),
    ],
  });
  const run = readRun(dir, []);
  assert.equal(run.meta.flow, 'deposit');
  assert.deepEqual(run.rendered, ['apps/a/src/App.tsx', 'apps/a/src/pages/Dashboard.tsx', 'apps/a/src/pages/Login.tsx']);
});

test('readRun counts the mock API calls per endpoint and outcome, with the variants seen and the inventory', () => {
  const inventory = [
    { key: 'OrderController.getOrder', variants: ['default', 'locked'] },
    { key: 'OrderController.save', variants: [] },
    { key: 'GET /orders/:orderNumber', variants: [] },
  ];
  const dir = writeRun(tmp(), {
    id: 'r1',
    rows: [
      calling(row(0, '/orders', null), [{ key: 'OrderController.getOrder', variant: 'locked', outcome: 'ok' }], inventory),
      calling(row(1, '/orders', 'Wait'), [
        { key: 'OrderController.getOrder', variant: 'default', outcome: 'slow' },
        { key: 'OrderController.getOrder', variant: 'locked', outcome: 'ok' },
        { key: 'GET /orders/1001', outcome: 'error' },
        { key: 'GET /orders/1002?full=1', outcome: 'ok' },
        { key: 'POST /carts/42/items', outcome: 'ok' },
      ]),
      row(2, '/orders', 'Wait'),
    ],
  });
  const run = readRun(dir, []);
  assert.deepEqual(run.api, {
    calls: {
      'OrderController.getOrder': { ok: 2, slow: 1 },
      'GET /orders/:orderNumber': { error: 1, ok: 1 },
      'POST /carts/:id/items': { ok: 1 },
    },
    variants: { 'OrderController.getOrder': ['default', 'locked'] },
    inventory: { 'OrderController.getOrder': ['default', 'locked'], 'OrderController.save': [], 'GET /orders/:orderNumber': [] },
  });
});

test('readRun has no api for a spec without the api extractor', () => {
  const dir = writeRun(tmp(), { id: 'r1', rows: [row(0, '/login', null)] });
  assert.equal(readRun(dir, []).api, undefined);
});

test('readRun counts the milestones reached, and reads the ones its flow expects from run.json', () => {
  const dir = writeRun(tmp(), {
    id: 'r1',
    flow: 'account-save',
    expected: ['saved', 'persisted'],
    rows: [
      reaching(row(0, '/my-account', null), []),
      reaching(row(1, '/my-account', 'Click'), ['saved']),
      reaching(row(2, '/my-account', 'Wait'), []),
      reaching(row(3, '/my-account', 'Click'), ['saved', 'signedOut']),
    ],
  });
  const run = readRun(dir, []);
  assert.deepEqual(run.milestones, { saved: 2, signedOut: 1 });
  assert.deepEqual(run.meta.expected_milestones, ['saved', 'persisted']);
});

test('readRun has no milestones for a spec without the extractor; one that reached none has {}', () => {
  assert.equal(readRun(writeRun(tmp(), { id: 'r1', rows: [row(0, '/login', null)] }), []).milestones, undefined);
  assert.deepEqual(readRun(writeRun(tmp(), { id: 'r1', rows: [reaching(row(0, '/login', null), [])] }), []).milestones, {});
});
