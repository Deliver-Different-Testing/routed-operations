# Linehaul Leg Fixes + Route Direction - Handover for Kevin

_Author: Steve Bonnici (with EasyEA) - 2026-09-25_
_Scope: live dispatch bugs found while tracing the Route Viewer Outbound issue (see `FINAL-MILE-RECURRING-ROUTES-SPEC-2026-09-25.md`). These are independent of the final-mile work and should ship first._

All SP changes go through `C:\Gitlab\DBMigrationV2\DatabaseScripts\Migrations\`. Line numbers refer to the Medical prod copy of `DD_stpBulkScheduleJob_InsertChildJobs` supplied 2026-09-25.

**`WS_stpBulkScheduleJob_InsertChildJobs` (reviewed 2026-09-25) is a divergent fork, not a copy** (adds `BulkZonePackageRate` cubic pricing, per-leg `SpeedId`, shop refs; drops the US cumulative timing). Apply per bug:

| Bug | WS status | WS lines |
|---|---|---|
| 1 numbering | **Applies** - same unordered cursor | 540-541, 646, 804 |
| 1 timing | **Does not apply** - WS times each LH leg from `tblbulkLinehaulRun.StartTime` (all tenants), not accumulated minutes. Only the leg number is wrong on the WS path. | 703, 774 |
| 2 RouteId / courier | **Applies** - LH insert uses `@TemplateRouteId`; same RouteId and roster cascades | 799, 826-837, 849 |
| 4 delivery resolve | **Applies** - same zip-only `ChildLegRestamp` call | ~147-200 |

The NEOGE families above show US cumulative timing, so they came through the DD path.

## Summary

| # | Bug | Impact | Where |
|---|---|---|---|
| 1 | Linehaul legs numbered and timed in definition-insert order, not travel order | Hops scheduled before the freight reaches them | `DD_/WS_stpBulkScheduleJob_InsertChildJobs` cursor + US timing |
| 2 | Linehaul legs carry the pickup route's `RouteId`, then inherit the pickup route's roster courier | Linehaul (incl. flight) legs can be dispatched to the pickup driver | Same SP, LH insert + RouteId / courier cascades |
| 3 | Recurring Linehaul reads `tblBulkJob.LinehaulRunId`; straight-to-live legs are on `tucJob.LinehaulRunID` | Linehaul run job lists and stop counts empty for live legs | `RecurringLinehaulJobsService`, `RecurringLinehaulService`, `TucJob` entity |
| 4 | Delivery-side route resolution passes zip only, no coords / schedule, and uses the booking time | Polygon-defined delivery routes never match `DEL`; multi-candidate tie-break uses the wrong schedule and time | `UTL_stpJob_InsertFromTblBulkJob` (FunnelRestamp), `DD_stpBulkScheduleJob_InsertChildJobs` (ChildLegRestamp) |
| 5 | (Feature) No route direction: final-mile `DEL` legs cannot land on an outbound run from a depot or client site; Route Viewer Inbound / Outbound cannot filter runs | Outbound view shows every pickup route | `Routes` schema, resolver, the three callers, `RVW_stpBulkRuns_2` / `RVW_stpBulkRunJobs`, Recurring Routes UI |

---

## Bug 1 - Leg order and timing

### Evidence (Medical, NEOGE, run date 2026-10-02)

Leg numbers follow `tblBulkScheduleLinehaul.Id` order. US leg times accumulate in that same order.

| Family | Leg (in travel order) | Hop | Scheduled |
|---|---|---|---|
| P4206 | `LHP` | pickup -> Hayward (36) | 1 Oct 02:00 |
| P4206 | `LH2` | Hayward -> Oakland (37) | 1 Oct 23:30 |
| P4206 | `LH3` | Oakland -> Oak Airport (42) | 2 Oct 01:30 |
| P4206 | `LH4` | Oak Airport -> Bur Airport (43) | 2 Oct 02:30 |
| P4206 | **`LH1`** | **Bur Airport -> Burbank (38)** | **1 Oct 22:30 - 4h before the flight lands** |
| P4231 | `LHP` | pickup -> Sacramento (35) | 1 Oct 15:30 |
| P4231 | `LH3` | Sacramento -> Hayward (36) | 2 Oct 01:30 |
| P4231 | **`LH1`** | **Hayward -> Oakland (37)** | **1 Oct 22:30 - before freight reaches Hayward** |
| P4231 | **`LH2`** | **Oakland -> Oak Airport (42)** | **2 Oct 00:30 - before freight reaches Hayward** |
| P4231 | `LH4` | Oak Airport -> Bur Airport (43) | 2 Oct 03:30 |
| P4231 | `LH5` | Bur Airport -> Burbank (38) | 2 Oct 05:30 |

Sacramento schedule definitions by `Id`: Hay -> Oak, Oak -> Oak Airport, Sac -> Hay, Oak Airport -> Bur Airport, Bur Airport -> Burbank. Numbering mirrors that exactly.

### Root cause

- Lines 509-510: `Linehaul_Cursor` selects from `tblBulkScheduleLinehaul` with **no `ORDER BY`**, so rows come back in clustered (`Id`) order. `@JobNumberStartCount` (line 622 / 774) numbers them in that order.
- Lines 502-506 + 771 (US only): `@CurrentLinehaulDateTime` is seeded once (pickup date + `@ScheduleEndTime` + `@SpeedMinutes`) and then advanced by each leg's `Minutes` in cursor order. A leg defined early but travelled late gets an early time.
- `@LinehaulRunStartTime` (the run's own timetable) is only used on the NZ branch (line 745); the US branch ignores it.

### Fix

**1a. Order the cursor by walking the depot chain.** Replace the cursor source (lines 509-510):

```sql
DECLARE @SchedulePickupDepotId int =
    (SELECT PickupDepotId FROM tblBulkRunSchedule WHERE BulkRunScheduleId = @ScheduleId);

