import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applySweep, emptyState, statusOf } from '../src/report/state.ts';
import type { RunResult } from '../src/report/runs.ts';

const run = (id: string, routes: Record<string, number>, findings: { property: string; route: string }[], project = 'p'): RunResult => ({
  id: `${project}/${id}`,
  dir: `/runs/${project}/${id}`,
  meta: { project, spec: 's.ts', seed: 1, start: '/', started_at: '2026-11-19T00:00:00Z', commit: 'c', target: {}, bombadil: '0.7.10', exit_code: 0 },
  actions: 10,
  rendered: [],
  routes,
  findings: findings.map((f) => ({
    id: `F-${f.property}`,
    project,
    property: f.property,
    route: f.route,
    detail: '',
    summary: '',
    count: 1,
    first_at: '2026-11-19T00:00:00Z',
    url: f.route,
    snapshots: [],
    steps: [],
    frames: [],
  })),
});

test('a finding is new, then open, then quiet, then closed after 3 clean sweeps that reached its route', () => {
  let s = emptyState();
  s = applySweep(s, [run('a', { '/cart': 5 }, [{ property: 'spin', route: '/cart' }])], 't1');
  assert.equal(statusOf(s, 'F-spin').status, 'new');

  s = applySweep(s, [run('b', { '/cart': 5 }, [{ property: 'spin', route: '/cart' }])], 't2');
  assert.equal(statusOf(s, 'F-spin').status, 'open');

  s = applySweep(s, [run('c', { '/cart': 5 }, [])], 't3');
  assert.deepEqual(statusOf(s, 'F-spin'), { status: 'quiet', clean: 1 });

  // The route was not reached: says nothing about the bug.
  s = applySweep(s, [run('d', { '/login': 5 }, [])], 't4');
  // Another project ran: says nothing either.
  s = applySweep(s, [run('e', { '/cart': 5 }, [], 'other')], 't5');
  assert.deepEqual(statusOf(s, 'F-spin'), { status: 'quiet', clean: 1 });

  s = applySweep(s, [run('f', { '/cart': 1 }, [])], 't6');
  s = applySweep(s, [run('g', { '/cart': 1 }, [])], 't7');
  assert.deepEqual(statusOf(s, 'F-spin'), { status: 'closed', clean: 3 });

  // Seen again: open, not new.
  s = applySweep(s, [run('h', { '/cart': 1 }, [{ property: 'spin', route: '/cart' }])], 't8');
  assert.equal(statusOf(s, 'F-spin').status, 'open');
});

test('runs already in the state are not counted twice', () => {
  let s = emptyState();
  const r = run('a', { '/cart': 5 }, [{ property: 'spin', route: '/cart' }]);
  s = applySweep(s, [r], 't1');
  const again = applySweep(s, [r], 't2');
  assert.equal(again.sweeps.length, 1);
  assert.equal(again, s);
});

test('a sweep keeps the latest occurrence of each finding', () => {
  let s = emptyState();
  const a = run('a', { '/cart': 5 }, [{ property: 'spin', route: '/cart' }]);
  const b = run('b', { '/cart': 5 }, [{ property: 'spin', route: '/cart' }]);
  b.findings[0]!.summary = 'later';
  s = applySweep(s, [a, b], 't1');
  assert.equal(s.findings['F-spin']!.last.summary, 'later');
  assert.equal(s.findings['F-spin']!.last.run, 'p/b');
  assert.equal(s.findings['F-spin']!.sweeps.length, 1);
  assert.equal(s.findings['F-spin']!.runs_hit, 2);
});

test('coverage is each flow\'s union of rendered files, across sweeps', () => {
  const r = (id: string, flow: string, rendered: string[]): RunResult => ({ ...run(id, { '/x': 1 }, []), meta: { ...run(id, {}, []).meta, flow }, rendered });
  let s = emptyState();
  s = applySweep(s, [r('a', 'deposit', ['A.tsx', 'B.tsx']), r('b', 'finalize', ['A.tsx', 'F.tsx'])], 't1');
  s = applySweep(s, [r('c', 'deposit', ['C.tsx'])], 't2');
  assert.deepEqual(s.coverage, { p: { deposit: ['A.tsx', 'B.tsx', 'C.tsx'], finalize: ['A.tsx', 'F.tsx'] } });
});

test('an older state.json without coverage still loads', () => {
  const old = { ...emptyState(), coverage: undefined } as unknown as ReturnType<typeof emptyState>;
  const s = applySweep(old, [run('a', { '/x': 1 }, [])], 't1');
  assert.deepEqual(s.coverage, { p: { explore: [] } });
});
