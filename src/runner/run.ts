import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fill, projectRoutes, readFlows, specsDir, type Flow, type Loaded, type ProjectConfig } from '../config.ts';
import { buildRun, readRunRecord, replayProject, replaySettings, writeRunRecord, type RunRecord } from '../report/record.ts';
import { generate } from '../report/generate.ts';
import { summaryLine } from '../report/report.ts';
import { realProcesses, type Processes, type Server } from './processes.ts';

export interface RunOptions {
  project: string;
  flows: string[];
  spec?: string;
  time?: string;
  faults?: number;
  seed?: number;
  latency?: number;
  refDate?: string;
  headed?: boolean;
  sandbox?: boolean;
  baseline?: string;
  width?: number;
  height?: number;
  port?: number;
  /** Extra arguments for `bombadil browser test`, after `--`. */
  bombadilArgs?: string[];
  /** `--reproduce <run dir>`: replay that run instead of exploring. */
  reproduce?: string;
  /** Use a server already on the port instead of failing; `server.reuse`. */
  reuseServer?: boolean;
  /** false (`--no-report`): leave the runs for one `bombadil-kit report` later, as parallel sweeps do. */
  report?: boolean;
  /** The trace to replay, absolute; set by --reproduce, off the CLI's surface. */
  replay?: string;
  /** The run directory being replayed, repo-relative: run.json's `replay_of`. */
  replayOf?: string;
}

/** Rebuilds `<out>/report` from `<out>/runs`, as `bombadil-kit report` does with its defaults. */
export const sweepReport = (loaded: Loaded, baseline?: string, now = new Date().toISOString()) =>
  generate({
    runsRoot: join(loaded.out, 'runs'),
    out: join(loaded.out, 'report'),
    repoRoot: loaded.root,
    now,
    title: loaded.config.title,
    baseline,
    routes: projectRoutes(loaded),
  }).report;

/** After a sweep's runs: rebuild the report, or with `--no-report` say how to. The lines for stderr. */
export const sweepEnd = (loaded: Loaded, o: Pick<RunOptions, 'baseline' | 'report'>): string[] => {
  if (o.report === false) return [`--no-report: runs are in ${join(loaded.out, 'runs')}; \`bombadil-kit report\` folds them in`];
  try {
    const report = sweepReport(loaded, o.baseline);
    return [summaryLine(report), `→ ${join(loaded.out, 'report', 'index.html')}`];
  } catch (err) {
    return [`report: ${(err as Error).message}`];
  }
};

const stamp = (d = new Date()) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

const bombadilBin = (root: string) => {
  const local = join(root, 'node_modules/.bin/bombadil');
  return existsSync(local) ? local : 'bombadil';
};

/** Selects flows by name, in flows.json order; unknown names throw. */
export const selectFlows = (all: Flow[], want: string[]): Flow[] => {
  const unknown = want.filter((w) => !all.some((f) => f.name === w));
  if (unknown.length) throw new Error(`no flow named ${unknown.join(', ')} (see --list)`);
  return all.filter((f) => want.length === 0 || want.includes(f.name));
};

