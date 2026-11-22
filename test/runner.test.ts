import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fill, findConfig, loadConfig, pickProject, projectRoutes, readFlows } from '../src/config.ts';
import { bombadilArgs, replayCommand, replayProject, reproOptions, rerunCommand, runTarget, serverChoice, waitForServer, sweepEnd, sweepReport, sweepSettings } from '../src/runner/run.ts';
import { ownArgs, tail as cliTail } from '../src/cli.ts';
import { selectFlows } from '../src/runner/run.ts';
import { row, tmp, writeRun } from './helpers.ts';

const flows = [
  { name: 'explore', start: '/login', allow: ['/*'] },
  { name: 'checkout', start: '/cart', allow: ['/cart*', '/orders/1'], signedIn: true },
];

test('fill replaces known placeholders and leaves the rest', () => {
  assert.equal(fill('--port {port} {seed}/{nope}', { port: 5199, seed: 7 }), '--port 5199 7/{nope}');
});

test('selectFlows keeps flows.json order and rejects unknown names', () => {
  assert.deepEqual(selectFlows(flows, []).map((f) => f.name), ['explore', 'checkout']);
  assert.deepEqual(selectFlows(flows, ['checkout', 'explore']).map((f) => f.name), ['explore', 'checkout']);
  assert.throws(() => selectFlows(flows, ['nope']), /no flow named nope/);
});

const base = {
  origin: 'http://127.0.0.1:5199',
  specFile: '/repo/apps/web/bombadil/spec.ts',
  outDir: '/repo/tmp/r',
  time: '1m',
  width: 390,
  height: 844,
  headless: true,
  sandbox: true,
  root: '/repo',
  appDir: 'apps/web',
};

test('bombadilArgs: fence as --allow-url and cookie, sign-in cookie, origin + start last', () => {
  const args = bombadilArgs({ ...base, flow: flows[1]!, signedInCookie: 'auth=fuzz' });
  assert.deepEqual(args.slice(-2), ['http://127.0.0.1:5199/cart', '/repo/apps/web/bombadil/spec.ts']);
  assert.ok(args.includes('--headless'));
  assert.ok(!args.includes('--no-sandbox'));
  const after = (flag: string) => args.flatMap((a, i) => (a === flag ? [args[i + 1]] : []));
  assert.deepEqual(after('--allow-url'), ['http://127.0.0.1:5199/cart*', 'http://127.0.0.1:5199/orders/1']);
  assert.deepEqual(after('--cookie'), [
    'auth=fuzz',
    `fuzz_fence=${encodeURIComponent('/cart*,/orders/1')}`,
    `fuzz_root=${encodeURIComponent('/repo')}`,
    `fuzz_app=${encodeURIComponent('apps/web')}`,
  ]);
});

test('bombadilArgs: a signed-in flow needs a signedInCookie', () => {
  assert.throws(() => bombadilArgs({ ...base, flow: flows[1]! }), /signedInCookie/);
});

test('config: found from below, one project picked by default, explore flow without flows.json', () => {
  const root = tmp();
  writeFileSync(join(root, 'bombadil-kit.json'), JSON.stringify({ projects: { web: { dir: 'apps/web', server: { command: ['vite'] } } } }));
  mkdirSync(join(root, 'apps/web/src'), { recursive: true });
  const file = findConfig(join(root, 'apps/web/src'));
  const loaded = loadConfig(file);
  assert.equal(loaded.out, join(loaded.root, 'tmp/bombadil'));
  const [name, p] = pickProject(loaded);
  assert.equal(name, 'web');
  assert.deepEqual(readFlows(loaded.root, p), [{ name: 'explore', about: 'everything, from /', start: '/', allow: ['/*'] }]);
});

test('config: several projects need --project', () => {
  const root = tmp();
  const server = { command: ['vite'] };
  writeFileSync(join(root, 'bombadil-kit.json'), JSON.stringify({ projects: { a: { dir: 'a', server }, b: { dir: 'b', server } } }));
  const loaded = loadConfig(join(root, 'bombadil-kit.json'));
  assert.throws(() => pickProject(loaded), /pass --project/);
  assert.equal(pickProject(loaded, 'b')[0], 'b');
  assert.throws(() => pickProject(loaded, 'c'), /no project c/);
});

