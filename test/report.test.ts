import { test } from 'node:test';
import assert from 'node:assert/strict';
import { specProperties } from '../src/report/project.ts';
import { buildReport } from '../src/report/report.ts';
import { applySweep, emptyState } from '../src/report/state.ts';
import type { RunResult } from '../src/report/runs.ts';

test('specProperties reads the property names a spec exports', () => {
  const spec = `
export {
  noHttpErrorCodes,
  noUncaughtExceptions,
} from '@antithesishq/bombadil/browser/defaults/properties';
export { noErrorBoundary, spinnersSettle as spins } from './properties.ts';
export const local = always(() => true);
import { weighted } from '@antithesishq/bombadil/browser';
export const appActions = weighted([]);
`;
  assert.deepEqual(specProperties(spec), ['noHttpErrorCodes', 'noUncaughtExceptions', 'noErrorBoundary', 'spins', 'local']);
});

const run = (id: string, findings: { property: string; route: string }[]): RunResult => ({
  id: `web/${id}`,
  dir: `/runs/web/${id}`,
  meta: { project: 'web', spec: 'spec.ts', seed: 42, start: '/login', started_at: 't', commit: 'abc1234', target: { kind: 'mock' }, bombadil: '0.7.10', exit_code: 2, command: 'npm run fuzz -- --seed 42' } as RunResult['meta'],
  actions: 100,
  routes: { '/login': 50, '/cart': 3 },
  rendered: [],
  findings: findings.map((f) => ({
    id: `F-${f.property}`, project: 'web', property: f.property, route: f.route, detail: '', summary: 'boom',
    count: 2, first_at: '2026-11-19T19:30:00.000Z', url: 'http://h/cart', snapshots: [{ name: 'x', value: 'boom' }],
    steps: [{ at: 't', action: 'click button "GO"', route: '/cart' }], frames: ['/runs/web/r1/screenshots/1.jpeg'],
  })),
});

test('buildReport derives statuses, the property matrix and route coverage', () => {
  let s = emptyState();
  s = applySweep(s, [run('r1', [{ property: 'spinnersSettle', route: '/cart' }, { property: 'noLeakedValues', route: '/login' }])], '2026-11-19T19:00:00Z');
  s = applySweep(s, [run('r2', [{ property: 'spinnersSettle', route: '/cart' }])], '2026-11-19T20:00:00Z');

  const report = buildReport(s, {
    'web': { properties: ['spinnersSettle', 'noLeakedValues', 'noErrorBoundary'], routes: ['/login', '/cart', '/finalize'] },
  }, { generatedAt: 'now', evidence: (f) => f.last.frames.map((_, i) => `evidence/${f.id}/${i}.jpeg`) });

  assert.equal(report.schema, 'bombadil-report/v1');
  const web = { projects: ['web'], actions: 100, routes: [2, 3], extra_routes: 0 };
  assert.deepEqual(report.summary, { new: 0, open: 1, quiet: 1, closed: 0, actions: 100, routes: [2, 3], latest_sweep: web, all: web });

  const p = report.projects[0]!;
  assert.equal(p.name, 'web');
  assert.deepEqual(p.properties, [
    { name: 'spinnersSettle', open: ['F-spinnersSettle'] },
    { name: 'noLeakedValues', open: [] },
    { name: 'noErrorBoundary', open: [] },
  ]);
  assert.deepEqual(p.routes, [
    { template: '/login', states: 50, known: true },
    { template: '/cart', states: 3, known: true },
    { template: '/finalize', states: 0, known: true },
  ]);
  assert.deepEqual(p.history.map((h) => h.findings), [2, 1]);

  const spin = report.findings.find((f) => f.id === 'F-spinnersSettle')!;
  assert.equal(spin.status, 'open');
  assert.equal(spin.seen_in, 2);
  assert.equal(spin.of_sweeps, 2);
  assert.equal(spin.repro.command, 'npm run fuzz -- --seed 42');
  assert.deepEqual(spin.evidence.frames, ['evidence/F-spinnersSettle/0.jpeg']);

  const leak = report.findings.find((f) => f.id === 'F-noLeakedValues')!;
  assert.equal(leak.status, 'quiet');
  assert.equal(leak.clean_sweeps, 1);

  // Open first, then by last seen.
  assert.deepEqual(report.findings.map((f) => f.id), ['F-spinnersSettle', 'F-noLeakedValues']);
});

