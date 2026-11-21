# bombadil-kit, for agents

You're integrating bombadil-kit into a repo, or working on it. Read
[README.md](README.md) for what each piece does, then pick a prompt:

| the repo | follow |
|---|---|
| has no Bombadil setup | [prompts/INTEGRATE.md](prompts/INTEGRATE.md) |
| already runs Bombadil (specs, scripts, CI, a report of its own) | [prompts/ADOPT.md](prompts/ADOPT.md): inventory and compare **before** changing anything |
| is integrated, and needs flows (or more of them) | [prompts/FLOWS.md](prompts/FLOWS.md) |

Installed as a dependency, this file and the prompts are at
`node_modules/bombadil-kit/`.

## Ground rules

- **Mock first.** The kit fuzzes the app against its mock API with injected
  faults. If the app has no mock mode, stop and say so: building one is a
  project of its own, and the person should decide on it.
- **Don't fork the kit inside the repo.** If the repo needs something the kit
  lacks (a property, an action, a report field, a config option) and it isn't
  specific to that app, it belongs in the kit: write it up as a change to
  bombadil-kit (an issue, or a PR to github.com/rubysolo/bombadil-kit) and
  keep a local version only until that lands. App-specific properties
  (domain rules: "an order total is never negative") belong in the app's
  `bombadil/properties.ts`.
- **Prove it on the real app.** A step isn't done until a sweep ran it:
  `npx bombadil-kit run --time 30s`, then read the report
  (`tmp/bombadil/report/report.json`), not just the exit code. A property that
  never fires and a property that can't fire look the same from the outside;
  break the app on purpose once to see each new property catch it.
- **Working on the kit itself?** The real app is `examples/shop/`: `node
  check.mjs --all` there. A new property gets a plant (`plants.json`).
- **Findings aren't failures of the integration.** The first sweeps find real
  bugs. List them for the person; don't fix app bugs as part of the
  integration unless asked.
- Exit codes: `run` gives 0 clean, 2 property violation, 1 anything else.
- In anything Bombadil bundles (`spec/`, an app's `bombadil/*.ts`), don't
  both import a name and `export { name } from` the same module: the bundle
  declares it twice and the spec won't load ("Identifier 'name' has already
  been declared"). Import it, then `export { name }`.

## Package layout

```text
spec/index.ts      bombadil-kit/spec: properties + actions (TypeScript; Bombadil bundles it)
src/app/           bombadil-kit/faults, /rtk, /faker, /console: imported by the app in fuzz mode
src/runner/        bombadil-kit run
src/report/        the report generator
src/affected/      diff → flows
src/cli.ts         the bombadil-kit command
templates/         bombadil-kit.json, bombadil/ (specs, flows, routes), github/fuzz.yml
prompts/           the prompts above
examples/shop/     an app integrated with the kit, a planted bug per property; check.mjs proves both ways
```
