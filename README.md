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
npm i -D bombadil-kit@github:rubysolo/bombadil-kit#v0.1.0 @antithesishq/bombadil@0.7.10 esbuild
```

Node 22.18 or later. Bombadil finds Chrome by itself, or through `$CHROME`.

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

| factory | holds when |
|---|---|
| `errorBoundaryNeverShown(selector)` | the error boundary's fallback never shows |
| `spinnersClear({ selector, within })` | a visible loading indicator clears within 15s |
| `noLeakedText(pattern?)` | no `undefined`, `NaN`, `[object Object]`, `Invalid Date`, `null` in the text |
| `noSidewaysScroll(tolerance?)` | the page never scrolls horizontally |
| `failedWritesShown({ quiet, errorSelector, within })` | a write the fault injector failed is followed by a visible error within 5s |
| `consoleQuietUnlessFaulted(grace?)` | no console error, except within 5s of an injected fault |
| `nothingUnder({ selector, container })` | no text is drawn over, say, a floating header's logo |
| `appRenders({ root, within })` | something renders within 10s; also records rendered files |

| action | does |
|---|---|
| `formActions` | `fillPlausible` (realistic values by field type, name and autocomplete) and `pickOption` (native selects) |
| `pageClicks({ exclude })` | Bombadil's clicks, minus anything inside `exclude` (default `header`) |
| `forwardClicks({ label, exclude })` | only Next / Save / Submit / Pay / … buttons, to weight a workflow forward |
| `fenced(generator)` | `generator`, or only Back outside the flow's fence |

`failedWritesShown` and `consoleQuietUnlessFaulted` read `window.__mockFaults`,
which the app's fault injector fills (below).

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
| `bombadil-kit/rtk` | `VITE_MOCK_FAULT_RATE`, `_SEED` | `withFaults(baseQuery, env, { spare, onFault })`: fails that share of requests as 500, 503, 422, network error or timeout, chosen by a seeded PRNG; returns `baseQuery` itself when off |
| `bombadil-kit/faults` | same | `createFaultInjector`, for mock layers other than RTK Query; both log to `window.__mockFaults` |
| `bombadil-kit/faker` | `VITE_MOCK_SEED`, `VITE_MOCK_REF_DATE` | seeds the app's faker and its reference date; `mockRandom`/`mockNow` for the rest of the mock layer |
| `bombadil-kit/console` | `VITE_FUZZ` | each `console.error` becomes one string with the source lines that raised it (Bombadil records only the first argument) |

`spare` the mock's control endpoints and whatever every page needs to render
at all (translations, feature flags): failing those makes every page fail the
same way and drowns everything else.

## The report

`tmp/bombadil/report/`, a folder that stands alone (a CI artifact):

| file | for |
|---|---|
| `index.html` | people. Self-contained, opens from `file://`. Repo → project → finding. |
| `findings.ndjson` | agents. One finding per line, `bombadil-report/v1`. |
| `report.json` | agents and the page: summary, projects (property matrix, route coverage, sweep history), findings. |
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
npm run build      # dist/, what the bin runs
```

Fonts: Rajdhani and JetBrains Mono, Latin subsets from @fontsource, OFL
(`fonts/`), embedded in the report so it looks the same wherever it's opened.
