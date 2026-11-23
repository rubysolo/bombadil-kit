import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmp } from './helpers.ts';

const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
const kit = (cwd: string, ...args: string[]) => spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8' });

const repo = () => {
  const root = tmp();
  writeFileSync(join(root, 'bombadil-kit.json'), JSON.stringify({ projects: { web: { dir: '.', server: { command: ['true'] } } } }));
  return root;
};

// CI reads 2 as "violations found, carry on" (templates/*/fuzz*): a run that
// failed for any other reason must not say 2.
test('cli: a run that fails before fuzzing exits 1, not 2', () => {
  const r = kit(repo(), 'run', '--flow', 'nope');
  assert.match(r.stderr, /no flow named nope/);
  assert.equal(r.status, 1);
});

test('cli: a bad option to run exits 1', () => {
  const r = kit(repo(), 'run', '--bogus');
  assert.equal(r.status, 1);
});

test('cli: an unknown command prints the usage and exits 2; --help exits 0', () => {
  const root = repo();
  assert.equal(kit(root, 'nope').status, 2);
  const help = kit(root, '--help');
  assert.equal(help.status, 0);
  assert.match(help.stderr, /bombadil-kit run/);
});

test('cli: another command that fails exits 1', () => {
  // No runs yet: report has nothing to fold.
  const r = kit(repo(), 'report');
  assert.match(r.stderr, /no runs under/);
  assert.equal(r.status, 1);
});
