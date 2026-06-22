---
title: Runbuilder rebuild → RouteBuilder consolidated handover
date: 2026-06-20
audience: Kevin / Steve
status: Canonical single-document brief
source_repos:
  - legacy: https://git.customd.com/urgent-couriers/runbuilder.git
  - rebuild: https://github.com/Deliver-Different-Testing/routebuilder
related_docs:
  - HANDOVER-KEVIN-ROUTEBUILDER-REBUILD-2026-06-14.md
  - STEVE-ROUTEBUILDER-V2-PARITY-LIFT-PLAN-KEVIN-2026-06-20.md
  - STEVE-RUNBUILDER-V2-SCOPING-2026-06-13.md
---

# Runbuilder rebuild → RouteBuilder consolidated handover

## 1. Executive summary

This is the single canonical brief for the RouteBuilder rebuild.

It combines:
- the **legacy Runbuilder audit**
- the **actual scope correction**
- the **current RouteBuilder v2 build state**
- the **parity mapping from old functions to new modules**
- the **new functionality to be added on top**
- the **recommended backend/application-layer lift away from stored procedures**

### Bottom line

**RouteBuilder is not just a recurring-routes UI.**

It is the rebuild of the current operational **Runbuilder** tool into a cleaner DFRNT-style app, while preserving the real dispatch/run-building behaviours that exist today.

The rebuild target is:
1. **legacy Runbuilder parity first**
2. then extension with:
   - **Quoting**
   - **Scheduled Routes**
   - **Polygon Builder**

---

## 2. Repo split and intent

### Legacy reference repo
- GitLab reference: `https://git.customd.com/urgent-couriers/runbuilder.git`
- Purpose: untouched source-of-truth for current behaviour

### Active rebuild repo
- GitHub rebuild repo: `https://github.com/Deliver-Different-Testing/routebuilder`
- Purpose: active RouteBuilder rebuild workspace Kevin can clone into GitLab for real dev work

### Rule
- **Do not mutate the legacy clone to become the rebuild.**
- Keep legacy intact for parity checks.
- Move new work into RouteBuilder.

---

## 3. What the legacy Runbuilder actually is

The legacy app is a mixed **ASP.NET MVC + AngularJS** dispatch workbench.

### Core legacy files inspected

#### Controllers
- `Controllers/HomeController.cs`
- `Controllers/JobController.cs`
- `Controllers/RouteController.cs`
- `Controllers/CourierController.cs`

#### Angular frontend
- `wwwroot/app/app.js`
- `wwwroot/app/components/home/homeControl.js`
- `wwwroot/app/components/home/homeService.js`
- `wwwroot/app/components/home/homeView.html`

#### Main templates
- `tpls/runList.tpl`
- `tpls/runBuilder.tpl`
- `tpls/jobList.tpl`
- `tpls/groupedJobs.tpl`
- `tpls/jobDetail.tpl`
- `tpls/HereMap.tpl`
- `tpls/pickDateForm.tpl`
- `tpls/gatherForm.tpl`
- `tpls/gpsForm.tpl`
- `tpls/potentialCouriers.tpl`
- `tpls/potentialCourierFleets.tpl`

#### Data / repositories / DB surface
- `Models/Repository/JobRepository.cs`
- `Models/Repository/RouteRepository.cs`
- `Models/Repository/GoogleDirectionRepository.cs`
- `Models/DespatchContext.cs`
- `Models/DespatchContextProcedures.cs`
- `BulkJob.cs`
- `BulkRun.cs`
- `PotentialCouriers.cs`
- `RunJob.cs`

### What that means

Legacy Runbuilder is **not** a simple route-definition tool.

It is a live operational workspace that does:
- filtered job loading
- grouped job management
- run creation/edit/delete
- drag/drop allocation into runs
- routing/sequence optimisation
- courier assignment
- run locking / unlocking
- send-to-live / dispatch
- job detail editing
- GPS correction
- bulk route-date changes
- zone/polygon-adjacent operational logic

---

## 4. Legacy capability inventory

## 4.1 Auth and bootstrap

