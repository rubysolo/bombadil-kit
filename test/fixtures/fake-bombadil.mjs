#!/usr/bin/env node
// `bombadil trace --json [--state A..B] [--screenshots DIR] FILE`, the way
// Bombadil 0.8 answers it, over a trace written by test/helpers.ts writeTrace
// (one JSON row per line) instead of the binary format. Enough for the kit's
// bombadilTrace (src/trace.ts) to run against.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
if (args[0] !== 'trace' || !args.includes('--json')) {
  console.error(`fake bombadil: only \`trace --json\`, not ${args.join(' ')}`);
  process.exit(1);
}
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const file = args.at(-1);
const rows = readFileSync(file, 'utf8').split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l));
const [lo, hi] = (opt('--state') ?? '0..').split('..').map((n, i) => (n === '' ? [0, rows.length][i] : Number(n)));
if (lo >= rows.length) {
  console.error(`Error: no state ${lo} in a trace of ${rows.length} states`);
  process.exit(1);
}
const dir = opt('--screenshots');
if (dir) mkdirSync(dir, { recursive: true });
for (let i = lo; i < Math.min(hi, rows.length); i++) {
  const line = { index: i, metadata: rows[i], payload_bytes: 0 };
  if (dir) {
    const shot = rows[i].state.screenshot ? join(dir, `${i}.jpeg`) : null;
    if (shot) writeFileSync(shot, 'jpeg');
    line.screenshot_file = shot;
  }
  console.log(JSON.stringify(line));
}
