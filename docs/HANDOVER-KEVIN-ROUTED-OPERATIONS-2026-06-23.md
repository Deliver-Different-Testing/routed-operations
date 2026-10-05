---
title: Routed Operations — Kevin handover
date: 2026-06-23
audience: Kevin / Steve
status: Active handover brief
current_workspace_path: /data/.openclaw/workspace/routed-operations
target_repo_name: routed-operations
related_docs:
  - STEVE-RUNBUILDER-V2-SCOPING-2026-06-13.md
  - ROUTEBUILDER-STAGE1-RUNBUILDER-PARITY-BUILD-PLAN-2026-06-20.md
  - RUNBUILDER-REBUILD-TO-ROUTEBUILDER-CONSOLIDATED-2026-06-20.md
---

# Routed Operations — Kevin handover

## Claude Code steps

```bash
cd /data/.openclaw/workspace/routed-operations
ls -la docs/STEVE-RUNBUILDER-V2-SCOPING-2026-06-13.md
ls -la docs/ROUTEBUILDER-STAGE1-RUNBUILDER-PARITY-BUILD-PLAN-2026-06-20.md
ls -la docs/RUNBUILDER-REBUILD-TO-ROUTEBUILDER-CONSOLIDATED-2026-06-20.md
ls -la docs/HANDOVER-KEVIN-ROUTED-OPERATIONS-2026-06-23.md
ls -la Controllers/JobController.cs
ls -la Controllers/RouteController.cs
ls -la Models/Repository/JobRepository.cs
ls -la Models/Repository/RouteRepository.cs
ls -la wwwroot/app/components/home/homeControl.js
ls -la wwwroot/app/components/home/tpls/pickDateForm.tpl
```

## Table of contents