### Evidence
- `HomeController.Index`

### Current behaviour
- reads Hub-authenticated tenant claims
- bootstraps tenant DB connection from claims

### Rebuild rule
- RouteBuilder should remain a **Hub-authenticated staff app**
- do not create a separate auth model

---

## 4.2 Date/filter-driven job loading

### Evidence
- `homeControl.js`: `doPickDateService`, `getData`, `getFilter`, `syncHDJobs`
- `pickDateForm.tpl`
- `JobController`: `GetFilter`, `RegionList`, `SpeedList`, `SyncHDJobs`

### Current filters
- date
- client
- region
- speed
- our ref

### Meaning
The app is driven by a **filtered working set**, not a fixed queue.

---

## 4.3 Job list + grouped jobs

### Evidence
- `jobList.tpl`
- `groupedJobs.tpl`
- `homeControl.js`: `showJobs`, `updatePotentialJobs`, `sortByTime`, `setTime`, `addTime`, `filterByTimes`, `sortByLessThan100`, `sortByPostCode`, `sortByMoreThan100`, `buildRunByPostalCode`, `addGroupToRunBuilder`, `bulkUpdateGroupRouteDate`

### Current behaviour
- unallocated job pool
- grouped jobs view
- time-based grouping helpers
- postcode-based grouping/helpers
- batch add to run builder
- bulk date changes at group level

### Meaning
This grouped layer is an operational accelerator and must not disappear.

---

## 4.4 Run list management

### Evidence
- `runList.tpl`
- `homeControl.js`: `newRun`, `showRun`, `runListMenu`, `bulkUpdateRouteDate`, `toggleRunLock`, `InsertOrUpdateRun`, `DeleteRun`, `sendSelectedJobsToLive`

### Current run-list behaviours
- unlocked run section
- locked run section
- sortable columns:
  - run
  - area
  - jobs
  - mins
  - kms
  - courier %
  - courier
- context actions:
  - Edit Name
  - Edit Route Date
  - Route and Lock Run
  - Toggle Run Lock
  - Remove
  - Send Selected Runs To Live

### Meaning
Runs are first-class operational objects with lifecycle state.

---

## 4.5 Run builder workspace

### Evidence
- `runBuilder.tpl`
- `homeControl.js`: `runBuilderTotals`, `routeRun`, `calculateRunDetails`, `updateRunDetails`

### Current builder metrics
- total mins
- total kms
- total drops
- hour %
- revenue
- petrol expense
- courier %
- hourly rate
- total payout

### Meaning
Legacy Runbuilder is already a mini operational cockpit, not just a list editor.

---

## 4.6 Routing and map behaviour

### Evidence
- `homeControl.js`: `routeRun`, `callRouteSavvy`, `updateRunDetails`, `getGroupedJobsHereMapSequence`
- `RouteController.GetHereMapSequence`
- `RouteRepository.cs`
- `GoogleDirectionRepository.cs`
- `HereMap.tpl`

### Current behaviour
- HERE sequence API usage
- Google/GMaps route rendering behaviour also present
- sequence optimisation for run jobs
- route metrics pushed back into jobs/runs
- map-assisted manipulation

### Meaning
Map routing is part of the workflow, not decoration.

---

## 4.7 Job-to-run manipulation

### Evidence
- `homeControl.js`: `addToRunBuilder`, `addGroupToRunBuilder`, `addToRunFromMap`, `removeJobFromRun`, `deleteFromRun`, `removeJobFromMap`, `updateJobToRun`, `transferToAnotherRunFromMap`
- `JobController.UpdateJobToRun`
- `JobController.DeleteBulkJobRun`

### Current behaviour
- drag/drop into runs
- move between runs
- map-driven add/remove
- unlink without deleting the underlying job

---

## 4.8 Run persistence and lock state

### Evidence
- `homeControl.js`: `toggleRunLock`, `InsertOrUpdateRun`, `DeleteRun`
- `JobController`: `InsertOrUpdateRun`, `DeleteRun`, `GetBulkRuns`, `UpdateRun`

