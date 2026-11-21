import { test } from 'node:test';
import assert from 'node:assert/strict';
import { faker } from '@faker-js/faker';
import type { BaseQueryApi, BaseQueryFn, FetchArgs, FetchBaseQueryError } from '@reduxjs/toolkit/query';
import { appFrames, deepStack, formatConsoleArgs } from '../src/app/console.ts';
import { seedFaker, parseMockSeed } from '../src/app/faker.ts';
import { createFaultInjector, mockBusyMs, parseFaultConfig, startMockRequest } from '../src/app/faults.ts';
import { withFaults } from '../src/app/rtk.ts';

// ------------------------------------------------------------------ faults

test('parseFaultConfig: off unless a rate is set; clamps; defaults the seed', () => {
  for (const rate of [undefined, '', '0', 'lots']) assert.equal(parseFaultConfig({ VITE_MOCK_FAULT_RATE: rate }), undefined);
  assert.deepEqual(parseFaultConfig({ VITE_MOCK_FAULT_RATE: '0.25', VITE_MOCK_FAULT_SEED: '7' }), { rate: 0.25, seed: 7 });
  assert.equal(parseFaultConfig({ VITE_MOCK_FAULT_RATE: '3' })?.rate, 1);
  assert.equal(parseFaultConfig({ VITE_MOCK_FAULT_RATE: '0.1' })?.seed, 1);
});

const requests = Array.from({ length: 200 }, (_, i) => ['GET', `/orders/${i}`] as const);

test('createFaultInjector: rate 0 fails nothing, rate 1 everything, 0.2 about a fifth', () => {
  const run = (rate: number, seed = 1) => {
    const inject = createFaultInjector({ rate, seed });
    return requests.map(([m, p]) => inject(m, p)).filter(Boolean).length;
  };
  assert.equal(run(0), 0);
  assert.equal(run(1), 200);
  const some = run(0.2, 42);
  assert.ok(some > 20 && some < 60, `${some}`);
});

test('createFaultInjector: same seed, same choices; every kind of failure shows up', () => {
  const a = createFaultInjector({ rate: 0.3, seed: 9 });
  const b = createFaultInjector({ rate: 0.3, seed: 9 });
  assert.deepEqual(requests.map(([m, p]) => a(m, p)), requests.map(([m, p]) => b(m, p)));
  const all = createFaultInjector({ rate: 1, seed: 3 });
  assert.deepEqual(new Set(requests.map(([m, p]) => all(m, p)?.status)), new Set([500, 503, 422, 'FETCH_ERROR', 'TIMEOUT_ERROR']));
});

test('createFaultInjector: spares /mock/ by default, or what it is given', () => {
  const inject = createFaultInjector({ rate: 1, seed: 1 });
  assert.equal(inject('POST', '/mock/reset'), undefined);
  const custom = createFaultInjector({ rate: 1, seed: 1, spare: [/^\/translations/] });
  assert.equal(custom('GET', '/translations/en'), undefined);
  assert.ok(custom('POST', '/mock/reset'));
});

test('createFaultInjector: logs each fault on window.__mockFaults', () => {
  const g = globalThis as { window?: { __mockFaults?: unknown[] } };
  g.window = {};
  try {
    createFaultInjector({ rate: 1, seed: 1 })('post', '/orders');
    const [logged] = g.window.__mockFaults as { method: string; path: string; at: number }[];
    assert.equal(logged!.method, 'POST');
    assert.equal(logged!.path, '/orders');
    assert.ok(Math.abs(logged!.at - Date.now()) < 1000);
  } finally {
    delete g.window;
  }
});

test('createFaultInjector: isWrite fills `write`; without it there is none', () => {
  const g = globalThis as { window?: { __mockFaults?: { write?: boolean }[] } };
  g.window = {};
  try {
    const isWrite = (_method: string, path: string) => /\.(save|delete)\w*$/.test(path);
    const inject = createFaultInjector({ rate: 1, seed: 1, isWrite });
    inject('REMOTE', 'OrderController.saveOrder');
    inject('REMOTE', 'OrderController.getOrders');
    createFaultInjector({ rate: 1, seed: 1 })('POST', '/orders');
    assert.deepEqual(g.window.__mockFaults!.map((f) => f.write), [true, false, undefined]);
    assert.ok(!('write' in g.window.__mockFaults![2]!));
  } finally {
    delete g.window;
  }
});

test('createFaultInjector: `delivered` stamps deliveredAt = at; without it there is none', () => {
  const g = globalThis as { window?: { __mockFaults?: { at: number; deliveredAt?: number }[] } };
  g.window = {};
  try {
    createFaultInjector({ rate: 1, seed: 1, delivered: true })('POST', '/orders');
    createFaultInjector({ rate: 1, seed: 1 })('POST', '/orders');
    const [now, later] = g.window.__mockFaults!;
    assert.equal(now!.deliveredAt, now!.at);
    assert.ok(!('deliveredAt' in later!));
  } finally {
    delete g.window;
  }
});

