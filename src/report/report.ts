import type { RunTarget } from './record.ts';
import type { ProjectInfo } from './project.ts';
import type { Snapshot } from './findings.ts';
import type { ApiCoverage, Step } from './runs.ts';
import type { CallOutcome } from '../app/faults.ts';
import { mergeApi, statusOf, type FindingRecord, type FlowMilestones, type RunInfo, type State, type Status } from './state.ts';

/**
 * report.json (schema bombadil-report/v1): the view of state.json that the
 * HTML report renders and agents read. findings.ndjson holds the same finding
 * objects, one per line.
 */
export interface ReportFinding {
  schema: 'bombadil-report/v1';
  id: string;
  project: string;
  property: string;
  status: Status;
  /** Sweeps since it was last seen that reached its route. */
  clean_sweeps: number;
  route: string;
  url: string;
  /** The first string the violation carried: a request line, a console message, an exception. */
  summary: string;
  first_seen: string;
  last_seen: string;
  /** Ids of the sweeps it was seen in. */
  sweeps: number[];
  /** Sweeps it was seen in, of the sweeps that ran its project. */
  seen_in: number;
  of_sweeps: number;
  runs_hit: number;
  target: RunTarget;
  repro: { seed: number; run: string; command: string; steps: Step[]; /** How to replay the run's trace; absent from a report built before it. */ replay?: string };
  /** inspect: Bombadil's viewer on the whole run (every state), from the repo root. */
  evidence: { frames: string[]; run_dir: string; inspect: string };
  snapshots: Snapshot[];
}

export interface ReportEndpoint {
  key: string;
  /** Flows whose runs called it, sorted. */
  flows: string[];
  /** Calls per outcome, every sweep so far. */
  outcomes: Partial<Record<CallOutcome, number>>;
  variantsSeen: string[];
  variantsKnown: string[];
  /** In the mock's inventory (window.__mockEndpoints); false for one only seen called. */
  known: boolean;
}

/** One flow's milestones, as of the latest sweep it ran in. */
export interface ReportFlowMilestones {
  flow: string;
  /** The flow's latest sweep, and the runs it had there. */
  sweep: number;
  runs: number;
  /** Whether that sweep's spec recorded milestones (called `milestones()`). */
  recorded: boolean;
  /** flows.json's milestones for the flow: times reached in that sweep, and per sweep before it (oldest first, the last 20). */
  expected: { name: string; reached: number; history: { sweep: number; reached: number }[] }[];
  /** Expected milestones that sweep never reached: a flow or its actions to improve, not a finding. */
  missed: string[];
  /** Milestones that sweep reached that the flow doesn't declare. */
  undeclared: { name: string; reached: number }[];
}

export interface ReportProject {
  name: string;
  spec: string;
  target: RunTarget;
  last_sweep: number;
  actions: number;
  properties: { name: string; open: string[] }[];
  routes: { template: string; states: number; known: boolean }[];
  /**
   * Mock API endpoints called, per the spec's `api` extractor: absent if no
   * run of the project had it. `reached` of the `known` inventory endpoints.
   */
  api?: { endpoints: ReportEndpoint[]; reached: number; known: number };
  /** Per flow with milestones expected or recorded; absent when none has. */
  milestones?: ReportFlowMilestones[];
  /** The latest sweep's runs, then the replays made since (`replay_of` set: no part of any sweep). */
  runs: { id: string; seed: number; actions: number; exit_code: number; started_at: string; command: string; replay_of?: string }[];
  history: { sweep: number; at: string; findings: number; actions: number }[];
}

/** Actions and route coverage over some projects, each as of its latest sweep. */
export interface SummaryScope {
  projects: string[];
  actions: number;
  /** Listed routes reached, of the routes listed (routes.json or `routes`). */
  routes: [number, number];
  /** Routes reached that the route list doesn't have: counted apart, never in `routes`. */
  extra_routes: number;
}

export interface Report {
  schema: 'bombadil-report/v1';
  generated_at: string;
  sweep: { id: number; at: string; commits: string[] };
  summary: {
    new: number; open: number; quiet: number; closed: number;
    /** The latest sweep's projects alone: `latest_sweep.actions` and `.routes`. */
    actions: number;
    routes: [number, number];
    /** The projects the latest sweep ran (absent in a report built before it). */
    latest_sweep?: SummaryScope;
    /** Every project, as of its own latest sweep: what the header shows (absent in a report built before it). */
    all?: SummaryScope;
  };
  projects: ReportProject[];
  findings: ReportFinding[];
}

