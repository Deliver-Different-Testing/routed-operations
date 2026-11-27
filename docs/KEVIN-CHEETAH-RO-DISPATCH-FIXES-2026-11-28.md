# Routed Ops fixes before Cheetah's dispatch session

**Owner:** Kevin · **Written by:** Steve (via EasyEA), Sat 28 Nov 2026 · **Priority:** URGENT
**Due:** on Cheetah prod before Ruth's dispatch session, **Mon 30 Nov US Eastern (Tue 1 Dec NZ morning)**. Cheetah go-live is **Sun 6 Dec**.
**Follows:** `KEVIN-CHEETAH-ROUTE-VIEWER-FIXES-2026-11-26.md` (branch `docs/cheetah-route-viewer-fixes-2026-11-26`). This spec replaces that card's M8 and M9 notes, which named the wrong driver and overstated M9 (see "Corrections").
**Overtime:** Steve would like R1–R4 in by Monday. Can you do some overtime this weekend? Tell Steve in Slack.

## What happened on the 27 Nov call (Ruth, George, Emilio, Kenneth)

George assigned a CAPS route to Ruth's phone and then moved it to Bruce. Ruth's phone kept the old jobs, and Bruce never got the new ones. Nothing on the screen said it had failed. Ruth then tried Unassign and got "Unassign failed: RunId + CourierCode required." Bruce was on the Dispatch map but not on the Routed Ops map. The job detail showed no POD photo after George delivered a job on his own phone.

Courier ids (they matter for the logs): **Bruce = code 22 = courier id 2** (device 5AA9369D). Code 2222 = courier id 22 (device F6246AEA).

Log evidence, `routed-operations-835-cheetah-prod`, 27 Nov UTC:

| Time (UTC) | Call | Effect |
|---|---|---|
| 18:09:59 | `POST /api/runviewer/jobs/assign` Courier=2, jobs 251–253 (Route 4, P30–P32MR) | Bruce's phone gets them at 18:10:06 |
| 18:14:16 | same 3 jobs, Courier=22 | DB moves them to courier 22. **Bruce's phone gets no removal**, because no restore ran |
| 18:14:28 | Route 9's 8 jobs, Courier=2 | Bruce's phone never received them (separate phone-sync fault, Garry: see "Not in this spec") |
| 18:20:22 | Route 8's 4 jobs, Courier=17 | |
| 18:38:04 onward | `GET /api/runviewer/couriers/available` | **500**, every 30 s while All couriers was on |

I fixed the data by hand: Dispatch `POST /job/ReAllocate` (restore, then despatch) moved 251–253 to courier 22 and later back to courier 2 at 18:41:13Z. The code-2222 phone got the removal 5 s later. That is the behaviour Routed Ops should have.

## R1. Assigning a job to a different driver must take it off the old phone

**Cause.** `RouteViewerAssignmentService.AssignAsync` (Courier) only runs `DES_stpJob_AutoDespatchSelectedJobs` and `DES_stpJob_AutoDespatchChildJobs`. Neither restores the job first. So:
- `UTL_stpJob_RestoreDevice` never queues the void (`<A>V</A>`) for the old device;
- `ucjbMobileSend` is not reset;
- the old driver keeps the job on the phone, and can still accept or pick it up.

Everything else that moves a job restores first:
- `RVW_stpTransferJob` (migration `20260511134131_GuardCompletedJobsAgainstSilentRestore`);
- DespatchWeb `POST /job/ReAllocate` (`ReDispatchSelectedJobsAsync` runs `RestoreJobsCoreAsync`, then `DispatchJobsToCourierAsync`).

**Change.**
- In `AssignAsync`, for each job that already has a courier **different** from the target, run the restore first (`uspRestoreJobs`, migration `20260703140000`, which calls `UTL_stpJob_RestoreDevice`), then despatch.
- Jobs with no courier, or already on the target courier, skip the restore.
- Keep the completed-job guard from `20260511134131`: never restore a completed job.
- The toast tells the operator what happened, e.g. "Moved 3 jobs from 22 to 2". If any job is rejected (for example, completed), list it.

## R2. Run-level actions must work on route runs (negative run ids)

**Cause.** CAPS routes show in Route Viewer as synthetic runs with **RunId = −RouteId**. The run-level endpoints in `RunViewerAssignmentController` reject them before doing anything:

```
preassign-run, transfer-run, release-run, unassign-run, transfer-original-run-order:
if (request.RunId <= 0 || ...) return BadRequest("RunId + ... required.")
```

That is the "Unassign failed" George hit. Even without the guard, `RVW_stpPreAssignRun` and the others find jobs only through `tblBulkRun`, so a route run has nothing to act on.

**Change.**
- For `RunId < 0`, resolve the run's jobs **with the same query as the route branch of `RVW_stpBulkRunJobs`** (migration `20261127160000_RVW_RouteRunsSelfParentedJobs`), for the run date shown.
- Then:
  - **Pre-assign / Re-assign / Transfer:** run the R1 path (restore if the courier is different, then despatch) for those jobs.
  - **Unassign / Release:** restore those jobs, so they go back to unassigned and come off the phone.
  - **Transfer original run order:** hide it on route runs (no `tblBulkRun` row to store it on), unless you see a clean place for it.
- Keep the guard for `RunId == 0`.
- Change the guard messages to plain English, e.g. "Pick a driver first." Operators should never see "RunId + CourierCode required".

## R3. Drivers on the Routed Ops map

