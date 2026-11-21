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
  assert.deepEqual(report.summary, { new: 0, open: 1, quiet: 1, closed: 0, actions: 100, routes: [2, 3] });

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
