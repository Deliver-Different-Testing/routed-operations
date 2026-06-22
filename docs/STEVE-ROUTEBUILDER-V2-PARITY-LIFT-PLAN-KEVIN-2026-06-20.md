---
title: RouteBuilder v2 — Parity Lift Plan (SPs → application layer)
author: Steve via Claude
date: 2026-06-20
audience: Kevin
sibling docs:
  - STEVE-RUNBUILDER-V2-SCOPING-2026-06-13.md
  - HANDOVER-KEVIN-ROUTEBUILDER-V2-PHASE1-2026-06-14.md
status: Phase 2 brief — landing the legacy SP-driven functionality in the v2 application layer (no AngularJS port; the existing React frontend in `/v2/frontend` covers the operator surface)
---

# RouteBuilder v2 — Parity Lift Plan (SPs → application layer)

> **Why this doc.** Steve's call (2026-06-20): "*The new RouteBuilder needs to shift the underlying stored procs to drive the new frontend basic route building as this currently works based on postcode groups. What we talked about was making recommendations of where to lift the SPs into an application layer. So please bring the existing functionality into the new build — just not the AngularJS frontend.*"
>
> Phase 1 (per [`HANDOVER-KEVIN-ROUTEBUILDER-V2-PHASE1-2026-06-14.md`](./HANDOVER-KEVIN-ROUTEBUILDER-V2-PHASE1-2026-06-14.md)) landed the scaffold (Polygons, Quoting, Scheduled Routes, Cockpit). This Phase 2 brief takes the **legacy SP surface** documented at root (`Models/DespatchContextProcedures.cs`, `Models/Repository/*.cs`, `Controllers/JobController.cs`, `Controllers/RouteController.cs`, `Controllers/CourierController.cs`) and maps each SP to a recommended **EF + application service** lift target inside `/v2/backend`.
>
> AngularJS templates at `wwwroot/app/components/home/tpls/` are **not ported**. The React surfaces under `/v2/frontend/src/pages/` cover the operator workflow.

---

## 1. The legacy postcode-group flow (what we're preserving)

The legacy operator workflow:

1. Operator opens RunBuilder, picks a run date.
2. RunBuilder pulls **regions** (postcode groups) for that date — `RVW_stpBulkRegions`.
3. RunBuilder pulls **speeds** — `RVW_stpBulkSpeeds`.
4. Operator selects region(s) + speed(s) + clients + ourRefs as a filter.
5. RunBuilder pulls jobs for the filter — `UTL_stpJob_tblBulkJobWithFilter`.
6. RunBuilder pulls runs for the filter — `UTL_stpJob_tblBulkRunWithFilter`.
7. Operator drags jobs onto runs; map view sequences them (RouteSavvy + HereMap).
8. Operator assigns a courier from the active list — `UTL_stpCourier_Active`.
9. Run upserts to `tblBulkRun` — `UTL_stpJob_tblBulkRun_InsertOrUpdate`; job→run rows upsert to `tblBulkJobRun` — `UTL_stpJob_tblBulkJobRun_InsertOrUpdate`.
10. Commit lifts the bulk-stage records into live job rows — `UTL_stpJob_InsertFromRunBuilder` (called per job).
11. Hand-deliver sync where needed — `UTL_stpJob_tblBulkJob_SyncHDJobs`.

**Postcode groups are the load-bearing concept** — the entire filter + map layout pivots off the `BulkRegion` rows. Preserve this model in v2; don't redesign it.

---

## 2. SP-by-SP lift recommendations

For each legacy SP: (a) what it does, (b) recommended EF/service replacement, (c) target v2 controller, (d) the React page that consumes it.

### 2.1 Read-side SPs (simple lifts — straight EF queries)

