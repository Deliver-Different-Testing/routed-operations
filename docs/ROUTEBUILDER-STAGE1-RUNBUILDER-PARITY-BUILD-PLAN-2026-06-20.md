---
title: RouteBuilder Stage 1 — Runbuilder parity build plan
date: 2026-06-20
audience: Kevin
status: Active priority brief
purpose: Get the existing Runbuilder capability working in the new React UI as fast as possible before expanding into Quoting, Scheduled Routes, or Polygon Builder.
related_docs:
  - RUNBUILDER-REBUILD-TO-ROUTEBUILDER-CONSOLIDATED-2026-06-20.md
  - STEVE-ROUTEBUILDER-V2-PARITY-LIFT-PLAN-KEVIN-2026-06-20.md
  - STEVE-RUNBUILDER-V2-SCOPING-2026-06-13.md
legacy_reference_repo: https://git.customd.com/urgent-couriers/runbuilder.git
rebuild_repo: https://github.com/Deliver-Different-Testing/routebuilder
---

# RouteBuilder Stage 1 — Runbuilder parity build plan

## 1. Goal

The immediate goal is **not** to broaden RouteBuilder.

The immediate goal is to get the **existing Runbuilder workflow** working in the **new React UI** as quickly as possible.

That means Stage 1 is:
- make `RoutesPage` real
- preserve current Runbuilder operational behaviour
- move the backend logic into the new application layer where practical
- add the route-building criteria/locking controls dispatch needs in the RoutesPage right-hand popout
- **defer new modules** until the core route-building workflow works end-to-end

## 2. Explicit staging decision

### Build now
1. existing Runbuilder route-building workflow in new React UI
2. existing run creation / job allocation / routing / commit flow
3. existing operator tools needed to make that workflow usable

### Defer until after parity
1. Quoting as a real production module
2. Scheduled Routes as a real production module
3. Polygon Builder as a real production module
4. broader route-planning enhancements beyond legacy capability

Those modules can stay in the repo and keep their scaffolded UI, but they are **not the focus of the build sequence** right now.

---

## 3. Definition of done for Stage 1

Stage 1 is done when a dispatcher can use the new React RouteBuilder to:

1. choose a run date
2. load jobs and runs from live data
3. filter by the same core dimensions legacy supports
4. see grouped jobs / job pool / runs in the new UI
5. create a run
6. assign and move jobs into runs
7. route/sequence a run
8. see run totals/metrics update correctly
9. assign a courier
10. lock/save a run
11. push/send the run live
12. perform the few operator edits needed to keep the workflow moving

If those steps do not work, Stage 1 is not done.

---

## 4. What to ignore for now

Do not let these expand the first delivery scope:

- polishing Quoting beyond demo/scaffold state
- finishing Scheduled Routes beyond placeholder/scaffold state
- finishing Polygon Builder beyond placeholder/scaffold state
- perfect architecture cleanup before parity exists
- broad redesign of dispatch workflow
- non-essential dashboard/reporting extras

The fastest path is to make the current Runbuilder job → run → route → live workflow work in the new UI.

---

## 5. Stage 1 build sequence

## Phase 1 — make the Routes cockpit real

This is the first hard milestone.

### Outcome
`v2/frontend/src/pages/RoutesPage.tsx` stops being a mock-first demo and becomes the real operational screen.

### Build in this order

#### 1. Regions API
Legacy source:
- `RVW_stpBulkRegions`
- `JobController.RegionList`

New target:
- `RegionsController`
- `BulkRegionService.GetForRunDateAsync(date)`

Why first:
- postcode groups are load-bearing in the legacy workflow
- if region logic is wrong, the whole cockpit is wrong

#### 2. Speeds API
Legacy source:
- `RVW_stpBulkSpeeds`
- `JobController.SpeedList`

New target:
- `SpeedsController`
- `SpeedService.GetForRunDateAsync(date)`

#### 3. Filter model
Legacy source:
- `pickDateForm.tpl`
- `JobController.GetFilter`
- `homeControl.js` filter state

New target:
- filter state in `RoutesPage`
- request DTO/query model in backend
- optional `RunBuilderFilterService` for persistence later

Must support at least:
- date
- client
- region
- speed
- our ref

#### 4. Jobs working-set API
Legacy source:
- `UTL_stpJob_tblBulkJobWithFilter`
- `jobList.tpl`
- grouped job flows in `homeControl.js`

New target:
- `JobsController`
- `JobService.GetBulkJobsForBuilderAsync(query)`

Requirement:
- remove dependency on mock job data for the real route-building path
- return enough fields to support job list, grouped jobs, map, detail, and allocation

#### 5. Runs working-set API
Legacy source:
- `UTL_stpJob_tblBulkRunWithFilter`
- `runList.tpl`

New target:
- `RunsController`
- `RunService.GetBulkRunsForBuilderAsync(query)`

Requirement:
- return runs plus enough data for active selection, status, courier, jobs, and metrics

#### 6. Fleets / couriers API
Legacy source:
- `UTL_stpCourier_Active`
- `CourierController.Index`
- `PotentialCouriers.cs`

