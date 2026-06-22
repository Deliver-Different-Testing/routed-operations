# RouteBuilder

This repo is the active GitHub workspace for the RouteBuilder rebuild.

## What is in here

- the current rebuilt UI/application snapshot that had been living in the older `runbuilder` GitHub repo
- the v2 backend/frontend scaffold under `v2/`
- the current RouteBuilder scoping and parity-lift docs
- the updated legacy-parity handover:
  - `docs/HANDOVER-KEVIN-ROUTEBUILDER-REBUILD-2026-06-14.md`

## Key implementation docs

- [Consolidated handover](docs/RUNBUILDER-REBUILD-TO-ROUTEBUILDER-CONSOLIDATED-2026-06-20.md)
- [Parity lift plan (SPs → application layer)](docs/STEVE-ROUTEBUILDER-V2-PARITY-LIFT-PLAN-KEVIN-2026-06-20.md)
- [Dynamic mode plan](docs/ROUTEBUILDER-DYNAMIC-PLAN-2026-06-22.md)
- [Stage 1 parity build plan](docs/ROUTEBUILDER-STAGE1-RUNBUILDER-PARITY-BUILD-PLAN-2026-06-20.md)

## Legacy reference

The untouched legacy source-of-truth repo is:

`https://git.customd.com/urgent-couriers/runbuilder.git`

That repo stays as the reference for current behaviour.

## Intent

- `runbuilder` on GitLab = legacy reference
- `routebuilder` on GitHub = active rebuild repo Kevin can clone back into GitLab for implementation work