;WITH legs AS (
    SELECT * FROM tblBulkScheduleLinehaul
    WHERE BulkRunScheduleId = @ScheduleId AND Active = 1
),
chain AS (
    -- Start leg: departs the schedule's pickup depot or the client address,
    -- otherwise the leg whose FromDepotId no other leg arrives at.
    SELECT l.Id, l.ToDepotId, CAST(1 AS int) AS Seq
    FROM legs l
    WHERE (ISNULL(l.FromClientAddress, 0) = 1
           OR l.FromDepotId = @SchedulePickupDepotId
           OR NOT EXISTS (SELECT 1 FROM legs p WHERE p.ToDepotId = l.FromDepotId))
    UNION ALL
    SELECT n.Id, n.ToDepotId, c.Seq + 1
    FROM chain c
    JOIN legs n ON n.FromDepotId = c.ToDepotId
    WHERE c.Seq < 20                                   -- cycle guard
),
ordered AS (
    SELECT Id, MIN(Seq) AS Seq FROM chain GROUP BY Id
)
SELECT l.Id, ISNULL(o.Seq, 1000) AS Seq            -- legs not on the chain go last, by Id
INTO #OrderedLegs
FROM legs l LEFT JOIN ordered o ON o.Id = l.Id
OPTION (MAXRECURSION 20);

DECLARE Linehaul_Cursor CURSOR READ_ONLY FAST_FORWARD FOR
SELECT l.Amount, l.AmountPercentage, l.FromDepotId, l.ToDepotId, l.InsertToBulk, l.LinehaulRunID,
       l.ApplyDiscount, l.ApplyAddOnPercentage, l.WeekDay, l.DepartureAdvanceDays,
       l.FromClientAddress, l.DropOffLocationID, ISNULL(l.Minutes, 0), l.Id
