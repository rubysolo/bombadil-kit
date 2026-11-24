import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bombadilTrace } from '../src/trace.ts';
import { row, tmp, writeTrace } from './helpers.ts';

// test/fixtures/fake-bombadil.mjs answers `bombadil trace` as 0.8 does, over writeTrace's rows.
const bin = fileURLToPath(new URL('./fixtures/fake-bombadil.mjs', import.meta.url));

const traceOf = (n: number) => {
  const file = join(tmp(), 'trace.bin');
  writeTrace(file, Array.from({ length: n }, (_, i) => row(i, `/p/${i}`, i === 0 ? null : 'Wait')));
  return file;
};

test('bombadilTrace: every state in order, a chunk per call, however the chunks fall', () => {
  for (const n of [0, 1, 4, 5]) {
    const states = [...bombadilTrace(bin, 2).states(traceOf(n))];
    assert.deepEqual(states.map((s) => s.index), Array.from({ length: n }, (_, i) => i), `${n} states`);
    if (n) assert.equal(states.at(-1)!.state.url, `http://127.0.0.1:5199/p/${n - 1}`);
  }
});

test('bombadilTrace: the screenshots asked for, written into the folder', () => {
  const file = traceOf(6);
  const dir = join(tmp(), 'screenshots');
  const files = bombadilTrace(bin).screenshots(file, dir, [2, 4]);
  assert.deepEqual([...files.keys()], [2, 4]);
  for (const f of files.values()) assert.ok(f.startsWith(dir) && existsSync(f), f);
  // Asked again, the files already there come back too.
  assert.deepEqual(bombadilTrace(bin).screenshots(file, dir, [2, 4]), files);
  assert.equal(bombadilTrace(bin).screenshots(file, dir, []).size, 0);
});

test('bombadilTrace: a trace it cannot read is an error, not an empty run', () => {
  assert.throws(() => [...bombadilTrace(bin).states(join(tmp(), 'missing.bin'))], /bombadil trace .* failed/);
});
