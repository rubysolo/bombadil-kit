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
