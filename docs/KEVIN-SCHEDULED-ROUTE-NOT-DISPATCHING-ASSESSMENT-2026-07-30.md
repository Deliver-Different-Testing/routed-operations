# Kevin — Scheduled Route Not Dispatching Assessment (2026-07-30)

## Problem

Steve asked whether routed auto-dispatch is deliberately waiting for a schedule to "go live" before assigning jobs.

Current code does **not** show any separate "go live" / "published" / "live schedule" rule.

What it does show is that the recurring-route flow is only partially wired, so the more likely reason jobs are not dispatching is that the materialisation + assignment path is still incomplete.

## Short answer

There is **no current rule** that says:
- do not assign until the schedule becomes live

What does exist:
- `tblRecurringRoute.IsActive`
- `GET /api/scheduled-routes?activeOnly=true` filtering on `IsActive`
- `POST /api/scheduled-routes/{id}/build-now`

But the actual build and assignment steps behind that are still stubs / partial implementations.

## Code reviewed

### Scheduled route entity
- `v2/backend/Entities/TblRecurringRoute.cs`

Key fields:
- `RecurringRouteId`
- `Name`
- `Frequency`
- `TimeWindowStart`
- `TimeWindowEnd`
- `IsActive`
- `LastBuiltUtc`

There is **no** field like:
- `IsLive`
- `GoLiveUtc`
- `PublishedUtc`
- `EffectiveFromUtc`

### Scheduled route service
- `v2/backend/Services/ScheduledRouteService.cs`

Current behaviour:
- `GetAllAsync(bool activeOnly)` filters only on `IsActive`
- `CreateAsync(...)` creates the route with `IsActive = true`
- `BuildNowAsync(int id)` is still a stub

Current `BuildNowAsync(...)` behaviour:
- logs `BuildNow is a stub — wire engine in Phase 1.6`
- loads the recurring route
- sets `LastBuiltUtc = DateTime.UtcNow`
- saves
- returns `true`

That means **Build Now currently updates metadata only**. It does not actually:
- find candidate jobs
- create a run
- attach jobs to the run
- assign pickups
- assign a courier
- dispatch anything

### Run service
- `v2/backend/Services/RunService.cs`

Important gaps:

#### `CreateRunAsync(...)`
Creates a `tblBulkRun` and attaches only `tblBulkJob` stops.

It explicitly says:
- `Phase 1: only attach bulk jobs to runs. tucJob/tucJobBooking attach is Phase 2 work.`

So if the expectation is that live `tucJob` / `tucJobBooking` work should get routed through this path, that is not implemented here.

#### `AssignPickupToRunAsync(...)`
Still stubbed.

Code comment says:
- `AssignPickupToRun is not implemented yet — Phase 1 stub`

It currently returns `false`.

#### `AutoMatchPickupsByZipAsync(...)`
Still stubbed.

Code comment says:
- iterate today's pickups
- find runs whose deliveries share the same zip
- call `AssignPickupToRunAsync(...)`

It currently returns `false`.

## Current likely failure point

The likely issue is not a hidden "not live yet" rule.

The likely issue is that this chain is incomplete:

1. recurring route exists in `tblRecurringRoute`
2. route is marked active
3. user clicks / triggers build
4. system should find today's candidate jobs for that route
5. system should materialise a `tblBulkRun`
6. system should attach matching jobs / pickups
7. system should optionally assign a courier
8. system should dispatch / surface the result operationally

At the moment:
- step 3 exists as an endpoint
- step 4 is TODO
- step 5 is only partially available
- step 6 is incomplete
- step 7 is manual only (`AssignCourierAsync` exists if a run already exists)
- step 8 is not present in this reviewed path

## Likely reason jobs are not dispatching

Based on current code, the most probable reasons are:

### 1. `BuildNow` does not build
`ScheduledRouteService.BuildNowAsync(...)` does not call any route-build engine yet.

### 2. live job attachment is not wired
`RunService.CreateRunAsync(...)` only attaches `tblBulkJob` stops, not live `tucJob` / `tucJobBooking` rows.

### 3. pickup auto-match is not implemented
`AutoMatchPickupsByZipAsync(...)` and `AssignPickupToRunAsync(...)` are both stubs.

### 4. `IsActive` is only a list filter, not a dispatch gate
The only state-style gate visible here is `IsActive`, and it controls whether the route shows up in active queries. It is not a separate "wait until live" dispatch rule.

## Existing doc trail this aligns with

This is consistent with earlier handover notes already in the repo:
- `docs/HANDOVER-KEVIN-ROUTEBUILDER-V2-PHASE1-2026-06-14.md`

That doc already flags several related areas as TODO, including:
- scheduled route build-now wiring
- pickup auto-match by zip
- data-model side of pickup/run linkage

So this note is not a new design direction — it is a focused assessment of why Steve is seeing non-dispatching behaviour now.

## What Kevin should assess next

### A. Confirm intended source jobs for scheduled-route materialisation
Need a clear decision on whether scheduled routes should materialise from:
- `tblBulkJob` only
- `tucJob` / `tucJobBooking`
- or a mixed pipeline

Right now the code is still biased toward `tblBulkJob`.

### B. Wire `BuildNowAsync(...)` properly
Expected implementation path:
- load recurring route + zips
- find today’s candidate jobs matching the route geography / schedule window
- call `IRunService.CreateRunAsync(...)`
- update `LastBuiltUtc`
- return meaningful success/failure

### C. Decide pickup/run linkage design
Current comment in `AssignPickupToRunAsync(...)` suggests two options:
- materialise pickups into `tblBulkJob` shim rows, or
- add a dedicated join table like `tblBulkPickupRun(BulkRunId, PickupSource, PickupId)`

The second option still looks cleaner.

### D. Confirm whether "dispatching" here means one of two things
Kevin should confirm whether Steve means:
1. **materialise into a run** inside Routed Operations, or
2. **actually dispatch to a courier / live despatch state**

Those are not the same step, and current code only partially covers the first one.

## Acceptance criteria for Kevin’s assessment

- Confirm whether any hidden live/go-live rule exists outside the reviewed routed-operations code.
- Confirm the intended source tables for scheduled-route job materialisation.
- Confirm why a currently active recurring route is not producing dispatchable runs.
- Identify the exact first missing implementation step in the current path.
- Recommend whether to finish the current recurring-route pipeline or change the model before continuing.

## File references

- `v2/backend/Entities/TblRecurringRoute.cs`
- `v2/backend/Services/ScheduledRouteService.cs`
- `v2/backend/Services/RunService.cs`
- `v2/backend/Controllers/ScheduledRoutesController.cs`
- `v2/backend/Controllers/RunsController.cs`
- `docs/HANDOVER-KEVIN-ROUTEBUILDER-V2-PHASE1-2026-06-14.md`
