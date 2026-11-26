import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderHtml } from '../src/report/html.ts';
import type { Report } from '../src/report/report.ts';
import { rendered } from './helpers.ts';

const report = {
  schema: 'bombadil-report/v1',
  generated_at: 't',
  sweep: { id: 1, at: 't', commits: ['c'] },
  summary: { new: 0, open: 0, quiet: 0, closed: 0, actions: 0, routes: [0, 0] },
  projects: [],
  findings: [],
} as Report;

// The page opens from file:// and as a CI artifact, with no network: a font it
// names but doesn't carry falls back to whatever the viewer has installed.
test('the page carries its own fonts', () => {
  const html = renderHtml(report);
  for (const [family, weight] of [['Rajdhani', 600], ['Rajdhani', 700], ['JetBrains Mono', 400], ['JetBrains Mono', 700]] as const) {
    const face = new RegExp(`@font-face\\{font-family:"${family}";font-style:normal;font-weight:${weight};font-display:block;src:url\\(data:font/woff2;base64,[A-Za-z0-9+/=]{1000,}\\)`);
    assert.match(html, face, `${family} ${weight}`);
  }
  assert.ok(!/https?:\/\/fonts\./.test(html), 'no font requests');
});

test('rotated matrix headers are centred in their column', () => {
  const html = renderHtml(report);
  assert.match(html, /th\.v\{[^}]*text-align:center/);
  assert.match(html, /<th class="v"><span>/);
});

const project = (api?: Report['projects'][number]['api']) =>
  ({
    ...report,
    projects: [
      {
        name: 'web', spec: 's.ts', target: {}, last_sweep: 1, actions: 10, properties: [], runs: [], history: [],
        routes: [{ template: '/orders', states: 3, known: true }],
        ...(api ? { api } : {}),
      },
    ],
  }) as Report;

test('the coverage tab shows API coverage: calls by outcome, variants seen/known, unreached endpoints dimmed', () => {
  const page = rendered(
    project({
      endpoints: [
        { key: 'OrderController.getOrder', flows: ['order'], outcomes: { hang: 1, ok: 2 }, variantsSeen: ['locked'], variantsKnown: ['default', 'locked'], known: true },
        { key: 'OrderController.save', flows: [], outcomes: {}, variantsSeen: [], variantsKnown: [], known: true },
        { key: 'GET /<script>', flows: ['order'], outcomes: { error: 1 }, variantsSeen: [], variantsKnown: [], known: false },
      ],
      reached: 1,
      known: 2,
    }),
    '#/p/web/coverage',
  );
  assert.match(page, /<h2>API coverage<\/h2><span[^>]*>1\/2 endpoints reached/);
  assert.match(page, /<tr class="endpoint"><td><b>OrderController\.getOrder<\/b><\/td><td><span class="g">2 ok<\/span> · <span class="w">1 hang<\/span><\/td><td><span class="dim">default<\/span> <span class="w">locked<\/span> <span class="dim">1\/2<\/span>/);
  assert.match(page, /<tr class="endpoint none"><td><b>OrderController\.save<\/b><\/td><td>never called<\/td>/);
  assert.match(page, /GET \/&lt;script&gt;<\/b> <small class="dim">not in the inventory/);
});

test('the coverage tab has no API section when no run had api data', () => {
  const page = rendered(project(), '#/p/web/coverage');
  assert.match(page, /<h2>Routes<\/h2><span[^>]*>1\/1 routes reached/);
  assert.match(page, /class="routes"/);
  assert.doesNotMatch(page, /API coverage/);
});

const withMilestones = (milestones?: Report['projects'][number]['milestones']) => {
  const r = project();
  return { ...r, projects: [{ ...r.projects[0]!, ...(milestones ? { milestones } : {}) }] } as Report;
};

