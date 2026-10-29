# Bulk Import + Route Builder Fixes (22 Sep test report) - Handover for Kevin

_Author: Steve Bonnici (with EasyEA) - 2026-09-28_
_Branch: `fix/bulk-import-route-builder-0922` on the GitHub mirror, based on `27666a9` (GitLab `develop` sync)._
_Source: "20260922 - Routed Operations Bulk Import / Route Builder issues report" (Urgent staging, Catherine's login, WOOP_Bookings_W574.xlsx)._

This branch fixes every item in the 22 Sep tester report: critical and functional items (Batch A + B), Route Builder UI polish (Batch C) and Bulk Import review / export improvements (Batch D). Batch C + D are frontend only.

## Kevin: what you need to do

1. **Build and run the backend tests with real NuGet credentials.** This was developed on a machine without `GITLAB_NUGET_USERNAME` / `GITLAB_NUGET_TOKEN`, so restore of `DeliverDifferent.AlertLabel.Data` 1.0.4 from `git.customd.com` returned 401. The backend was compiled and tested only against a temporary compile-only stub for that package (stub not committed). Please confirm:
   - `dotnet build` is clean.
   - `cd tests/RoutedOperations.Tests && dotnet run --configuration Release` - expect the new tests listed below to pass.
   - The Husky pre-push gate passes (it was not installed on the dev machine; `npm ci --ignore-scripts` was used).
2. Review the transaction change in `RunService` (A1) - it is the highest-risk change.
3. Run the end-to-end test plan at the bottom against Urgent staging with the WOOP file.
4. Merge into GitLab `develop` when happy. No DB migrations are required - all changes read or write existing tables.

## Summary

| # | Report item | Root cause | Fix | Main files |
|---|---|---|---|---|
| A1 | "Create Run from these xx jobs" - run created, all jobs gone | Run committed first, then N parallel `/assign` calls, each a raw `MERGE ... WITH (HOLDLOCK)` + `UPDATE` with no transaction. Deadlock / timeout could half-apply; errors swallowed and success toast always shown. Merge Run deleted the source run even when assigns failed. | New `POST /api/runs/with-jobs` and `POST /api/runs/{runId}/assign-many` (policy `RouteBuilder.Build`). Run insert + all job assignments (+ merge source delete) in one Serializable transaction; all-or-nothing; failed job ids logged. Frontend makes one call, reports real success, always reloads. | `RunService.cs`, `RunsController.cs`, `RunDtos.cs`, `CockpitPage.tsx`, `runService.ts` |
| A2 | Back in Bulk Import resets depot selection to all | Select Depots effect re-seeded on every open and reset the cursor to depot 1. Also meant Back then Next could **re-import depot 1**. | Seed only when the bucket signature changes; keep unticks, pre-tick new depots, prune gone ones. Per-bucket `done` flag: done depots greyed and struck through with imported count; Next resumes at first not-done depot; import step refuses to resend a done depot. | `wizardState.ts`, `SelectRegionsModal.tsx`, `NewImportWizard.tsx` |
| A3 | Airline "depots" shown with jobs, no Service | Depot list came from `BulkZonePostcode` (a rating table) with no `Active` or schedule check; duplicate postcodes resolved by whichever depot came last in SQL order. No airline/depot type column exists. | `GET /api/address/depots/postcodes?clientId=` skips inactive depots and picks one depot per postcode: bookable schedule for the client first, then lowest `Zone`, then lowest depot id. Depots with no bookable schedule are flagged and shown (routed imports only) as a locked warning bucket so the operator can see which rows are in them. | `AddressService.cs`, `AddressController.cs`, `RegionPostcodesDto.cs`, `SelectRegionsModal.tsx`, `addressService.ts` |
| A4 | Region filter (Palmerston North) still lists Auckland runs with 0 jobs | `GetBulkRunsAsync` draft branch added every unlocked run for the date regardless of job filters (runs have no region). | When any job-level filter (region / client / speed / our-ref) is set, only runs holding a matching job are returned. No filter = unchanged (empty drafts still show). | `RunService.cs` (~line 152) |
| B1 | Print button in Job Details does nothing | `IconButton` had no `onClick`; no prop wired. | Print calls `GET /api/runviewer/labels/bulk?bulkJobId=` (new `printBulkJobLabelPdf`) and opens the PDF in a new tab. Uses the **server default template** (speed `LabelId` -> `DefaultBulkLabelId` -> first template). `RouteViewer.Read` has the same rule as `RouteBuilder.Read`, so builder users can print. | `JobDetail.tsx`, `CockpitPage.tsx`, `routeViewerService.ts` |
| B2 | Next depot (Christchurch) pre-filled with Service / Schedule not available that day | One global `speedId` / `scheduleId` for the whole wizard; reset effect raced the auto-select effects. Schedule list ignored retired headers and client overrides. | `SET_CURRENT_DEPOT` clears Service, Schedule and Book Time in the reducer (Book Date still carries over, as legacy). New `BookableSchedules` helper drops retired headers and applies `COALESCE(override.IsActive, header.IsActive)` + client `WeekDays` mask; used by `GetClientSettings` and `GetSchedulesByBookDate`. | `wizardState.ts`, `SchedulePickerModal.tsx`, `BookableSchedules.cs` (new), `ClientService.cs` |

## Batch C - Route Builder UI (frontend only)

| # | Report item | Change | Files |
|---|---|---|---|
| C1 | Job Details fields misaligned / overflowing | All grids fixed at `grid-cols-2` (panel is narrow and resizable, so window breakpoints did not apply). `min-w-0` + `break-words` on cards; full value in hover title. Duplicates removed: **Run** metric tile (kept in Courier card beside Run Order), **Speed** row in Package card (editable Speed tile kept), **Email** row in Delivery card (same field as Track Email), Pickup Notes + Delivery Notes (same `notes` field) merged into one Notes card. | `JobDetail.tsx` |
| C2 | Fix GPS button takes too much space | Map-pin icon in the header before Print / Send, same `onOpenGpsFix` handler. Right-click "Update GPS..." kept. | `JobDetail.tsx` |
| C3 | "Loading" status too small | Centered ring spinner over a translucent backdrop (brand-cyan, same spinner as `Modal.tsx`). Driven by a `busyCount` (`BUSY_START` / `BUSY_END`) plus `withBusy` wrapper, so it covers loads **and** create run, assign (incl. drag-drop and merge), delete run and print. Label "Working..." for mutations, "Loading..." otherwise. Green success banner unchanged. | `CockpitPage.tsx`, `CockpitState.ts` |

Batch C judgement calls:
- The overlay **blocks clicks** while showing, to stop double-submits on a slow save.
- Lock, rename, optimise and courier assign are not wrapped yet (one-line `withBusy` each if wanted).
- No show-delay on the spinner, so very fast loads may flash it briefly.

## Batch D - Bulk Import review / export (frontend only)

| # | Report item | Change | Files |
|---|---|---|---|
| D1 | Unmatched depot row cannot be ticked, no way to see its jobs | Unmatched and no-service (e.g. airline) buckets now show a warning and a **View / export** button (no checkbox; still not importable). Opens `UnmatchedRowsModal` listing sheet row #, name / company, address, suburb / city, postcode / zip and a reason ("Postcode not covered by any depot", "Missing postcode", "column not mapped", "No service for this client at X"), with Export CSV. | `UnmatchedRowsModal.tsx` (new), `SelectRegionsModal.tsx` |
| D2 | Exported CSV should be the whole source row | Both the unmatched and km-rated exports write the **whole original row** under the original headers, so the client can fix and re-import. Km-rated puts **Amount** in column A and shows the disclaimer "Amount shown is based on the current booking details as km-rate. Our system will re-evaluate the amount on re-import." Always-blank Cubic column gone. | `sourceRowExport.ts` (new), `KmRatedReviewModal.tsx` |
| D3 | (Found in trace) fixes from Fix Addresses ignored when grouping | Depot grouping now applies earlier corrections: US `fixedZips`; NZ geocoder suggested postcode (previously discarded) stored as `fixedPostCodes`. | `FixAddressesModal.tsx`, `wizardState.ts`, `SelectRegionsModal.tsx`, `NewImportWizard.tsx` |

Batch D judgement calls:
- **NZ postcode fix is a fallback only.** A row's own postcode always wins; the geocoder postcode is used only if the original matches no depot. Rescued rows are booked with the corrected postcode via `DepotBucket.postCodeOverrides` (included in the bucket signature so A2 seeding still works).
- **Km-rated rows are matched back to source rows client-side** (server rebuilds them from `TblBulkJob`, with no row index): job number (unless AUTOGENERATE), company, address, postcode (leading-zero tolerant), refs, contact; then address + postcode; each source row used once. Unmatched ones fall back to the mapped columns (unmapped columns blank). An exact server-side row index would need a backend change - worth doing if mismatches show up in testing.
- Review opens as a nested modal over Select Depots (not a new wizard step) so the A2 depot / cursor state is untouched.
- `ImportSummaryModal`'s "unimported jobs" export is unchanged.

## A1 detail - review this one

- `CreateRunWithJobsAsync` and `AssignJobsToRunAsync` open `BeginTransactionAsync(IsolationLevel.Serializable)` on the service's single lazy `Context` (see `BaseService`).
- Job moves now use EF (`StageJobAssignmentsAsync`) instead of the per-job raw `MERGE`. Checked before merging:
  - `tblBulkRun`, `tblBulkJob`, `tblBulkJobRun` are already mapped with `HasTrigger("legacy_trigger")` in `DespatchContext.cs`, so EF does not use `OUTPUT` on them.
  - No `EnableRetryOnFailure` execution strategy is configured, so user-initiated transactions are allowed.
  - `VoidJobService` already writes these tables through EF.
- The "moved by another user" check (`FromRunId` vs current `tblBulkJobRun.RunId`) is applied to the whole batch: one stale job fails the lot and nothing moves.
- Not changed: the legacy single-job `POST /api/runs/{id}/assign` endpoint and `InsertOrUpdateRunAsync`'s own per-job raw MERGE loop (when called with `Jobs`). The cockpit no longer calls either for create / merge / multi-assign. Candidates for cleanup later.
- Other things that can make jobs vanish independently of this button (not changed, worth knowing if it recurs): HD Sync (`UTL_stpJob_tblBulkJob_SyncHDJobs`) setting `ParentId`, and bulk-import delete (`BulkImportServiceV2.cs:659-692`).

## Judgement calls (override if you disagree)

1. After the first depot is imported, Service is **not** auto-picked for later depots even if only one is available (tester's suggestion: force a choice). The first depot still auto-picks.
2. A depot counts as `done` once its first-pass import succeeds, even if km-rated rows then go to review (the other rows are already on the server).
3. No-service depot lock applies to routed imports only; on-demand imports do not book against schedules.
4. Without `clientId`, every depot counts as serviced and only the zone / id tie-break applies.
5. Print uses the server default label template. A label size / template picker is **separate future work** (needs a template list endpoint + template id on `LabelRequest`).

## Known gaps (not in this branch)

- `tblScheduleClient` assignment of shared (`ClientId` null) schedules is not applied in `BookableSchedules`.
- Server import path does not re-validate that the chosen schedule is still active.
- `SortPostcodesByRegionAsync` still uses `FirstOrDefault` over possibly multiple depots (wizard does not call it).
- US location buckets unchanged.

## Test results on the dev machine

| Suite | Result |
|---|---|
| Frontend `tsc --noEmit` | Clean |
| Frontend vitest (full, A-D merged) | 1619 run, 1 failed - `bulkImportService.test.ts > uploadFile` (pre-existing; jsdom sends FormData as `text/plain`; file untouched) |
| Bulk import vitest (after D) | 227 / 227 |
| Cockpit vitest (after C) | 376 / 376 |
| Backend (with AlertLabel stub) | 1252 run, 24 failed - all Integration `BootstrapTests` / `AuthCookieTests` / `IndexViewRenderingTests` failing on `DirectoryNotFoundException` because `wwwroot/dist` was not built in the worktree. Pre-existing / environmental. |
| `RunServiceTests` + `RunServiceAssignTests` | 31 / 31 |
| `AddressServiceTests` + `ClientServiceTests` | 47 / 47 |

New backend tests:
- `RunServiceTests.GetBulkRunsAsync_JobFilterHidesDraftRunsWithNoMatchingJobs`
- `RunServiceAssignTests.CreateRunWithJobsAsync_CreatesRunAndAssignsEveryJob`
- `RunServiceAssignTests.CreateRunWithJobsAsync_MissingJobRollsBackRunInsert`
- `RunServiceAssignTests.AssignJobsToRunAsync_MergeMovesJobsAndDeletesSource`
- `RunServiceAssignTests.AssignJobsToRunAsync_StaleJobFailsWholeMergeAndKeepsSource`
- 3 new in `AddressServiceTests` / `ClientServiceTests` (depot filtering, duplicate postcode resolution, retired / overridden schedules)

New frontend tests: Back preserves selection, no double import (reducer + wizard Back then Next), per-depot Service reset (depot 2 opens blank, Next disabled), depot filtering.

## End-to-end test plan (Urgent staging, WOOP_Bookings_W574.xlsx)

1. **Airline depots (A3):** upload the file. Airline depots should not appear as importable depots; any no-service depot shows as a locked warning bucket with its row count.
2. **Back (A2):** untick two depots, go forward to the schedule step, press Back. The two stay unticked. Import depot 1, press Back, then Next: depot 1 is greyed / struck through with its count, wizard resumes at depot 2, depot 1 is not imported twice (check `tblBulkJob` count).
3. **Per-depot service (B2):** after depot 1, Christchurch (or the next depot) opens with Service and Schedule blank; only schedules active for the client on that weekday are offered.
4. **Create Run (A1):** in Route Builder, right-click a group -> "Create Run from these xx jobs". Run appears with all xx jobs. Repeat with a large group (50+). Merge two runs: all jobs land in the target and the source disappears. To test failure: open the same date in two browsers, move a job in one, then merge in the other - expect "Job has been moved by another user", nothing moved, source run still there.
5. **Region filter (A4):** date with runs in several regions, filter to Palmerston North. Only runs holding PN jobs show. Clear the filter: empty draft runs show again.
6. **Print (B1):** select a job, click Print in Job Details. Label PDF opens in a new tab.
7. **Job Details (C1 / C2):** panel shows 2 columns at any width, no overflow, no duplicated Run / Speed / Email / Notes; Fix GPS is an icon beside Print and opens the GPS fix dialog.
8. **Busy overlay (C3):** spinner shows on refresh and during create / merge / delete / print, then clears.
9. **Unmatched review (D1 / D2):** on Select Depots click View / export on Unmatched (and any no-service bucket). Rows and reasons listed; exported CSV has the original WOOP columns and headers and re-imports cleanly.
10. **Km-rated export (D2):** at Confirm km-rated jobs, export. Column A is Amount, remaining columns are the original rows; disclaimer shown. Spot-check a few rows against the source file.
11. **Postcode fixes (D3):** a row fixed in Fix Addresses whose original postcode matched no depot now lands in the right depot, not Unmatched.
