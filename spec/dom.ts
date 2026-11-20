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
