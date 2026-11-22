import { fontFaces } from './fonts.ts';
import type { Report } from './report.ts';

/**
 * index.html: one self-contained page (no network, opens from file://) that
 * renders report.json, which is embedded in it. Hash routes:
 *
 *   #/                    repo: stats, property matrix, cases by status
 *   #/p/<project>[/tab]   project: cases | coverage | milestones | sweeps
 *   #/f/<id>[/json]       one case, as a person reads it or as JSON
 */

// JSON inside <script> must not be able to close the tag or open a comment.
const embed = (report: Report): string =>
  JSON.stringify(report).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

export const renderHtml = (report: Report, title = 'bombadil'): string => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title.replace(/[<&"]/g, '')} fuzz report · sweep ${report.sweep.id}</title>
<style>${fontFaces()}
${CSS}</style>
</head>
<body>
<div id="app"></div>
<script type="application/json" id="report">${embed(report)}</script>
<script>const TITLE = ${JSON.stringify(title.toUpperCase())};
${CLIENT}</script>
</body>
</html>
`;

const CSS = `
:root{--bg:#02060B;--panel:rgba(0,16,26,.78);--line:rgba(0,229,255,.28);--line2:rgba(0,229,255,.12);
--c:#00E5FF;--m:#FF2BD6;--g:#39FF88;--y:#FFC53D;--t:#CFEFFF;--dim:#7E9BAE;--white:#FFFFFF}
*{box-sizing:border-box}
body{margin:0;background-color:var(--bg);color:var(--t);font:13px/1.55 "JetBrains Mono",ui-monospace,SFMono-Regular,Menlo,monospace;
background-image:linear-gradient(rgba(0,229,255,.07) 1px,transparent 1px),linear-gradient(90deg,rgba(0,229,255,.07) 1px,transparent 1px),
linear-gradient(rgba(0,229,255,.035) 1px,transparent 1px),linear-gradient(90deg,rgba(0,229,255,.035) 1px,transparent 1px);
background-size:160px 160px,160px 160px,32px 32px,32px 32px;min-height:100vh}
a{color:var(--c);text-decoration:none}a:hover{color:#8AF4FF;text-shadow:0 0 10px rgba(0,229,255,.7)}
a:focus-visible,button:focus-visible{outline:2px solid var(--c);outline-offset:2px}
.wrap{max-width:1440px;margin:0 auto;padding:24px 32px 48px;display:flex;flex-direction:column;gap:20px}
.bar{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:14px;border:1px solid rgba(0,229,255,.35);background:rgba(0,16,26,.85);padding:12px 18px;box-shadow:0 0 24px rgba(0,229,255,.12)}
.crumbs{display:flex;align-items:center;gap:12px;flex-wrap:wrap;font:700 20px/1.2 Rajdhani,"Barlow Condensed","Arial Narrow",sans-serif;letter-spacing:.18em;text-transform:uppercase}
.crumbs .here{color:var(--white);text-shadow:0 0 14px rgba(0,229,255,.6)}
.led{width:10px;height:10px;border-radius:50%;background:var(--g);box-shadow:0 0 10px var(--g)}
.led.bad{background:var(--m);box-shadow:0 0 10px var(--m)}
.dim{color:var(--dim)}.y{color:var(--y)}.m{color:var(--m)}.g{color:var(--g)}.c{color:var(--c)}.w{color:var(--white)}
.panel{position:relative;border:1px solid var(--line);background:var(--panel)}
.panel.pad{padding:14px 16px}
.panel h2,.h{margin:0;font:700 16px/1.3 Rajdhani,"Barlow Condensed","Arial Narrow",sans-serif;letter-spacing:.24em;color:var(--c);text-transform:uppercase}
.panel>.head{display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:10px;padding:10px 14px;border-bottom:1px solid var(--line)}
.tick:before,.tick:after{content:"";position:absolute;width:10px;height:10px}
.tick:before{top:-1px;left:-1px;border-top:2px solid var(--k,var(--c));border-left:2px solid var(--k,var(--c))}
.tick:after{bottom:-1px;right:-1px;border-bottom:2px solid var(--k,var(--c));border-right:2px solid var(--k,var(--c))}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px}
.stat{padding:14px 16px;display:flex;flex-direction:column;gap:6px}
.stat .k{font:600 13px Rajdhani,"Arial Narrow",sans-serif;letter-spacing:.2em;color:var(--dim)}
.stat small{font-size:11px;color:var(--dim)}
.stat .v{font:700 40px/1 Rajdhani,"Arial Narrow",sans-serif;color:var(--k);text-shadow:0 0 16px var(--k)}
.meter{height:3px;background:rgba(0,229,255,.12)}.meter>i{display:block;height:100%;background:var(--k,var(--c));box-shadow:0 0 8px var(--k,var(--c))}
.scroll{overflow-x:auto}
table{border-collapse:collapse;width:100%}
th{font-weight:500;color:var(--dim);font-size:11px;letter-spacing:.1em;padding:10px 8px;text-align:left;vertical-align:bottom}
th.v{text-align:center;padding:10px 4px;letter-spacing:.04em;font-size:11px}
/* The span turns, the cell doesn't: centring the span puts the label over the middle of its column, where the cells' marks are. */
th.v span{display:inline-block;writing-mode:vertical-rl;transform:rotate(180deg);white-space:nowrap;text-align:left}
td{padding:10px 8px;border-top:1px solid var(--line2);white-space:nowrap}
td.cell{text-align:center}
.held{color:var(--g);font-size:10px;text-shadow:0 0 6px rgba(57,255,136,.6)}
.na{color:#2F4656}
.hot{display:inline-block;min-width:22px;padding:1px 6px;border:1px solid var(--m);color:var(--m);font-weight:700;background:rgba(255,43,214,.12);box-shadow:0 0 10px rgba(255,43,214,.45)}
.lanes{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap:14px;align-items:start}
.lane>.head{border-bottom-color:var(--k)}
.lane h2{color:var(--k);text-shadow:0 0 10px var(--k)}
.case{display:flex;flex-direction:column;gap:4px;padding:10px 14px;border-bottom:1px solid var(--line2);color:var(--t)}
.case:hover{background:rgba(0,229,255,.06);text-shadow:none;color:var(--t)}
.case .top{display:flex;justify-content:space-between;gap:8px;font-size:12px}
.case .id{color:var(--k);font-weight:700}
.case .t{color:var(--white);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.case .s{color:var(--dim);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sq{display:inline-block;width:11px;height:11px;border:1px solid #234050;margin-right:3px;vertical-align:middle}
.sq.on{background:var(--k);border-color:var(--k);box-shadow:0 0 6px var(--k)}
.empty{padding:14px;color:var(--dim)}
.cols{display:flex;flex-wrap:wrap;gap:20px;align-items:flex-start}
.side{flex:1 1 300px;min-width:0;display:flex;flex-direction:column;gap:14px}
.main{flex:3 1 720px;min-width:0;display:flex;flex-direction:column;gap:18px}
.row{display:flex;justify-content:space-between;gap:10px;padding:8px 14px;border-bottom:1px solid var(--line2)}
.tabs{display:flex;flex-wrap:wrap;border-bottom:1px solid var(--line)}
.tabs a{padding:12px 20px;border-bottom:2px solid transparent;color:var(--dim);font:700 15px Rajdhani,"Arial Narrow",sans-serif;letter-spacing:.2em}
.tabs a.on{color:var(--white);border-bottom-color:var(--c);background:rgba(0,229,255,.12)}
.list .case{display:grid;grid-template-columns:84px 76px minmax(0,1fr) 120px;gap:14px;align-items:center}
.pill{border:1px solid var(--k);color:var(--k);padding:0 6px;text-align:center;font-size:11px;letter-spacing:.12em;text-transform:uppercase}
.routes{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px;padding:16px}
.route{display:flex;flex-direction:column;gap:2px;padding:9px 11px;border:1px solid var(--c);box-shadow:inset 0 0 12px rgba(0,229,255,.12);overflow:hidden}
.route b{overflow-wrap:anywhere;font-weight:600}.route b span{color:var(--dim);font-weight:400}
.route.bad{border-color:var(--m);background:rgba(255,43,214,.16);box-shadow:0 0 14px rgba(255,43,214,.4);color:var(--white)}
.route.none{border:1px dashed #2F4656;box-shadow:none;color:var(--dim)}
.route small{font-size:11px;opacity:.85}
.head.api,.head.flow{border-top:1px solid var(--line2)}.head.flow:first-child{border-top:0}
tr.milestone b{font-weight:600;overflow-wrap:anywhere}tr.milestone.missed td{color:var(--y);background:rgba(255,197,61,.08)}tr.milestone.missed td:first-child{box-shadow:inset 3px 0 0 var(--y)}
.strip .sq{margin-right:2px}tr.endpoint.none td{color:var(--dim);opacity:.6}tr.endpoint b{font-weight:600;overflow-wrap:anywhere}
.chart{display:flex;align-items:flex-end;gap:12px;height:170px;padding:16px 16px 6px;border-bottom:1px solid var(--line2)}
.chart div{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:6px;height:100%;min-width:0}
.chart i{display:block;width:100%;max-width:46px;background:rgba(0,229,255,.55);box-shadow:0 0 10px rgba(0,229,255,.4)}
.chart div.last i{background:var(--m);box-shadow:0 0 10px rgba(255,43,214,.6)}
.chart span{font-size:11px;color:var(--dim)}
.banner{--k:var(--m);border-color:var(--k);padding:20px 24px;display:flex;flex-wrap:wrap;justify-content:space-between;gap:18px}
.banner h1{margin:0;font:700 40px/1.05 Rajdhani,"Barlow Condensed","Arial Narrow",sans-serif;color:var(--white);word-break:break-word}
.banner .kick{font:700 14px Rajdhani,"Arial Narrow",sans-serif;letter-spacing:.3em;color:var(--k);text-transform:uppercase;overflow-wrap:anywhere}
.nums{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px;align-self:center}
.nums b{display:block;font:700 36px/1 Rajdhani,"Arial Narrow",sans-serif;color:var(--k);text-shadow:0 0 14px var(--k)}
.nums span{color:var(--dim);font-size:11px;letter-spacing:.14em}
.toggle{display:flex;border:1px solid rgba(0,229,255,.4)}
.toggle a{padding:6px 16px;color:var(--dim);font:700 14px Rajdhani,"Arial Narrow",sans-serif;letter-spacing:.2em}
.toggle a.on{background:var(--c);color:var(--bg);text-shadow:none}
.term{border-color:rgba(57,255,136,.35);background:rgba(0,14,8,.85)}
.term .h{color:var(--g);text-shadow:0 0 10px rgba(57,255,136,.5)}
.steps{display:flex;flex-direction:column;gap:4px;color:#B8FFD4}
.steps div{display:grid;grid-template-columns:28px minmax(0,1fr) auto;gap:10px}
.steps div:last-child{color:var(--white)}
pre{margin:0;white-space:pre-wrap;word-break:break-word;font:12px/1.6 inherit;color:#B8FFD4}
pre.json{white-space:pre;overflow-x:auto}
.frames{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:14px}
.frames figure{margin:0;display:flex;flex-direction:column;gap:6px}
.frames img{width:100%;border:1px solid var(--line);background:#000}
.frames figure:last-child img{border-color:var(--m);box-shadow:0 0 18px rgba(255,43,214,.4)}
.frames figcaption{color:var(--dim);font-size:12px}
.kv{display:flex;flex-direction:column;gap:2px;padding:6px 0;border-bottom:1px solid var(--line2)}
.kv:last-child{border-bottom:0}
.kv code{color:var(--t);white-space:pre-wrap;word-break:break-word;font:inherit}
.cmd{display:block;white-space:nowrap;overflow-x:auto;padding-bottom:2px}
.foot{display:flex;flex-wrap:wrap;justify-content:space-between;gap:12px;color:var(--dim);font-size:12px}
@media (max-width:700px){.wrap{padding:16px}.list .case{grid-template-columns:1fr}.banner h1{font-size:30px}}
`;

// The browser side, plain JS. Every string from the report goes through esc():
// fuzzer input and app text reach this page verbatim.
const CLIENT = String.raw`
const R = JSON.parse(document.getElementById('report').textContent);
const app = document.getElementById('app');
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const enc = encodeURIComponent;
const K = { new: 'var(--m)', open: 'var(--m)', quiet: 'var(--c)', closed: 'var(--g)' };
const when = (iso) => (iso ? iso.replace('T', ' ').slice(0, 16) : '');
const isOpen = (f) => f.status === 'new' || f.status === 'open';
const titleOf = (f) => f.property + ' on ' + f.route;
// A headline: the first sentence of what the violation carried, at most 140 characters.
const headline = (f) => {
  const first = (f.summary || '').split(/(?<=[.!?])\s/)[0].trim();
  if (!first) return titleOf(f);
  return first.length > 140 ? first.slice(0, 139) + '…' : first;
};
// '/orders/:orderNumber/prepare-store' with everything but the last segment dimmed.
const routeLabel = (t) => {
  const i = t.lastIndexOf('/');
  return i > 0 ? '<span>' + esc(t.slice(0, i + 1)) + '</span>' + esc(t.slice(i + 1)) : esc(t);
};
const targetOf = (t) => [t.kind, t.faults != null ? 'faults ' + Math.round(t.faults * 100) + '%' : '', t.viewport].filter(Boolean).join(' · ');
const byProject = (name) => R.projects.find((p) => p.name === name);
// Listed routes reached, of those listed; routes reached that the list lacks are counted apart.
const routeCov = (p) => {
  const known = p.routes.filter((r) => r.known);
  return { reached: known.filter((r) => r.states > 0).length, known: known.length, extra: p.routes.filter((r) => !r.known && r.states > 0).length };
};
const unlisted = (n) => (n ? n + ' not in the route list' : '');
const sweepsOf = (f) => (byProject(f.project)?.history ?? []).slice(-6);
const squares = (f) => sweepsOf(f).map((h) => '<span class="sq' + (f.sweeps.includes(h.sweep) ? ' on' : '') + '" title="sweep ' + h.sweep + '"></span>').join('');

const header = (crumbs, right) =>
  '<header class="bar"><div class="crumbs"><span class="led' + (R.summary.new + R.summary.open ? ' bad' : '') + '"></span>' + crumbs + '</div>' +
  '<div style="display:flex;gap:14px;flex-wrap:wrap;align-items:center">' + right + '</div></header>';
const home = '<a href="#/">' + esc(TITLE) + ' ▸ FUZZ</a>';
const sweepLine = '<span class="dim">sweep ' + R.sweep.id + ' · ' + esc(R.sweep.commits.join(', ')) + ' · ' + esc(when(R.sweep.at)) + '</span>';

const caseRow = (f) =>
  '<a class="case" style="--k:' + K[f.status] + '" href="#/f/' + enc(f.id) + '">' +
  '<span class="top"><span class="id">' + esc(f.id) + '</span><span class="dim">' + esc(f.project) + '</span></span>' +
  '<span class="t">' + esc(titleOf(f)) + '</span>' +
  (f.summary ? '<span class="s">' + esc(f.summary) + '</span>' : '') +
  '<span>' + squares(f) + '<span class="dim" style="font-size:12px;margin-left:6px">' + f.seen_in + '/' + f.of_sweeps + ' sweeps</span></span></a>';

function repo() {
  const s = R.summary;
  const props = [...new Set(R.projects.flatMap((p) => p.properties.map((x) => x.name)))];
  const stat = (k, v, color, pct, sub) =>
    '<div class="panel tick stat" style="--k:' + color + '"><span class="k">' + k + '</span><span class="v">' + v + '</span><div class="meter"><i style="width:' + pct + '%"></i></div>' +
    (sub ? '<small>' + sub + '</small>' : '') + '</div>';
  // Every project as of its own latest sweep; a report.json from before summary.all has the latest sweep's alone.
  const all = s.all || { projects: [], actions: s.actions, routes: s.routes, extra_routes: 0 };
  const latest = s.latest_sweep ? s.latest_sweep.projects : [];
  const scope = all.projects.length > 1 ? 'all projects' + (latest.length < all.projects.length ? ' · latest sweep: ' + esc(latest.join(', ')) : '') : '';
  const total = Math.max(1, s.new + s.open + s.quiet + s.closed);
  const cell = (p, name) => {
    const x = p.properties.find((q) => q.name === name);
    if (!x) return '<td class="cell"><span class="na" title="not checked">–</span></td>';
    if (x.open.length) return '<td class="cell"><a class="hot" href="#/f/' + enc(x.open[0]) + '" title="' + esc(x.open.join(', ')) + '">' + x.open.length + '</a></td>';
    return '<td class="cell"><span class="held" title="held">■</span></td>';
  };
  const cov = (p) => {
    const c = routeCov(p);
    return '<div style="display:flex;align-items:center;gap:10px"><div class="meter" style="flex:1;min-width:90px;height:6px"><i style="width:' + Math.round((100 * c.reached) / Math.max(1, c.known)) + '%"></i></div><span class="dim">' + c.reached + '/' + c.known + '</span>' +
      (c.extra ? ' <small class="dim" title="' + unlisted(c.extra) + '">+' + c.extra + '</small>' : '') + '</div>';
  };
  const lane = (status, label, hint, list) =>
    '<section class="panel lane" style="--k:' + K[status] + '"><div class="head"><h2>' + label + ' ' + list.length + '</h2><span class="dim" style="font-size:12px">' + hint + '</span></div>' +
    (list.length ? list.map(caseRow).join('') : '<div class="empty">none</div>') + '</section>';
  const by = (st) => R.findings.filter((f) => f.status === st);
  return header(home, sweepLine + '<span class="m">' + (s.new + s.open) + ' OPEN · ' + s.new + ' NEW</span>') +
    '<section class="stats">' +
    stat('NEW', s.new, 'var(--m)', (100 * s.new) / total) + stat('OPEN', s.open, 'var(--m)', (100 * s.open) / total) +
    stat('QUIET', s.quiet, 'var(--c)', (100 * s.quiet) / total) + stat('CLOSED', s.closed, 'var(--g)', (100 * s.closed) / total) +
    stat('ACTIONS', all.actions.toLocaleString('en-US'), 'var(--c)', 100, scope) +
    stat('ROUTES', all.routes[0] + '/' + all.routes[1], 'var(--g)', (100 * all.routes[0]) / Math.max(1, all.routes[1]), all.extra_routes ? '+' + unlisted(all.extra_routes) : '') +
    '</section>' +
    '<section class="panel"><div class="head"><h2>Property matrix</h2><span class="dim" style="font-size:12px"><span class="g">■</span> held · <span class="m">n</span> open cases · – not checked</span></div><div class="scroll"><table>' +
    '<thead><tr><th>PROJECT</th><th>TARGET</th>' + props.map((p) => '<th class="v"><span>' + esc(p) + '</span></th>').join('') + '<th>ROUTES</th></tr></thead><tbody>' +
    R.projects.map((p) => '<tr><td><a href="#/p/' + enc(p.name) + '"><b>' + esc(p.name) + '</b></a></td><td class="dim">' + esc(targetOf(p.target)) + '</td>' + props.map((n) => cell(p, n)).join('') + '<td style="min-width:170px">' + cov(p) + '</td></tr>').join('') +
    '</tbody></table></div></section>' +
    '<section class="lanes">' +
    lane('new', 'New', 'first seen this sweep', by('new')) +
    lane('open', 'Open', 'seen in 2+ sweeps', by('open')) +
    lane('quiet', 'Quiet', 'not seen lately', by('quiet')) +
    lane('closed', 'Closed', '3 clean sweeps', by('closed').slice(0, 12)) +
    '</section>' +
    '<footer class="foot"><span><span class="g">$</span> jq -c \'select(.status=="open" or .status=="new")\' findings.ndjson</span><span>report.json · findings.ndjson · state.json · generated ' + esc(when(R.generated_at)) + '</span></footer>';
}

// The mock API endpoints a project's flows called (report.json's api), or nothing without that data.
const OUTCOME = { ok: 'g', error: 'm', slow: 'c', hang: 'w' };
function apiSection(api) {
  if (!api) return '';
  const head = '<div class="head api"><h2>API coverage</h2><span class="dim" style="font-size:12px">' +
    (api.known ? api.reached + '/' + api.known + ' endpoints reached' : api.endpoints.length + ' endpoints called') + '</span></div>';
  const rows = api.endpoints.map((e) => {
    // Always in this order, however the calls came in.
    const calls = Object.keys(OUTCOME).filter((o) => e.outcomes[o]).map((o) => [o, e.outcomes[o]]).map(([o, n]) => '<span class="' + (OUTCOME[o] || '') + '">' + n.toLocaleString('en-US') + ' ' + esc(o) + '</span>').join(' · ');
    const variants = e.variantsKnown.length || e.variantsSeen.length
      ? e.variantsKnown.concat(e.variantsSeen.filter((v) => !e.variantsKnown.includes(v))).map((v) => '<span class="' + (e.variantsSeen.includes(v) ? 'w' : 'dim') + '">' + esc(v) + '</span>').join(' ') +
        (e.variantsKnown.length ? ' <span class="dim">' + e.variantsSeen.filter((v) => e.variantsKnown.includes(v)).length + '/' + e.variantsKnown.length + '</span>' : '')
      : '';
    return '<tr class="endpoint' + (calls ? '' : ' none') + '"><td><b>' + esc(e.key) + '</b>' + (e.known ? '' : ' <small class="dim">not in the inventory</small>') + '</td>' +
      '<td>' + (calls || 'never called') + '</td><td>' + variants + '</td><td class="dim">' + esc(e.flows.join(', ')) + '</td></tr>';
  }).join('');
  return head + '<div class="scroll"><table><thead><tr><th>ENDPOINT</th><th>CALLS</th><th>VARIANTS SEEN</th><th>FLOWS</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
    '<div class="empty">Dimmed endpoints were never called: no flow reached the page that calls them. The inventory is window.__mockEndpoints.</div>';
}

// Per flow, the milestones it expects (reached in its latest sweep or not, and a strip of sweeps before), then the ones it reached undeclared.
function milestonesSection(flows) {
  return flows.map((m) => {
    const got = m.expected.length - m.missed.length;
    const head = '<div class="head flow"><h2>' + esc(m.flow) + '</h2><span class="dim" style="font-size:12px">' +
      (m.expected.length ? got + '/' + m.expected.length + ' expected reached' : 'none expected') + ' · sweep ' + m.sweep + ' · ' + m.runs + (m.runs === 1 ? ' run' : ' runs') + '</span></div>';
    const note = m.recorded ? '' : '<div class="empty y">Its spec records no milestones: call milestones({ … }) in it.</div>';
    const rows = m.expected.map((e) => '<tr class="milestone' + (e.reached ? '' : ' missed') + '"><td><b>' + esc(e.name) + '</b></td><td>' +
      (e.reached ? '<span class="g">' + e.reached.toLocaleString('en-US') + '×</span>' : 'not reached') + '</td>' +
      '<td class="strip" style="--k:var(--g)">' + e.history.map((h) => '<span class="sq' + (h.reached ? ' on' : '') + '" title="sweep ' + h.sweep + ': ' + h.reached + '×"></span>').join('') + '</td></tr>').join('');
    const table = rows ? '<div class="scroll"><table><thead><tr><th>EXPECTED</th><th>LATEST SWEEP</th><th>SWEEPS</th></tr></thead><tbody>' + rows + '</tbody></table></div>' : '';
    const extra = m.undeclared.length
      ? '<div class="row undeclared"><span class="dim">reached, not declared</span><span>' + m.undeclared.map((u) => esc(u.name) + ' <span class="dim">' + u.reached.toLocaleString('en-US') + '×</span>').join(' · ') + '</span></div>'
      : '';
    return head + note + table + extra;
  }).join('') +
    '<div class="empty">Highlighted milestones were expected but not reached in the flow\'s latest sweep: a prompt to improve the flow (its start, fence, fixtures) or its actions, not a finding. flows.json says which milestones a flow expects.</div>';
}

function project(name, tab) {
  const p = byProject(name);
  if (!p) return header(home, '') + '<div class="panel pad">No project ' + esc(name) + '</div>';
  const mine = R.findings.filter((f) => f.project === name);
  const openRoutes = new Set(mine.filter(isOpen).map((f) => f.route));
  tab = tab || 'cases';
  const expected = (p.milestones || []).flatMap((m) => m.expected);
  const tabs = [['cases', 'CASES ' + mine.length], ['coverage', 'COVERAGE ' + routeCov(p).reached + '/' + routeCov(p).known]]
    .concat(p.milestones ? [['milestones', 'MILESTONES ' + expected.filter((e) => e.reached).length + '/' + expected.length]] : [])
    .concat([['sweeps', 'SWEEPS ' + p.history.length]])
    .map(([id, label]) => '<a role="tab" class="' + (tab === id ? 'on' : '') + '" href="#/p/' + enc(name) + '/' + id + '">' + label + '</a>').join('');
  let body = '';
  if (tab === 'cases') {
    body = mine.length
      ? '<div class="list">' + mine.map((f) =>
          '<a class="case" style="--k:' + K[f.status] + '" href="#/f/' + enc(f.id) + '"><span class="id">' + esc(f.id) + '</span><span class="pill">' + f.status + '</span>' +
          '<span style="display:flex;flex-direction:column;min-width:0"><span class="t">' + esc(titleOf(f)) + '</span><span class="s">' + esc(f.summary || f.url) + '</span></span>' +
          '<span>' + squares(f) + '</span></a>').join('') + '</div>'
      : '<div class="empty">No findings. Every property held on every route it reached.</div>';
  } else if (tab === 'coverage') {
    const c = routeCov(p);
    body = '<div class="head"><h2>Routes</h2><span class="dim" style="font-size:12px">' + c.reached + '/' + c.known + ' routes reached' + (c.extra ? ' · +' + unlisted(c.extra) : '') + '</span></div>' +
      '<div class="routes">' + p.routes.map((r) =>
      '<div class="route' + (openRoutes.has(r.template) ? ' bad' : r.states === 0 ? ' none' : '') + '"><b title="' + esc(r.template) + '">' + routeLabel(r.template) + '</b><small>' +
      (r.states ? r.states.toLocaleString('en-US') + ' states' : 'never reached') + (r.known ? '' : ' · not in the route list') + '</small></div>').join('') + '</div>' +
      '<div class="empty">Dashed routes were never reached: give the fuzzer a fixture or a start URL for them. Routes come from routes.json beside the spec, or the <code>routes</code> config key.</div>' +
      apiSection(p.api);
  } else if (tab === 'milestones' && p.milestones) {
    body = milestonesSection(p.milestones);
  } else {
    const max = Math.max(1, ...p.history.map((h) => h.findings));
    body = '<div class="chart">' + p.history.map((h, i) =>
      '<div class="' + (i === p.history.length - 1 ? 'last' : '') + '"><span class="w">' + h.findings + '</span><i style="height:' + Math.max(2, (120 * h.findings) / max) + 'px"></i><span>#' + h.sweep + '</span></div>').join('') + '</div>' +
      '<div class="scroll"><table><thead><tr><th>RUN (LATEST SWEEP)</th><th>SEED</th><th>ACTIONS</th><th>EXIT</th><th>RERUN</th></tr></thead><tbody>' +
      p.runs.map((r) => '<tr><td>' + esc(r.id) + '</td><td>' + r.seed + '</td><td>' + r.actions.toLocaleString('en-US') + '</td><td class="' + (r.exit_code ? 'm' : 'g') + '">' + r.exit_code + '</td><td class="dim">' + esc(r.replay_of ? 'replay of ' + r.replay_of : r.command) + '</td></tr>').join('') +
      '</tbody></table></div>';
  }
  const last = p.runs.filter((r) => !r.replay_of).at(-1);
  return header(home + '<span class="dim">/</span><span class="here">' + esc(name) + '</span>', '<span class="dim">' + esc(targetOf(p.target)) + ' · ' + p.history.length + ' sweeps · ' + p.actions.toLocaleString('en-US') + ' actions</span>') +
    '<div class="cols"><aside class="side"><section class="panel"><div class="head"><h2>Properties</h2></div>' +
    p.properties.map((x) => '<div class="row"><span>' + esc(x.name) + '</span>' + (x.open.length ? '<a class="m" href="#/f/' + enc(x.open[0]) + '"><b>' + x.open.length + ' open</b></a>' : '<span class="g">held</span>') + '</div>').join('') +
    '</section><section class="panel pad" style="display:flex;flex-direction:column;gap:6px"><h2>Target</h2><span class="dim">spec</span><span>' + esc(p.spec) + '</span>' +
    (last ? '<span class="dim">rerun latest</span><code class="cmd"><span class="g">$</span> ' + esc(last.command) + '</code>' : '') + '</section></aside>' +
    '<main class="main panel" style="gap:0"><nav class="tabs" role="tablist">' + tabs + '</nav>' + body + '</main></div>';
}

function finding(id, mode) {
  const f = R.findings.find((x) => x.id === id);
  if (!f) return header(home, '') + '<div class="panel pad">No finding ' + esc(id) + '</div>';
  const json = mode === 'json';
  const k = K[f.status];
  const top = header(
    home + '<span class="dim">/</span><a href="#/p/' + enc(f.project) + '">' + esc(f.project) + '</a><span class="dim">/</span><span class="here" style="color:' + k + '">' + esc(f.id) + '</span>',
    '<nav class="toggle" aria-label="View"><a class="' + (json ? '' : 'on') + '" href="#/f/' + enc(f.id) + '">HUMAN</a><a class="' + (json ? 'on' : '') + '" href="#/f/' + enc(f.id) + '/json">AGENT</a></nav>');
  const banner = '<section class="panel tick banner" style="--k:' + k + '"><div style="display:flex;flex-direction:column;gap:6px;flex:1 1 520px;min-width:0">' +
    '<span class="kick">' + esc(f.status) + ' · ' + esc(f.property) + '</span><h1>' + esc(headline(f)) + '</h1>' +
    '<span class="dim">' + esc(f.route) + ' · first ' + esc(when(f.first_seen)) + ' · last ' + esc(when(f.last_seen)) + '</span></div>' +
    '<div class="nums"><div><b>' + f.seen_in + '/' + f.of_sweeps + '</b><span>SWEEPS</span></div><div><b>' + f.runs_hit + '</b><span>RUNS HIT</span></div><div><b>' + (f.status === 'quiet' || f.status === 'closed' ? f.clean_sweeps : f.repro.steps.length) + '</b><span>' + (f.status === 'quiet' || f.status === 'closed' ? 'CLEAN SWEEPS' : 'STEPS SHOWN') + '</span></div></div></section>';
  if (json) {
    return top + banner + '<section class="panel pad term" style="display:flex;flex-direction:column;gap:10px"><div class="foot"><span><span class="g">$</span> jq \'select(.id=="' + esc(f.id) + '")\' findings.ndjson</span><span>' + esc(f.schema) + '</span></div><pre class="json">' + esc(JSON.stringify(f, null, 2)) + '</pre></section>';
  }
  const steps = f.repro.steps.map((s, i) => '<div><span class="g">' + String(i + 1).padStart(2, '0') + '</span><span>' + esc(s.action) + '</span><span class="dim">' + esc(s.route) + '</span></div>').join('');
  const frames = f.evidence.frames.map((src, i, all) => '<figure><img src="' + esc(src) + '" alt="screen ' + (i - all.length + 1) + ' before the violation" loading="lazy"><figcaption>' + (i === all.length - 1 ? 'violation' : 't' + (i - all.length + 1)) + '</figcaption></figure>').join('');
  const snaps = f.snapshots.map((s) => '<div class="kv"><span class="dim">' + esc(s.name ?? '') + '</span><code>' + esc(typeof s.value === 'string' ? s.value : JSON.stringify(s.value)) + '</code></div>').join('');
  const hist = sweepsOf(f).slice().reverse().map((h) => '<div class="row" style="padding:6px 0"><span><span class="sq' + (f.sweeps.includes(h.sweep) ? ' on' : '') + '" style="--k:' + k + '"></span> sweep ' + h.sweep + '</span><span class="dim">' + esc(when(h.at)) + '</span></div>').join('');
  return top + banner +
    '<div class="cols"><div class="main">' +
    '<section class="panel pad" style="display:flex;flex-direction:column;gap:8px"><h2>What happened</h2><span class="w" style="font-size:15px">' + esc(f.property) + ' failed on ' + esc(f.route) + '.</span><span class="dim">' + esc(f.url) + '</span></section>' +
    '<section class="panel pad term" style="display:flex;flex-direction:column;gap:8px"><h2 class="h">Last actions before it</h2><div class="steps">' + steps + '</div>' +
    '<code class="cmd dim" style="margin-top:8px"><span class="g">$</span> ' + esc(f.repro.command || 'seed ' + f.repro.seed) + '</code>' +
    (f.repro.replay ? '<code class="cmd dim"><span class="g">$</span> ' + esc(f.repro.replay) + ' <span class="dim">the same trace, replayed</span></code>' : '') + '</section>' +
    (frames ? '<section class="panel pad" style="display:flex;flex-direction:column;gap:12px"><h2>Evidence</h2><div class="frames">' + frames + '</div></section>' : '') +
    '</div><aside class="side">' +
    '<section class="panel pad"><h2>What the property saw</h2>' + (snaps || '<div class="dim">nothing captured</div>') + '</section>' +
    '<section class="panel pad"><h2>History</h2>' + hist + '</section>' +
    '<section class="panel pad" style="display:flex;flex-direction:column;gap:6px"><h2>Run</h2><span>' + esc(f.repro.run) + '</span><span class="dim">seed ' + f.repro.seed + ' · ' + esc(targetOf(f.target)) + '</span>' +
    '<span class="dim" style="margin-top:6px">every state of the run, step by step</span><code class="cmd"><span class="g">$</span> ' + esc(f.evidence.inspect) + '</code></section>' +
    '</aside></div>';
}

function render() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  let html;
  if (parts[0] === 'p' && parts[1]) html = project(parts[1], parts[2]);
  else if (parts[0] === 'f' && parts[1]) html = finding(parts[1], parts[2]);
  else html = repo();
  app.innerHTML = '<div class="wrap">' + html + '</div>';
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', render);
render();
`;