| Legacy SP | What it returns | Recommended lift | Target controller | React page |
|---|---|---|---|---|
| `RVW_stpBulkRegions(runDate)` | Postcode-group regions available for a run date | `BulkRegionService.GetForRunDateAsync(date)` — EF query against `BulkRegion` filtered by `IsActive` and any date-window column. **Preserve the SP-side filter logic**; port the WHERE clause as a LINQ predicate. | `RegionsController` (new) — `GET /api/v2/regions?runDate=…` | `RoutesPage.tsx` filter bar |
| `RVW_stpBulkSpeeds(runDate)` | Speed catalogue for a run date | `SpeedService.GetForRunDateAsync(date)` — same approach as Regions | `SpeedsController` (new) — `GET /api/v2/speeds?runDate=…` | `RoutesPage.tsx` filter bar |
| `UTL_stpCourier_Active()` | Active couriers (for assignment) | `CourierService.GetActiveAsync()` — EF query against `tucCourier WHERE Active = 1` + light projection. Fold into the existing `FleetsController` if cleaner, or split into a new `CouriersController`. | `FleetsController` extension OR new `CouriersController` — `GET /api/v2/couriers/active` | `JobDetailModal.tsx` + `EditRunScopeModal.tsx` courier picker |
| `UTL_stpJob_tblBulkRunSettings()` | Run-builder settings (defaults — courier-percentage default, run-name pattern, etc.) | `RunSettingsService.GetAsync()` — single-row read from a settings table (or `tblBulkRunSetting`). If the SP merges values from multiple sources, port the merge into the service. | `SettingsController` (new) — `GET /api/v2/runbuilder/settings` | `SettingsDrawer.tsx` |

### 2.2 Filter-driven read SPs (postcode-group flow)

| Legacy SP | What it returns | Recommended lift | Target controller | React page |
|---|---|---|---|---|
| `UTL_stpJob_tblBulkJobWithFilter(date, clientIds, regions, ourRefs, speeds)` | Bulk jobs that match the filter, joined to whatever the SP joins (likely BulkRegion, Speed, Client). | `JobService.GetBulkJobsForBuilderAsync(JobsQuery query)` — EF query with the same join graph and predicate set. **Pay attention to the SP's join shape** — it likely projects courier hints / pickup zone / postcode group; port those as a DTO. | `JobsController` — `GET /api/v2/jobs/bulk?date=…&clientIds=…&regions=…&speeds=…&ourRefs=…` | `RoutesPage.tsx` left rail (jobs to assign) |
| `UTL_stpJob_tblBulkRunWithFilter(date, clientIds, regions, ourRefs, speeds)` | Bulk runs (with their jobs and courier) that match the filter | `RunService.GetBulkRunsForBuilderAsync(RunsQuery query)` — EF query with `Include(r => r.Jobs).Include(r => r.Courier)`. Same predicate set as the jobs query so the two surfaces stay in sync. | `RunsController` — `GET /api/v2/runs/bulk?date=…&clientIds=…&regions=…&speeds=…&ourRefs=…` | `RoutesPage.tsx` right rail (runs being built) |
| `UTL_stpJob_tblBulkJob(date, clientID)` and `UTL_stpJob_tblBulkRun(date, clientID)` | Simpler unfiltered variants (client-only) | Drop. The `WithFilter` versions above cover the case (pass empty filters). Keep one call path. | — | — |
| `Job/GetFilter(runDate)` (controller, persists saved filters per operator) | Last-used filter for an operator | `RunBuilderFilterService.GetForCurrentUserAsync(date)` — read/write against a per-user settings row (new small table `tblBulkRunBuilderFilter` if not yet present). | `SettingsController` — `GET/PUT /api/v2/runbuilder/filter` | `RoutesPage.tsx` filter bar (load + save) |

### 2.3 Write-side SPs (run building)