New target:
- `FleetsController` / `CouriersController`
- `CourierService.GetActiveAsync()`

Requirement:
- enough data to support assignment UI and later courier suggestion flow

### Milestone check
At the end of Phase 1:
- `RoutesPage` loads live jobs/runs/fleets for a chosen date
- filters are real
- mock fallback is no longer the primary route-building path

---

## Phase 2 — make route building operational

This is the second hard milestone.

### Outcome
The React UI can create and manipulate runs for real.

### Build in this order

#### 1. Create/update/delete runs
Legacy source:
- `UTL_stpJob_tblBulkRun_InsertOrUpdate`
- `UTL_stpJob_tblBulkRun_Delete`
- `InsertOrUpdateRun`
- `DeleteRun`

New target:
- `RunService.UpsertRunAsync(dto)`
- `RunService.DeleteAsync(runId)`
- `RunsController`

Need to support:
- create draft run
- rename/edit run
- delete run
- preserve active selected run behaviour

#### 2. Assign jobs to runs
Legacy source:
- `UTL_stpJob_tblBulkJobRun_InsertOrUpdate`
- `addToRunBuilder`
- `addGroupToRunBuilder`
- `updateJobToRun`

New target:
- `RunService.AssignJobToRunAsync(runId, bulkJobId, order)`
- `RunsController`

Need to support:
- add single jobs
- add grouped jobs
- preserve order field / builder index concept

#### 3. Move jobs between runs
Legacy source:
- `transferToAnotherRunFromMap`
- `UpdateJobToRun`
- `DeleteBulkJobRun`

New target:
- `RunsController.MoveJob`
- supporting service method in `RunService`

Need to support:
- move from one run to another
- remove from a run without losing the underlying job

#### 4. Run metrics/totals
Legacy source:
- `runBuilderTotals`
- `calculateRunDetails`
- `updateRunDetails`
- `runBuilder.tpl`

New target:
- compute in service or frontend with trusted backend data contract
- surface in `RoutesPage` / cockpit panels

Must show:
- mins
- kms
- drops
- revenue
- payout
- courier %

#### 5. Route sequencing
Legacy source:
- `routeRun`
- `GetHereMapSequence`
- `RouteWithName`
- `RouteRepository`
- `GoogleDirectionRepository`

New target:
- `RouteOptimizationService`
- `HereMapService`
- routing endpoints
- `HereMap.tsx`

Need to support:
- sequence the current run
- stamp order back into jobs
- refresh run metrics

#### 6. Route-building criteria in the RoutesPage right-hand popout
This is now part of Phase 1 / Stage 1 scope, not a later enhancement.

The right-hand popout on `RoutesPage` needs to surface the route-building method/settings before dispatch finalises a run.

Current/required criteria set:
1. **A-B** — route from base/depot to the furthest point
2. **A-A** — circuit route starting at depot and finishing back at depot
3. **Finish at specific stop** — make a nominated stop last, then build the most logical route to that point
4. **Fixed delivery targets per route** or delivery windows
5. **Fixed pickup windows** for inbound routes where relevant
6. **Fix/lock the route before sending to a driver** so the driver cannot reroute it from the driver app

Implementation expectation:
- these controls are surfaced in the RH popout of `RoutesPage`
- the selected routing mode/constraints are stored against the run/build request, not treated as temporary front-end-only state
- sequencing respects the selected criteria when route optimisation runs
- route lock/fix state survives save/send-to-driver flow

Minimum backend shape:
- run-level routing mode
- optional fixed-end-stop target
- optional delivery-window constraints
- optional pickup-window constraints
- explicit fixed-route / driver-reroute-disabled flag

Acceptance:
- dispatcher can choose the routing method from the RH popout before sequencing
- dispatcher can apply fixed delivery or pickup timing constraints where required
- dispatcher can nominate a forced-last stop where required
- dispatcher can fix/lock the route before sending it to the driver
- once fixed and sent, the driver app cannot recalculate/reroute that run

#### 7. Lock/unlock lifecycle
Legacy source:
- `toggleRunLock`

New target:
- explicit run state in backend and UI

Need to support:
- draft
- locked/persisted
- unlock if allowed
- interaction with fixed-route / driver-reroute-disabled state

This matters because send-to-live depends on it.

### Milestone check
At the end of Phase 2:
- dispatcher can build and save runs in the new UI
- jobs can be allocated/moved/ordered
- routing works
- route-building criteria are configurable from the RH popout
- fixed delivery/pickup constraints can be applied where needed
- runs can be fixed/locked before driver send-out
- run totals work
- runs can be locked

---

## Phase 3 — make the workflow production-meaningful

This is the third hard milestone.

### Outcome
The rebuilt UI is not just a planning demo. It can finish the operational workflow.

### Build in this order

#### 1. Commit / send-to-live
Legacy source:
- `InsertRunJobs`
- `sendTo`
- `sendSelectedJobsToLive`
- `UTL_stpJob_InsertFromRunBuilder`

