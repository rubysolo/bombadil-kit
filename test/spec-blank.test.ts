import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contentLength } from '../spec/dom.ts';
import { hasSettled, persist, type PersistStore } from '../spec/settled.ts';
import { specProperties } from '../src/report/project.ts';

// Stand-in elements: innerText, and the chrome selectors each sits inside.
type Stub = { innerText: string; parentElement: { closest: (s: string) => object | null } };
const chromeEl = (text: string, inChrome = false): Stub => ({
  innerText: text,
  parentElement: { closest: () => (inChrome ? {} : null) },
});
const body = (text: string, chrome: Stub[] = []) =>
  ({ innerText: text, querySelectorAll: () => chrome }) as unknown as HTMLElement;

const HEADER = 'Acme Payroll  Home  Reports  Sign out';
const FOOTER = '© 2026 Acme';

test('contentLength: body text minus the outermost chrome', () => {
  const page = `${HEADER}\n${FOOTER}`;
  assert.equal(contentLength(body(page, [chromeEl(HEADER), chromeEl(FOOTER)]), 'header, footer, nav'), 1);
  assert.equal(contentLength(body(`${HEADER}\nHello`, [chromeEl(HEADER)]), 'header'), 6);
});

test('contentLength: a nav inside the header is not subtracted twice', () => {
  const nav = 'Home  Reports';
  const page = `${HEADER}\n${'x'.repeat(60)}`;
  assert.equal(contentLength(body(page, [chromeEl(HEADER), chromeEl(nav, true)]), 'header, nav'), 61);
});

test('contentLength: no chrome is the whole text; never negative', () => {
  assert.equal(contentLength(body('Hello'), 'header'), 5);
  assert.equal(contentLength(body(''), 'header'), 0);
  assert.equal(contentLength(body('ab', [chromeEl('abcdef')]), 'header'), 0);
});

test('hasSettled: needs both the state count and the duration', () => {
  assert.equal(hasSettled({ ms: 0, states: 0 }), false);
  assert.equal(hasSettled({ ms: 5000, states: 2 }), false); // long, but few captures
  assert.equal(hasSettled({ ms: 999, states: 50 }), false); // a render cascade
  assert.equal(hasSettled({ ms: 1000, states: 3 }), true);
  assert.equal(hasSettled({ ms: 200, states: 2 }, { minStates: 2, minMs: 200 }), true);
  assert.equal(hasSettled({ ms: 1000, states: 3 }, { minStates: undefined, minMs: undefined }), true);
});

test('persist: counts states and time while active on one history entry', () => {
  const store: PersistStore = {};
  assert.deepEqual(persist(store, 'k', 1, true, 1000), { ms: 0, states: 1 });
  assert.deepEqual(persist(store, 'k', 1, true, 1400), { ms: 400, states: 2 });
  assert.deepEqual(persist(store, 'k', 1, true, 2000), { ms: 1000, states: 3 });
});

test('persist: a break or a new history entry starts over; keys are separate', () => {
  const store: PersistStore = {};
  persist(store, 'k', 1, true, 1000);
  persist(store, 'k', 1, true, 2000);
  assert.deepEqual(persist(store, 'k', 2, true, 3000), { ms: 0, states: 1 });
  assert.deepEqual(persist(store, 'other', 2, true, 3000), { ms: 0, states: 1 });
  assert.deepEqual(persist(store, 'k', 2, false, 3500), { ms: 0, states: 0 });
  assert.deepEqual(persist(store, 'k', 2, true, 4000), { ms: 0, states: 1 });
  assert.deepEqual(persist(store, 'other', 2, true, 4000), { ms: 1000, states: 2 });
});

test('specProperties lists a noBlankPage export', () => {
  const spec = "import { noBlankPage } from 'bombadil-kit/spec';\nexport const noBlank = noBlankPage({ minChars: 20 });\n";
  assert.deepEqual(specProperties(spec), ['noBlank']);
});
