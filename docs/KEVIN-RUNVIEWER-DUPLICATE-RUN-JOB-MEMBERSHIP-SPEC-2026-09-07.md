---
title: Kevin RunViewer duplicate RNO200 run / job membership spec
created: 2026-09-07
updated: 2026-09-08
status: Decision + minimal time-boxed fix for the Route 5 / RNO200 Runviewer bug report
source: Kenneth bug report (Route 5 / RNO200, NeoGenomics corridor) + Kevin investigation + Steve direction + code trace
bug_report: https://docs.google.com/document/d/1ABXBw2LE7xpQW58EyhjdfCPHjv1_ofPx/edit?usp=sharing
code_traced:
  - https://github.com/Deliver-Different-Testing/runviewer (branch feat/runviewer-recurring-routes, 2233d0c)
  - https://github.com/Deliver-Different-Testing/dbmigrationsv2 (DatabaseScripts/Migrations/20260528100000_RvwOverviewIncludeLhpDeliveryRegion.sql)
related_docs:
  - KEVIN-LEGACY-RUNBUILDER-FIXES-SPEC-2026-06-23.md
  - KEVIN-RUNVIEWER-OFFSETS-ADMIN-LINEHAUL-SPEC-2026-06-25.md
  - KEVIN-SCHEDULED-ROUTE-NOT-DISPATCHING-ASSESSMENT-2026-07-30.md
---

# Kevin RunViewer duplicate RNO200 run / job membership spec

## Read this first: scope constraint

**RunViewer is being deprecated once Routed Operations ships.** Steve does not want a lot of Kevin's time going into it.

So this is a **time-boxed patch, not a redesign**:

- budget: **half a day**, all in
- no new UX (no Option A / Option B labelling work)
- no shared-membership-rule refactor
- no SQL change unless the two client-side fixes below do not close the gap
- the "one route, one row" presentation question moves to the **Routed Operations Route Viewer** backlog

If the fixes below take longer than the budget, stop and report rather than keep digging.

---

## Feature overview

Kevin reported three issues on Route 5 / RNO200 and asked for a decision on the first:

1. `RNO200` appears twice in the Run List: one `LIVE` / Dane Test `123`, one `READY` / unassigned with 7 jobs.
2. `P2891DEL` (assigned to courier `123`) appears in the expanded job list of the `READY` / unassigned run, so the row says 7 and the expanded list shows 8.
3. `P2891DEL` sits under the Reno depot instead of Burbank because its location data points at Reno while its address text says Burbank.

Steve's direction on reading the report:

> We should never see the same job number replicated on a run. It seems the filtering is the issue. How can a job show as assigned and unassigned at the same time?

The code trace below confirms that read. Bugs 1 and 2 are one defect: the two `RNO200` rows share the same run id, and the RunViewer client has paths that select or expand by run id alone. Bug 2 is that overlap made visible.

---

## Decisions

1. **Invariant.** A job number appears in exactly one expanded run for a given despatch date. That is the acceptance bar.
2. **Fix the two concrete divergences found in the code (section 2), nothing more.** Both are client-side edits in the `runviewer` repo. Estimated 2 to 3 hours including a staging check.
3. **Bug 1 presentation: no work in RunViewer.** The two rows are correct data (route + date + courier) and the Courier column already shows `Unassigned` versus `Dane Test : 123`. Neither Option A nor Option B is built in RunViewer. The single-row-per-route question is logged for Routed Operations' Route Viewer, where the run model is being rebuilt anyway.
4. **Bug 3 stays a booking-data investigation, capped at one hour.** Find how `P2891DEL` was created differently from `P2893DEL` / `P2894DEL`, fix the one job's data, and log the "depot filter keys on location, not pickup/delivery direction" limitation as a Routed Operations item. Do not change depot-filter semantics in RunViewer.

---

## 1. What the code actually does today

### Where the two lists come from

| Surface | RunViewer call | Stored procedure | Notes |
|---|---|---|---|
| Run List rows + counts | `HomeController.BulkRunList` -> `RunRepository.JobRunList` | `RVW_stpBulkRuns_2` | receives `@Regions` (depot filter) |
| Expanded job list for one row | `HomeController.BulkRunJobs` -> `RunRepository.RunJobs` | `RVW_stpBulkRunJobs` | **never receives `@Regions`** |

