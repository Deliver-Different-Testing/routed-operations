# Cheetah Route Viewer fixes (Kevin)

**Date:** 26 Nov 2026 (NZ)
**Owner:** Kevin
**Tenant:** Cheetah prod (US). Go-live is Tue 1 Dec 2026.
**Source:** Cheetah go-live meeting 25 Nov 2026, 21:03-22:40 UTC (Wispr note "New Booking Page Configuration"). Ruth (Cheetah) used Route Viewer live to look at the CAPS medical routes.
**Code checked:** routed-operations `develop` eace92a and `master` 69ee381 (GitLab, 26 Nov); dbmigrationsv2 `master` 734ae00.
**Related, do not redo:**
- `docs/ROUTED-OPS-OUTSTANDING-TICKETS-2026-11-12.md` (this repo, branch `docs/routed-ops-outstanding-tickets-2026-11-12`).
- `docs/KEVIN-MEDICAL-WILLCALL-ROUTE-VIEWER-FIXES-2026-11-09.md` (dbmigrationsv2, branch `docs/medical-willcall-route-viewer-fixes-2026-11-09`), including #1004 transfer-route.
- CAPS route setup (Kerran): dbmigrationsv2 `docs/KERRAN-CAPS-MEDICAL-ROUTES-2026-11-16.md`.

Diagnosis first. Each item has a D-step. Write up what you find (M0) before you change code.

## What happened in the meeting

Ruth opened Route Viewer, set the date to 1 Dec, clicked a CAPS route and tried to assign it to a driver. She got a 500 error. No job list loaded, no pins showed on the map, and the map stayed on the default zoomed-out US view.

## What the logs already show

CloudWatch `/aws/eks/urgent-couriers-hosting/routed-operations-835-cheetah-prod`, 25 Nov 22:00-22:40 UTC:

- **Every** call to `GET /api/runviewer/runs/{runId}/jobs` returned 500: 49 calls in total, 0 successes.
  - The run ids were synthetic route runs -2, -3 and -4 (CAPS routes 2, 3 and 4), for dates 1 Dec, 4 Dec and 7 Dec.
- **The error:** `System.InvalidCastException: Unable to cast object of type 'System.Int32' to type 'System.Boolean'`.
  - It is thrown in `SqlDataReader.GetBoolean`, inside `RouteViewerRunService.GetBulkRunJobsAsync`, at `RouteViewerRunService.cs:301` (the `SqlQueryRaw<RawBulkRunJobRow>` over `dbo.RVW_stpBulkRunJobs`).
- **Calls that worked:** `runs`, `runs/overview`, `couriers` and the filter calls all returned 200.
- **No write call reached the server.** There was no `assign`, `preassign-run` or `transfer-route` POST in that window.
  - So the "500 when assigning" Ruth saw is this job-list load failing. The assign itself was never sent.

**Likely cause (confirm in D1):**
- `RawBulkRunJobRow` has four `bool` columns: `Ok_To_Leave` (bool?), `IsNpAgent`, `Return` and `ClientIntel`.
- In the **synthetic route branch** of `RVW_stpBulkRunJobs` (`@RunID < 0`, migration `20261117141000_RVW_BulkRunJobsUnassignedOnly.sql`):
  - `IsNpAgent`, `Return` and `ClientIntel` are all `CAST(... as bit)`;
  - `Ok_To_Leave` is the raw column `j.DeliverToPrivateBusiness` from `dbo.tucJob`.
- The real bulk-run branch reads the same name from `tblBulkJob` instead.
- If `tucJob.DeliverToPrivateBusiness` is `int` (not `bit`) on the Cheetah/US schema, EF's `GetBoolean` throws exactly this error.
- That would also explain why it hasn't been seen on Medical. Medical route jobs come through the real-run branch, where the same column comes from `tblBulkJob`.

## Items

### 1. Route job list fails (500), so Assign / Transfer can't work

- **D1:**
  - Confirm the column type: `SELECT TYPE_NAME(system_type_id) FROM sys.columns WHERE object_id = OBJECT_ID('dbo.tucJob') AND name = 'DeliverToPrivateBusiness'` on Cheetah prod, and the same on Urgent and Medical prod.
  - Run `EXEC dbo.RVW_stpBulkRunJobs @RunID=-4, @RunDate='2026-12-07', ...` on Cheetah and check the column types returned (`sp_describe_first_result_set`).
  - If it isn't `Ok_To_Leave`, find which of the four bool columns comes back as int.
- **Fix:** make the proc's output types stable on every tenant.
  - Wrap the route-branch column in a cast: `CAST(j.DeliverToPrivateBusiness AS bit) AS 'Ok_To_Leave'`. Cast any other bool column that isn't already `bit`, in both branches.
  - New migration, collision-reviewed against `20261117141000`.
  - Don't change the C# type to int; the fix belongs in the proc.