/** The `bombadil browser test` arguments for one flow. */
export const bombadilArgs = (o: {
  origin: string;
  flow: Flow;
  specFile: string;
  outDir: string;
  time: string;
  width: number;
  height: number;
  headless: boolean;
  sandbox: boolean;
  signedInCookie?: string;
  root: string;
  appDir: string;
  /** What `{seed}` `{faults}` `{latency}` `{refDate}` in `flow.start` become. */
  values?: Record<string, string | number>;
  /** Extra arguments from `--`, before the URL and the spec. */
  extra?: string[];
  /** `--reproduce <dir>`: replay a trace, so no time limit and no early exit. */
  replay?: string;
  seed?: number;
  faults?: number;
  refDate?: string;
}): string[] => {
  // Bombadil refuses --reproduce beside --time-limit and --exit-on-violation.
  const replay = o.replay !== undefined;
  const args = ['browser', 'test', ...(replay ? [] : ['--time-limit', o.time]), '--width', String(o.width), '--height', String(o.height), '--output-path', o.outDir];
  if (o.headless) args.push('--headless');
  if (!o.sandbox) args.push('--no-sandbox');
  if (replay) args.push('--reproduce', o.replay!);
  for (const pattern of o.flow.allow) args.push('--allow-url', `${o.origin}${pattern}`);
  if (o.flow.signedIn) {
    if (!o.signedInCookie) throw new Error(`flow ${o.flow.name} is signedIn but the project has no signedInCookie`);
    args.push('--cookie', o.signedInCookie);
  }
  // What the spec library reads (spec/index.ts): the fence, which pushState
  // navigations never show --allow-url, and where source files live.
  args.push('--cookie', `fuzz_fence=${encodeURIComponent(o.flow.allow.join(','))}`);
  args.push('--cookie', `fuzz_root=${encodeURIComponent(o.root)}`);
  args.push('--cookie', `fuzz_app=${encodeURIComponent(o.appDir)}`);
  // What an app's mock reads when server.env can't reach import.meta.env: a
  // prebuilt static bundle sees only the URL and the cookies.
  if (o.seed !== undefined) args.push('--cookie', `fuzz_seed=${o.seed}`);
  if (o.faults !== undefined) args.push('--cookie', `fuzz_faults=${o.faults}`);
  if (o.refDate !== undefined) args.push('--cookie', `fuzz_ref_date=${o.refDate}`);
  // Everything the user put after `--`, as they wrote it: Bombadil reads it, and
  // refuses a --reproduce beside --exit-on-violation, which is its business.
  args.push(...(o.extra ?? []));
  // The start is filled like server.command is, {port} included: a flow that
  // says /?world={seed} starts the app's mock at the run's seed.
  const port = Number(new URL(o.origin).port) || '';
  args.push(`${o.origin}${fill(o.flow.start, { port, ...o.values })}`, o.specFile);
  return args;
};

type Target = NonNullable<ProjectConfig['target']>;

/** What a sweep runs with: options, then the project's defaults. A live project defaults to no faults and refuses any. */
export const sweepSettings = (p: Pick<ProjectConfig, 'target' | 'defaults'>, o: Partial<RunOptions>) => {
  const live = p.target === 'live';
  const faults = o.faults ?? p.defaults?.faults ?? (live ? 0 : 0.1);
  if (live && faults > 0) throw new Error('a live project has no fault injector: faults need the mock (target: "mock")');
  return { time: o.time ?? p.defaults?.time ?? '1m', faults, latency: o.latency ?? p.defaults?.latency ?? 50 };
};

/**
 * Waits for a server we spawned. `ready` once something answers and our
 * process is still running `settle` ms later: between the free-port check and
 * our server binding, another one (a second worktree's sweep) can take the
 * port; ours then exits on --strictPort, and that one answers. `taken` is
 * that; `exited`, ours died before anything answered; `timeout`, nothing did.
 */
const waitForServer = async (procs: Processes, server: Server, url: string, tries = 120, interval = 500, settle = 1000) => {
  for (let i = 0; i < tries; i++) {
    if (server.exited()) return 'exited';
    if (await procs.answers(url)) {
      await procs.sleep(settle);
      return server.exited() ? 'taken' : 'ready';
    }
    await procs.sleep(interval);
  }
  return 'timeout';
};

/** What one sweep produced. */
export interface SweepResult {
  /**
   * The exit status, which nothing remaps: 2 if any flow found a property
   * violation, 1 if a flow's Bombadil failed otherwise or the sweep itself
   * did (a bad option, no spec, a server that never came up), 0 clean.
   */
  status: 0 | 1 | 2;
  /** Each run the sweep recorded, in flow order: its directory and its run.json. */
  runs: { dir: string; record: RunRecord }[];
}

/** A flow's Bombadil exit code folded into the sweep's status: a violation outranks a failure. */
const fold = (status: SweepResult['status'], rc: number): SweepResult['status'] => (rc === 0 ? status : rc === 2 ? 2 : status === 0 ? 1 : status);