### Current behaviour
- draft working runs
- persisted runs
- locked operational runs
- unlock/delete flows

---

## 4.9 Send to live / dispatch

### Evidence
- `homeControl.js`: `sendTo`, `sendSelectedJobsToLive`, `dispatchJobsForm`, `dispatchJobs`
- `JobController.InsertRunJobs`
- `CourierController.Index`

### Current behaviour
- locked-run validation before send
- send selected runs live
- dispatch selected jobs
- courier-aware dispatch flow

---

## 4.10 Potential courier suggestions

### Evidence
- `homeControl.js`: `getPotentialCouriers`, `showCouriers`
- `CourierController.Index`
- `PotentialCouriers.cs`

### Current behaviour
- find active/candidate couriers for selected work

---

## 4.11 Job detail editing

### Evidence
- `jobDetail.tpl`
- `homeControl.js`: `editDetailField`, `updateDetailField`, `updateJobInAllLists`
- `JobController.UpdateJobDetail`

### Editable fields seen in legacy
- from address
- to address
- notes
- phone
- size
- items
- weight
- ref A
- ref B
- our ref
- signature not required
- courier
- job number
- date
- time
- charge

---

## 4.12 GPS correction workflow

### Evidence
- `gpsForm.tpl`
- `homeControl.js`: `updateGPS`, `copyGpsAddress`
- `JobController.UpdateGps`

### Current behaviour
- address search
- postcode entry
- lat/lng correction
- draggable marker
- persisted GPS update

---

## 4.13 Bulk route-date editing

### Evidence
- `homeControl.js`: `bulkUpdateRouteDate`, `bulkUpdateGroupRouteDate`
- `JobController.BulkUpdateRouteDate`

### Current behaviour
- move whole run to a new date
- move grouped jobs to a new date

---

## 4.14 Data/domain surface beneath legacy

### Evidence
From `DespatchContext.cs`:
- `TblBulkJobs`
- `TblBulkJobRuns`
- `TblBulkRuns`
- `ZipPolygons`
- `ZoneCombos`
- `ZoneGroups`
- `ZoneNames`
- `ZoneZips`

From `DespatchContextProcedures.cs`:
- `RVW_stpBulkRegionsAsync`
- `RVW_stpBulkSpeedsAsync`
- `UTL_stpCourier_ActiveAsync`
- `UTL_stpJob_InsertFromRunBuilderAsync`
- `UTL_stpJob_tblBulkJobAsync`
- `UTL_stpJob_tblBulkJobRun_InsertOrUpdateAsync`
- `UTL_stpJob_tblBulkJobWithFilterAsync`
- `UTL_stpJob_tblBulkJob_SyncHDJobsAsync`
- `UTL_stpJob_tblBulkRunAsync`
- `UTL_stpJob_tblBulkRunSettingsAsync`
- `UTL_stpJob_tblBulkRunWithFilterAsync`
- `UTL_stpJob_tblBulkRun_DeleteAsync`
- `UTL_stpJob_tblBulkRun_InsertOrUpdateAsync`

### Meaning
The new app should be built against this real operational surface, not against guessed behaviours.

---

## 5. Scope correction: what RouteBuilder really is

The earlier narrower interpretation was wrong.

### Wrong interpretation
- recurring routes only
- schedule binding only
- route setup only

### Correct interpretation
RouteBuilder is the rebuild of the current **Runbuilder dispatch workspace**, with cleaner architecture and better extensibility.

### Definition
**RouteBuilder = legacy Runbuilder parity + new modules**

---

## 6. Current RouteBuilder v2 build state in the new repo

The new repo already contains an actual v2 scaffold/snapshot under `/v2/`.

## 6.1 Current frontend routes

From `v2/frontend/src/App.tsx`:
- `/` → `Dashboard`
- `/routes` → `RoutesPage`
- `/quoting` → `Quoting`
- `/scheduled-routes` → `ScheduledRoutes`
- `/polygons` → `PolygonBuilder`

### Meaning
The rebuild already has the top-level module structure we want.

---

## 6.2 Current `RoutesPage` state