const sweep = { flow: 'checkout', faults: 0.1, latency: 50, seed: 7, refDate: '2026-11-21', time: '1m', width: 390, height: 844 };

test('runTarget: a mock project records faults, latency and the mock date, as before', () => {
  assert.deepEqual(runTarget('mock', sweep), {
    kind: 'mock', flow: 'checkout', faults: 0.1, latency_ms: 50, viewport: '390x844', mock_ref_date: '2026-11-21',
  });
});

test('runTarget: a live project records only what it controls', () => {
  assert.deepEqual(runTarget('live', sweep), { kind: 'live', flow: 'checkout', viewport: '390x844' });
});

test('rerunCommand: a live run has no seed, faults or ref date to replay', () => {
  assert.equal(
    rerunCommand('mock', sweep, ['--project', 'web']),
    'npx bombadil-kit run --project web --flow checkout --seed 7 --faults 0.1 --ref-date 2026-11-21 --time 1m --width 390 --height 844',
  );
  assert.equal(
    rerunCommand('live', sweep, ['--project', 'web-live']),
    'npx bombadil-kit run --project web-live --flow checkout --time 1m --width 390 --height 844',
  );
});

test('sweepSettings: live defaults to no faults and refuses them; mock keeps 0.1', () => {
  assert.equal(sweepSettings({ target: 'live' }, {}).faults, 0);
  assert.equal(sweepSettings({}, {}).faults, 0.1);
  assert.equal(sweepSettings({ defaults: { faults: 0.3 } }, {}).faults, 0.3);
  assert.throws(() => sweepSettings({ target: 'live' }, { faults: 0.2 }), /live.*faults/);
  assert.throws(() => sweepSettings({ target: 'live', defaults: { faults: 0.2 } }, {}), /live.*faults/);
  assert.equal(sweepSettings({ target: 'live' }, { faults: 0 }).faults, 0);
});

test('bombadilArgs: the start is filled with the run values, {port} too', () => {
  const world = { ...flows[0]!, start: '/?world={seed}&f={faults}&d={refDate}&p={port}&x={nope}' };
  const args = bombadilArgs({
    ...base,
    flow: world,
    values: { port: 5199, seed: 7, faults: 0.1, latency: 50, refDate: '2026-11-21' },
    seed: 7,
    faults: 0.1,
    refDate: '2026-11-21',
  });
  assert.equal(
    args.at(-2),
    'http://127.0.0.1:5199/?world=7&f=0.1&d=2026-11-21&p=5199&x={nope}',
  );
  // And the same values as cookies, for a page that reads neither.
  const after = (flag: string) => args.flatMap((a, i) => (a === flag ? [args[i + 1]] : []));
  assert.deepEqual(after('--cookie').slice(-3), ['fuzz_seed=7', 'fuzz_faults=0.1', 'fuzz_ref_date=2026-11-21']);
});

test('bombadilArgs: a start without placeholders is the URL it always was', () => {
  assert.deepEqual(bombadilArgs({ ...base, flow: flows[0]! }).slice(-2), [
    'http://127.0.0.1:5199/login',
    '/repo/apps/web/bombadil/spec.ts',
  ]);
});

test('bombadilArgs: args after -- go to Bombadil, before the URL and the spec', () => {
  const args = bombadilArgs({ ...base, flow: flows[0]!, extra: ['--exit-on-violation', '--max-steps', '50'] });
  // The tail is the last thing before the URL and the spec, which stay the final
  // two. (An --allow-url value can look like a flag, so read from the cookies.)
  const after = args.slice(args.lastIndexOf('fuzz_app=apps%2Fweb') + 1);
  assert.deepEqual(after, ['--exit-on-violation', '--max-steps', '50', 'http://127.0.0.1:5199/login', base.specFile]);
  assert.deepEqual(args.slice(-2), ['http://127.0.0.1:5199/login', base.specFile]);
});

test('bombadilArgs: a replay gets no time limit, and the same fence and spec', () => {
  const args = bombadilArgs({ ...base, flow: flows[0]!, replay: '/repo/tmp/r/trace.jsonl' });
  // A trace is read rather than explored, so there is nothing to time-limit; and
  // Bombadil refuses the two side by side, so the runner never offers one.
  assert.ok(!args.includes('--time-limit'));
  const i = args.indexOf('--reproduce');
  assert.ok(i > 0 && args[i + 1] === '/repo/tmp/r/trace.jsonl');
  assert.ok(args.includes('--allow-url'), 'the fence still applies');
  assert.deepEqual(args.slice(-2), ['http://127.0.0.1:5199/login', base.specFile]);
});

