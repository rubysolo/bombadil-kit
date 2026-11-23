# bombadil-kit

Fuzzing a web app against its mock API with injected faults, and reporting
what breaks as findings that keep their identity across sweeps.

## Naming paths

**Record segment**:
A path segment that names a record rather than a place in the app: `1187`,
`ORD12345`, `TEST-BASIC-ORDER`, a UUID. Shown as `:id`. `oauth2`, `v2` and
`API` are not record segments.
_Avoid_: id segment, token

**Path template**:
A path with its varying segments as placeholders (`/orders/:orderNumber`),
standing for every concrete path it matches. Taken from the app's lists when
one matches, else made by turning record segments into `:id`.
_Avoid_: pattern, blurred path

**Route**:
The path template of a page the walker visits. The app's routes are listed in
`routes.json`.
_Avoid_: page URL, screen

**Endpoint**:
A mocked request named as `METHOD` plus a path template
(`POST /orders/:orderNumber/design_requests`). A finding and API coverage
name the same endpoint the same way.
_Avoid_: request pattern, call key

**Inventory**:
The endpoints the mock says it has (`window.__mockEndpoints`), including
ones no flow called.
_Avoid_: endpoint list, API list