| Legacy SP | What it does | Recommended lift | Target controller | React page |
|---|---|---|---|---|
| `UTL_stpJob_tblBulkRun_InsertOrUpdate(runID, name, mins, kms, courierID, status, revenue, payout, courierPercentage, googleRouteResponse)` | Upsert a run header. | `RunService.UpsertRunAsync(RunUpsertDto dto)` — EF Add/Update on `TblBulkRun`. **`googleRouteResponse` is a large NVARCHAR(MAX) blob from RouteSavvy/HereMap** — keep that column shape; don't normalise. | `RunsController` — `POST/PUT /api/v2/runs/bulk` | `RoutesPage.tsx` save action |
| `UTL_stpJob_tblBulkRun_Delete(runID)` | Soft-delete a run + cascade child rows | `RunService.DeleteAsync(int runId)` — verify whether the SP does soft (`IsActive = 0`) or hard delete + which child rows it touches (likely `tblBulkJobRun`). Match the behaviour. | `RunsController` — `DELETE /api/v2/runs/bulk/{id}` | `RoutesPage.tsx` context menu |
| `UTL_stpJob_tblBulkJobRun_InsertOrUpdate(runID, bulkJobID, runOrder)` | Assign a job to a run (or update its order) | `RunService.AssignJobToRunAsync(runId, bulkJobId, order)` — EF upsert on `TblBulkJobRun` with a unique key on `(RunId, BulkJobId)`. Update `runOrder` when the row exists. | `RunsController` — `POST /api/v2/runs/bulk/{id}/jobs` and `PUT …/{jobId}/order` | `RoutesPage.tsx` drag-and-drop |
| `UTL_stpJob_InsertFromRunBuilder(bulkJobID, courierID, runName, runOrder, courierPercentage, runStatus)` | **Critical:** lifts a built bulk-stage job into the live job table (`tucJob` + audit + status transitions + maybe `tucEvent` rows) | `RunCommitService.CommitJobToLiveAsync(CommitJobCommand cmd)` — **port this carefully**. Likely does: insert into `tucJob`, write `tucEvent` audit row, possibly update `tblBulkJob.Status`. Verify each side-effect with `sp_helptext` before porting. Wrap the whole lift in a transaction. | `RunsController` — `POST /api/v2/runs/bulk/{id}/commit` (commits all jobs in the run in one call) | `RoutesPage.tsx` Commit action |
| `UTL_stpJob_tblBulkJob_SyncHDJobs(bookDate)` | Sync hand-deliver jobs for a date (lifts hand-deliver bookings into `tblBulkJob`) | `HdJobSyncService.SyncForDateAsync(date)` — likely SELECT + INSERT pattern across `tucJobBooking` (hand-deliver) → `tblBulkJob`. Port the SQL as a service method; preserve the duplicate-detection logic. | `JobsController` — `POST /api/v2/jobs/sync-hd?date=…` | `RoutesPage.tsx` "Sync HD" button |

### 2.4 Repository-layer endpoints (no SP — already application code)

These exist in `Models/Repository/JobRepository.cs` and friends as EF code today, but aren't yet on the v2 controllers. Lift wholesale.

| Legacy endpoint | What it does | Target v2 controller |
|---|---|---|
| `JobController.BulkUpdateRouteDate` (`POST /Job/BulkUpdateRouteDate`) | Bulk-move multiple runs to a new date | `RunsController.BulkMoveDate` — `POST /api/v2/runs/bulk/move-date` |
| `Models/Requests/UpdateGpsRequest.cs` (called from `JobRepository`) | Update GPS coordinates on a job | `JobsController.UpdateGps` — `PUT /api/v2/jobs/bulk/{id}/gps` |
| `Models/Requests/UpdateJobDetailRequest.cs` | Edit job detail inline | `JobsController.UpdateDetail` — `PUT /api/v2/jobs/bulk/{id}` |
| `Models/Requests/UpdateJobToRunRequest.cs` | Reassign a job to a different run | `RunsController.MoveJob` — `POST /api/v2/runs/bulk/{from}/jobs/{jobId}/move-to/{to}` |
| `Models/Requests/VoidJobsRequest.cs` | Void jobs (mark cancelled) | `JobsController.Void` — `POST /api/v2/jobs/bulk/void` |

### 2.5 External-integration controllers (RouteSavvy + HereMap)

