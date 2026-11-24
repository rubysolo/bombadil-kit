import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildRun, writeRunRecord } from '../src/report/record.ts';
import { TRACE_FILE, type TraceReader, type TraceRow } from '../src/trace.ts';

// Bombadil timestamps are microseconds since the epoch.
export const T0 = Date.UTC(2026, 10, 19, 19, 26, 0) * 1000;

export type Row = {
  timestamp: number;
  action: unknown;
  state: { url: string; screenshot?: string | null };
  snapshots: unknown[];
  violations: unknown[];
};

/** A state whose `rendered` extractor reported these files as new. */
export const rendering = (r: Row, fresh: string[]): Row => ({
  ...r,
  snapshots: [...r.snapshots, { index: 99, name: 'rendered', value: { fresh, total: fresh.length }, time: 0 }],
});

/** A state whose `api` extractor saw these calls (and, if given, the inventory). */
export const calling = (r: Row, calls: { key: string; variant?: string; outcome: string }[], inventory?: { key: string; variants: string[] }[]): Row => ({
  ...r,
  snapshots: [...r.snapshots, { index: 98, name: 'api', value: inventory ? { calls, inventory } : { calls }, time: 0 }],
});

/** A state whose `milestones` extractor reported these as reached. */
export const reaching = (r: Row, names: string[]): Row => ({
  ...r,
  snapshots: [...r.snapshots, { index: 97, name: 'milestones', value: names, time: 0 }],
});

export const row = (i: number, url: string, action: unknown, violations: unknown[] = []): Row => ({
  timestamp: T0 + i * 1_000_000,
  action,
  state: { url: `http://127.0.0.1:5199${url}`, screenshot: 'jpeg' },
  snapshots: [],
  violations,
});

/** A violation the way Bombadil writes one: `Always` around a failing thunk. */
export const always = (name: string, snapshots: { name: string; value: unknown }[]) => ({
  name,
  violation: {
    Always: {
      violation: {
        False: {
          time: 0,
          condition: `() => ${name}`,
          snapshots: snapshots.map((s, index) => ({ index, ...s, time: 0 })),
        },
      },
    },
  },
});

/** `always(now(p) ⇒ eventually(q).within(…))` timing out. */
export const timedOut = (name: string, antecedent: { name: string; value: unknown }[]) => ({
  name,
  violation: {
    Always: {
      violation: {
        Implies: {
          left: { Thunk: { function: '() => p' } },
          right: { Eventually: { reason: { TimedOut: 0 } } },
          antecedent_snapshots: antecedent.map((s, index) => ({ index, ...s, time: 0 })),
        },
      },
    },
  },
});

export interface RunSpec {
  project?: string;
  flow?: string;
  id: string;
  seed?: number;
  rows: Row[];
  spec?: string;
  startedAt?: string;
  /** run.json's expected_milestones. */
  expected?: string[];
}

/** A trace file the way `fakeTrace` reads it: one row per line, JSON, in place of Bombadil's binary. */
export const writeTrace = (file: string, rows: Row[]) => writeFileSync(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');

/**
 * Reads what `writeTrace` wrote, as `bombadilTrace` reads a real trace: a
 * state's index is its line. A screenshot is written as `<index>.jpeg`.
 */
export const fakeTrace: TraceReader = {
  states: (file) =>
    readFileSync(file, 'utf8')
      .split('\n')
      .filter((l) => l.trim() !== '')
      .map((l, index) => ({ index, ...(JSON.parse(l) as Omit<TraceRow, 'index'>) })),
  screenshots: (file, dir, indices) => {
    const states = fakeTrace.states(file) as TraceRow[];
    mkdirSync(dir, { recursive: true });
    const files = new Map<number, string>();
    for (const i of indices) {
      if (!states[i]?.state.screenshot) continue;
      files.set(i, join(dir, `${i}.jpeg`));
      writeFileSync(files.get(i)!, 'jpeg');
    }
    return files;
  },
};

/** Writes a run directory (run.json as the runner builds it, its trace for `fakeTrace`) and returns its path. */
export const writeRun = (root: string, run: RunSpec): string => {
  const project = run.project ?? 'web';
  const dir = join(root, project, run.id);
  mkdirSync(dir, { recursive: true });
  writeTrace(join(dir, TRACE_FILE), run.rows);
  writeRunRecord(
    dir,
    buildRun(
      {
        project, named: false, kind: 'mock', seed: run.seed ?? 1, faults: 0.1, latency: 50, refDate: '2026-11-19',
        time: '1m', width: 390, height: 844, commit: 'abc1234', bombadil: '0.8.0',
      },
      {
        flow: run.flow ?? 'explore', milestones: run.expected, spec: run.spec ?? 'apps/web/bombadil/spec.ts',
        dir: `tmp/bombadil/runs/${project}/${run.id}`, start: '/login', startedAt: run.startedAt ?? '2026-11-19T19:26:00Z', exitCode: 2,
      },
    ),
  );
  return dir;
};

export const tmp = (): string => mkdtempSync(join(tmpdir(), 'fuzz-report-'));
