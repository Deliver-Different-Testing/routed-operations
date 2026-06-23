---
---

# RouteBuilder rebuild — Kevin handover

> **Naming update (2026-06-23):** the broader forward product direction is now **Routed Operations**. Treat this file as historical RouteBuilder-scope handover context. For current Kevin-forward scope and naming, use `HANDOVER-KEVIN-ROUTED-OPERATIONS-2026-06-23.md` first.

## Claude Code steps

```bash
git clone https://git.customd.com/urgent-couriers/runbuilder.git
cd runbuilder
ls -la Controllers/JobController.cs
ls -la Controllers/RouteController.cs
ls -la Models/Repository/JobRepository.cs
ls -la Models/DespatchContext.cs
ls -la Models/DespatchContextProcedures.cs
ls -la wwwroot/app/components/home/homeControl.js
ls -la wwwroot/app/components/home/homeService.js
ls -la wwwroot/app/components/home/tpls/runList.tpl
ls -la wwwroot/app/components/home/tpls/runBuilder.tpl
ls -la wwwroot/app/components/home/tpls/jobList.tpl
ls -la wwwroot/app/components/home/tpls/jobDetail.tpl
ls -la wwwroot/app/components/home/tpls/groupedJobs.tpl
ls -la wwwroot/app/components/home/tpls/HereMap.tpl
ls -la wwwroot/app/components/home/tpls/pickDateForm.tpl
ls -la wwwroot/app/components/home/tpls/gpsForm.tpl
```

---

## Table of contents