| Legacy controller | What it does | Recommended lift | Target controller | React page |
|---|---|---|---|---|
| `RouteController.Index` (`POST /Route`) | RouteSavvy waypoint optimization | `RouteOptimizationService.OptimizeAsync(IList<Waypoint>)` — wrap the existing `RouteSavvyRequest`/`RouteSavvyResponse` HTTP client. **Keep the API key in user-secrets / appsettings, not committed.** | `RouteOptimizationController` — `POST /api/v2/routing/optimize` | `HereMap.tsx` re-sequence action |
| `RouteController.RouteWithName` (`POST /Route/RouteWithName`) | Same as above with named waypoints | Fold into `OptimizeAsync` — add an optional `name` field to the `Waypoint` DTO. One service, one endpoint. | `RouteOptimizationController` | `HereMap.tsx` |
| `RouteController.GetHereMapSequence` (`POST /Route/GetHereMapSequence`) | HereMap multi-stop sequencing | `HereMapService.GetSequenceAsync(HereMapSequenceRequest req)` — wrap the existing `HereMapSequenceResponse` HTTP client. Same API-key handling. | `RouteOptimizationController.HereSequence` — `POST /api/v2/routing/here-sequence` | `HereMap.tsx` |

The `googleRouteResponse` blob column on `tblBulkRun` keeps the persisted route shape so v2 can render the cached sequence without re-hitting the optimizer on every load. Preserve that pattern.

---

## 3. Suggested service-layer structure inside `/v2/backend`

Following the configurator's `Core/Application/Services/<Domain>/<DomainService>.cs` shape so the same operator pattern is used:

```
v2/backend/
├── Controllers/
│   ├── (existing) FleetsController, JobsController, PolygonsController, QuoteController, RunsController, ScheduledRoutesController
│   ├── RegionsController                  (NEW — §2.1)
│   ├── SpeedsController                   (NEW — §2.1)
│   ├── CouriersController                 (NEW — §2.1; merge into FleetsController if you prefer fewer controllers)
│   ├── SettingsController                 (NEW — §2.1 + §2.2 saved filter)
│   └── RouteOptimizationController        (NEW — §2.5)
├── Services/
│   ├── (existing) FleetService, JobService, PolygonService, QuoteService, RunService, ScheduledRouteService
│   ├── BulkRegionService                  (NEW — RVW_stpBulkRegions)
│   ├── SpeedService                       (NEW — RVW_stpBulkSpeeds)
│   ├── CourierService                     (NEW — UTL_stpCourier_Active)
│   ├── RunSettingsService                 (NEW — UTL_stpJob_tblBulkRunSettings)
│   ├── RunBuilderFilterService            (NEW — saved filters)
│   ├── RunCommitService                   (NEW — UTL_stpJob_InsertFromRunBuilder)
│   ├── HdJobSyncService                   (NEW — UTL_stpJob_tblBulkJob_SyncHDJobs)
│   ├── RouteOptimizationService           (NEW — RouteSavvy)
│   └── HereMapService                     (NEW — HereMap sequence)
├── Dtos/
│   └── (one DTO file per service)
└── Entities/
    ├── (existing) TblBulkJob, TblBulkJobRun, TblBulkRun, etc.
    ├── BulkRegion                         (if not already in v2)
    └── tblBulkRunSetting                  (if not already mapped)
```

Each service owns its own EF queries; controllers stay thin (parse, call service, return DTO).

---

## 4. Suggested phasing

### Phase 2a — Postcode-group filter bar (1–2 days)

Land the read-only filter surface so the React UI can populate dropdowns and start showing real data:

1. `BulkRegionService.GetForRunDateAsync` + `RegionsController`.
2. `SpeedService.GetForRunDateAsync` + `SpeedsController`.
3. `CourierService.GetActiveAsync` (or extend `FleetsController`).
4. `RunSettingsService.GetAsync` + `SettingsController`.
5. Wire `RoutesPage.tsx` filter bar to the four new endpoints.

End state: operator can pick a date + filter, but the jobs/runs lists below still use Phase 1 mock data.

### Phase 2b — Jobs + Runs filter-driven read (2–3 days)

Lift the two big SPs:

1. `JobService.GetBulkJobsForBuilderAsync` (port `UTL_stpJob_tblBulkJobWithFilter` to EF). Verify the join graph and the projection columns by running both side-by-side against staging for the same filter.
2. `RunService.GetBulkRunsForBuilderAsync` (port `UTL_stpJob_tblBulkRunWithFilter`).
3. Wire `RoutesPage.tsx` jobs rail + runs rail to the new endpoints.

End state: operator sees real jobs + runs for any postcode-group filter combination. No write actions yet.

### Phase 2c — Write surfaces (3–5 days)

