// DOM helpers for spec/index.ts with no Bombadil imports, so node can test
// them against stand-in elements.

/** Whether `el` takes up any room on the page. */
export const isVisible = (el: Element) => {
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
};

/** Whether any of `els` is visible and, given `exclude` (a CSS selector), not inside an element it matches. */
export const visibleOutside = (els: Iterable<Element>, exclude?: string) =>
  [...els].some((el) => isVisible(el) && !(exclude && el.closest(exclude)));

/**
 * The length of `body`'s visible text outside `chrome` (a selector: header,
 * footer, nav). Only outermost matches are subtracted, so a nav inside the
 * header isn't counted twice.
 */
export const contentLength = (body: HTMLElement, chrome: string) => {
  let length = body.innerText.length;
  for (const el of body.querySelectorAll<HTMLElement>(chrome)) {
    if (!el.parentElement?.closest(chrome)) length -= el.innerText.length;
  }
  return Math.max(0, length);
};

/**
 * What nothingUnder ignores text inside by default: dialogs and the pop-ups
 * (menus, listboxes, tooltips) drawn on top on purpose. Not `position: fixed`
 * (a fixed banner over the logo is the bug) or `role="presentation"` (layout
 * tables and wrappers use it too; add it for MUI's modal roots).
 */
export const OVERLAYS =
  '[role="dialog"], [role="alertdialog"], [aria-modal="true"], dialog[open], [role="menu"], [role="listbox"], [role="tooltip"]';

type Box = Pick<DOMRect, 'left' | 'top' | 'right' | 'bottom' | 'width' | 'height'>;

/** Whether any of a few points in `box` (its center, and each corner inset 3px) shows `target` or something in it. */
const shows = (doc: Document, target: Element, box: Box) => {
  const dx = Math.min(3, box.width / 2);
  const dy = Math.min(3, box.height / 2);
  const points: [number, number][] = [
    [box.left + box.width / 2, box.top + box.height / 2],
    [box.left + dx, box.top + dy],
    [box.right - dx, box.top + dy],
    [box.left + dx, box.bottom - dy],
    [box.right - dx, box.bottom - dy],
  ];
  return points.some(([x, y]) => {
    const hit = doc.elementFromPoint(x, y);
    return !!hit && target.contains(hit);
  });
};

/**
 * The first text (up to 60 characters) whose box overlaps the element
 * `selector` matches, outside `container` and `exclude` (selectors; '' for
 * none). Null when there's none, or when the target can't be seen: covered
 * by a backdrop, an overlay or a drawer, or off screen, nothing is under it.
 */
export const textUnder = (doc: Document, selector: string, container: string, exclude = OVERLAYS) => {
  const target = doc.querySelector(selector);
  if (!target) return null;
  const box = target.getBoundingClientRect();
  if (box.width === 0 || box.height === 0 || !shows(doc, target, box)) return null;
  const walker = doc.createTreeWalker(doc.body, 4 /* NodeFilter.SHOW_TEXT */);
  const range = doc.createRange();
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent?.trim();
    const parent = node.parentElement;
    if (!text || parent?.closest(container) || (exclude && parent?.closest(exclude))) continue;
    range.selectNodeContents(node);
    for (const r of range.getClientRects()) {
      const w = Math.min(r.right, box.right) - Math.max(r.left, box.left);
      const h = Math.min(r.bottom, box.bottom) - Math.max(r.top, box.top);
      if (w > 2 && h > 2) return text.slice(0, 60);
    }
  }
  return null;
};
