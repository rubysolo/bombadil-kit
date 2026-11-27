#!/usr/bin/env node
// bombadil-kit: run Bombadil flows, build the findings report, pick the flows a diff touches.
//
//   bombadil-kit run                         every flow, 1 minute each
//   bombadil-kit run --flow checkout --time 3m --headed
//   bombadil-kit run --seed 1234 --ref-date 2026-11-19     same mock data and faults as that run
//   bombadil-kit run -- --exit-on-violation             hand the rest to Bombadil
//   bombadil-kit run --reproduce tmp/bombadil/runs/web/<run>  replay that run
//   bombadil-kit run --reuse-server                use a server already on the port
//   bombadil-kit run --project a --no-report &      parallel sweeps: then one `report`
//   bombadil-kit run --baseline main/state.json --no-sandbox   (CI)
//   bombadil-kit list                        the flows
//   bombadil-kit report [--fail-on new|open] [--fail-by finding|cause] [--baseline state.json]
//   bombadil-kit affected [--base origin/main] [--files a.tsx,b.ts] [--coverage coverage.json] [--json]
//   bombadil-kit affected --all              every project (the default with several): `<project> <flow>`
//
// Reads bombadil-kit.json from here or above. See README.md.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { bombadilBin, bombadilTrace } from './trace.ts';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { loadConfig, pickProject, projectRoutes, readFlows, type Loaded, type ProjectConfig } from './config.ts';
import { projectAffected } from './affected/project.ts';
import { generate, type FailBy, type FailOn } from './report/generate.ts';
import { summaryLine } from './report/report.ts';
import { run } from './runner/run.ts';

// The comment block at the top of this file.
const USAGE = (() => {
  const lines = readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1);
  const end = lines.findIndex((l) => !l.startsWith('//'));
  return lines.slice(0, end).map((l) => l.replace(/^\/\/ ?/, '')).join('\n');
})();

const num = (v: string | undefined) => (v === undefined ? undefined : Number(v));

/** Where Bombadil's arguments start: after `--`, or at the end of argv. */
const sep = (argv: string[]): number => argv.indexOf('--');

/** This tool's own arguments: what comes before `--`. */
export const ownArgs = (argv: string[]): string[] => {
  const i = sep(argv);
  return i === -1 ? argv : argv.slice(0, i);
};

/** What Bombadil gets: everything after `--`, the separator itself aside. */
export const tail = (argv: string[]): string[] => {
  const i = sep(argv);
  return i === -1 ? [] : argv.slice(i + 1);
};

const cmdRun = async (loaded: Loaded, argv: string[]) => {
  const { values } = parseArgs({
    // parseArgs would call what follows the separator a positional and refuse
    // it, so only this tool's own arguments are handed to it.
    args: ownArgs(argv),
    options: {
      project: { type: 'string' },
      flow: { type: 'string', multiple: true, default: [] },
      spec: { type: 'string' },
      time: { type: 'string' },
      faults: { type: 'string' },
      seed: { type: 'string' },
      latency: { type: 'string' },
      'ref-date': { type: 'string' },
      headed: { type: 'boolean', default: false },
      'no-sandbox': { type: 'boolean', default: false },
      baseline: { type: 'string' },
      width: { type: 'string' },
      height: { type: 'string' },
      port: { type: 'string' },
      reproduce: { type: 'string' },
      'reuse-server': { type: 'boolean', default: false },
      'no-report': { type: 'boolean', default: false },
    },
    // Everything after `--` is Bombadil's: parseArgs stops at the separator, so
    // the tail is read from argv, where `--` still stands (see tail()).
  });
  // A replay's project is the one its run.json names (see replay() in runner/run.ts); only a
  // fresh run has to pick one, which several projects make --project's job.
  const project = values.reproduce ? (values.project ?? '') : pickProject(loaded, values.project)[0];
  const { status } = await run(loaded, {
    project,
    flows: values.flow,
    spec: values.spec,
    time: values.time,
    faults: num(values.faults),
    seed: num(values.seed),
    latency: num(values.latency),
    refDate: values['ref-date'],
    headed: values.headed,
    sandbox: !values['no-sandbox'],
    baseline: values.baseline && resolve(values.baseline),
    width: num(values.width),
    height: num(values.height),
    port: num(values.port),
    bombadilArgs: tail(argv),
    reproduce: values.reproduce,
    reuseServer: values['reuse-server'],
    report: !values['no-report'],
  });
  return status;
};

const cmdList = (loaded: Loaded, argv: string[]) => {
  const { values } = parseArgs({ args: argv, options: { project: { type: 'string' } } });
  const [, p] = pickProject(loaded, values.project);
  for (const f of readFlows(loaded.root, p)) console.log(`${f.name.padEnd(18)}${f.start.padEnd(44)}${f.about ?? ''}`);
  return 0;
};

const cmdReport = (loaded: Loaded, argv: string[]) => {
  const { values } = parseArgs({
    args: argv,
    options: {
      runs: { type: 'string', default: join(loaded.out, 'runs') },
      out: { type: 'string', default: join(loaded.out, 'report') },
      'fail-on': { type: 'string', default: 'none' },
      'fail-by': { type: 'string', default: 'finding' },
      title: { type: 'string', default: loaded.config.title ?? 'bombadil' },
      baseline: { type: 'string' },
    },
  });
  const failOn = values['fail-on'] as FailOn;
  if (!['none', 'new', 'open'].includes(failOn)) throw new Error(`--fail-on must be none, new or open, not ${failOn}`);
  const failBy = values['fail-by'] as FailBy;
  if (!['finding', 'cause'].includes(failBy)) throw new Error(`--fail-by must be finding or cause, not ${failBy}`);
  const { report, exitCode } = generate({
    runsRoot: resolve(values.runs),
    out: resolve(values.out),
    repoRoot: loaded.root,
    now: new Date().toISOString(),
    failOn,
    failBy,
    title: values.title,
    baseline: values.baseline && resolve(values.baseline),
    routes: projectRoutes(loaded),
    trace: bombadilTrace(bombadilBin(loaded.root)),
  });
  console.error(summaryLine(report));
  console.error(`→ ${join(resolve(values.out), 'index.html')}`);
  return exitCode;
};

