// A flow's fence (flows.json `allow`), as the page protocol's decodeCookies
// reads it from the fuzz_fence cookie: path patterns, a trailing * a prefix.

/** Whether `path` is inside `fence`. No fence (no cookie) or an empty one lets everything in. A query or hash on `path` is ignored. */
export const inFence = (fence: readonly string[] | null | undefined, path: string): boolean => {
  if (!fence?.length) return true;
  const pathname = path.replace(/[?#].*$/, '');
  return fence.some((p) => (p.endsWith('*') ? pathname.startsWith(p.slice(0, -1)) : pathname === p));
};
