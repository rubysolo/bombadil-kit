import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reachedMilestones, type MilestonePredicate } from '../spec/milestones.ts';

// A page whose "banner" and "fields" the test flips between states.
const page = () => {
  const ui = { banner: false, saved: false };
  const doc = { ui } as unknown as Document;
  const defs: Record<string, MilestonePredicate> = {
    saved: (d) => (d as unknown as { ui: typeof ui }).ui.banner,
    persisted: (d) => (d as unknown as { ui: typeof ui }).ui.saved,
  };
  return { ui, doc, defs };
};

test('reachedMilestones: a milestone counts when its predicate turns true, once while it stays true', () => {
  const { ui, doc, defs } = page();
  const win = {} as Window;
  assert.deepEqual(reachedMilestones(defs, doc, win), []);
  ui.banner = true;
  assert.deepEqual(reachedMilestones(defs, doc, win), ['saved']);
  ui.saved = true;
  assert.deepEqual(reachedMilestones(defs, doc, win), ['persisted'], 'the banner still up is not reached again');
  assert.deepEqual(reachedMilestones(defs, doc, win), []);
  ui.banner = false;
  assert.deepEqual(reachedMilestones(defs, doc, win), []);
  ui.banner = true;
  assert.deepEqual(reachedMilestones(defs, doc, win), ['saved'], 'gone and back is a second time');
});

test('reachedMilestones: a new document starts over; a predicate that throws is false', () => {
  const { ui, doc, defs } = page();
  ui.banner = true;
  const first = {} as Window;
  assert.deepEqual(reachedMilestones(defs, doc, first), ['saved']);
  assert.deepEqual(reachedMilestones(defs, doc, first), []);
  // A reload: a fresh window, the banner up on its first state.
  assert.deepEqual(reachedMilestones(defs, doc, {} as Window), ['saved']);

  const win = {} as Window;
  const flaky: Record<string, MilestonePredicate> = { boom: () => { throw new Error('no such element'); }, truthy: () => 1 as unknown as boolean };
  assert.deepEqual(reachedMilestones(flaky, doc, win), [], 'throws is false, and only `true` counts');
});
