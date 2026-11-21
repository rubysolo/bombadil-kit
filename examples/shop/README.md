# example shop

A small React 18 + Vite + RTK Query shop on a mock API, integrated with
bombadil-kit the way [prompts/INTEGRATE.md](../../prompts/INTEGRATE.md) says.
It's the kit's proof on a real app, both ways: a sweep of the app as it is
finds nothing, and each planted bug is caught by the property meant to catch
it. CI (`.github/workflows/example.yml`) runs both on every kit change.

```bash
npm ci && npm run build            # the kit, at the repo root
cd examples/shop && npm ci
node check.mjs                     # clean sweep: must find nothing
node check.mjs leak                # one planted bug: its property must fire
node check.mjs --all               # both, every plant
npx bombadil-kit run               # a plain sweep; report in tmp/bombadil/report/
```

`check.mjs` reads `tmp/bombadil/report/report.json`, not just the exit code.
`TIME` and `SEED` override the sweep's (30s, seed 1).

| file | |
|---|---|
| `src/mock.ts` | the mock API: seeded faker data (`seedFaker`), an RTK Query baseQuery |
| `src/api.ts` | the API slice, its baseQuery wrapped in `withFaults` |
| `src/main.tsx` | `installFuzzConsole` in fuzz mode |
| `src/plant.ts` | `planted(name)`: on when `VITE_PLANT` lists it |
| `bombadil/` | specs, every kit property (`properties.ts`), flows, routes |
| `plants.json` | plant → the property that must catch it, the flow, `faults` if it needs them |

## Planted bugs

| plant | bug | caught by |
|---|---|---|
| `crash` | the product page throws while rendering | `errorBoundaryNeverShown` |
| `spinner` | the cart's spinner never clears | `spinnersClear` |
| `leak` | the price shows `undefined` | `noLeakedText` |
| `overflow` | the product list is 1200px wide | `noSidewaysScroll` |
| `silent-write` | a failed add-to-cart shows nothing | `failedWritesShown` |
| `noisy` | list items without keys: React warns | `consoleQuietUnlessFaulted` |
| `overlap` | a fixed promo line sits over the logo | `nothingUnder` |
| `blank` | the app never mounts | `appRenders` |
| `empty` | the cart renders nothing past the header | `noBlankPage` |
| `throw` | the add-to-cart handler throws | Bombadil's `noUncaughtExceptions` |
| `reject` | a failed add-to-cart is never caught | Bombadil's `noUnhandledPromiseRejections` |

A new property gets a plant here, in the same PR, so it's proven able to fire.
A plant with `known` in `plants.json` is a gap in the kit, written down: its
property can't reliably catch it yet, so the check reports whether it fired
and never fails. Drop the note once the kit closes the gap.
Plants run without faults unless `plants.json` says otherwise: a fault
nearby can excuse what's planted.

The kit is linked from the repo root (`file:../..`); `preserveSymlinks` (in
`tsconfig.json` and `vite.config.ts`) resolves its peers from this app, as an
installed copy would.
