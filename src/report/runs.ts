import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { CallOutcome } from '../app/faults.ts';
import { describeAction, detailKey, detailText, findingId, routeTemplate, type Snapshot } from './findings.ts';
import { readRunRecord, type RunRecord } from './record.ts';

export interface Step {
  at: string;
  action: string;
  route: string;
}

/** One finding as seen in one run. */
export interface RunFinding {
  id: string;
  project: string;
  property: string;
  route: string;
  /** Identity part of the fingerprint, digits blurred. */
  detail: string;
  /** The first string the violation carried, as it was. */
  summary: string;
  /** States that violated it in this run. */
  count: number;
  first_at: string;
  url: string;
  snapshots: Snapshot[];
  /** The actions that led to the first violation, oldest first. */
  steps: Step[];
  /** Absolute screenshot paths for the last states up to the violation. */
  frames: string[];
}

/** Which mock API endpoints were called, and how the calls ended (the spec's `api` extractor). */
export interface ApiCoverage {
  /** Per endpoint key, calls per outcome. */
  calls: Record<string, Partial<Record<CallOutcome, number>>>;
  /** Per endpoint key, the named responses it answered with, sorted. */
  variants: Record<string, string[]>;
  /** The mock's endpoints (window.__mockEndpoints) and their variants, called or not. */
  inventory: Record<string, string[]>;
}

export interface RunResult {
  /** `<project>/<run dir name>`, unique across the runs root. */
  id: string;
  dir: string;
  /** Its run.json (record.ts). */
  meta: RunRecord;
  actions: number;
  /** States seen per route. */
  routes: Record<string, number>;
  /** Repo-relative source files the run rendered, sorted (the spec's `rendered` extractor). */
  rendered: string[];
  /** Absent when the spec doesn't export the `api` extractor. */
  api?: ApiCoverage;
  /** Times each milestone was reached (the spec's `milestones` extractor); absent when the spec has none. */
  milestones?: Record<string, number>;
  findings: RunFinding[];
}

interface TraceRow {
  timestamp: number;
  action: unknown;
  state: { url: string; screenshot?: string | null };
  snapshots?: { name: string | null; value: unknown }[];
  violations: { name: string; violation: unknown }[];
}

const iso = (micros: number): string => new Date(Math.floor(micros / 1000)).toISOString();

// Every snapshot inside a violation, wherever the formula put it.
const snapshotsIn = (node: unknown, out: Snapshot[] = []): Snapshot[] => {
  if (Array.isArray(node)) {
    for (const n of node) snapshotsIn(n, out);
  } else if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if ((key === 'snapshots' || key === 'antecedent_snapshots') && Array.isArray(value)) {
        for (const s of value as { name?: string | null; value: unknown }[]) out.push({ name: s.name ?? null, value: s.value });
      } else {
        snapshotsIn(value, out);
      }
    }
  }
  return out;
};

/**
 * The endpoint a call key belongs to. `METHOD /path` keys (createFaultInjector's)
 * carry the concrete path: matched against the inventory's templates for that
 * method, else with ids blurred, as routes are. Other keys are kept as they are.
 */
export const endpointKey = (key: string, inventory: readonly string[]): string => {
  const m = /^([A-Z]+) (\/\S*)$/.exec(key);
  if (!m || inventory.includes(key)) return key;
  const [, method, path] = m;
  const templates = inventory.filter((k) => k.startsWith(`${method} /`)).map((k) => k.slice(method!.length + 1));
  return `${method} ${routeTemplate(path!.split('?')[0]!, templates)}`;
};

type ApiSnap = { calls?: { key: string; variant?: string; outcome: CallOutcome }[]; inventory?: { key: string; variants?: string[] }[] };

