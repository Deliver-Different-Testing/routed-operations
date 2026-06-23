# Routed Operations

This repo is the forward workspace for the **Routed Operations** rebuild.

## Current product shape

- **Umbrella product:** Routed Operations
- **Release 1 / first module:** Route Builder
- **Existing apps retained in early stages:** Bulk Uploader, Route Viewer

## What is in here

- the current rebuilt UI/application snapshot that had been living in the RouteBuilder workspace
- the v2 backend/frontend scaffold under `v2/`
- the current Routed Operations scoping, parity, and handover docs
- the updated Kevin-forward handover:
  - `docs/HANDOVER-KEVIN-ROUTED-OPERATIONS-2026-06-23.md`

## Key implementation docs

- [Kevin handover](docs/HANDOVER-KEVIN-ROUTED-OPERATIONS-2026-06-23.md)
- [Consolidated handover](docs/RUNBUILDER-REBUILD-TO-ROUTEBUILDER-CONSOLIDATED-2026-06-20.md)
- [Parity lift plan (SPs → application layer)](docs/STEVE-ROUTEBUILDER-V2-PARITY-LIFT-PLAN-KEVIN-2026-06-20.md)
- [Dynamic mode plan](docs/ROUTEBUILDER-DYNAMIC-PLAN-2026-06-22.md)
- [Stage 1 parity build plan](docs/ROUTEBUILDER-STAGE1-RUNBUILDER-PARITY-BUILD-PLAN-2026-06-20.md)

## Legacy reference

The untouched legacy source-of-truth repo is:

`https://git.customd.com/urgent-couriers/runbuilder.git`

That repo stays as the reference for current behaviour.

## Naming rule

- `Routed Operations` = umbrella product / repo direction
- `Route Builder` = first release module
- `RunBuilder` = legacy app being replaced