- **Then re-test on Cheetah:** pick 1 Dec, click CAPS Route 2. The job list loads, and Assign Route to a courier saves.
  - Check the assign POST (`/api/runviewer/assign` or `preassign-run`) separately. It has not been exercised on Cheetah yet.
- **Also check `POST /api/runviewer/jobs/transfer-route` on Cheetah.**
  - On 16 Nov it returned 500 for all 168 CAPS live jobs but still wrote the RouteId. That was not reported until now.
  - Say whether the #1004 fix (medical will-call spec, M5) already covers it, or whether this is a second bug.

### 2. No pins on the map, and the map doesn't centre on the route

- **Cause:**
  - `RvMapBox` builds pins only from `runJobs`, and fits the map to them only when pins exist (`fitBounds`, `RvMapBox.tsx` ~286).
  - With item 1 failing, `runJobs` is empty. So the map keeps its default centre (`tenantMapCentre(isUsTenant)`, zoom 5).
  - Most likely this fixes itself once item 1 is fixed.
- **D2:** after the item 1 fix, open a CAPS route on 1 Dec and check that:
  - pins show at the hospital stops;
  - the map fits to them.
  If pins are still missing, check that the route branch of the proc returns delivery lat/lng under the names the map reads (`toLat`/`deliveryLatitude`, and the matching longitude).
- **Small improvement:** when a route is selected but has no plottable jobs, centre on the route's depot (or origin) instead of the whole of the US. Same for the first load on a tenant with one region, e.g. Kansas City or South Florida.

### 3. Future routed jobs: visible and auto-assigned

Background:
- The CAPS stop jobs are recurring bookings stamped with their route (RouteId 1-8 = CAPS routes 9 and 2-8; set 16 Nov).
- Live jobs exist for 30 Nov to 7 Dec.
- In the Booking job list, Ruth can see the route under each job's reference.

- **D3a:** once item 1 is fixed, confirm the job lists for future dates (1-7 Dec) are complete for every CAPS route:
  - each route's job count matches the live jobs carrying that RouteId for that date;
  - masters and stops both show.
- **D3b:** we will auto-assign drivers from the driver schedule. Steve is setting up the CAPS driver schedule (Route Roster) from Ruth's sheet.
  - Confirm the path: roster for the route and day, then nightly prebook, then the job's courier set.
  - Say what the roster needs so that 1 Dec jobs get their driver without anyone clicking.
  - If the roster only applies to jobs created after it is saved, say so. The 30 Nov to 7 Dec jobs already exist, and we will need a one-off back-fill for them.
- **D3c, relief driver:** right-click a route, then Transfer route to another courier, must work for a single day.
- **Route counters:** Recurring Routes shows booking count 0 and mapped stops 0 for CAPS Route 4, though it has bookings 49 and 50 plus master 26.
  - The counter only counts `UcbkActive = true` bookings or `tblBulkJob` rows.
  - Note whether it should count recurring `tucJob` bookings stamped with the RouteId. Low priority; don't block go-live on it.

### 4. Jobs reach the driver's phone only on their date

- **Expected behaviour, no change:** future-dated route jobs don't go to the driver app until their day.
- **Test plan for go-live:** create one CAPS route day in the current week (today or tomorrow, a single route, Ruth's test driver login) so the whole flow can be tested live:
  1. the route's jobs show in Route Viewer with pins;
  2. assign the route to Ruth's test driver;
  3. the jobs appear on the phone;
  4. pick up and deliver one stop;
  5. Route Viewer shows the progress.
- Steve or Ruth creates the test jobs. Kevin confirms each step works and says what failed.

## Milestones

| # | Milestone | Done when |
|---|---|---|
| M0 | Diagnosis report | Slack note to Steve with the D1-D3 answers: which column(s) break the proc on Cheetah and their types on Cheetah/Urgent/Medical; whether transfer-route 500 is #1004 or new; what the roster needs for 1 Dec auto-assign. |
| M1 | Proc output types fixed | New dbmigrationsv2 migration casts every bool column of `RVW_stpBulkRunJobs` to `bit` in both branches; `runs/-N/jobs` returns 200 for CAPS routes on Cheetah prod for 1-7 Dec. |
| M2 | Assign and transfer work on Cheetah | Assign Route to a courier and Transfer route (relief driver) both save on a CAPS route with no 500. |
| M3 | Map pins and centring | Selecting a CAPS route shows its stop pins and fits the map to them; with no plottable jobs the map centres on the route's depot. |
| M4 | Auto-assign from the roster confirmed | With the CAPS roster loaded, the 1 Dec CAPS jobs carry their rostered driver without a manual assign (back-fill done if needed). |
| M5 | Live end-to-end test | The test plan in item 4 passes with Ruth's test driver on a current-week route. |
| M6 | Released to Cheetah prod | Migration and RO build deployed to Cheetah prod (manual gate run), and Steve re-tests Route Viewer before go-live on 1 Dec. |
