# Final Mile Recurring Routes - Spec

_Author: Steve Bonnici (with EasyEA) - 2026-09-25_
_Status: Design agreed with Steve. Implementation plan blocked on resolver SP definitions (see section 10)._

## 1. Problem

Route Viewer's Inbound / Outbound / Combined toggle and the Region (depot) filter do not show what an operator expects.

Reported case (Tenant 8 Medical, client NEOGE, run date 2026-10-02, Region = Burbank, View = Outbound):

- Expected: one run, Burbank depot -> NeoGenomics lab (Aliso Viejo).
- Actual: all 8 pickup routes (Central Valley, Hayward, RNO200, RNO300, SMF2-5) with all 45 jobs.

## 2. Root cause (verified against Medical prod data, 2026-09-25)

1. **The run list ignores the view toggle.** `BulkRunListRequest.Group` arrives at `RouteViewerRunService.GetRunsAsync` but is never passed to `RVW_stpBulkRuns_2` (which has no such parameter). The toggle only changes the Jobs column counts (`RvRunList.tsx` `jobsCell`) and the client-side middle-pane filter (`lib/runViewerViewMode.ts`).
2. **RouteId is stamped per family, not per leg.** Every leg of a booking (`LHn`, `DEL`) carries the parent's `RouteId`, i.e. the pickup route chosen by the customer's pickup zip. Example: P4264 `LH4`/`LH5`/`LH6`/`DEL` all have `RouteId = 5` (RNO200). `RVW_stpTransferRouteForFamilies` assumes the same (it re-stamps every child leg).
3. **No route type exists for the final leg.** Route 15 "Burbank to Lab" exists but is an ordinary (pickup-zip) route covering 92656 (the lab), so it can never claim a leg that picks up in Burbank. "Final mile" in `SchedulesNew.tsx` (`routeKind`, line ~1453) is guessed from the route name by regex; there is no column behind it.
4. **The region filter is too loose for delivery legs.** For non-`LHP` legs, `RVW_stpBulkRuns_2` / `RVW_stpBulkRunJobs` match a region when `tblBulkJob.RegionID` is in `@Regions`. That is the booking's region and is shared by every leg, so every NEOGE `DEL` leg matches Burbank (38) regardless of where it physically starts.

## 3. Concept: hub-and-spoke route types

| Route type | Matches legs by | Anchor | Route Viewer direction |
|---|---|---|---|
| First mile (pickup) - today's routes | pickup zip | delivers **to** a depot | Inbound |
| **Final mile - new** | **delivery area** | fans out from **one fixed origin**: a depot (`DepotId`) or a pickup address stored on the route (client or third-party site) | Outbound |
| Linehaul (middle mile) - existing `tblbulkLinehaulRun` | depot -> depot | both ends fixed | Linehaul module |

Why final mile is not a linehaul leg: a linehaul is point-to-point. A final-mile route fans out from one depot to any address in a set of delivery zips. The NeoGenomics case (many pickups converging on one lab) is the degenerate case: one final-mile route with one zip. The general case is one depot feeding 20-30 final-mile routes with hundreds or thousands of drops.

## 3b. Principle: every leg lives on tucJob and carries its own run

Direction (Steve, 2026-09-25): legs that go straight into live are **not** stored in `tblBulkJob`. `tucJob` is the source of truth for every leg, and each leg row carries the run it belongs to:

| Leg | Column on `tucJob` |
|---|---|
| `LHP` (customer -> first depot) | `RouteId` of the Inbound route |
| `LHn` (depot -> depot) | `LinehaulRunId` of the `tblbulkLinehaulRun` |
| `DEL` (last depot -> destination) | `RouteId` of the Outbound route |

Consequences:

