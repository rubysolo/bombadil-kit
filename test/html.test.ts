import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderHtml } from '../src/report/html.ts';
import type { Report } from '../src/report/report.ts';

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

// Runs the page's script against a stub DOM and returns what it renders at `hash`.
const rendered = (r: Report, hash: string): string => {
  const html = renderHtml(r);
  const json = /<script type="application\/json" id="report">([\s\S]*?)<\/script>/.exec(html)![1]!;
  const script = /<script>(const TITLE[\s\S]*?)<\/script>/.exec(html)![1]!;
  const app = { innerHTML: '' };
  const document = { getElementById: (id: string) => (id === 'report' ? { textContent: json } : app) };
  const window = { addEventListener: () => {}, scrollTo: () => {} };
  new Function('document', 'window', 'location', script)(document, window, { hash });
  return app.innerHTML;
};

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
