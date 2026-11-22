import { closeSync, linkSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync, writeSync } from 'node:fs';

/** Writes `data` beside `path`, then renames it over: readers see the old file or the new one, never half of either. */
export const writeAtomic = (path: string, data: string) => {
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, data);
  renameSync(temp, path);
};

const sleep = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM: it exists, it just isn't ours.
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
};

const read = (path: string) => {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
};

/** A lock nobody holds any more: its process is gone, or it's older than `staleMs`. */
const isStale = (lock: string, body: string, staleMs: number) => {
  try {
    const { pid, at } = JSON.parse(body) as { pid: number; at: string };
    return !alive(pid) || Date.now() - Date.parse(at) > staleMs;
  } catch {
    // Half written: its holder is between create and write. Stale only if it stays that way.
    try {
      return Date.now() - statSync(lock).mtimeMs > 5000;
    } catch {
      return false;
    }
  }
};

/**
 * Removes the stale lock whose contents were `body`, and nothing else: moved
 * aside first, so if a fresh lock replaced it meanwhile, that one goes back.
 */
const takeOver = (lock: string, body: string) => {
  const aside = `${lock}.${process.pid}.stale`;
  try {
    renameSync(lock, aside);
  } catch {
    return; // someone else took it over first
  }
  if (read(aside) !== body) {
    try {
      linkSync(aside, lock);
    } catch {
      /* a newer lock is there already */
    }
  }
  unlinkSync(aside);
};

/**
 * Runs `fn` holding `lock`, a file created exclusively: concurrent report
 * builds (several `run --project x` at once) take turns instead of each
 * writing over the other's state.json. Waits up to `timeoutMs` for a live
 * holder; takes over a stale one. Same machine only: a lock on a network
 * file system, or held from another host, looks stale once `staleMs` passes.
 */
export const withLock = <T>(lock: string, fn: () => T, { timeoutMs = 120_000, staleMs = 10 * 60_000 } = {}): T => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    let fd: number;
    try {
      fd = openSync(lock, 'wx');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      const body = read(lock);
      if (body === undefined) continue; // released between the create and the read
      if (isStale(lock, body, staleMs)) {
        takeOver(lock, body);
        continue;
      }
      if (Date.now() > deadline) throw new Error(`another report build holds ${lock}; delete it if none is running`);
      sleep(50 + Math.random() * 50);
      continue;
    }
    try {
      writeSync(fd, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
    } finally {
      closeSync(fd);
    }
    try {
      return fn();
    } finally {
      unlinkSync(lock);
    }
  }
};
