import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OVERLAYS, textUnder } from '../spec/dom.ts';

// Stand-ins for the page: a 32px logo at (16, 8), text nodes with their boxes
// and the selectors they sit inside, and what elementFromPoint hits.
type Rect = { left: number; top: number; right: number; bottom: number; width: number; height: number };
const rect = (left: number, top: number, width: number, height: number): Rect => ({
  left,
  top,
  right: left + width,
  bottom: top + height,
  width,
  height,
});
type TextStub = { textContent: string; rects: Rect[]; parentElement: { closest: (s: string) => object | null } };
// `inside` are bare selector parts ('header', 'dialog'): closest matches a
// selector list naming any of them.
const text = (textContent: string, box: Rect, inside: string[] = []): TextStub => ({
  textContent,
  rects: [box],
  parentElement: { closest: (s) => (inside.some((i) => s.split(',').some((part) => part.includes(i))) ? {} : null) },
});

const LOGO = rect(16, 8, 32, 32);
const backdrop = { contains: () => false };
const page = ({ texts, hit }: { texts: TextStub[]; hit: (logo: Element) => (x: number, y: number) => object | null }) => {
  const logo = { getBoundingClientRect: () => LOGO, contains: (el: unknown) => el === logo } as unknown as Element;
  return {
    querySelector: () => logo,
    elementFromPoint: hit(logo),
    body: {},
    createTreeWalker: () => {
      let i = 0;
      return { nextNode: () => texts[i++] ?? null };
    },
    createRange: () => {
      let node: TextStub | undefined;
      return { selectNodeContents: (n: TextStub) => (node = n), getClientRects: () => node?.rects ?? [] };
    },
  } as unknown as Document;
};
const logoOnTop = (logo: Element) => () => logo;
const coveredBy = (el: object) => () => () => el;

test('textUnder: page text under a visible floating logo is reported', () => {
  const doc = page({ texts: [text('Products', rect(16, 20, 120, 37))], hit: logoOnTop });
  assert.equal(textUnder(doc, 'header img', 'header'), 'Products');
});

test('textUnder: text in the container is not', () => {
  const doc = page({ texts: [text('Cart', rect(16, 8, 40, 20), ['header'])], hit: logoOnTop });
  assert.equal(textUnder(doc, 'header img', 'header'), null);
});

test('textUnder: a dialog title over a covered logo is not', () => {
  // The title isn't in exclude here: the covered logo alone rules it out.
  const doc = page({ texts: [text("Men's Flyte Jersey", rect(8, 10, 200, 30))], hit: coveredBy(backdrop) });
  assert.equal(textUnder(doc, 'header img', 'header', ''), null);
});

test('textUnder: text inside exclude does not count, even over a visible logo', () => {
  const doc = page({ texts: [text("Men's Flyte Jersey", rect(8, 10, 200, 30), ['dialog'])], hit: logoOnTop });
  assert.equal(textUnder(doc, 'header img', 'header'), null);
  assert.equal(textUnder(doc, 'header img', 'header', OVERLAYS), null);
  // With exclude emptied, the same title is reported.
  assert.equal(textUnder(doc, 'header img', 'header', ''), "Men's Flyte Jersey");
});

test('textUnder: a menu or tooltip over a visible logo does not count; a fixed banner does', () => {
  const tip = page({ texts: [text('Home', rect(8, 10, 60, 20), ['tooltip'])], hit: logoOnTop });
  assert.equal(textUnder(tip, 'header img', 'header'), null);
  const menu = page({ texts: [text('Sign out', rect(8, 10, 80, 20), ['menu'])], hit: logoOnTop });
  assert.equal(textUnder(menu, 'header img', 'header'), null);
  const presentation = page({ texts: [text('Products', rect(16, 20, 120, 37), ['presentation'])], hit: logoOnTop });
  assert.equal(textUnder(presentation, 'header img', 'header'), 'Products');
});

test('textUnder: one sampled point still hitting the logo is enough to check', () => {
  // A promo line over the logo's top half hides its center, not its bottom corners.
  const promo = { contains: () => false };
  const doc = page({
    texts: [text('Free shipping today', rect(8, 10, 160, 22))],
    hit: (logo) => (_x, y) => (y < 32 ? promo : logo),
  });
  assert.equal(textUnder(doc, 'header img', 'header'), 'Free shipping today');
});

test('textUnder: a hit inside the target counts as the target', () => {
  const child = {};
  const doc = page({ texts: [text('Products', rect(16, 20, 120, 37))], hit: () => () => child });
  const logo = doc.querySelector('header img') as unknown as { contains: (el: unknown) => boolean };
  logo.contains = (el) => el === child;
  assert.equal(textUnder(doc, 'header img', 'header'), 'Products');
});

test('textUnder: a target off screen (nothing hit) has nothing under it', () => {
  const doc = page({ texts: [text('Products', rect(16, 20, 120, 37))], hit: () => () => null });
  assert.equal(textUnder(doc, 'header img', 'header'), null);
});

test('textUnder: no target, or a zero-width one, is nothing', () => {
  const none = { querySelector: () => null } as unknown as Document;
  assert.equal(textUnder(none, 'header img', 'header'), null);
});