const readApi = (snaps: ApiSnap[]): ApiCoverage | undefined => {
  if (snaps.length === 0) return undefined;
  const inventory: Record<string, Set<string>> = {};
  for (const s of snaps) {
    for (const e of s.inventory ?? []) {
      const known = (inventory[e.key] ??= new Set());
      for (const v of e.variants ?? []) known.add(v);
    }
  }
  const known = Object.keys(inventory);
  const calls: ApiCoverage['calls'] = {};
  const variants: Record<string, Set<string>> = {};
  for (const s of snaps) {
    for (const c of s.calls ?? []) {
      const key = endpointKey(c.key, known);
      const outcomes = (calls[key] ??= {});
      outcomes[c.outcome] = (outcomes[c.outcome] ?? 0) + 1;
      if (c.variant !== undefined) (variants[key] ??= new Set()).add(c.variant);
    }
  }
  const sorted = (r: Record<string, Set<string>>) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, [...v].sort()]));
  return { calls, variants: sorted(variants), inventory: sorted(inventory) };
};

const STEPS = 8;
const FRAMES = 3;

/** One run directory, read. `meta` is its run.json, when the caller has read it already. */
export const readRun = (dir: string, knownRoutes: readonly string[], meta: RunRecord = readRunRecord(dir)): RunResult => {
  const rows: TraceRow[] = readFileSync(join(dir, 'trace.jsonl'), 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as TraceRow);

  const routes: Record<string, number> = {};
  const rendered = new Set<string>();
  const api: ApiSnap[] = [];
  let milestones: Record<string, number> | undefined;
  const byId = new Map<string, RunFinding>();
  const frame = (r: TraceRow): string | undefined => {
    const name = r.state.screenshot ? basename(r.state.screenshot) : undefined;
    const path = name ? join(dir, 'screenshots', name) : undefined;
    return path && existsSync(path) ? path : undefined;
  };

  rows.forEach((r, i) => {
    const route = routeTemplate(r.state.url, knownRoutes);
    routes[route] = (routes[route] ?? 0) + 1;
    for (const snap of r.snapshots ?? []) {
      if (snap.name === 'api' && snap.value && typeof snap.value === 'object') api.push(snap.value as ApiSnap);
      if (snap.name === 'milestones' && Array.isArray(snap.value)) {
        milestones ??= {};
        for (const name of snap.value) if (typeof name === 'string') milestones[name] = (milestones[name] ?? 0) + 1;
      }
      if (snap.name !== 'rendered') continue;
      for (const file of (snap.value as { fresh?: string[] } | null)?.fresh ?? []) rendered.add(file);
    }

    for (const v of r.violations ?? []) {
      const snapshots = snapshotsIn(v.violation);
      const detail = detailKey(snapshots);
      const id = findingId(meta.project, v.name, route, detail);
      const seen = byId.get(id);
      if (seen) {
        seen.count += 1;
        continue;
      }
      const window = rows.slice(Math.max(0, i - STEPS + 1), i + 1);
      byId.set(id, {
        id,
        project: meta.project,
        property: v.name,
        route,
        detail,
        summary: detailText(snapshots),
        count: 1,
        first_at: iso(r.timestamp),
        url: r.state.url,
        snapshots,
        steps: window.map((w) => ({ at: iso(w.timestamp), action: describeAction(w.action), route: routeTemplate(w.state.url, knownRoutes) })),
        frames: window.map(frame).filter((f): f is string => f !== undefined).slice(-FRAMES),
      });
    }
  });

  return {
    id: `${meta.project}/${basename(dir)}`,
    dir,
    meta,
    actions: rows.filter((r) => r.action !== null).length,
    routes,
    rendered: [...rendered].sort(),
    ...(api.length ? { api: readApi(api)! } : {}),
    ...(milestones ? { milestones } : {}),
    findings: [...byId.values()],
  };
};

/** Every run directory (one holding run.json and trace.jsonl) under `<root>/<project>/`. */
export const listRuns = (root: string): string[] => {
  if (!existsSync(root)) return [];
  const dirs: string[] = [];
  for (const project of readdirSync(root, { withFileTypes: true })) {
    if (!project.isDirectory()) continue;
    for (const run of readdirSync(join(root, project.name), { withFileTypes: true })) {
      const dir = join(root, project.name, run.name);
      if (run.isDirectory() && existsSync(join(dir, 'run.json')) && existsSync(join(dir, 'trace.jsonl'))) dirs.push(dir);
    }
  }
  return dirs.sort();
};