FROM tblBulkScheduleLinehaul l
JOIN #OrderedLegs o ON o.Id = l.Id
ORDER BY o.Seq, l.Id;
```

- If any leg ends with `Seq = 1000` (broken or branching chain), write a row to `RouteAutoAssignLog` or an existing error log so ops can see the schedule needs fixing. Do not fail the booking.
- Numbering (`LH1..n`) and US cumulative timing are then correct without further change.

**1b. US: respect the linehaul run's timetable.** Proposed rule: a leg departs at the **later of** (a) the previous leg's arrival (current cumulative time) and (b) the run's `StartTime` on or after that point. Today the flight leg is timed purely by accumulated minutes. _Decision for Steve (Q1)._

**1c. Existing future-dated jobs.** Families already generated with the wrong order keep wrong numbers and times. Options: re-time only (update `ucjbDate` / `ucjbTime` of undispatched future LH legs by the corrected order) or leave to roll off. Propose the script separately; **do not run against prod without Steve's sign-off.**

---

## Bug 2 - Linehaul legs inherit the pickup route and its driver

### Root cause

- Line 763: LH legs inserted into `tucJob` with `RouteId = @TemplateRouteId` (the booking's pickup route).
- Lines 795-808: RouteId cascade gives LHP + LH the pickup route.
- Lines 814-823: courier cascade stamps `Dispatch_RouteRoster.CourierId` for the leg's `RouteId` onto **any** leg with no courier. If `tblbulkLinehaulRun.CourierID` is NULL, LH legs (including the flight) are assigned the pickup route's driver.

### Principle (Steve, 2026-09-25)

Every leg lives on `tucJob` and carries its own run: `LHP` -> pickup `RouteId`; `LHn` -> `LinehaulRunID` (with `RouteId` NULL); `DEL` -> delivery `RouteId`.

### Fix

1. Line 763: insert `NULL` instead of `@TemplateRouteId` for LH legs (`LinehaulRunID` already stamped at line 765).
2. Lines 795-808: exclude LH legs from the RouteId cascade: add `AND c.LinehaulRunID IS NULL`.
3. Lines 814-823: exclude LH legs from the route-roster courier cascade (`AND c.LinehaulRunID IS NULL`), and add a linehaul-roster cascade:

```sql
UPDATE c
   SET c.ucjbCourierID = lr.CourierId
FROM dbo.tucJob c
INNER JOIN dbo.Dispatch_LinehaulRunRoster lr
    ON lr.LinehaulRunId = c.LinehaulRunID
   AND lr.IsActive = 1
   AND (lr.RosterDate = CONVERT(date, c.ucjbDate)
        OR (lr.RosterDate IS NULL AND lr.DayOfWeek = DATEPART(weekday, c.ucjbDate)))
WHERE c.BulkParentID = @ParentBulkJobID
  AND c.LinehaulRunID IS NOT NULL
  AND ISNULL(c.ucjbCourierID, 0) = 0;