**Cause 1 (confirmed).** With **All couriers** on, `GET /api/runviewer/couriers/available` returns 500 on Cheetah prod:

```
System.InvalidOperationException: The required column 'CourierCode' was not present in the results of a 'FromSql' operation.
  at RouteViewerCourierService.GetAvailableCourierPositionsAsync ... line 146
```

`MAP_stpEnvelope` is a legacy proc. It is in no migration (only in the seed `.bak`), and its result columns don't match `AvailableCourierPositionDto` (`CourierId, CourierCode, VehicleType, Latitude, Longitude, Timestamp`).

**Fix:**
- Add a migration with a new `RVW_stpCourierPositions_Envelope` that returns exactly those columns: the latest ping today per active courier inside the box, with the courier code and vehicle type.
- Point the service at it.
- Don't change `MAP_stpEnvelope`, because the legacy maps may still use it.

**Cause 2 (to check).** George expected to see Bruce on the route map without ticking anything. Today a driver shows only with **All couriers** on, or **Track** on with a job selected.

**Change:** when a run with an assigned driver is selected, show that driver's last ping today by default, using the same marker. Check that `MAP_stpCourierGPS_LastPositionToday_ByJobID` returns a position for a **route job** (self-parented, no bulk run).

## R4. POD photo and signature in job detail for route jobs

**Cause.** `RvJobDetail.tsx:301` renders `<PodPhotoCarousel bulkJobId={job.bulkJobId} />`, and the carousel is disabled when `bulkJobId` is null. The route branch of `RVW_stpBulkRunJobs` returns `CAST(NULL as int) AS BulkJobID`, so **CAPS route jobs never show photos**. `RouteViewerJobService.GetBulkJobPhotosAsync` also only finds the job through `tblBulkJob`.

**Change.**
- Add `GET /api/runviewer/jobs/pod-photos?jobId=` (or accept either id). The carousel uses `jobId` when `bulkJobId` is null.
- **Sweep the job family**, as DespatchWeb `PodReportService` does. Photos are keyed by the **completed leg's** job id, not the parent's.
- Show pickup photos too (DespatchWeb `JobPhotoService.GetPickupPhotosAsync`).
- **Check the bucket on each tenant.** Routed Ops reads env `S3Bucket` and fails soft (nothing shown) when it's unset. DespatchWeb uses `S3BucketMars` with `{jobId}-` keys. Confirm that Cheetah prod Routed Ops has the variable and that it points at the bucket the phones upload to. If it isn't set, tell Garry; don't hard-code a value.
- **Test:** George's delivered test job on 27 Nov shows its POD photo in Dispatch. It must show the same photo in Routed Ops job detail.

## Corrections to the 26 Nov card

- **M8:** the driver on courier id 2 is **Bruce**, not Ruth. R1 and R2 above replace M8.
- **M9 (`/api/runviewer/runs` 500, `OriginLatitude`):** this was **only the deploy window**, 27 Nov 01:00–05:00Z (plus one call at 08:00Z). Every call since has returned 200. Both migrations (`20261127120300`, `20261127160000`) carry the column. Nothing to fix. Close M9 once you've glanced at the logs.

## Not in this spec (owners noted so you know they're covered)

- **Bruce's phone isn't syncing (Garry, URGENT).** Since 18:14:30Z, every sync from device 5AA9369D fails in marsapi `SynchronizeJobs` with `XmlException: Unexpected end of file ... not closed: V, SSZ, J, D…`. It was still failing at 19:49Z. One queued `tblHostToDevice` row for code 22 looks truncated, so the joined reply is invalid XML and nothing after it is ever delivered.
- **CAPS route master job** (the one carrying the main courier payment) should be CAPS → CAPS, not a copy of the furthest stop. Steve/EasyEA will change the recurring bookings.
- **Tote menu on delivery:** a tote-scanning setting on the route. Already switched off; George confirmed delivery now works.
- **Settings → Services list only finds items on the current page; rating page search the same:** configurator, separate ticket (Kenneth may already have one).
- **Duplicate fuel item in the QuickBooks item search (Kerran), Florida STAT service missing in Accounting Setup (Steve).**

## Milestones

| # | Milestone | Done when |
|---|---|---|
| M0 | Confirm | Reply in Slack: R1–R4 causes agree with what you see, R3 column list, and the bucket env var on Cheetah prod Routed Ops (set / not set). Same day. |
| M1 | Assign restores first (R1) | Assigning a job from driver A to B voids it on A's phone within one sync and despatches to B. Completed jobs untouched. Toast says what moved. Unit tests. |
| M2 | Route-run actions (R2) | Pre-assign, Re-assign, Transfer, Unassign and Release work on a route run (RunId < 0), with the R1 behaviour. No "RunId + … required" text anywhere. |
| M3 | Drivers on the map (R3) | Migration for `RVW_stpCourierPositions_Envelope`; All couriers returns 200 on Cheetah prod; selecting a run with a driver shows that driver's last ping. |
| M4 | POD photos for route jobs (R4) | Job detail shows delivery photo, signature and pickup photos for a CAPS route job, including when the photo is on a child leg. Bucket env var confirmed. |
| M5 | On Cheetah prod | R1–R4 released before the Monday session (Mon 30 Nov US / Tue 1 Dec NZ morning). Post the release note in Slack. |
| M6 | Steve retests | On Cheetah prod: assign a CAPS route to a test phone, move it to another, unassign it. Each phone shows the change within a minute. Driver shows on the map. A delivered job shows its POD photo. |
