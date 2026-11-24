import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate } from '../src/report/generate.ts';
import { always, fakeTrace, rendering, row, timedOut, tmp, writeRun } from './helpers.ts';

const setup = () => {
  const root = tmp();
  const runs = join(root, 'runs');
  const out = join(root, 'report');
  mkdirSync(join(root, 'app/bombadil'), { recursive: true });
  writeFileSync(join(root, 'app/bombadil/spec.ts'), "export { noLeakedValues, failedWritesAreShown } from './properties.ts';\n");
  writeFileSync(join(root, 'app/bombadil/routes.json'), JSON.stringify(['/login', '/orders/:orderNumber/prepare-store', '/finalize']));
  return { root, runs, out };
};

const failingRun = (runs: string, id: string) =>
  writeRun(runs, {
    id,
    spec: 'app/bombadil/spec.ts',
    rows: [
      row(0, '/login', null),
      row(1, '/orders/ACTIVE-STORE/prepare-store', { Click: { fingerprint: { tag: 'button', text_content: 'SAVE' } } }),
      row(2, '/orders/ACTIVE-STORE/prepare-store', 'Wait', [
        timedOut('failedWritesAreShown', [{ name: 'freshFailedWrite', value: 'PUT /orders/1187/store → 422' }]),
      ]),
      row(3, '/login', 'Back', [always('noLeakedValues', [{ name: 'leakedText', value: '<script>alert(1)</script> undefined' }])]),
    ],
  });

