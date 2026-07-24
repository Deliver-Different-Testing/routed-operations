# RoutedOperations - Parity Tracking Log

Iteration-by-iteration record of the RunBuilder-to-RouteBuilder parity work.
Every gap surfaced by a gap-finder agent is logged here, along with the fix
applied and reviewer verdict. Kept out of `changes.log` per project rule.

## Deployment Notes (BulkImport)

Two DB migrations underpin the BulkImport module. Apply order matters for
zero-downtime deploys - see below.

1. `DBMigrationV2/DatabaseScripts/Migrations/20260722100000_RoutedOperationsBulkImport.sql`
   MUST be applied before or with the pass-2 code deploy (adds `tblBulkImportJob`
   + audit / promote / soft-delete columns + unique index + grants).
2. `DBMigrationV2/DatabaseScripts/Migrations/20260722120000_BulkImportGeocodeCache.sql`
   MUST be applied before or with the pass-3 code deploy (adds `PickupLat` /
   `PickupLng` / `DeliveryLat` / `DeliveryLng DECIMAL(9,6) NULL` for the
   promote-time geocode cache).

Failure mode if code deploys first without the matching migration:
- Pass-2 code without migration 1: submits fail with `Invalid object name
  'tblBulkImportJob'`.
- Pass-3 code without migration 2: promotes fail with `Invalid column name
  'PickupLat'` on the first row that reaches `ResolvePickupCoordsAsync` -
  the whole batch stops.

Reverse order (migration first, code later) is always safe - the new columns
sit unused on an older code path.

Pass 4 (this section below) is code-only. No migration required.

---

Legend: **OPEN** = gap not yet addressed. **FIXED** = fix applied in current
session. **VERIFIED** = fix confirmed by reviewer agent. **REJECTED** = flagged
as not-a-gap after re-inspection. **DEFERRED** = agreed-upon Phase 2 work.

---

## Iteration 0 (pre-loop) - initial 50-row audit

50 rows found. 18 implemented in first pass:

| ID | Priority | Description | Status |
|----|----------|-------------|--------|
| I0.01 | P0 | Route and Lock Run menu item | FIXED (CockpitPage.tsx handleOptimizeRun lockAfter) |
| I0.02 | P0 | RouteSavvy >200 fallback | FIXED (handleOptimizeRun overThreshold branch) |
| I0.03 | P1 | Grouped Jobs zip/time toggle | FIXED (GroupedJobs.tsx mode + PillRadio) |
| I0.04 | P1 | Drag-drop groups to run | FIXED (GroupedJobs onDragStart + RunList drop) |
| I0.05 | P1 | Grouped time-mode context menu | FIXED (isTimeGroup branch in groupContextMenu) |
| I0.06 | P1 | Merge run destination picker | FIXED (MergeRunModal.tsx new file) |
| I0.07 | P1 | Rename run via context menu | FIXED (runContextMenu Rename... item + helpers.startRename) |
| I0.08 | P1 | Send to prebook path | FIXED (RunList onPrebook + CockpitPage handlePrebook Status=2) |
| I0.09 | P1 | Ctrl+A pane-aware | FIXED (activePane state + onMouseDownCapture on panel wrappers) |
| I0.10 | P1 | Void Jobs run visual polish | FIXED (red tint + Void badge + suppress courier + refuse drop) |
| I0.11 | P2 | Marker colours for multi-selected runs | FIXED (MULTI_RUN_COLOURS palette + multiRun kind) |
| I0.12 | P2 | Autoroute toggle | FIXED (localStorage-persisted checkbox in build mode row) |
| I0.13 | P2 | Fleets panel collapse + drag-to-assign | FIXED (FleetsPanel rewrite + RunList courier drop) |
| I0.14 | P2 | Enter-submits-modal wiring | FIXED (data-primary attrs on Bulk/Optimize/Fix/Merge modals) |
| I0.15 | P2 | GPS form drag + right-click | FIXED (FixGpsModal marker draggable + map contextmenu) |
| I0.16 | P2 | Bulk update route date from groups | FIXED (context menu covers both modes) |
| I0.17 | P3 | CSV export | FIXED (lib/csvExport.ts + JobsList button) |
| I0.18 | Meta | Compile check + em-dash sweep | VERIFIED (npm run build clean, no dashes) |

Rejected (false positives - already present in source):
- JobDetail inline editing (already in JobDetail.tsx EditableCell)
- Run rename via click (already in RunList.tsx renamingId)
- Sticky table headers (already `sticky top-0`)
- Drag-drop jobs to runs (already wired)
- Layout save/load (already via LayoutMenu)
- Filter presets (already via FilterPresetsMenu)
- isVoidRun ban icon (already `⊘` in RunList)

---

## Iteration 1 - deep-read line-by-line audit

Gap-finder read: entire homeControl.js, homeService.js, homeView.html, every
tpl under tpls/, all react/components/cockpit/*.tsx, all services/*.ts,
CockpitState.ts, hooks/useHotkeys.ts, backend Services/*/*.cs, Controllers.
Also read every doc under `C:\Github\routed-operations-main\docs`.

Verified-parity items (16 confirmed matching legacy): default filter date,
status=18 preassigned styling, calculator strip fields (all 9), RunBuilder
column set, map marker colours, map right-click centre, hotkeys (5 bindings)
+ allowIn/isEditing suppression, dispatch SP wrapper, [Authorize] policies,
localStorage persistence for layouts, filter endpoints, GPS validation,
bulk move/void/sync endpoints, vehicle sizes, courier assignment paths,
prebook button.

Real gaps flagged:

| ID | Priority | Description | Legacy source | Current source | Status |
|----|----------|-------------|---------------|----------------|--------|
| I1.01 | P1 | RunList lost visual locked/unlocked separation | runList.tpl:24 `filter:{locked:'!1'}` + line 35 `filter:{locked:'1'}` renders two sections | RunList.tsx single map, no visual break | FIXED (see below) |
| I1.02 | P1 | No dedicated run-lock endpoint (uses status field on PUT /api/runs/{id}) | homeControl.js:2409 toggleRunLock | RunsController.cs Update endpoint | REJECTED - functionally equivalent, PUT with status={0,1} is fine |
| I1.03 | P2 | JobsList adds checkboxes column not in legacy | jobList.tpl:12-25 no checkboxes | JobsList.tsx line 92-96 | REJECTED - intentional multi-select ergonomics improvement |
| I1.04 | P2 | JobDetail modal → inline paradigm shift | jobDetail.tpl ng-click opens modal | JobDetail.tsx inline EditableCell | REJECTED - intentional UX improvement, per Configurator conventions |

Enhancement notes (over-legacy improvements, not gaps):
- CSV export (P3)
- Fleets collapse for 20+ fleets (P3)
- Filter presets (P3)
- Marker palette extended to 6 colours (from 4 in legacy) (P3)

Iteration 1 net actionable: **1 real gap (I1.01)**. Fixed inline.

Reviewer pass: **completed**. Found 2 MAJOR + 7 MINOR. All 7 addressed
below (2 skipped as false positive / deferred).

| ID | Priority | Description | Status |
|----|----------|-------------|--------|
| R1.1 | MAJOR | handleToggleAllMultiselect operated on state.jobs not displayedJobs | FIXED (CockpitPage handleToggleAllMultiselect) |
| R1.2 | MAJOR | GoogleMap marker useEffect rebuilt every render (unstable callback + array refs) | FIXED (useMemo mapMultiSelectedRuns + useCallback handleMapPinClick/ContextMenu) |
| R1.3 | MINOR | RunBuilder onOptimize passed MouseEvent to handleOptimizeRun opts arg | FIXED (arrow wrapper) |
| R1.4 | MINOR | bulkLockSelected + handleBulkDeleteSelected did N reloads for N runs | FIXED (single reload at end + inline SP calls) |
| R1.5 | MINOR | courierPercent produced "70.00000000000001%" float strings | FIXED (Math.round in runToBody) |
| R1.6 | MINOR | useHotkeys unbind+rebind document keydown on every render | FIXED (ref pattern - bind once, latest closure via ref.current) |
| R1.7 | MINOR | FleetsPanel drag tooltip stale "(feature coming)" | FIXED (title updated) |
| R1.8 | MINOR | GroupedJobs bucketByTime uses getHours vs formatWindow getUTCHours | REJECTED - intentional: bookTime is datetime (local), schedule window is TIME-of-day (UTC 1970-01-01) |
| R1.9 | MINOR | a11y - onClick on tr/th not keyboard-operable | DEFERRED - pre-existing legacy pattern, project-wide a11y pass later |

Post-fix compile: type-check clean, build 85 modules → 306 KB (gzip 93.2 KB).

---

## Iteration 2 - backend / API / DTO parity

Focus: backend services, controllers, DTOs, entities, Program.cs, auth
policies, endpoint routes - the layer iter-1 mostly skipped.

Gap-finder read: all 12 services (JobService, RunService, RunCommitService,
HdJobSyncService, VoidJobService, CourierService, RouteOptimizationService,
HereMapService, RegionsService, SpeedsService, VehicleSizeService,
BulkRegionService), all 9 controllers with 23+ endpoints, 11 DTOs, all domain
entities, request/response envelopes, all frontend services, SPA bootstrap +
auth context.

**23 verified-parity items:**
1. Job filters (Done, Void, Parent, JobRelationshipType, Linehaul) predicates match
2. 7 join tables (Courier, Speed, Client, Schedule, PostcodeRunName, BulkJobRun, Start/End flags)
3. 33 job DTO fields match entity
4. Run DTO fields incl. routing-mode extensions
5. Response envelope shapes
6. Authorization policies Read/Build/Admin
7. All 23 endpoint routes + HTTP methods
8. Dispatch SP parameter passing (batch jobs with runner order)
9. HD sync SP call with BookDate
10. Void Jobs run creation (Status=1, IsVoidRun=true)
11. Job-to-run MERGE with HOLDLOCK
12. Courier fleet grouping + lookup
13. Schedule window sibling (ISO DoW normalisation)
14. PostCode → RunName prefix mapping
15. MaxJobsPerRun ISNULL fallback = 20
16. PickupCutoff hint projection
17. CubicM3 per-item / LWD calculation
18. Bulk route date update with per-job result tracking
19. Multibox child-job discovery
20. React SPA bootstrap window.__APP_USER__ from HomeController
21. Vite bundle load + HERE/Google SDKs
22. Frontend service URLs match backend routes
23. camelCase JSON serialisation

**Estimated net actionable gaps: 0** (per gap-finder)

Reviewer pass: **completed**. Reviewer CHALLENGED the zero-gap claim by
opening every service body + running SQL queries against the live NZ tenant
via MCP. Found 5 real gaps (1 MAJOR, 4 MINOR) plus 3 informational
non-gaps.

