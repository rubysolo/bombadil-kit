# bombadil-kit

A kit for fuzzing a web app's UI with [Bombadil](https://github.com/antithesishq/bombadil):

- **`bombadil-kit/rtk`, `/faults`, `/faker`, `/console`**: the app's side,
  on in fuzz mode only: seeded fault injection for the mock API (an RTK Query
  baseQuery wrapper, or the injector for any mock layer), seeded faker data,
  and console errors that say which line raised them.
- **`bombadil-kit/spec`**: properties and actions for Bombadil specs: no error
  boundary, spinners clear, no leaked `undefined`/`NaN`, no sideways scroll,
  failed writes are shown, console errors only around injected faults, nothing
  drawn under a floating logo, the app renders (and which files it rendered);
  form filling, `<select>` picking, forward-button weighting, header-free
  clicks, fences.
- **`bombadil-kit run`**: starts the app's dev server once (mock API, seeded
  faults and data), runs Bombadil once per **flow**, writes each run's
  metadata, and rebuilds the report.
- **The report**: `index.html` for people (repo → project → finding, with
  screenshots, the steps before each violation, the command to rerun it, route
  coverage and a property × route matrix), `findings.ndjson` and
  `report.json` for agents. Findings keep their id across runs and close after
  3 clean sweeps that reached their route.
- **`bombadil-kit affected`**: maps a diff to the flows that render the
  changed code, so a pull request fuzzes those, longer, against main's
  nightly baseline.

Built for React apps on Vite with a mock API. The report, the runner and most
of the spec library don't care; the coverage map needs a React dev build, and
`affected` needs esbuild to read the app's import graph.

**Agents integrating this into a repo: read [AGENTS.md](AGENTS.md).**

An unofficial companion to Bombadil, not affiliated with Antithesis. MIT
licensed; maintained as-is.

## Install

```bash
npm i -D https://github.com/rubysolo/bombadil-kit/releases/download/v0.4.0/bombadil-kit-0.4.0.tgz \
  @antithesishq/bombadil@0.7.10 esbuild
```

Each release's tarball is attached to its GitHub release; a URL install
needs no git, so it works in a Docker build too. (`github:rubysolo/bombadil-kit#<tag>`
also works where git is available; npm builds it on install.) Node 22.18 or
later. Bombadil finds Chrome by itself, or through `$CHROME`.

## Configure

`bombadil-kit.json` at the repo root (`templates/bombadil-kit.json` is a full
example):

```json
{
  "title": "acme",
  "projects": {
    "web": {
      "dir": "apps/web",
      "server": {
        "command": ["npx", "vite", "--host", "127.0.0.1", "--port", "{port}", "--strictPort"],
        "env": { "VITE_API_MOCK": "true", "VITE_MOCK_FAULT_RATE": "{faults}", "VITE_MOCK_FAULT_SEED": "{seed}" },
        "port": 5199
      },
      "signedInCookie": "auth_token=fuzz-session",
      "affected": { "entry": "apps/web/src/main.tsx", "routers": ["apps/web/src/App.tsx"] }
    }
  }
}
```