```

Date-override-beats-DOW precedence should match `uspPrebookSet` / `RouteRosterTab` (date override, then DOW pattern, then default). Confirm the `DayOfWeek` convention (DATEPART vs 0-based) against how Recurring Linehaul writes it.

4. **Same fix in `UTL_stpJob_InsertFromTblBulkJob`** for schedules with `InsertToBulk = 1` (LH legs promoted from `tblBulkJob`): the `tucJob` insert (RouteId CASE, ~lines 682-688) and the post-insert cascade (~lines 812-829) must yield `NULL` when `@LinehaulRunID IS NOT NULL`.

### Check before shipping

- Anything reading `RouteId` on LH legs: Route Viewer SPs already exclude `%LH%` (non-`LHP`) rows. `RVW_stpTransferRouteForFamilies` re-stamps every leg of a family; change it to skip legs with `LinehaulRunID IS NOT NULL`.
- Existing future-dated LH legs with a pickup `RouteId`: include in the 1c remediation script (set `RouteId = NULL` where `LinehaulRunID IS NOT NULL`, undispatched only).

---

## Bug 3 - Recurring Linehaul reads the wrong table

- `tucJob.LinehaulRunID` exists and is stamped on every straight-to-live LH leg (SP line 736 / 765).
- `RecurringLinehaulJobsService.ListForLinehaulRunAsync` (line ~21) and the stop counts in `RecurringLinehaulService` (line ~479) query `TblBulkJobs.LinehaulRunId`. For live legs these return nothing.
- The `TucJob` EF entity does not map `LinehaulRunID`.

### Fix

1. Map `LinehaulRunId` on `TucJob` (new partial, e.g. `TucJob.RecurringLinehaul.cs`), `int?`, column `LinehaulRunID`.
2. Switch both queries to `TucJobs` (`!UcjbVoid`), or UNION both sources during transition if any tenant still uses `InsertToBulk = 1` legs.
3. Direction is to stop storing live legs in `tblBulkJob` at all, so the `tucJob` path is the long-term source.

---

## Bug 4 - Delivery-side route resolution is under-specified

### How DEL gets its route today (confirmed from SP source)

- The `DEL` `tucJob` row is created in `UTL_stpJob_InsertFromTblBulkJob` when the `DEL` `tblBulkJob` row is promoted. Its `RouteId` is set at insert (~lines 682-688): delivery route if resolved (`@IFB_DeliveryRouteId`, `TriggerSource = 'FunnelRestamp'`, ~lines 317-375), else `tblBulkJob.RouteId`, else the booking's pickup route.
- `DD_stpBulkScheduleJob_InsertChildJobs` also resolves a delivery route (`ChildLegRestamp`, lines 148-199) and applies it to `%DEL` rows with `RouteId IS NULL` (lines 795-808). In practice the `DEL` row already has its route from the funnel path, so this is a backstop.
- So a `DEL` leg **does** get the delivery route when the resolver finds one. The NEOGE 2026-10-02 `DEL` legs did not only because route 15 "Burbank to Lab" was created after they were booked.

### Defects

Both callers invoke `UTL_stpRouteAutoAssign_Resolve` with only `@DeliveryZip`:

1. **No delivery coordinates.** `_ResolveOneSide` only runs the custom-polygon pass (Polygon Builder shapes) when lat/lng are supplied. Zip-only means a delivery route defined by polygon can never match. Pass `@DeliveryLatitude` / `@DeliveryLongitude` from the booking / `DEL` row.
2. **No `@SourceScheduleId`.** With more than one candidate, Rule 4 (schedule-bound routes win) is skipped and resolution falls straight to the window check. Pass the booking's schedule id.
3. **Wrong time for the delivery window.** `@PickupAtLocal` is the booking date (`ucbkDate`) for both sides. For the delivery side the window check should use the `DEL` leg's time. Add `@DeliveryAtLocal` to `_Resolve` (default = `@PickupAtLocal` for backward compatibility) and pass it to the delivery `_ResolveOneSide` call.

These only bite when more than one route covers a delivery point or when delivery routes use polygons - i.e. exactly the final-mile fan-out case. Single-candidate zip matches (route 15 today) already work.

### Verify on the next NEOGE bookings

```sql
SELECT j.ucjbNumber, CONVERT(varchar(16), j.ucjbDate, 120) AS JobDate, j.RouteId, r.Name, j.LinehaulRunID, j.DepotId
FROM tucJob j LEFT JOIN Routes r ON r.RouteId = j.RouteId
WHERE j.ucjbClientCode = 'NEOGE' AND j.CreatedTime >= '2026-09-25'
ORDER BY j.ucjbNumber;