New target:
- `RunCommitService.CommitJobToLiveAsync(cmd)`
- `RunsController` commit endpoint

Critical note:
- this is the highest-risk port because legacy SP side-effects matter
- verify exact side-effects before replacing behaviour

#### 2. Dispatch flow
Legacy source:
- `dispatchJobsForm`
- `dispatchJobs`

New target:
- route-builder dispatch/finalisation flow in React + backend

Need to support:
- dispatch selected jobs
- courier-linked finalisation where legacy expects it

#### 3. HD sync
Legacy source:
- `SyncHDJobs`
- `UTL_stpJob_tblBulkJob_SyncHDJobs`

New target:
- `HdJobSyncService.SyncForDateAsync(date)`
- jobs sync endpoint/button

#### 4. GPS correction
Legacy source:
- `gpsForm.tpl`
- `UpdateGps`
- `updateGPS`

New target:
- job edit modal / dedicated correction flow in React
- `JobsController.UpdateGps`

#### 5. Bulk route-date move
Legacy source:
- `BulkUpdateRouteDate`
- `bulkUpdateGroupRouteDate`

New target:
- `RunsController.BulkMoveDate`
- grouped-job / run-level reschedule actions

#### 6. Minimal operator edits
Legacy source:
- `jobDetail.tpl`
- `UpdateJobDetail`
- `editDetailField`

New target:
- `JobDetailModal`
- `JobsController.UpdateDetail`

Only prioritise the fields needed to keep route building operational first:
- addresses
- notes
- refs
- date/time
- courier
- charge if required by dispatch flow

#### 7. Saved filters/settings
Legacy source:
- `GetFilter`
- run-builder settings paths

New target:
- `RunBuilderFilterService`
- `RunSettingsService`

This is last in Stage 1 because it improves operator speed but does not create core capability.

### Milestone check
At the end of Phase 3:
- new React RouteBuilder can complete the existing operational Runbuilder flow end-to-end

---

## 6. New UI mapping — what screens matter first

## Primary screen
### `v2/frontend/src/pages/RoutesPage.tsx`
This is the Stage 1 battlefield.

This page should absorb the legacy capability from:
- `jobList.tpl`
- `groupedJobs.tpl`
- `runList.tpl`
- `runBuilder.tpl`
- `HereMap.tpl`
- `jobDetail.tpl`
- `gpsForm.tpl`
- parts of `pickDateForm.tpl`

Not by copying the templates, but by replacing their behaviour inside the new cockpit.

## Secondary supporting components
- `CockpitPage.tsx`
- `HereMap.tsx`
- `JobDetailModal.tsx`
- `EditRunScopeModal.tsx`
- RH popout/settings components around `RoutesPage`
- settings/filter components around RoutesPage

## Not primary for Stage 1
- `Quoting.tsx`
- `ScheduledRoutes.tsx`
- `PolygonBuilder.tsx`

These can remain scaffolded while core parity is completed.

---

## 7. Backend priority list

Kevin should prioritise backend work in this order:

1. regions
2. speeds
3. jobs filtered working set
4. runs filtered working set
5. couriers/fleets
6. run upsert/delete
7. job assignment/move
8. route optimisation
9. route-criteria / timing-constraint model + RH popout wiring
10. fixed-route / driver-reroute lock state
11. commit/send-to-live
12. HD sync
13. GPS correction
14. bulk route-date updates
15. saved filters/settings

That order keeps the UI moving toward real usability as fast as possible.

---

## 8. What “fastest path” means here

The fastest path is **not**:
- finishing every module evenly
- making Quoting production-ready now
- making Polygon Builder perfect now
- redesigning the whole domain before replacing the cockpit

The fastest path is:
1. make Routes real
2. make runs editable
3. make commit/live flow work
4. only then widen scope

---

## 9. Open cautions

### 1. Don’t lose postcode-group logic
The old tool is heavily driven by postcode-group/region behaviour. If that logic drifts, the rebuilt screen will look right and behave wrong.

### 2. Don’t underestimate SP side-effects
`UTL_stpJob_InsertFromRunBuilder` is probably doing more than just one insert. Treat commit/send-to-live as a careful parity task.

### 3. Don’t get distracted by new modules too early
The repo can hold them, but Stage 1 success is existing Runbuilder capability in the new UI.

### 4. Don’t port AngularJS literally
Preserve behaviour, not template structure.

---

## 10. Immediate next step

Kevin’s next implementation step should be:

**Finish Phase 1 completely before doing more feature-spread work.**

Concretely:
1. wire regions
2. wire speeds
3. wire filtered jobs
4. wire filtered runs
5. wire fleets/couriers
6. remove mock dependency from the core route-building path
7. wire the RH popout route-criteria model so sequencing is built on the real settings, not hard-coded defaults

Once that is done, move straight into run CRUD + assignment + sequencing with the real route-criteria controls in place.

---

## 11. Final instruction

If there is any tradeoff between:
- making the new UI do the **current Runbuilder job properly**, or
- adding more future-looking RouteBuilder capability,

choose **current Runbuilder capability first**.

That is the staging decision.