export interface BuildOptions {
  generatedAt: string;
  /** Report-relative paths of a finding's evidence frames. */
  evidence: (f: FindingRecord) => string[];
  /** Where runs live, relative to the repo root (for the inspect command). */
  runsDir?: string;
}

/** A project's API coverage, every flow folded together; undefined without any. */
export const apiCoverage = (flows: Record<string, ApiCoverage> | undefined): ReportProject['api'] => {
  const entries = Object.entries(flows ?? {});
  if (entries.length === 0) return undefined;
  const all = entries.reduce<ApiCoverage | undefined>((acc, [, a]) => mergeApi(acc, a), undefined)!;
  const known = Object.keys(all.inventory).sort();
  const extra = Object.keys(all.calls).filter((k) => !(k in all.inventory)).sort();
  const endpoints = [...known, ...extra].map((key) => ({
    key,
    flows: entries.filter(([, a]) => key in a.calls).map(([flow]) => flow).sort(),
    outcomes: all.calls[key] ?? {},
    variantsSeen: all.variants[key] ?? [],
    variantsKnown: all.inventory[key] ?? [],
    known: key in all.inventory,
  }));
  return { endpoints, reached: known.filter((k) => k in all.calls).length, known: known.length };
};

const HISTORY = 20;

/** Each flow's milestones as of its latest sweep; undefined without any. */
export const flowMilestones = (flows: Record<string, FlowMilestones> | undefined): ReportFlowMilestones[] | undefined => {
  const out = Object.entries(flows ?? {}).flatMap(([flow, m]) => {
    const last = m.sweeps.at(-1);
    if (!last) return [];
    const recent = m.sweeps.slice(-HISTORY);
    const expected = m.expected.map((name) => ({
      name,
      reached: last.reached[name] ?? 0,
      history: recent.map((s) => ({ sweep: s.sweep, reached: s.reached[name] ?? 0 })),
    }));
    return [{
      flow,
      sweep: last.sweep,
      runs: last.runs,
      recorded: last.recorded,
      expected,
      missed: expected.filter((e) => e.reached === 0).map((e) => e.name),
      undeclared: Object.entries(last.reached)
        .filter(([name]) => !m.expected.includes(name))
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, reached]) => ({ name, reached })),
    }];
  });
  return out.length ? out : undefined;
};

/** A project's listed routes reached, of those listed, and the reached routes the list lacks. */
export const routeCoverage = (p: Pick<ReportProject, 'routes'>) => {
  const known = p.routes.filter((r) => r.known);
  return { reached: known.filter((r) => r.states > 0).length, known: known.length, extra: p.routes.filter((r) => !r.known && r.states > 0).length };
};

const scope = (projects: ReportProject[]): SummaryScope => {
  const cov = projects.map(routeCoverage);
  return {
    projects: projects.map((p) => p.name),
    actions: projects.reduce((n, p) => n + p.actions, 0),
    routes: [cov.reduce((n, c) => n + c.reached, 0), cov.reduce((n, c) => n + c.known, 0)],
    extra_routes: cov.reduce((n, c) => n + c.extra, 0),
  };
};

/** The one-line summary `run` and `report` print. */
export const summaryLine = (r: Report): string => {
  const s = r.summary;
  const all = s.all;
  const routes = all ? all.routes : s.routes;
  return `sweep ${r.sweep.id}: ${s.new} new, ${s.open} open, ${s.quiet} quiet, ${s.closed} closed · ${routes[0]}/${routes[1]} routes` +
    (all?.extra_routes ? ` (+${all.extra_routes} not in the route list)` : '') +
    (all && all.projects.length > 1 ? ` across ${all.projects.length} projects` : '');
};

const ORDER: Record<Status, number> = { new: 0, open: 1, quiet: 2, closed: 3 };

