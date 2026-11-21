// A flow's fence (flows.json `allow`) as the runner hands it to the page in
// the fuzz_fence cookie: comma-separated path patterns, a trailing * a prefix.

/** Whether `path` is inside `fence`. No fence (no cookie) lets everything in. A query or hash on `path` is ignored. */
export const inFence = (fence: string | null | undefined, path: string): boolean => {
  if (!fence) return true;
  const pathname = path.replace(/[?#].*$/, '');
  return fence.split(',').some((p) => (p.endsWith('*') ? pathname.startsWith(p.slice(0, -1)) : pathname === p));
};
