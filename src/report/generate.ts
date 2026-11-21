import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { renderHtml } from './html.ts';
import { projectInfo, type ProjectInfo } from './project.ts';
import { buildReport, type Report } from './report.ts';
import { listRuns, readRun, type RunMeta, type RunResult } from './runs.ts';
import { applySweep, emptyState, type FindingRecord, type State } from './state.ts';

export type FailOn = 'none' | 'new' | 'open';

export interface GenerateOptions {
  /** Where scripts/bombadil.sh puts runs: `<runsRoot>/<project>/<run>/`. */
  runsRoot: string;
  /** The report folder: index.html, report.json, findings.ndjson, state.json, evidence/. */
  out: string;
  /** Spec paths in run.json are relative to this. */
  repoRoot: string;
  now: string;
  failOn?: FailOn;
  title?: string;
  /**
   * Where to start the history when `out` has none yet: main's nightly
   * state.json, so a PR's "new" means not seen on main. Missing is fine.
   */
  baseline?: string;
  /** Per project, its routes file (the config's `projects.<name>.routes`), in preference to routes.json beside the spec. */
  routes?: Record<string, string>;
}

const readState = (path: string): State => (existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as State) : emptyState());

/**
 * Folds the runs that aren't in state.json yet into one new sweep, then
 * rewrites the whole report from the state. Safe to run again: with no new
 * runs it only re-renders.
 */
export const generate = (opts: GenerateOptions): { report: Report; exitCode: number } => {
  mkdirSync(opts.out, { recursive: true });
  const statePath = join(opts.out, 'state.json');
  let state = existsSync(statePath) || !opts.baseline ? readState(statePath) : readState(opts.baseline);

  const infos = new Map<string, ProjectInfo>();
  const infoFor = (project: string, spec: string): ProjectInfo => {
    if (!infos.has(project)) infos.set(project, projectInfo(opts.repoRoot, spec, opts.routes?.[project]));
    return infos.get(project)!;
  };

  const fresh: RunResult[] = [];
  for (const dir of listRuns(opts.runsRoot)) {
    const meta = JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8')) as RunMeta;
    if (`${meta.project}/${basename(dir)}` in state.runs) continue;
    fresh.push(readRun(dir, infoFor(meta.project, meta.spec).routes));
  }
  state = applySweep(state, fresh, opts.now);
  if (state.sweeps.length === 0) throw new Error(`no runs under ${opts.runsRoot}: run the fuzzer first`);

  // Projects that had no new runs this time still need their spec and routes.
  for (const [id, run] of Object.entries(state.runs)) infoFor(id.split('/')[0]!, run.spec);

  // Copy each finding's latest frames into the report, so the folder stands alone.
  const evidence = (f: FindingRecord): string[] =>
    f.last.frames.flatMap((src, i) => {
      const rel = `evidence/${f.id}/${f.last.sweep}-${i}.jpeg`;
      const dest = join(opts.out, rel);
      if (!existsSync(dest) && existsSync(src)) {
        mkdirSync(join(opts.out, 'evidence', f.id), { recursive: true });
        copyFileSync(src, dest);
      }
      return existsSync(dest) ? [rel] : [];
    });

  const report = buildReport(state, Object.fromEntries(infos), {
    generatedAt: opts.now,
    evidence,
    runsDir: relative(opts.repoRoot, opts.runsRoot) || '.',
  });

  writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n');
  writeFileSync(join(opts.out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  writeFileSync(join(opts.out, 'findings.ndjson'), report.findings.map((f) => JSON.stringify(f)).join('\n') + (report.findings.length ? '\n' : ''));
  writeFileSync(join(opts.out, 'index.html'), renderHtml(report, opts.title));

  // coverage.json: what each flow rendered, for picking the flows a diff touches
  // (affected.ts). Files deleted since a run rendered them are dropped.
  const projects = Object.fromEntries(
    Object.entries(state.coverage ?? {}).map(([project, flows]) => [
      project,
      {
        flows: Object.fromEntries(
          Object.entries(flows).map(([flow, files]) => [flow, files.filter((f) => existsSync(join(opts.repoRoot, f)))]),
        ),
      },
    ]),
  );
  writeFileSync(
    join(opts.out, 'coverage.json'),
    JSON.stringify({ schema: 'bombadil-coverage/v1', generated_at: opts.now, projects }, null, 2) + '\n',
  );

  const failing =
    opts.failOn === 'new' ? report.summary.new : opts.failOn === 'open' ? report.summary.new + report.summary.open : 0;
  return { report, exitCode: failing > 0 ? 1 : 0 };
};