test('createFaultInjector: logs every call on window.__mockCalls, ok or error', () => {
  const g = globalThis as { window?: { __mockCalls?: { key: string; outcome: string; at: number }[] } };
  g.window = {};
  try {
    createFaultInjector({ rate: 1, seed: 1 })('post', '/orders');
    createFaultInjector({ rate: 0.000001, seed: 1 })('GET', '/orders/7');
    createFaultInjector({ rate: 1, seed: 1 })('POST', '/mock/reset');
    const calls = g.window.__mockCalls!;
    assert.deepEqual(calls.map(({ key, outcome }) => ({ key, outcome })), [
      { key: 'POST /orders', outcome: 'error' },
      { key: 'GET /orders/7', outcome: 'ok' },
      { key: 'POST /mock/reset', outcome: 'ok' },
    ]);
    assert.ok(Math.abs(calls[0]!.at - Date.now()) < 1000);
  } finally {
    delete g.window;
  }
});

// --------------------------------------------------------------------- rtk

const api = {} as BaseQueryApi;
const ok: BaseQueryFn<string | FetchArgs, string, FetchBaseQueryError> = () => ({ data: 'ok' });

test('withFaults: passes isWrite to the injector', async () => {
  const g = globalThis as { window?: { __mockFaults?: { write?: boolean }[] } };
  g.window = {};
  try {
    await withFaults(ok, { VITE_MOCK_FAULT_RATE: '1' }, { isWrite: () => true })('/orders', api, {});
    assert.equal(g.window.__mockFaults![0]!.write, true);
  } finally {
    delete g.window;
  }
});

test('withFaults: answers with the fault at once, so it logs deliveredAt', async () => {
  const g = globalThis as { window?: { __mockFaults?: { at: number; deliveredAt?: number }[] } };
  g.window = {};
  try {
    await withFaults(ok, { VITE_MOCK_FAULT_RATE: '1' })('/orders', api, {});
    assert.equal(g.window.__mockFaults![0]!.deliveredAt, g.window.__mockFaults![0]!.at);
  } finally {
    delete g.window;
  }
});

test('withFaults: without a rate it is the baseQuery itself', () => {
  assert.equal(withFaults(ok, {}), ok);
});

test('withFaults: fails by method and path (no origin, no query), else passes through', async () => {
  const seen: string[] = [];
  const always = withFaults(ok, { VITE_MOCK_FAULT_RATE: '1' }, {
    spare: [/^\/health$/],
    onFault: (method, path) => seen.push(`${method} ${path}`),
  });
  const res = await always({ url: 'https://api.example.com/orders?page=2', method: 'post' }, api, {});
  assert.ok('error' in res && res.error);
  assert.deepEqual(seen, ['POST /orders']);
  assert.deepEqual(await always('/health', api, {}), { data: 'ok' });
});

// ------------------------------------------------------------------- faker

test('parseMockSeed: off without a seed; ref date defaults to today, UTC', () => {
  assert.equal(parseMockSeed({}), undefined);
  assert.deepEqual(parseMockSeed({ VITE_MOCK_SEED: '4', VITE_MOCK_REF_DATE: '2026-11-19' }), {
    seed: 4,
    refDate: new Date('2026-11-19T00:00:00Z'),
  });
  assert.equal(parseMockSeed({ VITE_MOCK_SEED: '4' })?.refDate.toISOString().slice(0, 10), new Date().toISOString().slice(0, 10));
});

test('seedFaker: same seed, same data and clock; unseeded leaves faker alone', () => {
  const env = { VITE_MOCK_SEED: '42', VITE_MOCK_REF_DATE: '2026-01-02' };
  const one = seedFaker(faker, env);
  const a = [faker.person.fullName(), one.mockRandom(), one.mockNow()];
  const two = seedFaker(faker, env);
  const b = [faker.person.fullName(), two.mockRandom(), two.mockNow()];
  assert.deepEqual(a, b);
  assert.equal(a[2], Date.parse('2026-01-02T00:00:00Z'));
});

test('seedFaker unseeded: the clock, and mockRandom follows a later applySeed', async () => {
  const { Faker, en } = await import('@faker-js/faker');
  const fresh = new Faker({ locale: [en] });
  const off = seedFaker(fresh, {});
  assert.equal(off.seeded, undefined);
  assert.ok(Math.abs(off.mockNow() - Date.now()) < 1000);
  const { applySeed } = await import('../src/app/faker.ts');
  const ref = new Date('2026-11-19T00:00:00Z');
  applySeed(fresh, { seed: 7, refDate: ref });
  const a = [off.mockRandom(), off.mockRandom()];
  applySeed(fresh, { seed: 7, refDate: ref });
  assert.deepEqual([off.mockRandom(), off.mockRandom()], a);
  assert.equal(off.mockNow(), ref.getTime());
});

// ----------------------------------------------------------------- console

