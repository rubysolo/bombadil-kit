import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PROPERTY_FACTORIES, specProperties } from '../src/report/project.ts';

test("PROPERTY_FACTORIES is exactly the spec library's property factories", () => {
  const source = readFileSync(join(import.meta.dirname, '../spec/index.ts'), 'utf8');
  // A property factory is an exported arrow function whose body returns always(…).
  // Its parameters may hold one level of parens (a function-typed option).
  const params = String.raw`\((?:[^()]|\([^()]*\))*\)`;
  const factories = [...source.matchAll(new RegExp(String.raw`export const (\w+) = ${params}[^=]*=> \{[\s\S]*?\n  return always\(`, 'g'))].map((m) => m[1]);
  const inline = [...source.matchAll(new RegExp(String.raw`export const (\w+) = ${params} => \{\n[^]*?\n\};`, 'g'))]
    .filter((m) => /\n  return always\(/.test(m[0]))
    .map((m) => m[1]);
  assert.deepEqual([...new Set([...factories, ...inline])].sort(), [...PROPERTY_FACTORIES].sort());
});

test('a spec built from kit factories lists them as properties', () => {
  const spec = `
export { noUncaughtExceptions } from '@antithesishq/bombadil/browser/defaults/properties';
export const noErrorBoundary = errorBoundaryNeverShown('[data-testid="crash"]');
export const spins = kit.spinnersClear({ within: 5 });
export const appActions = weighted([]);
export const mine = always(() => true);
`;
  const aliased = "import { appRenders as renders } from 'bombadil-kit/spec';\nexport const appRenders = renders();\n";
  assert.deepEqual(specProperties(aliased), ['appRenders']);
  assert.deepEqual(specProperties(spec), ['noUncaughtExceptions', 'noErrorBoundary', 'spins', 'mine']);
});

test("a spec's properties include those it re-exports with export *", async () => {
  const { mkdirSync, writeFileSync } = await import('node:fs');
  const { tmp } = await import('./helpers.ts');
  const { specFileProperties } = await import('../src/report/project.ts');
  const dir = join(tmp(), 'bombadil');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'props.ts'), "export const noErrorBoundary = errorBoundaryNeverShown();\nexport * from './spec.ts';\n");
  writeFileSync(
    join(dir, 'spec.ts'),
    "export { noUncaughtExceptions } from '@antithesishq/bombadil/browser/defaults/properties';\nexport * from './props.ts';\nexport * from '@antithesishq/bombadil/browser/defaults/actions';\n",
  );
  assert.deepEqual(specFileProperties(join(dir, 'spec.ts')), ['noUncaughtExceptions', 'noErrorBoundary']);
});

test('apiCalls, called and not exported, is not listed as a property', () => {
  const spec = "import { apiCalls, spinnersClear } from 'bombadil-kit/spec';\napiCalls();\nexport const spins = spinnersClear();\n";
  assert.deepEqual(specProperties(spec), ['spins']);
});

test('milestones, called and not exported, is not listed as a property', () => {
  const spec = "import { milestones, spinnersClear } from 'bombadil-kit/spec';\nmilestones({ saved: (doc) => !!doc.querySelector('.ok') });\nexport const spins = spinnersClear();\n";
  assert.deepEqual(specProperties(spec), ['spins']);
});