// stdout: one flow per line, for `run --flow`; with several projects,
// `<project> <flow>`. stderr: why each was picked, and app files no flow
// reaches. Without a coverage map every flow is picked.
const cmdAffected = async (loaded: Loaded, argv: string[]) => {
  const { values } = parseArgs({
    args: argv,
    options: {
      project: { type: 'string' },
      all: { type: 'boolean', default: false },
      base: { type: 'string', default: 'origin/main' },
      files: { type: 'string' },
      coverage: { type: 'string', default: join(loaded.out, 'report/coverage.json') },
      json: { type: 'boolean', default: false },
    },
  });
  const { root, config } = loaded;
  if (values.all && values.project) throw new Error('--all and --project are exclusive');
  const names = Object.keys(config.projects);
  const every = values.all || (!values.project && names.length > 1);
  const picked = every ? names.map((n): [string, ProjectConfig] => [n, config.projects[n]!]) : [pickProject(loaded, values.project)];

  const changed = values.files
    ? values.files.split(',').filter(Boolean)
    : execFileSync('git', ['diff', '--name-only', `${values.base}...HEAD`], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);

  const coverageFile = resolve(values.coverage);
  let coverageMap: { projects?: Record<string, { flows?: Record<string, string[]> }> } | undefined;
  if (existsSync(coverageFile)) {
    try {
      coverageMap = JSON.parse(readFileSync(coverageFile, 'utf8'));
    } catch {
      console.error(`unreadable coverage map at ${coverageFile}; picking every flow`);
    }
  }

  // Each project builds its own import graph, the slow part: all at once.
  const results = await Promise.all(
    picked.map(([name, project]) =>
      projectAffected({ root, project, changed, coverage: coverageMap?.projects?.[name]?.flows, coverageFile }),
    ),
  );

  if (!every) {
    const { total, ...result } = results[0]!;
    if (values.json) console.log(JSON.stringify({ changed, ...result }, null, 2));
    else for (const flow of result.flows) console.log(flow);
    console.error(`${changed.length} changed file(s) → ${result.flows.length} of ${total} flow(s)`);
    for (const flow of result.flows) console.error(`  ${flow}: ${(result.reasons[flow] ?? []).slice(0, 3).join('; ')}`);
    for (const file of result.unreached) console.error(`  no flow reaches ${file}`);
    return 0;
  }

  if (values.json) {
    console.log(JSON.stringify(Object.fromEntries(picked.map(([name], i) => {
      const { flows, reasons, unreached, everything } = results[i]!;
      return [name, { flows, reasons, unreached, everything }];
    })), null, 2));
  } else {
    picked.forEach(([name], i) => { for (const flow of results[i]!.flows) console.log(`${name} ${flow}`); });
  }
  const flows = results.reduce((n, r) => n + r.flows.length, 0);
  const total = results.reduce((n, r) => n + r.total, 0);
  console.error(`${changed.length} changed file(s) → ${flows} of ${total} flow(s) in ${picked.length} project(s)`);
  picked.forEach(([name], i) => {
    const r = results[i]!;
    console.error(`  ${name}: ${r.flows.length} of ${r.total}`);
    for (const flow of r.flows) console.error(`    ${flow}: ${(r.reasons[flow] ?? []).slice(0, 3).join('; ')}`);
    for (const file of r.unreached) console.error(`    no flow reaches ${file}`);
  });
  return 0;
};

// The command line. Imported (by a test, or anything else), this file is only
// its exports: main reads the real argv and exits the process.
const main = async () => {
  const [command, ...rest] = process.argv.slice(2);
  const commands: Record<string, (l: Loaded, a: string[]) => number | Promise<number>> = {
    run: cmdRun,
    list: cmdList,
    report: cmdReport,
    affected: cmdAffected,
  };

  if (!command || command === '-h' || command === '--help' || !commands[command]) {
    console.error(USAGE);
    process.exit(command && !['-h', '--help'].includes(command) ? 2 : 0);
  }
  // A command's own status passes through as it is: `run`'s 0/1/2 is the
  // sweep's (runner/run.ts), `report --fail-on`'s 1 is the gate tripping.
  // Anything thrown is an error, and its code must differ from both: for `run`
  // 1, never 2 (CI reads `run`'s 2 as "violations found"); for the others 2,
  // never 1 (CI reads `report`'s 1 as "something new").
  try {
    process.exit(await commands[command]!(loadConfig(), rest));
  } catch (err) {
    console.error(`bombadil-kit ${command}: ${(err as Error).message}`);
    process.exit(command === 'run' ? 1 : 2);
  }
};

// The entry-point test, not import.meta.main: that needs Node 24, and the kit
// supports 22.18. argv[1] is what `node` was pointed at; the npm bin is a
// symlink to this file, so resolve both sides before comparing. An importer's
// argv[1] is the importer, so importing this file runs nothing.
// A wrapper or loader can pass an argv[1] that isn't a file, and realpath
// throws on it: then this isn't the entry point.
const isEntry = () => {
  try {
    return !!process.argv[1] && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
};
if (isEntry()) await main();
