import { realpathSync } from 'node:fs';
import { relative } from 'node:path';

/**
 * Which fuzz flows a change touches.
 *
 * coverage.json says, per flow, which source files it rendered. A changed file
 * a flow rendered picks that flow. A changed file that renders nothing (a
 * hook, a slice, a util, a stylesheet) climbs the import graph to the nearest
 * files some flow rendered and picks theirs. The climb stops at the router:
 * App.tsx imports every page but renders one, so reaching it says nothing
 * about which flow runs the file; a file only it leads to is `unreached`,
 * code no flow gets to (add one).
 */

export interface AffectedOptions {
  /** Files that import every page and render one (the route table). */
  routers: string[];
  /** Changes that rerun every flow: the fuzzer itself, its specs and flows. */
  always: RegExp[];
}

export interface Affected {
  flows: string[];
  /** Per flow, the changed files that picked it (`changed → rendered via`). */
  reasons: Record<string, string[]>;
  /** Changed app files no flow renders or reaches. */
  unreached: string[];
  /** True when a change to the fuzzer itself picked every flow. */
  everything: boolean;
}

export const affectedFlows = (
  changed: readonly string[],
  coverage: Record<string, readonly string[]>,
  importers: Record<string, readonly string[]>,
  opts: AffectedOptions,
): Affected => {
  const flowsRendering = (file: string) => Object.keys(coverage).filter((flow) => coverage[flow]!.includes(file));
  const inApp = (file: string) => file in importers || flowsRendering(file).length > 0;
  const reasons: Record<string, string[]> = {};
  const add = (flow: string, why: string) => (reasons[flow] ??= []).push(why);
  const unreached: string[] = [];
  let everything = false;

  for (const file of changed) {
    if (opts.always.some((re) => re.test(file))) {
      everything = true;
      for (const flow of Object.keys(coverage)) add(flow, file);
      continue;
    }
    if (!inApp(file)) continue;

    let found = false;
    const seen = new Set<string>();
    const queue = [file];
    while (queue.length) {
      const node = queue.shift()!;
      if (seen.has(node)) continue;
      seen.add(node);
      if (node !== file && opts.routers.includes(node)) continue;
      const flows = flowsRendering(node);
      if (flows.length) {
        found = true;
        for (const flow of flows) add(flow, node === file ? file : `${file} → ${node}`);
        continue;
      }
      queue.push(...(importers[node] ?? []));
    }
    if (!found) unreached.push(file);
  }

  return { flows: Object.keys(reasons).sort(), reasons, unreached, everything };
};

/**
 * file → the files that import it, repo-relative, from esbuild's resolution of
 * `entry`. Code is followed; anything else (images, CSS, `?react`, `?raw`) is a
 * leaf that still records who imports it. node_modules is left out.
 */
export const importersOf = async (repoRoot: string, entry: string): Promise<Record<string, string[]>> => {
  const { build } = await import('esbuild');
  // esbuild hands back real paths; a symlinked root (macOS /var) must match them.
  const root = realpathSync(repoRoot);
  const edges = new Map<string, Set<string>>();
  const FOLLOWING = Symbol('following');
  const rel = (p: string) => relative(root, p);

  await build({
    absWorkingDir: root,
    entryPoints: [entry],
    bundle: true,
    write: false,
    logLevel: 'silent',
    jsx: 'automatic',
    format: 'esm',
    platform: 'browser',
    plugins: [
      {
        name: 'record-imports',
        setup(b) {
          b.onResolve({ filter: /.*/ }, async (args) => {
            if (args.pluginData === FOLLOWING || args.kind === 'entry-point') return undefined;
            const [bare, query] = args.path.split('?');
            const res = await b.resolve(bare!, {
              resolveDir: args.resolveDir,
              kind: args.kind,
              importer: args.importer,
              pluginData: FOLLOWING,
            });
            if (res.errors.length || !res.path) return { path: args.path, external: true };
            const vendored = res.path.includes('/node_modules/');
            if (!vendored && args.importer) {
              const set = edges.get(rel(res.path)) ?? new Set<string>();
              set.add(rel(args.importer));
              edges.set(rel(res.path), set);
            }
            const code = /\.(m?[jt]sx?)$/.test(res.path) && query === undefined;
            return code && !vendored ? { path: res.path } : { path: res.path, external: true };
          });
        },
      },
    ],
  });

  return Object.fromEntries([...edges].map(([file, from]) => [file, [...from].sort()]));
};
