import { appendFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Processes } from '../src/runner/processes.ts';
import { fakeTrace, row, writeTrace } from './helpers.ts';

export interface FakeOptions {
  /** Something answers the port before the sweep starts a server. */
  busy?: boolean;
  /**
   * What a started server does: `up` answers; `never` never answers; `exits`
   * dies at once; `taken`, another server answers on the port and ours exits
   * 300ms later (--strictPort losing the race).
   */
  server?: 'up' | 'never' | 'exits' | 'taken';
  /** Bombadil's exit code per flow, in order; the last one repeats. */
  rc?: number[];
  /** Bombadil fails to run at all (it throws). */
  bombadilThrows?: boolean;
}

/**
 * A fake process adapter: a server and a Bombadil that follow a fake clock
 * (each sleep advances it) and leave what the real ones would on disk: the
 * server's log lines, a run's trace (as `fakeTrace` reads it).
 */
export const fakeProcesses = (f: FakeOptions = {}) => {
  const calls = {
    started: [] as { command: string; args: string[]; env: NodeJS.ProcessEnv }[],
    stops: 0,
    bombadil: [] as string[][],
    trapped: 0,
    untrapped: 0,
  };
  let now = 0;
  let server: { exitsAt: number; stopped: boolean; log: string } | undefined;
  const exited = () => !!server && (server.stopped || now >= server.exitsAt);
  const procs: Processes = {
    answers: async () => {
      if (!server) return !!f.busy;
      const mode = f.server ?? 'up';
      return mode === 'taken' || (mode === 'up' && !exited());
    },
    startServer: ({ command, args, env, log }) => {
      calls.started.push({ command, args, env });
      appendFileSync(log, 'server: listening\n');
      const mode = f.server ?? 'up';
      server = { exitsAt: mode === 'exits' ? now : mode === 'taken' ? now + 300 : Infinity, stopped: false, log };
      return {
        exited,
        stop: () => {
          if (exited()) return;
          server!.stopped = true;
          calls.stops += 1;
        },
      };
    },
    bombadil: async ({ args }) => {
      calls.bombadil.push(args);
      if (f.bombadilThrows) throw new Error('spawn bombadil ENOENT');
      const out = args[args.indexOf('--output-path') + 1]!;
      writeTrace(out, [row(0, '/login', null)]);
      if (server) appendFileSync(server.log, `server: GET for ${dirname(out)}\n`);
      const rc = f.rc ?? [0];
      return rc[Math.min(calls.bombadil.length - 1, rc.length - 1)]!;
    },
    bombadilVersion: () => '0.8.0',
    trace: () => fakeTrace,
    git: (_root, args) => (args[0] === 'rev-parse' ? 'abc1234' : ''),
    sleep: async (ms) => void (now += ms),
    onInterrupt: () => {
      calls.trapped += 1;
      return () => void (calls.untrapped += 1);
    },
  };
  return { procs, calls, serverExited: exited };
};
