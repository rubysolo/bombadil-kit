import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reachedMilestones, type MilestoneDef, type MilestonePredicate } from '../spec/milestones.ts';
import type { MockCall } from '../spec/api.ts';

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

// A page with a banner and a mock layer's call log.
const withCalls = () => {
  const ui = { banner: false };
  const doc = { ui } as unknown as Document;
  const win = { __mockCalls: [] as MockCall[] } as unknown as Window & { __mockCalls: MockCall[] };
  const call = (key: string, outcome: MockCall['outcome'] = 'ok') => win.__mockCalls.push({ key, outcome, at: 0 });
  const banner = (d: Document) => (d as unknown as { ui: typeof ui }).ui.banner;
  return { ui, doc, win, call, banner };
};

test('reachedMilestones after: a banner already up with no matching call is not reached', () => {
  const { ui, doc, win, call, banner } = withCalls();
  const defs: Record<string, MilestoneDef> = { saved: { holds: banner, after: 'AccountController.save' } };
  ui.banner = true;
  call('AccountController.load');
  assert.deepEqual(reachedMilestones(defs, doc, win), [], 'a leftover banner, and only a load since');
  assert.deepEqual(reachedMilestones(defs, doc, win), []);
});

test('reachedMilestones after: a matching ok call, then the banner, is reached once', () => {
  const { ui, doc, win, call, banner } = withCalls();
  const defs: Record<string, MilestoneDef> = { saved: { holds: banner, after: /^AccountController\.save/ } };
  assert.deepEqual(reachedMilestones(defs, doc, win), []);
  call('AccountController.saveProfile');
  assert.deepEqual(reachedMilestones(defs, doc, win), [], 'the call alone is not the milestone');
  ui.banner = true;
  assert.deepEqual(reachedMilestones(defs, doc, win), ['saved']);
  assert.deepEqual(reachedMilestones(defs, doc, win), [], 'still up: not again');
  ui.banner = false;
  assert.deepEqual(reachedMilestones(defs, doc, win), []);
  ui.banner = true;
  assert.deepEqual(reachedMilestones(defs, doc, win), [], 'back up, but no save since it went away');
  ui.banner = false;
  reachedMilestones(defs, doc, win);
  call('AccountController.saveProfile');
  ui.banner = true;
  assert.deepEqual(reachedMilestones(defs, doc, win), ['saved'], 'a fresh save, then the banner');
});

test('reachedMilestones after: an error call, then the banner, is not reached', () => {
  const { ui, doc, win, call, banner } = withCalls();
  const defs: Record<string, MilestoneDef> = { saved: { holds: banner, after: 'AccountController.save' } };
  call('AccountController.save', 'error');
  ui.banner = true;
  assert.deepEqual(reachedMilestones(defs, doc, win), [], 'the page says saved; the mock said no');
  call('AccountController.save', 'slow');
  assert.deepEqual(reachedMilestones(defs, doc, win), [], 'only ok counts');
  call('AccountController.save');
  assert.deepEqual(reachedMilestones(defs, doc, win), ['saved'], 'an ok save while the banner is up completes it');
});

test('reachedMilestones after: a string matches the whole key; no call log is no match', () => {
  const { ui, doc, win, call, banner } = withCalls();
  const defs: Record<string, MilestoneDef> = { saved: { holds: banner, after: 'AccountController.save' } };
  call('AccountController.saveDraft');
  ui.banner = true;
  assert.deepEqual(reachedMilestones(defs, doc, win), [], 'a prefix is not the key');
  assert.deepEqual(reachedMilestones(defs, doc, {} as Window), [], 'a page with no __mockCalls');
});