1. `RunService.UpsertRunAsync` + endpoint.
2. `RunService.AssignJobToRunAsync` + endpoint.
3. `RunService.DeleteAsync` + endpoint.
4. Wire the drag-and-drop + save actions on `RoutesPage.tsx`.

End state: operator can build and save runs end-to-end in v2 (against bulk-stage tables — no live commit yet).

### Phase 2d — Live commit + sync + integrations (3–5 days)

1. **`RunCommitService.CommitJobToLiveAsync`** — the critical port (verify side-effects via `sp_helptext` first; wrap in a transaction).
2. `HdJobSyncService.SyncForDateAsync` + endpoint + the "Sync HD" button on `RoutesPage.tsx`.
3. `RouteOptimizationService` (RouteSavvy) + `HereMapService` + `HereMap.tsx` integration.
4. `RunsController.BulkMoveDate` + the bulk date-move UI.
5. `JobsController.UpdateGps`, `UpdateDetail`, `Void` + `RunsController.MoveJob` (drag between runs).

End state: parity for the postcode-group route-building flow. DF Admin can start considering tenant cutovers.

### Phase 2e — Saved filters + polish

- `RunBuilderFilterService` + endpoint + save/load on the filter bar.
- Operator settings, defaults, courier-percentage etc.
- Any AngularJS-specific UX patterns (event form, GPS form, gather form) that genuinely need React equivalents — confirm with Steve which still matter before building them.

### Phase 3 — Dynamic / rolling route-building mode (new planning mode, not a replacement for batch mode)

**Why this phase exists.** The legacy RunBuilder was built for **batch/prebuild planning**: large datasets received well ahead of delivery day, routes built outbound from depot, and runs optimised in advance. RouteBuilder must still preserve that mode, but it also now needs a second **dynamic / rolling** mode where delivery data accumulates from multiple sources and draft runs evolve over time.

#### 3.1 Product rule

RouteBuilder must support **two planning strategies on the same domain model**:

1. **Batch / Prebuild mode** — current RunBuilder parity
   - operator has a known working set for a future date
   - postcode groups / region filters still matter
   - bulk runs are built ahead of service
   - full-run optimisation + lock/commit flow remains valid

2. **Dynamic / Rolling mode** — new capability
   - jobs arrive progressively from multiple inbound sources
   - jobs may need to sit in a staging pool before assignment
   - the system should recommend whether to hold, append to a draft run, or create a new draft run
   - re-optimisation should happen selectively, not on every single new stop
   - fixed times, target delivery windows, furthest-destination rules, round-trip rules, and fixed-final-destination rules must be first-class constraints

**Important:** do **not** try to force dynamic-mode decisioning into the legacy postcode-group SP logic. Preserve batch parity, but implement dynamic planning logic as a new application-layer planner.

#### 3.2 Backend scope for Phase 3

Add a planning layer alongside the parity-lift services:

- `PlanningMode` enum / strategy selection (`Batch`, `Dynamic`)
- `DynamicPlanningService`
- `DraftRunRecommendationService`
- `RunReoptimizationService`
- `InboundJobIngestionService` (only if needed now; otherwise define the interface and DTOs)
- `ConstraintScoringService` (or equivalent internal helper)

Suggested new DTO/domain concepts:

- `InboundStopDto`
- `DynamicPlanningRequest`
- `DraftRunCandidateDto`
- `RunConstraintProfileDto`
- `PlanningRecommendationDto`

Minimum new job/stop data the planner must understand:

- source system
- received timestamp
- geocoded address / lat-lng
- ready-from / target-delivery / deliver-by values
- service minutes
- priority
- origin/depot
- round-trip required flag
- fixed final destination
- sequence constraints (must-be-first / must-be-last if applicable)

#### 3.3 Frontend / UI scope for Phase 3

We can and should do planning + UX work here **before** the full optimiser exists.

Add a dynamic-mode planning surface in the React app:

- mode switch or separate entry point: `Batch` vs `Dynamic`
- **Unplanned / inbound jobs rail**
- **Draft runs rail**
- recommendation panel showing:
  - hold for density
  - add to existing draft run
  - create new run
  - re-optimise draft run