Recurring-route runs such as `RNO200` are "synthetic" runs. The SP builds one row per **route + courier** from `tucJob` where `RouteId` is set, with `ID = -RouteId`. That is why both `RNO200` rows carry the same negative id. The courier split is the intended design from the May 2026 recurring-route work, not an accident.

### The run key is not unique on the client

Both `RNO200` rows have `run.id = -5` (Route 5) and differ only by `run.courierID`. Most of the client already knows this and looks rows up by `[data-runid][data-courierID]` (job locate paths around `homeControl.js` lines 4507 to 4594). Two paths do not.

### Divergence A: deep-link / job-number locate activates every row with that run id

`homeControl.js` line 1378:

```js
$("#runList").find("[data-runID='" + RunID + "']").addClass("active");
$scope.showRun();
```

`RunID` comes from the job-number search (`?jobNumber=` deep link, line 5386). For a recurring route this selector matches **both** `RNO200` rows. `showRun()` then loops every `#runList .active` row, fetches each row's jobs, and concatenates them into `$scope.runBuilder`. Result: the READY row is highlighted, its count says 7, and the expanded list shows 7 unassigned jobs plus the LIVE row's job(s). `P2891DEL` is a LIVE-row job. That is exactly Kenneth's screenshot.

The `searchJobSelect` locate path (line 4483 onward) has the same shape of problem in a softer form: it finds the run with `job.runID === parseInt(obj.id) && (job.courierID === 0 || job.courierID === parseInt(obj.courierID))`, so a courier id of `0` is treated as a wildcard and matches the first `RNO200` row in list order rather than the unassigned one.

### Divergence B: the depot filter is applied to the count but not the expansion

Migration `20260528100000` added `@Regions` to `RVW_stpBulkRunJobs` and says "threaded from the controller". It never was. `RunRepository.RunJobs` does not pass it, `HomeController.BulkRunJobs` has no `regionIds` parameter, and `homeService.getRunJobs` does not send one.

Effect: with a depot selected, the Run List `Total` for a synthetic row counts only jobs whose pickup lands in that depot, but expanding the row returns every job on the route for that courier. Any route with one job in a different depot bucket shows a count that disagrees with its expansion. `P2891DEL`, with its wrong location (Bug 3), is precisely such a job.

### Lesser differences, not fixing now

For the record, the synthetic `Total` subquery in `RVW_stpBulkRuns_2` and the `WHERE` in `RVW_stpBulkRunJobs` also differ in that the count treats Agent/NP-assigned jobs as unassigned while the expansion excludes them, and the count ignores status 18 and the client/speed filters. All of these make the expansion **smaller** than the count, never larger, so none of them produce the reported 7 versus 8. Leave them unless a mismatch survives fixes A and B.

---

## 2. The fix (runviewer repo, branch `feat/runviewer-recurring-routes`)

Note: `Views/Shared/_Layout.cshtml` references `homeControl.js` directly, so no bundle rebuild is needed for these edits.

### Fix A: key row activation by run id **and** courier

`wwwroot/app/components/home/homeControl.js`

1. Line 1378: activate only the row for the job's courier. `RunID` needs a companion `CourierID` from the job search result (the search returns `courierID` alongside `runID`; use `0` / empty for unassigned, matching the `data-courierID=""` the template renders when `run.courierID` is null).

```js
// before
$("#runList").find("[data-runID='" + RunID + "']").addClass("active");

// after
$("#runList")
    .find("[data-runid='" + RunID + "'][data-courierID='" + (CourierID || "") + "']")
    .first()
    .addClass("active");
```

2. In `searchJobSelect` (line 4483 onward, and the sibling block near line 4680), prefer an exact courier match before falling back to the wildcard, so an unassigned job resolves to the unassigned row and an assigned job to its courier's row:

```js
var byExact = list => list.find(obj =>
    job.runID === parseInt(obj.id) &&
    (parseInt(obj.courierID) || 0) === (job.courierID || 0));
var run = byExact($scope.preRunList) || byExact($scope.runList);
```

Keep the existing wildcard `find` only as a last resort after the exact match fails.

3. Defensive: at the top of `showRun()`, if more than one active `#runList` row shares the same `data-runid`, keep only the one that was clicked (`event.currentTarget`) unless the operator used ctrl-click. This stops any other path that activates by id alone from concatenating both `RNO200` rows.

### Fix B: thread the depot filter into the expansion

Four small edits, no SQL change (the SP already accepts `@Regions`):

