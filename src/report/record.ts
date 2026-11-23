import { readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';

/**
 * run.json: the record `bombadil-kit run` writes beside each run's trace, and
 * everything else reads (the report, its state, `--reproduce`). This module is
 * its one owner: the schema, building a record from a sweep's settings and a
 * flow's result, parsing one back, and what a record says to run next.
 */
export const RUN_SCHEMA = 'bombadil-run/v1';

export type TargetKind = 'mock' | 'live';

/**
 * What the run ran against. A live run records only what the runner controls:
 * its flow and viewport. Older runs may lack any field.
 */
export type RunTarget = {
  kind?: TargetKind;
  flow?: string;
  faults?: number;
  latency_ms?: number;
  /** `<width>x<height>`. */
  viewport?: string;
  mock_ref_date?: string;
};

export interface RunRecord {
  /** Absent in runs from before the kit wrote it. */
  schema?: typeof RUN_SCHEMA;
  project: string;
  /** Repo-relative. */
  spec: string;
  seed: number;
  start: string;
  started_at: string;
  commit: string;
  target: RunTarget;
  bombadil: string;
  exit_code: number;
  /** How long it explored, as it was given. */
  time_limit?: string;
  /** How to run it again, from the repo root. */
  command?: string;
  /** The flow it ran (bombadil/flows.json); runs from before flows have none. */
  flow?: string;
  /** The milestones its flow declares (flows.json `milestones`); absent when none. */
  expected_milestones?: string[];
  /** What the run handed Bombadil after `--`; absent when there was nothing. */
  bombadil_args?: string[];
  /** How to replay this run's trace, from the repo root; runs from before it have none. */
  replay?: string;
  /**
   * Set on a `--reproduce` run: the run directory it replayed, repo-relative.
   * A replay can stop early (Bombadil's "diverged"), so it reaches routes
   * without testing them: the report lists it but never counts it as a sweep.
   */
  replay_of?: string;
}

/** What every run of one sweep shares. */
export interface SweepFacts {
  project: string;
  /** The config has several projects, so the commands a record carries name this one. */
  named: boolean;
  kind: TargetKind;
  seed: number;
  faults: number;
  latency: number;
  refDate: string;
  time: string;
  width: number;
  height: number;
  commit: string;
  /** Bombadil's version. */
  bombadil: string;
  /** What was handed to Bombadil after `--`. */
  bombadilArgs?: string[];
  /** The run directory a replay replays, repo-relative. */
  replayOf?: string;
}

/** One flow's run within the sweep. */
export interface FlowRun {
  flow: string;
  milestones?: string[];
  /** Repo-relative. */
  spec: string;
  /** The run directory, repo-relative. */
  dir: string;
  /** The start path, placeholders filled. */
  start: string;
  startedAt: string;
  exitCode: number;
}

const projectArgs = (r: Pick<RunRecord, 'project'>, named: boolean) => (named ? ['--project', r.project] : []);

/** `{ width, height }` from a target's `WxH` viewport; undefined without one. */
export const viewportOf = (t: RunTarget): { width: number; height: number } | undefined => {
  const m = /^(\d+)x(\d+)$/.exec(t.viewport ?? '');
  return m ? { width: Number(m[1]), height: Number(m[2]) } : undefined;
};

/**
 * The command that runs this record's flow again: with a mock, the same seed,
 * faults and data; live, only the same flow and viewport. What was handed to
 * Bombadil after `--` is handed again.
 */
export const rerunCommand = (r: RunRecord, named = false): string => {
  const v = viewportOf(r.target);
  const extra = r.bombadil_args ?? [];
  return [
    'npx bombadil-kit run', ...projectArgs(r, named), '--flow', r.flow,
    ...(r.target.kind === 'live' ? [] : ['--seed', r.seed, '--faults', r.target.faults, '--ref-date', r.target.mock_ref_date]),
    '--time', r.time_limit, '--width', v?.width, '--height', v?.height,
    ...(extra.length ? ['--', ...extra] : []),
  ].join(' ');
};

/**
 * The command that replays one run's trace: only the run directory. A replay
 * takes its seed, faults, viewport and the rest from that run's run.json.
 */
export const replayCommand = (dir: string, project: string[] = []): string =>
  ['npx bombadil-kit run', ...project, '--reproduce', dir].join(' ');

/** The record for one flow's run in a sweep, its rerun and replay commands included. */
export const buildRun = (s: SweepFacts, f: FlowRun): RunRecord => {
  const viewport = `${s.width}x${s.height}`;
  const target: RunTarget =
    s.kind === 'live'
      ? { kind: s.kind, flow: f.flow, viewport }
      : { kind: s.kind, flow: f.flow, faults: s.faults, latency_ms: s.latency, viewport, mock_ref_date: s.refDate };
  const record: RunRecord = {
    schema: RUN_SCHEMA,
    project: s.project,
    spec: f.spec,
    flow: f.flow,
    seed: s.seed,
    start: f.start,
    started_at: f.startedAt,
    commit: s.commit,
    target,
    bombadil: s.bombadil,
    exit_code: f.exitCode,
    time_limit: s.time,
  };
  return {
    ...record,
    command: rerunCommand({ ...record, bombadil_args: s.bombadilArgs }, s.named),
    ...(f.milestones?.length ? { expected_milestones: f.milestones } : {}),
    ...(s.bombadilArgs?.length ? { bombadil_args: s.bombadilArgs } : {}),
    replay: replayCommand(f.dir, projectArgs(record, s.named)),
    ...(s.replayOf ? { replay_of: s.replayOf } : {}),
  };
};

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** A run.json's content, checked: what the kit reads must be there and of its type. `where` names it in errors. */
export const parseRun = (json: unknown, where = 'run.json'): RunRecord => {
  const bad = (why: string): never => {
    throw new Error(`${where}: ${why}`);
  };
  if (!isObject(json)) return bad('not an object');
  const want = (key: string, type: 'string' | 'number', required: boolean) => {
    const v = json[key];
    if (v === undefined ? required : typeof v !== type) bad(`${key} must be a ${type}, not ${JSON.stringify(v)}`);
  };
  for (const key of ['project', 'spec', 'start', 'started_at', 'commit', 'bombadil']) want(key, 'string', true);
  for (const key of ['seed', 'exit_code']) want(key, 'number', true);
  for (const key of ['time_limit', 'command', 'flow', 'replay', 'replay_of']) want(key, 'string', false);
  if (json.schema !== undefined && json.schema !== RUN_SCHEMA) bad(`schema ${JSON.stringify(json.schema)} is not ${RUN_SCHEMA}`);
  for (const key of ['expected_milestones', 'bombadil_args']) {
    const v = json[key];
    if (v !== undefined && !(Array.isArray(v) && v.every((s) => typeof s === 'string'))) bad(`${key} must be a list of strings`);
  }
  const t = json.target;
  if (!isObject(t)) return bad('target must be an object');
  if (t.kind !== undefined && t.kind !== 'mock' && t.kind !== 'live') bad(`target.kind must be mock or live, not ${JSON.stringify(t.kind)}`);
  if (t.viewport !== undefined && !viewportOf(t as RunTarget)) bad(`target.viewport must be <width>x<height>, not ${JSON.stringify(t.viewport)}`);
  for (const key of ['faults', 'latency_ms']) if (t[key] !== undefined && typeof t[key] !== 'number') bad(`target.${key} must be a number`);
  for (const key of ['flow', 'mock_ref_date']) if (t[key] !== undefined && typeof t[key] !== 'string') bad(`target.${key} must be a string`);
  return json as unknown as RunRecord;
};

/** The record in run directory `dir`. */
export const readRunRecord = (dir: string): RunRecord => {
  const file = join(dir, 'run.json');
  return parseRun(JSON.parse(readFileSync(file, 'utf8')), file);
};

export const writeRunRecord = (dir: string, r: RunRecord): void => {
  writeFileSync(join(dir, 'run.json'), `${JSON.stringify(r, null, 2)}\n`);
};

/** What a replay runs with: the recorded run's flow, spec, seed, faults, latency, date and viewport. */
export interface ReplaySettings {
  flows: string[];
  /** Relative to the project's specs dir, without `.ts`. */
  spec: string;
  seed: number;
  time?: string;
  width?: number;
  height?: number;
  faults?: number;
  latency?: number;
  refDate?: string;
  /** The run directory replayed, repo-relative, when one was given. */
  replayOf?: string;
}

/** The project a replay runs in: the one its record names. A `--project` beside it must agree. */
export const replayProject = (r: Pick<RunRecord, 'project'>, given?: string): string => {
  if (given && given !== r.project) throw new Error(`that run is project ${r.project}, not ${given}`);
  return r.project;
};

/**
 * `--reproduce <run dir>`: what that run's record says to run it with. The
 * spec is named relative to `specs`, the project's specs dir as the repo root
 * sees it: a spec outside it is an error, not a fallback to the flow's. Given
 * `dir`, the replay records it as the run it replays.
 */
export const replaySettings = (r: RunRecord, specs: string, dir?: string): ReplaySettings => {
  const rel = relative(specs, r.spec);
  if (rel.startsWith('..') || isAbsolute(rel) || !rel.endsWith('.ts')) {
    throw new Error(`the run's spec ${r.spec} is not under ${specs}, the project's specs dir`);
  }
  const v = viewportOf(r.target);
  const live = r.target.kind === 'live';
  return {
    flows: r.flow ? [r.flow] : [],
    spec: rel.slice(0, -'.ts'.length),
    seed: r.seed,
    time: r.time_limit,
    width: v?.width,
    height: v?.height,
    ...(live ? {} : { faults: r.target.faults, latency: r.target.latency_ms, refDate: r.target.mock_ref_date }),
    ...(dir ? { replayOf: dir } : {}),
  };
};