test('serverChoice: a free port is spawned on; one in use is an error unless reuse was asked for', () => {
  assert.equal(serverChoice(false, false, 'http://127.0.0.1:5199'), 'spawn');
  assert.equal(serverChoice(true, true, 'http://127.0.0.1:5199'), 'reuse');
  assert.throws(() => serverChoice(true, false, 'http://127.0.0.1:5199'), /already serving http:\/\/127\.0\.0\.1:5199.*--reuse-server/);
});

// A fake clock: each sleep advances it, so the server's answers and exits follow time, not wall time.
const fakeServer = ({ answersAt = Infinity, exitsAt = Infinity }: { answersAt?: number; exitsAt?: number }) => {
  let now = 0;
  return {
    ready: async () => now >= answersAt,
    exited: () => now >= exitsAt,
    sleep: async (ms: number) => void (now += ms),
  };
};

test('waitForServer: ready once something answers and the spawned server is still running after `settle`', async () => {
  assert.equal(await waitForServer({ ...fakeServer({ answersAt: 1500 }), interval: 500, settle: 1000 }), 'ready');
  assert.equal(await waitForServer({ ...fakeServer({ exitsAt: 1000 }), interval: 500 }), 'exited');
  assert.equal(await waitForServer({ ...fakeServer({}), tries: 4, interval: 500 }), 'timeout');
});

test('waitForServer: another server took the port after the check: it answers, ours exits, and that is not ready', async () => {
  // Something answers at once (another worktree's dev server), and the one we
  // spawned dies on --strictPort 300ms later: sweeping would test the wrong app.
  assert.equal(await waitForServer({ ...fakeServer({ answersAt: 0, exitsAt: 300 }), interval: 500, settle: 1000 }), 'taken');
});

const meta = {
  schema: 'bombadil-run/v1',
  project: 'web',
  spec: 'apps/web/bombadil/checkout.ts',
  seed: 7,
  start: '/cart',
  started_at: '2026-11-21T00:00:00Z',
  commit: 'abc1234',
  target: { kind: 'mock', faults: 0.1, latency_ms: 50, viewport: '1280x800', mock_ref_date: '2026-11-21' },
  bombadil: '0.7.10',
  exit_code: 2,
  flow: 'checkout',
  time_limit: '3m',
  command: 'npx bombadil-kit run --flow checkout',
  replay: 'npx bombadil-kit run --reproduce tmp/r/web/1',
} as const;

test('reproOptions: the recorded run\'s seed, faults, latency, date, viewport and spec', () => {
  const { options, project } = reproOptions(meta as never, 'apps/web/bombadil');
  assert.equal(project, 'web');
  assert.deepEqual(options, {
    flows: ['checkout'], spec: 'checkout', seed: 7, time: '3m',
    width: 1280, height: 800, faults: 0.1, latency: 50, refDate: '2026-11-21',
  });
  // Told where the run lives, the replay records it as the run it replays.
  assert.equal(reproOptions(meta as never, 'apps/web/bombadil', 'tmp/r/web/1').options.replayOf, 'tmp/r/web/1');
});

test('reproOptions: the spec is named relative to the project\'s specs dir, wherever that is', () => {
  const nested = { ...meta, spec: 'e2e/bombadil/ph-portal/spec.ts' };
  assert.equal(reproOptions(nested as never, 'e2e/bombadil/ph-portal').options.spec, 'spec');
  assert.equal(reproOptions(nested as never, 'e2e/bombadil').options.spec, 'ph-portal/spec');
  // Not under the specs dir: an error, not a guess that falls back to the flow's spec.
  assert.throws(() => reproOptions(nested as never, 'apps/web/bombadil'), /not under apps\/web\/bombadil/);
});

test('reproOptions: a live run has no faults or mock date to restart with', () => {
  const live = { ...meta, target: { kind: 'live', viewport: '390x844' } };
  const { options } = reproOptions(live as never, 'apps/web/bombadil');
  assert.equal(options.faults, undefined);
  assert.equal(options.refDate, undefined);
  assert.equal(options.width, 390);
});

