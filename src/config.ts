import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/**
 * bombadil-kit.json, at the repo root. Paths are relative to the file.
 *
 * {
 *   "title": "acme",
 *   "projects": {
 *     "web": {
 *       "dir": "apps/web",
 *       "server": {
 *         "command": ["npx", "vite", "--host", "127.0.0.1", "--port", "{port}", "--strictPort"],
 *         "env": { "VITE_API_MOCK": "true", "VITE_MOCK_FAULT_RATE": "{faults}", "VITE_MOCK_SEED": "{seed}" },
 *         "port": 5199
 *       }
 *     }
 *   }
 * }
 */
export interface KitConfig {
  /** The report's heading. */
  title?: string;
  /** Runs land in `<out>/runs/<project>/`, the report in `<out>/report/`. */
  out?: string;
  projects: Record<string, ProjectConfig>;
}

export interface ProjectConfig {
  /** The app's directory. The server runs here. */
  dir: string;
  /**
   * What the app talks to. `mock` (the default): its mock API, with seeded
   * data and injected faults. `live`: a real backend; no faults (the runner
   * refuses them), and run.json records no seed or mock date to replay.
   */
  target?: 'mock' | 'live';
  server: {
    /**
     * argv for the dev server. `{port}`, `{seed}`, `{faults}`, `{latency}` and
     * `{refDate}` are filled in, here and in `env`.
     */
    command: string[];
    env?: Record<string, string>;
    port?: number;
    /** Path that answers once the server is up. Default `/`. */
    ready?: string;
    /** Something already on the port is used instead of refused, and left
     * running afterwards. The same as `--reuse-server`; its `command` and `env`
     * never run, so the placeholders reach the page by URL and cookie instead. */
    reuse?: boolean;
  };
  /** Default `<dir>/bombadil/flows.json`. Without one, a single `explore` flow from `/`. */
  flows?: string;
  /** Where `<spec>.ts` files live. Default `<dir>/bombadil`. */
  specs?: string;
  /** The spec a flow without `spec` runs. Default `spec`. */
  spec?: string;
  /** The cookie a `signedIn` flow starts with, `NAME=VALUE`. */
  signedInCookie?: string;
  viewport?: { width: number; height: number };
  defaults?: { time?: string; faults?: number; latency?: number };
  /** Paths whose uncommitted changes mark a run's commit `-dirty`. Default `[dir]`. */
  watch?: string[];
  /** Bombadil stderr lines to drop (regex sources), e.g. noisy instrumentation warnings. */
  quiet?: string[];
  /** For `bombadil-kit affected`. */
  affected?: {
    /** The app's entry module, where the import graph starts. */
    entry: string;
    /** Modules that import every page but render one (the route table). */
    routers?: string[];
    /** Changes that rerun every flow (regex sources). The fuzzer's own files always do. */
    always?: string[];
  };
}

export interface Flow {
  name: string;
  about?: string;
  /** Path the run starts at. */
  start: string;
  /** Paths it may wander into: exact, or a prefix ending in `*`. */
  allow: string[];
  /** Start with the project's signedInCookie. */
  signedIn?: boolean;
  /** Spec name (without .ts) in the specs folder; default the project's `spec`. */
  spec?: string;
  /**
   * Milestones (the spec's `milestones({...})` names) this flow is meant to
   * reach. The report flags one a sweep never reached; it isn't a finding.
   */
  milestones?: string[];
}

export const CONFIG_FILE = 'bombadil-kit.json';

/** Walks up from `from` to the nearest bombadil-kit.json. */
export const findConfig = (from = process.cwd()): string => {
  for (let dir = resolve(from); ; dir = dirname(dir)) {
    const file = join(dir, CONFIG_FILE);
    if (existsSync(file)) return file;
    if (dirname(dir) === dir) throw new Error(`no ${CONFIG_FILE} here or above ${from}`);
  }
};

export interface Loaded {
  root: string;
  config: KitConfig;
  out: string;
}

export const loadConfig = (file = findConfig()): Loaded => {
  const config = JSON.parse(readFileSync(file, 'utf8')) as KitConfig;
  if (!config.projects || Object.keys(config.projects).length === 0) throw new Error(`${file}: no projects`);
  const root = dirname(resolve(file));
  return { root, config, out: join(root, config.out ?? 'tmp/bombadil') };
};

/** The project named, or the only one. */
export const pickProject = ({ config }: Loaded, name?: string): [string, ProjectConfig] => {
  const names = Object.keys(config.projects);
  if (name) {
    const project = config.projects[name];
    if (!project) throw new Error(`no project ${name} (have ${names.join(', ')})`);
    return [name, project];
  }
  if (names.length > 1) throw new Error(`several projects (${names.join(', ')}); pass --project`);
  return [names[0]!, config.projects[names[0]!]!];
};

export const flowsPath = (root: string, p: ProjectConfig) => join(root, p.flows ?? join(p.dir, 'bombadil/flows.json'));
export const specsDir = (root: string, p: ProjectConfig) => join(root, p.specs ?? join(p.dir, 'bombadil'));

export const readFlows = (root: string, p: ProjectConfig): Flow[] => {
  const file = flowsPath(root, p);
  if (!existsSync(file)) return [{ name: 'explore', about: 'everything, from /', start: '/', allow: ['/*'] }];
  return JSON.parse(readFileSync(file, 'utf8')) as Flow[];
};

/** Fills `{name}` placeholders. */
export const fill = (text: string, values: Record<string, string | number>) =>
  text.replace(/\{(\w+)\}/g, (all, key: string) => (key in values ? String(values[key]) : all));
