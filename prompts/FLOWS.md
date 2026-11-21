# Derive flows for an app

A random walk from the sign-in page rarely gets deep: each step competes with
Back, reload, footer links and refilling a form, so a workflow five correct
steps long almost never completes. A flow starts the fuzzer where a workflow
starts and fences it in, so its whole time budget goes on that workflow.

## What a flow is

```json
{
  "name": "checkout",
  "about": "Cart to order confirmation.",
  "start": "/cart",
  "allow": ["/cart*", "/checkout*", "/orders/*"],
  "signedIn": true,
  "spec": "flow"
}
```

`start` is a URL the app can load directly (deep link) in a state where the
workflow is possible. `allow` lists where it may go: exact paths, or prefixes
ending in `*`. Outside them the fuzzer's only move is Back. `signedIn` starts
with the project's `signedInCookie`. `spec` is the spec file: `spec` for the
unfenced explore, `flow` (header-free clicks, forward weighting, the fence)
for the rest.

## Finding them

1. **Read the route table** (`App.tsx`, `routes.tsx`, the router config). Group
   routes into workflows: the steps a user takes to get one thing done
   (start an order, pay, edit a profile). Write `routes.json` while you're
   there.
2. **Find the fixtures.** A workflow deep in an order needs an order in the
   right state. Look in the mock layer for fixtures (`TEST-*` ids, seed data);
   use one per flow. If a state has no fixture, add one to the mock data
   **(ask if the mock data is shared with e2e tests)**.
3. **Signed in.** Most workflows need a session. The app has to accept one
   set before it loads, in mock mode: a cookie it reads at boot, which the mock
   API answers as a typical user. If it can't, that's the first thing to add
   (a few lines in the auth bootstrap, mock mode only).
4. **Fence tightly, then loosen.** `allow` the workflow's own paths, with
   `*` where ids or sub-steps follow. Run it (`--flow <name> --time 1m
   --headed`) and watch: if it keeps hitting Back at the edge of the fence, the
   workflow goes further than you fenced; if it wanders, tighten.
5. **One explore flow** stays: signed out, unfenced, from the sign-in page.
   It covers sign-up, sign-in and password reset, and what the others miss.

## Is it working

After a sweep, in `report.json` per project:

- `routes`: which routes each flow reached. A flow should reach its
  workflow's last step in a minute or two; if it doesn't, see below.
- the "never reached" list: routes no flow gets to. Each is a flow to add or
  a fence to widen.
- `coverage.json`: the source files each flow rendered. A page you expected
  and don't see wasn't reached.
- `milestones`: whether each flow *completed* its workflow, not just reached
  its pages. Give each flow a milestone for its last step (the confirmation
  shows, the saved values are on screen): `milestones({ … })` in the spec,
  its names in the flow's `milestones`. One in `missed` is a flow that
  reached the page and never finished there; see below.

When a flow stalls on a step:

- a form it can't fill: `fillPlausible` guesses by input type, name,
  placeholder and autocomplete. Give the field a proper `autocomplete` or
  `name` (good for real users too), or add an app-specific custom action.
- a button it doesn't press: `forwardClicks` weights buttons whose label
  starts with Next, Continue, Save, Submit, Pay, … (`FORWARD`); pass a
  `label` regex with the app's words.
- a control Bombadil can't drive (a custom picker, drag and drop, a file
  upload): a custom action in the app's spec; if it's generic, propose it for
  the kit.
- a fixture in the wrong state: fix the fixture.

Keep flows to the app's real workflows, ten or so for a mid-sized app. Each
costs a minute or more per sweep, and in CI the pull-request budget is split
across the flows a change touches.
