# Routed Operations - Lift Plan, Reprioritised

_Author: Steve Bonnici (with EasyEA) - 2026-09-25_
_Supersedes the priority order in `STEVE-ROUTEBUILDER-V2-PARITY-LIFT-PLAN-KEVIN-2026-06-20.md` (removed from `main` by the 2026-09-23 GitLab sync; recoverable from `85cf272`). Scope and principles of that plan still stand; this doc re-orders the work and adds the booking-generation pipeline it did not cover._

## 1. Where the 2026-06-20 plan stands

| Phase | Scope | Status (from code, 2026-09-25) |
|---|---|---|
| 2a | Filter bar reads (regions, speeds, couriers, settings) | Done: `BulkRegionService`, `SpeedService`, `CourierService` |
| 2b | Jobs + runs filter reads | Done: `JobService`, `RunService` |
| 2c | Run build writes | Done: `RunService` |
| 2d | Live commit, HD sync, routing integrations | Done as wrappers: `RunCommitService` and `HdJobSyncService` call the SPs via Dapper (per repo `CLAUDE.md` rule 1); `RouteOptimizationService`, `HereMapService` |
| 2e | Saved filters, settings polish | Partial (no `RunSettingsService` / `RunBuilderFilterService`) |
| 3 | Dynamic / rolling planning mode | Not started |

**Not in the 2026-06-20 plan at all:**

- The **booking-generation pipeline** that creates live jobs and legs from schedules: `uspPrebookSet`, `DD_` / `WS_stpBulkScheduleJob_Insert`, `DD_` / `WS_stpBulkScheduleJob_InsertChildJobs`, `UTL_stpJob_InsertFromTblBulkJob`, `WS_stpJob_Insert_FromParent`, `UTL_stpRouteAutoAssign_Resolve` / `_ResolveOneSide` / `_NormalizeZip`, `RVW_stpTransferRouteForFamilies`.
- The **Route Viewer** SPs (`RVW_stpBulkRuns_2`, `RVW_stpBulkRunJobs`, `RVW_stpLineHaulRuns`, `RVW_stpGetMissingJobRuns`, scan / print SPs), added after the plan was written.

The codebase has ~157 raw SQL / SP call sites in `Core/`.

## 2. Why reprioritise

The 2026-09-25 Route Viewer investigation traced four live bugs to the booking-generation SPs (`KEVIN-LINEHAUL-LEG-FIXES-2026-09-25.md`):

1. Linehaul legs numbered and timed in definition-insert order (unordered cursor): hops scheduled before freight arrives.
2. Linehaul legs inherit the pickup route and its roster driver.
3. Recurring Linehaul reads `tblBulkJob` while live legs are on `tucJob`.
4. Delivery-side route resolution under-specified (zip only, no coords / schedule / leg time).

Plus the structural issues behind them:

- **Business rules in the wrong layer.** Leg ordering, timing, route resolution, courier assignment and pricing live in 800-line SPs with no tests. Each fix has been verified by querying prod.
- **Duplication.** `DD_` and `WS_` child-leg SPs are divergent forks (WS adds cubic pricing and per-leg speed; DD adds US cumulative timing). The delivery route is resolved twice per family (`ChildLegRestamp` and `FunnelRestamp`).
- **Hotfix layering.** Dated patch comments, "revert" blocks, "inert dead code", hard-coded client ids (`17921, 32374, 34917, 32694`) and speed ids (`94, 95, 96, 110`).
- **Not actually efficient.** Row-by-row cursors with per-row lookups inside one transaction. SQL is fast when set-based; this is not.
- **The next features land here.** Final-mile routes (`FINAL-MILE-RECURRING-ROUTES-SPEC-2026-09-25.md`) and Phase 3 dynamic planning both need route resolution and leg planning. Building them into the SPs deepens the problem.

## 3. Principles

- **C# decides, SQL stores and searches.** Decisions (leg plan, route choice, courier choice, timing) move to tested C# services. SQL keeps set-based reads, bulk writes, and spatial search (`geography.STIntersects` with the spatial index).
- **Strangler, not big bang.** The DB is shared with legacy callers (DespatchWeb, WS, Excelerator, nightly `uspPrebookSet`). SPs stay until nothing calls them.
- **Shadow before switch.** Each new C# component first runs alongside the SP, logs differences, and only then takes over.
- **Caller inventory first.** Before retiring any SP: `sys.sql_expression_dependencies` plus a grep of every app repo that can call it.
- **Fix-forward in SPs only for live bugs.** The four Kevin fixes are the last planned logic changes to the booking-generation SPs; keep them minimal.

## 4. New priority order

| Priority | Work | Why now | Rough effort |
|---|---|---|---|
| **P0** | Kevin's SP fixes (`KEVIN-LINEHAUL-LEG-FIXES-2026-09-25.md`): Bug 2 first, then Bugs 1, 3, 4 and Feature 5 (route Direction, interim SP implementation so final-mile DEL legs work now) | Live dispatch errors; final-mile outbound runs needed now | 1-2 weeks incl. staging test |
| **P1** | **Leg planner** in C# | Source of Bugs 1 and 2; foundation for final mile and Phase 3 | 1-2 weeks |
| **P2** | **Route resolver** in C#, with Direction / Depot (final-mile spec) | Source of Bug 4; final-mile feature lands here, not in SQL | 1-2 weeks |
| **P3** | **Booking family writer** in C# | Retires the `DD_` / `WS_` fork and the double delivery resolve | 2-3 weeks (pricing parity is the long pole) |
| **P4** | **Nightly prebook orchestration** in .NET | Moves `uspPrebookSet` onto P1-P3 | 1-2 weeks |
| P5 | Route Viewer direction fix (final-mile spec section 6) | Needed for Outbound view; SP change is small | 2-3 days |
| Later | 2e polish; Phase 3 dynamic mode (now builds on P1 + P2) | Unblocked by P1 / P2 | as per 2026-06-20 plan |
| Leave in SQL | Route Viewer read SPs, scan / print SPs | Read-heavy, set-based, working; lift only when a change needs it | - |