1. [Executive correction](#executive-correction)
2. [Feature overview](#feature-overview)
3. [What the legacy Runbuilder actually is](#what-the-legacy-runbuilder-actually-is)
4. [Legacy functionality audit](#legacy-functionality-audit)
5. [Already built vs Kevin work](#already-built-vs-kevin-work)
6. [Step-by-step checklist](#step-by-step-checklist)
7. [Database tables and procedure surface](#database-tables-and-procedure-surface)
8. [API endpoints summary](#api-endpoints-summary)
9. [Frontend/components in play](#frontendcomponents-in-play)
10. [Key questions answered](#key-questions-answered)
11. [Testing checklist](#testing-checklist)

---

## Executive correction

The previous version of this handover undershot the brief.

It framed RouteBuilder as mainly a recurring-routes / schedule-binding feature. That is too narrow.

**The real rebuild target is the existing `runbuilder` operational tool.** The replacement must be able to do **everything the legacy Runbuilder currently does**, then extend it with:

1. **Quoting**
2. **Scheduled Routes**
3. **Polygon Builder**

So Kevin's scope is not just route setup. It is a **full operational run-building / dispatch workspace** with legacy parity first, then the new modules.

---

## Feature overview

- Legacy Runbuilder is a **staff dispatch tool**, not just a route-config UI.
- It loads jobs for a chosen date + filter set, groups them, builds runs, sequences them, assigns couriers, locks/unlocks runs, edits job detail, adjusts GPS/address data, and pushes runs/jobs live.
- It already has live operational concepts including **run CRUD**, **job-to-run manipulation**, **route date changes**, **routing**, **courier suggestions**, **dispatch/send-to-live**, and **zone/polygon-backed data**.
- The rebuild must preserve those behaviours while moving into the DFRNT/Hub-authenticated architecture.
- New work on top of parity is **Quoting**, **Scheduled Routes**, and **Polygon Builder**.

---

## What the legacy Runbuilder actually is

Based on the current GitLab repo at `https://git.customd.com/urgent-couriers/runbuilder.git`, the existing tool is a mixed AngularJS + ASP.NET MVC operational app with these layers:

### UI shell
- `Views/Home/Index.cshtml`
- `wwwroot/app/app.js`
- single `home` state using `homeView.html` + `HomeControl`

### Controllers
- `Controllers/HomeController.cs`
- `Controllers/JobController.cs`
- `Controllers/RouteController.cs`
- `Controllers/CourierController.cs`

### Data/repositories
- `Models/Repository/JobRepository.cs`
- `Models/Repository/RouteRepository.cs`
- `Models/Repository/GoogleDirectionRepository.cs`
- `Models/DespatchContext.cs`
- `Models/DespatchContextProcedures.cs`

### Angular operational brain
- `wwwroot/app/components/home/homeControl.js`
- `wwwroot/app/components/home/homeService.js`

### Main operational templates
- `tpls/runList.tpl`
- `tpls/runBuilder.tpl`
- `tpls/jobList.tpl`
- `tpls/groupedJobs.tpl`
- `tpls/jobDetail.tpl`
- `tpls/HereMap.tpl`
- `tpls/pickDateForm.tpl`
- `tpls/gatherForm.tpl`
- `tpls/gpsForm.tpl`

This is a real dispatch workbench with live mutation paths, not just a planning screen.

---

## Legacy functionality audit

## 1. Auth + tenant bootstrap

### What exists now
- `HomeController.Index` reads Hub-authenticated claims including connection / tenant context.
- Tenant DB connection is derived per request from claims, not from a hardcoded local DB.
- This confirms the replacement should stay in the **Hub-authenticated staff app pattern**, not invent a separate auth model.

### Rebuild requirement
- Reuse Hub auth / session / tenant bootstrap.
- Do not create a courier-portal-style auth silo.

---

## 2. Date/filter-driven job loading

### Evidence
- `homeControl.js` → `doPickDateService()`, `getData()`, `getFilter()`, `syncHDJobs()`
- `pickDateForm.tpl`
- `JobController.GetFilter`, `RegionList`, `SpeedList`, `SyncHDJobs`

### Current behaviour
The operator can filter the working set by:
- date
- client
- region
- speed
- our ref

The filter screen is not cosmetic. It drives the job pool that feeds the builder.

### Rebuild requirement
- Must preserve date-first operational loading.
- Must preserve multi-select filters.
- Must preserve sync/load behaviour before build actions begin.

---

## 3. Job pool + grouped job views

### Evidence
- `jobList.tpl`
- `groupedJobs.tpl`
- `homeControl.js` → `showJobs`, `updatePotentialJobs`, `sortByTime`, `setTime`, `addTime`, `filterByTimes`, `sortByLessThan100`, `sortByPostCode`, `sortByMoreThan100`, `buildRunByPostalCode`, `addGroupToRunBuilder`, `bulkUpdateGroupRouteDate`

### Current behaviour
Legacy Runbuilder does not just show a flat list. It supports:
- unallocated job list
- grouped job list
- group-based views for batch operations
- sorting/grouping by time and postcode characteristics
- bulk group add into run builder
- bulk route-date updates against grouped jobs

This grouped-jobs layer is a core operational accelerator.

### Rebuild requirement
- Must support grouped operational views, not just raw row lists.
- Must support bulk actions at group level.
- Must support auto-build helpers such as postcode-based run creation.

---

## 4. Run list management

### Evidence
- `runList.tpl`
- `homeControl.js` → `newRun`, `showRun`, `runListMenu`, `bulkUpdateRouteDate`, `toggleRunLock`, `InsertOrUpdateRun`, `DeleteRun`, `sendSelectedJobsToLive`

### Current behaviour
The run list is a full working surface with:
- unlocked run list section
- locked run list section
- sortable columns for run, area, jobs, mins, kms, courier %, courier
- active run selection
- context-menu actions including:
  - Edit Name
  - Edit Route Date
  - Route and Lock Run
  - Toggle Run Lock
  - Remove
  - Send Selected Runs To Live

The tool is explicitly designed around draft vs locked runs.

### Rebuild requirement
- Must preserve run list as a first-class operational object.
- Must preserve draft/locked states.
- Must preserve run-level context actions.
- Must preserve run-level send-to-live flow.

---

## 5. Run builder workspace

### Evidence
- `runBuilder.tpl`
- `homeControl.js` → `runBuilderTotals`, `routeRun`, `calculateRunDetails`, `updateRunDetails`, `activateRunDrop`

### Current behaviour
The run builder is not just a drag-drop bucket. It shows and recalculates:
- total mins
- total kms
- total drops
- hour %
- revenue
- petrol expense
- courier % with colour thresholds
- hourly rate
- total payout

Jobs in the builder carry run order (`BuilderIndex`) and can be re-sequenced / removed.

### Rebuild requirement
- Must preserve editable run composition.
- Must preserve real-time run metrics/calculation surface.
- Must preserve run order visibility and update flow.

---

## 6. Routing / sequence optimisation

### Evidence
- `homeControl.js` → `routeRun`, `callRouteSavvy`, `updateRunDetails`, `getGroupedJobsHereMapSequence`
- `RouteController.GetHereMapSequence`
- `RouteRepository.cs`
- `GoogleDirectionRepository.cs`
- `HereMap.tpl`

### Current behaviour
Legacy Runbuilder mixes HERE and Google map/routing behaviour:
- HERE sequence API usage (`H.service.Platform` in `HereMap.tpl`)
- Google/GMaps route rendering in the map surface
- route optimisation for a run
- route metrics flowed back into run jobs and totals
- map-based interaction with markers/routes
- auto zoom and route rendering controls

### Rebuild requirement
- Must preserve route sequencing and map visibility.
- Must preserve the ability to route a run and stamp sequence order back into jobs.
- Must preserve map-assisted operational editing, not just static route display.

---

## 7. Job-to-run manipulation

### Evidence
- `homeControl.js` → `addToRunBuilder`, `addGroupToRunBuilder`, `addToRunFromMap`, `removeJobFromRun`, `deleteFromRun`, `removeJobFromMap`, `updateJobToRun`, `transferToAnotherRunFromMap`, `activateRunDrop`, `activateRunListDrop`
- `JobController.UpdateJobToRun`, `DeleteBulkJobRun`

### Current behaviour
Operators can:
- drag/drop jobs into runs
- move jobs between runs
- add jobs from grouped views
- add/remove jobs from map interaction
- remove jobs from a run without deleting the job entirely
- transfer jobs between runs

### Rebuild requirement
- Must preserve interactive job/run movement.
- Must preserve job-run link management as a first-class capability.
- Must preserve both list-driven and map-driven manipulation flows.

---

## 8. Run persistence + lock/unlock semantics

### Evidence
- `homeControl.js` → `toggleRunLock`, `InsertOrUpdateRun`, `DeleteRun`
- `JobController.InsertOrUpdateRun`, `DeleteRun`, `GetBulkRuns`, `UpdateRun`
- `JobRepository.cs`
- procedures in `DespatchContextProcedures.cs`

### Current behaviour
Legacy Runbuilder clearly distinguishes:
- temporary/draft in-memory working runs
- persisted runs in DB
- locked runs ready for downstream operational use
- unlocking/deleting run persistence state

The lock toggle is one of the core state transitions in the app.

### Rebuild requirement
- Must model explicit lifecycle states for a run.
- Must preserve persistent run save/update/delete semantics.
- Must preserve lock/unlock behaviour and all downstream effects.

---

## 9. Send to live / dispatch flows

### Evidence
- `homeControl.js` → `sendTo`, `sendSelectedJobsToLive`, `dispatchJobsForm`, `dispatchJobs`
- `JobController.InsertRunJobs`
- `CourierController.Index`

### Current behaviour
The tool can:
- validate that runs are locked before sending
- push selected locked runs live
- dispatch selected jobs
- choose couriers during dispatch flow
- use potential courier suggestions

This is not just planning. It bridges into actual operational dispatch.

### Rebuild requirement
- Must preserve send-to-live as an explicit finalisation action.
- Must preserve courier-aware dispatch workflow.
- Must preserve locked-run validation before downstream mutation.

---

## 10. Potential courier suggestions

### Evidence
- `homeControl.js` → `getPotentialCouriers`, `showCouriers`
- `CourierController.Index`
- `PotentialCouriers.cs`

### Current behaviour
The operator can request candidate couriers for selected jobs and use that information during assignment/dispatch.

### Rebuild requirement
- Must preserve candidate courier lookup.
- Must preserve a UI surface for suggestions, not bury it in logs/API only.

---

## 11. Job detail editing

### Evidence
- `jobDetail.tpl`
- `homeControl.js` → `editDetailField`, `updateDetailField`, `updateJobInAllLists`, `formatDateForDisplay`, `formatTimeForDisplay`
- `JobController.UpdateJobDetail`

### Current behaviour
Operators can edit live job detail from within Runbuilder, including:
- from address
- to address
- notes
- phone
- size
- items
- weight
- ref A / ref B / our ref
- signature not required
- courier
- job number
- date
- time
- charge

That is a significant embedded job-maintenance surface.

### Rebuild requirement
- Must preserve inline job detail maintenance for operational users.
- Must not reduce the replacement to a read-only planner.

---

## 12. GPS / address correction workflow

### Evidence
- `gpsForm.tpl`
- `homeControl.js` → `updateGPS`, `copyGpsAddress`
- `JobController.UpdateGps`

### Current behaviour
Legacy Runbuilder has a dedicated GPS form for fixing bad geodata, with:
- address search
- postcode input
- lat/lng editing
- draggable map marker
- validation
- update action back to server

This exists because geocoding quality directly affects build/routing operations.

### Rebuild requirement
- Must preserve address/GPS correction inside the tool.
- Must preserve visibility of geocode-problem jobs.

---

## 13. Bulk route-date editing

### Evidence
- `homeControl.js` → `bulkUpdateRouteDate`, `bulkUpdateGroupRouteDate`
- `JobController.BulkUpdateRouteDate`

### Current behaviour
Operators can bulk move route dates for:
- an entire run
- a whole grouped-job set

This is operational rescheduling, not a minor convenience.

### Rebuild requirement
- Must preserve batch rescheduling actions.
- Must preserve date-shift support for both run and group contexts.

---

## 14. Auto-build helpers and heuristics

### Evidence
- `homeControl.js` → `buildRunByPostalCode`, `sortByPostCode`, `sortByTime`, `sortByLessThan100`, `sortByMoreThan100`

### Current behaviour
There is logic to assist semi-automatic grouping/building rather than requiring users to manually assemble every run from scratch.

### Rebuild requirement
- Must preserve assisted build workflows.
- Scheduled Routes can eventually supersede some manual work, but parity still requires these helper behaviours to exist or be intentionally replaced with something equivalent.

---

## 15. Search/layout/operator ergonomics

### Evidence
- `homeControl.js` → `loadLayout`, `saveLayout`, `openSearch`, `orderList`

### Current behaviour
The legacy tool includes layout persistence, list ordering, and operator-focused shortcuts.

### Rebuild requirement
- Preserve operational ergonomics.
- New UI can be cleaner, but it still needs efficient power-user workflow, not just pretty visuals.

---

## 16. Zone/polygon-backed data surface

### Evidence
- `DespatchContext.cs` exposes:
  - `TblBulkJobs`
  - `TblBulkJobRuns`
  - `TblBulkRuns`
  - `ZipPolygons`
  - `ZoneCombos`
  - `ZoneGroups`
  - `ZoneNames`
  - `ZoneZips`

### Current behaviour
Even if legacy UI does not expose a modern polygon editor, the data model already includes zipcode/polygon/zone concepts used by the run-building ecosystem.

### Rebuild requirement
- The new **Polygon Builder** is not random greenfield work. It should be built as the maintainable UI/editor over the existing zone/polygon concepts already in the dispatch data model.

---

## 17. What is new beyond parity

After parity with current Runbuilder, the rebuild also needs these new modules:

### A. Quoting
Must add quoting capability that the legacy tool does not currently provide as a first-class operational module.

Minimum expectation:
- quote creation/editing
- mapping quote assumptions into route/run logic where relevant
- ability to turn quote outputs into operational setup inputs instead of rekeying

### B. Scheduled Routes
This is broader than the current legacy run builder.

Minimum expectation:
- route definitions tied to schedules
- operational visibility of scheduled route materialisation
- ability for scheduler logic to feed run creation rather than relying only on ad hoc manual grouping
- alignment with existing recurring-route direction already documented elsewhere in this repo

### C. Polygon Builder
Must add maintainable admin tooling to manage:
- polygons / zip coverage areas
- zone groupings / relationships
- route coverage boundaries used by the dispatch logic

This should be the editable admin surface over the existing underlying zone/polygon tables, not a disconnected parallel model.

---

## Already built vs Kevin work

### ✅ Already built / already decided

| Area | Status | File(s) |
|---|---|---|
| Legacy repo audited enough to define real parity scope | Done | `gitlab-source/runbuilder/*` |
| Existing recurring-route direction already documented | Done | `docs/RECURRING-ROUTES-IMPLEMENTATION.md` |
| Route ↔ schedule binding direction already documented | Done | `docs/HANDOVER-GARRY-ROUTE-SCHEDULE-BINDING-2026-06-02.md` |
| Routed-speed auto-assign direction already documented | Done | `docs/KEVIN-ROUTED-SPEED-AUTO-ASSIGN-PLAN-2026-06-10.md` |
| Raw base + manual mode direction already documented | Done | `docs/STEVE-RECURRING-BOOKING-RAWBASE-MANUAL-MODE-2026-06-09.md` |
| RunViewer synthetic/negative run context already documented | Done | `docs/RUNVIEWER-RECURRING-ROUTES-HANDOVER.md` |
| Core conclusion that parity target is the legacy Runbuilder tool | Done | this document |

### 🔧 Kevin work still to do

| # | Priority | Est. hrs | Work |
|---|---:|---:|---|
| 1 | P0 | 3 | Build a capability matrix from legacy repo into concrete replacement stories/screens and get signoff before coding deeper |
| 2 | P0 | 8 | Implement run list + run builder parity: create/edit/delete/select/reorder runs, lock/unlock, totals, builder sequence |
| 3 | P0 | 8 | Implement job pool, grouped jobs, drag/drop run allocation, transfer between runs, batch add/remove flows |
| 4 | P0 | 6 | Implement routing/map parity: sequence optimisation, map markers/routes, run order stamping, map-based manipulation |
| 5 | P0 | 4 | Implement send-to-live / dispatch flows with locked-run validation and selected-run push |
| 6 | P0 | 4 | Implement job detail editing parity including date/time/address/notes/refs/charge/courier changes |
| 7 | P0 | 3 | Implement GPS correction workflow with validation, marker movement, and persisted coordinate updates |
| 8 | P0 | 3 | Implement bulk route-date updates for runs and groups |
| 9 | P1 | 3 | Implement potential courier lookup/suggestion UI |
| 10 | P1 | 4 | Preserve filter/search/layout ergonomics for dispatch operators |
| 11 | P1 | 8 | Add Scheduled Routes module and connect it to parity workflows |
| 12 | P1 | 8 | Add Polygon Builder module over existing zone/polygon data model |
| 13 | P1 | 8 | Add Quoting module and define quote → operational handoff |
| 14 | P1 | 3 | Reconcile legacy stored procedure behaviour vs new service layer before cutting over |

---

## Step-by-step checklist

### 1. Freeze the parity target before more frontend polish

Create a page-by-page parity checklist from the legacy repo covering:
- filters
- job list
- grouped jobs
- run list
- run builder
- map
- job detail
- GPS form
- dispatch/send-to-live

If a shiny new screen does not cover those behaviours, it is incomplete.

### 2. Treat legacy Runbuilder as the source of truth for MVP scope

The minimum viable rebuild is not:
- route setup only
- recurring routes only
- scheduled-route setup only

The minimum viable rebuild is:
- **current Runbuilder parity**
- **plus** new modules for Quoting, Scheduled Routes, Polygon Builder

### 3. Preserve the legacy operational objects explicitly

The new app must keep first-class concepts for:
- job pool
- grouped jobs
- run
- run job / run membership
- route date
- courier assignment
- locked vs unlocked run
- send-to-live state transition
- geocode correction

### 4. Decide what is true parity vs intentional replacement

For every legacy behaviour, Kevin must label it as one of:
- **Direct parity** — same behaviour retained
- **Equivalent replacement** — different UI, same operational outcome
- **Deferred** — only if Steve explicitly signs off

Nothing should disappear silently because the new UI feels cleaner.

### 5. Review live mutation paths before service rewrite

Before replacing logic with fresh EF/services, Kevin should inspect actual behaviour around:
- `InsertRunJobs`
- `InsertOrUpdateRun`
- `DeleteRun`
- `UpdateJobDetail`
- `UpdateJobToRun`
- `DeleteBulkJobRun`
- `UpdateGps`
- `BulkUpdateRouteDate`
- `GetHereMapSequence`

### 6. Scheduled Routes should absorb recurring-route decisions already made

Reuse the existing route/schedule direction already documented in this repo. Do not invent a second schedule model.

### 7. Polygon Builder should sit on the existing zone/polygon data model

Use the existing zone/polygon tables surfaced by `DespatchContext.cs` as the operational domain anchor.

### 8. Quoting needs an explicit handoff into operations

Do not build quoting as a disconnected admin toy. Define how quote outputs influence:
- route assumptions
- scheduled route planning
- pricing references
- future operational setup

---

## Database tables and procedure surface

### EF/table surface already exposed by `DespatchContext.cs`

| Object | Purpose |
|---|---|
| `TblBulkJobs` | bulk/runbuilder job working set |
| `TblBulkJobRuns` | job ↔ run linkage |
| `TblBulkRuns` | persisted run header/state |
| `ZipPolygons` | polygon/zipcode domain |
| `ZoneCombos` | zone combination domain |
| `ZoneGroups` | zone grouping domain |
| `ZoneNames` | zone naming domain |
| `ZoneZips` | zone ↔ zip relationships |

### Stored procedures already surfaced by `DespatchContextProcedures.cs`

| Procedure | Purpose |
|---|---|
| `RVW_stpBulkRegionsAsync` | region filter data |
| `RVW_stpBulkSpeedsAsync` | speed filter data |
| `UTL_stpCourier_ActiveAsync` | active courier lookup |
| `UTL_stpJob_InsertFromRunBuilderAsync` | send runbuilder jobs into live flow |
| `UTL_stpJob_tblBulkJobAsync` | bulk job reads/ops |
| `UTL_stpJob_tblBulkJobRun_InsertOrUpdateAsync` | job ↔ run link mutation |
| `UTL_stpJob_tblBulkJobWithFilterAsync` | filtered job loading |
| `UTL_stpJob_tblBulkJob_SyncHDJobsAsync` | HD job sync |
| `UTL_stpJob_tblBulkRunAsync` | run reads/ops |
| `UTL_stpJob_tblBulkRunSettingsAsync` | run settings/config |
| `UTL_stpJob_tblBulkRunWithFilterAsync` | filtered run loading |
| `UTL_stpJob_tblBulkRun_DeleteAsync` | run delete |
| `UTL_stpJob_tblBulkRun_InsertOrUpdateAsync` | run create/update |

### Related existing recurring-route tables already documented elsewhere

These remain relevant for the **new Scheduled Routes layer**, not necessarily as the whole parity surface:
- `dbo.Routes`
- `dbo.RouteZipcodes`
- `dbo.Dispatch_RouteRoster`
- `dbo.tucJobBooking`
- `dbo.tucJob`
- `dbo.tblBulkRunSchedule`

---

## API endpoints summary

### Current legacy controller actions visible in repo

| Method area | Action | Purpose |
|---|---|---|
| `HomeController` | `Index` | Hub-auth tenant bootstrap and app shell |
| `JobController` | `Index` | job data endpoint base |
| `JobController` | `InsertRunJobs` | send built runs/jobs live |
| `JobController` | `GetRunSettings` | load run settings |
| `JobController` | `RegionList` | filter options |
| `JobController` | `SpeedList` | filter options |
| `JobController` | `SyncHDJobs` | sync operational job data |
| `JobController` | `GetFilter` | filtered job retrieval |
| `JobController` | `GetBulkRuns` | load persisted run data |
| `JobController` | `InsertOrUpdateRun` | save/update a run |
| `JobController` | `UpdateRun` | run update path |
| `JobController` | `DeleteRun` | remove persisted run |
| `JobController` | `UpdateJobDetail` | inline job edit save |
| `JobController` | `UpdateJobToRun` | move/link job to run |
| `JobController` | `DeleteBulkJobRun` | unlink/remove job from run |
| `JobController` | `UpdateGps` | save corrected coordinates |
| `JobController` | `BulkUpdateRouteDate` | batch reschedule route date |
| `RouteController` | `Index` | route endpoint base |
| `RouteController` | `RouteWithName` | routing helper |
| `RouteController` | `GetHereMapSequence` | sequence optimisation |
| `CourierController` | `Index` | potential/active courier data |

---

## Frontend/components in play

### Legacy screen composition

| Surface | File | What it does |
|---|---|---|
| App shell | `homeView.html` | pulls together filters, run list, builder, map, detail, forms |
| Filters | `tpls/pickDateForm.tpl` | date + client + region + speed + our-ref multi-select filtering |
| Run list | `tpls/runList.tpl` | sortable unlocked/locked runs with context menu |
| Run builder | `tpls/runBuilder.tpl` | active run jobs + totals + run order |
| Job list | `tpls/jobList.tpl` | available job pool / selection surface |
| Grouped jobs | `tpls/groupedJobs.tpl` | grouped/batch operations surface |
| Job detail | `tpls/jobDetail.tpl` | inline editable operational job detail |
| Map | `tpls/HereMap.tpl` | HERE/Google map routing/visualisation |
| Generic modal/form | `tpls/gatherForm.tpl` | shared input dialog plumbing |
| GPS correction | `tpls/gpsForm.tpl` | address/lat/lng/postcode correction workflow |

### Key Angular functions that prove operational scope

- `openSearch`
- `doPickDateService`
- `syncHDJobs`
- `dispatchJobsForm`
- `dispatchJobs`
- `getPotentialCouriers`
- `sendTo`
- `sendSelectedJobsToLive`
- `newRun`
- `runBuilderTotals`
- `routeRun`
- `calculateRunDetails`
- `showRun`
- `showJobs`
- `buildRunByPostalCode`
- `bulkUpdateRouteDate`
- `bulkUpdateGroupRouteDate`
- `toggleRunLock`
- `InsertOrUpdateRun`
- `DeleteRun`
- `updateGPS`
- `editDetailField`
- `updateDetailField`
- `callRouteSavvy`

---

## Key questions answered

### Can we treat RouteBuilder rebuild as just recurring route management?
No.

That was the miss. The legacy tool is a broader run-building/dispatch workspace.

### What is the real parity target?
The current `runbuilder` GitLab repo.

### What absolutely must survive the rebuild?
At minimum:
- filtered job loading
- grouped job operations
- run CRUD
- run builder metrics
- route sequencing
- job-to-run movement
- lock/unlock
- send-to-live / dispatch
- potential courier lookup
- job detail editing
- GPS correction
- bulk route-date changes

### Where do Scheduled Routes fit?
As a **new module on top of parity**, while also reusing the recurring-route/schedule decisions already documented elsewhere.

### Where does Polygon Builder fit?
As the editable UI/admin layer over the existing zone/polygon domain already present in the data model.

### Where does Quoting fit?
As a net-new upstream commercial/planning module that must have a clear handoff into operational route/run setup.

### Are we allowed to drop legacy behaviours because the new UI looks better?
No.

Any dropped behaviour needs explicit signoff as a deliberate scope cut.

---

## Testing checklist

### Parity verification
- [ ] Filter by date/client/region/speed/our-ref and confirm working-set load matches legacy expectations
- [ ] Create a new draft run
- [ ] Add jobs from list into run
- [ ] Add grouped jobs into run
- [ ] Move jobs between runs
- [ ] Remove a job from a run without losing the job from the available working set incorrectly
- [ ] Route a run and confirm sequence order, kms, mins, and totals update
- [ ] Lock a run and persist it
- [ ] Unlock/delete a persisted run and confirm behaviour is intentional
- [ ] Send selected locked runs live
- [ ] Dispatch selected jobs to a courier
- [ ] Request potential couriers and confirm suggestion surface works
- [ ] Edit job detail fields and confirm persistence
- [ ] Fix bad GPS/address data and confirm persistence + map refresh
- [ ] Bulk change route date for a run
- [ ] Bulk change route date for a grouped-job set
- [ ] Confirm geocode-warning state for jobs without coordinates remains visible

### New-module verification
- [ ] Quoting flow exists and has a defined handoff into operations
- [ ] Scheduled Routes can drive operational route/run setup
- [ ] Polygon Builder can maintain the required polygon/zone coverage data

### Cutover safety
- [ ] Every legacy behaviour is tagged as direct parity, equivalent replacement, or explicit defer
- [ ] No legacy live-mutation path has been silently removed
- [ ] Hub auth / tenant context is reused correctly

---

## Bottom line

**Kevin should build the replacement against the current Runbuilder tool, not against the narrower recurring-routes interpretation.**

If the new RouteBuilder cannot do the operational work the current `runbuilder` does, the rebuild is not done — even if the UI looks much better.