test('buildReport lists API endpoints per project: inventory first, unreached ones included', () => {
  const withApi = (id: string, flow: string, api: RunResult['api']): RunResult => ({ ...run(id, []), meta: { ...run(id, []).meta, flow }, api });
  let s = emptyState();
  s = applySweep(
    s,
    [
      withApi('r1', 'order', { calls: { 'O.get': { ok: 2, slow: 1 }, 'X.extra': { ok: 1 } }, variants: { 'O.get': ['locked'] }, inventory: { 'O.get': ['default', 'locked'], 'O.save': [] } }),
      withApi('r2', 'browse', { calls: { 'O.get': { error: 1 } }, variants: {}, inventory: {} }),
    ],
    't1',
  );
  const report = buildReport(s, {}, { generatedAt: 'now', evidence: () => [] });
  assert.deepEqual(report.projects[0]!.api, {
    endpoints: [
      { key: 'O.get', flows: ['browse', 'order'], outcomes: { ok: 2, slow: 1, error: 1 }, variantsSeen: ['locked'], variantsKnown: ['default', 'locked'], known: true },
      { key: 'O.save', flows: [], outcomes: {}, variantsSeen: [], variantsKnown: [], known: true },
      { key: 'X.extra', flows: ['order'], outcomes: { ok: 1 }, variantsSeen: [], variantsKnown: [], known: false },
    ],
    reached: 1,
    known: 2,
  });

  const plain = buildReport(applySweep(emptyState(), [run('r1', [])], 't1'), {}, { generatedAt: 'now', evidence: () => [] });
  assert.ok(!('api' in plain.projects[0]!), 'no api data, no api field');
});

test('buildReport shows per flow its expected milestones (reached, history), the missed ones and the undeclared', () => {
  const r = (id: string, flow: string, milestones: Record<string, number> | undefined, expected: string[]): RunResult => {
    const base = run(id, []);
    return { ...base, meta: { ...base.meta, flow, expected_milestones: expected }, ...(milestones ? { milestones } : {}) };
  };
  let s = emptyState();
  s = applySweep(s, [r('r1', 'save', { saved: 1, persisted: 1 }, ['saved', 'persisted'])], 't1');
  s = applySweep(s, [r('r2', 'save', { saved: 2, signedOut: 1 }, ['saved', 'persisted']), r('r3', 'browse', undefined, ['found'])], 't2');
  const report = buildReport(s, {}, { generatedAt: 'now', evidence: () => [] });
  assert.deepEqual(report.projects[0]!.milestones, [
    {
      flow: 'save',
      sweep: 2,
      runs: 1,
      recorded: true,
      expected: [
        { name: 'saved', reached: 2, history: [{ sweep: 1, reached: 1 }, { sweep: 2, reached: 2 }] },
        { name: 'persisted', reached: 0, history: [{ sweep: 1, reached: 1 }, { sweep: 2, reached: 0 }] },
      ],
      missed: ['persisted'],
      undeclared: [{ name: 'signedOut', reached: 1 }],
    },
    {
      flow: 'browse',
      sweep: 2,
      runs: 1,
      recorded: false,
      expected: [{ name: 'found', reached: 0, history: [{ sweep: 2, reached: 0 }] }],
      missed: ['found'],
      undeclared: [],
    },
  ]);
  // A missed milestone is not a finding.
  assert.deepEqual(report.findings, []);
  assert.equal(report.summary.new, 0);

  const plain = buildReport(applySweep(emptyState(), [run('r1', [])], 't1'), {}, { generatedAt: 'now', evidence: () => [] });
  assert.ok(!('milestones' in plain.projects[0]!), 'no milestones, no milestones field');
});

test('repro.replay rides along with the run, and a run without it is as before', () => {
  const withReplay = run('r9', [{ property: 'spinnersSettle', route: '/cart' }]);
  withReplay.meta = { ...withReplay.meta, replay: 'npx bombadil-kit run --reproduce tmp/r/web/r9 --faults 0.1 --width 390 --height 844' };
  let s = applySweep(emptyState(), [withReplay, run('r10', [{ property: 'noLeakedValues', route: '/login' }])], '2026-11-19T19:00:00Z');
  const report = buildReport(s, { web: { properties: [], routes: [] } }, { generatedAt: 'now', evidence: () => [] });

  const replayed = report.findings.find((f) => f.id === 'F-spinnersSettle')!;
  assert.equal(replayed.repro.replay, 'npx bombadil-kit run --reproduce tmp/r/web/r9 --faults 0.1 --width 390 --height 844');
  // Beside the command that runs the flow again, not instead of it.
  assert.equal(replayed.repro.command, 'npm run fuzz -- --seed 42');
  // A run from before the field keeps its finding's shape: no replay, no key.
  const older = report.findings.find((f) => f.id === 'F-noLeakedValues')!;
  assert.equal(older.repro.replay, undefined);
  assert.ok(!('replay' in older.repro));
});