1. `wwwroot/app/components/home/homeService.js` `getRunJobs(...)`: add a `selectedRegions` argument and append `'&regionIds=' + selectedRegions` to the URL.
2. `wwwroot/app/components/home/homeControl.js`: at each of the six live `getRunJobs(...)` call sites (lines 726, 851, 4095, 4142, 4187, 4233) pass `selectedRegions.join(',')`, computed the same way the Run List load already does:
   ```js
   var selectedRegions = ($scope.pickDateService.regions || [])
       .filter(a => a && typeof a.id !== "undefined").map(a => a.id);
   ```
3. `Controllers/HomeController.cs` `BulkRunJobs(...)`: add `string regionIds = null` and pass it through.
4. `Repositories/RunRepository.cs` `RunJobs(...)`: add `string regionIds = null` and `.WithSqlParam("@Regions", string.IsNullOrWhiteSpace(regionIds) ? DBNull.Value : regionIds)`.

Passing `NULL` keeps today's behaviour for every non-synthetic run, and the real-bulkrun branch of the SP ignores the parameter anyway.

### Before pushing

- Confirm the deployed `RVW_stpBulkRunJobs` on Medical staging matches migration `20260528100000` (it must accept `@Regions`); `sp_helptext` is enough.
- Run the acceptance checks below on the Route 5 date.

---

## 3. Bug 3: `P2891DEL` under Reno instead of Burbank (one hour cap)

The synthetic run SQL buckets a DEL row by exact match of `tucJob.PickUpLatitude/Longitude` against `tblBulkRegion.PickupLatitude/Longitude`. So "location information pointing to Reno" means `P2891DEL`'s pickup coordinates are Reno's, while its `ucjbFromAddr` text says Burbank.

What Kevin should do, in order, and stop at the hour:

1. Compare `P2891DEL` with `P2893DEL` / `P2894DEL` on `PickUpLatitude`, `PickUpLongitude`, `DepotId`, `ucjbPickUpFrom`, `CreatedTime`, and the creating user / source.
2. Correct the one job's pickup coordinates to Burbank so it buckets correctly.
3. Write one paragraph on how it was created differently. If the cause is a booking-path bug that will recur, raise it as its own item; do not fix it inside this batch.

The broader limitation (depot filter is location-based, not pickup/delivery-direction aware) is real and is **logged for Routed Operations**, not fixed in RunViewer. Also for the record: recurring-route runs are excluded from the Outbound view altogether, which is why Kenneth does not see `RNO200` there.

---

## 4. What moves to Routed Operations

Log these against the Route Viewer rebuild so they are designed in rather than patched:

- one row per route per date, with courier split shown inside the run (the Option B shape), and a run key that is unique by construction
- one membership predicate shared by the run rollup and the job expansion
- depot bucketing that knows whether a job's depot match is on the pickup or delivery side

---

## Key questions answered

### How can a job show as assigned and unassigned at the same time?

It does not, in the data. `P2891DEL` has a courier and belongs to the LIVE row. The client activated both `RNO200` rows because they share a run id, then concatenated both expansions under the READY row's heading. Separately, the depot filter narrows the row count but not the expansion. Fix A and Fix B remove both.

### Is the split into two `RNO200` rows the bug?

No. It is the intended route + courier row model from the recurring-route work, and the Courier column already tells them apart. What was wrong is that the rows shared an id and the client keyed on id alone in two places.

### Why not do Option A or B?

Because RunViewer is going away. The labelling is cosmetic and the single-row model belongs in the Route Viewer rebuild.

---

## Acceptance checklist (Route 5 / RNO200 date, Medical staging)

1. Load the date with no depot filter. Click the READY `RNO200` row: expansion count equals the row's `Total`, and `P2891DEL` is not in it.
2. Click the LIVE `RNO200` row: `P2891DEL` is in it, and nothing from the READY row is.
3. Open the deep link `?jobNumber=P2891DEL`: only the LIVE row is highlighted and expanded.
4. Open the deep link for one of the 7 unassigned jobs: only the READY row is highlighted and expanded.
5. Select the Reno depot, then the Burbank depot: for each, every `RNO200` row's expansion count equals its `Total`.
6. Ctrl-click both `RNO200` rows: the combined expansion equals the sum of the two `Total` values with no job listed twice.
7. Spot-check one non-recurring (positive id) run with a depot filter on: unchanged behaviour.
8. After the Bug 3 data fix, `P2891DEL` buckets under Burbank with the depot filter on Burbank and not under Reno.