test('replayProject: the run names its project; a --project that disagrees is an error', () => {
  assert.equal(replayProject('web', undefined), 'web');
  assert.equal(replayProject('web', 'web'), 'web');
  assert.throws(() => replayProject('web', 'admin'), /is project web, not admin/);
});

test('replayCommand: the run\'s directory, and nothing the replay would ignore', () => {
  assert.equal(replayCommand('tmp/r/web/1', ['--project', 'web']), 'npx bombadil-kit run --project web --reproduce tmp/r/web/1');
  assert.equal(replayCommand('tmp/r/web-live/1'), 'npx bombadil-kit run --reproduce tmp/r/web-live/1');
});

test('rerunCommand: what was handed to Bombadil after -- is handed again', () => {
  assert.ok(
    rerunCommand('mock', sweep, [], ['--exit-on-violation']).endsWith('-- --exit-on-violation'),
  );
});

test('the CLI takes everything after -- for Bombadil, the separator aside', () => {
  assert.deepEqual(cliTail(['--flow', 'checkout', '--', '--exit-on-violation', '--max-steps', '50']), ['--exit-on-violation', '--max-steps', '50']);
  assert.deepEqual(cliTail(['--flow', 'checkout']), []);
  assert.deepEqual(ownArgs(['--flow', 'checkout', '--', '--exit-on-violation']), ['--flow', 'checkout']);
});

test("the report a sweep rebuilds uses each project's routes, as `report` does", () => {
  const root = tmp();
  mkdirSync(join(root, 'apps/web/bombadil'), { recursive: true });
  writeFileSync(join(root, 'apps/web/bombadil/spec.ts'), "export { noLeakedValues } from './properties.ts';\n");
  writeFileSync(join(root, 'apps/web/bombadil/routes.json'), JSON.stringify(['/beside-the-spec']));
  mkdirSync(join(root, 'e2e'), { recursive: true });
  writeFileSync(join(root, 'e2e/web-routes.json'), JSON.stringify(['/login', '/from-config']));
  writeFileSync(join(root, 'bombadil-kit.json'), JSON.stringify({ projects: { web: { dir: 'apps/web', server: { command: ['vite'] }, routes: './e2e/web-routes.json' } } }));
  const loaded = loadConfig(join(root, 'bombadil-kit.json'));
  writeRun(join(loaded.out, 'runs'), { id: '20261119-192622-s1', rows: [row(0, '/login', null)] });

  const report = sweepReport(loaded, undefined, '2026-11-19T20:00:00Z');
  assert.deepEqual(report.projects[0]!.routes.filter((r) => r.known).map((r) => r.template).sort(), ['/from-config', '/login']);
});

test('sweepEnd: rebuilds the report, or with --no-report leaves the runs for one `report` later', () => {
  const root = tmp();
  mkdirSync(join(root, 'apps/web/bombadil'), { recursive: true });
  writeFileSync(join(root, 'apps/web/bombadil/spec.ts'), "export { noLeakedValues } from './properties.ts';\n");
  writeFileSync(join(root, 'bombadil-kit.json'), JSON.stringify({ projects: { web: { dir: 'apps/web', server: { command: ['vite'] } } } }));
  const loaded = loadConfig(join(root, 'bombadil-kit.json'));
  writeRun(join(loaded.out, 'runs'), { id: '20261119-192622-s1', rows: [row(0, '/login', null)] });

  const skipped = sweepEnd(loaded, { report: false });
  assert.ok(!existsSync(join(loaded.out, 'report', 'state.json')));
  assert.match(skipped.join('\n'), /--no-report: .*bombadil-kit report/);

  const built = sweepEnd(loaded, {});
  assert.ok(existsSync(join(loaded.out, 'report', 'state.json')));
  assert.match(built[0]!, /^sweep 1: /);
});

test('projectRoutes: repo-relative paths, projects without routes left out', () => {
  const root = tmp();
  writeFileSync(join(root, 'bombadil-kit.json'), JSON.stringify({ projects: {
    a: { dir: 'a', server: { command: ['vite'] }, routes: './e2e/bombadil/a/routes.json' },
    b: { dir: 'b', server: { command: ['vite'] } },
  } }));
  assert.deepEqual(projectRoutes(loadConfig(join(root, 'bombadil-kit.json'))), { a: 'e2e/bombadil/a/routes.json' });
});
