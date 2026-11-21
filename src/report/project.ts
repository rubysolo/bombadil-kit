import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** spec/index.ts's property factories (kept here so the CLI needn't load the spec). */
export const PROPERTY_FACTORIES = [
  'errorBoundaryNeverShown',
  'spinnersClear',
  'noLeakedText',
  'noSidewaysScroll',
  'failedWritesShown',
  'consoleQuietUnlessFaulted',
  'nothingUnder',
  'appRenders',
  'noBlankPage',
];

/** What the report knows about a project beyond its runs. */
export interface ProjectInfo {
  /** Properties the spec checks, in its export order. */
  properties: string[];
  /** Route patterns the app has (the project's `routes`, else `routes.json` beside the spec), so unreached ones show. */
  routes: string[];
}

/**
 * The property names a Bombadil spec exports. Bombadil treats every exported
 * formula as a property; specs re-export them in `export { … }`
 * blocks, or define them as `export const x = always(…)` or with a bombadil-kit
 * factory (`export const x = spinnersClear(…)`).
 */
export const specProperties = (source: string): string[] => {
  const names: string[] = [];
  for (const block of source.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of block[1]!.split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop()?.trim();
      if (name && !name.startsWith('type ')) names.push(name);
    }
  }
  // Factories imported under another name: `import { appRenders as renders } from 'bombadil-kit/spec'`.
  const aliases: string[] = [];
  for (const block of source.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]bombadil-kit\/spec['"]/g)) {
    for (const part of block[1]!.split(',')) {
      const [name, alias] = part.trim().split(/\s+as\s+/);
      if (alias && (PROPERTY_FACTORIES as string[]).includes(name!.trim())) aliases.push(alias.trim());
    }
  }
  const builders = ['always', 'eventually', 'now', 'not', ...PROPERTY_FACTORIES, ...aliases].join('|');
  const built = new RegExp(`export\\s+const\\s+(\\w+)\\s*=\\s*(?:[\\w$]+\\.)?(?:${builders})\\s*\\(`, 'g');
  for (const m of source.matchAll(built)) names.push(m[1]!);
  return names;
};

/**
 * specProperties of a file, following `export * from './relative.ts'` into
 * the files it re-exports (where a spec usually gets its properties).
 */
export const specFileProperties = (file: string, seen = new Set<string>()): string[] => {
  if (seen.has(file) || !existsSync(file)) return [];
  seen.add(file);
  const source = readFileSync(file, 'utf8');
  const names = specProperties(source);
  for (const m of source.matchAll(/export\s*\*\s*from\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
    names.push(...specFileProperties(join(dirname(file), m[1]!), seen));
  }
  return [...new Set(names)];
};

/**
 * Reads a project's spec (path relative to `repoRoot`) and its routes: from
 * `routes` (the config's `projects.<name>.routes`, relative to `repoRoot`)
 * when given, else the routes.json beside the spec.
 */
export const projectInfo = (repoRoot: string, spec: string, routes?: string): ProjectInfo => {
  const specPath = join(repoRoot, spec);
  const routesPath = routes ? join(repoRoot, routes) : join(dirname(specPath), 'routes.json');
  if (routes && !existsSync(routesPath)) throw new Error(`no routes file at ${routes}`);
  return {
    properties: specFileProperties(specPath),
    routes: existsSync(routesPath) ? (JSON.parse(readFileSync(routesPath, 'utf8')) as string[]) : [],
  };
};