/**
 * One sweep: starts the dev server once, runs Bombadil once per flow, writes
 * each run's run.json, stops the server, rebuilds the report once. With
 * `reproduce`, replays that run instead. Never throws: whatever goes wrong is
 * said on stderr and is status 1. Child processes go through `procs`.
 */
export const run = async (loaded: Loaded, o: RunOptions, procs: Processes = realProcesses): Promise<SweepResult> => {
  const runs: SweepResult['runs'] = [];
  try {
    const status = await sweep(loaded, o.reproduce ? replay(loaded, o) : o, procs, runs);
    return { status, runs };
  } catch (err) {
    console.error(`bombadil-kit run: ${(err as Error).message}`);
    return { status: 1, runs };
  }
};

const sweep = async (loaded: Loaded, o: RunOptions, procs: Processes, runs: SweepResult['runs']): Promise<SweepResult['status']> => {
  const { root, config, out } = loaded;
  const p: ProjectConfig | undefined = config.projects[o.project];
  if (!p) throw new Error(`no project ${o.project} in bombadil-kit.json`);
  const flows = selectFlows(readFlows(root, p), o.flows);
  const kind: Target = p.target ?? 'mock';
  const { time, faults, latency } = sweepSettings(p, o);
  const seed = o.seed ?? Math.floor(Math.random() * 32768);
  const refDate = o.refDate ?? new Date().toISOString().slice(0, 10);
  const width = o.width ?? p.viewport?.width ?? 390;
  const height = o.height ?? p.viewport?.height ?? 844;
  const port = o.port ?? p.server.port ?? 5199;
  const origin = `http://127.0.0.1:${port}`;
  const bombadil = bombadilBin(root);
  const quiet = (p.quiet ?? []).map((q) => new RegExp(q));
  // Every flow's spec, before anything starts: a missing one is a mistake, not a run.
  const planned = flows.map((flow) => {
    const specFile = join(specsDir(root, p), `${o.spec ?? flow.spec ?? p.spec ?? 'spec'}.ts`);
    if (!existsSync(specFile)) throw new Error(`no spec at ${specFile}`);
    return { flow, specFile };
  });

  const reuse = o.reuseServer ?? p.server.reuse ?? false;
  // Something already on the port is an error unless reuse was asked for;
  // reusing means server.command and server.env never run.
  const busy = await procs.answers(`${origin}/`);
  if (busy && !reuse) throw new Error(`something is already serving ${origin}; stop it or pass --port or --reuse-server`);
  const spawned = !busy;

  const runsDir = join(out, 'runs', o.project);
  mkdirSync(runsDir, { recursive: true });
  const at = stamp();
  const logPath = join(runsDir, `${at}-s${seed}.server.log`);
  const values = { port, seed, faults, latency, refDate };
  let server: Server | undefined;
  if (spawned) {
    const [command, ...args] = p.server.command.map((part) => fill(part, values));
    const env = { ...process.env, ...Object.fromEntries(Object.entries(p.server.env ?? {}).map(([k, v]) => [k, fill(v, values)])) };
    server = procs.startServer({ command: command!, args, cwd: join(root, p.dir), env, log: logPath });
  } else {
    // Someone else's server: the log stays empty, and stopping is not ours to do.
    writeFileSync(logPath, '');
    console.error(`reusing the server on ${origin}: server.command and server.env never ran, so {seed}, {faults}, {latency} and {refDate} were not applied to it`);
  }
  const untrap = procs.onInterrupt(() => server?.stop());

  try {
    const ready = `${origin}${p.server.ready ?? '/'}`;
    if (server) {
      const state = await waitForServer(procs, server, ready);
      if (state === 'exited') throw new Error(`the server exited; see ${logPath}`);
      if (state === 'taken') throw new Error(`another server took ${origin} as ours started, and ours exited; pass another --port (see ${logPath})`);
      if (state === 'timeout') throw new Error(`the server never came up; see ${logPath}`);
    } else if (!(await procs.answers(ready))) throw new Error(`nothing answers ${ready}; the server on ${origin} is not the app`);

    let commit = procs.git(root, ['rev-parse', '--short', 'HEAD']) || 'unknown';
    if (procs.git(root, ['status', '--porcelain', '--', ...(p.watch ?? [p.dir])])) commit += '-dirty';
    const facts = {
      project: o.project, named: Object.keys(config.projects).length > 1, kind,
      seed, faults, latency, refDate, time, width, height, commit, bombadil: procs.bombadilVersion(bombadil),
      bombadilArgs: o.bombadilArgs, replayOf: o.replayOf,
    };

    let status: SweepResult['status'] = 0;
    for (const { flow, specFile } of planned) {
      const outDir = join(runsDir, `${at}-s${seed}-${flow.name}`);
      mkdirSync(outDir, { recursive: true });
      const args = bombadilArgs({
        origin, flow, specFile, outDir, time, width, height,
        headless: !o.headed, sandbox: o.sandbox !== false,
        signedInCookie: p.signedInCookie, root, appDir: p.dir,
        values, seed, faults, refDate,
        extra: o.bombadilArgs,
        replay: o.replay,
      });

      const start = fill(flow.start, values);
      console.error(`→ ${flow.name}: ${origin}${start}${o.replay ? ' (replay)' : ` for ${time}`} (${kind === 'live' ? 'live backend' : `faults ${faults}, seed ${seed}`})`);
      // The server log is the sweep's; each run keeps the part written while it ran.
      const mark = statSync(logPath).size;
      const startedAt = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
      const rc = await procs.bombadil({
        bin: bombadil, args, cwd: root,
        line: (line) => void (quiet.some((q) => q.test(line)) || process.stderr.write(`${line}\n`)),
      });
      writeFileSync(join(outDir, 'app.log'), readFileSync(logPath).subarray(mark));
      if (rc === 0) console.error('  ✓ no violations');
      else if (rc === 2) console.error(`  ✗ property violation: npx bombadil browser inspect ${outDir}`);
      else console.error(`  ✗ bombadil exited ${rc}`);
      status = fold(status, rc);

      const record = buildRun(facts, {
        flow: flow.name, milestones: flow.milestones, spec: relative(root, specFile), dir: relative(root, outDir), start, startedAt, exitCode: rc,
      });
      writeRunRecord(outDir, record);
      runs.push({ dir: outDir, record });
    }
    server?.stop();

    // One report rebuild for all the flows: they are one sweep.
    for (const line of sweepEnd(loaded, o)) console.error(line);
    return status;
  } finally {
    server?.stop();
    untrap();
  }
};

