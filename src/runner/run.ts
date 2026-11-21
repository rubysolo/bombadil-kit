import { spawn, execFileSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createInterface } from 'node:readline';
import { fill, projectRoutes, readFlows, specsDir, type Flow, type Loaded, type ProjectConfig } from '../config.ts';
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
}): string[] => {
  const args = ['browser', 'test', '--time-limit', o.time, '--width', String(o.width), '--height', String(o.height), '--output-path', o.outDir];
  if (o.headless) args.push('--headless');
  if (!o.sandbox) args.push('--no-sandbox');
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
  args.push(`${o.origin}${o.flow.start}`, o.specFile);
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
export const rerunCommand = (kind: Target, r: SweepRecord, project: string[] = []) =>
  [
    'npx bombadil-kit run', ...project, '--flow', r.flow,
    ...(kind === 'live' ? [] : ['--seed', r.seed, '--faults', r.faults, '--ref-date', r.refDate]),
    '--time', r.time, '--width', r.width, '--height', r.height,
  ].join(' ');

/**
 * One sweep: starts the dev server once, runs Bombadil once per flow, writes
 * each run's run.json, stops the server, rebuilds the report once.
 * Exit status: 2 if any flow found a property violation, 1 if a run failed
 * otherwise, 0 clean.
 */
export const run = async (loaded: Loaded, o: RunOptions): Promise<number> => {
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

  if (await up(`${origin}/`)) throw new Error(`something is already serving ${origin}; stop it or pass --port`);

  const runs = join(out, 'runs', o.project);
  mkdirSync(runs, { recursive: true });
  const at = stamp();
  const logPath = join(runs, `${at}-s${seed}.server.log`);
  const values = { port, seed, faults, latency, refDate };
  const [cmd, ...cmdArgs] = p.server.command.map((part) => fill(part, values));
  const env = { ...process.env, ...Object.fromEntries(Object.entries(p.server.env ?? {}).map(([k, v]) => [k, fill(v, values)])) };
  const logFd = openSync(logPath, 'a');
  // Its own process group, so stopping it stops its children and nothing else.
  const server = spawn(cmd!, cmdArgs, { cwd: join(root, p.dir), env, stdio: ['ignore', logFd, logFd], detached: true });
  closeSync(logFd);
  let exited = false;
  server.on('exit', () => (exited = true));
  const stop = () => {
    if (!exited && server.pid) {
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
    for (let i = 0; i < 120 && !(await up(ready)); i++) {
      if (exited) throw new Error(`the server exited; see ${logPath}`);
      await new Promise((r) => setTimeout(r, 500));
    }
    if (!(await up(ready))) throw new Error(`the server never came up; see ${logPath}`);

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
      const again = rerunCommand(kind, record, Object.keys(config.projects).length > 1 ? ['--project', o.project] : []);
      writeFileSync(
        join(outDir, 'run.json'),
        `${JSON.stringify(
          {
            schema: 'bombadil-run/v1',
            project: o.project,
            spec: relative(root, specFile),
            flow: flow.name,
            seed,
            start: flow.start,
            started_at: startedAt,
            commit,
            target: runTarget(kind, record),
            bombadil: version,
            exit_code: rc,
            time_limit: time,
            command: again,
            ...(flow.milestones?.length ? { expected_milestones: flow.milestones } : {}),
          },
          null,
          2,
        )}\n`,
      );
    }
    stop();

    // One report rebuild for all the flows: they are one sweep.
    try {
      const report = sweepReport(loaded, o.baseline);
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