| ID | Priority | Description | Status |
|----|----------|-------------|--------|
| R2.1 | MAJOR | Region filter uses denorm j.RegionID; legacy uses geospatial + fuzzy-address join to tblBulkRegion | DEFERRED - full geospatial join replication is Phase 2; note tenants relying on the join semantics must document |
| R2.2 | MINOR | JobService LEFT-joins tucClient; legacy INNER | FIXED (switched to inner join, MaxJobsPerRun fallback still applies) |
| R2.3 | MINOR | Void jobs excluded from Jobs list (legacy shows them) | REJECTED - intentional per void-run architecture (Void Jobs run pins them separately) |
| R2.4 | MINOR | Schedule-sibling composite-key join drops NULL client/speed/region schedules | FIXED (coalesce sentinels -1 / '' on both sides, matching SP's ISNULL semantics) |
| R2.5 | MINOR | Sort by RunOrder used ?? int.MaxValue (NULL last); SQL default is NULL first | FIXED (?? int.MinValue) |
| R2.6 | NON-GAP | InsertOrUpdate doesn't accept IsVoidRun from body | REJECTED - by design, VoidJobService is the only writer |
| R2.7 | NON-GAP | Redis cache key uses ClientManager-Connection not RunBuilder-Connection | REJECTED - internally consistent + intentional non-collision with legacy |
| R2.8 | NON-GAP | UTL_stpJob_tblBulkRun_Delete SP body not pulled to compare with EF cascade | DEFERRED - request pull if full assurance needed |

Post-fix compile: `dotnet build` shows only file-lock errors from a running
dev instance (MSB3021/3027); zero CS errors. Frontend build clean.

---

---

## Iteration 3 - spec docs + UX polish + integration

Focus: legacy spec docs + Kevin-fixes-spec + UX visual details + empty
states + regressions from iter-2 backend changes.

Gap-finder read: all 5 spec docs (Kevin fixes, Steve rebuild plan, Steve
lift plan, consolidated rebuild, RoutedOperations handover). All cockpit
components + all lib + all services + all backend services (regression
sweep). Confirmed ~22 verified-parity items.

**4 actionable items surfaced (all P1, 0 P0):**

| ID | Priority | Description | Status |
|----|----------|-------------|--------|
| I3.1 | P1 | R2.5 sort NULL fix applied to JobService only; RunService.GetBulkRunsAsync had the same `?? int.MaxValue` at line 189 | FIXED (?? int.MinValue) |
| I3.2 | P1 | Fleet field on RunDto populated from tucCourierFleet | REJECTED - already present at RunService.cs:170 via two-hop fleetByCourier lookup |
| I3.3 | P1 | isVoidRun ban icon in RunList | REJECTED - already rendered at RunList.tsx:285 `⊘` span |
| I3.4 | P2 | isUsTenant carried in AuthContext but not consumed | DEFERRED - Phase 2 US vs NZ tenant divergence |

Post-fix compile: type-check clean, dotnet build only file-lock errors
(devenv + dev instance holding the DLL), zero CS errors.

Reviewer pass: **completed**. Reviewer independently verified every "FIXED"
claim maps to a real diff in the working tree. Verdict:

- 0 BLOCKER
- 0 MAJOR
- 2 MINOR (both parity-matching, not regressions):
  - `run.fleet` populated end-to-end but never rendered (matches legacy - polished this pass by adding a small sub-line under courier name in RunList)
  - Two `alert()` validation calls in BuildConfigModal (matches legacy UX)

**Overall parity: SHIPPABLE (0 blockers)**

Bonus polish this pass: RunList now renders `run.fleet` as a small
sub-line under the courier name (previously populated on the DTO but
never displayed - discovered by iter-3 reviewer's grep audit).

Final build: 85 modules → 306.29 kB (gzip 93.28 kB), 1.95s.

---

## Convergence signal

Loop history:
- Iteration 0: 50 audit items → 18 fixed, 7 rejected as false positives, 25 verified/enhancements
- Iteration 1: 1 new gap → fixed; reviewer found 7 → 5 fixed, 2 rejected/deferred
- Iteration 2: gap-finder said 0 → reviewer challenged, found 5 → 3 fixed, 1 deferred, 3 non-gaps
- Iteration 3: 4 new gaps → 1 fixed, 2 rejected as already-present, 1 deferred; reviewer verdict SHIPPABLE

Trend: each iteration finds fewer real gaps. Iteration 3 landed 1 real fix
+ 1 polish + 3 confirmations. Diminishing returns reached. The loop is
declared closed at iteration 3.

---

## Option B - deferred parity close-out

| ID | Priority | Description | Status |
|----|----------|-------------|--------|
| B.1 | MAJOR | UTL_stpJob_tblBulkRun_Delete SP body diff | VERIFIED - legacy SP is 2 lines (`delete tblBulkJobRun`, `delete tblBulkRun`); current EF DeleteAsync does the same PLUS resets tblBulkJob.BulkRunId/RunOrder on released jobs (intentional superset). No change needed. |
| B.2 | P1 | Nearby-to-run courier distance ranking | REJECTED - legacy `GetPotentialCouriersAsync` just returns `UTL_stpCourier_Active` (full active list). No distance ranking exists in legacy. Current CourierService already matches. |
| B.3 | MAJOR | Region filter geospatial join (R2.1) | FIXED - added raw-SQL region resolver in both JobService + RunService that mirrors the SP's lat/lng match OR fuzzy-address (space<>tokenise + st->street) join to tblBulkRegion. Verified against live NZ tenant: region 4 (Hamilton) resolves to 42 jobs. |
| B.4 | P1 | Full prebook cron path | DEFERRED - awaiting real spec. UI button hidden after C.3. |

---

## Option C - sibling modules (Stage 2)

**Revised 2026-07-21:** original C.1 (TblBulkRunPolygon + Point) and C.2 (TblRecurringRoute + Zip) tables were DELETED after user pointed out the Configurator already owns the canonical Route / ZipPolygon / Dispatch_RouteRoster / RouteZipcodes tables. Rebuilt against those. C.3 Quoting stays as-is (shadow-table concept, unrelated).

**Approach:** Route Builder + Configurator now share the same physical Route tables. A route created in the Route Builder cockpit shows up in DF Admin → Operations → Recurring Routes and vice versa. Downstream `uspPrebookSet` picks it up on the nightly cron regardless of which app authored it.

### Modules

| ID | Module | Status | Files landed |
|----|--------|--------|--------------|
| C.1' | PolygonBuilder (zip picker) | DONE | Rebuilt: no new tables. Reads existing ZipPolygon.Wkt shapes, renders on Google Maps, click-to-toggle selection, saves as a Route + RouteZipcodes rows via `/api/recurring-routes`. Old TblBulkRunPolygon migration deleted. |
| C.2' | Route + ZipPolygon entity port | DONE | Ported `Route`, `ZipPolygon`, `DispatchRouteRoster`, `TucAgent` (trimmed to needed fields) from Configurator scaffold. Added RouteZipcodes many-to-many junction config in `OnModelCreating` matching Configurator's FK names (`FK_RouteZipcodes_ZipPolygon` / `FK_RouteZipcodes_Routes`). Renamed `Services/Route/` → `Services/Routing/` to free the class name for the entity. |
| C.3' | RecurringRouteService + controller | DONE | 12 endpoints under `/api/recurring-routes`: CRUD + soft-delete + copy + roster CRUD + zip search + polygon-shape lookup + assignable-targets + schedule-lookup. DTOs match Configurator `TenantRouteDto` contract. TargetType polymorphism (1=Courier, 2=Agent, 3=NetworkPartner) preserved. |
| C.4' | Frontend rewrite | DONE | `ScheduledRoutes.tsx` with Configurator column layout (Name / Type / Area / Schedule / Default / Zip Codes / Roster / Status). RouteEditor modal + RosterModal (weekly-DoW OR one-off-date entries). `PolygonBuilder.tsx` reborn as zip picker on Google Maps + save-as-route flow. |
| C.3 | Quoting | KEPT | Shadow-table concept (`TblQuoteJob` + `TblQuoteRun`) is unrelated to routes and stays. `QuoteService` (upload / simulate / delete-set / get-sets), `QuoteController`, `Quoting.tsx` (CSV upload + rate card + service level + max stops + result grid). |

### Registered in `Program.cs`
`QuoteService`, `RecurringRouteService` — `PolygonService` / `ScheduledRouteService` from the earlier attempt are gone.

### Policies used
`RouteBuilder.Read` (list/get), `RouteBuilder.Admin` (create/update/copy/delete/roster), `RouteBuilder.Quote` — all pre-existed.

### Migrations (in DBMigrationV2)
- `20260721100000_RoutedOperationsQuoting.sql` — `tblQuoteJob` + `tblQuoteRun` shadow tables + hot-path indexes + grant matrix
- `20260721100500_RoutedOperationsGrantRoutesWrites.sql` — grants `INSERT/UPDATE/DELETE` on `Routes` / `RouteZipcodes` / `Dispatch_RouteRoster` to `DespatchWeb` + `InternetUser` (they had SELECT only; only `AdminManager` had writes). Guarded per principal via `DATABASE_PRINCIPAL_ID(...)` so tenants missing an optional user don't fail.

### Schema quirks fixed during Playwright QA
Discovered while smoke-testing on DFRNT tenant 1:
- `TblBulkRunSchedule.DayOfWeek` retyped `int?` → `short?` (DB column is `smallint`, not `int` — was throwing `InvalidCastException`)
- `TblBulkRunSchedule.Region` retyped `string` → `int?` (DB column is `int`, not `nvarchar`)
- `TucAgent` `[Table]` name `"tucAgent"` → `"tucAgents"` (DB table is pluralised)
- Two `useEffect` deps `[toast]` → `[]` on `ScheduledRoutes.tsx` + `PolygonBuilder.tsx` — the toast ref changed on every render, triggering infinite retry loops when a 500 fired
- `QuoteService.GetSetsAsync` — EF Core 10 can't translate positional-record ctor inside `GroupBy`; split into anonymous-type projection + client-side ordering

### Playwright verification (2026-07-21, DFRNT tenant 1)

| Flow | Result |
|---|---|
| GET `/scheduled-routes` list + create modal opens | ✅ |
| Create route "Playwright QA Route" + Kerran courier + Boston schedule + 02138 zip | ✅ DB verified (RouteId=1, 1 zip) |
| Open roster modal + add Monday courier entry | ✅ DB verified (1 active row on `Dispatch_RouteRoster`) |
| GET `/polygon-builder` + Google Maps loads | ✅ |
| Zip search 021** returns 15 Boston polygons | ✅ |
| Click 02108 + 02116 → shapes render, toggle to orange when selected | ✅ (screenshots saved) |
| Save-as-Route "Boston Downtown QA Route" with 2 zips | ✅ DB verified (RouteId=2, 2 zips) |
| GET `/quoting` + upload 3-row set | ✅ (via API - browser upload requires file input) |
| Simulate `PlaywrightQA` @ Standard/Standard/25 stops → recommended $62.44 | ✅ |

### Bonus
Cockpit `RunList` Prebook button wrapped in `{false && ...}` with a comment. Backend `handlePrebook` + `onPrebook` prop stay intact; re-enable by removing the guard when the real prebook spec arrives.

### Final build
Frontend `npm run build` — 87 modules → 340 KB (gzip ~101 KB). Backend `dotnet build` — 0 CS errors.

---

## Deferred to Phase 2

- Full prebook cron path (currently only stages Status=2)
- Real potentialCouriers "nearby to selected run" distance ranking
- Reverse geocode inside FixGpsModal drag/right-click
- Handover-window offsets admin (per HANDOVER-KEVIN-RUNVIEWER-OFFSETS)
- Dynamic mode (per ROUTEBUILDER-DYNAMIC-PLAN)
- Full prebook cron path (needs spec: which tucJobBooking template shape + what schedule triggers push)

---

## Full-parity pass 1 - P1 gaps + BulkImport

Loop-closed after iteration 3, but a follow-up gap-finder pass surfaced 12
P1 items from `FULL-PARITY-GAPS.md` section 4 + a fresh Bulk Import module
request. Everything landed in a single working-tree pass (2026-07-22) and
is left unstaged for reviewer inspection before commit.

| ID | Priority | Description | Status |
|----|----------|-------------|--------|
| P1.1 | P1 | Client-filter warning on `handleDispatch` + `handleSendSelected` | FIXED (`CockpitPage.tsx` - `confirm()` gate when `state.filters.clientIds.length > 0`) |
| P1.2 | P1 | Unlocked-runs alert on dispatch | FIXED (`CockpitPage.tsx handleDispatch` - `alert()` listing first 4 unlocked run names, fall through to normal confirm so operator can still dispatch just the locked subset) |
| P1.3 | P1 | Run context menu - Edit Route Date | FIXED (`CockpitPage.tsx runContextMenu` new item, multi-selects the run's jobs and opens `BulkMoveDateModal`) |
| P1.4 | P1 | Global cross-jobs search box in Header | FIXED (`Header.tsx` search input + results dropdown, new `context/GlobalSearchContext.tsx`, `CockpitPage.tsx` consumes query for combined filtering + publishes hit list + registers jump handler) |
| P1.5 | P1 | Group context menu - Create Run From Group | FIXED (`CockpitPage.tsx groupContextMenu` postcode branch adds "Create run from these N job(s)" that calls new helper `createRunFromGroup` -> `runService.insertOrUpdate` + `assignJobsToRun`) |
| P1.6 | P1 | Suburb-names summary in postcode grouped jobs | FIXED (`GroupedJobs.tsx` bucket header now renders up to 3 distinct suburbs in parens with `+N` tail beyond 3) |
| P1.7 | P1 | JobDetail Ok_To_Leave / "Sig not req" field | FIXED (`BulkJobDto.OkToLeave` new prop, `JobService.GetBulkJobsAsync` projects from `tblBulkJob.DeliverToPrivateBusiness` per legacy SP alias, `JobService.UpdateJobDetailAsync` boolean parse branch for `OkToLeave` field name, `types/index.ts BulkJob.okToLeave`, `JobDetail.tsx` new `BooleanCheckbox` helper + Row in Load section). DB column confirmed via mssql-dfrnt MCP - `DeliverToPrivateBusiness bit NULL` is the true column, `Ok_To_Leave` was just the SP alias (no schema change needed). |
| P1.8 | P1 | New Run without a name -> auto "Run N" | FIXED (`RunList.tsx` new `nextRunAutoName()` helper scans existing runs for `/^Run \d+$/`, submitCreateRun uses blank -> auto-name path, placeholder + button title tell the operator what the next auto-name will be) |
| P1.9 | P1 | Courier drop preassign confirm dialog | FIXED (`RunList.tsx` courier-drop branch now opens an inline modal with Cancel / Assign only / Preassign (Status 18) buttons; `RunList.onAssignCourier` prop grew a `{ preassign?: boolean }` opts arg; `CockpitPage.handleAssignCourier` sets `status: 18` in the run body when preassign is chosen AND the run is not already locked) |
| P1.10 | P1 | Row-drag re-order within RunBuilder | FIXED (`RunBuilder.tsx` new drag-handle column + drag-over highlight + commitReorder; `RunBuilder.onReorderJobs` new prop; `CockpitPage.handleReorderRunJobs` posts via `runService.insertOrUpdate` with builderIndex = i + 1, reusing the existing MERGE + HOLDLOCK path on RunService) |
| P1.11 | P1 | Pre-build alert modal for multi-window info | FIXED (new `BuildAlertModal.tsx` with bucket table + skip report; `CockpitPage.doBuildRuns` now splits into a preview stage that populates `buildAlert` state and an execution stage `runBuildExecution` that only fires on operator confirm) |
| P1.12 | P1 | Google Directions polyline for 24-200 stops | FIXED (`GoogleMap.tsx` new `drawRunPolyline` chunks sequenced pins into 23-waypoint slices, calls `google.maps.DirectionsService.route` per chunk, renders each response's `overview_path` as a polyline; straight-line fallback per chunk on API failure; placeholder line shown during fetch so map doesn't flash empty; stale-request token guards mid-flight run switches) |

### Bulk Import module (new)

| Concern | Landed in |
|---------|-----------|
| Left-sidebar entry | `components/Layout/Sidebar.tsx` (new "Bulk Import" item between Routes + Quoting) |
| Route registration | `App.tsx` (`/bulk-import` -> `BulkImport`) |
| Page | `pages/BulkImport.tsx` (CSV upload + auto column mapping + validate + preview 50 rows + submit) |
| Frontend service | `services/bulkImportService.ts` |
| Controller | `API/Controllers/BulkImportController.cs` (`RouteBuilder.Admin` policy) |
| Service | `Core/Application/Services/BulkImport/BulkImportService.cs` |
| DTOs | `Core/Application/Dtos/BulkImport/BulkImportDtos.cs` |
| Entity | `Core/Domain/Despatch/TblBulkImportJob.cs` |
| Context registration | `Core/Domain/DespatchContext.cs` (`TblBulkImportJobs DbSet`) |
| DI registration | `Program.cs` (`BulkImportService` scoped) |
| DB migration | `DBMigrationV2/DatabaseScripts/Migrations/20260722100000_RoutedOperationsBulkImport.sql` (creates `tblBulkImportJob` + `IX_tblBulkImportJob_ImportSetCode` + grants; guarded `DATABASE_PRINCIPAL_ID` per grant; ends with `EXEC procRefreshAllViews`). NOT APPLIED - user to run manually. |

Scope call-outs:
- XLSX support DEFERRED to a follow-up iteration. Task said "if adding is
  risky, do CSV-only for the first iteration" - added the file-picker
  accept list rejection so operators aren't confused about missing xlsx.
- Promotion from `tblBulkImportJob` into `tblBulkJob` / `tucJob` DEFERRED
  pending SP contract. Shadow-only for now, matching the Quoting module's
  established pattern. Card at the bottom of the page tells the operator.

### Build results (2026-07-22)

- Backend `dotnet build`: 0 errors, 6 pre-existing warnings (nullability +
  EF1002 raw-SQL warnings on JobService / RunService raw region query - all
  present before this pass).
- Frontend `npm run build`: 91 modules -> 368.04 KB (gzip 109.05 KB), 12.75s.
- Frontend `npm run type-check`: clean, zero diagnostics.

---

## Full-parity pass 2 - P2 gaps

Follow-up pass over the 7 P2 items from `FULL-PARITY-GAPS.md` section 4.
Landed alongside the pass-1 working tree (2026-07-22) and left unstaged
for reviewer inspection before commit.

| ID | Priority | Description | Status |
|----|----------|-------------|--------|
| P2.1 | P2 | Map right-click "Centre here" context menu | FIXED (`GoogleMap.tsx` - map-background rightclick now opens a mini one-item context menu at the pointer instead of teleporting immediately; picking "Centre here" fires `map.setCenter`. Escape / outside-click closes. Header line shows the click lat/lng.) |
| P2.2 | P2 | Time-band 1-hour warning + auto-sort-by-postcode | FIXED (`CockpitPage.tsx groupContextMenu` time-group branch adds "Multi-select and sort by postcode" that (a) computes the bookTime spread of the bucket's jobs, (b) alerts if spread > 60 min, then (c) `REPLACE_MULTISELECT` + `SET_GROUP_MODE postcode`. Helper `bookTimeSpreadMs` at file bottom.) |
| P2.3 | P2 | Arrow-key row navigation in active pane | FIXED (`useHotkeys.ts` new `onArrowUp` / `onArrowDown` bindings, suppressed inside editable targets by the existing `isEditing` guard; `CockpitPage.tsx` new `navigateSelection` helper wraps at both ends and dispatches SELECT_JOB / SELECT_RUN based on `activePane`). |
| P2.4 | P2 | Highlight-pin bounce animation | VERIFIED (already in `GoogleMap.tsx` at the `selectedJobId` useEffect - `google.maps.Animation.BOUNCE` with a 1400 ms clear via setTimeout, plus a cleanup on effect teardown). No change needed. |
| P2.5 | P2 | GPS form "Copy Listed Address to Search" convenience button | FIXED (`FixGpsModal.tsx` new `copyListedAddress` helper + a "Use listed" neutral button between the search input and Search primary; disables when the leg has no address on file; `doSearch` grew an optional overrideQuery param so the button can search immediately without racing setState.) |
| P2.6 | P2 | RouteSavvy fallback in Build Runs when a bucket exceeds 200 stops | FIXED (`CockpitPage.tsx runBuildExecution` - HERE branch now checks `withCoords.length > 200` and falls back to `routeService.optimizeWithName` (RouteSavvy), then maps `res.routes[].name` back into a sorted `orderedJobs` array. Toast info-line warns operators when the fallback fires. Mirrors the manual-optimise path added in I0.02.) |
| P2.7 | P2 | Replace `window.prompt` in Send-Selected with a proper modal | FIXED (new `SendSelectedModal.tsx` - Modal-based courier picker with typeahead filter, sized `<select>`, matches `MergeRunModal` / `BulkMoveDateModal` style. `CockpitPage.tsx handleSendSelected` now sets `sendSelectedModal` state and defers the real dispatch to new `doSendSelected` helper. Escape close wired into the hotkey chain.) |

### Design notes

- P2.1 chose menu-over-immediate-centre for the same reason the legacy did:
  accidental right-clicks (e.g. during a drag) shouldn't teleport the map
  away from where the operator was working. The menu is a single-item popup
  identical in style to `MapContextMenu` but scoped to the map background
  path (no marker/pin context).
- P2.2 was intentionally added as a NEW menu item rather than modifying the
  existing "Open these times in Jobs list" behaviour. The old item still
  just multi-selects + narrows the Jobs list filter; the new item performs
  the full legacy `setTime()` behaviour (warn + switch mode). Operators can
  pick whichever matches their intent.
- P2.6 approximates `totalMinutes` as 0 because RouteSavvy's response shape
  in this codebase's `LatLng[]` DTO doesn't expose a totalTime field. That
  means `legMinutes` stays effectively flat (0-per-leg) on the >200 branch
  and the window-fit check falls back to per-stop overhead only. Matches
  the legacy fallback quality for what is a rare bucket size (documented in
  the inline comment). Future work: add totalTime to the RouteSavvy DTO if
  US tenants report window-fit misfires on >200 postcodes.
- P2.7 modal is a plain `<select size=N>` list rather than a fancy
  combobox because the courier list is usually small enough (~15-40 rows
  per tenant) that a filterable pick list gives the operator what they want
  without introducing a new component pattern.

### Build results (2026-07-22, pass 2)

- Backend `dotnet build`: 0 errors, 0 warnings.
- Frontend `npm run build`: 92 modules -> 373.22 KB (gzip 110.34 KB), 1.77s.
- Frontend `npm run type-check`: clean, zero diagnostics.
- Em-dash / en-dash sweep across changed files: clean.

### Files touched

Modified:
- `wwwroot/app/react/components/cockpit/GoogleMap.tsx` (P2.1 map menu; P2.4 confirmation only)
- `wwwroot/app/react/components/cockpit/CockpitPage.tsx` (P2.2 group menu; P2.3 nav; P2.6 fallback; P2.7 wiring)
- `wwwroot/app/react/components/cockpit/FixGpsModal.tsx` (P2.5 use-listed button + doSearch override)
- `wwwroot/app/react/hooks/useHotkeys.ts` (P2.3 arrow bindings)
- `PARITY-TRACKING.md` (this section)

New:
- `wwwroot/app/react/components/cockpit/SendSelectedModal.tsx` (P2.7 courier picker)

No DB migrations required for this batch (all changes are frontend + a
frontend-only hook update).

---

## Full-parity pass 3 - Loop 2 gaps

Third-round follow-up over the 3 P2 + 2 P3 items surfaced by the Loop 2
gap-finder audit (`FULL-PARITY-GAPS.md` section "Loop 2 Findings"). Ships
alongside the pass-1 and pass-2 working trees (2026-07-22) and is left
unstaged for reviewer inspection before commit.

| ID | Priority | Description | Status |
|----|----------|-------------|--------|
| L2.P2.1 | P2 | Fix GPS Places autocomplete country restriction | FIXED (`FixGpsModal.tsx` - all three Geocoder call sites now pass `region: countryCode` and the forward-address search additionally passes `componentRestrictions: { country: countryCode }`; `countryCode` derived from `useAuth().isUsTenant`, making this the first real consumer of the flag that Iteration 3 flagged as deferred - see I3.4) |
| L2.P2.2 | P2 | Confirm before removing job from a LOCKED run | FIXED (`CockpitPage.tsx handleRemoveJobFromRun` - looks up owning run via `state.runs.find(r => r.jobs.some(j => j.bulkJobId === jobId))`, opens `window.confirm(...)` when `run.status > 0`; abort on cancel. Applies to every remove path: JobsList context menu, Run Builder inline menu, Map right-click "Remove from run", hotkey Del/Backspace) |
| L2.P2.3 | P2 | Grey unassigned map pin: single-click add to selected run | FIXED (`GoogleMap.tsx` - new `onAddToRunFromMap?: (jobId, runId) => void` optional prop; marker click handler routes to it when `p.kind === 'unassigned'` AND `selectedRun` is present AND `selectedRun.isVoidRun === false` AND `(selectedRun.status ?? 0) === 0`, otherwise falls through to existing select+bounce path. `CockpitPage.tsx handleAddToRunFromMap` = `assignJobsToRun(runId, [jobId])`. Right-click context menu still works for multi-run picking / no-selection cases) |
| L2.P3.1 | P3 | RunList multi-select row colour matches pin palette | FIXED (`GoogleMap.tsx` - `MULTI_RUN_COLOURS` exported; `RunList.tsx` - imports it, builds a `runId -> colour` map indexed the same way `buildPins()` does (excluding the primary `selectedRunId` from the palette since sequenced-orange wins on map for that run), applies `style={{ backgroundColor: colour + '40' }}` for ~25% alpha. Only fires when `selectedRunIds.length > 1`, matching the legacy trigger. Row title updated to hint "Same colour on the map.") |
| L2.P3.2 | P3 | JobDetail address-row right-click "Update GPS" per-row shortcut | FIXED (`JobDetail.tsx` - Pickup + Delivery `Section` blocks wrapped in `<div onContextMenu=...>` that opens a mini one-item popover; picking "Update GPS..." calls `onOpenGpsFix(job, 'FromAddress' \| 'ToAddress')`. `FixGpsModal.tsx` - new `defaultLeg?: 'ToAddress' \| 'FromAddress'` prop honoured in the initial `useState` and re-applied on every open. `CockpitPage.tsx` - `gpsFixJob` state widened to `{ job; leg? }` so the leg travels alongside; header "Fix GPS" button still passes no leg, preserving the historical default) |

### Design notes

- L2.P2.1 sends BOTH `componentRestrictions` (hard filter, no out-of-country
  results returned) AND `region` (soft bias) on the forward-address search,
  because a very short query like "Green St" needs the hard filter to avoid
  a Belfast match, but reverse-geocoded coord lookups can't accept
  `componentRestrictions` per the Geocoding API docs, so those get `region`
  only.
- L2.P2.2 uses `window.confirm` (matching the legacy `HereMap.tpl:155-161`
  behaviour) rather than a Modal-based dialog. Loop 1 P2.7 replaced a
  `window.prompt` with a modal but that was for a dispatcher pick-list -
  this is a simple yes/no gate and doesn't warrant a custom Modal.
- L2.P2.3 preserves the right-click flow rather than eliminating it - some
  operators prefer the explicit picker even with a selected run, and the
  right-click is the only path when no run is selected. The primary-click
  path is only taken when EVERY guard passes; any locked / void / no-
  selection case falls back to the existing bounce-and-select behaviour.
- L2.P3.1 uses inline `style` with hex+alpha because Tailwind can't compile
  arbitrary hex-code lists at build time; keeps the palette source of truth
  in `MULTI_RUN_COLOURS` (single import, two consumers). Alpha is `40` hex
  (~25%) so row text stays legible.
- L2.P3.2 chose to wrap each Section in a `div` with `onContextMenu` rather
  than modify the `Section` helper - keeps the helper generic and matches
  the mini-menu style already used by GoogleMap's `mapMenu` and MapContextMenu.
  Firing `onContextMenu` doesn't preventDefault on the browser menu unless
  `onOpenGpsFix` is wired (a defensive no-op for embed contexts that omit
  the prop).

### Build results (2026-07-22, pass 3)

- Backend `dotnet build`: 0 errors, 0 warnings.
- Frontend `npm run build`: 92 modules -> 375.16 kB (gzip 111.26 kB), 2.60s.
- Frontend `npm run type-check`: clean, zero diagnostics.
- Em-dash / en-dash sweep across changed files: clean.

### Files touched

Modified:
- `wwwroot/app/react/components/cockpit/FixGpsModal.tsx` (L2.P2.1 country
  restriction on Geocoder + L2.P3.2 `defaultLeg` prop)
- `wwwroot/app/react/components/cockpit/CockpitPage.tsx` (L2.P2.2 confirm
  gate + L2.P2.3 map add-from-pin wiring + L2.P3.2 gpsFixJob leg carrier)
- `wwwroot/app/react/components/cockpit/GoogleMap.tsx` (L2.P2.3 grey-pin
  single-click branch + L2.P3.1 exports MULTI_RUN_COLOURS)
- `wwwroot/app/react/components/cockpit/RunList.tsx` (L2.P3.1 palette-
  tinted multi-select row backgrounds)
- `wwwroot/app/react/components/cockpit/JobDetail.tsx` (L2.P3.2 pickup /
  delivery right-click popover + `onOpenGpsFix` leg arg)
- `PARITY-TRACKING.md` (this section)

New: none.

No DB migrations required for this batch (all changes are frontend).

---

## BulkImport pass 2 - P0 + P1 + quick-win P2s

Follow-up pass over the gap audit in `BULKIMPORT-GAPS.md` (P0 blockers + P1
completeness + quick-win P2s). Landed 2026-07-22, unstaged for reviewer
inspection.

### P0 (all shipped)

| ID | Gap | Status |
|----|-----|--------|
| P0.1 | Promotion path from `tblBulkImportJob` -> `tblBulkJob` | SHIPPED (new `BulkImportPromotionService` iterates pending rows, resolves Client/Speed/VehicleSize FKs, geocodes via HERE, inserts one `tblBulkJob` per row; sets `PromotedUtc / PromotedBulkJobId / PromotedByUser` for idempotency; `POST /api/bulk-import/{code}/promote` returns per-row outcome) |
| P0.2 | Client / Speed / VehicleSize FK resolution | SHIPPED (case-insensitive dict lookup vs `tucClient.ucclName + ucclCode`, `tucJobType.ucjtName`, `VehicleSize.VehicleName`; unknown -> row flagged `UnknownClient / UnknownSpeed / UnknownVehicleSize` and skipped, batch continues per D3) |
| P0.3 | Address geocoding at promote-time | SHIPPED (new `HereGeocodeService` -> `geocode.search.hereapi.com/v1/geocode`; server-side proxy so API key stays out of browser; both pickup + delivery legs geocoded; failure -> row `GeocodeFailed:Pickup / :Delivery` and skipped) |
| P0.4 | `CreatedByUserName` audit column | SHIPPED (migration adds column; `BulkImportService.SubmitAsync` reads from `HttpContext.User.Identity?.Name`; surfaced on set summary + history drill-in) |

### P1 (all shipped)

| ID | Gap | Status |
|----|-----|--------|
| P1.5 | XLSX server-side parsing | SHIPPED (`ClosedXML 0.104.2` added to csproj; new `BulkImportParseService.Parse` handles `.xlsx / .xlsm`, first-sheet-first-row headers, formatted-string cell reads so operator-visible dates/times survive) |
| P1.6 | BOM strip + encoding fallback | SHIPPED (UTF-8 BOM detected and stripped; strict UTF-8 decode with ISO-8859-1 fallback on `DecoderFallbackException`; encoding hint surfaced on parse result) |
| P1.7 | Delimiter auto-detect | SHIPPED (`DetectDelimiter` sniffs comma / semicolon / tab frequency across first 5 lines; comma-preferred tie-break; hint surfaced) |
| P1.8 | In-file dedupe by Reference | SHIPPED (`ValidateRowsAsync` tracks seen references case-insensitively; second occurrence flagged with the first row number) |
| P1.9 | Live-jobs dedupe (WARN) | SHIPPED (single batched query: `(Reference, BookedDate)` pairs vs `tblBulkJob.JobNumber + BookDate`; WARN not BLOCK per D4) |
| P1.10 | Unique index `(ImportSetCode, Reference)` | SHIPPED (`UX_tblBulkImportJob_SetCode_Reference` in migration; per-row save fallback in `SubmitAsync` when a chunk hits the constraint so partial success is preserved) |
| P1.11 | Preview pagination + total count | SHIPPED (client-side 50-row pages with prev/next + total; also new `GET /api/bulk-import/sets/{code}/rows` for drill-in) |
| P1.12 | Inline edit before promote | SHIPPED (`PUT /api/bulk-import/rows/{rowId}` with `BulkImportRowUpdateRequest`; edit modal in History drill-in; guarded server-side to reject edits on already-promoted rows) |
| P1.13 | Download error CSV | SHIPPED (`Download errors` button on the map panel; filtered CSV with UTF-8 BOM so Excel opens it correctly) |
| P1.14 | Chunked submit + progress | SHIPPED (rows > 200 split into 200-row chunks; per-chunk `IdempotencyKey` suffixed with chunk index; progress bar + text; server auto-suffixes SetCode on the first chunk and later chunks reuse the allocated code so all chunks land in one logical set) |
| P1.15 | Idempotency guard | SHIPPED (client sends GUID `IdempotencyKey`; server caches full response for 5 minutes via `IMemoryCache`; repeat submit returns the cached result instead of double-inserting) |
| P1.16 | View rows of past set endpoint + drill-in | SHIPPED (`GET /api/bulk-import/sets/{code}/rows?page&pageSize=50`; History `View` button opens modal with the paged grid + per-row Edit) |
| P1.17 | 12-hour AM/PM time parsing | SHIPPED (`BulkImportService.ParseTime` regex accepts `9:30 AM`, `9:30am`, `21:30`, `HHmm`, `HHmmss`, `HH:mm:ss`) |
| P1.18 | Date-locale hint (US vs NZ) | SHIPPED (server-side scan of first 20 rows of any date-shaped column -> `us / nz / unknown` hint; frontend radio picker on the Upload panel; parse re-projection is locale-aware) |

### Quick-win P2s shipped

| ID | Gap | Status |
|----|-----|--------|
| P2.19 | Drag-and-drop file upload | SHIPPED (`onDrop / onDragOver` wired to the upload panel; visual highlight when over) |
| P2.20 | Template CSV download | SHIPPED (`GET /api/bulk-import/template.csv` returns a static header row + 2 example rows; header link on the page toolbar; `AllowAnonymous` so operators can share the URL) |
| P2.21 | Cancel in-progress upload | SHIPPED (`AbortController` wired for preview + submit; `Cancel` button appears next to Import while the chunked upload is running) |

### Explicit DEFERS (not shipped)

- Mapping templates table (needs its own schema + admin UI)
- Competitor-TMS format detection (heuristic port from SetUpDashboard)
- Retention purge job (schema for soft-delete `DeletedUtc` landed; the actual
  nightly purge is a separate service)
- Sort / filter grid in preview (P2 heavy)
- Google Sheets URL import
- Fuzzy-match badges on the mapping dropdowns
- All P3 polish items

### Design decisions applied (all D1-D10 verbatim)

- D1 promotion in C# service, not new SP.
- D2 two-step submit + explicit promote button.
- D3 unknown FK fails the row, not the set.
- D4 dedupe both in-file (BLOCK) and vs live (WARN).
- D5 geocoding at promote-time (skipped at preview to save cost).
- D6 500 sync / 500-5000 chunked / >5000 rejected (server enforces 5000 cap).
- D7 server-allocated ImportSetCode with `-N` collision suffix.
- D8 soft-delete via `DeletedUtc`; retention purge job DEFERRED.
- D9 server-side XLSX via ClosedXML.
- D10 kept `RouteBuilder.Admin` for MVP; TODO note left in controller header.

### Files touched

New:
- `Core/Application/Services/BulkImport/BulkImportPromotionService.cs` (P0.1)
- `Core/Application/Services/BulkImport/BulkImportParseService.cs` (P1.5-P1.7)
- `Core/Application/Services/Routing/HereGeocodeService.cs` (P0.3)

Modified:
- `RoutedOperations.csproj` (added ClosedXML 0.104.2)
- `Core/Domain/Despatch/TblBulkImportJob.cs` (audit + promote columns)
- `Core/Application/Dtos/BulkImport/BulkImportDtos.cs` (many new records for
  parse, promote, edit, history)
- `Core/Application/Services/BulkImport/BulkImportService.cs` (paginated rows,
  inline edit, chunked+idempotent submit, expanded validation)
- `API/Controllers/BulkImportController.cs` (new endpoints: parse, promote,
  rows, updateRow, template)
- `Program.cs` (DI registrations for HereGeocodeService,
  BulkImportPromotionService, BulkImportParseService)
- `wwwroot/app/react/services/bulkImportService.ts` (new API methods,
  types, template URL)
- `wwwroot/app/react/pages/BulkImport.tsx` (drag-and-drop, XLSX,
  paginated preview, chunked upload, cancel, template link,
  errors CSV, history modal, inline edit, promote button)
- `DBMigrationV2/DatabaseScripts/Migrations/20260722100000_RoutedOperationsBulkImport.sql`
  (edited in-place since uncommitted / not yet applied: adds audit +
  promote + soft-delete columns, unique dedupe index, promote fast-path
  index; idempotent guards on ALTER TABLE for partial re-applies)

### Build results (2026-07-22, BulkImport pass 2)

- Backend `dotnet build`: 0 errors, 6 warnings (all pre-existing in
  JobService / RunService - nullable-value + EF1002 raw-SQL warnings from
  the region-filter path; no new warnings from this pass).
- Frontend `npm run type-check`: clean.
- Frontend `npm run build`: 92 modules -> 386.38 KB (gzip 114.22 KB), 2.93s.

### Migration

Single file, edited in-place because it was uncommitted:
`DBMigrationV2/DatabaseScripts/Migrations/20260722100000_RoutedOperationsBulkImport.sql`

NOT APPLIED - user to run manually via the standard DBMigrationV2 apply flow.

---

## BulkImport pass 3 - L2 bug fixes + P1 features

Session date: 2026-07-22. Sourced from BULKIMPORT-GAPS.md "Loop 2 Findings"
section (5 P1 bugs + 3 P1 features + a set of quick-win P2s). Pass-2
migration was already applied to DFRNT tenant 1 per the loop-2 testing
report, so per CLAUDE.md "committed migrations - new file for fixes" schema
work ships as a fresh timestamped migration rather than editing the pass-2
file.

### P1 bugs (all shipped)

| ID | Bug | Status |
|----|-----|--------|
| L2B.1 | Inline-edit reval flips row to Failed (row saw itself as own dedupe) | SHIPPED (`ValidateRowsAsync` now takes `ignoreRowId`; `UpdateRowAsync` passes the edited row's PK so the same-set dedupe query excludes it; unique index still catches real cross-row collisions at save time) |
| L2B.2 | Promote has no concurrency guard | SHIPPED (`BulkImportPromotionService.PromoteCoreAsync` wraps the pending-rows load + loop in `sp_getapplock @Resource = 'bulkimport-promote-<setCode>'` with `LockOwner=Session`; released via `IAsyncDisposable` guard so a throw does not leak the lock; second concurrent invocation blocks on the lock instead of duplicating tblBulkJob inserts) |
| L2B.3 | Sparse XLSX headers drop columns | SHIPPED (`BulkImportParseService.ParseXlsx` now uses `sheet.LastColumnUsed()` + `sheet.LastRowUsed()` to bound reads; header row iterates 1..lastColUsed regardless of blanks; blank headers auto-named `col_A / col_B / ...` with a warning so operator sees what happened) |
| L2B.4 | XLSX ZIP-bomb OOM risk (no cell / row cap) | SHIPPED (three-tier caps: `MaxDataRows = 10_000`, `MaxColumns = 200`, `MaxTotalCells = 500_000L`; enforced BEFORE the cell iteration; also `MaxUploadBytes = 20 MB` file-size gate at the controller + Program.cs FormOptions + Kestrel; caps blown = new `BulkImportParseException` -> 413 Payload Too Large with a friendly message) |
| L2B.5 | `AllocateSetCodeAsync` TOCTOU race | SHIPPED (`SubmitAsync` acquires `sp_getapplock @Resource = 'bulkimport-alloc-<baseCode>'` BEFORE allocation + first-row insert; different base codes still run concurrently, same base code serialises so two operators with "Acme-2026-07-22" get "Acme-2026-07-22" and "Acme-2026-07-22-2" per D7) |

### P1 features (all shipped)

| ID | Feature | Status |
|----|---------|--------|
| L2F.1 | Persist geocoded coords back to shadow row | SHIPPED (new migration adds `PickupLat / PickupLng / DeliveryLat / DeliveryLng DECIMAL(9,6) NULL`; `BulkImportPromotionService.ResolvePickupCoordsAsync / ResolveDeliveryCoordsAsync` check the shadow first, call HERE only on cache miss, persist the coords via `SaveChangesAsync` BEFORE the tblBulkJob insert so a later insert failure still keeps the cached geocode; a promote retry after a partial-failure batch does not re-bill HERE) |
| L2F.2 | Row-count cap in Parse endpoint | SHIPPED (see L2B.4 above; controller explicitly returns 413 with actionable message; frontend upload panel now shows the 20 MB / 10k row / 200 col limits) |
| L2F.3 | Progress polling for promote | SHIPPED (new `StartBackgroundPromote` fires `Task.Run` over `PromoteCoreAsync`; published progress in a static `ConcurrentDictionary<string, PromoteProgress>` keyed by set code; controller `POST /api/bulk-import/{code}/promote?async=true` returns 202 + statusUrl immediately; new `GET /api/bulk-import/{code}/promote/status` returns `{active, total, completed, failed, pending, done, error, result}`; frontend polls every 2 s while promoting, renders a progress bar + counter in the History modal footer; result cached for 10 min after done so the final poll always sees the FinalResult) |

### Quick-win P2s (all shipped)

| ID | Item | Status |
|----|------|--------|
| L2Q.1 | Country hint on HERE geocode | SHIPPED (`BulkImportPromotionService` reads the `CountryCode` claim from HttpContext, maps US -> USA / NZ -> NZL, passes to `HereGeocodeService.GeocodeAsync(address, countryHint)`; the geocoder already accepts the arg per pass-2 signature) |
| L2Q.2 | HttpClient timeout on HERE | SHIPPED (`Program.cs` registration switched from `AddScoped<HereGeocodeService>()` to `AddHttpClient<HereGeocodeService>(c => c.Timeout = TimeSpan.FromSeconds(5))`; typed-client-factory injects a bounded HttpClient; a HERE outage no longer stalls the whole promote loop on the default 100 s) |
| L2Q.3 | FK-lookup queries filter by name (was full table) | SHIPPED (`LookupKnownClientsAsync` now `WHERE ucclName IN @names OR ucclCode IN @names`; `LookupKnownSpeedsAsync` / `LookupKnownVehiclesAsync` add `.Where(x => names.Contains(x.Name))`; per-keystroke inline-edit reval no longer pulls 4000+ rows from tucClient) |
| L2Q.4 | Client-side file-size gate | SHIPPED (`BulkImport.tsx handleFile` rejects > 20 MB with a friendly toast before starting the upload) |
| L2Q.5 | `downloadErrorsCsv` includes warnings | SHIPPED (button renamed to "Download issues"; enabled when either problems OR warnings exist; export includes a `Type` column marking each row Error or Warning; warning-only rows now exportable so operators can debug batches that are 0-error N-warning) |

### Files touched (pass 3)

New:
- `DBMigrationV2/DatabaseScripts/Migrations/20260722120000_BulkImportGeocodeCache.sql`
  (adds PickupLat / PickupLng / DeliveryLat / DeliveryLng DECIMAL(9,6) NULL
  on tblBulkImportJob; idempotent guards match the pass-2 migration style;
  NOT APPLIED - user runs manually)

Modified:
- `Core/Application/Services/BulkImport/BulkImportService.cs` (L2B.1
  ignoreRowId, L2B.5 applock, L2Q.3 filtered FK lookups, new
  AcquireAppLockAsync helper)
- `Core/Application/Services/BulkImport/BulkImportPromotionService.cs`
  (L2B.2 applock, L2F.1 coord cache with per-address persist, L2F.3
  StartBackgroundPromote + PromoteProgress + snapshot API, L2Q.1
  countryHint from claim, structural: PromoteCoreAsync split from
  PromoteAsync so both sync + background call sites share the loop)
- `Core/Application/Services/BulkImport/BulkImportParseService.cs`
  (L2B.3 LastColumnUsed + auto-named blank headers, L2B.4 / L2F.2 caps
  and new BulkImportParseException, inline ColumnLetter helper)
- `Core/Domain/Despatch/TblBulkImportJob.cs` (L2F.1: PickupLat / PickupLng /
  DeliveryLat / DeliveryLng decimal(9,6) properties)
- `API/Controllers/BulkImportController.cs` (L2F.2 explicit 413 gate + parse
  exception mapping, L2F.3 `?async=true` variant + /promote/status endpoint,
  RequestSizeLimit tightened to 20 MB)
- `Program.cs` (maxFileSize -> 20 MB, `AddHttpClient<HereGeocodeService>`
  with 5 s timeout)
- `wwwroot/app/react/services/bulkImportService.ts` (L2F.3 promoteAsync +
  promoteStatus methods)
- `wwwroot/app/react/pages/BulkImport.tsx` (L2Q.4 client-side size gate,
  L2Q.5 warnings in export + Download issues rename, L2F.3 progress bar +
  poll wiring in the History modal, upload-panel limit copy updated to
  "20 MB, 10,000 rows, 200 columns")
- `PARITY-TRACKING.md` (this section)

### Build results (2026-07-22, BulkImport pass 3)

- Backend `dotnet build`: 0 errors, 6 warnings (all pre-existing in
  JobService / RunService - nullable-value + EF1002 raw-SQL warnings; no
  new warnings from this pass).
- Frontend `npm run type-check`: clean.
- Frontend `npm run build`: 92 modules -> 388.16 KB (gzip 114.67 KB), 2.69 s.

### Migration

`DBMigrationV2/DatabaseScripts/Migrations/20260722120000_BulkImportGeocodeCache.sql`

NOT APPLIED - user to run manually via the standard DBMigrationV2 apply flow.
Adds 4 nullable DECIMAL(9,6) columns; no qualifying object; safe on the
shared legacy-QI landmine DB. Idempotent guards on the ALTER TABLE so a
partial re-apply is safe.

### Design calls flagged

- **Background promote model** (L2F.3): went with `Task.Run` + a static
  `ConcurrentDictionary<string, PromoteProgress>` instead of a full
  `IHostedService` / channel pipeline. Rationale: promote is per-operator,
  per-set, kicked by a UI action; no cross-request queueing, no fairness
  requirement, no retry semantics beyond "run again". Trade-off: a pod
  restart during a large promote loses the in-memory progress tracking BUT
  the shadow rows are the source of truth (PromotedUtc is persisted per
  row) so a re-fired Promote picks up cleanly where it left off - the
  operator just loses the live progress bar. This felt like the right
  operational cost vs the complexity of a durable queue for a per-set
  "kick off + poll" flow.
- **Tenant capture for background scope** (L2F.3): the DbContextFactory
  reads tenant from HttpContext, which is torn down when the controller
  returns 202. `StartBackgroundPromote` latches `CurrentTenantID`,
  `CountryCode`, and `Identity.Name` upfront while HttpContext is valid,
  then spins a FRESH DI scope via injected `IServiceScopeFactory`, sets
  `httpContextAccessor.HttpContext = new DefaultHttpContext()`, and stamps
  `Items[OverrideTenantIdItemsKey] = tenantId`. The existing factory
  already honours that override channel so no factory-side changes were
  needed. PromoteCoreAsync reads promoter + countryClaim from either the
  live ClaimsPrincipal (sync path) or from Items (background path) so
  both call sites work.
- **Coord cache subtlety** (L2F.1): the cache-hit branch returns the coords
  but NOT the suburb / postcode (null). Reason: the shadow row does not
  carry the geocoded suburb / postcode strings (only the operator-supplied
  Suburb / PostCode), and re-calling HERE just to fetch the suburb string
  would defeat the point of the cache. The tblBulkJob insert path already
  tolerates a null suburb / postcode (falls back to empty string / null),
  so the cache-hit re-insert of the same row (rare - would only happen if
  the tblBulkJob delete + re-promote flow existed) is safe. Flagged so a
  future "carry the geocoded suburb across too" migration knows why they
  are currently absent.
- **Applock lifetime** (L2B.2, L2B.5): `LockOwner = 'Session'` (not
  `'Transaction'`) so the lock persists across EF Core's implicit
  transactions per SaveChangesAsync. Released explicitly via the
  IAsyncDisposable guard on the way out. If the connection is closed
  (pod dies) the session ends and SQL releases the lock automatically -
  no orphan-lock risk.
- **20 MB cap harmonisation**: pass 2 shipped a 25 MB limit; pass 3
  tightens to 20 MB across all four layers (client, controller
  RequestSizeLimit, Program.cs FormOptions, BulkImportParseService
  constant). Kept in sync so a value change in one place is a source-code
  review flag for the other three.

---

## BulkImport pass 4 - L3 security + concurrency fixes

Session date: 2026-07-22. Sourced from `BULKIMPORT-GAPS.md` "Loop 3 Findings -
final convergence check". 4 P1 items covering multi-tenant isolation,
cross-tenant info disclosure, a duplicate-task race, and a frontend timer
leak. Plus the deployment-order note that lives at the top of this file.

### P1 bugs (all shipped)

| ID | Bug | Status |
|----|-----|--------|
| L3B.1 | Progress dictionary not tenant-scoped (two tenants + same set code collide) | SHIPPED (`BulkImportPromotionService.cs` - key changed from `importSetCode` to `{tenantId}:{importSetCode}` via new `ProgressKey` helper; `GetProgress` + `GetProgressSnapshot` signatures now take `tenantId` first; `StartBackgroundPromote` reads `CurrentTenantID` claim and threads it through. TryRemove sweep and TryUpdate stale-swap both use the composite key.) |
| L3B.2 | `/promote/status` did not check tenant ownership - any operator could read another tenant's progress | SHIPPED (`BulkImportController.cs PromoteStatus` now resolves `CurrentTenantID` via new `ResolveTenantId` helper + passes it to `GetProgressSnapshot`; miss returns the same `{active=false}` shape that a truly-unknown set returned before the fix, so a cross-tenant probe cannot use response shape as an existence oracle. Endpoint also returns 401 if the tenant claim is absent - belt-and-braces vs the `[Authorize]` policy. All OTHER BulkImport endpoints already scope via `Context.TblBulkImportJobs` which flows through `DynamicDespatchDbContextFactory` + `CurrentTenantID`-derived connection string, so they are implicitly tenant-scoped at the DB layer with no code change.) |
| L3B.3 | `StartBackgroundPromote` TryGetValue-then-assign race could spawn two Task.Run calls, second one blows up on the applock | SHIPPED (`BulkImportPromotionService.StartBackgroundPromote` now uses `Progress.GetOrAdd(key, factory)` with a `started` sentinel flag; only the racer that installed the fresh entry spins the background Task; losing racer receives the existing progress without spawning a duplicate. Stale done=true entries get an atomic `TryUpdate` swap so an operator can start a new promote after fixing FK issues without waiting for the 10-min sweep.) |
| L3B.4 | Frontend poll interval leak on `closeHistory` + no unmount cleanup | SHIPPED (`BulkImport.tsx closeHistory` now clears `promotePollRef` + resets `promoting` / `promoteProgress`; new `useEffect(() => () => { clearInterval + abortRef.abort() }, [])` fires on component unmount so SPA navigation away from the page also stops the poll. Empty dep list is intentional - the ref does not need to be in deps.) |

### Deployment note (L3F.1)

Added a `## Deployment Notes (BulkImport)` section at the very top of this
file (above the iteration log) so operators running the deploy see it before
scrolling through the iteration history. Documents:
- Migration `20260722100000_RoutedOperationsBulkImport.sql` MUST land before
  or with pass 2 code.
- Migration `20260722120000_BulkImportGeocodeCache.sql` MUST land before or
  with pass 3 code.
- Symptoms of a code-first apply (Invalid object / column names).
- Reverse order (migration first) is always safe.

### Design calls

- **Progress key format** (L3B.1): went with `"{tenantId}:{setCode}"` string
  concatenation rather than a `(string,string)` value tuple or a nested
  Dictionary. Rationale: `ConcurrentDictionary<TKey,...>` on a value tuple
  requires an explicit `IEqualityComparer` for case-insensitive matching on
  setCode, and a nested dictionary needs manual per-tenant locking. A single
  flat string keyed by `StringComparer.OrdinalIgnoreCase` (already the
  existing comparer) is smaller + cheaper.
- **Missing tenant claim on status endpoint** (L3B.2): chose 401 rather than
  returning `{active=false}`. Rationale: the endpoint is behind
  `[Authorize(Policy = "RouteBuilder.Admin")]` so a missing tenant claim on
  an authenticated request means the auth cookie is malformed; failing loud
  is more informative than silently returning "no active promote". A truly
  unauthenticated request never gets past the policy so we do not double-
  handle that case.
- **Existence oracle** (L3B.2): the snapshot miss on a wrong tenant returns
  the EXACT same shape (`{active=false}`) as a genuinely-unknown-set miss on
  the correct tenant. Deliberate - if operator A polls a name from tenant B
  they get "not running" whether the set exists in B or not. No oracle.
- **Stale entry swap** (L3B.3): if the entry we find has `Done=true` (a
  previous run that has not been swept yet by the 10-min timer), we swap it
  atomically via `TryUpdate` so the operator can immediately re-promote after
  fixing an issue. If a concurrent racer wins the swap we accept their entry
  - either outcome results in exactly one background task running per
  (tenant, set), which is the invariant we cared about.
- **useEffect empty dep list** (L3B.4): intentional. `promotePollRef` is a
  React `useRef` (stable across renders), so listing it in deps would
  neither trigger new subscriptions nor prevent the effect from re-firing
  wrongly. The eslint suppression is scoped narrowly to the cleanup effect.
- **Progress dictionary IS still process-local** (all L3B.*): the fixes
  keep the dictionary in-process. Multi-pod deployments will see poll
  requests hit whichever pod StartBackgroundPromote fired on; a wrong-pod
  poll returns `{active=false}` and the frontend gracefully falls through
  to the "task fell out of the dictionary" branch. Fine for the current
  single-pod deploy. Session affinity or Redis-backed progress is a Phase 2
  concern once the app scales horizontally.

### Files touched (pass 4)

Modified:
- `Core/Application/Services/BulkImport/BulkImportPromotionService.cs`
  (L3B.1 tenant-scoped key + ProgressKey helper; L3B.3 GetOrAdd atomic +
  stale-entry TryUpdate swap; signature changes on `GetProgress` +
  `GetProgressSnapshot`)
- `API/Controllers/BulkImportController.cs` (L3B.2 tenant-scoped status
  lookup + `ResolveTenantId` helper + Unauthorized branch on missing claim)
- `wwwroot/app/react/pages/BulkImport.tsx` (L3B.4 closeHistory clears
  poll + unmount cleanup useEffect)
- `PARITY-TRACKING.md` (this section + L3F.1 deployment note at top)

New: none.

No DB migration required. No changes to DTOs or public API shapes - the
`GetProgressSnapshot` signature change is internal (only consumer is the
controller in this repo).

### Build results (2026-07-22, BulkImport pass 4)

Run after the pass 3 baseline; see report reply for the exact numbers this
session.

---

## BulkImport pass 5 - silent-fail on submit

Session date: 2026-07-22. Sourced from real-user Playwright testing: with
migration `20260722120000_BulkImportGeocodeCache.sql` unapplied, `POST
/api/bulk-import/submit` hit `Invalid column name 'PickupLat'` (SqlException
207) on every row. The pass-4 per-row retry loop caught each failure as a
`DbUpdateException`, logged `"Bulk-import row skipped: ..."` at Info level,
and moved on. Because ValidationStatus was `"Ok"` for every row (they had
already passed pass 2 validation), the inserted counter never advanced but
the rejected counter also stayed at 0 (rejections come from the pre-save
validation list). Final response: `{ inserted: 0, rejected: 0,
rejections: [] }` and the UI painted a GREEN "success" banner. Operator
walked away thinking the import worked; no rows landed.

### P1 bugs (all shipped)

| ID | Bug | Status |
|----|-----|--------|
| P5B.1 | `SubmitAsync` swallowed schema-drift SqlExceptions (207 invalid column, 208 invalid object, 2812 SP not found) as per-row skips + returned 0/0 as success | SHIPPED (`BulkImportService.cs` - new `BulkImportSystemException` class + `TryClassifySystemLevel` helper walks the InnerException chain for a `SqlException` and matches error codes 207/208/2812; both the bulk `SaveChanges` catch and the per-row loop catch classify + re-throw as system-level with a partial-count and a hint. Log level bumped to Error with a distinct `"BulkImport system-level failure - aborting submit"` tag so the row-skip and abort paths are searchable separately.) |
| P5B.2 | Any non-schema exception repeating identically for 3+ consecutive rows (e.g. connection reset mid-batch, novel SqlException code we do not classify) also silently zeroed out the batch | SHIPPED (`BulkImportService.cs` - per-row loop tracks `lastErrorSignature = "{type}|{message}"` + `consecutiveSame` counter; on the 3rd repeat throws `BulkImportSystemException` with a generic hint pointing at server logs. Successful save resets the counter so a legitimate mid-batch collision followed by good rows does not trip the guard.) |
| P5B.3 | Controller returned generic 500 on `BulkImportSystemException` with no structured body, so the React error toast just showed a stack trace snippet | SHIPPED (`BulkImportController.cs Submit` - new catch block returns HTTP 500 with `{ error, hint, partialCount }`; existing `InvalidOperationException -> 400` catch untouched so the 5000-row cap still comes out as 400.) |
| P5F.1 | React UI painted a green success banner on `{ inserted: 0, rejected: 0 }` and had no way to render a server-provided hint | SHIPPED (`api.ts` new `ApiError` class carries `status` + structured `body` + optional `hint` while still being an `Error` subclass so existing `catch (e as Error)` sites keep working; `BulkImport.tsx doSubmit` now `instanceof ApiError` checks 500 responses + renders a persistent RED banner with the error message, hint, and partial-count; a belt-and-braces `zeroZeroWarning` amber banner fires on the `0/0` outcome even when the response is 200, so any future codepath that regresses to silent-drop still surfaces the anomaly.) |

### Design calls

- **New exception type (not reuse `InvalidOperationException`)**: chose a
  dedicated `BulkImportSystemException` rather than piggybacking on
  `InvalidOperationException`. Rationale: the controller's existing
  `InvalidOperationException -> 400` catch is for operator-recoverable
  violations (row cap exceeded, missing set code). A schema drift is neither
  operator-recoverable nor a 400. Reusing the exception would either
  misclassify one path as the other, or force fragile message-string
  matching in the catch block. New class = zero coupling + typed body fields
  (`Hint`, `PartialInsertedCount`) survive the throw.
- **Threshold of 3 consecutive identical failures** (P5B.2): picked 3 as a
  balance between "trip fast on a genuinely-broken batch" and "do not trip
  on a legitimate cluster of duplicate references". A 500-row upload with 2
  same-day Reference collisions in a row is realistic; 3 in a row starts to
  look like a plumbing fault. Signature = `type.FullName + '|' + innerMsg`
  so two `DbUpdateException`s wrapping different SqlExceptions do not
  falsely collapse.
- **SqlException walk capped at 5 InnerException hops**: guard against a
  pathological cyclical InnerException chain. Real-world EF Core wraps
  `SqlException` at depth 1; 5 is a generous ceiling.
- **`ApiError` on `api.ts` (not a BulkImport-only wrapper)**: making the
  fetch helper throw a typed error is a repo-wide affordance. Any future
  page that needs to read `{ hint, ... }` from a 500 body gets it for free.
  Keeps message-string extraction (`err?.error ?? err?.message ?? "HTTP N"`)
  unchanged so pre-pass-5 catch sites keep behaving.
- **Persistent RED banner (not toast)**: schema-drift hints tell the
  operator to page an admin + apply a migration. A 5-second fading toast
  disappears before they can screenshot / relay the hint. Explicit dismiss
  button so the operator opts in to clearing it.
- **Belt-and-braces `zeroZeroWarning`**: even with the backend fix, some
  future codepath could regress. Amber banner on `0 inserted && 0 rejected
  && rows submitted > 0` is a cheap defence in depth; the moment the
  backend fix is intact the banner never fires in practice.

### Files touched (pass 5)

Modified:
- `Core/Application/Services/BulkImport/BulkImportService.cs` (new
  `BulkImportSystemException` class; `SubmitAsync` per-row loop now
  classifies schema-drift SqlExceptions + repeating identical failures
  as system-level; new `TryClassifySystemLevel` + `FindSqlException`
  helpers; error-level log tag `"BulkImport system-level failure -
  aborting submit"`.)
- `API/Controllers/BulkImportController.cs` (Submit action catches
  `BulkImportSystemException` -> 500 with `{ error, hint, partialCount }`.)
- `wwwroot/app/react/services/api.ts` (new `ApiError` class carries
  `status` + structured body + `hint`; `request` throws it in place of
  the plain `Error` so consumers can `instanceof` check.)
- `wwwroot/app/react/pages/BulkImport.tsx` (imports `ApiError`; new
  `systemError` + `zeroZeroWarning` state; `doSubmit` populates both;
  Result panel renders persistent RED banner + amber zero/zero banner.)
- `PARITY-TRACKING.md` (this section.)

New: none.

No DB migration required.  No DTO shape changes.  Existing 200 success
responses and per-row rejection paths are unchanged.

---

## BulkImport pass 6 - wizard UI redesign (2026-07-22)

Pure frontend redesign. Zero backend / service / endpoint / DTO changes. All
pass-1..pass-5 behaviours preserved 1:1 - see the "features preserved"
checklist at the bottom of this section.

### What changed

- Replaced the 2x2 panel grid with a **4-step wizard**: Upload -> Map
  columns -> Preview & validate -> Submit & finish. Operators can no
  longer accidentally click Import before mapping is complete because
  each step gates progression on its own precondition (`canProceedFromStepN`).
- Introduced a **peer History surface** in the toolbar. History is not a
  wizard step because promoting/deleting a set from yesterday should not
  require walking through Upload/Map. The button toggles a slide-in panel
  from the right containing the sets list; clicking a set opens the
  existing history-drill-in modal unchanged.
- Added a **Reset** link in the toolbar (with `window.confirm` gate) that
  clears every persisted state variable and returns to Step 1. Needed for
  mid-flow redo-a-batch without a page refresh.
- Added **step-strip navigation**: clicking a completed step's circle
  jumps back for review. Forward jumping past incomplete steps is
  suppressed by the `gotoStep` gate.
- Added **Enter-on-primary-button** handler wired to Next (Steps 1-3) and
  Import (Step 4). Deliberately NOT a global `document.keydown` listener -
  it only fires when focus is on the button itself so typing into an
  input never fires the wizard action.
- **Persistent RED `systemError` banner** and **amber `zeroZeroWarning`
  banner** MOVED to Step 4 (unchanged content + dismiss buttons + colour
  tokens). Not swapped for toasts - load-bearing per pass-5 notes.
- **Auto-validate on Step 3 entry**: if the operator has not clicked
  Validate and there is no cached validation, we kick off validation
  automatically on step entry (respecting `AbortController` on back-nav).
  Validate remains available as a `Re-validate` button.
- Added **Step 4 "Next steps" panel** after a successful submit with two
  CTAs: `View this set in History` (opens the history modal for the
  just-created set code) and `Start another import` (calls doReset).
- Added **auto-mapped N of M** hint on Step 2 driven by `autoMap` return
  value (new field surfaces existing data).
- Promoted parse-warnings from toast-only to a **persistent warning box**
  on Step 1 in addition to the toast (kept the toast because operators
  do not always look at the box).

### New components

- `wwwroot/app/react/components/common/StepWizard.tsx` (61 lines). Ported
  from Configurator's `components/common/StepWizard.tsx` (36 lines).
  Adaptations: added optional `onStepClick` prop, added ARIA (`role="list"`,
  `aria-current="step"`, `aria-label`), swapped the unicode tick for a
  plain "v" so the strip renders identically across every screenshot
  surface the team uses, wrapped each segment as `<button>` for keyboard
  accessibility.
- `wwwroot/app/react/components/import/FileUploadZone.tsx` (154 lines).
  Ported from Configurator's `components/import/FileUploadZone.tsx` (72
  lines). Adaptations: added `.xlsm` to accept list, replaced emoji icons
  with inline SVGs to match cockpit aesthetic, added `fileName` +
  `fileSize` props (parent owns file state), added `disabled` prop,
  added keyboard support (Enter/Space to open picker + tabIndex), added
  ARIA attributes.
- `wwwroot/app/react/components/import/WizardShell.tsx` (68 lines). New,
  no Configurator equivalent. Composes toolbar + step strip + step body
  + footer scaffold. Deliberately dumb - all state lives in parent.

### Cross-step conventions preserved

- Chunked submit (200/chunk) with shared idempotency key across chunks -
  unchanged.
- Client-side 20 MB gate + 5000 hard row cap - unchanged.
- Auto-column-mapping by alias (two-pass exact + `includes()`) - unchanged.
- Server date locale hint + operator override - unchanged (radio pair
  now lives on Step 1 instead of the old panel 1).
- Server-side parse (CSV BOM strip + delimiter auto-detect + ISO-8859-1
  fallback, XLSX/XLSM via ClosedXML) - unchanged.
- Preview pagination (50/page) - unchanged (Step 3 pager identical).
- Inline edit in history modal (with L2B.1 self-dupe fix) - unchanged.
- Async promote + 2 s status poll + progress bar in modal footer - unchanged.
- Download errors CSV with Type column - unchanged.
- Persistent RED + amber banners - moved to Step 4 but colour tokens,
  dismiss behaviour and content are identical.
- Soft-delete of past sets - unchanged (moved into HistoryPanel list).
- All `abortRef` / `promotePollRef` cleanup on unmount + modal close -
  unchanged (still hang off the outer component).
- `ApiError` shape + `bulkImportService.ts` + backend endpoints - all
  untouched.

### UX tweaks (be honest)

- Auto-validate on Step 3 entry - new behaviour. Discovery brief called
  for it explicitly ("auto-run on step entry if not yet run"). Result:
  operator lands on Step 3 with badges already showing instead of having
  to click Validate manually. Fully cancellable via back-nav (existing
  AbortController wiring).
- Reset link is new (with confirm) - not previously available.
- The old visible "Cancel" button (only shown while submitting) is
  preserved on Step 4 next to the Import button. Chunk progress bar is
  rendered in-flow on Step 4 (previously below the Import button in
  panel 2).
- Step 4 shows a "Next steps" panel after success with `View this set in
  History` + `Start another import` CTAs. Previously the operator had to
  scroll down to find the just-created set in the sets list and click
  View.
- Enter-on-primary handler is new; pass 1-5 had zero keyboard shortcuts
  in BulkImport (per the discovery brief section A6).
- Step 4 Back button is disabled after a successful submit - explicit
  gate against re-submitting the same buffer (idempotency key would
  actually catch it, but a UI gate is cleaner than a silent server
  no-op).

### Files touched (pass 6)

Modified:
- `wwwroot/app/react/pages/BulkImport.tsx` (full rewrite; same top-level
  state variables + service calls, wizard shell around them.)
- `PARITY-TRACKING.md` (this section.)

New:
- `wwwroot/app/react/components/common/StepWizard.tsx`
- `wwwroot/app/react/components/import/FileUploadZone.tsx`
- `wwwroot/app/react/components/import/WizardShell.tsx`

No backend changes. No DTO changes. No DB migration required. No service
signature changes. `npm run type-check` clean, `npm run build` clean
(app.js 404 KB / gzip 119 KB).

---

## BulkImport pass 7 - wizard polish (2026-07-22)

Four small polish items surfaced by real end-to-end testing after pass 6.
Frontend-only, no backend / DTO / service / migration touch. All fixes
land in `wwwroot/app/react/pages/BulkImport.tsx`.

1. **Row-warning tooltip on Step 3 badges.** The Issues cell in the
   Step 3 preview grid (`N err` / `N warn` badge per row) now carries a
   `title` attribute concatenating each row's `validation.problems` +
   `validation.warnings` entries joined by `; `. The row `<tr>`
   already had the same title, but the badge cell itself did not, so
   operators hovering the visible badge got no hint and had to click
   Download Issues. Tip content is built once per row from the same
   `tip` local already computed for the row-level title.
2. **`parseWarnings[]` inline card on Step 1.** Verified from pass 6:
   the persistent warning card below the parse-summary card already
   renders `parsed.warnings` when non-empty (`Card` + amber
   `border-warning` + `bg-warning-bg/70`, bullet list). Toast still
   fires for immediate feedback. No code change needed - this pass
   just confirms the box is doing its job during e2e.
3. **Promote spinner promoted synchronously on button click.** The
   promote flow uses async `promoteAsync` + 2 s status polling; small
   sets that completed before the first poll tick left the operator
   staring at a static "Promoting..." button with no progress bar. Fix:
   in `doPromote`, immediately after the confirm gate, seed
   `promoteProgress` to `{ total: <estimated>, completed: 0, failed: 0 }`
   BEFORE the async POST. Total is estimated from the matching
   `BulkImportSetSummary.pendingRowCount` (or `rowCount` if pending is
   absent, or 0 if we have no summary). The first poll tick and
   `promoteAsync` response both overwrite with real numbers. If promote
   finishes before any tick, the result banner replaces the spinner as
   before.
4. **Hide Delete on promoted sets + friendly 400 message.** History
   side panel: the Delete button 400d silently on sets with any
   promoted rows (backend refuses to hard-delete audit trail). Now
   hidden when `(s.promotedRowCount ?? 0) > 0`. Undefined
   `promotedRowCount` is treated as 0 so older summary payloads still
   render Delete and rely on the belt-and-braces catch in `doDelete`,
   which now recognises `ApiError` `status === 400` and toasts "Cannot
   delete a set with promoted rows." instead of surfacing the raw
   backend message.

### Files touched (pass 7)

Modified:
- `wwwroot/app/react/pages/BulkImport.tsx` (polish 1, 3, 4)
- `PARITY-TRACKING.md` (this section)

No new files. No backend / DTO / service / migration changes.

---

## BulkImport pass 8 - correct Step 1 + Step 2 UX per user feedback

Fired 2026-07-22 in response to the user's callout on the pass-6 wizard:

1. **Step 1 no longer asks the operator for an "Import set code" or a
   "Date format".** Both were footguns. The backend already server-
   allocates a set code via `AllocateSetCodeAsync` (with `-N` collision
   suffix), so making the operator type one was redundant and prone to
   accidental collisions; the assigned code is now surfaced in the Step 4
   result banner instead. And the tenant's `CountryCode` claim already
   tells us whether dates are `mm/dd/yyyy` (US) or `dd/mm/yyyy` (NZ / UK
   / AU) - a per-upload override just invites data corruption when the
   operator gets it wrong. `BulkImportParseService.ResolveDateLocale` now
   reads the claim via `IHttpContextAccessor` first, falling back to the
   pre-pass-8 content-scan heuristic only when the claim is missing (which
   should never happen on an authenticated request). The service moved
   from `Singleton` to `Scoped` in `Program.cs` so the accessor resolves
   per-request. The response DTO still carries `dateLocaleHint` (now
   `"us"` or `"nz"`, never `"unknown"`) so the client can echo it into
   the "File parsed successfully" banner ("dates as dd/mm/yyyy (tenant
   default)").

2. **Step 2 now iterates SYSTEM FIELDS instead of source columns.**
   Matches the mature import-wizard convention (see Configurator's
   `AutoMateMapper.tsx`). Each row is a 3-column layout: `<system field
   label>` + red asterisk if required | `✓` (mapped) or `○` (unmapped, red
   when required) | `<select>` of spreadsheet columns with `"-- Skip --"`
   as the empty option. Mutual exclusion on `setFieldMapping` guarantees
   one system field only ever consumes one source column. A live
   **Preview Row** panel below the mapping grid (matches AutoMateMapper
   lines 217-253) shows the current row's values for every MAPPED system
   field with left/right arrow paging + "Row N of M" indicator, so
   operators can spot-check a suspect mapping without hopping to Step 3
   and back. The `mapping` state is still header-keyed (`mapping[header] =
   fieldKey`) so `mappedRows` and all downstream code paths (`autoMap`,
   validation, submit) are untouched; only the UI shape changed.

Client-side date parsing (`readDate` in `mappedRows`) still normalises to
ISO before sending because `BulkImportRow.BookedDate` is a `DateTime?` in
the DTO. It now branches on `parsed.localeHint` (server-echoed from the
tenant claim) instead of the deleted `dateLocale` state, so the tenant
claim remains the single source of truth end-to-end. Design call: rather
than change the DTO to a raw string and rebuild the shadow entity, the
client echoes the server hint - lowest-risk path with identical semantics
for the operator.

Removed state variables (dead post-pass-8): `importSetCode`, `dateLocale`,
`DateLocale` type. Removed helper: `INPUT_CLASS` (only referenced by the
deleted set-code input). Added state: `previewIndex` (Preview Row cursor).
`canProceedFromStep1` reduces to `!!parsed`. `doReset` no longer clears
the two removed vars.

Every other behaviour is preserved: chunked submit, per-round
idempotency key, in-file dedupe, live-shadow / live-jobs dedupe, RED
`systemError` banner, amber `zeroZeroWarning` banner, async promote poll
loop, inline edit modal with L2B.1 self-exclusion fix, soft-delete guard
on promoted sets, History peer panel, Reset link with confirm,
click-completed-step-to-jump-back, Enter-on-primary, unmount cleanup.

### Files touched (pass 8)

Modified:
- `wwwroot/app/react/pages/BulkImport.tsx` - Step 1 stripped of set-code
  input + date-format radios; Step 2 rebuilt to iterate system fields
  with Preview Row panel; state / reset / submit / errors-CSV cleaned
  up accordingly.
- `Core/Application/Services/BulkImport/BulkImportParseService.cs` -
  `DetectDateLocale` replaced with `ResolveDateLocale` (tenant-claim-first,
  content-scan fallback). `IHttpContextAccessor` injected via constructor.
  Fallback heuristic now returns `"nz"` instead of `"unknown"` (the
  frontend never renders `"unknown"` any more).
- `Program.cs` - `BulkImportParseService` DI lifetime `Singleton` -> `Scoped`.
- `PARITY-TRACKING.md` (this section).

No new files. No DTO / migration changes. Backend controller unchanged
(never carried a `dateLocale` param).

---

## BulkImport pass 9 - audit P0+P1 fixes

Fired 2026-07-22 to close the seven items surfaced by
`WIZARD-AUDIT-COMPREHENSIVE.md` (which compared the pass-8 wizard against
Configurator's mature `CourierImport` reference). Every KEEP item from
Section 5 of the audit was preserved (History peer panel, RED / amber
persistent banners, chunked submit + idempotency, cancel-in-flight,
Parse warnings box, 20 MB gate, Reset confirm, click-jump-back,
Enter-on-primary, sticky WizardShell chrome, Preview Row card,
server-allocated set code, tenant-derived date locale).

### Items shipped (7)

1. **P0.1 - Step 1 source-type picker (File vs Paste).** Two side-by-side
   cards ("Upload File" / "Paste Data") in a `grid grid-cols-1 md:grid-cols-2`.
   Selected card gets a brand-cyan border + tinted background. New
   `sourceType: 'file' | 'paste' | null` state; nothing renders until
   the operator picks. Paste path uses a new client-side parser
   (`bulkImportService.parsePastedText`, tab-first, comma-fallback with
   double-quote CSV handling). Both paths funnel through a new
   `applyParsed(result, source, file)` helper so downstream state
   (mapping, validation, selection, filter) does not care about source.
   `pasteText` state persists across step nav until Reset. Existing
   `parsed.warnings` amber box + client-side 20 MB gate untouched.

2. **P0.2 - Step 3 row-level selection.** New `selectedRows: Set<number>`
   over indices into `mappedRows`. Checkbox as the FIRST column on the
   preview table. Header checkbox drives the currently-visible page:
   click when partial-or-empty selects the visible slice, click when all
   visible are ticked deselects them. Native `indeterminate` flag set
   via ref callback for the tri-state visual. Auto-populates on
   `doValidate` completion to every row without problems (warnings are
   OK to select).

3. **P0.3 - "Select valid / Select all / Deselect all" pills + counter.**
   Rendered above the preview table. Colour: green (Select valid),
   cream (Select all / Deselect all). Counter reads "N of M selected"
   right-aligned in the same row. All three helpers reason about
   `mappedRows` (not the filtered slice) so tab flipping cannot game
   the selection.

4. **P0.4 - Step 4 submits only SELECTED rows.** `doSubmit` filters
   `mappedRows` to `Array.from(selectedRows).sort().map(i => mappedRows[i])`
   before chunking. Chunked submit + per-round idempotency key semantics
   from pass 5 unchanged (they now operate on the filtered array).
   Progress bar total = `selectedRows.size`, not `mappedRows.length`.
   Zero-zero warning + HARD_ROW_CAP guard both re-checked against the
   filtered count. Primary button label reads
   `Import ${selectedRows.size} row(s)` and disables at zero (title
   tooltip explains "Tick at least one row on Step 3"). Body copy
   updated: "N selected of M total".

5. **P1.1 - Step 2 Confidence badges.** New 4th grid column added to
   the `grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto]` mapping
   layout. `autoMap` now emits a `Record<string, ConfidenceInfo>` keyed
   by header: exact alias hit -> `level: 'high', score: 100` (green
   pill), substring alias hit -> `level: 'medium', score: 70` (amber
   pill), unmapped -> no entry (blank cell). When the operator
   overrides an auto-mapped header via `setFieldMapping`, the previous
   header's badge is removed and the new header is stamped
   `level: 'manual'` (muted "-" pill). The `renderConfidencePill`
   helper is a module-level function returning a rounded-full pill
   with a coloured dot + numeric score. `title` attribute carries the
   reasoning string ("Exact alias match: 'reference' -> reference").

6. **P1.2 - Step 3 filter tabs.** Pill-group tabs "All / Valid /
   Warned / Invalid" with per-tab counts, rendered above the preview
   table. Active tab gets a white pill + shadow (matches
   `ValidationResults.tsx:83-95`). Filter drives `filteredIndices`
   (memoised); pagination + table body iterate that. Valid / Warned /
   Invalid tabs are disabled with a tooltip until validation has run.
   A `useEffect([activeFilter])` snaps `previewPage` back to 1 on
   tab flip so the operator does not land on an empty page.

7. **P1.3 - Step 2 Auto-Mate thinking-state animation.** 500 ms
   cosmetic delay on first Step 2 entry per parsed file. Renders a
   card with an SVG spinner in a rounded-xl brand-cyan tile, a small
   ping dot, three bouncing dots (staggered 0/0.18/0.36 s via inline
   `@keyframes bulkimport-bounce`), and "Analyzing columns..." /
   "Matching your headers against system fields." copy. No emojis
   (RoutedOps aesthetic per FileUploadZone.tsx note). Guarded by
   `animationDoneForRef.current === parsed` so Back+Next does NOT
   re-fire the animation; only a fresh parse resets the guard.

### Bonus (small P2 extra)

- **Per-step primary button labels** in the wizard footer. Was
  generic "Next ->" for all steps; now reads:
  - Step 1: "Continue - Auto-Map Columns ->"
  - Step 2: "Validate & Review ->"
  - Step 3: "Review & submit (N selected) ->"
  - Step 4: (footer still hides Next; the body owns the big Import
    button.)
  Titles updated: Step 1 gates on "Upload or paste data first",
  Step 3 warns "No rows selected - Step 4 will not have anything to
  submit". This is P2 item 10 from the audit's prioritized fix list;
  trivial add so shipped in-line.

### Files touched (pass 9)

Modified:
- `wwwroot/app/react/pages/BulkImport.tsx` - state additions
  (`sourceType`, `pasteText`, `confidence`, `isMapping`,
  `animationDoneForRef`, `selectedRows`, `activeFilter`), new
  `applyParsed` + `handlePaste` helpers, `autoMap` returns
  confidence, Step 1 rewritten with source-type cards + paste
  textarea, Step 2 gains thinking-state + confidence column +
  manual-override tracking, Step 3 rewritten with pills + tabs +
  checkbox column + `filteredIndices` memo + page-snap effect,
  Step 4 primary button label + count bound to `selectedRows.size`,
  `doSubmit` filters by selection, `doReset` clears every new state,
  per-step footer labels, module-level `renderConfidencePill`.
- `wwwroot/app/react/services/bulkImportService.ts` - added
  `parsePastedText(text)` client-side parser returning
  `BulkImportParseResult` (tab-first delimiter sniff, comma
  fallback, minimal double-quote CSV handling, blank-row skip,
  trailing-empty-header trim, duplicate-header warning).
- `PARITY-TRACKING.md` (this section).

No new files. No DTO / migration / backend changes (paste path is
purely client-side; server never sees the raw paste text).

### Behaviour trade-off

Chunked submit (pass 5) previously chunked the full `mappedRows`
array. Post-pass-9 it chunks the SELECTION. So if the operator
unticks the middle third of a 3000-row set, they will now get 2
chunks of 200 + 1 chunk of ~100 out of a 500-row selection instead
of 15 chunks of 200 out of a 3000-row batch. The per-round
idempotency key is unchanged (all chunks in one submit share `idem`
+ `-c${c}` suffix), so retry semantics are preserved.

### Build results

- `npm run type-check` (tsc --noEmit): clean.
- `npm run build` (vite): 95 modules, 418 kB / 122 kB gzip, no warnings.

---

## BulkImport pass 10 - gotchas + failed-rows + duplicate surfacing

Pass 10 (2026-07-22) closes two gotchas surfaced during pass 9 hand
testing and ships two high-value P2 items from the audit backlog.
Every prior-pass feature is preserved (source-type cards, paste
parser, confidence pills, thinking-state animation, row selection,
filter tabs, chunked submit, idempotency, system-error banner,
zero/zero warning, promote poll, inline edit, soft-delete, history
peer panel, reset confirm, per-step primary button labels).

### Gotchas closed

1. **Gotcha 1 - Step 3 footer forward button not hard-disabled at 0
   selected.** Pre-pass-10 the footer button showed "Review & submit
   (0 selected)" and remained clickable; only the Step 4 Import
   button blocked. Fix: added `step === 3 && selectedRows.size === 0`
   to the footer `disabled=` union AND swapped the tooltip from the
   soft "No rows selected - Step 4 will not have anything to submit"
   to the harder "Tick at least one row on Step 3" so it matches the
   Step 4 Import button's tooltip verbatim.

2. **Gotcha 2 - Preview Row card on Step 2 stale on mapping change.**
   The card technically read live `mapping` state via the shared
   `findHeaderForField` helper but the projection was scattered
   across three inline `.filter` / `.map` / `.every` calls, which
   made the reactive contract easy to break in a future refactor.
   Fix: replaced the three-call inline chain with an explicit
   `mappedFields` local variable computed inside an IIFE in the
   render body, so the reactive path (mapping state -> mappedFields
   -> rendered cards) is a single visible expression. Also unified
   the "nothing mapped yet" branch into the same IIFE so both cases
   render from the same derived list.

### P2 items shipped

- **P2.1 - Failed Rows table on Step 4.** After a submit completes,
  if `submitResult.rejectedRows > 0` and the RED `systemError`
  banner is NOT showing, renders a table under the result banner
  titled "Failed Rows (M)" with columns `Row # | Reference |
  Reason`. Reason = the row's `problems[]` joined with '; '. Row #
  is rebased from the chunk-local index to the original
  rowsToSubmit position so operators can find the row in their
  source. A "Download failed rows" button reuses the Step 3
  errors-CSV `csvCell` + `triggerDownload` primitives to emit a
  CSV named `${setCode}-failed-rows.csv` with the payload columns
  (Reference / Client / Sender / Receiver / Suburb / Zip / Date /
  Time) plus RowNumber + Reason. State: `submitResult` gained a
  `rejections: BulkImportRowValidation[]` field; `doSubmit`
  accumulates `res.response.rejections` across every chunk with
  the rowIndex rebased. The RED systemError banner takes visual
  precedence because when the server aborted mid-submit the
  rejections list may be incomplete or misleading.

- **P2.2 - Explicit duplicate surfacing in Step 3.** Server emits
  three duplicate flavours as free-text problem/warning strings:
    - "Duplicate reference in file (first appears at row N)" - problem
    - "Reference already exists in this import set" - problem
    - "... already exists in live jobs (re-import?)" - warning
  New module-level `classifyDuplicate(problems, warnings)` helper
  substring-sniffs into `{ none, file, live, both }`. Row-level:
  the Issues cell in the Step 3 preview table now renders an amber
  "DUP" badge (bg-warning-bg + text-warning + border) for in-file /
  in-set matches and a cyan "DUP-LIVE" badge (bg-brand-cyan/10 +
  text-brand-cyan + border) for the live-jobs case. Both badges can
  render on the same row when the classifier returns 'both'.
  Wrapped alongside the existing err/warn count in a flex-wrap div
  so the cell degrades to a single row on wide viewports and stacks
  on narrow. Summary chip: below the existing valid/invalid/warned
  pills, when `totalDup > 0` an outlined pill "N duplicates
  (X in file, Y in live)" shows the whole-set totals with a cyan
  dot indicator. Chip only renders after validation has run.

### Design calls

- Chose `text-brand-cyan` (tenant brand colour) over pure blue for
  DUP-LIVE since the theme has no `info` scale defined - matches the
  existing brand-cyan use in the promote-progress bar and cockpit.
- Kept the Row # column in the Failed Rows table as 1-based
  (`rowIndex + 1`) to match the Step 3 preview table's "#" column
  and the operator's mental model (spreadsheet rows are 1-based).
- Duplicate strings are matched case-insensitively via `.toLowerCase()`
  so the classifier is resilient if the backend ever tweaks the exact
  wording (e.g. capitalising "Reference" -> "REFERENCE"). Both the
  problems array and the warnings array are scanned because
  in-file/in-set land in problems whereas live-jobs land in warnings,
  and a future backend change could shuffle categorisation without
  breaking the badge.

### Files touched (pass 10)

Modified:
- `wwwroot/app/react/pages/BulkImport.tsx` - added
  `BulkImportRowValidation` type import, extended `submitResult`
  state shape with a `rejections` array, rebased chunk-local
  rowIndex to global rowsToSubmit position inside `doSubmit`,
  new `downloadFailedRowsCsv` helper, Failed Rows table renderer
  inside `renderStep4` (gated on `!systemError`), refactored Step
  2 Preview Row card to an explicit IIFE + `mappedFields` local,
  hard-disabled the Step 3 footer forward button at 0 selected
  with tooltip parity to the Step 4 Import button, added DUP and
  DUP-LIVE badges to the Step 3 Issues cell with the existing err
  / warn count preserved, added the duplicate summary chip after
  the valid/invalid/warned pills, module-level `classifyDuplicate`
  helper.
- `PARITY-TRACKING.md` (this section).

No new files. No DTO / migration / backend / service changes -
the `BulkImportSubmitResult.Rejections` and preview problem/warning
strings were already emitted by the server; pass 10 only surfaces
them differently in the UI.

### Build results

- `npm run type-check` (tsc --noEmit): clean.
- `npm run build` (vite): 95 modules, 422.88 kB / 123.87 kB gzip, no warnings.

---

## Change signal

Every entry above lists the file the fix landed in. To see the exact diff
for a fix, `git log --diff-filter=M -- <file>` on the RoutedOperations repo
after the batch is committed.