/**
 * `--reproduce <run dir>`: the options that restart the server with the
 * recorded run's seed, faults, latency, reference date and viewport, and
 * replay its trace with Bombadil on the same flow and spec. Everything else
 * comes from the run's project as it is configured now.
 */
const replay = (loaded: Loaded, o: RunOptions): RunOptions => {
  const dir = resolve(loaded.root, o.reproduce!);
  if (!existsSync(join(dir, 'run.json'))) throw new Error(`no run.json in ${dir}`);
  const meta = readRunRecord(dir);
  const trace = join(dir, 'trace.jsonl');
  if (!existsSync(trace)) throw new Error(`${dir} has no trace.jsonl to replay`);
  const project = replayProject(meta, o.project || undefined);
  const p = loaded.config.projects[project];
  if (!p) throw new Error(`run ${dir} is project ${project}, which bombadil-kit.json has no entry for`);
  const options = replaySettings(meta, relative(loaded.root, specsDir(loaded.root, p)), relative(loaded.root, dir));
  console.error(`→ replaying ${dir} (${project}, seed ${meta.seed})`);
  // Bombadil replays the trace itself, so nothing from the original run's `--`
  // carries over: --exit-on-violation would stop a replay before its end.
  return { ...o, ...options, project, replay: trace, reproduce: undefined, bombadilArgs: [] };
};