test('generate writes the report, the agent files and the evidence', () => {
  const { root, runs, out } = setup();
  failingRun(runs, '20261119-192622-s4242');

  const { report, exitCode } = generate({ trace: fakeTrace, runsRoot: runs, out, repoRoot: root, now: '2026-11-19T20:00:00Z', failOn: 'new' });
  assert.equal(exitCode, 1);
  assert.equal(report.summary.new, 2);

  for (const f of ['index.html', 'report.json', 'findings.ndjson', 'state.json']) assert.ok(existsSync(join(out, f)), f);

  const lines = readFileSync(join(out, 'findings.ndjson'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(lines.length, 2);
  const write = lines.find((l) => l.property === 'failedWritesAreShown');
  assert.equal(write.route, '/orders/:orderNumber/prepare-store');
  assert.equal(write.evidence.frames.length, 3);
  for (const frame of write.evidence.frames) assert.ok(existsSync(join(out, frame)), frame);
  // The full run, every state, in Bombadil's own viewer.
  assert.equal(write.evidence.inspect, 'npx bombadil browser inspect runs/web/20261119-192622-s4242/trace.bin');

  const p = report.projects[0]!;
  assert.deepEqual(p.properties.map((x) => x.name), ['noLeakedValues', 'failedWritesAreShown']);
  assert.deepEqual(p.routes.find((r) => r.template === '/finalize'), { template: '/finalize', states: 0, known: true });

  // Fuzzer text can't break out of the embedded JSON.
  const html = readFileSync(join(out, 'index.html'), 'utf8');
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(html.includes('\\u003cscript\\u003ealert(1)'));
});

test('generating again with no new runs keeps the same sweep', () => {
  const { root, runs, out } = setup();
  failingRun(runs, 'r1');
  generate({ trace: fakeTrace, runsRoot: runs, out, repoRoot: root, now: 't1' });
  const { report } = generate({ trace: fakeTrace, runsRoot: runs, out, repoRoot: root, now: 't2' });
  assert.equal(report.sweep.id, 1);
  assert.equal(report.summary.new, 2);
});

test('a later clean sweep moves findings to quiet, and --fail-on open passes', () => {
  const { root, runs, out } = setup();
  failingRun(runs, 'r1');
  generate({ trace: fakeTrace, runsRoot: runs, out, repoRoot: root, now: 't1' });
  writeRun(runs, {
    id: 'r2',
    spec: 'app/bombadil/spec.ts',
    rows: [row(0, '/login', null), row(1, '/orders/ACTIVE-STORE/prepare-store', 'Wait')],
  });
  const { report, exitCode } = generate({ trace: fakeTrace, runsRoot: runs, out, repoRoot: root, now: 't2', failOn: 'open' });
  assert.equal(report.sweep.id, 2);
  assert.deepEqual(report.findings.map((f) => f.status), ['quiet', 'quiet']);
  assert.equal(exitCode, 0);
});

test('generate writes coverage.json: rendered files per flow, minus deleted ones', () => {
  const { root, runs, out } = setup();
  mkdirSync(join(root, 'app/src'), { recursive: true });
  writeFileSync(join(root, 'app/src/Live.tsx'), '');
  writeRun(runs, {
    id: 'r1',
    flow: 'deposit',
    spec: 'app/bombadil/spec.ts',
    rows: [rendering(row(0, '/login', null), ['app/src/Live.tsx', 'app/src/Deleted.tsx'])],
  });
  generate({ trace: fakeTrace, runsRoot: runs, out, repoRoot: root, now: 't1' });
  const coverage = JSON.parse(readFileSync(join(out, 'coverage.json'), 'utf8'));
  assert.equal(coverage.schema, 'bombadil-coverage/v1');
  assert.deepEqual(coverage.projects['web'].flows, { deposit: ['app/src/Live.tsx'] });
});

// A PR's sweep starts from main's nightly state.json: a bug main already has
// is `open` there, not `new`, so `--fail-on new` fails only on what the PR adds.
test('a baseline state.json makes "new" mean new against it', () => {
  const nightly = setup();
  failingRun(nightly.runs, 'main-r1');
  generate({ trace: fakeTrace, runsRoot: nightly.runs, out: nightly.out, repoRoot: nightly.root, now: 't1' });

  const pr = setup();
  failingRun(pr.runs, 'pr-r1');
  const { report, exitCode } = generate({
    trace: fakeTrace,
    runsRoot: pr.runs,
    out: pr.out,
    repoRoot: pr.root,
    now: 't2',
    baseline: join(nightly.out, 'state.json'),
    failOn: 'new',
  });
  assert.deepEqual(report.findings.map((f) => f.status), ['open', 'open']);
  assert.equal(exitCode, 0);
});

test('a missing baseline is not an error: everything is new', () => {
  const { root, runs, out } = setup();
  failingRun(runs, 'r1');
  const { report } = generate({ trace: fakeTrace, runsRoot: runs, out, repoRoot: root, now: 't1', baseline: join(root, 'nope.json') });
  assert.equal(report.summary.new, 2);
});

test("a project's routes file wins over the routes.json beside its spec", () => {
  const { root, runs, out } = setup();
  failingRun(runs, '20261119-192622-s4242');
  mkdirSync(join(root, 'routes'), { recursive: true });
  writeFileSync(join(root, 'routes/web.json'), JSON.stringify(['/login', '/web-only']));

  const { report } = generate({ trace: fakeTrace, runsRoot: runs, out, repoRoot: root, now: '2026-11-19T20:00:00Z', routes: { web: 'routes/web.json' } });
  const templates = report.projects[0]!.routes.map((r) => r.template);
  assert.ok(templates.includes('/web-only'));
  assert.ok(!templates.includes('/finalize'), 'the beside-the-spec list is not used');
  assert.equal(report.projects[0]!.routes.find((r) => r.template === '/web-only')!.known, true);
});

test('a routes path that does not exist is an error, not an empty list', () => {
  const { root, runs, out } = setup();
  failingRun(runs, '20261119-192622-s4242');
  assert.throws(
    () => generate({ trace: fakeTrace, runsRoot: runs, out, repoRoot: root, now: '2026-11-19T20:00:00Z', routes: { web: 'nope.json' } }),
    /no routes file at nope.json/,
  );
});

test('`bombadil-kit report` takes each project\'s routes from bombadil-kit.json', () => {
  const { root, runs, out } = setup();
  failingRun(runs, '20261119-192622-s4242');
  writeFileSync(join(root, 'web-routes.json'), JSON.stringify(['/from-config']));
  writeFileSync(join(root, 'bombadil-kit.json'), JSON.stringify({ projects: { web: { dir: 'app', server: { command: ['true'] }, routes: 'web-routes.json' } } }));
  // The CLI reads traces with the project's Bombadil: a fake that reads writeTrace's rows.
  mkdirSync(join(root, 'node_modules/.bin'), { recursive: true });
  copyFileSync(fileURLToPath(new URL('./fixtures/fake-bombadil.mjs', import.meta.url)), join(root, 'node_modules/.bin/bombadil'));
  const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
  execFileSync(process.execPath, [cli, 'report', '--runs', runs, '--out', out], { cwd: root, stdio: 'ignore' });
  const report = JSON.parse(readFileSync(join(out, 'report.json'), 'utf8'));
  assert.ok(report.projects[0].routes.some((r: { template: string }) => r.template === '/from-config'));
});
