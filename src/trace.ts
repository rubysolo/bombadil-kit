import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

/** A run directory's trace: Bombadil's compressed binary, screenshots inside (0.8 on). */
export const TRACE_FILE = 'trace.bin';

/** One state of a trace, as `bombadil trace --json` prints its metadata. */
export interface TraceRow {
  index: number;
  /** Microseconds since the epoch. */
  timestamp: number;
  action: unknown;
  /** `screenshot` is the image's format ("jpeg"), or null when the state has none. */
  state: { url: string; screenshot?: string | null };
  snapshots?: { name: string | null; value: unknown }[];
  violations: { name: string; violation: unknown }[];
}

/**
 * The seam between the kit and a trace file. `bombadilTrace` reads one with
 * `bombadil trace`; tests hand the report a fake.
 */
export interface TraceReader {
  /** Every state, in order. */
  states(file: string): Iterable<TraceRow>;
  /** Writes these states' screenshots into `dir`: index → file, for those that have one. */
  screenshots(file: string, dir: string, indices: readonly number[]): Map<number, string>;
}

/** The project's Bombadil, else the one on PATH. */
export const bombadilBin = (root: string): string => {
  const local = join(root, 'node_modules/.bin/bombadil');
  return existsSync(local) ? local : 'bombadil';
};

/** `bombadil trace --json` lines, parsed; [] past the trace's last state. */
const traceJson = (bin: string, args: string[]): { index: number; metadata: Omit<TraceRow, 'index'>; screenshot_file?: string | null }[] => {
  let out: string;
  try {
    out = execFileSync(bin, ['trace', '--json', ...args], { encoding: 'utf8', maxBuffer: 1 << 30, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    const stderr = String((e as { stderr?: unknown }).stderr ?? '');
    if (/no state \d+ in a trace of \d+ states/.test(stderr)) return [];
    throw new Error(`bombadil trace ${args.join(' ')} failed: ${stderr.trim() || (e as Error).message}`);
  }
  return out.split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l));
};

/**
 * Reads traces with Bombadil at `bin`, `chunk` states per `bombadil trace`
 * call: a long run decodes to hundreds of MB of JSON, more than one string
 * should hold.
 */
export const bombadilTrace = (bin: string, chunk = 1000): TraceReader => ({
  *states(file) {
    for (let lo = 0; ; lo += chunk) {
      const lines = traceJson(bin, ['--state', `${lo}..${lo + chunk}`, file]);
      for (const l of lines) yield { index: l.index, ...l.metadata };
      if (lines.length < chunk) return;
    }
  },

  screenshots(file, dir, indices) {
    const files = new Map<number, string>();
    if (indices.length === 0) return files;
    mkdirSync(dir, { recursive: true });
    // One call for the span; Bombadil leaves a file already there as it is.
    const lo = Math.min(...indices);
    const hi = Math.max(...indices) + 1;
    const want = new Set(indices);
    for (const l of traceJson(bin, ['--state', `${lo}..${hi}`, '--screenshots', dir, file])) {
      if (want.has(l.index) && l.screenshot_file) files.set(l.index, l.screenshot_file);
    }
    return files;
  },
});