- run state badges: `Unplanned`, `Draft`, `Suggested`, `Confirmed`, `Locked`, `Dispatched`
- explicit operator controls for:
  - accept recommendation
  - force assignment manually
  - freeze/lock a draft run
  - exclude a run from auto-replan

This UI can be scaffolded with mocked planner recommendations initially, as long as the doc clearly marks it as **dynamic-mode scaffolding** rather than fake parity work.

#### 3.4 Recommended order inside Phase 3

1. **Domain + DTO pass**
   - add planning-mode enum and dynamic planner interfaces
   - define job/run constraint DTOs
2. **UI discovery / operator workflow pass**
   - build the dynamic-mode screen states with mocked recommendation responses
   - confirm the operator workflow with Steve before deep algorithm work
3. **Decision engine pass**
   - implement assignment/hold/create-new-run recommendation logic in the application layer
   - start with deterministic heuristic scoring, not full autonomous optimisation
4. **Optimiser pass**
   - evaluate whether external optimisation remains only a distance/time provider while run decisioning becomes in-house
   - assess OR-Tools / VROOM / similar options for internal constrained optimisation
5. **Integration pass**
   - connect live inbound data sources
   - persist draft-run states and re-optimisation rules

#### 3.5 Explicit Kevin instruction

For Kevin: **finish batch parity first enough that the current operational RunBuilder use case is preserved, but start Phase 3 planning/UI work in parallel where it does not block parity delivery.** Dynamic mode is an additive planning strategy, not a rewrite of the batch mode.

---

## 5. What's NOT being ported (deliberately)

- **AngularJS templates at `wwwroot/app/components/home/tpls/`** — all of them. `runBuilder.tpl`, `jobList.tpl`, `runList.tpl`, `gatherForm.tpl`, `gatherFormMulti.tpl`, `eventForm.tpl`, `gpsForm.tpl`, `pickDateForm.tpl`, `map.tpl`, `HereMap.tpl`, `groupedJobs.tpl`, `jobDetail.tpl`, `potentialCouriers.tpl`, `potentialCourierFleets.tpl`. The React pages under `/v2/frontend/src/pages/` are the replacement.
- **The `app/components/home/api/*.php` and `*.json` stubs** in the legacy frontend — those are dead mock paths from the original Angular wiring.
- **Anything in `Controllers/HomeController.cs` not on the SP/repository list above** — `About`, `Contact`, `Index` view stubs. React's `Shell.tsx` takes over routing.

---

## 6. Verification approach

Before declaring any phase done, **run the same filter / action against the legacy app on staging and the v2 endpoint side-by-side**, diff the row sets, and confirm the v2 numbers match. Pay particular attention to:

- Region filter: which regions show on a given run date — slight differences in the SP's date-window logic vs. an EF LINQ predicate are the most common porting bug.
- `UTL_stpJob_InsertFromRunBuilder` — the live-commit SP. Use staging to commit a run via legacy and a separate run via v2 for the same inputs; verify the resulting `tucJob` row + audit trail are identical (or document the deltas if v2 intentionally improves the model).
- `UTL_stpJob_tblBulkJob_SyncHDJobs` — sync runs should produce identical row counts. If they don't, the duplicate-detection logic in the SP is doing something subtle worth porting verbatim.

---

## 7. Open questions for Steve before Phase 2 starts

1. **`UTL_stpJob_InsertFromRunBuilder` side-effects.** The legacy SP probably writes audit rows (`tucEvent` etc.) and updates statuses on adjacent tables. Confirm via `sp_helptext` whether the v2 service should preserve those side-effects 1:1 or whether v2 can use a cleaner event-bus pattern (`IDomainEvent` + handlers) and skip the inline writes.
2. **Saved filters per-user.** Today legacy stores filters somewhere — does it have its own table, or are they wedged into `tblBulkRunSetting`? If the latter, Phase 2e should split them out.
3. **RouteSavvy vs. HereMap.** Both integrations exist in legacy. Which is the canonical sequencer going forward? If both stay, where does the operator choose, and is one a fallback?
4. **Gather form / GPS form / event form** — these are AngularJS-side surfaces; confirm if any of them need React equivalents or if they were always tangential to the route-building flow.
