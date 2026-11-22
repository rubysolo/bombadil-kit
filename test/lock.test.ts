import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withLock, writeAtomic } from '../src/report/lock.ts';
import { tmp } from './helpers.ts';

test('writeAtomic replaces the file whole and leaves no temp file', () => {
  const dir = tmp();
  const file = join(dir, 'state.json');
  writeFileSync(file, 'old');
  writeAtomic(file, 'new');
  assert.equal(readFileSync(file, 'utf8'), 'new');
  assert.deepEqual(readdirSync(dir), ['state.json']);
});

test('withLock runs the function, returns its value and removes the lock', () => {
  const dir = tmp();
  const lock = join(dir, 'state.json.lock');
  assert.equal(withLock(lock, () => (assert.ok(existsSync(lock)), 42)), 42);
  assert.ok(!existsSync(lock));
});

test('withLock removes the lock when the function throws', () => {
  const lock = join(tmp(), 'state.json.lock');
  assert.throws(() => withLock(lock, () => { throw new Error('boom'); }), /boom/);
  assert.ok(!existsSync(lock));
});

test("withLock takes over a lock whose process is gone", () => {
  const lock = join(tmp(), 'state.json.lock');
  // A pid that can't be alive: above any pid_max.
  writeFileSync(lock, JSON.stringify({ pid: 2 ** 30, at: new Date().toISOString() }));
  assert.equal(withLock(lock, () => 'ran'), 'ran');
});

test('withLock takes over a lock older than staleMs', () => {
  const lock = join(tmp(), 'state.json.lock');
  writeFileSync(lock, JSON.stringify({ pid: process.pid, at: '2020-01-01T00:00:00Z' }));
  assert.equal(withLock(lock, () => 'ran', { staleMs: 1000 }), 'ran');
});

test('withLock waits for a live holder, then gives up naming the lock', () => {
  const lock = join(tmp(), 'state.json.lock');
  writeFileSync(lock, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
  assert.throws(() => withLock(lock, () => 'never', { timeoutMs: 300 }), (e: Error) => e.message.includes(lock));
  assert.ok(existsSync(lock), "someone else's lock stays");
});

// The race it exists for: several `run --project x` finishing at once, each
// adding its run and rebuilding the report. A sweep a build reported must not
// be overwritten by another's, and every run must end up in state.json.
test('concurrent report builds lose no sweeps and no runs', async () => {
  const root = tmp();
  const runs = join(root, 'runs');
  const out = join(root, 'report');
  mkdirSync(join(root, 'app/bombadil'), { recursive: true });
  writeFileSync(join(root, 'app/bombadil/spec.ts'), "export { noLeakedValues } from './properties.ts';\n");
  writeFileSync(join(root, 'app/bombadil/routes.json'), JSON.stringify(['/login']));

  const helpers = fileURLToPath(new URL('./helpers.ts', import.meta.url));
  const generate = fileURLToPath(new URL('../src/report/generate.ts', import.meta.url));
  const child = (i: number) => `
    import { writeRun, row } from ${JSON.stringify(helpers)};
    import { generate } from ${JSON.stringify(generate)};
    for (let n = 0; n < 5; n++) {
      writeRun(${JSON.stringify(runs)}, { id: 'c${i}-' + n, project: 'p${i}', spec: 'app/bombadil/spec.ts', rows: [row(0, '/login', null)] });
      const now = 'c${i}-' + n;
      const { report } = generate({ runsRoot: ${JSON.stringify(runs)}, out: ${JSON.stringify(out)}, repoRoot: ${JSON.stringify(root)}, now });
      // The sweep this build made, if it found runs no other build had folded.
      if (report.sweep.at === now) console.log(report.sweep.id + ' ' + now);
    }`;
  const N = 6;
  const results = await Promise.all(
    Array.from({ length: N }, (_, i) =>
      new Promise<{ code: number; made: string }>((resolve) => {
        const p = spawn(process.execPath, ['--input-type=module', '-e', child(i)], { stdio: ['ignore', 'pipe', 'inherit'] });
        let made = '';
        p.stdout.on('data', (d) => (made += d));
        p.on('exit', (code) => resolve({ code: code ?? 1, made }));
      }),
    ),
  );
  assert.deepEqual(results.map((r) => r.code), Array(N).fill(0));

  const state = JSON.parse(readFileSync(join(out, 'state.json'), 'utf8'));
  const made = results.flatMap((r) => r.made.trim().split('\n').filter(Boolean));
  for (const line of made) {
    const [id, at] = line.split(' ');
    assert.equal(state.sweeps[Number(id) - 1]?.at, at, `sweep ${id} (${at}) was overwritten`);
  }
  assert.equal(Object.keys(state.runs).length, N * 5);
  assert.deepEqual(state.sweeps.map((s: { id: number }) => s.id), state.sweeps.map((_: unknown, i: number) => i + 1));
  assert.ok(!existsSync(join(out, 'state.json.lock')));
});
