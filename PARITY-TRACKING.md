# RoutedOperations - Parity Tracking Log

Iteration-by-iteration record of the RunBuilder-to-RouteBuilder parity work.
Every gap surfaced by a gap-finder agent is logged here, along with the fix
applied and reviewer verdict. Kept out of `changes.log` per project rule.

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

## Change signal

Every entry above lists the file the fix landed in. To see the exact diff
for a fix, `git log --diff-filter=M -- <file>` on the RoutedOperations repo
after the batch is committed.