1. [Feature overview](#feature-overview)
2. [Architecture: what's built vs what developer needs to do](#architecture-whats-built-vs-what-developer-needs-to-do)
3. [Step-by-step checklist](#step-by-step-checklist)
4. [Database tables](#database-tables)
5. [Key questions answered](#key-questions-answered)
6. [API endpoints summary](#api-endpoints-summary)
7. [Frontend components](#frontend-components)
8. [Testing checklist](#testing-checklist)

## Feature overview

- **Routed Operations** is now the umbrella product direction for routed-work operations.
- **Route Builder** is the **first release module** and the immediate build priority.
- Existing **Bulk Uploader** and **Route Viewer** stay live in the early release stages and are **not** part of the first rebuild cut.
- Phase 1 is still a rebuild of the current legacy **RunBuilder** operational workflow into the new React + .NET application shape.
- The objective is to get the real dispatcher workflow working end-to-end before folding the other routed-work surfaces into the same product.

## Architecture: what's built vs what developer needs to do

### ✅ Already built / already decided

| Area | File / source | Status |
|---|---|---|
| Product naming direction | `docs/STEVE-RUNBUILDER-V2-SCOPING-2026-06-13.md` | Updated to `Routed Operations` umbrella + `Route Builder` first release |
| Stage 1 scope | `docs/ROUTEBUILDER-STAGE1-RUNBUILDER-PARITY-BUILD-PLAN-2026-06-20.md` | Updated to keep existing Bulk Uploader / Route Viewer in place for early stages |
| Canonical rebuild brief | `docs/RUNBUILDER-REBUILD-TO-ROUTEBUILDER-CONSOLIDATED-2026-06-20.md` | Updated with Routed Operations framing |
| Legacy operational reference | `Controllers/JobController.cs`, `Controllers/RouteController.cs`, `Models/Repository/JobRepository.cs`, `wwwroot/app/components/home/homeControl.js` | Existing behaviour source of truth |
| First release module decision | Steve direction 2026-06-23 | `Route Builder` first |
| Other phase-1 surface decision | Steve direction 2026-06-23 | Existing `Bulk Uploader` + `Route Viewer` remain in service |

### 🔧 What Kevin needs to do

| # | Priority | Est. | Task |
|---|---|---:|---|
| 1 | P1 | 1h | Adopt **Routed Operations** as the rebuild repo / project naming direction for forward work |
| 2 | P1 | 1h | Keep **Route Builder** as the first release app/module name in code and UI |
| 3 | P1 | 8-20h | Finish Stage 1 Route Builder parity work in the new React UI (`RoutesPage`, jobs, runs, assignment, routing, lock/save, send live) |
| 4 | P1 | 2-4h | Make sure Route Builder reads/writes cleanly alongside the existing Bulk Uploader and Route Viewer flows rather than trying to replace them immediately |
| 5 | P2 | 2-6h | Update any remaining Kevin-facing repo docs, branch names, or project labels to use `Routed Operations` for the umbrella product |
| 6 | P2 | Later | Plan the later fold-in of Bulk Uploader into Routed Operations |
| 7 | P2 | Later | Plan the later fold-in of Route Viewer into Routed Operations |

## Step-by-step checklist

1. **Use Routed Operations as the top-level product / repo direction**
   - Files to align:
     - `docs/STEVE-RUNBUILDER-V2-SCOPING-2026-06-13.md`
     - `docs/ROUTEBUILDER-STAGE1-RUNBUILDER-PARITY-BUILD-PLAN-2026-06-20.md`
     - `docs/RUNBUILDER-REBUILD-TO-ROUTEBUILDER-CONSOLIDATED-2026-06-20.md`
   - Rule:
     - `Routed Operations` = umbrella product / repo direction
     - `Route Builder` = first release module
     - `RunBuilder` = legacy app being replaced

2. **Do not widen Stage 1 to include rebuilding Bulk Uploader or Route Viewer**
   - Existing apps remain in service in early stages.
   - Route Builder must integrate with the current flow rather than absorbing those apps immediately.
   - This is a scope-control decision, not a technical limitation.

3. **Ship Route Builder parity first**
   - Core legacy files to preserve behaviour from:
     - `Controllers/JobController.cs`
     - `Controllers/RouteController.cs`
     - `Models/Repository/JobRepository.cs`
     - `Models/Repository/RouteRepository.cs`
     - `wwwroot/app/components/home/homeControl.js`
     - `wwwroot/app/components/home/homeService.js`
   - Minimum parity flow:
     1. choose run date
     2. load jobs and runs
     3. filter by legacy dimensions
     4. build / edit runs
     5. assign jobs to runs
     6. route / sequence
     7. assign courier
     8. lock / save
     9. send live / dispatch

4. **Retain the real data surfaces**
   - Reads must continue to understand the legacy route-building data model:
     - `tblBulkJob`
     - `tblBulkRun`
     - `tblBulkJobRun`
     - `tblBulkRunSetting`
   - The rebuild direction must also surface:
     - `tucJob`
     - `tucJobBooking`
   - No new naming-only database migration is required for this scope change.

5. **Keep route-building settings in the Route Builder UI, not in the other apps**
   - Route method, locking, timing constraints, and run-save/send controls belong in Route Builder.
   - Bulk import concerns stay in Bulk Uploader for Stage 1.
   - view/inspect concerns stay in Route Viewer for Stage 1.

6. **Do not create placeholder consolidation code just to honour the new name**
   - No fake merged shell.
   - No dead nav items implying Bulk Uploader / Route Viewer already moved.
   - Name the product correctly, but keep the release boundary honest.

## Database tables

### Current read/write tables for Route Builder parity

| Table | Purpose | Stage 1 expectation |
|---|---|---|
| `tblBulkJob` | Legacy uncommitted / builder-side jobs | Read/write during parity |
| `tblBulkRun` | Legacy draft / built runs | Read/write during parity |
| `tblBulkJobRun` | Join between bulk jobs and runs | Read/write during parity |
| `tblBulkRunSetting` | Legacy run-builder settings | Read / update where needed |
| `tucJob` | Live operational jobs | Read in unified candidate-job model; later deeper dynamic-mode use |
| `tucJobBooking` | Booking-side jobs not yet promoted / booking flow records | Read in unified candidate-job model |
| `tucCourier` | Courier assignment source | Read for assignment |
| `tucFleet` | Fleet grouping / courier context | Read for assignment filters |

### Naming-change migration note

No SQL migration is required just to move the product name from RouteBuilder-forward-planning to Routed Operations.

This is a **scope + naming + handover correction**, not a schema change.

## Key questions answered

### Can we reuse the existing Bulk Uploader and Route Viewer or is new code required now?

**Reuse them for Stage 1.**

They stay as the working operational surfaces in the first release stages. Kevin should not rebuild them yet just because the umbrella product is now called Routed Operations.

### What tables does Route Builder read from / write to in Stage 1?

Primarily:
- `tblBulkJob`
- `tblBulkRun`
- `tblBulkJobRun`
- `tblBulkRunSetting`
- plus read surfaces from `tucJob`, `tucJobBooking`, `tucCourier`, `tucFleet`

### Are there triggers / side effects to watch for?

Yes.

- Legacy send-live / dispatch behaviour likely has side effects through existing stored procedure paths.
- `UTL_stpJob_InsertFromRunBuilder` and surrounding live-flow logic must be treated carefully during parity replacement.
- Naming the product `Routed Operations` does **not** reduce the need to preserve the actual legacy run-building lifecycle.

### Does Kevin need to rename every historical file right now?

No.

He should:
- use `Routed Operations` for the forward product / repo direction
- keep `Route Builder` as the first release module name
- avoid wasting time on cosmetic churn that delays parity

## API endpoints summary

### Stage 1 Route Builder surface

| Method | Route | Purpose | Tables read | Tables written |
|---|---|---|---|---|
| GET | `/api/jobs` | Candidate jobs / filtered working set | `tblBulkJob`, `tucJob`, `tucJobBooking` | — |
| GET | `/api/jobs/groups` | Grouped jobs working set | `tblBulkJob`, `tucJob`, `tucJobBooking` | — |
| GET | `/api/runs` | Runs for selected day / filter | `tblBulkRun`, `tblBulkJobRun`, `tucCourier` | — |
| POST | `/api/runs` | Create / update run | `tblBulkJob`, `tblBulkRun` | `tblBulkRun` |
| POST | `/api/runs/{id}/jobs` | Assign jobs into run | `tblBulkJob`, `tblBulkRun` | `tblBulkJobRun` |
| POST | `/api/runs/{id}/route` | Sequence / optimise run | `tblBulkJobRun`, `tblBulkJob` | `tblBulkJobRun`, possibly `tblBulkRun` metrics |
| POST | `/api/runs/{id}/assign-courier` | Assign courier | `tucCourier`, `tucFleet`, `tblBulkRun` | `tblBulkRun` |
| POST | `/api/runs/{id}/lock` | Lock / unlock run | `tblBulkRun` | `tblBulkRun` |
| POST | `/api/runs/{id}/commit` | Send live / dispatch | `tblBulkRun`, `tblBulkJobRun`, `tblBulkJob` | live downstream path via existing commit logic |

### Explicitly not part of the first rebuild cut

| Surface | Stage 1 status |
|---|---|
| Bulk Uploader rebuild inside Routed Operations | Deferred |
| Route Viewer rebuild inside Routed Operations | Deferred |

## Frontend components

### Legacy behaviour sources

```text
wwwroot/app/components/home/
├── homeControl.js
├── homeService.js
├── homeView.html
└── tpls/
    ├── jobList.tpl
    ├── groupedJobs.tpl
    ├── runList.tpl
    ├── runBuilder.tpl
    ├── HereMap.tpl
    ├── jobDetail.tpl
    ├── pickDateForm.tpl
    └── gpsForm.tpl
```

### New product/module hierarchy

```text
Routed Operations
└── Route Builder (release 1)
    ├── RoutesPage
    ├── jobs working set
    ├── grouped jobs rail
    ├── runs rail
    ├── route settings / right-hand popout
    ├── map / sequence view
    └── dispatch / save / lock flow

Existing apps retained during early stages
├── Bulk Uploader
└── Route Viewer
```

### Key behaviour boundary

- Route Builder owns **planning/building/editing/dispatch preparation**
- Bulk Uploader still owns **bulk ingest/import workflow** in Stage 1
- Route Viewer still owns **existing inspect/view workflow** in Stage 1

## Testing checklist

### Staging first

1. Confirm Kevin understands the naming rule:
   - umbrella = `Routed Operations`
   - first release = `Route Builder`
   - legacy = `RunBuilder`
2. Confirm no Stage 1 story assumes Bulk Uploader or Route Viewer are already rebuilt.
3. Confirm Route Builder still targets the real legacy dispatcher workflow.
4. Confirm docs do not imply a schema rename or forced repo-history rewrite.
5. Verify all referenced docs/files exist.

### Operational verification

1. Load a run date and filtered jobs.
2. Create a run.
3. Assign jobs.
4. Route/sequence.
5. Assign courier.
6. Lock/save.
7. Send live.
8. Confirm existing Bulk Uploader and Route Viewer flows are still available for the release stage where Route Builder first ships.

### Production / rollout caution

- Do **not** roll the new naming into a fake “all-in-one” operational release before Route Builder parity is real.
- The product vision is broader now, but the release boundary must stay honest.
