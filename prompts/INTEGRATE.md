# Integrate bombadil-kit into a repo

Goal: the repo's web app is fuzzed by Bombadil on its mock API with injected
faults, through a few flows, with a report, and a CI job that fuzzes what a
pull request touches. Work in this order; each step ends with a sweep that
proves it. Ask the person before steps marked **(ask)**.

## 0. Look first

Find out, and write down for the person in a few lines:

- the app(s): framework (React? version), bundler (Vite?), where `main.tsx`
  and the route table are;
- the mock API: how it's switched on (an env var?), what it's built on (RTK
  Query baseQuery, MSW, a fetch wrapper), where random data comes from (faker?);
- how a session works: a token in a cookie, localStorage, a header? Can the
  app start signed in from something set before it loads?
- the package manager and Node version; existing e2e tests (Playwright?); CI
  (GitHub Actions? self-hosted runners? containers?).

If there's no mock mode, stop here: see AGENTS.md.

## 1. Install and configure

```bash
npm i -D https://github.com/rubysolo/bombadil-kit/releases/download/<tag>/bombadil-kit-<version>.tgz \
  @antithesishq/bombadil@0.7.10 esbuild
```

Copy `templates/bombadil-kit.json` to the repo root and fill it in: the app's
`dir`, the dev server `command`, the env that turns the mock API on, `port`.
Leave `flows` out for now (one `explore` flow from `/`). Copy
`templates/bombadil/properties.ts`, `spec.ts` and `tsconfig.json` into
`<dir>/bombadil/`.

Add `tmp/` (or the config's `out`) to `.gitignore`. Add a script:
`"fuzz": "bombadil-kit run"`.

Check: `npx bombadil-kit run --time 30s --faults 0` exits 0 or 2, and
`tmp/bombadil/report/index.html` opens. If `appRenders` fires on every state,
the coverage walk found nothing: check `root` (`#root`?), that it's a dev
build, and the React version (see README, Diff-aware fuzzing).

## 2. Wire the app's fuzz mode

In the app, behind the env vars `bombadil-kit.json` sets:

- **Faults.** RTK Query: wrap the mock baseQuery,
  `withFaults(mockBaseQuery, import.meta.env, { spare: [...] })` from
  `bombadil-kit/rtk`. Anything else: call `createFaultInjector` from
  `bombadil-kit/faults` once per mocked request and answer with its fault in
  the shape the real client produces. `spare` the mock's control endpoints
  and anything every page needs to render at all (translations, feature
  flags), or every page fails the same way and drowns everything else.
- **Seeded data.** faker: `seedFaker(faker, import.meta.env)` from
  `bombadil-kit/faker`, imported before any mock data is built; route the
  mock layer's other `Math.random()` and `Date.now()` calls through its
  `mockRandom`/`mockNow`. Same seed and ref date, same data.
- **Console.** `if (import.meta.env.VITE_FUZZ === 'true') installFuzzConsole()`
  from `bombadil-kit/console`, early in `main.tsx`.
- **Latency.** If the mock layer has a delay, read it from the env too
  (`{latency}`), 50 ms is a good fuzzing default.

Unit-test the wiring the way the repo tests things (the fault wrapper is
off without the env var; the seed makes data repeat).

Check: a sweep with `--faults 0.3` shows `failedWritesAreShown` and
`noConsoleErrorsUnlessFaulted` evaluating (open `report.json`: the properties
are listed, and a fault-related finding or two is likely).

## 3. Tune the properties

Go through `<dir>/bombadil/properties.ts` with the app's markup open:

- `errorBoundaryNeverShown`: the selector of the app's error-boundary fallback.
  No error boundary? Delete it, and tell the person (**ask** whether to add one).
- `spinnersClear`: the app's loading indicator selector.
- `failedWritesShown`: how the app shows an error (`errorSelector`), and the
  writes that fail silently on purpose (`quiet`, each with a comment saying why).
- `nothingUnder`: only if a header or button floats over content; else delete.
- App-specific invariants the person cares about: suggest two or three from
  the domain, **(ask)** before adding.

For each property you keep: break the app on purpose once (a thrown render,
a spinner that never stops) and see the property catch it. Then undo.

## 4. Flows

Follow [FLOWS.md](FLOWS.md). Start with `explore` plus two or three flows for
the workflows that matter most.

## 5. Routes

`<dir>/bombadil/routes.json`: the app's route patterns, from its route table
(`/orders/:id`). The report groups URLs by them and lists the ones never
reached, which is how you find the next flow.

## 6. CI **(ask)**

Copy `templates/github/fuzz.yml` and adjust: paths, Node version file,
runner, the Playwright image version. Keep it out of required checks. The
first PR run has no nightly to compare against: it runs every flow and gates
nothing; trigger the nightly once by hand (`workflow_dispatch` on main) after
merge.

Fill in `affected` in `bombadil-kit.json` (`entry`, `routers`, `always`) and
check it on a few files:

```bash
npx bombadil-kit affected --files <a page>,<a util>,<a stylesheet>,<the router>
```

A page picks the flows that render it, a util the flows of the pages that
import it, global CSS every flow; a page no flow reaches is listed as such.

## 7. Hand over

Tell the person: what's wired where, the flows, the first sweep's findings
(id, property, route, one line each), anything you deleted or left out and
why, and what you'd add next.
