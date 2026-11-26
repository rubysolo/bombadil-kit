import { createHash } from 'node:crypto';
import { isRecordSegment, templateOf } from '../path-template.ts';

/**
 * Pure helpers that turn Bombadil's raw trace values into stable, readable
 * pieces: the route a URL belongs to, the identity of a violation, and a short
 * line per action.
 */

const pathOf = (url: string): string => {
  try {
    return new URL(url).pathname || '/';
  } catch {
    return url.split(/[?#]/)[0] || '/';
  }
};

/**
 * The route a URL belongs to: the first matching pattern from `known` (the
 * project's route list), else its path with record segments as `:id`
 * (templateOf). Query and fragment are dropped.
 */
export const routeTemplate = (url: string, known: readonly string[]): string => templateOf(pathOf(url), known);

export interface Snapshot {
  name: string | null;
  value: unknown;
}

const firstString = (value: unknown): string | undefined => {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    for (const v of value) {
      const s = firstString(v);
      if (s !== undefined) return s;
    }
  } else if (value && typeof value === 'object') {
    for (const v of Object.values(value)) {
      const s = firstString(v);
      if (s !== undefined) return s;
    }
  }
  return undefined;
};

/** The first string a violation's snapshots hold, unblurred and trimmed. */
export const detailText = (snapshots: readonly Snapshot[]): string => {
  for (const s of snapshots) {
    const str = firstString(s.value);
    if (str !== undefined && str.trim() !== '') return str.trim().slice(0, 2000);
  }
  return '';
};

/**
 * A record id in a message, by the rule paths use (isRecordSegment), except
 * upper-case words joined by `_`: in a message those are constants
 * (`FETCH_ERROR`, `ERR_NETWORK`) that tell bugs apart.
 */
const isRecordToken = (token: string): boolean => !/^[A-Z]+(?:_[A-Z]+)+$/.test(token) && isRecordSegment(token);

/**
 * What tells two violations of one property on one route apart: the first
 * string in the snapshots (a request line, a console message, an exception),
 * first line only, blurred so the records a run happened to touch don't split
 * one bug into many (a PR's seed generates other records than the nightly's):
 * - an RTK cache key's argument, `getOrder({"orderNumber":"X"})` → `getOrder(…)`;
 * - record ids, as in paths (`HISTORY-IN-TRANSIT`, `ORD12345`, UUIDs) → `#`;
 * - every other run of digits → `#`.
 * Numbers and booleans are measurements, not identity, and are ignored.
 */
export const detailKey = (snapshots: readonly Snapshot[]): string =>
  // First line only: a stack the app appends below the message (fuzz mode)
  // would otherwise split one bug's id, and move it whenever code shifts.
  detailText(snapshots)
    .split('\n')[0]!
    .replace(/([\w$])\((?:\{[^()]*\}|\[[^()]*\]|"[^"()]*"|'[^'()]*')\)/g, '$1(…)')
    .replace(/[A-Za-z0-9](?:[\w-]*[A-Za-z0-9])?/g, (token) => (isRecordToken(token) ? '#' : token))
    .replace(/\d+/g, '#')
    .slice(0, 160);

export const findingId = (project: string, property: string, route: string, detail: string): string =>
  'F-' + createHash('sha1').update([project, property, route, detail].join('\u0000')).digest('hex').slice(0, 6);

const clip = (s: string, n = 40): string => (s.length > n ? s.slice(0, n - 1) + '…' : s);

type Fingerprint = {
  tag?: string;
  text_content?: string;
  accessible_name?: string;
  name_attr?: string;
  id?: string;
  placeholder?: string;
  test_id?: string;
};

const describeTarget = (fp: Fingerprint = {}): string => {
  const tag = fp.tag ?? 'element';
  const label = fp.text_content ?? fp.accessible_name;
  if (label) return `${tag} "${clip(label.trim())}"`;
  if (fp.name_attr) return `${tag}[name=${fp.name_attr}]`;
  if (fp.test_id) return `${tag}[data-testid=${fp.test_id}]`;
  if (fp.id) return `${tag}#${fp.id}`;
  if (fp.placeholder) return `${tag}[placeholder=${clip(fp.placeholder)}]`;
  return tag;
};

/** One short line per Bombadil action. */
export const describeAction = (action: unknown): string => {
  if (action === null || action === undefined) return 'start';
  if (typeof action === 'string') return action.toLowerCase();
  const [kind, body] = Object.entries(action as Record<string, Record<string, unknown>>)[0] ?? ['?', {}];
  switch (kind) {
    case 'Click':
      return `click ${describeTarget(body.fingerprint as Fingerprint)}`;
    case 'Custom':
      return `${body.name as string}(${((body.arguments as unknown[]) ?? []).map((a) => JSON.stringify(a)).join(', ')})`;
    case 'TypeText':
      return `type ${String(body.text ?? '').length} chars`;
    case 'ScrollDown':
    case 'ScrollUp':
      return `scroll ${kind === 'ScrollDown' ? 'down' : 'up'} ${Math.round(Number(body.distance ?? 0))}px`;
    case 'PressKey':
      return `press key ${String(body.code)}`;
    default:
      return kind.toLowerCase();
  }
};