SELECT l.CreatedAtUtc, l.JobBookingId, l.Side, l.TriggerSource, l.PriorRouteId, l.ResolvedRouteId, l.Outcome
FROM RouteAutoAssignLog l
WHERE l.TriggerSource IN ('FunnelRestamp', 'ChildLegRestamp') AND l.CreatedAtUtc >= '2026-09-25'
ORDER BY l.CreatedAtUtc DESC;
```

Expected: `DEL` legs on route 15; `Side = 'Delivery'` rows with `ResolvedRouteId = 15`, `Outcome = 'AssignedToRoute'`.

### Out of scope here (final-mile spec)

The resolver has no notion of direction: pickup and delivery both search all active routes, so a pickup route covering a delivery zip (or vice versa) can be chosen. Scoping by `Routes.Direction` / `DepotId` is in `FINAL-MILE-RECURRING-ROUTES-SPEC-2026-09-25.md`.

## Feature 5 - Route Direction (first mile / final mile) so DEL legs land on an outbound run

Steve decision 2026-09-25: ship Direction now in the SPs so the final-mile (outbound delivery) leg works, alongside Bugs 1-4. The C# resolver (lift plan P2) replaces this later; keep the SP changes additive and backward compatible. Design: `FINAL-MILE-RECURRING-ROUTES-SPEC-2026-09-25.md`.

**A final-mile route fans out from exactly one origin** (Steve 2026-09-25). The origin is not always a depot; it may be a client's site. It is never variable:

| Final-mile origin | Set on the route | Claims, by delivery area | Example |
|---|---|---|---|
| Depot | `DepotId` | `DEL` legs that leave that depot | NEOGE "Burbank to Lab" (depot 38) |
| Client site | `OriginClientId` | jobs / `DEL` legs picked up at that client's site, including unsplit single-leg jobs | Outbound fan-out from a customer's warehouse |

Today a client-site fan-out has no home: every job is picked up in the client's zip, so the pickup resolver puts the whole fan-out on the one pickup route covering that zip. A client-origin final-mile route splits it by delivery area instead.

### 5.1 Schema (DBMigrationV2)

```sql
ALTER TABLE dbo.Routes ADD
    Direction tinyint NOT NULL CONSTRAINT DF_Routes_Direction DEFAULT (1),  -- 1 = First mile, 2 = Final mile
    DepotId        int NULL CONSTRAINT FK_Routes_DepotId REFERENCES dbo.tblBulkRegion (BulkRegionID),
    OriginClientId int NULL CONSTRAINT FK_Routes_OriginClientId REFERENCES dbo.tucClient (ucclID);

-- First mile: DepotId optional (the depot it feeds), OriginClientId not used.
-- Final mile: exactly one origin - a depot or a client site.
ALTER TABLE dbo.Routes ADD CONSTRAINT CK_Routes_Direction CHECK (
    Direction IN (1, 2)
    AND (Direction = 1 AND OriginClientId IS NULL
         OR Direction = 2 AND (CASE WHEN DepotId IS NULL THEN 0 ELSE 1 END
                             + CASE WHEN OriginClientId IS NULL THEN 0 ELSE 1 END) = 1));
```

Open (Q5): is client id enough to identify the origin site, or do clients with several sites need a specific pickup address? If the latter, add `OriginAddressId` (FK to the client address table) and match on it instead.

Existing routes default to First mile: no behaviour change until a route is flagged Final mile. `Routes` is shared with Configurator (DF Admin); the columns are additive and defaulted so it keeps working.

### 5.2 Resolver: scope each side by direction

`UTL_stpRouteAutoAssign_ResolveOneSide` - add optional params, applied in **both** the polygon pass and the zip pass:

```sql
    @Direction      TINYINT = NULL,  -- NULL = legacy (any route)
    @DepotId        INT     = NULL,  -- only routes with this DepotId
    @OriginClientId INT     = NULL   -- only routes originating at this client's site
...
        INNER JOIN dbo.Routes r
                ON r.RouteId = rp.RouteId AND r.Active = 1
               AND (@Direction      IS NULL OR r.Direction      = @Direction)
               AND (@DepotId        IS NULL OR r.DepotId        = @DepotId)
               AND (@OriginClientId IS NULL OR r.OriginClientId = @OriginClientId)
```

`UTL_stpRouteAutoAssign_Resolve` - add `@DeliveryOriginDepotId INT = NULL` and `@DeliveryAtLocal DATETIME = NULL`:

- **Pickup side:** call `_ResolveOneSide` with `@Direction = 1`. Final-mile routes never claim a pickup.
- **Delivery side**, first hit wins (time = `ISNULL(@DeliveryAtLocal, @PickupAtLocal)` for attempts 1-2):
  1. **Depot-specific final mile** - only if `@DeliveryOriginDepotId IS NOT NULL`: `@Direction = 2, @DepotId = @DeliveryOriginDepotId`.
  2. **Client-site final mile** - only if the leg has no origin depot (picked up at the client): `@Direction = 2, @OriginClientId = <job's client>`.
  3. **Legacy fallback** - today's call (`@Direction = NULL`). Preserves the NZ "split route" behaviour where a `DEL` resolves to an ordinary route covering its delivery zip.
