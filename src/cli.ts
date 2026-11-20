#!/usr/bin/env node
// bombadil-kit: run Bombadil flows, build the findings report, pick the flows a diff touches.
//
//   bombadil-kit run                         every flow, 1 minute each
//   bombadil-kit run --flow checkout --time 3m --headed
//   bombadil-kit run --seed 1234 --ref-date 2026-11-19     same mock data and faults as that run
//   bombadil-kit run --baseline main/state.json --no-sandbox   (CI)
//   bombadil-kit list                        the flows
//   bombadil-kit report [--fail-on new|open] [--baseline state.json]
//   bombadil-kit affected [--base origin/main] [--files a.tsx,b.ts] [--coverage coverage.json] [--json]
//
// Reads bombadil-kit.json from here or above. See README.md.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { flowsPath, loadConfig, pickProject, readFlows, specsDir, type Loaded } from './config.ts';
import { affectedFlows, importersOf } from './affected/index.ts';
import { generate, type FailOn } from './report/generate.ts';
import { run } from './runner/run.ts';

// The comment block at the top of this file.
const USAGE = (() => {
  const lines = readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1);
  const end = lines.findIndex((l) => !l.startsWith('//'));
  return lines.slice(0, end).map((l) => l.replace(/^\/\/ ?/, '')).join('\n');
})();

const num = (v: string | undefined) => (v === undefined ? undefined : Number(v));

const cmdRun = async (loaded: Loaded, argv: string[]) => {
  const { values } = parseArgs({
    args: argv,
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
    },
  });
  const [project] = pickProject(loaded, values.project);
  return run(loaded, {
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
  });
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
      title: { type: 'string', default: loaded.config.title ?? 'bombadil' },
      baseline: { type: 'string' },
    },
  });
  const failOn = values['fail-on'] as FailOn;
  if (!['none', 'new', 'open'].includes(failOn)) throw new Error(`--fail-on must be none, new or open, not ${failOn}`);
  const { report, exitCode } = generate({
    runsRoot: resolve(values.runs),
    out: resolve(values.out),
    repoRoot: loaded.root,
    now: new Date().toISOString(),
    failOn,
    title: values.title,
    baseline: values.baseline && resolve(values.baseline),
  });
  const s = report.summary;
  console.error(`sweep ${report.sweep.id}: ${s.new} new, ${s.open} open, ${s.quiet} quiet, ${s.closed} closed · ${s.routes[0]}/${s.routes[1]} routes`);
  console.error(`→ ${join(resolve(values.out), 'index.html')}`);
  return exitCode;
};

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// stdout: one flow per line, for `run --flow`. stderr: why each was picked,
// and app files no flow reaches. Without a coverage map every flow is picked.
const cmdAffected = async (loaded: Loaded, argv: string[]) => {
  const { values } = parseArgs({
    args: argv,
    options: {
      project: { type: 'string' },
      base: { type: 'string', default: 'origin/main' },
      files: { type: 'string' },
      coverage: { type: 'string', default: join(loaded.out, 'report/coverage.json') },
      json: { type: 'boolean', default: false },
    },
  });
  const { root } = loaded;
  const [project, p] = pickProject(loaded, values.project);
  const changed = values.files
    ? values.files.split(',').filter(Boolean)
    : execFileSync('git', ['diff', '--name-only', `${values.base}...HEAD`], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);

  const allFlows = readFlows(root, p).map((f) => f.name);
  const coverageFile = resolve(values.coverage);
  let coverage: Record<string, string[]> | undefined;
  if (existsSync(coverageFile)) {
    try {
      coverage = JSON.parse(readFileSync(coverageFile, 'utf8')).projects?.[project]?.flows;
    } catch {
      console.error(`unreadable coverage map at ${coverageFile}; picking every flow`);
    }
  }

  // The fuzzer itself, and what every page is built from.
  const rel = (abs: string) => relative(root, abs);
  const always = [
    `^${escape(rel(specsDir(root, p)))}/`,
    `^${escape(rel(flowsPath(root, p)))}$`,
    '^bombadil-kit\\.json$',
    '(^|/)(package-lock\\.json|yarn\\.lock|pnpm-lock\\.yaml|bun\\.lockb?)$',
    ...(p.affected?.always ?? []),
  ].map((s) => new RegExp(s));

  let result;
  if (!coverage || !p.affected?.entry) {
    const why = !p.affected?.entry ? 'no affected.entry in bombadil-kit.json' : `no usable coverage map at ${coverageFile}`;
    result = { flows: allFlows, reasons: Object.fromEntries(allFlows.map((f) => [f, [why]])), unreached: [] as string[], everything: true };
  } else {
    const known = { ...Object.fromEntries(allFlows.map((f) => [f, [] as string[]])), ...coverage };
    const importers = await importersOf(root, p.affected.entry);
    result = affectedFlows(changed, known, importers, { routers: p.affected.routers ?? [], always });
    // A flow added since the map was made has no coverage yet: run it.
    for (const flow of allFlows.filter((f) => !(f in coverage!))) {
      if (!result.flows.includes(flow)) result.flows.push(flow);
      (result.reasons[flow] ??= []).push('new flow: not in the coverage map yet');
    }
    result.flows = result.flows.filter((f) => allFlows.includes(f)).sort();
  }

  if (values.json) console.log(JSON.stringify({ changed, ...result }, null, 2));
  else for (const flow of result.flows) console.log(flow);
  console.error(`${changed.length} changed file(s) → ${result.flows.length} of ${allFlows.length} flow(s)`);
  for (const flow of result.flows) console.error(`  ${flow}: ${(result.reasons[flow] ?? []).slice(0, 3).join('; ')}`);
  for (const file of result.unreached) console.error(`  no flow reaches ${file}`);
  return 0;
};

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
try {
  process.exit(await commands[command]!(loadConfig(), rest));
} catch (err) {
  console.error(`bombadil-kit ${command}: ${(err as Error).message}`);
  process.exit(2);
}