test('formatConsoleArgs: printf placeholders, leftovers appended, errors as messages', () => {
  assert.equal(formatConsoleArgs(['Warning: %s is %d%%', 'x', 3, { a: 1 }]), 'Warning: x is 3% {"a":1}');
  assert.equal(formatConsoleArgs(['Failed to login:', new Error('boom')]), 'Failed to login: Error: boom');
  assert.equal(formatConsoleArgs(['%cstyled', 'color: red']), 'styled');
});

test("appFrames: the app's own frames, never this module's", () => {
  const stack = [
    'Error',
    '    at console.error (http://127.0.0.1:5199/node_modules/.vite/deps/bombadil-kit_console.js?v=1:40:11)',
    '    at checkForNestedUpdates (http://127.0.0.1:5199/node_modules/.vite/deps/react-dom.js?v=1:2:3)',
    '    at http://127.0.0.1:5199/src/pages/CreateAccount.tsx:131:7',
  ].join('\n');
  assert.deepEqual(appFrames(stack), ['at http://127.0.0.1:5199/src/pages/CreateAccount.tsx:131:7']);
});

test("appFrames: without app frames, the libraries' minus React's", () => {
  const stack = [
    'Error',
    '    at console.error (http://127.0.0.1:5199/node_modules/bombadil-kit/dist/app/console.js:40:11)',
    '    at checkForNestedUpdates (http://127.0.0.1:5199/node_modules/.vite/deps/react-dom_client.js?v=1:2:3)',
    '    at Object.next (http://127.0.0.1:5199/node_modules/.vite/deps/react-hook-form.js?v=1:9:9)',
  ].join('\n');
  assert.deepEqual(appFrames(stack), ['at Object.next (http://127.0.0.1:5199/node_modules/.vite/deps/react-hook-form.js?v=1:9:9)']);
});

test('deepStack sees past V8’s default 10 frames, and puts the limit back', () => {
  const deep = (n: number): string | undefined => (n === 0 ? deepStack() : deep(n - 1));
  const frames = (deep(30) ?? '').split('\n').filter((l) => l.trim().startsWith('at '));
  assert.ok(frames.length > 30);
  assert.equal((Error as ErrorConstructor & { stackTraceLimit: number }).stackTraceLimit, 10);
});

// ---------------------------------------------------------------- in flight

type BusyWindow = { __mockPending?: number; __mockBusyMs?: number; __mockBusySince?: number };
const withWindow = async (fn: (w: BusyWindow) => Promise<void> | void) => {
  const g = globalThis as { window?: BusyWindow };
  g.window = {};
  try {
    await fn(g.window);
  } finally {
    delete g.window;
  }
};

test('startMockRequest: counts a request on window.__mockPending until done, once', () =>
  withWindow((w) => {
    const a = startMockRequest();
    const b = startMockRequest();
    assert.equal(w.__mockPending, 2);
    a();
    a(); // settled and abandoned both call it: counted once
    assert.equal(w.__mockPending, 1);
    b();
    assert.equal(w.__mockPending, 0);
  }));

test('mockBusyMs: the time anything was in flight, overlaps counted once', () =>
  withWindow((w) => {
    let now = 1000;
    const clock = () => now;
    assert.equal(mockBusyMs(clock), 0);
    const a = startMockRequest(clock);
    now = 1100;
    const b = startMockRequest(clock);
    now = 1150;
    a();
    assert.equal(mockBusyMs(clock), 150);
    now = 1200;
    b();
    now = 5000;
    assert.equal(mockBusyMs(clock), 200);
    const c = startMockRequest(clock);
    now = 5030;
    assert.equal(mockBusyMs(clock), 230);
    c();
    assert.equal(w.__mockPending, 0);
  }));

test('startMockRequest: harmless outside a browser', () => {
  assert.doesNotThrow(() => startMockRequest()());
});

test('withFaults: in fuzz mode, every request is pending until it answers, faults on or off', () =>
  withWindow(async (w) => {
    let answer!: () => void;
    const slow: BaseQueryFn<string | FetchArgs, string, FetchBaseQueryError> = () =>
      new Promise((resolve) => (answer = () => resolve({ data: 'ok' })));
    for (const rate of ['0', '0.5']) {
      const bq = withFaults(slow, { VITE_MOCK_FAULT_RATE: rate, VITE_MOCK_FAULT_SEED: '1' }, { spare: [/./] });
      const res = bq('/orders', api, {});
      assert.equal(w.__mockPending, 1, `rate ${rate}`);
      answer();
      await res;
      assert.equal(w.__mockPending, 0, `rate ${rate}`);
    }
    // An injected fault answers at once: never left pending.
    await withFaults(ok, { VITE_MOCK_FAULT_RATE: '1' })('/orders', api, {});
    assert.equal(w.__mockPending, 0);
  }));

test('withFaults: at --faults 0 it fails nothing but still logs every call', () =>
  withWindow(async (w) => {
    const bq = withFaults(ok, { VITE_MOCK_FAULT_RATE: '0' });
    for (let i = 0; i < 20; i++) assert.deepEqual(await bq('/orders', api, {}), { data: 'ok' });
    const calls = (w as { __mockCalls?: unknown[] }).__mockCalls ?? [];
    assert.equal(calls.length, 20);
  }));
