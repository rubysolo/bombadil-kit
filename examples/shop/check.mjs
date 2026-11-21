// Runs a sweep of the example shop and checks its report.
//
//   node check.mjs [clean]   the app as it is: the sweep must find nothing
//   node check.mjs leak      with VITE_PLANT=leak: plants.json's property must fire
//   node check.mjs --all     clean, then every plant in turn
//
// A plant with "known" in plants.json is a gap in the kit: its property can't
// reliably catch it yet. It's reported (fired or not), never failed; drop the
// note once the kit fixes the gap.
//
// The clean sweep also prints each flow's expected milestones it missed (a
// flow that reached its pages without finishing there); that warns, never fails.
//
// TIME (default 30s, or the plant's `time`), SEED (default 1) and PORT
// override the sweep's. A plant that needs the walker to dwell somewhere (a
// spinner tallied up across visits) names a longer `time` in plants.json. Under CI
// (CI=true, as GitHub Actions sets) Chrome runs without its sandbox: the job's
// container runs as root.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const plants = JSON.parse(readFileSync(join(here, 'plants.json'), 'utf8'));
const time = (p) => process.env.TIME ?? p?.time ?? '30s';
const seed = process.env.SEED ?? '1';

const sweep = (plant) => {
  const p = plant ? plants[plant] : undefined;
  if (plant && !p) throw new Error(`no plant ${plant} (have ${Object.keys(plants).join(', ')})`);
  // A plant runs without faults unless it needs them: a fault nearby would
  // excuse what it plants, and noise from it isn't what's being checked.
  const args = ['bombadil-kit', 'run', '--time', time(p), '--seed', seed, '--faults', String(p ? (p.faults ?? 0) : 0.1)];
  if (p) args.push('--flow', p.flow);
  if (process.env.PORT) args.push('--port', process.env.PORT);
  if (process.env.CI === 'true') args.push('--no-sandbox');
  console.error(`\n=== ${plant ?? 'clean'}: npx ${args.join(' ')}`);
  const rc = spawnSync('npx', args, {
    cwd: here,
    stdio: 'inherit',
    env: { ...process.env, VITE_PLANT: plant ?? '' },
  }).status;

  const report = JSON.parse(readFileSync(join(here, 'tmp/bombadil/report/report.json'), 'utf8'));
  const seen = report.findings.filter((f) => f.sweeps.includes(report.sweep.id));
  const fired = [...new Set(seen.map((f) => f.property))];
  for (const f of seen) console.error(`  ${f.property} on ${f.route}: ${f.summary}`);
  if (!p) {
    for (const m of report.projects.flatMap((x) => x.milestones ?? []).filter((m) => m.sweep === report.sweep.id && m.missed.length)) {
      console.error(`  ~ ${m.flow} never reached ${m.missed.join(', ')}`);
    }
  }

  const problems = [];
  if (!p) {
    if (rc !== 0) problems.push(`exit ${rc}, want 0`);
    if (seen.length) problems.push(`${seen.length} finding(s) on the correct app: ${fired.join(', ')}`);
  } else if (p.known) {
    // A kit gap, written down: reported, never failed. Whether it's caught can
    // depend on where the walker goes, so neither outcome fails the check.
  } else {
    if (rc !== 2) problems.push(`exit ${rc}, want 2`);
    if (!fired.includes(p.property)) problems.push(`${p.property} never fired (fired: ${fired.join(', ') || 'nothing'})`);
  }
  const name = plant ?? 'clean';
  if (problems.length) console.error(`✗ ${name}: ${problems.join('; ')}`);
  else if (p?.known) console.error(`~ ${name}: known gap, ${p.property} ${fired.includes(p.property) ? 'fired this time' : 'did not fire'}: ${p.known}`);
  else console.error(`✓ ${name}`);
  return problems.length === 0;
};

const arg = process.argv[2];
const todo = arg === '--all' ? [undefined, ...Object.keys(plants)] : [arg === 'clean' ? undefined : arg];
const failed = todo.filter((plant) => !sweep(plant));
if (failed.length) {
  console.error(`\nfailed: ${failed.map((p) => p ?? 'clean').join(', ')}`);
  process.exit(1);
}
