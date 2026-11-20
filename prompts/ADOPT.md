# Adopt bombadil-kit in a repo that already runs Bombadil

The repo has its own Bombadil setup: specs, properties, a script, maybe a
report or CI. The goal is to move it onto bombadil-kit **without losing
anything it does better**. Whatever it has that the kit lacks either moves
into the kit (so every repo gets it) or stays in the repo as app-specific.

Nothing gets deleted until the person has approved the comparison in step 2.

## 1. Inventory the existing setup

Read all of it: every spec and property file, every action and custom action,
scripts that start the app or run Bombadil, mock-mode switches, fault or seed
handling, CI workflows, anything that reads Bombadil's output (reports,
dashboards, notifications), docs, and the git log of those files (what was
added after a problem, and why). Run it once as it is and keep the output:
it's the baseline to compare against.

List each capability as one line: what it does, where it lives, and how
specific to this app it is. Things to look for, at least:

- properties (generic: crashes, leaks, layout; domain: business rules);
- actions and their weights; custom actions (form filling, pickers, uploads,
  drag and drop); anything that keeps the fuzzer on a path or off one;
- how runs start: URLs, sign-in, fixtures, seeds, viewport, time limits;
- the app side: fault injection, seeded data, console handling, test hooks;
- output: what's kept per run, how findings are grouped, deduplicated,
  tracked over time, shown, and handed to agents or CI;
- CI: when it runs, what it gates, what it uploads, what it costs.

## 2. Compare, and stop for the person

Make one table, a row per capability from step 1, and a row per kit feature
the repo doesn't have:

| capability | existing | bombadil-kit | verdict |
|---|---|---|---|
| failed writes shown | `errorToast` property, checks `.toast-error` within 3s | `failedWritesShown({ errorSelector })` | kit, `errorSelector: '.toast-error', within: 3` |
| upload action | `uploadFile` custom action | none | **into the kit**: generic |
| refund rule | `refundNeverExceedsTotal` | none | stays, app-specific |
| report | JSON summary to Slack | HTML + NDJSON, statuses | kit; Slack post: **(ask)** |

Verdicts: `kit` (the kit covers it; say with what settings), `into the kit`
(generic and missing from the kit: it moves there), `stays` (app-specific,
lives in the repo's `bombadil/`), `drop` (say why: superseded, dead, wrong).
Be specific where they differ: a kit property that checks less than the old
one is a regression unless the old check was wrong.

Show the person the table and wait. Their answer decides step 3.

## 3. Upstream what moves into the kit

For each `into the kit` row: a change to github.com/rubysolo/bombadil-kit
(properties and actions in `spec/index.ts`, with the name added to
`PROPERTY_FACTORIES` if it's a property; a test; a line in the README),
opened as a PR or written up as an issue if you can't. Until it's released,
keep the repo's version where the repo's spec can import it, with a comment
pointing at the kit PR.

## 4. Switch over

Follow [INTEGRATE.md](INTEGRATE.md) from step 1, using the table:

- config from what the old script did (server command, env, port, viewport,
  sign-in cookie);
- properties: kit factories with the settings the table gave, plus the
  `stays` ones. Keep the old export names where a property carries over, so
  the person recognises them in the report;
- the app side: replace the repo's fault/seed/console code with
  `bombadil-kit/rtk`, `/faults`, `/faker`, `/console` where they do the same
  job, keeping anything they don't (an extra fault shape, a spared path);
- flows from the old start URLs and sign-in, then [FLOWS.md](FLOWS.md);
- CI from the template, keeping the old job's triggers and budget unless the
  person said otherwise.

## 5. Prove nothing was lost

Run the old setup and the new one with the same seed, faults and time, on
the same commit, and compare: properties evaluated, routes reached, findings.
Every old finding should show up in the new report, or have a reason in the
table (a property dropped on purpose). Then remove the old setup, in the same
PR as the switch.

## 6. Hand over

The table, what moved into the kit (with links), the before/after comparison,
and the new report's findings.
