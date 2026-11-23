import { execFileSync, spawn } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';
import { createInterface } from 'node:readline';

/** A dev server the sweep started. */
export interface Server {
  /** Whether it has exited, by itself or by `stop`. */
  exited(): boolean;
  /** Stops it and its children; nothing if it is gone already. */
  stop(): void;
}

/**
 * The seam between a sweep and the processes and network it drives: the app's
 * server, Bombadil, git. `realProcesses` is the adapter a sweep runs with;
 * tests hand it a fake one.
 */
export interface Processes {
  /** Whether anything answers `url`. */
  answers(url: string): Promise<boolean>;
  /** Starts the app's server, its stdout and stderr appended to `log`. */
  startServer(o: { command: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv; log: string }): Server;
  /** Runs Bombadil to its end: its exit code. Each stderr line goes to `line`. */
  bombadil(o: { bin: string; args: string[]; cwd: string; line: (l: string) => void }): Promise<number>;
  /** Bombadil's version, as `bombadil --version` prints it. */
  bombadilVersion(bin: string): string;
  /** `git -C root …`'s output, trimmed; '' when git fails. */
  git(root: string, args: string[]): string;
  sleep(ms: number): Promise<void>;
  /** Calls `stop` on SIGINT or SIGTERM, then exits 130. Returns what undoes it. */
  onInterrupt(stop: () => void): () => void;
}

export const realProcesses: Processes = {
  answers: async (url) => {
    try {
      await fetch(url, { signal: AbortSignal.timeout(2000) });
      return true;
    } catch {
      return false;
    }
  },

  startServer: ({ command, args, cwd, env, log }) => {
    const fd = openSync(log, 'a');
    // Its own process group, so stopping it stops its children and nothing else.
    const child = spawn(command, args, { cwd, env, stdio: ['ignore', fd, fd], detached: true });
    closeSync(fd);
    let exited = false;
    child.on('exit', () => (exited = true));
    // A command that can't be spawned reports here, not by throwing: it exited.
    child.on('error', () => (exited = true));
    return {
      exited: () => exited,
      stop: () => {
        if (exited || !child.pid) return;
        try {
          process.kill(-child.pid, 'SIGTERM');
        } catch {
          /* already gone */
        }
      },
    };
  },

  bombadil: ({ bin, args, cwd, line }) =>
    new Promise((resolve, reject) => {
      const child = spawn(bin, args, { cwd, stdio: ['ignore', 'inherit', 'pipe'] });
      createInterface({ input: child.stderr! }).on('line', line);
      child.on('error', reject);
      child.on('close', (code) => resolve(code ?? 1));
    }),

  bombadilVersion: (bin) => execFileSync(bin, ['--version'], { encoding: 'utf8' }).trim().split(/\s+/).pop() ?? '',

  git: (root, args) => {
    try {
      return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch {
      return '';
    }
  },

  sleep: (ms) => new Promise<void>((r) => setTimeout(r, ms)),

  onInterrupt: (stop) => {
    const handler = () => {
      stop();
      process.exit(130);
    };
    process.on('SIGINT', handler).on('SIGTERM', handler);
    return () => void process.off('SIGINT', handler).off('SIGTERM', handler);
  },
};
