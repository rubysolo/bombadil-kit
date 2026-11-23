import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildRun, parseRun, readRunRecord, replayProject, replaySettings, rerunCommand, writeRunRecord, type FlowRun, type SweepFacts } from '../src/report/record.ts';
import { tmp } from './helpers.ts';

const sweep: SweepFacts = {
  project: 'web', named: true, kind: 'mock',
  seed: 7, faults: 0.1, latency: 50, refDate: '2026-11-21', time: '3m', width: 1280, height: 800,
  commit: 'abc1234', bombadil: '0.7.10',
};
const flow: FlowRun = {
  flow: 'checkout', spec: 'apps/web/bombadil/checkout.ts', dir: 'tmp/bombadil/runs/web/20261121-000000-s7-checkout',
  start: '/cart', startedAt: '2026-11-21T00:00:00Z', exitCode: 2,
};

/** Built, written to a run dir and read back: what every reader of run.json sees. */
const roundTrip = (s: SweepFacts, f: FlowRun) => {
  const dir = tmp();
  writeRunRecord(dir, buildRun(s, f));
  return { dir, record: readRunRecord(dir), raw: JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8')) };
};

test('record: a mock run round-trips to the same seed, faults, latency, date, viewport, flow and spec', () => {
  const { record, raw } = roundTrip(sweep, flow);
  // The field values readers rely on, unchanged from bombadil-run/v1.
  assert.equal(raw.schema, 'bombadil-run/v1');
  assert.deepEqual(raw.target, { kind: 'mock', flow: 'checkout', faults: 0.1, latency_ms: 50, viewport: '1280x800', mock_ref_date: '2026-11-21' });
  assert.equal(raw.time_limit, '3m');
  assert.equal(raw.exit_code, 2);
  assert.deepEqual(
    replaySettings(record, 'apps/web/bombadil', flow.dir),
    { flows: ['checkout'], spec: 'checkout', seed: 7, time: '3m', width: 1280, height: 800, faults: 0.1, latency: 50, refDate: '2026-11-21', replayOf: flow.dir },
  );
});

test('record: it carries the commands that rerun and replay it', () => {
  const { record } = roundTrip(sweep, flow);
  assert.equal(record.command, 'npx bombadil-kit run --project web --flow checkout --seed 7 --faults 0.1 --ref-date 2026-11-21 --time 3m --width 1280 --height 800');
  assert.equal(record.replay, `npx bombadil-kit run --project web --reproduce ${flow.dir}`);
  // One project: the commands need no --project.
  const one = roundTrip({ ...sweep, named: false }, flow).record;
  assert.equal(one.replay, `npx bombadil-kit run --reproduce ${flow.dir}`);
  assert.equal(rerunCommand(one), one.command);
});

test('record: a live run records only what the runner controls, and replays without faults or a mock date', () => {
  const { record, raw } = roundTrip({ ...sweep, kind: 'live', faults: 0, width: 390, height: 844 }, flow);
  assert.deepEqual(raw.target, { kind: 'live', flow: 'checkout', viewport: '390x844' });
  assert.equal(record.command, 'npx bombadil-kit run --project web --flow checkout --time 3m --width 390 --height 844');
  const settings = replaySettings(record, 'apps/web/bombadil');
  assert.equal(settings.faults, undefined);
  assert.equal(settings.refDate, undefined);
  assert.equal(settings.width, 390);
});

test('record: what went after -- is recorded and handed again; milestones and replay_of only when there are some', () => {
  const plain = roundTrip(sweep, flow).raw;
  for (const key of ['bombadil_args', 'expected_milestones', 'replay_of']) assert.ok(!(key in plain), key);
  const { raw } = roundTrip({ ...sweep, bombadilArgs: ['--exit-on-violation'], replayOf: 'tmp/r/web/1' }, { ...flow, milestones: ['paid'] });
  assert.deepEqual(raw.bombadil_args, ['--exit-on-violation']);
  assert.ok(raw.command.endsWith(' -- --exit-on-violation'));
  assert.deepEqual(raw.expected_milestones, ['paid']);
  assert.equal(raw.replay_of, 'tmp/r/web/1');
});

test("record: a replay's spec is named relative to the project's specs dir, wherever that is", () => {
  const { record } = roundTrip(sweep, { ...flow, spec: 'e2e/bombadil/ph-portal/spec.ts' });
  assert.equal(replaySettings(record, 'e2e/bombadil/ph-portal').spec, 'spec');
  assert.equal(replaySettings(record, 'e2e/bombadil').spec, 'ph-portal/spec');
  // Not under the specs dir: an error, not a guess that falls back to the flow's spec.
  assert.throws(() => replaySettings(record, 'apps/web/bombadil'), /not under apps\/web\/bombadil/);
});

test('record: a replay runs in the project the run names; a --project that disagrees is an error', () => {
  const { record } = roundTrip(sweep, flow);
  assert.equal(replayProject(record), 'web');
  assert.equal(replayProject(record, 'web'), 'web');
  assert.throws(() => replayProject(record, 'admin'), /is project web, not admin/);
});

test('record: parsing refuses what the kit could not read, naming the file and the field', () => {
  const good = buildRun(sweep, flow);
  const without = (key: string) => Object.fromEntries(Object.entries(good).filter(([k]) => k !== key));
  assert.throws(() => parseRun(without('project'), 'x/run.json'), /^Error: x\/run.json: project must be a string/);
  assert.throws(() => parseRun({ ...good, seed: '7' }), /seed must be a number/);
  assert.throws(() => parseRun({ ...good, target: { ...good.target, viewport: '1280' } }), /target.viewport must be <width>x<height>/);
  assert.throws(() => parseRun({ ...good, target: { ...good.target, kind: 'staging' } }), /target.kind must be mock or live/);
  assert.throws(() => parseRun({ ...good, schema: 'bombadil-run/v2' }), /schema/);
  assert.throws(() => parseRun([]), /not an object/);
  const dir = tmp();
  writeFileSync(join(dir, 'run.json'), JSON.stringify({ ...good, exit_code: null }));
  assert.throws(() => readRunRecord(dir), new RegExp(`${dir}/run.json: exit_code`));
});

test('record: a run from before the newer fields still parses', () => {
  const old = { project: 'web', spec: 'apps/web/bombadil/spec.ts', seed: 1, start: '/', started_at: 't', commit: 'abc', target: {}, bombadil: '0.7.10', exit_code: 0 };
  const r = parseRun(old);
  assert.equal(r.command, undefined);
  assert.equal(replaySettings(r, 'apps/web/bombadil').width, undefined);
});
