import type { RunFinding, RunResult } from './runs.ts';

/**
 * state.json: the history that turns one run's violations into cases with a
 * life cycle. Every report is derived from it.
 *
 *   new     seen in the latest sweep, and in no earlier one
 *   open    seen in the latest sweep and an earlier one
 *   quiet   not seen in the latest sweep(s) that reached its route
 *   closed  not seen in CLOSE_AFTER sweeps in a row that reached its route
 *
 * A sweep that didn't run the project, or ran it without reaching the route,
 * says nothing about the finding and doesn't count as clean.
 */
export const CLOSE_AFTER = 3;

export interface SweepProject {
  runs: string[];
  actions: number;
  routes: Record<string, number>;
}

export interface Sweep {
  id: number;
  at: string;
  commits: string[];
  projects: Record<string, SweepProject>;
}

export interface Occurrence extends Omit<RunFinding, 'id' | 'project' | 'property' | 'route' | 'detail'> {
  run: string;
  seed: number;
  sweep: number;
}

export interface FindingRecord {
  id: string;
  project: string;
  property: string;
  route: string;
  detail: string;
  first_seen: string;
  last_seen: string;
  /** Sweep ids it was seen in. */
  sweeps: number[];
  /** Runs it was seen in, across all sweeps. */
  runs_hit: number;
  last: Occurrence;
}

/** What the report shows per run, kept so it outlives the run's directory. */
export interface RunInfo {
  sweep: number;
  seed: number;
  actions: number;
  exit_code: number;
  started_at: string;
  command: string;
  spec: string;
  target: Record<string, unknown>;
}

export interface State {
  schema: 'bombadil-state/v1';
  sweeps: Sweep[];
  runs: Record<string, RunInfo>;
  findings: Record<string, FindingRecord>;
  /** Per project, per flow: every source file any of its runs rendered. */
  coverage: Record<string, Record<string, string[]>>;
}

export const emptyState = (): State => ({ schema: 'bombadil-state/v1', sweeps: [], runs: {}, findings: {}, coverage: {} });

/** Adds the runs not yet in `state` as one new sweep. Returns `state` itself when there are none. */
export const applySweep = (state: State, runs: readonly RunResult[], at: string): State => {
  const fresh = runs.filter((r) => !(r.id in state.runs));
  if (fresh.length === 0) return state;

  const id = (state.sweeps.at(-1)?.id ?? 0) + 1;
  const projects: Record<string, SweepProject> = {};
  const findings: Record<string, FindingRecord> = structuredClone(state.findings);
  const coverage: State['coverage'] = structuredClone(state.coverage ?? {});

  for (const run of fresh) {
    const p = (projects[run.meta.project] ??= { runs: [], actions: 0, routes: {} });
    p.runs.push(run.id);
    p.actions += run.actions;
    for (const [route, n] of Object.entries(run.routes)) p.routes[route] = (p.routes[route] ?? 0) + n;
    const flows = (coverage[run.meta.project] ??= {});
    const flow = run.meta.flow ?? 'explore';
    flows[flow] = [...new Set([...(flows[flow] ?? []), ...(run.rendered ?? [])])].sort();

    for (const f of run.findings) {
      const { id: fid, project, property, route, detail, ...rest } = f;
      const occurrence: Occurrence = { ...rest, run: run.id, seed: run.meta.seed, sweep: id };
      const rec = findings[fid];
      if (rec) {
        if (!rec.sweeps.includes(id)) rec.sweeps.push(id);
        rec.runs_hit += 1;
        rec.last_seen = f.first_at > rec.last_seen ? f.first_at : rec.last_seen;
        rec.last = occurrence;
      } else {
        findings[fid] = { id: fid, project, property, route, detail, first_seen: f.first_at, last_seen: f.first_at, sweeps: [id], runs_hit: 1, last: occurrence };
      }
    }
  }

  const commits = [...new Set(fresh.map((r) => r.meta.commit))];
  return {
    ...state,
    sweeps: [...state.sweeps, { id, at, commits, projects }],
    runs: {
      ...state.runs,
      ...Object.fromEntries(
        fresh.map((r) => [
          r.id,
          { sweep: id, seed: r.meta.seed, actions: r.actions, exit_code: r.meta.exit_code, started_at: r.meta.started_at, command: r.meta.command ?? '', spec: r.meta.spec, target: r.meta.target },
        ]),
      ),
    },
    findings,
    coverage,
  };
};

export type Status = 'new' | 'open' | 'quiet' | 'closed';

export const statusOf = (state: State, id: string): { status: Status; clean: number } => {
  const f = state.findings[id];
  if (!f) throw new Error(`no finding ${id}`);
  const latest = state.sweeps.at(-1)!;
  if (f.sweeps.includes(latest.id)) return { status: f.sweeps.length === 1 ? 'new' : 'open', clean: 0 };

  // Count clean sweeps since it was last seen: ones that ran its project and reached its route.
  const lastSeen = Math.max(...f.sweeps);
  let clean = 0;
  for (const s of state.sweeps) {
    if (s.id <= lastSeen) continue;
    if ((s.projects[f.project]?.routes[f.route] ?? 0) > 0) clean += 1;
  }
  return { status: clean >= CLOSE_AFTER ? 'closed' : 'quiet', clean };
};