- Log one `Side = 'Delivery'` row with the winning attempt's outcome. Suggest appending the attempt to `TriggerSource` (e.g. `FunnelRestamp:FM-Depot`, `:FM-Client`, `:Legacy`, within the 30-char limit) so the Auto-Assign Log shows which rule fired.
- Also pass delivery coords and `@SourceScheduleId` through (Bug 4).

### 5.3 Callers: work out the DEL leg's origin

Origin depot of a `DEL` leg, first non-null:

1. **Terminal depot of the schedule's linehaul chain**: the `ToDepotId` that is not any other active leg's `FromDepotId`.
2. The schedule's `PickupDepotId` (no linehaul chain; goods consolidated at a depot).
3. NULL - the leg is picked up at the client's site. Attempt 1 is skipped; attempt 2 (client-site final mile, matched on the job's client) and the legacy fallback apply.

**Unsplit single-leg jobs** (no `LHP` / `LH` / `DEL` family) currently get only the pickup-side route. When the job's client has an active client-site final-mile route, run the delivery side too (attempt 2) and let a hit take precedence over the pickup route. Opt-in by configuration: no client-site final-mile route, no change.

```sql
DECLARE @DelOriginDepotId int =
    (SELECT TOP 1 l.ToDepotId
     FROM tblBulkScheduleLinehaul l
     WHERE l.BulkRunScheduleId = @ScheduleID AND l.Active = 1
       AND NOT EXISTS (SELECT 1 FROM tblBulkScheduleLinehaul n
                       WHERE n.BulkRunScheduleId = l.BulkRunScheduleId AND n.Active = 1
                         AND n.FromDepotId = l.ToDepotId));
IF @DelOriginDepotId IS NULL
    SELECT @DelOriginDepotId = PickupDepotId FROM tblBulkRunSchedule WHERE BulkRunScheduleId = @ScheduleID;
-- may still be NULL: client-site origin
```

Pass `@DeliveryOriginDepotId = @DelOriginDepotId`, delivery lat/lng, `@SourceScheduleId` and the `DEL` leg's date/time to `UTL_stpRouteAutoAssign_Resolve` in:

- `UTL_stpJob_InsertFromTblBulkJob` (FunnelRestamp, ~lines 317-375) - this is where the `DEL` row gets its `RouteId`.
- `DD_stpBulkScheduleJob_InsertChildJobs` and `WS_stpBulkScheduleJob_InsertChildJobs` (ChildLegRestamp, ~lines 148-199) - backstop.

For NEOGE all chains end at Burbank (38), so `DEL` legs resolve to route 15 "Burbank to Lab" once it is flagged Final mile with `DepotId = 38`.

### 5.4 Route Viewer: make Inbound / Outbound filter runs

- `RVW_stpBulkRuns_2` and `RVW_stpBulkRunJobs`: add `@Group nvarchar(16) = NULL`. NULL / `Combined` = today's behaviour.
  - **Outbound:** synthetic route runs with `Routes.Direction = 2`, `DEL` legs only. With a region filter, include a route when:
    - `Routes.DepotId IN @Regions`, or
    - `Routes.OriginClientId IN @ClientIDs` (client-site routes have no depot, so they follow the client filter; with no region filter they always show).
  - **Inbound:** synthetic route runs where `Routes.Direction = 1`; `LHP` legs whose `DepotId IN @Regions` (existing rule).
  - In Inbound / Outbound, drop the `tblBulkJob.RegionID IN @Regions` branch for non-`LHP` legs (it matches every leg of the booking).
- `RVW_stpGetMissingJobRuns`: add the client / region filters it currently ignores.
- `RouteViewerRunService.GetRunsAsync` / `GetBulkRunJobsAsync`: pass `request.Group` as `@Group` (it is received today and dropped).

### 5.5 Recurring Routes UI / API