test('the milestones tab: expected ones with a sweep strip, missed ones highlighted, undeclared listed apart', () => {
  const r = withMilestones([
    {
      flow: 'account-save',
      sweep: 4,
      runs: 2,
      recorded: true,
      expected: [
        { name: 'saved', reached: 3, history: [{ sweep: 3, reached: 0 }, { sweep: 4, reached: 3 }] },
        { name: '<persisted>', reached: 0, history: [{ sweep: 3, reached: 1 }, { sweep: 4, reached: 0 }] },
      ],
      missed: ['<persisted>'],
      undeclared: [{ name: 'signedOut', reached: 1 }],
    },
    { flow: 'browse', sweep: 4, runs: 1, recorded: false, expected: [{ name: 'found', reached: 0, history: [{ sweep: 4, reached: 0 }] }], missed: ['found'], undeclared: [] },
  ]);
  assert.match(rendered(r, '#/p/web'), /href="#\/p\/web\/milestones">MILESTONES 1\/3</);
  const page = rendered(r, '#/p/web/milestones');
  assert.match(page, /<h2>account-save<\/h2><span[^>]*>1\/2 expected reached · sweep 4 · 2 runs/);
  assert.match(page, /<tr class="milestone"><td><b>saved<\/b><\/td><td><span class="g">3×<\/span><\/td><td class="strip"[^>]*><span class="sq" title="sweep 3: 0×"><\/span><span class="sq on" title="sweep 4: 3×">/);
  assert.match(page, /<tr class="milestone missed"><td><b>&lt;persisted&gt;<\/b><\/td><td>not reached<\/td>/);
  assert.match(page, /reached, not declared<\/span><span>signedOut <span class="dim">1×/);
  assert.match(page, /<h2>browse<\/h2>[\s\S]*Its spec records no milestones/);
});

test('no milestones tab without milestone data', () => {
  const page = rendered(withMilestones(), '#/p/web');
  assert.doesNotMatch(page, /MILESTONES/);
  assert.match(rendered(withMilestones(), '#/p/web/milestones'), /RUN \(LATEST SWEEP\)/, 'an unknown tab falls back to sweeps');
});

test("the header counts every project's latest state, names the latest sweep's, and keeps unlisted routes apart", () => {
  const p = (name: string, last_sweep: number, routes: { template: string; states: number; known: boolean }[]) =>
    ({ name, spec: 's.ts', target: {}, last_sweep, actions: 10, properties: [], runs: [], history: [], routes });
  const r = {
    ...report,
    sweep: { id: 2, at: 't', commits: ['c'] },
    summary: {
      ...report.summary, actions: 10, routes: [1, 1],
      latest_sweep: { projects: ['upload'], actions: 10, routes: [1, 1], extra_routes: 0 },
      all: { projects: ['orders', 'upload'], actions: 1234, routes: [2, 5], extra_routes: 3 },
    },
    projects: [
      p('orders', 1, [
        { template: '/a', states: 4, known: true }, { template: '/b', states: 0, known: true },
        { template: '/c', states: 0, known: true }, { template: '/d', states: 0, known: true },
        { template: '/x', states: 2, known: false }, { template: '/y', states: 1, known: false }, { template: '/z', states: 1, known: false },
      ]),
      p('upload', 2, [{ template: '/u', states: 3, known: true }]),
    ],
  } as Report;

  const home = rendered(r, '');
  assert.match(home, /<span class="k">ACTIONS<\/span><span class="v">1,234<\/span>/);
  assert.match(home, /<span class="k">ROUTES<\/span><span class="v">2\/5<\/span>/);
  assert.match(home, /\+3 not in the route list/);
  assert.match(home, /<small>all projects · latest sweep: upload<\/small>/);
  // The matrix: orders reached 1 of its 4 listed routes, plus 3 unlisted.
  assert.match(home, /<span class="dim">1\/4<\/span> <small class="dim" title="3 not in the route list">\+3<\/small>/);

  const coverage = rendered(r, '#/p/orders/coverage');
  assert.match(coverage, /COVERAGE 1\/4/);
  assert.match(coverage, /<h2>Routes<\/h2><span[^>]*>1\/4 routes reached · \+3 not in the route list/);
});

test('a report.json from before summary.all renders its latest-sweep numbers', () => {
  const home = rendered({ ...report, summary: { ...report.summary, actions: 7, routes: [2, 3] } }, '');
  assert.match(home, /<span class="k">ACTIONS<\/span><span class="v">7<\/span>/);
  assert.match(home, /<span class="k">ROUTES<\/span><span class="v">2\/3<\/span>/);
});