export const buildReport = (state: State, info: Record<string, ProjectInfo>, opts: BuildOptions): Report => {
  const latest = state.sweeps.at(-1);
  if (!latest) throw new Error('no sweeps yet: run the fuzzer first');

  const projectNames = [...new Set(state.sweeps.flatMap((s) => Object.keys(s.projects)))].sort();
  const sweepsOf = (project: string) => state.sweeps.filter((s) => s.projects[project]);
  const runInfo = (id: string): RunInfo | undefined => state.runs[id];

  const findings: ReportFinding[] = Object.values(state.findings)
    .map((f) => {
      const { status, clean } = statusOf(state, f.id);
      const run = runInfo(f.last.run);
      return {
        schema: 'bombadil-report/v1' as const,
        id: f.id,
        project: f.project,
        property: f.property,
        status,
        clean_sweeps: clean,
        route: f.route,
        url: f.last.url,
        summary: f.last.summary,
        first_seen: f.first_seen,
        last_seen: f.last_seen,
        sweeps: f.sweeps,
        seen_in: f.sweeps.length,
        of_sweeps: sweepsOf(f.project).length,
        runs_hit: f.runs_hit,
        target: run?.target ?? {},
        repro: { seed: f.last.seed, run: f.last.run, command: run?.command ?? '', steps: f.last.steps, ...(run?.replay ? { replay: run.replay } : {}) },
        evidence: {
          frames: opts.evidence(f),
          run_dir: f.last.run,
          inspect: `npx bombadil browser inspect ${opts.runsDir ?? 'tmp/bombadil/runs'}/${f.last.run}`,
        },
        snapshots: f.last.snapshots,
      };
    })
    .sort((a, b) => ORDER[a.status] - ORDER[b.status] || b.last_seen.localeCompare(a.last_seen));

  const projects: ReportProject[] = projectNames.map((name) => {
    const sweeps = sweepsOf(name);
    const last = sweeps.at(-1)!;
    const sp = last.projects[name]!;
    const pi = info[name] ?? { properties: [], routes: [] };
    const mine = findings.filter((f) => f.project === name);
    const isOpen = (f: ReportFinding) => f.status === 'new' || f.status === 'open';

    const propNames = [...pi.properties, ...new Set(mine.map((f) => f.property).filter((p) => !pi.properties.includes(p)))];
    const extraRoutes = Object.entries(sp.routes)
      .filter(([t]) => !pi.routes.includes(t))
      .sort((a, b) => b[1] - a[1]);
    const replays = Object.entries(state.runs)
      .filter(([id, r]) => r.replay_of && id.startsWith(`${name}/`) && r.sweep >= last.id)
      .map(([id]) => id);
    const runs = [...sp.runs, ...replays].map((id) => {
      const r = runInfo(id);
      return {
        id, seed: r?.seed ?? 0, actions: r?.actions ?? 0, exit_code: r?.exit_code ?? 0, started_at: r?.started_at ?? '', command: r?.command ?? '',
        ...(r?.replay_of ? { replay_of: r.replay_of } : {}),
      };
    });
    const firstRun = runInfo(sp.runs[0] ?? '');
    const api = apiCoverage(state.api?.[name]);
    const milestones = flowMilestones(state.milestones?.[name]);

    return {
      name,
      spec: firstRun?.spec ?? '',
      target: firstRun?.target ?? {},
      last_sweep: last.id,
      actions: sp.actions,
      properties: propNames.map((p) => ({ name: p, open: mine.filter((f) => f.property === p && isOpen(f)).map((f) => f.id) })),
      routes: [
        ...pi.routes.map((t) => ({ template: t, states: sp.routes[t] ?? 0, known: true })),
        ...extraRoutes.map(([t, states]) => ({ template: t, states, known: false })),
      ],
      ...(api ? { api } : {}),
      ...(milestones ? { milestones } : {}),
      runs,
      history: sweeps.map((s) => ({
        sweep: s.id,
        at: s.at,
        findings: Object.values(state.findings).filter((f) => f.project === name && f.sweeps.includes(s.id)).length,
        actions: s.projects[name]!.actions,
      })),
    };
  });

  const count = (s: Status) => findings.filter((f) => f.status === s).length;
  const latestSweep = scope(projects.filter((p) => p.last_sweep === latest.id));
  const all = scope(projects);
  return {
    schema: 'bombadil-report/v1',
    generated_at: opts.generatedAt,
    sweep: { id: latest.id, at: latest.at, commits: latest.commits },
    summary: {
      new: count('new'),
      open: count('open'),
      quiet: count('quiet'),
      closed: count('closed'),
      actions: latestSweep.actions,
      routes: latestSweep.routes,
      latest_sweep: latestSweep,
      all,
    },
    projects,
    findings,
  };
};
