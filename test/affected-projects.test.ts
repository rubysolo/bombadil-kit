import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectAffected } from '../src/affected/project.ts';
import type { ProjectConfig } from '../src/config.ts';
import { tmp } from './helpers.ts';

const CLI = fileURLToPath(new URL('../src/cli.ts', import.meta.url));

// Two apps sharing lib/Button.tsx; each has its own entry, router and flows.
const monorepo = () => {
  const root = tmp();
  const write = (path: string, text: string) => {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  write('lib/Button.tsx', 'export const Button = () => null;\n');
  write('lib/money.ts', 'export const money = 1;\n');
  for (const app of ['a', 'b']) {
    write(`apps/${app}/src/main.tsx`, "import App from './App';\nconsole.log(App);\n");
    write(`apps/${app}/src/App.tsx`, "import { Pay } from './Pay';\nimport { Home } from './Home';\nexport default [Pay, Home];\n");
    write(`apps/${app}/src/Pay.tsx`, "import { Button } from '../../../lib/Button';\nimport { money } from '../../../lib/money';\nexport const Pay = [Button, money];\n");
    write(`apps/${app}/src/Home.tsx`, 'export const Home = 1;\n');
    write(`apps/${app}/bombadil/flows.json`, JSON.stringify([
      { name: 'pay', start: '/pay', allow: ['/pay'] },
      { name: 'home', start: '/', allow: ['/'] },
    ]));
  }
  const project = (app: string) => ({
    dir: `apps/${app}`,
    server: { command: ['true'] },
    affected: { entry: `apps/${app}/src/main.tsx`, routers: [`apps/${app}/src/App.tsx`] },
  });
  write('bombadil-kit.json', JSON.stringify({ projects: { a: project('a'), b: project('b') } }));
  const flows = (app: string) => ({
    pay: [`apps/${app}/src/App.tsx`, `apps/${app}/src/Pay.tsx`, 'lib/Button.tsx'],
    home: [`apps/${app}/src/App.tsx`, `apps/${app}/src/Home.tsx`],
  });
  write('tmp/bombadil/report/coverage.json', JSON.stringify({ projects: { a: { flows: flows('a') }, b: { flows: flows('b') } } }));
  return { root, write, project };
};

const cli = (root: string, ...args: string[]) =>
  execFileSync(process.execPath, [CLI, 'affected', ...args], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

test('with several projects, affected maps the diff for each', () => {
  const { root } = monorepo();
  // A shared util picks pay in both apps; a page in one app picks only it.
  assert.equal(cli(root, '--files', 'lib/money.ts,apps/b/src/Home.tsx'), 'a pay\nb home\nb pay\n');

  const json = JSON.parse(cli(root, '--files', 'lib/money.ts', '--json'));
  assert.deepEqual(Object.keys(json), ['a', 'b']);
  assert.deepEqual(json.a, {
    flows: ['pay'],
    reasons: { pay: ['lib/money.ts → apps/a/src/Pay.tsx'] },
    unreached: [],
    everything: false,
  });
  assert.deepEqual(json.b.flows, ['pay']);
});

test('--project keeps the one-project output; --all forces the per-project one', () => {
  const { root } = monorepo();
  assert.equal(cli(root, '--project', 'a', '--files', 'lib/Button.tsx'), 'pay\n');
  assert.deepEqual(JSON.parse(cli(root, '--project', 'b', '--files', 'lib/Button.tsx', '--json')).changed, ['lib/Button.tsx']);
  assert.throws(() => cli(root, '--all', '--project', 'a', '--files', 'x'), /exclusive/);
});

test('one project: plain flows by default, `<project> <flow>` with --all', () => {
  const { root, write, project } = monorepo();
  write('bombadil-kit.json', JSON.stringify({ projects: { a: project('a') } }));
  assert.equal(cli(root, '--files', 'lib/Button.tsx'), 'pay\n');
  assert.equal(cli(root, '--all', '--files', 'lib/Button.tsx'), 'a pay\n');
});

test("a project's own fuzzer files and routes file pick its flows, not the other's", async () => {
  const { root, project } = monorepo();
  const coverage = { pay: ['lib/Button.tsx'], home: [] };
  const routes = { ...project('a'), routes: 'shared/a-routes.json' };
  const run = (changed: string[], p: ProjectConfig = routes) => projectAffected({ root, project: p, changed, coverage, coverageFile: 'c.json' });
  assert.equal((await run(['apps/a/bombadil/flows.json'])).everything, true);
  assert.equal((await run(['shared/a-routes.json'])).everything, true);
  assert.equal((await run(['apps/b/bombadil/flows.json'])).everything, false);
  assert.equal((await run(['apps/b/bombadil/flows.json'], project('b'))).everything, true);
});

test('without a coverage map for a project, every flow of that project', async () => {
  const { root, project } = monorepo();
  const r = await projectAffected({ root, project: project('a'), changed: ['lib/x.ts'], coverage: undefined, coverageFile: 'nightly.json' });
  assert.deepEqual(r.flows, ['pay', 'home']); // flows.json order
  assert.deepEqual(r.reasons.pay, ['no usable coverage map at nightly.json']);
  assert.equal(r.total, 2);
});
