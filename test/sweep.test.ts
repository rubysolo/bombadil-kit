import { mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { loadConfig } from '../src/config.ts';
import { readRunRecord } from '../src/report/record.ts';
import { run, type RunOptions } from '../src/runner/run.ts';
import { fakeProcesses, type FakeOptions } from './fake-processes.ts';
import { tmp } from './helpers.ts';

/** A repo with one project, `web` in app/, two flows and a spec. */
const repo = (project: Record<string, unknown> = {}) => {
  const root = tmp();
  mkdirSync(join(root, 'app/bombadil'), { recursive: true });
  writeFileSync(join(root, 'app/bombadil/spec.ts'), "export { noLeakedValues } from './properties.ts';\n");
  writeFileSync(join(root, 'app/bombadil/flows.json'), JSON.stringify([
    { name: 'explore', start: '/', allow: ['/*'] },
    { name: 'checkout', start: '/cart?world={seed}', allow: ['/cart*'], milestones: ['paid'] },
  ]));
  writeFileSync(join(root, 'bombadil-kit.json'), JSON.stringify({
    projects: { web: { dir: 'app', server: { command: ['vite', '--port', '{port}'], env: { SEED: '{seed}' } }, ...project } },
  }));
  return loadConfig(join(root, 'bombadil-kit.json'));
};

const options = (o: Partial<RunOptions> = {}): RunOptions => ({ project: 'web', flows: [], seed: 7, refDate: '2026-11-21', time: '30s', report: false, ...o });

const sweep = async (fake: FakeOptions = {}, o: Partial<RunOptions> = {}, loaded = repo()) => {
  const f = fakeProcesses(fake);
  // What it says on stderr, kept from the test output.
  const error = mock.method(console, 'error', () => {});
  try {
    const result = await run(loaded, options(o), f.procs);
    return { ...f, ...result, loaded, said: error.mock.calls.map((c) => c.arguments.join(' ')).join('\n') };
  } finally {
    error.mock.restore();
  }
};

test('sweep: clean flows are 0, with one server started and stopped, and a run record per flow', async () => {
  const { status, runs, calls, loaded } = await sweep({}, { report: true });
  assert.equal(status, 0);
  assert.equal(calls.started.length, 1);
  assert.deepEqual(calls.started[0]!.args, ['--port', '5199']);
  assert.equal(calls.started[0]!.env.SEED, '7');
  assert.equal(calls.stops, 1);
  assert.equal(calls.untrapped, calls.trapped);
  assert.deepEqual(runs.map((r) => r.record.flow), ['explore', 'checkout']);
  // What it returns is what it wrote, and what the report reads.
  for (const r of runs) assert.deepEqual(readRunRecord(r.dir), r.record);
  const checkout = runs[1]!.record;
  assert.equal(checkout.spec, 'app/bombadil/spec.ts');
  assert.equal(checkout.start, '/cart?world=7');
  assert.equal(checkout.commit, 'abc1234');
  assert.deepEqual(checkout.expected_milestones, ['paid']);
  assert.equal(checkout.command, 'npx bombadil-kit run --flow checkout --seed 7 --faults 0.1 --ref-date 2026-11-21 --time 30s --width 390 --height 844');
  assert.equal(checkout.replay, `npx bombadil-kit run --reproduce ${relative(loaded.root, runs[1]!.dir)}`);
  // One report rebuild, for the whole sweep.
  const state = JSON.parse(readFileSync(join(loaded.out, 'report/state.json'), 'utf8'));
  assert.equal(state.sweeps.length, 1);
  assert.equal(Object.keys(state.runs).length, 2);
});

test("sweep: each run keeps the part of the server's log written while it ran", async () => {
  const { runs } = await sweep();
  const [first, second] = runs.map((r) => readFileSync(join(r.dir, 'app.log'), 'utf8'));
  assert.equal(first, `server: GET for ${runs[0]!.dir}\n`);
  assert.equal(second, `server: GET for ${runs[1]!.dir}\n`);
});

test('sweep: a property violation in any flow is 2, and outranks a flow that failed', async () => {
  assert.equal((await sweep({ rc: [0, 2] })).status, 2);
  assert.equal((await sweep({ rc: [2, 0] })).status, 2);
  assert.equal((await sweep({ rc: [1, 2] })).status, 2);
  const { runs } = await sweep({ rc: [2, 0] });
  assert.deepEqual(runs.map((r) => r.record.exit_code), [2, 0]);
});

test("sweep: a flow whose Bombadil failed otherwise is 1, and its run is still recorded", async () => {
  const { status, runs } = await sweep({ rc: [0, 101] });
  assert.equal(status, 1);
  assert.equal(runs[1]!.record.exit_code, 101);
});

test('sweep: a server that never comes up is 1, not a finding, and no flow runs', async () => {
  const { status, runs, calls, said } = await sweep({ server: 'never' });
  assert.equal(status, 1);
  assert.match(said, /bombadil-kit run: the server never came up; see .*\.server\.log/);
  assert.deepEqual(runs, []);
  assert.equal(calls.bombadil.length, 0);
  assert.equal(calls.stops, 1, 'the server it started is stopped');
});

test('sweep: a server that exits is 1', async () => {
  const { status, calls, said } = await sweep({ server: 'exits' });
  assert.equal(status, 1);
  assert.match(said, /the server exited; see /);
  assert.equal(calls.bombadil.length, 0);
});

test('sweep: another server taking the port as ours starts is 1: it never sweeps the other app', async () => {
  const { status, calls, said } = await sweep({ server: 'taken' });
  assert.equal(status, 1);
  assert.match(said, /another server took http:\/\/127\.0\.0\.1:5199 as ours started.*pass another --port/);
  assert.equal(calls.bombadil.length, 0);
});

test('sweep: something already on the port is 1, unless reuse was asked for: then it is used and left running', async () => {
  const refused = await sweep({ busy: true });
  assert.equal(refused.status, 1);
  assert.match(refused.said, /already serving http:\/\/127\.0\.0\.1:5199.*--reuse-server/);
  assert.equal(refused.calls.started.length, 0);

  const reused = await sweep({ busy: true }, { reuseServer: true });
  assert.equal(reused.status, 0);
  assert.equal(reused.calls.started.length, 0);
  assert.equal(reused.calls.stops, 0);
  assert.equal(readFileSync(join(reused.runs[0]!.dir, 'app.log'), 'utf8'), '');
});

test('sweep: an error mid-sweep is 1, and the server is stopped and the signal handlers removed', async () => {
  const { status, calls, serverExited } = await sweep({ bombadilThrows: true });
  assert.equal(status, 1);
  assert.equal(calls.bombadil.length, 1);
  assert.ok(serverExited());
  assert.equal(calls.stops, 1);
  assert.equal(calls.untrapped, calls.trapped);
});

test('sweep: a missing spec, an unknown flow, or faults on a live project are 1, before any server starts', async () => {
  const loaded = repo();
  rmSync(join(loaded.root, 'app/bombadil/spec.ts'));
  const noSpec = await sweep({}, {}, loaded);
  assert.equal(noSpec.status, 1);
  assert.match(noSpec.said, /no spec at .*spec\.ts/);
  assert.equal(noSpec.calls.started.length, 0);

  const noFlow = await sweep({}, { flows: ['nope'] });
  assert.equal(noFlow.status, 1);
  assert.equal(noFlow.calls.started.length, 0);

  const live = await sweep({}, { faults: 0.2 }, repo({ target: 'live' }));
  assert.equal(live.status, 1);
  assert.match(live.said, /live project has no fault injector/);
  assert.equal(live.calls.started.length, 0);
});

test('sweep: --reproduce replays a recorded run with its settings, and records what it replayed', async () => {
  const loaded = repo();
  const first = await sweep({}, { flows: ['checkout'], seed: 41, width: 1280, height: 800 }, loaded);
  // Runs are named by the second they start in: move the first out of the replay's way.
  const original = join(loaded.out, 'runs/web/original');
  renameSync(first.runs[0]!.dir, original);
  const dir = relative(loaded.root, original);
  const again = await sweep({ rc: [2] }, { project: '', flows: [], seed: undefined, reproduce: dir, bombadilArgs: ['--exit-on-violation'] }, loaded);
  assert.equal(again.status, 2);
  const args = again.calls.bombadil[0]!;
  assert.equal(args[args.indexOf('--reproduce') + 1], join(original, 'trace.bin'));
  assert.ok(!args.includes('--exit-on-violation'), 'nothing after the original -- carries into a replay');
  assert.equal(again.calls.started[0]!.env.SEED, '41');
  const record = again.runs[0]!.record;
  assert.equal(record.flow, 'checkout');
  assert.equal(record.seed, 41);
  assert.equal(record.target.viewport, '1280x800');
  assert.equal(record.replay_of, dir);
});

test('sweep: --reproduce of a directory without a run is 1', async () => {
  const { status, calls, said } = await sweep({}, { reproduce: 'tmp/nowhere' });
  assert.equal(status, 1);
  assert.match(said, /no run\.json in .*tmp\/nowhere/);
  assert.equal(calls.started.length, 0);
});
