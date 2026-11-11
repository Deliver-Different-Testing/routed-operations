# Routed Ops outstanding tickets: Bulk Insert v2, Route Builder v2, Route Viewer, Print and Scan Manager, job families

_Steve Bonnici (with EasyEA), 12 Nov 2026. Owner: Kevin. Source: every open Urgent Connection ticket on the Bulk Import, Route Viewer, Route Builder, Print Manager and Scan Manager pages that has no spec and no card, mostly Vincent's, plus three from Kenneth, two from Anisah and Cory, and one each from Marcus and Akhil. Root causes were read on routed-operations `develop` 32baca1 and dbmigrationsv2 `master` 940a894 on 12 Nov. Where a line number is given it is from those commits._

This is a backlog card. Draw from it in milestone order after the Medical Will Call release is out; M1 belongs with the trigger work already in flight.

## 1. What is and is not in here

**In:** #321, #365, #320 (families that never close), #1017, #803, #316, #319, #332, #333, #322, #819, #512 (Bulk Insert v2 and quantity), #1018 (Route Builder v2 speed), #311, #326, #323, #816, #309, #334 (Route Viewer runs and jobs), #880 (Print Manager), #895, #896, #897 (Linehaul and Scan Manager on Medical), #980, #1016 (small), #870 (decision only).

**Not in here:**
- Pricing: #315 (DEL to LMC gives the parent a negative price), #310 (P2P import quantity priced wrong), #293 (pallets priced as cartons), #295 and #297. Kerran.
- Driver app: #244, #971. Garry, both In review.
- Medical Will Call #1001 to #1006 and #855: card `kevin-medical-willcall-route-viewer-fixes-2026-11-09`.
- Schedules NEW: #981 to #994, #839, #844, #922, #979 are on `schedules-new-feedback-2026-11-04` and `schedules-new-round2-zone-groups-pricing`. #992 (pickup go-live time) still needs its own card.
- #328 (legacy RunBuilder postcode breakdown slow). Superseded by section C: Route Builder v2 is the replacement, so it has to be faster than the thing it replaces. Close #328 when #1018 is released.
- Card `bug-uc-321` on the dash is replaced by section A; mark it Done with a pointer here.

## A. Job families that never close (#321, #365, #320)

### Cause

The only thing that completes LH legs and the parent is the trigger `tucJob_Update_Linehual_JobCompleted` (current body `20261109172200_LinehualTriggerMultiRowCompletion.sql`). Its gate at line 111 is:

```sql
IF @ucjbStatus = 6 AND @JobNumber LIKE '%DEL%' AND @JobRelationshipTypeID = 20
```

Only a Delivered DEL (status 6) starts the cascade. Garry's `20261002120000` and `20261102170000` now close a failed DEL as 10 (Undeliverable) or 50 (Redelivery) with `JobDone = 1`, and `RVW_stpReturnToBaseJob` (`20260402143000` lines 17 to 26) sets the original DEL to 10 directly. None of those is 6, so the trigger exits, the LHP, LH and parent keep `JobDone = 0`, and `sp_JobArchive` never sees a done root (it only enters a family through the root, `20260916141729` lines 220 to 227). That is #321 and #365 exactly: Vincent's 8 Nov screenshot shows the DEL done and everything above it open.

The sibling check at lines 120 to 128 already keys on `JobDone`, not status, so a DEL closed as 10 or 50 does not block a later Delivered DEL. The archive already accepts 10 and 50 on children and on the root (`sp_JobArchive` lines 270 to 273 and 445 to 448). Only the trigger gate is wrong.

#320 is the Missing case. `RVW_stpMissingJob` (`20260324120842` lines 44 to 63) restores the DEL and sets it to 1001 with `JobDone = 0`; the parent stays assigned to the first courier and on the run, so the run cannot invoice.

### Build