| key | default | |
|---|---|---|
| `title` | `bombadil` | the report's heading |
| `out` | `tmp/bombadil` | runs in `<out>/runs/<project>/`, the report in `<out>/report/` |
| `projects.<name>.dir` | | the app; the server runs here |
| `target` | `mock` | `live`: a real backend, see [below](#against-a-real-backend) |
| `server.command`, `server.env` | | `{port}` `{seed}` `{faults}` `{latency}` `{refDate}` are filled in |
| `server.port`, `server.ready` | `5199`, `/` | |
| `flows` | `<dir>/bombadil/flows.json` | without one, a single `explore` flow from `/` |
| `specs`, `spec` | `<dir>/bombadil`, `spec` | where `<spec>.ts` files live; the default spec |
| `signedInCookie` | | `NAME=VALUE` a `signedIn` flow starts with |
| `viewport` | 390 × 844 | phone width finds more layout bugs |
| `defaults` | `1m`, faults `0.1`, latency `50` | |
| `watch` | `[dir]` | uncommitted changes here mark a run's commit `-dirty` |
| `quiet` | | Bombadil stderr lines to drop (regex) |
| `affected.entry`, `.routers`, `.always` | | see [diff-aware](#diff-aware-fuzzing) |

## Run

```bash
npx bombadil-kit run                           # every flow, 1 minute each
npx bombadil-kit run --flow checkout --time 3m # repeat --flow for more
npx bombadil-kit run --flow checkout --headed  # watch it
npx bombadil-kit run --faults 0                # happy path only
npx bombadil-kit run --seed 1234 --ref-date 2026-11-19   # same mock data and faults as that run
npx bombadil-kit run --width 1280 --height 800 # desktop
npx bombadil-kit list                          # the flows
npx bombadil-kit report --fail-on new          # exit 1 if the latest sweep found something new
npx bombadil browser inspect tmp/bombadil/runs/web/<run>   # step through one run
```

`run` exits 0 clean, 2 on a property violation, 1 otherwise.

### Against a real backend

A second project, the same app with the mock env left out, pointed at a
disposable backend:

```json
"web-live": {
  "dir": "apps/web",
  "target": "live",
  "server": { "command": ["npx", "vite", "--port", "{port}"], "env": { "VITE_API_URL": "https://staging.example.test" } },
  "defaults": { "time": "2m" }
}
```

It catches what a mock can't: drift between the mock and the real API
(`noLeakedText`), real 4xx/5xx (Bombadil's `noHttpErrorCodes`), real data in
the layout. It can't inject faults, so the runner refuses `--faults`, and
`failedWritesShown` never triggers; `consoleQuietUnlessFaulted` excuses
nothing. run.json records `kind: live` and no seed or mock date: a finding's
command reruns the flow, not the data.

The fuzzer clicks everything: it creates, deletes and changes things. Reset
the backend before each sweep, and stub mail, payments and third-party
calls on its side. Real latency is slower than a mock: give `spinnersClear` a
larger `within`. Run it nightly; read its findings as leads, not gates.

## Flows

A random walk from the sign-in page rarely gets five correct steps deep into
a workflow: every step competes with Back, reload, footer links and refilling
a form. `flows.json` splits the app into workflows:

```json
[{ "name": "checkout", "about": "Cart to confirmation.", "start": "/cart",
   "allow": ["/cart*", "/checkout*"], "signedIn": true, "spec": "flow" }]
```

- `start`: where the workflow starts, usually a fixture the mock API serves.
- `allow`: the fence, exact paths or prefixes ending in `*`. Passed to
  Bombadil's `--allow-url` (which only polices full page loads) and to the page
  in the `fuzz_fence` cookie, which `fenced(...)` reads: outside the fence the
  only action is Back.
- `signedIn`: start with `signedInCookie`. The app has to accept a session
  from a cookie in mock mode; see [prompts/INTEGRATE.md](prompts/INTEGRATE.md).
- `spec`: which spec file runs it.

[prompts/FLOWS.md](prompts/FLOWS.md) is how to derive flows from an app.

## Specs

```ts
// apps/web/bombadil/properties.ts
import { errorBoundaryNeverShown, spinnersClear, appRenders as renders } from 'bombadil-kit/spec';
export const noErrorBoundary = errorBoundaryNeverShown('[data-testid="crash"]');
export const spinnersSettle = spinnersClear({ selector: '.spinner' });
export const appRenders = renders();
```

Every property is a factory, called at the top level of a spec and exported
under the name the report shows. The export name is part of each finding's
id; rename one and its findings start over. `templates/bombadil/` has a full
spec, a signed-in flow spec, and the properties file.

A spec file that uses a name and passes it on: `import { x } from '…'` then
`export { x }`. `export { x } from '…'` beside that import makes Bombadil's
bundle declare `x` twice, and the spec won't load.

| factory | holds when |
|---|---|
| `errorBoundaryNeverShown(selector)` | the error boundary's fallback never shows |
| `spinnersClear({ selector, within, exclude })` | a visible loading indicator clears within 15s, added up across visits to its path until the path shows without one (a walker never stays 15s on a page; a stuck spinner shows on every visit), plus the `delayMs` of a slow fault still in flight; any hang since the page loaded excuses it. Spinners inside `exclude` (a selector: a modal meant to show 30s of progress) don't count |
| `noLeakedText(pattern?)` | no `undefined`, `NaN`, `[object Object]`, `Invalid Date`, `null` in the text |
| `noSidewaysScroll(tolerance?)` | the page never scrolls horizontally |
| `failedWritesShown({ quiet, errorSelector, within, request })` | a write the fault injector failed shows a visible error on the page the user is on when it fails, within 5s and before they leave; an alert on another page doesn't count, and one alert per write will do (a retry or Dismiss may clear it). Slow and hung writes don't count. One finding per endpoint and page: the id is `request(method, path)`, by default the path with record segments as `:id` (`POST /orders/:id/design_requests`), not the status or the record |
| `consoleQuietUnlessFaulted(grace?, hangGrace?)` | no console error, except within 5s of an injected error, 5s after a slow response answers, or `hangGrace` (default `grace`) after a hang started; also takes `{ grace, hangGrace }` |
| `consoleQuietUnlessFaulted({ injected })` | no console error, except one whose text matches `injected` (the marker the mock layer puts in what it injects), whenever it lands; with the built-in injector, `new RegExp(INJECTED_MARKER)`. Needs `installFuzzConsole` when the marker is inside a logged object: Bombadil records those as `"Object"` |
| `nothingUnder({ selector, container })` | no text is drawn over, say, a floating header's logo |
| `appRenders({ root, within })` | something renders within 10s; also records rendered files |
| `noBlankPage({ chrome, minChars, filled, loading, minStates, minMs })` | the page is never left, for 3 states and 250ms on one history entry, with under 50 characters of text outside `chrome` (`header, footer, nav`) and nothing there matching `filled` (links, buttons, form fields, media, `[role="alert"]`) or `loading` (spinnersClear's). appRenders only checks the first render. `minMs` must outlast the app's harmless blank moments (a lazy route loading); the `blank` snapshot in a clean sweep's trace shows them |

`persisted(state, key, active)`, inside `extract`, gives how long `active` has
held on the current history entry as `{ ms, states }` (a reload or navigation
starts over); `hasSettled(p, { minStates = 3, minMs = 1000 })` is whether that
outlived a render cascade. noBlankPage is built from them; so can an app's own
"stuck in state X" property.

| action | does |
|---|---|
| `formActions` | `fillPlausible` (realistic values by field type, name and autocomplete) and `pickOption` (native selects) |
| `pageClicks({ exclude })` | Bombadil's clicks, minus anything inside `exclude` (default `header`) |
| `forwardClicks({ label, exclude })` | only Next / Save / Submit / Pay / … buttons, to weight a workflow forward |
| `fenced(generator)` | `generator`, or only Back outside the flow's fence |

`apiCalls()` is not a property: call it once at the top level of the spec,
unexported (Bombadil refuses an export that isn't a property or an action).
It records the mock API calls each state saw, as the `api` snapshot, for the
report's API coverage (below).

`failedWritesShown`, `consoleQuietUnlessFaulted` and `spinnersClear` read
`window.__mockFaults`, which the app's fault injector fills (below).
`isWriteFault(f)` is how they tell a write: `f.write ?? f.method !== 'GET'`.

## In the app

Fuzz mode is the app's mock mode plus the env vars `bombadil-kit.json`'s
`server.env` sets. Vite fills `import.meta.env` in only in the app's own
code, so the app passes it in:

```ts
// the API slice
import { withFaults } from 'bombadil-kit/rtk';
const baseQuery = withFaults(mockBaseQuery, import.meta.env, { spare: [/^\/mock\//, /^\/translations/] });

// the mock data, imported before any is built
import { faker } from '@faker-js/faker';
import { seedFaker } from 'bombadil-kit/faker';
export const { mockRandom, mockNow } = seedFaker(faker, import.meta.env);

// main.tsx
import { installFuzzConsole } from 'bombadil-kit/console';
if (import.meta.env.VITE_FUZZ === 'true') installFuzzConsole();
```

| module | env | does |
|---|---|---|
| `bombadil-kit/rtk` | `VITE_MOCK_FAULT_RATE`, `_SEED` | `withFaults(baseQuery, env, { spare, isWrite, onFault })`: fails that share of requests as 500, 503, 422, network error or timeout, chosen by a seeded PRNG; returns `baseQuery` itself when off |
| `bombadil-kit/faults` | same | `createFaultInjector({ rate, seed, spare, isWrite })`, for mock layers other than RTK Query; both log faults to `window.__mockFaults`, and every request (spared ones too) to `window.__mockCalls` as `METHOD /path`, `ok` or `error`. `INJECTED_MARKER`: the text every built-in fault carries |
| `bombadil-kit/faker` | `VITE_MOCK_SEED`, `VITE_MOCK_REF_DATE` | seeds the app's faker and its reference date; `mockRandom`/`mockNow` for the rest of the mock layer |
| `bombadil-kit/console` | `VITE_FUZZ` | each `console.error` becomes one string with the source lines that raised it (Bombadil records only the first argument) |

A mock layer of the app's own (RPC, Salesforce remoting, GraphQL, one that
delays or hangs requests) can push its faults onto `window.__mockFaults`
itself:

| field | |
|---|---|
| `method`, `path`, `status`, `at` | the request (`path` can be `Controller.method`), what it failed with, `Date.now()` when it started |
| `write` | optional. Whether it changes data; overrides the `method !== 'GET'` guess. Transports without HTTP verbs set it; `isWrite(method, path)` on `withFaults`/`createFaultInjector` fills it |
| `kind` | optional. `'error'` (the default): it failed. `'slow'`: it answered `delayMs` late. `'hang'`: it never answers; console errors are excused for `hangGrace` after `at`, not for the rest of the page, and spinners for the rest of it |
| `delayMs` | optional, for `slow` |

For `consoleQuietUnlessFaulted({ injected })`, such a layer puts one marker
in every failure it injects (`/Mock world injected failure/`), in the text the
app ends up logging.

For the report's API coverage, a mock layer keeps `window.__mockCalls`, one
entry per call (`withFaults`/`createFaultInjector` do, while faults are on):

| field | |
|---|---|
| `key` | the endpoint: `GET /orders/:id`, `OrderController.getOrder`. A `METHOD /path` key with a concrete path is matched to the inventory's templates for that method, else ids are blurred as routes' are |
| `variant` | optional. The named response it answered with (`empty`, `locked`) |
| `outcome` | `'ok'`, `'error'`, `'slow'` or `'hang'` |
| `at` | `Date.now()` when it was called |

`window.__mockEndpoints`, `{ key, variants }[]`, optional, is the inventory:
endpoints no flow called show in the report, dimmed.

`spare` the mock's control endpoints and whatever every page needs to render
at all (translations, feature flags): failing those makes every page fail the
same way and drowns everything else.

## The report

`tmp/bombadil/report/`, a folder that stands alone (a CI artifact):

| file | for |
|---|---|
| `index.html` | people. Self-contained, opens from `file://`. Repo → project → finding. |
| `findings.ndjson` | agents. One finding per line, `bombadil-report/v1`. |
| `report.json` | agents and the page: summary, projects (property matrix, route coverage, API coverage, sweep history), findings. |
| `state.json` | the history every report is derived from. Keep it between runs. |
| `coverage.json` | per flow, the source files it rendered (`bombadil-coverage/v1`). |
| `evidence/<id>/` | the last screenshots before each finding's latest violation. |

A **finding** is one bug, not one violation. Its id hashes project, property,
route and the first line the violation carried (a request, a console
message), digits blurred, so repeats land on the same id.

A **sweep** is one report build: every run it hasn't seen yet. `run` builds
once per invocation, so all its flows are one sweep.

| status | means |
|---|---|
| `new` | seen in the latest sweep and never before |
| `open` | seen in the latest sweep and an earlier one |
| `quiet` | not seen since, in sweeps that reached its route |
| `closed` | not seen in 3 sweeps in a row that reached its route |

A sweep that didn't reach a finding's route says nothing about it. Delete
`state.json` to start over. `routes.json` beside a spec lists the app's route
patterns (`/orders/:id`), so URLs group by route and unreached routes show;
without it, ids in URLs are blurred to `:id` and `:n`.

**API coverage** (the coverage tab, beside routes; `report.json`'s
`projects[].api`) lists each mock endpoint with its calls by outcome, the
variants seen of those known, and the flows that called it, summed over every
sweep. Endpoints in the inventory that nothing called are dimmed. It shows
only for projects whose spec calls `apiCalls()`.

For agents:

```bash
jq -c 'select(.status=="new" or .status=="open")' tmp/bombadil/report/findings.ndjson
jq '.findings[] | select(.id=="F-281275") | .repro' tmp/bombadil/report/report.json
```

Each finding has `repro.steps` (the last actions before the violation),
`repro.command` (rerun from the repo root), `snapshots` (what the property
saw), `evidence.frames`, and `evidence.inspect` (Bombadil's viewer on the
whole run).

## Diff-aware fuzzing

`appRenders` walks React's fiber tree each state and records which source
files are on screen (dev builds only: `_debugSource` up to React 18, the
`_debugStack` Vite URL from 19). The report unions them per flow into
`coverage.json`, and `affected` turns a diff into flows:

```bash
npx bombadil-kit affected                      # vs origin/main: flows on stdout, reasons on stderr
npx bombadil-kit affected --json
npx bombadil-kit affected --files a.tsx,b.ts --coverage nightly/coverage.json
```

- A changed file a flow rendered picks that flow.
- A file that renders nothing (a hook, a store slice, CSS, an image) climbs
  the import graph from `affected.entry` to the nearest rendered files.
- The climb stops at `affected.routers` (the route table imports every page
  but renders one). A file only the router leads to is reported as reached by
  no flow: that's a flow to add.
- The fuzzer's own files, `bombadil-kit.json`, lockfiles and
  `affected.always` pick every flow; so does a missing coverage map, and a
  flow the map doesn't know yet.

`templates/github/fuzz.yml` wires it up: nightly on main, every flow, uploads
the report as the baseline; on a pull request, the affected flows (about 12
minutes in all), `--baseline` the nightly's `state.json`, and fail on new
findings.

## Develop

```bash
npm test           # node --test
npm run typecheck  # the CLI, and the spec library against Bombadil's types
npm run build      # dist/, what the bin runs (dist/cli.js executable)
```

`examples/shop/` is a small React + RTK Query app integrated with the kit,
with a planted bug per property (`VITE_PLANT`). `node check.mjs` there runs a
sweep and checks its report: the app as it is finds nothing, each plant is
caught by its property. CI runs every case (`.github/workflows/example.yml`).
A new property gets a plant in the same PR.

Fonts: Rajdhani and JetBrains Mono, Latin subsets from @fontsource, OFL
(`fonts/`), embedded in the report so it looks the same wherever it's opened.
