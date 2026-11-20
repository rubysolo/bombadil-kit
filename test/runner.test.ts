import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fill, findConfig, loadConfig, pickProject, readFlows } from '../src/config.ts';
import { bombadilArgs, selectFlows } from '../src/runner/run.ts';
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