| # | Build | Where |
|---|---|---|
| A1 | **Widen the gate.** Fire the DEL cascade when a DEL newly becomes done with a terminal status: `@JobDone = 1 AND deleted.ucjbJobDone = 0 AND @ucjbStatus IN (6, 10, 50)`. Keep the `@@rowcount <> 1` guard and the one-row-at-a-time pattern (Garry's 9 Nov finding on `tucJob_Update_SendToDevices` stands). Upstream LHP and LH legs still complete as 6: they physically ran. Parent status = 6 if any DEL in the family is 6, else the last DEL's status (10 or 50). Both are in the archive root list. | new migration, re-emit of the trigger off `20261109172200` |
| A2 | **Return to base and redelivery.** Confirm whether the redelivery job that `RVW_stpReturnToBaseJob` books (status 5, `ClientRefa = 'Return To Base'`) is linked into the family with `RootParentID` and a `%DEL%` number. If it is, it blocks the sibling check while open, which is the right behaviour (the family closes when the redelivery delivers). If it is not linked, say so in the card notes; nothing else to build. Book Direct Redelivery books a separate one-off job through the API, so it is outside the family either way. | read, then notes |
| A3 | **Missing (#320), per D1.** Recommended: when a DEL goes Missing (1001), take the parent off the courier and off the run (`ucjbCourierID = NULL`, remove the parent's `tblBulkJobRun` row) so the driver's run can invoice, and leave the family open until the missing DEL is resolved: delivered (6, cascade fires) or written off as Undeliverable (10, cascade fires under A1). Add 1001 to nothing; Missing stays non-terminal. | `RVW_stpMissingJob` re-emit |
| A4 | **Backfill.** One idempotent script: for every family on Urgent prod where every `%DEL%` leg has `JobDone = 1` with status in (6, 10, 50) and the root has `JobDone = 0`, complete the LH legs and root one row at a time (so the trigger's downstream work runs), then let the nightly archive take them. Preview mode first with a count per client and per month; Vincent and Marcus confirm before it runs. Garry or Kerran runs it. | script with preview |

### Done when

Vincent's #321 example family (8 Nov attachment 1041) and a fresh one on staging: return to base on a DEL, then the parent and LH legs show done within a second and the family archives that night. A Missing DEL leaves the family open and the parent off the run.

## B. Bulk Insert v2 (#1017, #803, #316, #319, #332, #333, #322, #819, #512)

### B1. Airline depot wins the postcode (#1017)

The 28 Sep A3 fix is on develop: `AddressService.GetPostcodesByDepotAsync` (`AddressService.cs:571-636`) skips inactive depots and picks one depot per postcode at lines 611 to 617:

```csharp
.OrderByDescending(p => HasSchedules(p.DepotId)).ThenBy(p => p.Zone).ThenBy(p => p.DepotId)
```

`HasSchedules` is yes/no, and `BookableSchedules.LoadAsync` (`BookableSchedules.cs:44`) counts any schedule with `ClientId NULL` as the client's. Qantas CHC has a default schedule, so for WOOP both Christchurch and Qantas CHC are "scheduled", the tie goes to lowest Zone, and the airline rows carry the lower zone (the test at `AddressServiceTests.cs:328` encodes this). That is why 8083 lands on Qantas CHC on staging. There is no depot-type column: `TblBulkRegion` is id, name, active and address.

Build: three-level ordering, the client's own schedule, then a default schedule, then none. Add `tblBulkRegion.ExcludeFromBulkGrouping bit` (migration, default 0; ops set it on Qantas, Air NZ and the other airline depots) and filter those out at line 585. Log the rule that decided each contested postcode in the import's result so the next one of these is a one-line read.

### B2. Short job number kidnaps the long one's children (#803)

Child legs are named `{JobNumber}DEL`, `{JobNumber}LHP`, `{JobNumber}LH{n}` (`BulkImportRatingService.cs:904, 1079, 1171`). After insert, `UTL_stpJobBulk_UpdateParentID` (`20260908105158_FixBulkChildAbduction.sql:51`) attaches children by prefix:

```sql
WHERE b.JobNumber LIKE @JobNumber + '%' AND b.JobNumber <> @JobNumber AND (b.ParentID IS NULL OR ... LEN(@JobNumber) > LEN(existingParent.JobNumber))
```

The 8 Sep patch only wins when the longer parent is in the same batch. KIRK5 still takes KIRK53DEL when KIRK53 arrives later or is not a type-19 parent. The same `LIKE @JobNumber + '%'` lives in `UTL_stpJob_tblBulkJob_ReleaseByJobNumber` (`20260618000100` lines 356 to 408) and the item-update procs in `20260306153827` (lines 179, 293, 340, 389, 501, 570, 578).

Build: set `ParentID` in C# at creation, where the parent's job number is already known (`BulkImportRatingService.cs:986, 1154, 1249`), and change every prefix match to exact suffixes: `JobNumber IN (@JobNumber + 'DEL', @JobNumber + 'LHP') OR (JobNumber LIKE @JobNumber + 'LH[0-9]%')`, multibox `@JobNumber + '-%'`. Repair script for Sugar Dealer's KIRK5 to KIRK8 families (preview first; Marcus confirms the list).

### B3. Blank cells and blank quantity (#316, #319)

`requiredFieldProblems` (`wizardState.ts:560-577`) reports only the first blank row per field as `"<label> is required: record N is blank"`. Quantity is not required (`wizardState.ts:796-805`); a blank goes to the server as null and `Qty = j.Quantity ?? 1` (`BulkImportJobFactory.cs:1145`), but `toIntOrNull` (`NewImportWizard.tsx:785-789`) turns a whitespace cell into 0, which is not null, so the default never applies. Blank name, address or job number cells throw a null reference at `BulkImportJobFactory.cs:1093, 1117, 1129` and the user sees `Import failed: <stack text>`. `"Invalid suburb(s)."` at line 1172 names no row.

Build: client side, collect every blank row per required field and add a Quantity rule (blank = 1 with a warning line; whitespace, non-integer or zero = error with row and column). Server side, a `ValidateRows` step at the top of `ProcessRoutedJobs` (line 701) that returns `Row N: <Column> is blank` or `Row N: Quantity must be a whole number` before anything is built, replacing the bare `.Trim()` calls and the line 1172 message. Cory's "3 jobs per line" (39 jobs from 13 rows) could not be reproduced in code; ask him for the file if it recurs.

### B4. Sheet postcode silently replaced (#332)

`FixAddressesModal.tsx:141-151` stores HERE's `suggestedPostCode` into `fixedPostCodes` whenever it differs from the sheet, with no prompt. `SelectRegionsModal.tsx:199-220` uses the sheet postcode only when it matches a depot; otherwise the suggestion wins and goes out as `toPostCode` (`NewImportWizard.tsx:160-167`, written to `ToPostCode` and `DeliveryAddressLine7` at `BulkImportJobFactory.cs:1122, 1134`). Lines 152 to 159 rewrite the suburb the same way, and `BulkImportJobFactory.cs:1441-1459` does it to origin addresses on the server.

Build: a suggestion is a suggestion. New `acceptedPostCodes` state; Fix Addresses shows "sheet says 0614, map says 1062" with Accept / Keep sheet. Only accepted values reach `SelectRegionsModal`; a kept sheet postcode that matches no depot goes to the Unmatched bucket with that reason. Same rule for the suburb rewrite and the server origin override.

### B5. Suburb pop-up (#333)

`FixZipCodesModal.tsx` (NZ title "Fix Suburbs", opened at `NewImportWizard.tsx:499`) matches the suburb name exactly, case-insensitive, against `getSuburbs` (lines 190 to 208). The alias fallback (lines 99 to 114, 213 to 216) requires the alias postcode to equal the raw text, so `614` vs `0614` fails. No diacritic stripping on the client (the server replaces five macron vowels in one lookup, `BulkImportJobFactory.cs:1131-1132`). Nothing is remembered: `fixedZips` lives in wizard state only.

Build: normalise both sides (`normalize('NFD')` minus diacritics, lowercase, `Mt` = `Mount`, `St` = `Saint`), pad NZ postcodes to four digits before the alias check, and add `tblBulkSuburbAlias (ClientId NULL = all, RawSuburb, PostCode, SuburbId, CreatedBy)` written when the operator picks a fix and loaded at line 99. Vincent's "ask twice before remembering" is not needed once it is per client: remember on the first pick, and let the operator clear it from the pop-up.

### B6. Quantity change does not reach the DEL leg, and duplicates notes (#322, #819)

Both edits go through `POST /runviewer/jobs/{id}/text-fields` to `WS_stpBulkJob_Update @Quantity` (`20261012163000_RerateBulkItemsCubicWeightList.sql` from line 140). Gaps:

- DEL `tblBulkJob.Qty` is updated only inside `IF @ZoneAmount IS NOT NULL` (lines 267 to 272), so a routed or non-zone speed never updates it (#322).
- Live DEL and LH `tucJob.ucjbQty` are updated only inside `IF @TucJobID IS NOT NULL` for the parent (line 370), so a live DEL with an unpromoted parent keeps the old quantity.
- DEL `tucJobItems` and `tblBulkJobItems` are never resized.
- New item rows are copied from the last existing item row including `Notes` (`tucJobItems` about lines 330 to 347, `tblBulkJobItems` about 381 to 400), and a "Qty changed from 1 to 2" note is prepended to both job notes. That is the doubled delivery note on both labels (#819).

Build: take the DEL and LH quantity updates out of the amount guards; update child `tucJob` rows by `RootParentID` whether or not the parent is live; resize child items like the parent's; insert `NULL` notes on new item rows. Then check the label package's Mode 2/4 item-notes query reads the label's own item, not all items on the job (AlertLabel.Data, George publishes).

### B7. Close #512

Routed imports stamp `LoggedInContactId` (`BulkImportJobFactory.cs:1160`) and it reaches `tucJob.LoggedInContactID`. Vincent marked it resolved on 29 Jun. Close it.

## C. Route Builder v2 is slow (#1018)

Vincent: about ten seconds per action on a Woop day, old RunBuilder is faster. Causes, all in the reload that runs after every mutation:

1. Every handler awaits the write and then `loadJobsAndRuns` (`CockpitPage.tsx:129-146`), which refetches `GET /api/jobs` and `GET /api/runs` for the whole day inside `withBusy`, so the overlay (`CockpitPage.tsx:1959`) blocks until both return. Callers: create 384, delete 416, assign courier 446, assign and drag-drop 480 to 506 (reloads in `finally` even on failure), rename and void 288, 341, 353.
2. Both server calls run `SELECT DISTINCT ParentId FROM tblBulkJob WHERE ParentId IS NOT NULL` with no date bound (`JobService.cs:37-42`, `RunService.cs:178-183`), a full scan of the biggest table, then `NOT IN`. Both also run the region filter as raw SQL joined on `OR LOWER(RTRIM(FromAddress)) = REPLACE(...)` (`JobService.cs:175`, `RunService.cs:89-161`), which no index can serve.
3. On the client, `displayedJobs` (`CockpitPage.tsx:209-242`) is rebuilt on every render, so `GroupedJobs` regroups the postcode breakdown every render (`GroupedJobs.tsx:46-68`), and `GoogleMap` tears down and rebuilds every marker and refetches the HERE polyline (`GoogleMap.tsx:169-281`).
4. The 28 Sep A1 change made `CreateRunWithJobsAsync` and `AssignJobsToRunAsync` Serializable (`RunService.cs:544, 581`). Fine for one operator; with two building at once the key-range locks block each other's reloads.

Build, in this order, measuring on Vincent's W576 file on Urgent staging after each:

| # | Build |
|---|---|
| C1 | Date-bound both ParentId queries (`BookDate >= @d AND BookDate < @d + 1`) or replace with `NOT EXISTS` on an index over `ParentId`. Compute the region job-id set once per date and cache it for the request. |
| C2 | After a successful assign, create or delete, patch `state.jobs` and `state.runs` locally and return the touched run(s) from the server. Move the full reload out of `withBusy` into the background, so the overlay clears when the write commits. |
| C3 | `useMemo` on `displayedJobs`; diff markers by `bulkJobId` instead of clearing them; only refetch the polyline when the selected run's job set changed. |
| C4 | Drop Serializable to ReadCommitted with `UPDLOCK, ROWLOCK` on the specific `tblBulkJobRun` rows, keeping the optimistic `fromRunId` check. |

Target: under one second from click to next click on a 600-job day, measured with the browser's network panel and reported on the card. Vincent offered a side-by-side demo of old and new; take him up on it before C1 so the baseline is his.

## D. Route Viewer runs and jobs (#311, #326, #323, #816, #309, #334)

### D1. Split run: the unassigned row lists everyone, and assigning it reverts the split (#311, #326)

The SQL is right. `RVW_stpBulkRuns_2` (`20261109172400_RunCountsMatchJobList.sql`) returns one row per run and courier (lines 116 to 124, 284) with courier-scoped counts (356, 396). The React side throws the courier away: `RvRunList.tsx:240-242` keys rows and selection on `run.id` alone, so both rows of a split run share one key; `RunViewer.tsx:186` takes the first row for `singleRun`; the Run Jobs query (206 to 212) and `RvRunContextMenu.resolveScopedJobs` (84 to 94) fetch by `runId` with `@CourierID NULL`, which `RVW_stpBulkRunJobs` reads as "all couriers" (lines 398, 580). Assign then posts every id to `/api/runviewer/jobs/assign`, and `RouteViewerAssignmentService.AssignAsync` (lines 153 to 178) assigns whatever it is sent. Drag-drop (`RunViewer.tsx:766-769`) picks the first row's courier as `from` too. The run-level SPs are already courier-scoped (`RVW_stpPreAssignRun`, `RVW_stpUnassignRun`), so the pattern exists.

Build: row identity = `runId + courierId` for key, selection, context menu and `singleRun`. Add `@UnassignedOnly bit` to `RVW_stpBulkRunJobs` (`AND (@UnassignedOnly = 0 OR courier IS NULL)`), pass the row's courier or the flag for both the grid fetch and `resolveScopedJobs`, and use the row's own `courierCode` as `from` on drop.

### D2. Assigning two selected runs does nothing (#323)

Multi-select exists (`RunViewer.tsx:323-349`) but the menu gets only the clicked `runId` (384 to 388, 1228 to 1253); with two runs selected `singleRunId` is null, `visibleJobIds` is undefined, and `doAssign` (`RvRunContextMenu.tsx:124-139`) fetches one run. Build: pass the selected row identities into the menu, resolve each row's scoped jobs, union the ids into one `AssignRouteDialog` call (the endpoint already takes a list), label it "Assign N runs".

### D3. Pre-assigned run menu (#816)

A pre-assigned run is job status 18 (`RVW_stpBulkRuns_2` line 323; `RvRunListLite.tsx:47-49` lists them). The menu (`RvRunContextMenu.tsx:235-267`) is the same for every run and never reads `preAssigned` or the row's courier, and every item prompts with `window.prompt`. Endpoints already exist: `POST preassign-run {runId, fromCourierCode, toCourierCode}` restores then pre-assigns to the new courier, and `POST unassign-run {runId, courierCode}` (`RunViewerAssignmentController.cs:120-157`).

Build: when `preAssigned === 1` show "Re-assign to another driver" (courier picker, then `preassign-run` with `from = row.courierCode`) and "Unassign driver" (`unassign-run`, no prompt). Confirm `RVW_stpUnassignRun` resets status 18 to 0 so the run leaves the Pre Assigned list; if it only calls `uspRestoreJob`, add the reset. Replace `window.prompt` with the courier picker while you are in there.

### D4. Print button in job detail (#309)

There is one print button in `RvJobDetail.tsx:197` now; it calls `doPrintJobReport` (`RunViewer.tsx:502-515`), which ignores the job it is handed and prints `selectedJobId`, so with a leg tab open it prints the parent, and rows without a `tucJob` (`jobId 0`) only get a toast. "More" (`RvJobDetail.tsx:203`) has no handler. Build: `onPrint` uses the job it is given; `jobId > 0` prints via `/labels/jobs/{id}` (legs via `/labels/lhp-jobs/{id}`), else `printBulkJobLabelPdf(bulkJobId)` as Route Builder does since 28 Sep. Wire or remove More. Ask Vincent to confirm this is the button (his ticket predates the current layout).

### D5. Address edit does not reach Job Search (#334)

`POST /api/runviewer/jobs/gps` runs `RVW_stpUpdateBulkJobDeliveryAddress` / `..PickupAddress` (`20260219141021_PrintManagerFixAddressUpdate.sql:46-80`), which update `tblBulkJob` only: lat/lng, `ToAddress`, `ToSuburb`, `ToPostCode`, `DeliveryAddressLine1-8`. Nothing touches `tucJob` (`ucjbToAddr`, `ucjbTo`, the delivery lines), which is what Job Search and `RVW_stpScanJobsRouted` read. The text-field path refuses `ToAddress` and `ToSuburb` (`RouteViewerJobActionService.cs:318-333`).

Build: re-emit both procs to mirror onto `tucJob` where `ucjbID = tblBulkJob.JobID` (address text, suburb id resolved the way job creation does it, lines 1 to 8, lat/lng) inside one transaction, pickup side the same. The column map is `NET_stpJobDetail_Update` (`20260818182434` lines 7605 to 7608).

## E. Print Manager: on-demand jobs (#880)

`RVW_stpPrintJobsV2` (`20260618130000` from line 214) selects from `tblBulkJob` and only left-joins `tucJob`, so Blue Star's and Eden Office's bulk-inserted P2P jobs, which may exist only in `tucJob`, can never appear. Labels already exist for them: Mode 1 by `tucJob` id (`RouteViewerLabelService.cs:60`) and Mode 8 with a `JobIds` list (lines 134 to 150).

Build: an "Include on-demand" toggle on Print Manager that adds a `tucJob` branch for the date and client with `bulkJobId = 0`; the print payload sends `jobIds` for those rows through Mode 8. First check whether these two clients' imports create `tblBulkJob` rows at all (if they do, the fix is only the `JobRelationshipTypeID` and parents-only filters).

## F. Linehaul and Scan Manager on Medical (#895, #896, #897)

- **Date (#895).** `RVW_stpLineHaulRuns` (`20260701120300` lines 743, 770) and `RVW_stpScanJobsRouted` (`20260702120000` lines 66, 296) filter `CAST(ucjbDate AS DATE) = @RD` with no time zone; the services pass only `@RunDate`. Only `RVW_stpBulkRuns_2` gets `@TenantTimeZone` (`RouteViewerRunService.cs:90-98`). Build: pass the tenant zone and filter on a UTC start and end computed for the tenant day (index-friendly), same pattern as `20261109172400` line 110. Confirm first that `ucjbDate` and `ScanDateTime` are stored as UTC on Medical; Garry's 31 Oct finding was that the receiver service writes NZ-local times there, so this fix and his `TimeZone` env var change (#963) have to land together or the dates move twice.
- **Speed (#896).** `RVW_stpScanJobsRouted`: `ucjbNumber LIKE '%LH%'` plus `CAST(ucjbDate AS DATE)` (65 to 66) scans `tucJob`; `HAS_EXCEPTION` (196 to 203) scans `tblBulkScan` per leg with `Scan LIKE '%' + number + '%'` and no date bound; `LinehaulRunName` (180) and `PackedRole` (206 to 214) are per-leg subqueries; a scalar UDF runs per root inside the item LIKE (143 to 146). Build: one pre-aggregated scans CTE bounded to the date window, join legs on `RootParentID` / `LinehaulRunId` instead of LIKE on the number, sargable date range. Target under two seconds on Medical.
- **Grey chips (#897).** The proc emits `completed | exception | picked | packed | pending` (221 to 231); `legTint` (`ScanManager.tsx:46-53`) only knows `DONE / COMPLETE`, `PARTIAL / IN_TRANSIT`, `SHORT / FAIL`, so everything is grey. Build: map completed green, picked and packed amber, exception red, pending grey, current leg ringed from `CurrentLeg`; same for the item chips at line 314.

## G. Small

- **#980 Last Modified By blank on a new zone name.** `TerritoryService.cs:1136-1150` sets `Created` and `CreatedBy` only; update (1152 to 1165) sets both. Set `LastModified` and `LastModifiedBy` on create; backfill `WHERE LastModified IS NULL`.
- **#1016 Deliver By never set from the schedule (Akhil, Proline pre-alert).** `WS_stpBulkScheduleJob_Insert` (`20261110100100` lines 201 to 216) already reads `s1.EndTime` into the schedule label text, and both the parent and DEL inserts write `DeliverByTime = @DeliverByDateTime`, a caller parameter that is normally NULL (line 92). `InsertChildJobs` copies the parent's value onto LHP and LH legs (line 1303). Build: at the line 201 SELECT, `@DeliverByDateTime = ISNULL(@DeliverByDateTime, <schedule date> + s1.EndTime)` with `DeliverByTimeZoneID` from the depot or tenant; same in `DD_stpBulkScheduleJob_Insert`. Every automation merge field then has a value. Kerran should see it because it is a rating-adjacent proc, but it is Kevin's proc.

## H. Decisions

| # | Decision | Status |
|---|---|---|
| D1 | **Missing DEL (#320):** parent off the courier and run, family stays open until resolved (recommended), or treat Missing as terminal and complete the family. | **Open, Steve.** |
| D2 | **#870, legacy Run Viewer "Print All labels" on routed runs.** Legacy `LabelService.GetLabelsBulkJobs` still matches on `tblBulkJob.RunName` and never sends job ids; Routed Ops is fixed under #855. Port the RO change to legacy, or close #870 as superseded now Medical uses Routed Ops. | **Open, Steve.** Recommend close as superseded, with a note to Kenneth. |
| D3 | **Airline depot flag (B1):** `ExcludeFromBulkGrouping` on `tblBulkRegion` set by ops, or infer "airline" from a depot naming rule. | **Recommended: the flag.** Names are not a rule. |
| D4 | **Suburb memory (B5):** per client, or tenant-wide. | **Recommended: per client with a tenant-wide fallback row.** |

## I. Tests (Urgent staging unless stated)

1. Return to base on a DEL in a two-DEL family: the DEL shows 10, the other DEL delivers, LHP, LH and parent show done, the family archives. Undeliverable from the driver app: same. Missing: parent off the run, family open.
2. Import Vincent's `WOOP_Bookings_W576` (ticket #1017 attachment 1069): every 8083 row groups under Christchurch; Qantas CHC does not appear as a bucket once flagged.
3. Import a sheet with job numbers KIRK5, KIRK53, KIRK54 in that order and in reverse: each parent has exactly its own DEL and LHP.
4. Import a sheet with a blank name on row 7, a blank address on row 12 and a quantity of " " on row 3: the mapping step lists all three with row and column before anything is written; after fixing, the row-3 job books with quantity 1 and a warning.
5. A row with postcode 0614 and a street HERE does not know: the Fix Addresses step shows 0614 against 1062 and the job books with whichever was chosen; "keep" with no depot match lands in Unmatched.
6. Suburb "Otahuhu" typed as "Ōtāhuhu" and "otahuhu" matches without a pop-up; a chosen fix is not asked again for that client.
7. Quantity 1 to 2 on a bulk job on a routed speed: DEL `tblBulkJob.Qty` and `tucJob.ucjbQty` both 2, two labels, each with one copy of the delivery note.
8. Route Builder on the W576 day: click to next click under one second for assign, drag-drop, create run, delete run; a second operator on the same day does not block.
9. Split a run across two couriers: two rows, the unassigned row lists only unassigned jobs, assigning it moves only those; Ctrl-click two runs and Assign moves both; a pre-assigned run shows Re-assign and Unassign and leaves the Pre Assigned list on Unassign.
10. Edit a delivery address in Route Viewer: Job Search shows the new text and point.
11. Print on a leg tab prints that leg's label; a Recurring Route row with no job prints via the bulk id.
12. Medical staging: scans at 12:30 Pacific show under that day; Scan Manager loads under two seconds for 60 shipments; chips show green, amber, red, grey.
13. Print Manager with "Include on-demand" on: Blue Star's bulk-inserted P2P jobs for the day list and print in one go.
14. A new zone name shows Last Modified and Last Modified By in Admin Manager; a schedule booking has `DeliverByTime` on parent and DEL and the Proline email renders the date and time.

## Milestones

| # | Milestone | Done when |
|---|---|---|
| M0 | Decisions D1 to D4 answered; A2 and E's `tblBulkJob` question checked; Vincent's side-by-side demo booked | Card notes carry the answers and the Route Builder baseline timings |
| M1 | A1 to A4: families close on 10 and 50, Missing per D1, backfill previewed and run | Test 1 on staging; backfill counts posted; Vincent confirms #321's example archived |
| M2 | C1 to C4: Route Builder v2 speed | Test 8; timings on the card; Vincent signs off on prod; #328 closed |
| M3 | B1, B2: depot grouping and job-number families; Sugar Dealer repair | Tests 2 and 3; #1017 and #803 Testing (Staging) |
| M4 | D1 to D3: split run rows, multi-run assign, pre-assigned menu | Test 9 |
| M5 | B3 to B5: validation, postcode suggestion, suburb memory | Tests 4 to 6 |
| M6 | B6: quantity to legs, no duplicated notes (label package check with George) | Test 7 |
| M7 | D4, D5, G: print button, address mirror to tucJob, #980, #1016 | Tests 10, 11, 14 |
| M8 | F: Medical Linehaul and Scan Manager date, speed, chips (with Garry's #963 env change) | Test 12 on Medical staging, then Kenneth on prod |
| M9 | E: Print Manager on-demand jobs | Test 13; Anisah confirms with Blue Star |
| M10 | Release and tickets: each ticket here set Testing (Staging) when it reaches staging and Released with the production stage on release; #512, #328 and (per D2) #870 closed | Reporters confirm; nothing on the list left in New |