### Evidence
- `v2/frontend/src/pages/RoutesPage.tsx`
- `v2/frontend/src/lib/api.ts`
- `v2/frontend/src/lib/mockData.ts`

### Current behaviour
- attempts to fetch live data from `/api/*`
- falls back to mock data if backend unavailable
- renders cockpit layout
- already expects jobs, groups, runs, fleets, map center/zoom

### Meaning
The new UI shape exists, but the parity lift is incomplete.

---

## 6.3 Current `Quoting` state

### Evidence
- `v2/frontend/src/pages/Quoting.tsx`

### Current behaviour
- CSV upload placeholder
- rate card selector
- service-level selector
- simulated quote summary
- reuses cockpit page visual structure
- explicitly references `tblQuoteJob` shadow-table concept

### Meaning
Quoting exists as a scaffolded operator surface, not yet as a real end-to-end feature.

---

## 6.4 Current `ScheduledRoutes` state

### Evidence
- `v2/frontend/src/pages/ScheduledRoutes.tsx`

### Current behaviour
- scheduled-routes board rendered through cockpit
- highlights zip polygons on map
- uses mock recurring routes and polygons

### Meaning
Scheduled Routes is visually seeded, but still largely mock/demo-driven.

---

## 6.5 Current `PolygonBuilder` state

### Evidence
- `v2/frontend/src/pages/PolygonBuilder.tsx`

### Current behaviour already present
- map-based polygon drawing
- persisted local state
- edit mode
- drag vertices
- insert midpoint vertices
- load zip polygons as starter shapes
- save route info against polygons

### Meaning
Polygon Builder is the most advanced of the new modules visually, but still needs connection to real backend/domain flows.

---

## 6.6 Current backend state

### Controllers present in `v2/backend/Controllers`
- `FleetsController.cs`
- `JobsController.cs`
- `PolygonsController.cs`
- `QuoteController.cs`
- `RunsController.cs`
- `ScheduledRoutesController.cs`

### Example current run endpoints from `RunsController.cs`
- `GET /api/runs`
- `GET /api/runs/{runId}`
- `POST /api/runs`
- `POST /api/runs/{runId}/assign-courier`
- `POST /api/runs/assign-pickup`
- `POST /api/runs/auto-match-pickups`

### Meaning
The new app already has a real .NET backend skeleton with RouteBuilder policies and service interfaces, but parity is not complete yet.

---

## 7. Legacy → RouteBuilder mapping matrix

## 7.1 Core parity matrix

| Legacy capability | Legacy evidence | RouteBuilder target | Current v2 state | Required next step |
|---|---|---|---|---|
| Hub auth + tenant bootstrap | `HomeController.Index` | Hub-authenticated RouteBuilder app | partially implied in backend policies | confirm tenant bootstrap and cookie wiring end-to-end |
| date/client/region/speed/ref filters | `pickDateForm.tpl`, `GetFilter`, `RegionList`, `SpeedList` | `RoutesPage` filter bar | not fully wired | port SP/filter logic into app services + API |
| job list | `jobList.tpl` | `RoutesPage` jobs rail | scaffold exists | replace mocks with real filtered job feed |
| grouped jobs | `groupedJobs.tpl` | grouped panel in cockpit | shape exists via mock groups | lift real grouped-job logic |
| run list | `runList.tpl` | `RoutesPage` run rail | scaffold exists | port real run retrieval + persistence |
| run builder totals | `runBuilder.tpl` | cockpit right-side builder metrics | partial visual base | compute from real run/job data |
| drag/drop run allocation | `addToRunBuilder`, `updateJobToRun` | `RoutesPage` drag/drop | incomplete | wire assign/move endpoints + UI |
| routing / sequencing | `routeRun`, `GetHereMapSequence` | `HereMap` / route service | partial component structure exists | wire real optimizer + persist route result |
| lock/unlock run | `toggleRunLock` | run lifecycle in backend + UI | not clearly complete | implement explicit lock state |
| send selected runs live | `sendSelectedJobsToLive`, `InsertRunJobs` | commit/finalise action | missing | port commit logic from SP side-effects |
| dispatch jobs | `dispatchJobs` | dispatch/finalisation UX | missing | model explicit dispatch step |
| potential couriers | `PotentialCouriers`, `CourierController.Index` | fleet/courier suggestion UI | backend seed exists | complete suggestion flow |
| inline job detail edit | `jobDetail.tpl`, `UpdateJobDetail` | `JobDetailModal` equivalent | component exists in v2 tree | wire real field edits |
| GPS correction | `gpsForm.tpl`, `UpdateGps` | map/edit modal | missing as complete parity flow | implement GPS correction UI + endpoint |
| bulk route date move | `BulkUpdateRouteDate` | batch run/group reschedule | missing | add API + UI |
| postcode-group build logic | `buildRunByPostalCode` | assisted route creation in `RoutesPage` | not complete | lift logic into application layer |

