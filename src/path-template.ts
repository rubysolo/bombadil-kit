// The path template a concrete path belongs to: one rule for the spec's
// finding requests (requestPattern), the report's routes (routeTemplate) and
// its API endpoints (endpointKey), so one endpoint reads the same everywhere
// and one bug is one finding.
//
// Dependency-free and DOM-free: the spec bundle imports it at runtime, as it
// does src/page-protocol.ts.

/**
 * A path segment that names a record rather than an endpoint: all digits
 * (`1187`), a UUID, upper case with digits (`ORD12345`, `P12`), upper-case
 * words joined by `-`/`_` (`TEST-BASIC-ORDER`), or 8+ characters mixing
 * letters and digits (a hex id, a ULID, `order-12345`). A lowercase word with
 * a short number (`oauth2`, `v2`, `utf8`, `version10`) and a lone upper-case
 * word (`API`, `CSV`) name endpoints.
 */
const isRecordSegment = (seg: string): boolean => {
  if (/^\d+$/.test(seg)) return true;
  if (/^[a-z]+\d{1,2}$/.test(seg)) return false;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg)) return true;
  if (/^(?=.*\d)(?=.*[A-Z])[A-Z0-9]+$/.test(seg)) return true;
  if (/^(?=.*[A-Z])[A-Z0-9]+(?:[-_][A-Z0-9]+)+$/.test(seg)) return true;
  return seg.length >= 8 && /\d/.test(seg) && /[A-Za-z]/.test(seg) && /^[A-Za-z0-9_-]+$/.test(seg);
};

/** Whether `pattern` (`:name` and `*` match any one segment) names `path`. */
const matches = (pattern: string, path: string): boolean => {
  const a = pattern.split('/');
  const b = path.split('/');
  return a.length === b.length && a.every((seg, i) => seg.startsWith(':') || seg === '*' || seg === b[i]);
};

/**
 * The template `path` belongs to: the first of `known` that matches it, else
 * the path with its record segments as `:id`. Query and fragment are dropped.
 * A key that isn't a path (`OrderController.saveOrder`) is kept as it is.
 */
export const templateOf = (path: string, known: readonly string[]): string => {
  const bare = path.split(/[?#]/)[0] || '/';
  if (!bare.startsWith('/')) return bare;
  return known.find((pattern) => matches(pattern, bare)) ?? bare.split('/').map((seg) => (isRecordSegment(seg) ? ':id' : seg)).join('/');
};

/**
 * The endpoint a request hit, as `METHOD /template`: templateOf against the
 * `endpoints` (`METHOD /path` keys, the mock's inventory) for that method.
 */
export const endpointOf = (method: string, path: string, endpoints: readonly string[]): string =>
  `${method} ${templateOf(
    path,
    endpoints.filter((k) => k.startsWith(`${method} /`)).map((k) => k.slice(method.length + 1)),
  )}`;
