// The pure half of milestones: no Bombadil imports, so node can test it.
// spec/index.ts calls it inside `extract`.

/** A milestone's test: true once the workflow got there (a success banner shows, the fields hold the new values). */
export type MilestonePredicate = (doc: Document, win: Window) => boolean;

export type MilestoneWindow = { __fuzzMilestones?: Record<string, boolean> };

/**
 * The milestones whose predicate turned true since the last call on this
 * window: edge-triggered, so a banner that stays up counts once, and counts
 * again only after it went away and came back. The last values live on `win`,
 * so a new document starts over. A predicate that throws is false.
 */
export const reachedMilestones = (defs: Record<string, MilestonePredicate>, doc: Document, win: Window): string[] => {
  const was = ((win as Window & MilestoneWindow).__fuzzMilestones ??= {});
  const reached: string[] = [];
  for (const [name, holds] of Object.entries(defs)) {
    let now = false;
    try {
      now = holds(doc, win) === true;
    } catch {
      now = false;
    }
    if (now && !was[name]) reached.push(name);
    was[name] = now;
  }
  return reached;
};