---

## 7.2 New modules matrix

| New module | Why it exists | Current v2 state | What must become real |
|---|---|---|---|
| Quoting | upstream commercial modelling before ops setup | scaffolded UI | real quote ingestion, calculation, persistence, handoff into operational route setup |
| Scheduled Routes | formalise recurring/scheduled route planning instead of only ad hoc building | seeded UI with mock recurring routes | real routes/schedules data model + operational materialisation |
| Polygon Builder | maintain delivery coverage / zip boundaries / route zones in a modern way | strongest visual prototype | persist polygons to real DB tables and connect to routes/coverage logic |

---

## 8. Stored procedure → application-layer lift map

Per the parity-lift analysis, the right path is **not** to port AngularJS.

The right path is:
- preserve legacy operational behaviour
- lift the SP-driven backend into .NET application services / EF queries
- let the React UI be the replacement surface

## 8.1 Read-side lifts

| Legacy SP | New service recommendation |
|---|---|
| `RVW_stpBulkRegions` | `BulkRegionService.GetForRunDateAsync(date)` |
| `RVW_stpBulkSpeeds` | `SpeedService.GetForRunDateAsync(date)` |
| `UTL_stpCourier_Active` | `CourierService.GetActiveAsync()` |
| `UTL_stpJob_tblBulkRunSettings` | `RunSettingsService.GetAsync()` |
| legacy saved filter path | `RunBuilderFilterService.GetForCurrentUserAsync(date)` |

## 8.2 Filter-driven working-set lifts

| Legacy SP | New service recommendation |
|---|---|
| `UTL_stpJob_tblBulkJobWithFilter` | `JobService.GetBulkJobsForBuilderAsync(query)` |
| `UTL_stpJob_tblBulkRunWithFilter` | `RunService.GetBulkRunsForBuilderAsync(query)` |

## 8.3 Write-side lifts

| Legacy SP / action | New service recommendation |
|---|---|
| `UTL_stpJob_tblBulkRun_InsertOrUpdate` | `RunService.UpsertRunAsync(dto)` |
| `UTL_stpJob_tblBulkRun_Delete` | `RunService.DeleteAsync(runId)` |
| `UTL_stpJob_tblBulkJobRun_InsertOrUpdate` | `RunService.AssignJobToRunAsync(runId, bulkJobId, order)` |
| `UTL_stpJob_InsertFromRunBuilder` | `RunCommitService.CommitJobToLiveAsync(cmd)` |
| `UTL_stpJob_tblBulkJob_SyncHDJobs` | `HdJobSyncService.SyncForDateAsync(date)` |

## 8.4 Non-SP operational lifts already implied by repo

| Legacy request | New API target |
|---|---|
| bulk route date move | `RunsController.BulkMoveDate` |
| update GPS | `JobsController.UpdateGps` |
| update job detail | `JobsController.UpdateDetail` |
| move job between runs | `RunsController.MoveJob` |
| void/cancel jobs | `JobsController.Void` |
| route optimisation | `RouteOptimizationController` + `RouteOptimizationService` |
| HERE sequence | `RouteOptimizationController.HereSequence` + `HereMapService` |

---

## 9. Recommended RouteBuilder module structure