- **`tucJob.LinehaulRunId`** is required. The EF entity has only `RouteId` (`TucJob.RouteViewer.cs`). If the column exists in the DB it needs mapping; if not, it is a DBMigrationV2 migration. Verified 2026-09-25: on the P3805 / P4231 / P4264 families `tblBulkJob.LinehaulRunId` is NULL on every leg (only the parent and `DEL` have a `tblBulkJob` row at all).
- **Recurring Linehaul reads the wrong table.** `RecurringLinehaulJobsService.ListForLinehaulRunAsync` and the stop counts in `RecurringLinehaulService` (~line 479) query `TblBulkJobs.LinehaulRunId`. For straight-to-live legs they return nothing. Switch both to `tucJob.LinehaulRunId`.
- **Nothing in this spec may depend on `tblBulkJob`.** In particular the Route Viewer region rule (6.2) must not use `tblBulkJob.RegionID`; origin depot comes from `tucJob` (5.3).
- **The run is derivable today even without the column.** Every `tblBulkScheduleLinehaul` definition carries `FromDepotId`, `ToDepotId` and `LinehaulRunId`, and within one schedule each `ToDepotId` appears once. So (schedule, leg `DepotId`) -> exactly one linehaul run. Stamping `tucJob.LinehaulRunId` at creation is still preferred (cheaper reads, survives schedule edits).
- **No legs are voided** (corrected 2026-09-25). All legs of P3805 / P4231 / P4264 have `ucjbVoid = 0`. The first query only returned some legs because it filtered on `ucjbDate = 2026-10-02` and the early legs carry earlier dates.

## 3a. Reuse, don't rebuild

Most of the machinery exists. Route Builder was designed for outbound runs from a depot; what never existed is an overarching recurring route for outbound work to auto-dispatch into by zip / area. The scope is only that gap.

| Need | Already exists | Change |
|---|---|---|
| Depot as a run origin | `tblBulkRegion` (depot + `PickupLatitude/Longitude` start point); Route Builder builds runs out of a depot | None |
| Day-of run building / splitting across drivers | Route Builder cockpit | None. A recurring outbound route defines territory; Route Builder still splits a heavy day. |
| Recurring route definition, roster, default courier / agent | `Routes`, `Dispatch_RouteRoster`, Recurring Routes UI | Add `Direction` + `DepotId` (4.1) and a checkbox + depot picker (8) |
| Coverage | `RouteZipcodes` -> `ZipPolygon`; Polygon Builder `tblBulkRunPolygon` linked via `tblBulkRunPolygonRoute` | None to the tables. Outbound matching uses them (5.2). |
| Auto-dispatch into a route | `UTL_stpRouteAutoAssign_Resolve` (pickup zip -> route) inside `uspPrebookSet` | Extend: for `Direction = 2`, match the delivery leg on delivery area + origin depot (5.2) |
| Route Viewer direction toggle | UI toggle already sends `group` | Wire it through to the SPs (6) |

Anything in this spec that looks like new infrastructure should be read as "extend the existing piece" unless noted.

## 4. Data model

