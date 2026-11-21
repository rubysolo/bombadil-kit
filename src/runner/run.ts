import { spawn, execFileSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fill, readFlows, specsDir, type Flow, type Loaded, type ProjectConfig } from '../config.ts';
import type { RunMeta } from '../report/runs.ts';
import { generate } from '../report/generate.ts';

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
  /** The trace to replay, absolute; set by --reproduce, off the CLI's surface. */
  replay?: string;
}

const stamp = (d = new Date()) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

const up = async (url: string) => {
  try {
    await fetch(url, { signal: AbortSignal.timeout(2000) });
    return true;
  } catch {
    return false;
  }
};

const git = (root: string, ...args: string[]) => {
  try {
    return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
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

interface SweepRecord {
  flow: string;
  faults: number;
  latency: number;
  seed: number;
  refDate: string;
  time: string;
  width: number;
  height: number;
}

/** run.json's `target`: what the run ran against. A live run records only what the runner controls. */
export const runTarget = (kind: Target, r: SweepRecord): Record<string, unknown> =>
  kind === 'live'
    ? { kind, flow: r.flow, viewport: `${r.width}x${r.height}` }
    : { kind, flow: r.flow, faults: r.faults, latency_ms: r.latency, viewport: `${r.width}x${r.height}`, mock_ref_date: r.refDate };

/** The command that runs this flow again: with a mock, the same seed, faults and data; live, only the same flow and viewport. */
export const rerunCommand = (kind: Target, r: SweepRecord, project: string[] = [], extra: string[] = []) =>
  [
    'npx bombadil-kit run', ...project, '--flow', r.flow,
    ...(kind === 'live' ? [] : ['--seed', r.seed, '--faults', r.faults, '--ref-date', r.refDate]),
    '--time', r.time, '--width', r.width, '--height', r.height,
    ...(extra.length ? ['--', ...extra] : []),
  ].join(' ');

/**
 * Whether to start the project's server. Something already on the port is an
 * error unless the caller asked to reuse it; reusing means server.command and
 * server.env never ran, so no placeholders were applied.
 */
export const serverChoice = (alreadyUp: boolean, reuse: boolean, origin: string): 'spawn' | 'reuse' => {
  if (!alreadyUp) return 'spawn';
  if (!reuse) throw new Error(`something is already serving ${origin}; stop it or pass --port or --reuse-server`);
  return 'reuse';
};

/**
 * `--reproduce <run dir>`: what that run's run.json says to run it with. Given
 * `dir`, the replay command names that run's directory instead of seed, faults
 * and data: the trace decides what happens, and run.json only names the server
 * to start under it.
 */
export const reproOptions = (meta: RunMeta, dir?: string): { options: Partial<RunOptions>; project: string } => {
  const target = (meta.target ?? {}) as { kind?: Target; faults?: number; latency_ms?: number; mock_ref_date?: string; viewport?: string };
  const [width, height] = (target.viewport ?? '').split('x').map(Number);
  const live = target.kind === 'live';
  // run.json's spec is repo-relative, `<dir>/bombadil/<name>.ts`: the flow
  // names the spec again, and the project comes from run.json itself.
  const spec = typeof meta.spec === 'string' ? /^(?:.*\/)?bombadil\/([^/]+)\.ts$/.exec(meta.spec)?.[1] : undefined;
  // What that run handed Bombadil after `--`, so a replay is handed the same;
  // an early exit aside, since stopping a replay early shows less than it found.
  const extra = (Array.isArray(meta.bombadil_args) ? meta.bombadil_args : []).filter((a) => a !== '--exit-on-violation');
  return {
    project: String(meta.project ?? ''),
    options: {
      flows: meta.flow ? [meta.flow] : [],
      spec,
      seed: meta.seed,
      time: meta.time_limit,
      width: Number.isFinite(width) ? width : undefined,
      height: Number.isFinite(height) ? height : undefined,
      ...(live ? {} : { faults: target.faults, latency: target.latency_ms, refDate: target.mock_ref_date }),
      ...(dir ? { replay: dir } : {}),
      ...(extra.length ? { bombadilArgs: extra } : {}),
    },
  };
};

/** The command that replays one run's trace: `repro.replay`, beside `repro.command`. */
export const replayCommand = (dir: string, r: { faults?: number; width: number; height: number }, project: string[] = []) =>
  [
    'npx bombadil-kit run', ...project, '--reproduce', dir,
    ...(r.faults === undefined ? [] : ['--faults', r.faults]),
    '--width', r.width, '--height', r.height,
  ].join(' ');

/**
 * One sweep: starts the dev server once, runs Bombadil once per flow, writes
 * each run's run.json, stops the server, rebuilds the report once.
 * Exit status: 2 if any flow found a property violation, 1 if a run failed
 * otherwise, 0 clean.
 */
export const run = async (loaded: Loaded, o: RunOptions): Promise<number> => {
  // reproduce() clears `reproduce` before delegating back, so this dispatches once.
  if (o.reproduce) return reproduce(loaded, o);
  const { root, config, out } = loaded;
  const p: ProjectConfig = config.projects[o.project]!;
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

  const reuse = o.reuseServer ?? p.server.reuse ?? false;
  const choice = serverChoice(await up(`${origin}/`), reuse, origin);
  const spawned = choice === 'spawn';

  const runs = join(out, 'runs', o.project);
  mkdirSync(runs, { recursive: true });
  const at = stamp();
  const logPath = join(runs, `${at}-s${seed}.server.log`);
  const values = { port, seed, faults, latency, refDate };
  const [cmd, ...cmdArgs] = p.server.command.map((part) => fill(part, values));
  const env = { ...process.env, ...Object.fromEntries(Object.entries(p.server.env ?? {}).map(([k, v]) => [k, fill(v, values)])) };
  let server: ReturnType<typeof spawn>;
  let exited = false;
  if (spawned) {
    const logFd = openSync(logPath, 'a');
    // Its own process group, so stopping it stops its children and nothing else.
    server = spawn(cmd!, cmdArgs, { cwd: join(root, p.dir), env, stdio: ['ignore', logFd, logFd], detached: true });
    closeSync(logFd);
    server.on('exit', () => (exited = true));
  } else {
    // Someone else's server: the log stays empty, and stopping is not ours to do.
    writeFileSync(logPath, '');
    console.error(`reusing the server on ${origin}: server.command and server.env never ran, so {seed}, {faults}, {latency} and {refDate} were not applied to it`);
  }
  const stop = () => {
    if (spawned && !exited && server?.pid) {
      try {
        process.kill(-server.pid, 'SIGTERM');
      } catch {
        /* already gone */
      }
    }
  };
  const onSignal = () => {
    stop();
    process.exit(130);
  };
  process.on('SIGINT', onSignal).on('SIGTERM', onSignal);

  try {
    const ready = `${origin}${p.server.ready ?? '/'}`;
    for (let i = 0; spawned && i < 120 && !(await up(ready)); i++) {
      if (exited) throw new Error(`the server exited; see ${logPath}`);
      await new Promise((r) => setTimeout(r, 500));
    }
    if (!(await up(ready))) throw new Error(spawned ? `the server never came up; see ${logPath}` : `nothing answers ${ready}; the server on ${origin} is not the app`);

    let commit = git(root, 'rev-parse', '--short', 'HEAD') || 'unknown';
    if (git(root, 'status', '--porcelain', '--', ...(p.watch ?? [p.dir]))) commit += '-dirty';
    const version = execFileSync(bombadil, ['--version'], { encoding: 'utf8' }).trim().split(/\s+/).pop() ?? '';

    let status = 0;
    for (const flow of flows) {
      const spec = o.spec ?? flow.spec ?? p.spec ?? 'spec';
      const specFile = join(specsDir(root, p), `${spec}.ts`);
      if (!existsSync(specFile)) throw new Error(`no spec at ${specFile}`);
      const outDir = join(runs, `${at}-s${seed}-${flow.name}`);
      mkdirSync(outDir, { recursive: true });
      const args = bombadilArgs({
        origin, flow, specFile, outDir, time, width, height,
        headless: !o.headed, sandbox: o.sandbox !== false,
        signedInCookie: p.signedInCookie, root, appDir: p.dir,
        values, seed, faults, refDate,
        extra: o.bombadilArgs,
        replay: o.replay,
      });

      console.error(`→ ${flow.name}: ${origin}${flow.start} for ${time} (${kind === 'live' ? 'live backend' : `faults ${faults}, seed ${seed}`})`);
      const mark = statSync(logPath).size;
      const startedAt = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
      const child = spawn(bombadil, args, { cwd: root, stdio: ['ignore', 'inherit', 'pipe'] });
      createInterface({ input: child.stderr! }).on('line', (line) => {
        if (!quiet.some((q) => q.test(line))) process.stderr.write(`${line}\n`);
      });
      const rc: number = await new Promise((r) => child.on('close', (code) => r(code ?? 1)));
      writeFileSync(join(outDir, 'app.log'), readFileSync(logPath).subarray(mark));
      if (rc === 0) console.error('  ✓ no violations');
      else if (rc === 2) {
        console.error(`  ✗ property violation: npx bombadil browser inspect ${outDir}`);
        status = 2;
      } else {
        console.error(`  ✗ bombadil exited ${rc}`);
        if (status === 0) status = 1;
      }

      // What the report reads about this run (src/report/runs.ts RunMeta).
      const record = { flow: flow.name, faults, latency, seed, refDate, time, width, height };
      const projectName = Object.keys(config.projects).length > 1 ? ['--project', o.project] : [];
      const again = rerunCommand(kind, record, projectName, o.bombadilArgs ?? []);
      writeFileSync(
        join(outDir, 'run.json'),
        `${JSON.stringify(
          {
            schema: 'bombadil-run/v1',
            project: o.project,
            spec: relative(root, specFile),
            flow: flow.name,
            seed,
            start: fill(flow.start, values),
            started_at: startedAt,
            commit,
            target: runTarget(kind, record),
            bombadil: version,
            exit_code: rc,
            time_limit: time,
            command: again,
            ...(flow.milestones?.length ? { expected_milestones: flow.milestones } : {}),
            ...(o.bombadilArgs?.length ? { bombadil_args: o.bombadilArgs } : {}),
            replay: replayCommand(relative(root, outDir), kind === 'live' ? { width, height } : { faults, width, height }, projectName),
          },
          null,
          2,
        )}\n`,
      );
    }
    stop();

    // One report rebuild for all the flows: they are one sweep.
    try {
      const { report } = generate({
        runsRoot: join(out, 'runs'),
        out: join(out, 'report'),
        repoRoot: root,
        now: new Date().toISOString(),
        title: config.title,
        baseline: o.baseline,
      });
      const s = report.summary;
      console.error(`sweep ${report.sweep.id}: ${s.new} new, ${s.open} open, ${s.quiet} quiet, ${s.closed} closed · ${s.routes[0]}/${s.routes[1]} routes`);
      console.error(`→ ${join(out, 'report', 'index.html')}`);
    } catch (err) {
      console.error(`report: ${(err as Error).message}`);
    }
    return status;
  } finally {
    stop();
    process.off('SIGINT', onSignal).off('SIGTERM', onSignal);
  }
};

/**
 * `--reproduce <run dir>`: restart the server with the recorded run's seed,
 * faults, latency, reference date and viewport, and replay its trace with
 * Bombadil on the same flow and spec. Everything else comes from the run's
 * project as it is configured now.
 */
const reproduce = async (loaded: Loaded, o: RunOptions): Promise<number> => {
  const dir = resolve(loaded.root, o.reproduce!);
  if (!existsSync(join(dir, 'run.json'))) throw new Error(`no run.json in ${dir}`);
  const meta = JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8')) as RunMeta;
  const trace = join(dir, 'trace.jsonl');
  if (!existsSync(trace)) throw new Error(`${dir} has no trace.jsonl to replay`);
  const { options, project } = reproOptions(meta, relative(loaded.root, dir));
  if (!loaded.config.projects[project]) throw new Error(`run ${dir} is project ${project}, which bombadil-kit.json has no entry for`);
  console.error(`→ replaying ${dir} (${project}, seed ${meta.seed})`);
  // Bombadil replays the trace itself, so nothing from the original run's `--`
  // carries over: --exit-on-violation would stop a replay before its end.
  // `replay` is the path through the sweep; `reproduce: undefined` is what
  // stops the second dispatch coming back here.
  return run(loaded, { ...o, ...options, project, replay: trace, reproduce: undefined, bombadilArgs: [] });
};