test('a replay is listed with its runs but is no sweep: it reaches routes without testing them', () => {
  const replay = (id: string): RunResult => {
    const r = run(id, []);
    r.meta = { ...r.meta, replay_of: 'tmp/bombadil/runs/web/r1', exit_code: 1 };
    return r;
  };
  let s = applySweep(emptyState(), [run('r1', [{ property: 'spinnersSettle', route: '/cart' }])], 't1');
  // Three replays that reached /cart cleanly, each folded in on its own.
  for (const id of ['p1', 'p2', 'p3']) s = applySweep(s, [replay(id)], 't');
  assert.equal(s.sweeps.length, 1, 'no sweep for replays alone');
  let report = buildReport(s, { web: { properties: [], routes: ['/cart'] } }, { generatedAt: 'now', evidence: () => [] });
  assert.equal(report.findings[0]!.status, 'new', 'still new: nothing re-tested it');
  assert.equal(report.projects[0]!.routes.find((r) => r.template === '/cart')!.states, 3, 'routes are r1\'s alone');
  assert.deepEqual(report.projects[0]!.runs.map((r) => [r.id, r.replay_of]), [
    ['web/r1', undefined], ['web/p1', 'tmp/bombadil/runs/web/r1'], ['web/p2', 'tmp/bombadil/runs/web/r1'], ['web/p3', 'tmp/bombadil/runs/web/r1'],
  ]);

  // Beside an explored run, the sweep is the explored run's alone.
  s = applySweep(s, [run('r2', []), replay('p4')], 't2');
  assert.deepEqual(s.sweeps.at(-1)!.projects.web!.runs, ['web/r2']);
  assert.equal(s.sweeps.at(-1)!.projects.web!.actions, 100);
  report = buildReport(s, { web: { properties: [], routes: ['/cart'] } }, { generatedAt: 'now', evidence: () => [] });
  assert.equal(report.findings[0]!.clean_sweeps, 1);
  assert.deepEqual(report.projects[0]!.runs.map((r) => r.id), ['web/r2', 'web/p4']);
});

const projectRun = (project: string, id: string, actions: number, routes: Record<string, number>): RunResult => ({
  ...run(id, []),
  id: `${project}/${id}`,
  dir: `/runs/${project}/${id}`,
  meta: { ...run(id, []).meta, project },
  actions,
  routes,
});

test("the summary adds up every project's latest state, and says what the latest sweep alone covered", () => {
  let s = emptyState();
  s = applySweep(s, [projectRun('orders', 'r1', 120, { '/a': 5, '/b': 1 })], 't1');
  s = applySweep(s, [projectRun('upload', 'r2', 30, { '/x': 4 })], 't2');
  const report = buildReport(s, {
    orders: { properties: [], routes: ['/a', '/b', '/c', '/d'] },
    upload: { properties: [], routes: ['/x'] },
  }, { generatedAt: 'now', evidence: () => [] });

  assert.deepEqual(report.summary.all, { projects: ['orders', 'upload'], actions: 150, routes: [3, 5], extra_routes: 0 });
  assert.deepEqual(report.summary.latest_sweep, { projects: ['upload'], actions: 30, routes: [1, 1], extra_routes: 0 });
  // What `actions` and `routes` always meant: the latest sweep's.
  assert.equal(report.summary.actions, 30);
  assert.deepEqual(report.summary.routes, [1, 1]);
  // The per-sweep numbers stay in each project's history.
  assert.deepEqual(report.projects.map((p) => p.history.map((h) => h.actions)), [[120], [30]]);
});

test('routes not in the route list are counted apart, not in the coverage total', () => {
  let s = emptyState();
  s = applySweep(s, [projectRun('web', 'r1', 10, { '/login': 5, '/orders/:id': 2, '/debug': 1, '/x': 1 })], 't1');
  const report = buildReport(s, { web: { properties: [], routes: ['/login', '/orders/:id', '/cart', '/finalize'] } }, { generatedAt: 'now', evidence: () => [] });

  assert.deepEqual(report.summary.routes, [2, 4]);
  assert.deepEqual(report.summary.all, { projects: ['web'], actions: 10, routes: [2, 4], extra_routes: 2 });
  // The project still lists them, marked, for the coverage tab.
  assert.deepEqual(report.projects[0]!.routes.filter((r) => !r.known).map((r) => r.template), ['/debug', '/x']);
});