const withFinding = () =>
  ({
    ...project(),
    findings: [
      {
        id: 'F-1', status: 'new', property: 'noErrors', route: '/orders', url: 'http://x/orders', summary: 'boom', project: 'web', target: {},
        first_seen: 't', last_seen: 't', seen_in: 1, of_sweeps: 1, runs_hit: 1, clean_sweeps: 0, sweeps: [1], snapshots: [], schema: 's',
        repro: { seed: 7, run: 'web/r1', command: "npx bombadil-kit run --seed 7 --only 'a<b'", steps: [], replay: 'npx bombadil-kit replay web/r1' },
        evidence: { frames: ['f/a.png', 'f/b.png'], run_dir: 'd', inspect: 'npx bombadil browser inspect tmp/bombadil/runs/web/r1' },
      },
    ],
  }) as unknown as Report;

test('evidence frames open full size in a lightbox, and link to the image without script', () => {
  const page = rendered(withFinding(), '#/f/F-1');
  assert.match(page, /<a class="zoom" href="f\/a\.png" data-frame="0" aria-label="screen -1 before the violation, full size"><img src="f\/a\.png"/);
  assert.match(page, /<a class="zoom" href="f\/b\.png" data-frame="1"/);
  assert.match(renderHtml(withFinding()), /<dialog id="lightbox"/);
});

test('every command on a finding page has a copy button carrying the exact command', () => {
  const page = rendered(withFinding(), '#/f/F-1');
  assert.match(page, /data-copy="npx bombadil-kit run --seed 7 --only &#39;a&lt;b&#39;"/);
  assert.match(page, /data-copy="npx bombadil-kit replay web\/r1"/);
  assert.match(page, /data-copy="npx bombadil browser inspect tmp\/bombadil\/runs\/web\/r1"/);
  assert.match(rendered(withFinding(), '#/f/F-1/json'), /data-copy="jq &#39;select\(\.id==&quot;F-1&quot;\)&#39; findings\.ndjson"/);
  assert.match(rendered(withFinding(), ''), /data-copy="jq -c &#39;select\(\.status==&quot;open&quot; or \.status==&quot;new&quot;\)&#39; findings\.ndjson"/);
});

test('project rerun commands have copy buttons; replays do not', () => {
  const r = project();
  const runs = [
    { id: 'web/r1', seed: 1, actions: 5, exit_code: 0, started_at: 't', command: 'npx bombadil-kit run --seed 1' },
    { id: 'web/r2', seed: 1, actions: 5, exit_code: 0, started_at: 't', command: 'x', replay_of: 'web/r1' },
  ];
  const withRuns = { ...r, projects: [{ ...r.projects[0]!, runs }] } as Report;
  assert.match(rendered(withRuns, '#/p/web'), /rerun latest[\s\S]*data-copy="npx bombadil-kit run --seed 1"/);
  const sweeps = rendered(withRuns, '#/p/web/sweeps');
  assert.equal(sweeps.match(/data-copy=/g)?.length, 2, 'the sidebar and the sweep run, not the replay');
});

test('every command on every page is the one command-line component: prompt, wrapping text, copy button', () => {
  const r = withFinding();
  const runs = [{ id: 'web/r1', seed: 1, actions: 5, exit_code: 0, started_at: 't', command: 'npx bombadil-kit run --seed 1' }];
  const all = { ...r, projects: [{ ...r.projects[0]!, runs }] } as Report;
  for (const hash of ['', '#/p/web', '#/p/web/sweeps', '#/f/F-1', '#/f/F-1/json']) {
    const page = rendered(all, hash);
    const copies = page.match(/data-copy="/g)?.length ?? 0;
    const components = page.match(/<div class="cmdline"[^>]*><code class="cmd[^"]*"><span class="g">\$<\/span> [^<]*(?:<span class="dim">[^<]*<\/span>)?<\/code><button type="button" class="copy" data-copy="/g)?.length ?? 0;
    assert.ok(copies > 0, hash + ' shows a command');
    assert.equal(components, copies, hash);
    assert.equal(page.match(/class="g">\$</g)?.length, copies, hash + ': no command without its copy button');
  }
});