- `Route` entity: `Direction` (`byte`), `DepotId` (`int?`). `RecurringRouteDtos` / `RouteDtos`: same two fields.
- Route editor: Direction selector "First mile (inbound)" / "Final mile (outbound)" For Final mile, an "Origin" choice: **Depot** (`tblBulkRegion` picker) or **Client site** (client picker). Exactly one is required.
- `RecurringRouteService` save validation: reject a Final-mile route whose coverage (zips, or polygon intersect) overlaps another active Final-mile route with the **same origin** (same `DepotId`, or same `OriginClientId`). Name the conflicting route.
- `Route` entity / DTOs also gain `OriginClientId` (`int?`).
- `SchedulesNew.tsx` Recurring Routes tab: replace the name regex in `routeKind` (~line 1453) with `Direction` from the API. `RouteTypeChip`: First / Final / Middle.

### 5.6 Data (Medical) - Steve to approve before running

- Route 15 "Burbank to Lab": `Direction = 2`, `DepotId = 38`, keep zip 92656; link NEOGE schedules; add a roster courier. Can be done through the new editor once 5.5 ships.
- Already-generated future NEOGE `DEL` legs stay on pickup routes until rebooked or moved (see Q2).

### 5.7 Acceptance

- New NEOGE booking: `LHP` on its pickup route; `LH` legs `RouteId` NULL with `LinehaulRunID`; `DEL` on route 15 with its roster courier. `RouteAutoAssignLog` shows `Side = 'Delivery'`, `ResolvedRouteId = 15`, attempt `FM-Depot`.
- Client-site final-mile routes (e.g. two routes from client X's warehouse with disjoint delivery zips): client X's jobs picked up at the site split across them by delivery area (attempt `FM-Client`); another client's jobs in the same delivery zips are unaffected.
- Route Viewer, Region Burbank: **Outbound** shows one run, "Burbank to Lab"; **Inbound** shows no NEOGE pickup routes (they feed Reno / Sacramento / Hayward); **Combined** unchanged.
- A tenant with no Final-mile routes: resolver output identical to today (`Legacy` attempt, same `ResolvedRouteId`).

## Test plan

- Rebook a NEOGE Sacramento and Hayward family for a future date on staging:
  - `LH` numbering in travel order: Sac -> Hay = `LH1`, ..., Bur Airport -> Burbank = last.
  - US times strictly increase in travel order; no leg earlier than its predecessor's arrival.
  - LH legs: `RouteId` NULL, `LinehaulRunID` set, courier from `Dispatch_LinehaulRunRoster` (or `tblbulkLinehaulRun.CourierID`), never the pickup driver.
  - `LHP` on the pickup route with the pickup roster courier; `DEL` on route 15 with its roster courier.
- Recurring Linehaul page shows the live legs and correct stop counts per run.
- Regression: single-leg jobs, NZ tenant branch (`@IsUsTenant = 0`), and `InsertToBulk = 1` schedules unchanged.
- Broken-chain schedule (a leg that does not connect): booking still created, leg appended last, log row written.

## Open questions

- **Q1.** US timing: should a leg wait for its linehaul run's `StartTime` (later of arrival and run start), or keep pure accumulated minutes?
- **Q2.** Remediation of already-generated future jobs (re-number / re-time / clear LH `RouteId`): run a script, or let them roll off?
- **Q3.** Resolved: all related SPs reviewed 2026-09-25 (`DD_` / `WS_stpBulkScheduleJob_InsertChildJobs`, `UTL_stpJob_InsertFromTblBulkJob`, `WS_stpJob_Insert_FromParent`, `UTL_stpRouteAutoAssign_Resolve`, `_ResolveOneSide`).
- **Q4.** These fixes are the last planned changes to the booking-generation SPs. Longer term the leg planning and route resolution move to C# (`ROUTED-OPERATIONS-LIFT-PLAN-REPRIORITISED-2026-09-25.md`). Keep the SP diffs minimal.
- **Q5.** Client-site final-mile origin: is the client id enough, or do clients with several sites need a specific pickup address (`OriginAddressId`)? Steve to confirm before 5.1 ships.
