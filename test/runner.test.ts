import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fill, findConfig, loadConfig, pickProject, projectRoutes, readFlows } from '../src/config.ts';
import { bombadilArgs, rerunCommand, runTarget, sweepReport, sweepSettings } from '../src/runner/run.ts';
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

test('projectRoutes: repo-relative paths, projects without routes left out', () => {
  const root = tmp();
  writeFileSync(join(root, 'bombadil-kit.json'), JSON.stringify({ projects: {
    a: { dir: 'a', server: { command: ['vite'] }, routes: './e2e/bombadil/a/routes.json' },
    b: { dir: 'b', server: { command: ['vite'] } },
  } }));
  assert.deepEqual(projectRoutes(loadConfig(join(root, 'bombadil-kit.json'))), { a: 'e2e/bombadil/a/routes.json' });
});