## Frontend modules
- `Dashboard`
- `RoutesPage`
- `Quoting`
- `ScheduledRoutes`
- `PolygonBuilder`
- supporting cockpit/map/detail/settings components

## Backend domains
- Runs
- Jobs
- Fleets/Couriers
- Polygons
- Quotes
- Scheduled Routes
- Regions
- Speeds
- Run Settings
- Filter persistence
- Route optimisation
- HD sync
- Run commit/finalisation

---

## 10. What must not be ported directly

Do **not** rebuild the AngularJS frontend template-for-template.

### Specifically not the plan
- port `homeView.html` into React one template at a time
- carry forward legacy PHP/JSON stubs in `wwwroot/app/components/home/api/*`
- preserve stored-procedure coupling as the long-term architecture

### The correct plan
- preserve the behaviour
- replace the frontend with RouteBuilder v2 React surfaces
- replace the SP-heavy logic with an application layer where practical

---

## 11. Gaps still open in the new build

The new repo now has the right structure, but these are still open:

1. **real filtered jobs/runs data** still not fully replacing mock fallback
2. **grouped-job logic** not yet fully lifted from legacy
3. **drag/drop allocation** not fully wired to real persistence
4. **run locking/unlocking semantics** need explicit completion
5. **commit/send-to-live** logic not yet parity-complete
6. **dispatch flow** not yet fully implemented
7. **GPS correction parity** not yet complete
8. **bulk route-date update** not yet complete
9. **potential courier flow** needs complete end-to-end wiring
10. **saved filters / operator settings** need proper storage
11. **SP side-effects** around live commit need careful verification before replacement

---

## 12. Practical build order

### Phase A — make the Routes cockpit real
- regions API
- speeds API
- filtered jobs API
- filtered runs API
- fleets/couriers API
- remove dependency on mock-only mode for core route-building screen

### Phase B — make route building operational
- create/update/delete runs
- assign jobs to runs
- move jobs between runs
- run metrics/totals
- route sequencing
- lock/unlock lifecycle

### Phase C — make it production-meaningful
- send-to-live / commit
- dispatch flow
- HD sync
- GPS correction
- route date bulk moves
- saved filters/settings

### Phase D — extend beyond parity
- fully real Quoting
- fully real Scheduled Routes
- fully real Polygon Builder

### Phase E — dynamic / rolling route-building mode
- preserve the existing **batch/prebuild** route-building use case as a first-class planning strategy
- add a second **dynamic/rolling** planning strategy for progressively arriving delivery data
- keep the shared domain model (jobs, runs, couriers, depots, constraints, route results), but do **not** force both strategies through the same legacy SP-shaped planning logic
- introduce application-layer planner services for:
  - inbound/unplanned job assessment
  - draft-run recommendations
  - selective re-optimisation
  - lock/freeze rules
  - fixed-time / target-time / furthest-destination / round-trip / fixed-final-destination constraints
- do planning and UI work in parallel with the backend design:
  - dynamic-mode screen or mode switch
  - inbound jobs rail
  - draft runs rail
  - recommendation panel
  - operator accept/override/freeze controls
- treat external mapping/ETA providers separately from the planner itself: map, geocode, and distance/time can stay external; the run-decision brain should move in-house over time if the constraint set keeps growing

### Explicit sequencing rule
- **Do not stop the current parity path.** The batch/prebuild mode still has real operational value and must ship.
- **Do not bury the new dynamic mode in a vague backlog note either.** It is now an explicit implementation phase for Kevin.
- The intended order is:
  1. deliver enough batch parity to replace the current Runbuilder use case
  2. in parallel, define dynamic-mode DTOs, planner interfaces, and UX
  3. then implement the dynamic planner incrementally on the same RouteBuilder foundation

---

## 13. Final decision statement

If the new RouteBuilder cannot do the operational work the current Runbuilder does, it is **not finished**.

If it can do the current operational work cleanly **and** absorb:
- Quoting
- Scheduled Routes
- Polygon Builder
- a second dynamic / rolling planning mode

then it becomes the right long-term replacement.

That is the target.
