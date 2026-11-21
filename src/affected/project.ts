import { relative } from 'node:path';
import { flowsPath, readFlows, specsDir, type ProjectConfig } from '../config.ts';
import { affectedFlows, importersOf, type Affected } from './index.ts';

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export interface ProjectAffectedOptions {
  /** The repo root: changed files and the coverage map are relative to it. */
  root: string;
  project: ProjectConfig;
  changed: readonly string[];
  /** This project's flows from coverage.json (`projects.<name>.flows`); undefined when there's no usable map. */
  coverage: Record<string, string[]> | undefined;
  /** For the reason given when `coverage` is missing. */
  coverageFile: string;
}

/**
 * One project's affected flows: its own import graph (`affected.entry`),
 * routers and coverage. Without an entry or a coverage map, every flow.
 */
export const projectAffected = async (o: ProjectAffectedOptions): Promise<Affected & { total: number }> => {
  const { root, project: p, coverage } = o;
  const allFlows = readFlows(root, p).map((f) => f.name);

  // The fuzzer itself, and what every page is built from.
  const rel = (abs: string) => relative(root, abs);
  const always = [
    `^${escape(rel(specsDir(root, p)))}/`,
    `^${escape(rel(flowsPath(root, p)))}$`,
    ...(p.routes ? [`^${escape(p.routes)}$`] : []),
    '^bombadil-kit\\.json$',
    '(^|/)(package-lock\\.json|yarn\\.lock|pnpm-lock\\.yaml|bun\\.lockb?)$',
    ...(p.affected?.always ?? []),
  ].map((s) => new RegExp(s));

  if (!coverage || !p.affected?.entry) {
    const why = !p.affected?.entry ? 'no affected.entry in bombadil-kit.json' : `no usable coverage map at ${o.coverageFile}`;
    return { flows: allFlows, reasons: Object.fromEntries(allFlows.map((f) => [f, [why]])), unreached: [], everything: true, total: allFlows.length };
  }

  const known = { ...Object.fromEntries(allFlows.map((f) => [f, [] as string[]])), ...coverage };
  const importers = await importersOf(root, p.affected.entry);
  const result = affectedFlows(o.changed, known, importers, { routers: p.affected.routers ?? [], always });
  // A flow added since the map was made has no coverage yet: run it.
  for (const flow of allFlows.filter((f) => !(f in coverage))) {
    if (!result.flows.includes(flow)) result.flows.push(flow);
    (result.reasons[flow] ??= []).push('new flow: not in the coverage map yet');
  }
  result.flows = result.flows.filter((f) => allFlows.includes(f)).sort();
  return { ...result, total: allFlows.length };
};
