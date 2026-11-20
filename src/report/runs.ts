import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { describeAction, detailKey, detailText, findingId, routeTemplate, type Snapshot } from './findings.ts';

/** What scripts/bombadil.sh writes next to each run's trace. */
export interface RunMeta {
  project: string;
  spec: string;
  seed: number;
  start: string;
  started_at: string;
  commit: string;
  target: Record<string, unknown>;
  bombadil: string;
  exit_code: number;
  /** How to run it again, from the repo root. */
  command?: string;
  /** The flow it ran (bombadil/flows.json); runs from before flows have none. */
  flow?: string;
}

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

export interface RunResult {
  /** `<project>/<run dir name>`, unique across the runs root. */
  id: string;
  dir: string;
  meta: RunMeta;
  actions: number;
  /** States seen per route. */
  routes: Record<string, number>;
  /** Repo-relative source files the run rendered, sorted (the spec's `rendered` extractor). */
  rendered: string[];
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

const STEPS = 8;
const FRAMES = 3;

export const readRun = (dir: string, knownRoutes: readonly string[]): RunResult => {
  const meta = JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8')) as RunMeta;
  const rows: TraceRow[] = readFileSync(join(dir, 'trace.jsonl'), 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as TraceRow);

  const routes: Record<string, number> = {};
  const rendered = new Set<string>();
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
