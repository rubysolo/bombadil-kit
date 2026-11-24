import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

// Bombadil's bundler names an extractor after its binding only for a
// top-level `const x = extract(...)` (0.8.0 on; 0.7 named nested ones too).
// The kit's extractors live inside the functions that build properties, so
// each says its name: the report reads snapshots by name (`rendered` feeds
// coverage.json and so `affected`; `api`, `milestones`), and a finding shows
// its snapshots under them.
test('every extract() inside a function in spec/ is named(extract(...), name)', () => {
  const dir = join(import.meta.dirname, '..', 'spec');
  const unnamed: string[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
    const source = ts.createSourceFile(file, readFileSync(join(dir, file), 'utf8'), ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node, nested: boolean) => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'extract' && nested) {
        const wrap = node.parent;
        const named = ts.isCallExpression(wrap) && ts.isIdentifier(wrap.expression) && wrap.expression.text === 'named';
        if (!named) unnamed.push(`${file}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`);
      }
      ts.forEachChild(node, (child) => visit(child, nested || ts.isFunctionLike(node)));
    };
    visit(source, false);
  }
  assert.deepEqual(unnamed, []);
});
