import { test } from 'node:test';
import assert from 'node:assert/strict';
import { busyMs, COOKIES, decodeCookies, encodeCookies, openRequest, readCookie, type MockWindow, type PageCookies } from '../src/page-protocol.ts';

// ---------------------------------------------------------------- busy clock

test('busyMs: the time anything was in flight, overlaps counted once; undefined if the app does not count', () => {
  const win: MockWindow = {};
  let now = 1000;
  const clock = () => now;
  assert.equal(busyMs(win, now), undefined, 'no __mockPending: the app does not count');
  const a = openRequest(win, clock);
  assert.equal(busyMs(win, now), 0);
  now = 1100;
  const b = openRequest(win, clock);
  now = 1150;
  a();
  a(); // settled and abandoned both call it: counted once
  assert.equal(win.__mockPending, 1);
  assert.equal(busyMs(win, now), 150);
  now = 1200;
  b();
  now = 5000;
  assert.equal(busyMs(win, now), 200, 'nothing in flight: the clock stops');
  const c = openRequest(win, clock);
  now = 5030;
  assert.equal(busyMs(win, now), 230);
  // Read at a moment of the caller's (the spec reads at its capture time).
  assert.equal(busyMs(win, 5010), 210);
  c();
  assert.equal(win.__mockPending, 0);
  assert.equal(busyMs(win, 9999), 230);
});

// ------------------------------------------------------------------ cookies

/** A `document.cookie` string from `--cookie NAME=VALUE`s, beside cookies of the app's own. */
const asDocumentCookie = (cookies: string[]) => ['session=abc', ...cookies, 'theme=dark'].join('; ');

test('cookies: encode, then decode from document.cookie, round-trips every field', () => {
  const all: PageCookies = {
    fence: ['/cart*', '/orders/1', '/a b;c'],
    root: '/Users/me/my repo',
    app: 'apps/web',
    seed: 7,
    faults: 0.1,
    refDate: '2026-11-21',
  };
  assert.deepEqual(decodeCookies(asDocumentCookie(encodeCookies(all))), all);
  assert.deepEqual(decodeCookies(asDocumentCookie(encodeCookies({ seed: 0, faults: 0 }))), { seed: 0, faults: 0 });
  assert.deepEqual(decodeCookies(asDocumentCookie(encodeCookies({}))), {});
});

test('cookies: the wire format apps and older specs read', () => {
  assert.deepEqual(encodeCookies({ fence: ['/cart*', '/orders/1'], root: '/repo', app: 'apps/web', seed: 7, faults: 0.1, refDate: '2026-11-21' }), [
    `fuzz_fence=${encodeURIComponent('/cart*,/orders/1')}`,
    'fuzz_root=%2Frepo',
    'fuzz_app=apps%2Fweb',
    'fuzz_seed=7',
    'fuzz_faults=0.1',
    'fuzz_ref_date=2026-11-21',
  ]);
  assert.equal(COOKIES.refDate, 'fuzz_ref_date');
});

test('cookies: an empty fence is no fence; a name is matched whole', () => {
  assert.deepEqual(decodeCookies(encodeCookies({ fence: [] }).join('; ')), {});
  assert.equal(readCookie('xfuzz_root=nope; fuzz_root=%2Fr', COOKIES.root), '/r');
  assert.equal(readCookie('fuzz_rootx=nope', COOKIES.root), null);
  // A value that isn't valid URI encoding comes back as it is.
  assert.equal(readCookie('fuzz_app=100%', COOKIES.app), '100%');
  assert.deepEqual(decodeCookies('fuzz_seed=abc; fuzz_faults='), {});
});
