import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fill, findConfig, loadConfig, pickProject, readFlows } from '../src/config.ts';
import { bombadilArgs, replayCommand, reproOptions, rerunCommand, runTarget, serverChoice, sweepSettings } from '../src/runner/run.ts';
import { ownArgs, tail as cliTail } from '../src/cli.ts';
import { selectFlows } from '../src/runner/run.ts';
import { tmp } from './helpers.ts';

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
  const { options, project } = reproOptions(meta as never);
  assert.equal(project, 'web');
  assert.deepEqual(options, {
    flows: ['checkout'], spec: 'checkout', seed: 7, time: '3m',
    width: 1280, height: 800, faults: 0.1, latency: 50, refDate: '2026-11-21',
  });
  // Told where the run lives, the replay is that directory's trace, and it keeps
  // whatever that run handed Bombadil after --.
  const again = reproOptions({ ...meta, bombadil_args: ['--max-steps', '50'] } as never, 'tmp/r/web/1');
  assert.deepEqual(again.options.bombadilArgs, ['--max-steps', '50']);
  assert.equal(again.options.flows?.[0], 'checkout');
});

test('reproOptions: a live run has no faults or mock date to restart with', () => {
  const live = { ...meta, target: { kind: 'live', viewport: '390x844' } };
  const { options } = reproOptions(live as never);
  assert.equal(options.faults, undefined);
  assert.equal(options.refDate, undefined);
  assert.equal(options.width, 390);
});

test('replayCommand: the run\'s directory, its faults and its viewport', () => {
  assert.equal(
    replayCommand('tmp/r/web/1', { faults: 0.1, width: 390, height: 844 }, ['--project', 'web']),
    'npx bombadil-kit run --project web --reproduce tmp/r/web/1 --faults 0.1 --width 390 --height 844',
  );
  assert.equal(
    replayCommand('tmp/r/web-live/1', { width: 390, height: 844 }),
    'npx bombadil-kit run --reproduce tmp/r/web-live/1 --width 390 --height 844',
  );
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