Schema changes go in `C:\Gitlab\DBMigrationV2\DatabaseScripts\Migrations\` (not this repo).

### 4.1 `Routes` - two new columns

| Column | Type | Notes |
|---|---|---|
| `Direction` | `tinyint NOT NULL DEFAULT 1` | 1 = **First mile** (inbound to depot; claims pickup-side legs by pickup area - today's behaviour), 2 = **Final mile** (outbound from depot; claims `DEL` legs by delivery area). Middle mile stays on `tblbulkLinehaulRun`. Tinyint rather than bit so it maps onto the UI's first/middle/final vocabulary and leaves room for more. |
| `DepotId` | `int NULL` FK `tblBulkRegion(BulkRegionID)` | First mile: the depot the route feeds (optional, recommended). Final mile: the depot it fans out from, **or** NULL when the origin is a client site. |
| `OriginName`, `OriginAddress`, `OriginZip`, `OriginLatitude`, `OriginLongitude`, `OriginRadiusM` | nullable | Final mile only: the pickup address it fans out from. Standalone, not bound to a client or to `tucClient`'s address; may be a client site or a third-party site. Geocoded on save; jobs match when their pickup point is within `OriginRadiusM`. Client scoping, when needed, via schedule binding. A final-mile route has exactly one origin: `DepotId` or the origin address (CHECK constraint). Never a variable origin (Steve 2026-09-25). |

`Routes` is shared with Configurator (DF Admin -> Operations -> Recurring Routes). Both columns are additive and defaulted, so Configurator keeps working but will not show or edit them. Final-mile routes are maintained in Routed Operations only until Configurator is updated (open question Q3).

### 4.2 Coverage: polygons first, zips as the starting point

Polygon Builder is not tied to zips. The workflow is: start from zips, amalgamate multiple zip polygons, and cut zips up to produce one polygon per route. A route's polygon is its true coverage; zips are a convenience for building it, not the definition.

- `Route` already relates to `BulkRunPolygon` via `tblBulkRunPolygonRoute`. A final-mile route's coverage = its linked polygon(s). No new tables needed.
- Zip-only coverage (`RouteZipcodes`) remains supported as a fallback for routes that have no polygon yet (e.g. route 15 "Burbank to Lab" today).
- At 20-30 routes per depot this is the only workable way to maintain coverage; hand-kept zip lists will not scale, and zip boundaries rarely match how a depot actually splits its drivers.

### 4.3 Coverage exclusivity

For final-mile routes, coverage from the same depot must not overlap. Without this, a delivery point inside two routes from the same depot splits unpredictably (the zip equivalent is already happening on pickup routes, see section 9).

- **Polygon routes:** active final-mile polygons with the same `DepotId` must not intersect (shared edges allowed). Checked on save in `RecurringRouteService` / Polygon Builder with `geography.STIntersects` minus `STTouches` (or the equivalent area-of-intersection > tolerance test), rejecting with the conflicting route name. Polygon Builder should also show sibling routes from the same depot while editing so gaps and overlaps are visible.
- **Zip-only routes:** a (`DepotId`, `Zip`) pair belongs to at most one active route. Enforced on save, and in the DB via a trigger on `RouteZipcodes` / `Routes` (zips live in `ZipPolygon`, so a plain unique index is not possible).
- The same area from **different** depots is allowed (`DepotId` disambiguates).

## 5. Resolver rules

**Most of this already exists** (confirmed from `DD_stpBulkScheduleJob_InsertChildJobs`, 2026-09-25):

- Since 2026-07-07 the child-leg SP re-resolves a delivery route for the `DEL` leg: it calls `UTL_stpRouteAutoAssign_Resolve` with the booking's delivery zip (`TriggerSource = 'ChildLegRestamp'`, `Side = 'Delivery'`) and stamps `@DeliveryRouteId` on `%DEL` legs, falling back to the pickup route.
- The resolver already does zip pre-filter + polygon containment (`UTL_stpRouteAutoAssign_ResolveOneSide`, `tblBulkRunPolygon.PartiallyIncludedZips`) and logs every decision to `RouteAutoAssignLog` (Auto-Assign Log page).
- Route 15 "Burbank to Lab" (zip 92656) is set up for this path. The 2026-10-02 `DEL` legs pre-date it, so they could not match.

What is missing, and what this section adds: the delivery side matches **any** route covering the delivery area, with no depot and no direction check. Fine with one final-mile route; wrong once pickup routes cover delivery zips or a depot has 20-30 final-mile routes. The change is to scope each side by `Direction` (and delivery by `DepotId`), not to build a new resolver.

Related live bugs in the same SP (leg order / timing, linehaul legs inheriting the pickup route and driver, `DEL` stamp guarded by `RouteId IS NULL`) are split out into `KEVIN-LINEHAUL-LEG-FIXES-2026-09-25.md`.

### 5.1 First-mile routes (Direction = 1)

Pickup side of the resolver only considers `Direction = 1` routes. Behaviour otherwise unchanged.

Match on the family's pickup area. Stamp the parent and `LHP` leg. `LHn` legs carry `LinehaulRunID` with `RouteId` NULL (Kevin fix doc, Bug 2).

### 5.2 Final-mile routes (Direction = 2)

Applies **only to the delivery-side leg of a split family** (job number suffix `DEL`, has `ParentID`). Single-leg (unsplit) jobs are not touched, so existing non-linehaul work does not move.

A `DEL` leg is claimed by final-mile route R when:

1. `R.Direction = 2 AND R.Active = 1`, and
2. the leg's **delivery point is inside R's coverage**:
   - R has polygon(s): delivery lat/lng (`DeliveryLatitude` / `DeliveryLongitude`) inside the polygon (`STIntersects`). Delivery coordinates on `DEL` legs are reliable in the NEOGE data (all point at the lab); it is the pickup side that is not.
   - R has zips only: delivery zip in R's `RouteZipcodes`.
   - Delivery leg with no coordinates: fall back to delivery zip against polygon-derived zips, else unrouted.
3. the leg's **origin** matches the route's single origin: origin depot = `R.DepotId`, or (no origin depot, picked up at an address) the job's pickup point is within `R.OriginRadiusM` of the route's origin address. Unsplit single-leg jobs picked up near a pickup-address final-mile route's origin are also eligible.

When a `DEL` leg matches a final-mile route, the final-mile route wins and overwrites the inherited pickup `RouteId` on that leg only.

### 5.3 Origin depot of a `DEL` leg

Do **not** use the `DEL` leg's own pickup coordinates. On the 2026-10-02 NEOGE data they hold the customer's coordinates even though the pickup address text shows the depot (see P3805 vs P4264). Resolve in this order:

1. **Terminal depot of the family's chain**: among siblings with the same `ParentID` (`LHP` + `LHn`), the leg whose `DepotId` is not the start of any other leg in the chain. Equivalently, from the schedule's `tblBulkScheduleLinehaul` rows: the `ToDepotId` that is not any other row's `FromDepotId`. Do **not** use "highest leg number" or "highest `ucjbID`": leg numbers follow definition-insertion order, not travel order (section 9 item 3).
2. The schedule's `tblBulkRunSchedule.PickupDepotId`.
3. The job's own `tucJob.DepotId`.
4. Otherwise: no origin depot, leg is not eligible for a final-mile route.

### 5.4 Unrouted delivery legs

A `DEL` leg with a resolvable origin depot but no matching final-mile route must **not** silently stay on the pickup route for Outbound purposes. Route Viewer shows it in an "Unrouted from <depot>" bucket (section 6). Today 18 NEOGE `DEL` legs on 2026-10-02 have `RouteId = NULL` and appear on no run at all.

### 5.5 Performance

Must be set-based: one join from candidate legs -> origin depot -> routes with that `DepotId` -> point-in-polygon (or zip) match. Filtering by `DepotId` first keeps the spatial test to 20-30 polygons per leg; a spatial index on the polygon geography column covers the rest. No per-row cursor. Target: 1,000+ legs per depot per night inside `uspPrebookSet` without material runtime increase.

### 5.6 Booking templates

`tucJobBooking` legs carry `RouteId` too. Apply the same rule to the recurring booking templates so generated jobs are born on the right route, not corrected afterwards.

## 6. Route Viewer changes

### 6.1 Run list honours the view toggle

- `RouteViewerRunService.GetRunsAsync`: pass `request.Group` through.
- `RVW_stpBulkRuns_2` and `RVW_stpBulkRunJobs`: add `@Group nvarchar(16) = NULL` (NULL / `Combined` = today's behaviour, so other callers are unaffected).

| View | Runs shown for selected depot(s) | Leg rule |
|---|---|---|
| Inbound | First-mile routes | `LHP` legs whose `DepotId` in `@Regions` (existing rule) |
| Outbound | Final-mile routes with `DepotId` in `@Regions`, plus the "Unrouted from <depot>" bucket | `DEL` legs whose origin depot (5.3) in `@Regions` |
| Combined | As today | As today |

### 6.2 Tighten the region match

In directional views (Inbound / Outbound) drop the `tblBulkJob.RegionID IN @Regions` branch for non-`LHP` legs. Keep it in Combined so the existing view does not change.

### 6.3 Missing-runs branch

`RVW_stpGetMissingJobRuns` takes only `@RunDate` and returns rows regardless of client / region filters. Add the same filter parameters.

### 6.4 Scale

Outbound on a big depot returns 20-30 runs. Run list needs to stay usable: existing sort, per-route progress (Jobs total / incomplete already there), and the unrouted bucket pinned to the top.

### 6.5 Front end

- `RvRunList.tsx`: remove the "presentational only" note; counts in Outbound come from the SP instead of `jobs - totalPickup`.
- `lib/runViewerViewMode.ts`: keep as the middle-pane predicate, but Outbound should be driven by leg type (`DEL`) rather than coordinate shape once the SP scopes correctly.

## 7. Transfer Route

`RVW_stpTransferRouteForFamilies` currently re-stamps `RouteId` on every leg of the family.

- Transferring a pickup job: move the parent, `LHP`, `LHn` legs, but **skip** a `DEL` leg that sits on a final-mile route.
- Transferring a `DEL` leg to a final-mile route: move that leg only.
- "Also transfer recurring booking" cascade: same split applied to `tucJobBooking`.

## 8. Recurring Routes UI

- Route editor: Direction selector "Inbound to depot" (default) / "Outbound from depot" plus a Depot picker (`tblBulkRegion`), required for Outbound. For Outbound, relabel coverage as "Delivery area" (polygon, or zips as fallback).
- Polygon Builder: when editing a final-mile route's polygon, show the other final-mile polygons from the same depot so the operator can carve one depot's area into 20-30 routes without gaps or overlaps.
- Save-time validation: reject coverage that overlaps another active final-mile route from the same depot; name the conflicting route.
- `SchedulesNew.tsx` Recurring Routes tab: replace the name regex in `routeKind` with `Direction` from the API. `RecurringRouteDtos` / `RouteDtos` gain `Direction` and `DepotId`.
- `RouteTypeChip`: currently "First/Final Mile" vs "Middle Mile". Split into First / Final / Middle.

## 9. Data fixes for Tenant 8 (NEOGE)

1. Route 15 "Burbank to Lab": set `Direction = 2`, `DepotId = 38` (Burbank), keep zip 92656, link NEOGE schedules, set default courier.
2. **Hayward chain does reach Burbank (38)** (corrected 2026-09-25). The Hayward schedules (71-74, 89) define Hay -> Oak (37), Oak -> Oak Airport (42), Oak Airport -> Bur Airport (43), Bur Airport -> Burbank (38). The final hop is numbered `LH1` because it was the first definition inserted, so it was outside the 2 Oct date filter.
3. **Leg numbering follows definition-insertion order, not travel order.** Sacramento schedule definitions by Id: Hay -> Oak, Oak -> Oak Airport, Sac -> Hay, Oak Airport -> Bur Airport, Bur Airport -> Burbank. P4231 legs mirror that: `LHP` -> 35, `LH1` -> 37, `LH2` -> 42, `LH3` -> 36, `LH4` -> 43, `LH5` -> 38. Travel order is `LHP`, `LH3`, `LH1`, `LH2`, `LH4`, `LH5`. Fix in the child-leg SP (`DD_/WS_stpBulkScheduleJob_InsertChildJobs`): order definitions by walking the depot chain from the pickup depot, not by `Id`. **Confirmed 2026-09-25: leg dates / times are also assigned in numbering order**, so hops are scheduled before the freight reaches them. This is a live dispatch bug, independent of Route Viewer:

| Family | Leg (travel order) | Hop | Scheduled |
|---|---|---|---|
| P4206 | `LHP` | pickup -> Hayward (36) | 1 Oct 02:00 |
| P4206 | `LH2` | Hay -> Oak (37) | 1 Oct 23:30 |
| P4206 | `LH3` | Oak -> Oak Airport (42) | 2 Oct 01:30 |
| P4206 | `LH4` | Oak Airport -> Bur Airport (43) | 2 Oct 02:30 |
| P4206 | **`LH1`** | **Bur Airport -> Burbank (38)** | **1 Oct 22:30 (4h before the flight lands)** |
| P4206 | `DEL` | Burbank -> lab | 2 Oct 04:30 |
| P4231 | `LHP` | pickup -> Sacramento (35) | 1 Oct 15:30 |
| P4231 | `LH3` | Sac -> Hay (36) | 2 Oct 01:30 |
| P4231 | **`LH1`** | **Hay -> Oak (37)** | **1 Oct 22:30 (before freight reaches Hayward)** |
| P4231 | **`LH2`** | **Oak -> Oak Airport (42)** | **2 Oct 00:30 (before freight reaches Hayward)** |
| P4231 | `LH4` | Oak Airport -> Bur Airport (43) | 2 Oct 03:30 |
| P4231 | `LH5` | Bur Airport -> Burbank (38) | 2 Oct 05:30 |
| P4231 | `DEL` | Burbank -> lab | 2 Oct 07:30 |

Times rise strictly with leg number in both families, and the same hop gets different times per family (Hay -> Oak 23:30 vs 22:30), so times are chained off the previous *numbered* leg rather than travel order or the linehaul run's timetable. Fix in the child-leg SP: order definitions by walking the depot chain before numbering and timing, and prefer the `tblbulkLinehaulRun` departure time (`StartTime` / `DespatchTime`) for fixed-timetable legs such as the flight.
4. **Pickup-route zip overlaps** (first-come wins today): 95816/95819 on SMF2 + SMF5 + SMF7; 95231/95350/95355/95382 on Central Valley + SMF3; 95356 on Hayward + SMF3; 95945 on RNO200 + SMF4; 95204 on SMF2 + Stockton (inactive).
5. **18 unrouted `DEL` legs on 2026-10-02:** P4222-4230, P4251, P4252, P4254, P4255, P4259-4263.

## 10. Blocked on

Definitions (`EXEC sp_helptext ...`) of:

- `UTL_stpRouteAutoAssign_Resolve`
- `DD_stpBulkScheduleJob_InsertChildJobs` and `WS_stpBulkScheduleJob_InsertChildJobs`
- `RVW_stpTransferRouteForFamilies`
- The part of `uspPrebookSet` that sets `RouteId`

Plus two read-only queries for Medical prod: `LinehaulRunId` per leg for the P3805 / P4264 / P4231 families, and the `tblBulkScheduleLinehaul` leg definitions for NEOGE schedules. Once in hand, write `FINAL-MILE-RECURRING-ROUTES-IMPLEMENTATION.md` with exact SQL diffs and C# signatures.

## 11. Test plan

- **NEOGE convergence (Medical, 2026-10-02 rebook or a future date):** Region Burbank + Outbound shows exactly one run (Burbank to Lab) with every `DEL` leg whose origin depot is 38; Inbound shows the pickup routes feeding Burbank; Combined unchanged.
- **Fan-out:** one depot, 3 final-mile routes with adjacent polygons (built from amalgamated and cut zips), 300 `DEL` legs. Each leg lands on exactly one route; points outside every polygon land in the unrouted bucket. Legs on a shared polygon edge resolve deterministically (lowest `RouteId`).
- **Exclusivity:** saving a final-mile polygon that overlaps another from the same depot is rejected; same for a duplicate zip on a zip-only route (API and DB).
- **Transfer Route:** transferring a pickup family leaves its `DEL` leg on the final-mile route.
- **Regression:** single-leg jobs and non-linehaul clients route exactly as before; Combined view counts unchanged.
- Tests: Playwright E2E for the Route Viewer toggle flow; vitest for any pure predicate changes; xUnit for `RecurringRouteService` exclusivity validation.

## 12. Open questions

- **Q1.** Resolved 2026-09-25: a final-mile route has one fixed origin, either a depot or a standalone pickup address (client or third-party site; geocoded, matched by radius); never variable pickup points, never bound to the client's own address.
- **Q2.** Should Route Viewer show the "Unrouted from <depot>" bucket in Outbound only, or also Combined?
- **Q3.** Configurator (DF Admin) - add `Direction` / `DepotId` there too, or make Routed Operations the only editor for final-mile routes?
- **Q4.** Resolved: Hayward reaches Burbank (38); see section 9 item 2.
- **Q5.** Existing bookings: one-off re-resolve script for `tucJob` and `tucJobBooking` from go-live date forward - confirm scope (NEOGE only, or all tenants with linehaul chains).