### P1 - Leg planner

`LegPlanService.Plan(BookingContext booking, ScheduleContext schedule) -> LegPlan`

- **Pure function.** No DB calls inside; the caller loads the booking, schedule, `tblBulkScheduleLinehaul` rows, `tblbulkLinehaulRun` timetables and depots.
- **Output per leg:** suffix (`LHP`, `LH1..n`, `DEL`), travel sequence, from / to depot, `LinehaulRunId`, date / time, `DepotId`.
- **Rules:** walk the depot chain from the pickup depot; number in travel order; time each leg at the later of predecessor arrival and the run's `StartTime` (pending Steve Q1 in the Kevin doc); broken chain -> append and flag, never fail.
- **Tenant differences** (US cumulative vs NZ run-timetable) become configuration, not code branches.
- **Tests:** xUnit, pure. Seed cases from the NEOGE P4206 (Hayward) and P4231 (Sacramento) chains, plus broken-chain and single-leg cases.
- **Shadow mode:** on every schedule booking, compute the plan in C# and log differences against what the SP wrote (`LegPlanShadowLog`). Switch when differences are only the known Bug 1 corrections.

### P2 - Route resolver

`RouteResolutionService.Resolve(LegPlan plan, BookingContext booking) -> per-leg RouteId / LinehaulRunId / CourierId`

- `LHP` -> first-mile route (`Direction = 1`) by pickup point / zip.
- `LHn` -> `LinehaulRunId`, `RouteId` NULL; courier from `Dispatch_LinehaulRunRoster`.
- `DEL` -> final-mile route (`Direction = 2`, `DepotId` = terminal depot) by delivery point / zip.
- One SQL call per batch for spatial candidates (polygon pass, then zip pass), filtered by direction and depot. Schedule binding (Rule 4), window and priority tie-break in C#.
- Keeps writing `RouteAutoAssignLog` so the Auto-Assign Log page keeps working.
- `UTL_stpRouteAutoAssign_Resolve` stays for legacy callers until P4 retires them.

### P3 - Booking family writer

`BookingFamilyWriter.WriteAsync(LegPlan, Resolution, Pricing)`

- One transaction, set-based inserts for parent + all legs (`tucJob`, items, notes, `PricingBreakdown`), `BookingParentID` / `BulkParentID` / `ParentID` links, `RouteId` / `LinehaulRunID` / courier per leg.
- **Pricing parity is the risk.** DD and WS price differently (WS `BulkZonePackageRate` cubic rates, addon percentages, `UTL_fncMFV_FAF_Rates`). Option: keep pricing SQL-side initially (call the existing functions per batch) and lift it last.
- No `tblBulkJob` staging for straight-to-live legs (Steve direction 2026-09-25).
- Requires changing repo `CLAUDE.md` rule 1 ("do NOT rewrite `UTL_stpJob_InsertFromTblBulkJob`") - Steve sign-off.

### P4 - Nightly prebook orchestration

- .NET background job replaces the `uspPrebookSet` cron path for schedule bookings, calling P1-P3.
- Roster precedence (date override, DOW pattern, default) moves with it.
- Run both for a period on staging; compare job counts, legs, routes, couriers per tenant per night.
- Then switch callers one at a time: Routed Operations, prebook, WS, DD. Retire SPs when the caller inventory is empty.

## 5. Where the code lives (decision needed)

The booking-generation SPs are called from several apps (DespatchWeb, WS, Excelerator, the prebook cron), not just Routed Operations. Options:

| Option | Pros | Cons |
|---|---|---|
| A. Services inside Routed Operations, exposed as an internal API | Fastest; stack and conventions already here | Other apps depend on Routed Operations uptime; cross-app HTTP inside a booking transaction |
| B. Shared .NET library (NuGet, like `DeliverDifferentReporting`) consumed by every caller | Same logic in-process everywhere; no network hop | Versioning across apps; every caller must upgrade to benefit |
| C. Dedicated booking service | Clean ownership; one place for pricing + legs + routing | Most infrastructure; new deployable |

**Recommendation:** B for P1 / P2 (pure planner + resolver as a library, the natural fit for pure logic), used first by Routed Operations. Revisit C at P3 / P4 when the writer and prebook move.

## 6. Open questions

- **Q1.** Resolved 2026-09-25: Steve confirmed the order. Direction ships now in the SPs (Kevin doc Feature 5); P2 moves it to C# later.
- **Q2.** Where the code lives (section 5).
- **Q3.** Sign-off to relax repo `CLAUDE.md` rule 1 when P3 starts.
- **Q4.** Who owns the caller inventory across DespatchWeb, WS and Excelerator (repos outside Routed Operations)?
- **Q5.** Restore the 2026-06-20 lift plan and the other `docs/` removed by the 2026-09-23 sync onto `main`, so the doc trail is in one place?
