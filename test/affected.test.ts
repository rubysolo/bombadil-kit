import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { affectedFlows, importersOf } from '../src/affected/index.ts';
import { tmp } from './helpers.ts';

const coverage = {
  explore: ['app/App.tsx', 'app/Layout.tsx', 'app/pages/Login.tsx'],
  deposit: ['app/App.tsx', 'app/Layout.tsx', 'app/pages/Deposit.tsx', 'lib/Button.tsx'],
  finalize: ['app/App.tsx', 'app/Layout.tsx', 'app/pages/Finalize.tsx', 'lib/Button.tsx'],
};
// file -> the files that import it
const importers = {
  'app/pages/Deposit.tsx': ['app/App.tsx'],
  'app/pages/Finalize.tsx': ['app/App.tsx'],
  'app/pages/Login.tsx': ['app/App.tsx'],
  'app/pages/Unreached.tsx': ['app/App.tsx'],
  'app/money.ts': ['app/pages/Deposit.tsx', 'app/pages/Finalize.tsx'],
  'app/format.ts': ['app/money.ts'],
  'lib/Button.tsx': ['app/pages/Deposit.tsx', 'app/pages/Finalize.tsx', 'app/pages/Login.tsx'],
  'app/Layout.tsx': ['app/App.tsx'],
  'app/index.css': ['app/main.tsx'],
  'app/App.tsx': ['app/main.tsx'],
};
const opts = { routers: ['app/App.tsx'], always: [/^fuzz\//] };

test('a rendered component picks the flows that rendered it', () => {
  const r = affectedFlows(['app/pages/Deposit.tsx'], coverage, importers, opts);
  assert.deepEqual(r.flows, ['deposit']);
  assert.deepEqual(r.reasons, { deposit: ['app/pages/Deposit.tsx'] });
});

test('a shared component picks every flow that rendered it, not every importer', () => {
  // Login imports Button, but only deposit and finalize rendered it.
  assert.deepEqual(affectedFlows(['lib/Button.tsx'], coverage, importers, opts).flows, ['deposit', 'finalize']);
});

test('code that renders nothing climbs to the nearest rendered importers', () => {
  const r = affectedFlows(['app/format.ts'], coverage, importers, opts);
  assert.deepEqual(r.flows, ['deposit', 'finalize']);
  assert.deepEqual(r.reasons.deposit, ['app/format.ts → app/pages/Deposit.tsx']);
});

test("the router doesn't count: it imports every page but renders one", () => {
  const r = affectedFlows(['app/pages/Unreached.tsx'], coverage, importers, opts);
  assert.deepEqual(r.flows, []);
  assert.deepEqual(r.unreached, ['app/pages/Unreached.tsx']);
});

test('the shell (layout, global CSS) is every flow', () => {
  assert.deepEqual(affectedFlows(['app/Layout.tsx'], coverage, importers, opts).flows, ['deposit', 'explore', 'finalize']);
  // main.tsx renders nothing itself but every flow ran it.
  assert.deepEqual(
    affectedFlows(['app/index.css'], { ...coverage, explore: [...coverage.explore, 'app/main.tsx'] }, importers, opts).flows,
    ['explore'],
  );
});

test('the fuzzer itself changing runs every flow', () => {
  const r = affectedFlows(['fuzz/flows.json'], coverage, importers, opts);
  assert.deepEqual(r.flows, ['deposit', 'explore', 'finalize']);
  assert.equal(r.everything, true);
});

test('files outside the app pick nothing', () => {
  const r = affectedFlows(['README.md', 'app/pages/Deposit.test.tsx'], coverage, importers, opts);
  assert.deepEqual(r.flows, []);
  assert.deepEqual(r.unreached, []);
});

test('importersOf maps every import, code or asset, repo-relative', async () => {
  const root = tmp();
  const write = (path: string, text: string) => {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  write('app/src/main.tsx', "import './index.css';\nimport App from './App';\nconsole.log(App);\n");
  write('app/src/index.css', 'body{}');
  write('app/src/App.tsx', "import logo from './logo.webp';\nimport Icon from './icon.svg?react';\nimport { fmt } from './fmt';\nexport default () => [logo, Icon, fmt];\n");
  write('app/src/logo.webp', '');
  write('app/src/icon.svg', '<svg/>');
  write('app/src/fmt.ts', 'export const fmt = 1;\n');

  const graph = await importersOf(root, 'app/src/main.tsx');
  assert.deepEqual(graph['app/src/App.tsx'], ['app/src/main.tsx']);
  assert.deepEqual(graph['app/src/index.css'], ['app/src/main.tsx']);
  assert.deepEqual(graph['app/src/logo.webp'], ['app/src/App.tsx']);
  assert.deepEqual(graph['app/src/icon.svg'], ['app/src/App.tsx']);
  assert.deepEqual(graph['app/src/fmt.ts'], ['app/src/App.tsx']);
});
