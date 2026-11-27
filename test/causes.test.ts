import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { generate } from '../src/report/generate.ts';
import { summaryLine } from '../src/report/report.ts';
import { always, fakeTrace, rendered, row, tmp, writeRun } from './helpers.ts';

// Issue #45: one bug (a Blob cached in RTK Query) failed on every route that
// shows the same button, each finding with its own id, listed as unrelated.

const VITE = 'http://127.0.0.1:5199';
const setup = () => {
  const root = tmp();
  mkdirSync(join(root, 'app/bombadil'), { recursive: true });
  writeFileSync(join(root, 'app/bombadil/spec.ts'), "export { noUncaughtExceptions } from './properties.ts';\n");
  writeFileSync(join(root, 'app/bombadil/routes.json'), JSON.stringify(['/orders/:id', '/cart', '/', '/products/:id']));
  return { root, runs: join(root, 'runs'), out: join(root, 'report') };
};

const thrown = (message: string, file = 'src/components/InvoiceButton.tsx', line = 161) =>
  always('noUncaughtExceptions', [{
    name: 'uncaughtExceptions',
    value: [`Uncaught Error: ${message}\n    at onClick (${VITE}/${file}:${line}:10)\n    at call (${VITE}/node_modules/.vite/deps/chunk-A.js?v=1:6242:12)`],
  }]);

const sweepOf = (runs: string, id: string, violations: [string, ReturnType<typeof thrown>][]) =>
  writeRun(runs, {
    id,
    spec: 'app/bombadil/spec.ts',
    rows: violations.map(([url, v], i) => row(i, url, i ? 'Back' : null, [v])),
  });

test('one bug on three routes is one cause; another file or message is another', () => {
  const { root, runs, out } = setup();
  sweepOf(runs, 'r1', [
    ['/orders/ORD-1', thrown('A non-serializable value was detected')],
    ['/cart', thrown('A non-serializable value was detected')],
    ['/', thrown('A non-serializable value was detected', 'src/components/InvoiceButton.tsx', 170)],
    ['/products/P-1', thrown('A non-serializable value was detected', 'src/pages/Home.tsx')],
    ['/cart', thrown('something else')],
  ]);
  const { report } = generate({ trace: fakeTrace, runsRoot: runs, out, repoRoot: root, now: 't1' });
  assert.equal(report.findings.length, 5);
  const causes = report.causes!;
  assert.equal(causes.length, 3);
  const blob = causes.find((c) => c.findings.length === 3)!;
  // The line moved (161 → 170) and it's the same bug: the file, not the line, is the key.
  assert.deepEqual(blob.routes, ['/', '/cart', '/orders/:id']);
  assert.equal(blob.status, 'new');
  assert.equal(blob.frame, 'src/components/InvoiceButton.tsx (onClick)');
  for (const id of blob.findings) assert.equal(report.findings.find((f) => f.id === id)!.cause, blob.id);
  assert.deepEqual(report.summary.causes, { new: 3, open: 0, quiet: 0, closed: 0 });
  assert.match(summaryLine(report), /^sweep 1: 5 new, 0 open \(3 causes\), 0 quiet/);

  // The page lists the bug once, with where else it failed, and each finding links the rest.
  const home = rendered(report, '#/');
  assert.match(home, /New 5<\/h2><span class="dim" style="font-size:12px">first seen this sweep · 3 causes/);
  assert.match(home, /1 cause · 3 findings: \/, \/cart, \/orders\/:id/);
  assert.equal(home.split('class="case"').length - 1, 3);
  const page = rendered(report, '#/f/' + blob.findings[0]);
  assert.match(page, /<h2>Same cause<\/h2>/);
  // The headline is the message, not its stack.
  assert.match(page, /<h1>Uncaught Error: A non-serializable value was detected<\/h1>/);
  for (const id of blob.findings.slice(1)) assert.match(page, new RegExp(`href="#/f/${id}"`));
});

test('findings with no message and no app frame are each their own cause: nothing says they are one bug', () => {
  const { root, runs, out } = setup();
  const blank = always('noUncaughtExceptions', [{ name: 'uncaughtExceptions', value: [] }]);
  sweepOf(runs, 'r1', [['/', blank], ['/cart', blank]]);
  const { report } = generate({ trace: fakeTrace, runsRoot: runs, out, repoRoot: root, now: 't1' });
  assert.equal(report.findings.length, 2);
  assert.equal(report.causes!.length, 2);
});

test('a finding names its first app frame: the file and function, no line', () => {
  const { root, runs, out } = setup();
  sweepOf(runs, 'r1', [['/cart', thrown('boom')]]);
  const { report } = generate({ trace: fakeTrace, runsRoot: runs, out, repoRoot: root, now: 't1' });
  const f = report.findings[0]!;
  assert.equal(f.frame, 'src/components/InvoiceButton.tsx (onClick)');
  // The summary is what the violation carried, as it was.
  assert.match(f.summary, /InvoiceButton\.tsx:161:10/);
});

test('--fail-by cause: a known bug on a route the nightly never reached isn’t new', () => {
  const nightly = setup();
  sweepOf(nightly.runs, 'main-r1', [['/cart', thrown('A non-serializable value was detected')]]);
  generate({ trace: fakeTrace, runsRoot: nightly.runs, out: nightly.out, repoRoot: nightly.root, now: 't1' });

  const pr = () => {
    const p = setup();
    sweepOf(p.runs, 'pr-r1', [
      ['/cart', thrown('A non-serializable value was detected')],
      ['/orders/ORD-9', thrown('A non-serializable value was detected')],
    ]);
    return p;
  };
  const gate = (failBy?: 'finding' | 'cause') => {
    const p = pr();
    return generate({ trace: fakeTrace, runsRoot: p.runs, out: p.out, repoRoot: p.root, now: 't2', baseline: join(nightly.out, 'state.json'), failOn: 'new', failBy });
  };
  const byFinding = gate();
  assert.deepEqual(byFinding.report.findings.map((f) => `${f.route} ${f.status}`).sort(), ['/cart open', '/orders/:id new']);
  assert.equal(byFinding.exitCode, 1);
  const byCause = gate('cause');
  assert.deepEqual(byCause.report.causes!.map((c) => c.status), ['open']);
  assert.equal(byCause.exitCode, 0);
});

test('a cause is quiet while any of its findings is, closed only when all are', () => {
  const { root, runs, out } = setup();
  sweepOf(runs, 'r1', [['/cart', thrown('x')], ['/', thrown('x')]]);
  generate({ trace: fakeTrace, runsRoot: runs, out, repoRoot: root, now: 't1' });
  // Three sweeps reach /cart cleanly and never reach /: the /cart finding closes, the / one stays quiet.
  for (const id of ['r2', 'r3', 'r4']) {
    writeRun(runs, { id, spec: 'app/bombadil/spec.ts', rows: [row(0, '/cart', null)] });
    generate({ trace: fakeTrace, runsRoot: runs, out, repoRoot: root, now: id });
  }
  const { report } = generate({ trace: fakeTrace, runsRoot: runs, out, repoRoot: root, now: 't5' });
  assert.deepEqual(report.findings.map((f) => `${f.route} ${f.status}`).sort(), ['/ quiet', '/cart closed']);
  assert.deepEqual(report.causes!.map((c) => c.status), ['quiet']);
});
