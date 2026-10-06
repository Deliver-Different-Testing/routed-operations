# Schedules: one row per schedule, without touching what works

_Steve Bonnici -> Kevin, 2026-09-29, revised 2026-09-30 to the minimal-risk shape. Follows the
F1 / F11 / F17 / F18 work in `KEVIN-SCHEDULES-NEW-FIXES-2026-09-20.md`. Signed off by the
strategic team as a rationalisation goal; this document is the execution plan._

Sources: Kerran's `Schedule Table` export (11,110 rows, Urgent prod, 8 Sep 2026), the
dbmigrationsv2 migrations through 2026-09-25, routed-operations `develop` on GitLab as at
2026-09-29, and a call-site inventory across the repos on Steve's PC (section 8 says what that
does and does not cover).

---

## 0. TL;DR

**Brief (Steve, 30 Sep):** the lowest-risk plan that stops the day-row bloat getting worse.
Not a campaign to collapse the existing 11,000 rows.

| | |
| :- | :- |
| **Goal** | Every schedule created or edited from now on is **one row** with a seven-day mask. Existing schedules are left alone until touched. |
| **Mechanism** | A new **1:1 detail table keyed on the existing header id** holds the single-row shape. The physical day table is renamed and a **view with its old name** keeps the 26 dependent SPs working unchanged; where a detail row exists the view serves payload from it. |
| **Identity** | Unchanged. `tblBulkRunScheduleHeader.ScheduleId` stays the one key (F18). No new identity, no id remap in this project. Day rows survive as three-column id anchors until F18. |
| **What changes for ops** | Nothing they have to do. Schedules NEW writes the new shape; an old schedule moves to it when someone next saves it and its day rows agree. |
| **Only risky step** | The rename plus view (M2). Metadata-only, diffable to zero rows on staging, reversible in minutes. Direct `INSERT`s into the old table name from outside (ClientManager, being retired) will fail against the view - known and accepted. |
| **Cutoff / visibility** | One relative cutoff rule per schedule and `OccurrencesAhead`; the booking page shows the next N occurrences, which removes the reason for the inflated Monday cutoff (section 2.5). |
| **Day mask format** | `CHAR(7)`, position 1 = Monday - the convention `ucbkDays`, `tblBulkRunScheduleOverride.WeekDays` and `uspPrebookSet` already use. |
| **Not in scope** | Header widening, `IsCollapsed` flag, guard trigger, batch collapse runbook, dropping legacy columns. All can come later; none is needed to stop the bloat. |
| **Decisions needed** | Section 9 (two). |

---

## 1. What the data says

All 11,110 rows of the export analysed. A *logical schedule* is `(Name, ClientId)`, which
is what the 2026-09-08 header migration used to mint `ScheduleId`.

| Measure | Count |
| :- | -: |
| Day rows | 11,110 |
| Logical schedules | 2,725 |
| Distinct names | 1,889 (220 shared by 2+ clients — the F1 dimension, separate) |
| Schedules with 5 day rows (Mon–Fri) | 1,661 |
| Schedules with 1 day row | 609 (Sun-only 202, one weekday only ~370) |
| Schedules with 6 or 7 rows | 134 |
| Schedules with **more than 7 rows** | 55 |
| Groups where the same `DayOfWeek` appears twice | 72 |
| ├ of which are exact duplicate rows (all columns bar id identical) | 41 |
| └ of which are genuinely two windows under one name (AM + PM) | ~18 (94 schedules if split by window) |

**Which columns vary across the day rows of one schedule** (2,116 multi-day schedules):

| Column | Schedules where it varies | Reading |
| :- | -: | :- |
| `CutoffHours` | 845 | In 796 the odd day is **Monday**; in 583 of those Monday = weekday value **+48**, the rest cluster at +43…+50 and +24. This is "cutoff is Friday afternoon for Monday's run" hand-encoded in hours. F11's `CutoffDay`+`CutoffTime` expresses it on one row. |
| `EndTime` | 66 | Genuine per-day window differences, e.g. Mon 07:00–20:00 vs Tue–Fri 07:00–08:00. |
| `StartTime` | 49 | Same. ~75 schedules in total have a per-day window. |
| `Description` | 11 | Data entry drift. |
| `StorageState` / `DeliveryState` | 9 each | Data entry drift. |
| `PostcodeGroupId`, `SpeedId`, `AutoBook`, `ParentSpeedId`, `Region`, `BookPickup`, `PickupBoxDiscount`, `AutoBookScanAhead`, `PickupPostcodeGroupId`, `MaxJobs`, `ApplyPickupCutoff`, `PickupDepotId` | ≤ 5 each | Data errors, not design. |

Top day masks: `1111100` ×1,716, `0000001` ×202, single weekdays ~70 each, `1111111` ×80.

**Conclusion.** Once the F11 backfill (`20260924100500_ConvertCutoffHoursToAbsolutePair`)
has run, the per-day cutoff variance is gone by design. What remains is ~75 schedules with a
genuine per-day window, ~18 two-window names, 41 duplicate rows and a few dozen data errors.
Those are handled by *splitting into two schedules* or *fixing the data*, not by a per-day
exception mechanism. §5 says how the collapse procedure surfaces them.

## 1a. Urgent Prod results, 6 Oct 2026 (Kerran, Appendix C queries)

**A1 - column types.** `StartTime`, `EndTime`, `CutoffTime` are all `time` on Urgent Prod. The NZ
DATETIME trap in section 2.4 does **not** apply there; the view needs no cast on Urgent Prod. Still
check Medical Prod / US before M2 (the US entity comment is what raised it).

**A2 - dependents.** 34 objects reference the day table, none schema-bound. My migration grep found
26; the DB adds: `UTL_fncBulkZonePostcode_IsActive`, `UTL_fncJob_IsValid_WithDateTime`,
`Job_stpPush_AutoBookRun` / `_Combined`, `NET_stpBulkJobItems_Insert`, `REP_qryAlertTemplateCell`,
`REP_qryLabelsLinehaulJobs`, `RVW_stpLinehaulJobs` / `RVW_stpLinehaulOverview` / `RVW_stpLineHaulRuns`,
`UCL_StpBulkZoneRate_GetAmountByJobID` / `_GetDescriptionByJob`, `UTL_stpJob_tblBulkRunSchedule`,
`UTL_stpJob_tblBulkRunWithFilter`, `UTL_stpRate_UpratingRate`, `WS_stpJob_Topup_Insert`,
`fncT_BulkZoneRate_WithLinehaul`, `fncT_StpBulkZoneRate_GetAmountByJobID`, `UCL_fncT_GetBulkZone`,
trigger `tblBulkJob_Insert`, and view `DESWEB_qryDespatch`. All keep working through the compat
view. Two to note: `DESWEB_qryDespatch` is a view over the table and **must be refreshed** after the
rename (`procRefreshAllViews` does this); `tblBulkJob_Insert` is a trigger that reads the schedule
on every bulk job insert, so M2 must be tested with a real booking, not just a SELECT diff.

**A3 - FKs in.** Five, no triggers on the table, no synonyms: `tblBulkScheduleLinehaul`,
`tblRouteSchedule`, `BulkZoneSchedule`, plus two I had not listed - **`ShopWindow`**
(`FK_ShopWindow_tblBulkRunSchedule`, Shopify integration) and **`BulkPickupZoneSchedule`**
(`FK__BulkPicku__Sched__3C2ACFCE`, the collection-side zone junction - the pickup counterpart of
`BulkZoneSchedule`). Both follow the rename automatically; both are in Appendix B and both key on
day-row ids until F18.

**A4 - writers.** The query was too loose (any `INSERT` anywhere in a body that also mentions the
table) and returned 16 booking SPs that only *read* it. Tightened query in Appendix C (A4b). From
source control the only writer of the day table is the F11 backfill script. **A4b (Kerran, 7 Oct):
none.** No procedure, trigger or function writes the day table. The only writers are the
applications (Schedules NEW / old Schedules page via `ScheduleService`, and legacy ClientManager),
which is exactly what M2's non-updatable view relies on.

**B1 - readiness.** 2,736 headers, 11,396 day rows. `DuplicateDay` 112 (up from 72 in the export:
the F1 fold put several clients' identical day rows under one header - these collapse to one).
`WindowVariesByDay` 82. `CutoffUnclean` 37. `OtherPayloadVaries` 27. **`CutoffVariesByDay_AfterF11`
= 2,103 is my query's fault, not the data's:** the F11 backfill stores an *absolute* `CutoffDay`
per day row, so a Mon-Fri schedule with one consistent rule necessarily has five different
`CutoffDay` values. The relative rule (section 2.5) is what must be constant; B1b in Appendix C
measures that.

**B1b - readiness with the relative rule (Kerran, 7 Oct, Urgent Prod):**

| Headers | DuplicateDay | WindowVariesByDay | CutoffRuleVaries (Tue-Sun) | MondayVisibilityOffset (reconciled) | CutoffNull | **CollapsibleNow** |
| -: | -: | -: | -: | -: | -: | -: |
| 2,736 | 112 | 82 | 118 | 734 | 0 | **2,488 (91%)** |

The Monday offset is confirmed as the dominant pattern (734 schedules) and is reconciled, not
refused. `CutoffHours` is never NULL, so the 37 `CutoffUnclean` in B1 are F11's "unclean" absolute
conversions only. B1b does not subtract the 27 `OtherPayloadVaries` headers, so the honest first
set is about **2,460 schedules** convertible on touch with no operator action. The remaining ~250
are the 112 duplicate-day headers (mostly F1-fold duplicates that collapse once the identical rows
are deduplicated), the 82 per-day windows (split into two schedules) and the 118 schedules whose
Tue-Sun cutoff rule genuinely differs by day (review individually; expected to be data drift).

**B2 - masks.** 1,732 Mon-Fri, 203 Sunday-only, 88 all-week, ~370 single-weekday, 65 Mon/Wed/Fri.
Matches the export; nothing has shifted since 8 Sep beyond the fold.

**C - F17 on Urgent Prod.** Ten routes. The most schedules bound to any route is **three**
(Route 1, Waikato Outer / Rotorua Run, active, 3 bound, 0 bookings). No route has four or more. No
orphaned bindings (C2 empty). Resolver, last 14 days: 8,096 pickup / 8,088 delivery `NoMatch`
(expected - routes cover a few corridors), 14 jobs assigned to Routes 1 and 3. So **at rest nothing
is broken**: the "breaks above about three" report cannot be confirmed from data because no route
has crossed three. It has to be reproduced live - C4 in Appendix C.

**C - F17 on Medical Prod (7 Oct).** This is the tenant Kevin's original Route 5 / 7 / 10 counts
came from, and it reframes the symptom:

| Route | Active | Bound in `tblRouteSchedule` | Distinct `ScheduleID` on its bookings | Bookings |
| :- | :-: | -: | -: | -: |
| 5 RNO200 | 1 | **1** | **6** | 261 |
| 7 SMF5 | 1 | **1** | 4 | 70 |
| 10 RNO300 | 1 | **1** | 3 | 60 |
| 11 / 12 / 13 SMF4 / SMF3 / SMF2 | 1 | 1 | 1 | 40 / 42 / 35 |
| 14 SMF7, 9 Stockton | 1 / 0 | 1 | 0 | 0 |
| 6 Hayward, 8 Central Valley | 1 | **0** | 1 | 96 / 21 |
| 15 Burbank to Lab | 1 | 0 | 0 | 0 |

**Every route has at most one junction binding**, while the bookings on Route 5 span six
schedules. No route anywhere has more than one bound schedule, on either tenant beyond Waikato's
three. So "link more than about three schedules" was never achieved in `tblRouteSchedule`. Either
ops are linking through a surface that only holds one (the Configurator / DF Admin route editor
writes the legacy single `Routes.ScheduleId` pointer, and the 2026-08-03 backfill mirrored exactly
one row per route), or the Routed Operations picker refuses the extra schedules (it filters out
`AutoBook = 1`, and the medical corridor schedules are largely Book-immediately). C2 is empty (no
orphans). Resolver, last 14 days: routes 5-13 receive pickup-side assignments (11-144 each), Route
15 receives 482 delivery-side; `NoMatch` 180 / 154. The resolver is doing its job on Medical; the
binding count is what is stuck at one. **C5 in Appendix C discriminates the two causes.**

---

## 2. Target shape

### 2.1 `tblBulkRunScheduleDetail` - the single-row schedule (new, additive)

One row per schedule, keyed on the header. Exists only for schedules written in the new shape.

```sql
CREATE TABLE dbo.tblBulkRunScheduleDetail (
    ScheduleId              INT          NOT NULL
        CONSTRAINT PK_tblBulkRunScheduleDetail PRIMARY KEY CLUSTERED,
    WeekDays                CHAR(7)      NOT NULL,  -- '1111100' Mon..Sun
    StartTime               TIME(0)      NULL,
    EndTime                 TIME(0)      NULL,
    -- Cutoff is ONE relative rule (section 2.5):
    -- "CutoffTime on the occurrence date minus CutoffWorkingDaysBefore working days".
    CutoffWorkingDaysBefore TINYINT      NULL,
    CutoffTime              TIME(0)      NULL,
    OccurrencesAhead        TINYINT      NULL,      -- next-N occurrences the booking page shows
    MaxJobs                 INT          NULL,
    Region                  INT          NULL,
    SpeedId                 INT          NULL,
    Description             NVARCHAR(500) NULL,
    AutoBook                BIT          NULL,
    PostcodeGroupId         INT          NULL,
    BookPickup              BIT          NULL,
    PickupDepotId           INT          NULL,
    StorageState            INT          NULL,
    DeliveryState           INT          NULL,
    PickupRatingSpeed       INT          NULL,
    PickupPostcodeGroupId   INT          NULL,
    ParentSpeedId           INT          NULL,
    PickupBoxDiscount       INT          NULL,
    DropOffLocationID       INT          NULL,
    ApplyPickupCutoff       BIT          NULL,
    PickupCutoff            INT          NULL,
    AutoBookScanAhead       INT          NULL,
    IsRecurringSchedule     BIT          NULL,
    CreatedUtc              DATETIME2(0) NOT NULL CONSTRAINT DF_tblBulkRunScheduleDetail_CreatedUtc DEFAULT SYSUTCDATETIME(),
    CreatedBy               NVARCHAR(100) NOT NULL,
    UpdatedUtc              DATETIME2(0) NULL,
    UpdatedBy               NVARCHAR(100) NULL,
    CONSTRAINT FK_tblBulkRunScheduleDetail_Header FOREIGN KEY (ScheduleId)
        REFERENCES dbo.tblBulkRunScheduleHeader (ScheduleId),
    CONSTRAINT CK_tblBulkRunScheduleDetail_WeekDays
        CHECK (LEN(WeekDays) = 7 AND WeekDays NOT LIKE '%[^01]%' AND WeekDays <> '0000000')
);
```

Not here: `Name`, `ClientId`, `IsActive`, `DisplayName` - all already on the header.
`CutoffHours` is not carried; the view derives it for legacy readers (section 2.3).

Why a detail table rather than widening the header: the header stays narrow for the F1
resolver and `uspPrebookSet` seeks; "in the new shape" is simply "has a detail row" (no flag);
rollback of the whole feature is `DROP TABLE`; and the header, which every link table points at,
is never altered.

### 2.2 `tblBulkRunScheduleDay` - the renamed physical day table

`EXEC sp_rename 'dbo.tblBulkRunSchedule', 'tblBulkRunScheduleDay'`. IDENTITY, constraints,
indexes and the incoming FKs (`tblRouteSchedule`, `BulkZoneSchedule`, `tblBulkScheduleLinehaul`)
follow the rename. **No id changes; no row changes.**

For a schedule in the new shape, its day rows are **key rows only**: `BulkRunScheduleId`,
`ScheduleId`, `DayOfWeek`, `Name`, `ClientId`; every payload column NULL. They exist because
downstream still keys on the day-row id:

- `tucJobBooking.ScheduleID`, `tucJob.ScheduleId`, `tblBulkJob.ScheduleId` (booked day row)
- `tblRouteSchedule.ScheduleId` (representative day row; F17/F18)
- `tblBulkScheduleLinehaul.BulkRunScheduleId`, `BulkZoneSchedule.ScheduleId`
- the `@UrgentScheduleSpeedID = ScheduleID * 1000 + SpeedID` packing in the booking SPs

Until F18 remaps those to `Header.ScheduleId`, the day table is the id allocator. Three-column
key rows are not the bloat this plan is about; the payload duplication is.

### 2.3 View `dbo.tblBulkRunSchedule` - the compatibility surface

```sql
SET ANSI_NULLS ON; SET QUOTED_IDENTIFIER ON;
GO
CREATE OR ALTER VIEW dbo.tblBulkRunSchedule
AS
SELECT
    d.BulkRunScheduleId,
    d.ScheduleId,
    h.Name,
    d.DayOfWeek,
    COALESCE(x.StartTime,        d.StartTime)        AS StartTime,
    COALESCE(x.EndTime,          d.EndTime)          AS EndTime,
    COALESCE(x.MaxJobs,          d.MaxJobs)          AS MaxJobs,
    COALESCE(x.Region,           d.Region)           AS Region,
    COALESCE(d.ClientId,         h.LegacyClientId)   AS ClientId,
    COALESCE(x.SpeedId,          d.SpeedId)          AS SpeedId,
    -- Legacy relative-hours carrier, derived for new-shape rows so old readers keep working:
    CASE WHEN x.ScheduleId IS NOT NULL
         THEN dbo.fnCutoffHoursFor(d.DayOfWeek, x.StartTime, x.CutoffWorkingDaysBefore, x.CutoffTime)
         ELSE d.CutoffHours END                      AS CutoffHours,
    CASE WHEN x.ScheduleId IS NOT NULL
         THEN dbo.fnCutoffDayFor(d.DayOfWeek, x.CutoffWorkingDaysBefore)
         ELSE d.CutoffDay END                        AS CutoffDay,
    COALESCE(x.CutoffTime,       d.CutoffTime)       AS CutoffTime,
    COALESCE(x.Description,      d.Description)      AS Description,
    COALESCE(x.AutoBook,         d.AutoBook)         AS AutoBook,
    COALESCE(x.PostcodeGroupId,  d.PostcodeGroupId)  AS PostcodeGroupId,
    COALESCE(x.BookPickup,       d.BookPickup)       AS BookPickup,
    COALESCE(x.PickupDepotId,    d.PickupDepotId)    AS PickupDepotId,
    COALESCE(x.StorageState,     d.StorageState)     AS StorageState,
    COALESCE(x.DeliveryState,    d.DeliveryState)    AS DeliveryState,
    COALESCE(x.PickupRatingSpeed, d.PickupRatingSpeed) AS PickupRatingSpeed,
    COALESCE(x.PickupPostcodeGroupId, d.PickupPostcodeGroupId) AS PickupPostcodeGroupId,
    COALESCE(x.ParentSpeedId,    d.ParentSpeedId)    AS ParentSpeedId,
    COALESCE(x.PickupBoxDiscount, d.PickupBoxDiscount) AS PickupBoxDiscount,
    COALESCE(x.DropOffLocationID, d.DropOffLocationID) AS DropOffLocationID,
    COALESCE(x.ApplyPickupCutoff, d.ApplyPickupCutoff) AS ApplyPickupCutoff,
    COALESCE(x.PickupCutoff,     d.PickupCutoff)     AS PickupCutoff,
    COALESCE(x.AutoBookScanAhead, d.AutoBookScanAhead) AS AutoBookScanAhead,
    COALESCE(x.IsRecurringSchedule, d.IsRecurringSchedule) AS IsRecurringSchedule
FROM dbo.tblBulkRunScheduleDay d
INNER JOIN dbo.tblBulkRunScheduleHeader h ON h.ScheduleId = d.ScheduleId
LEFT  JOIN dbo.tblBulkRunScheduleDetail x ON x.ScheduleId = d.ScheduleId
WHERE x.ScheduleId IS NULL
   OR SUBSTRING(x.WeekDays, d.DayOfWeek, 1) = '1';
GO
```

Properties:

- **Same columns, same names, same order** as the table today, so `SELECT *` and positional
  temp-table inserts in the availability functions are unaffected.
- **Every existing `BulkRunScheduleId` still resolves.** No booking, route binding or linehaul
  leg needs touching.
- With **no detail rows** the view is the table (`x` is always NULL, `WHERE` is always true).
  That is the state at deploy, and V1 in section 6 proves it.
- For a new-shape schedule, a key row whose mask bit is `0` is hidden. "Switch off Fridays" is
  a mask edit; the key row stays as an id anchor.
- Plain joins on clustered keys, no aggregates, so predicates on `BulkRunScheduleId`,
  `ScheduleId`, `DayOfWeek` and `Name` push through. Confirm
  `IX_tblBulkRunScheduleDay (ScheduleId, DayOfWeek)` exists.
- **Not writable.** A direct `INSERT`/`UPDATE` against the old name fails. The only writer we
  control (Schedules NEW) writes the detail and day tables directly. ClientManager is being
  retired; its direct writes failing loudly is the accepted consequence (section 4.3).

Two tiny helpers keep legacy readers whole: `dbo.fnCutoffDayFor(@DayOfWeek, @WorkingDaysBefore)`
(weekday roll-back over Sat/Sun) and `dbo.fnCutoffHoursFor(...)` (hours between the derived
cutoff and the occurrence start, for anything still reading `CutoffHours`). Holidays are
date-specific and stay with the booking-time functions, exactly as today.

### 2.4 The NZ time-type trap

**Urgent Prod (6 Oct) and Medical Prod (7 Oct) both confirmed `time` on all three columns.** The
per-tenant branch below is therefore **not needed**; the view is one body. Kept for the record. `TblBulkRunSchedule.cs` in routed-operations records that `StartTime`/`EndTime` are **TIME on
US but DATETIME on NZ**; the legacy SPs paper over it with `CAST(x AS datetime)`. Before M2:

```sql
SELECT c.name, t.name FROM sys.columns c JOIN sys.types t ON t.user_type_id = c.user_type_id
WHERE c.object_id = OBJECT_ID('dbo.tblBulkRunSchedule') AND c.name IN ('StartTime','EndTime');
```

If NZ is DATETIME, the detail table still uses `TIME(0)` (correct), and the view emits
`StartTime`/`EndTime` in the **tenant's legacy type** so the view's column types equal the
table's. The migration branches on `sys.columns` and builds the view body with `sp_executesql`;
the F11 migrations already branch per tenant the same way.

### 2.5 Cutoff and visibility on one row (decided 2026-09-29)

Two things were historically encoded in the per-day `CutoffHours`:

1. **The real cutoff** - how long before the run bookings close.
2. **Visibility** - the Monday value was inflated (+48h on 796 schedules) so Monday's run still
   appeared on the booking page over a weekend when the page only looked `DaysInFuture`
   calendar days ahead.

Product direction: the booking page shows the **next N occurrences**, not a calendar window.
Monday then appears on Friday because it is simply the next occurrence, and the inflated
Monday cutoff has no reason to exist. Hence, on the detail row:

- `CutoffWorkingDaysBefore` + `CutoffTime`: one relative rule for every occurrence. Monday
  with `1` gives Friday; over a long weekend the holiday calendar gives Thursday.
- `OccurrencesAhead`: N. Replaces the client-speed `DaysInFuture`, which stays as fallback
  (`0` maps to `1` occurrence). Also added to `tblBulkRunScheduleOverride` at schedule scope so
  one client can see further ahead; `fnScheduleForClient` coalesces override over detail over
  legacy client-speed over the current default of 6.

The availability functions (`UTL_/DD_fncJob_GetClientAvailableBulkRunSchedule`) are built
around the calendar window in four branches; they are the **first real rewrite** (section 8):
one query - mask x dates, skip holidays, drop occurrences past cutoff, stop at N.

---

## 3. Migrations (dbmigrationsv2 conventions)

Every script: `SET ANSI_NULLS ON; SET QUOTED_IDENTIFIER ON;`, idempotent guards, GRANT mirroring
via the `sys.database_permissions` discovery pattern from `20260908120004`,
`EXEC procRefreshAllViews` where a table changes shape.

| # | Name | Contents | Risk | Reversible by |
| :- | :- | :- | :- | :- |
| M1 | `..._ScheduleDetail_Create` | `tblBulkRunScheduleDetail` (section 2.1) + `OccurrencesAhead` on `tblBulkRunScheduleOverride` + `fnCutoffDayFor` / `fnCutoffHoursFor`. GRANTs. `procRefreshAllViews`. | **None** - additive, nothing reads it. | `DROP` |
| M2 | `..._ScheduleDay_RenameAndCompatView` | `sp_rename` -> `tblBulkRunScheduleDay`; view `dbo.tblBulkRunSchedule` (section 2.3, tenant time-type branch section 2.4); GRANTs on both; `procRefreshAllViews`. **Behaviour identical**: no detail rows exist. | **Low, and the only one.** Metadata rename + view. Anything `INSERT`ing into the old name fails (section 2.3). | drop view, `sp_rename` back |
| M3 | `..._fnScheduleForClient_ReadDetail` | F1 resolver reads detail-then-day via the view's columns plus `OccurrencesAhead`. Optional in this release; the view already feeds it. | Low | redeploy prior body |

**Gate for M2:** on staging, V1 (section 6) returns zero rows both ways, then the standard
booking / availability / run viewer / `uspPrebookSet` regression passes. Then prod.

**Ordering:** M2 must come after the last F11 / F19 SP re-emit in the same deploy; name them in
the `COLLISION-REVIEWED` header.

**Deferred, deliberately** (each is a separate decision later): guard trigger on the day table;
batch collapse procedure; dropping payload columns from `tblBulkRunScheduleDay`; F18 remap of
`tucJobBooking` / `tblRouteSchedule` / linehaul / zones to `Header.ScheduleId`.

---

## 4. Application changes (routed-operations only)

### 4.1 `ScheduleService` - one upsert path, writes the new shape

Today `UpsertGroupAsync` creates a header, then one `TblBulkRunSchedule` per `req.DayWindows`,
stamping the shared payload on every row via `ApplyGroupTemplateToRow`
(`ScheduleService.cs` ~1120-1200 on develop). Both the old Schedules page and Schedules NEW go
through this service.

After M1-M2:

- **EF mapping.** `TblBulkRunSchedule` -> mapped to the **view** for reads (keyed view is fine
  for queries). New `TblBulkRunScheduleDay` -> table, writes. New `BulkRunScheduleDetail` ->
  table, 1:1 with `BulkRunScheduleHeader`. `BulkZoneSchedule`, `TblBulkScheduleLinehaul`,
  `Route.Schedules` FKs point at the Day entity (same ids).
- **Create** writes: header (as now) + **one detail row** (payload, `WeekDays`, relative cutoff,
  `OccurrencesAhead`) + **one key row per masked day** in `tblBulkRunScheduleDay` with only
  `Name`, `ClientId`, `ScheduleId`, `DayOfWeek` set. Zones and linehaul legs bind to the
  lowest-`DayOfWeek` key row, which is what they bind to today (F18 finding).
- **Update of a new-shape schedule** edits the detail row. Unticking a day flips the mask bit;
  the key row is kept. Ticking a day that has no key row inserts one.
- **Update of an old-shape schedule** (no detail row yet): if its day rows agree on every
  payload column (after treating the Monday +48h `CutoffHours` as the visibility offset,
  section 2.5), the save writes a detail row and nulls the day-row payload, i.e. it converts.
  If they disagree, the save proceeds in the old shape and the UI shows why it did not convert
  (per-day window differs, duplicate day, payload differs). **This is the whole "migration" of
  existing data in this plan**: opportunistic, on touch, no campaign.
- `ApplyGroupTemplateToRow` is not called for new-shape schedules; the F8 "row 0 decides"
  problem does not exist for them.
- The day tab offers **one** window and **one** set of days. A schedule that needs Monday
  07:00-20:00 and Tue-Fri 07:00-08:00 is two schedules; offer "Split by window" in the
  did-not-convert message.

### 4.2 Schedules NEW list

Reads the header + detail (or header + synthesised-from-day-rows for old-shape). Same DTO
either way: `scheduleId`, `weekDays` (7-char), payload once. A small "new shape / old shape"
indicator is useful so ops can see the estate converging; nothing else changes.

### 4.3 Everything else

- **dfrntdrive_configurator** (`TenantSchedulesService`, `TenantRouteService`,
  `TenantLinehaulService`): read `TblBulkRunSchedule` only; unaffected through the view.
- **ClientManager `/api/Schedules`** (AdminManager admin-ui): being retired (Steve, 29 Sep).
  Its direct `INSERT`/`UPDATE`/`DELETE` against `tblBulkRunSchedule` will fail after M2 with a
  view-not-updatable error. Accepted. If that lands before ClientManager is switched off, the
  admin-ui schedules module should be pointed at Schedules NEW rather than patched.
- **The 26 SPs / functions** (section 8): unchanged in this plan.

---

## 5. Rollout

| Step | Ships | Gate | Rollback |
| :- | :- | :- | :- |
| **A** | M1 (+ M3 if ready) | none needed; additive | drop |
| **B** | M2 on staging | V1 = 0 rows both ways; regression on booking, availability, run viewer, `uspPrebookSet` | drop view, rename back |
| **C** | M2 on prod | same V1 immediately after deploy | same, minutes |
| **D** | `ScheduleService` writes new shape; list shows shape indicator | a week of new schedules on staging book identically; then prod | revert app; delete detail rows for anything created (day rows still carry nothing, so also re-fan payload from detail before deleting - trivial script) |
| **E** | Opportunistic conversion on save (section 4.1) | watch the did-not-convert reasons for a fortnight | per schedule: copy detail back to day rows, delete detail row |

After E the estate converges on its own. A deliberate set-by-set collapse (the earlier
`uspScheduleCollapse` design) remains available as a later, separate decision if ops wants the
remaining rows gone faster.

---

## 6. Verification queries

```sql
-- V1. View reproduces the table exactly (staging, immediately after M2, before any detail rows).
SELECT COUNT(*) FROM (SELECT * FROM dbo.tblBulkRunSchedule EXCEPT SELECT * FROM dbo.tblBulkRunScheduleDay) x;
SELECT COUNT(*) FROM (SELECT * FROM dbo.tblBulkRunScheduleDay EXCEPT SELECT * FROM dbo.tblBulkRunSchedule) x;

-- V2. Every masked day of a new-shape schedule has a key row; no unmasked day leaks through the view.
SELECT x.ScheduleId, d.dow
FROM dbo.tblBulkRunScheduleDetail x
CROSS APPLY (VALUES (1),(2),(3),(4),(5),(6),(7)) d(dow)
LEFT JOIN dbo.tblBulkRunScheduleDay r ON r.ScheduleId = x.ScheduleId AND r.DayOfWeek = d.dow
WHERE SUBSTRING(x.WeekDays, d.dow, 1) = '1' AND r.BulkRunScheduleId IS NULL;

-- V3. New-shape schedules carry no payload on their day rows.
SELECT COUNT(*) FROM dbo.tblBulkRunScheduleDay d
JOIN dbo.tblBulkRunScheduleDetail x ON x.ScheduleId = d.ScheduleId
WHERE d.StartTime IS NOT NULL OR d.CutoffHours IS NOT NULL OR d.SpeedId IS NOT NULL OR d.Region IS NOT NULL;

-- V4. Availability unchanged for a client (before/after converting one of its schedules).
SELECT * FROM dbo.UTL_fncJob_GetClientAvailableBulkRunSchedule(@ClientId, @SpeedId, @DateTime, @FromPostCode, @ToPostCode)
ORDER BY BulkRunScheduleId;

-- V5. Progress: how much of the estate is in the new shape.
SELECT CASE WHEN x.ScheduleId IS NULL THEN 'old' ELSE 'new' END AS Shape, COUNT(*) Headers,
       SUM((SELECT COUNT(*) FROM dbo.tblBulkRunScheduleDay d WHERE d.ScheduleId = h.ScheduleId)) DayRows
FROM dbo.tblBulkRunScheduleHeader h LEFT JOIN dbo.tblBulkRunScheduleDetail x ON x.ScheduleId = h.ScheduleId
WHERE h.RetiredUtc IS NULL GROUP BY CASE WHEN x.ScheduleId IS NULL THEN 'old' ELSE 'new' END;
```

---

## 7. How this fits the open F-items

- **F1 (client deltas):** unchanged. `fnScheduleForClient` resolves against the view now and
  the header later. `tblBulkRunScheduleOverride.WeekDays` already has the same `CHAR(7)` shape,
  so a client override of days composes naturally: effective mask = override mask if present,
  else header mask.
- **F11 (cutoff):** the collapse depends on the F11 backfill having run, but the detail row carries
  a **relative** rule (section 2.5), not the per-day absolute pair; the view derives the pair for
  the SPs. The `CutoffUnclean` reason is the 603-row "unclean" set from Kevin's 24 Sep preview
  surfacing per schedule. The Monday +48h pattern is reconciled, not refused.
- **F17 / recurring routes:** untouched here. Binding stays on the representative day-row id
  until F18. The collapse does not delete key rows, so `tblRouteSchedule` cascade deletes cannot
  fire from this work.
- **F18 (one key):** this plan is the precondition that makes F18 mechanical. Once the header
  is the only payload holder, remapping bookings and bindings to `Header.ScheduleId` is a pure
  id swap.
- **F20 (book immediately):** nothing here blocks building the AutoBook path in C# against the
  header from day one (see §9 lift assessment).

---

## 8. Inventory: the 26 SPs/functions that read schedule day rows, and what can be lifted into EF Core

**Coverage caveat.** Call sites were searched across the repos on Steve's PC only
(routed-operations, dfrntdrive_configurator, configurator-main-docs, despatchwebchanges,
runviewer, dfrnt-ops, project-dashboard, …). **Not searched**, because not on this machine:
the ClientManager API, the public booking sites, Excelerator, RunBuilder and the full
DespatchWeb source at `C:\Gitlab` on the old laptop. "No app caller found" below means *not
found locally*, not *no caller*. SP-to-SP callers come from reading the migration bodies.

Lift classes: **Lift now** (single caller we own, read-only) · **Pilot** (new code, build in
C# from day one) · **After re-point** (multiple external callers; needs an API boundary and, for
pricing, a shadow-run) · **Worker** (cron → hosted service) · **Keep in SQL** (set-based or
geography; not worth moving).

| SP / function | Role | App callers found locally | SP callers | Lift class | Notes |
| :- | :- | :- | :- | :- | :- |
| `RVW_stpBulkRunJobs` | Run viewer job list | routed-operations (Dapper), runviewer | — | **Lift now** | Heavy read; keep as SQL view if LINQ regresses. |
| `RVW_stpBulkRuns_` | Run viewer run list | — (routed-operations via `RVW_stpBulkRuns` family) | — | **Lift now** | Same. |
| `RVW_stpJobSiblings` | Sibling legs for a job | routed-operations | — | **Lift now** | Small. |
| `UTL_stpJob_tblBulkJobWithFilter` | Bulk job filter (delimited id lists) | routed-operations | — | **Lift now** | Replace delimited strings with LINQ `Contains`. |
| `fnScheduleForClient` | F1 delta resolver (inline TVF) | routed-operations (7 sites) | booking SPs via view | **Keep in SQL** for now | Inline TVF is the point; EF version comes when booking lifts. |
| `UTL_fncJob_GetClientAvailableBulkRunSchedule` | NZ client availability | none local (booking site / DespatchWeb) | `WS_stpBulkScheduleJob_Insert`, `WS_stpJob_Insert` | **Rewrite first (SQL)** | Four calendar-window branches -> one occurrence-based query over the header mask (section 2.5). Read-only, testable against the booking page. Same signature so SP callers are untouched. |
| `DD_fncJob_GetClientAvailableBulkRunSchedule` | US client availability | dfrnt-ops (proposed MCP tools only) | `DD_stpBulkScheduleJob_Insert`, `DD_stpJob_InsertExcelerator` | **Rewrite first (SQL)** | Twin; one body, tenant branch only where types differ. |
| `IsWithinDepotServiceArea` | Depot geography | none local | availability fns | **Keep in SQL** | Geography. |
| `WS_stpBulkScheduleJob_Insert` | NZ scheduled booking entry | none local | `WS_stpJob_Insert`, `UTL_stpJobBooking_ApplyInitialPhase`, `UTL_stpJob_InsertFromTblBulkJob` | **After re-point** | The prize with its DD_ twin: one C# engine, tenant strategy. Pricing → shadow-run. |
| `DD_stpBulkScheduleJob_Insert` | US scheduled booking entry | dfrnt-ops (1) | `DD_stpJob_InsertExcelerator`, `DD_stpJob_Scheduler_Rates`, `UTL_stpJobBooking_InsertSchedule` | **After re-point** | Twin of the above. |
| `WS_stpBulkScheduleJob_InsertChildJobs` | NZ LHP/LH/DEL children | none local | `WS_stpBulkScheduleJob_Insert` | **After re-point** | Moves with its parent. F20's shared derivations live here. |
| `DD_stpBulkScheduleJob_InsertChildJobs` | US children | none local | `DD_stpBulkScheduleJob_Insert` | **After re-point** | Twin. |
| `WS_stpJob_Insert` | NZ live booking | routed-operations (4), configurator (1), dfrnt-ops | `UTL_stpJobBooking_*`, RVW_ family | **After re-point** | Public booking API surface; many external callers expected off-PC. |
| `DD_stpJob_InsertExcelerator` | US live booking | despatchwebchanges (7), routed-operations (3) | RVW_ family, `UTL_stpJobBooking_*` | **After re-point** | Same. |
| `DD_stpJob_Excelerator_Insert` | US Excelerator variant | despatchwebchanges (3) | `DD_stpJob_CreateInitialPhaseRecurringJobs`, nationwide flight | **After re-point** | Excelerator source off-PC. |
| `UTL_stpJob_Insert_Rated` | Rated insert (pricing) | none local | `UTL_stpJobBooking_ApplyInitialPhase` | **After re-point**, last | Pure rating; shadow-run mandatory. |
| `DD_stpJob_Scheduler_Rates` | US scheduler rating | dfrnt-ops (1) | — | **After re-point**, last | Rating. |
| `UTL_stpJob_InsertFromTblBulkJob` | Promote staged bulk → tucJob | despatchwebchanges (4), routed-operations (2) | `Job_stpPush_AutoBookRun_Combined`, `UTL_stpJob_tblBulkJob_*` | **After re-point** | F19a/F20 territory. Sits between staging and live. |
| `UTL_stpJobBooking_InsertJob` | Recurring booking → job | configurator, routed-operations | `UTL_stpJob_ApplyRecurringFuelReprice` | **Worker** | Part of the nightly chain. |
| `UTL_stpJobBooking_InsertSchedule` | Recurring booking → scheduled job | despatchwebchanges (2), routed-operations (1) | `UTL_stpJobBooking_ApplyInitialPhase`, `_Monitor`, `DD_stpJob_CreateInitialPhaseRecurringJobs` | **Worker** | Same chain. |
| `UTL_stpJobBooking_ApplyInitialPhase` | Initial-phase recurring | none local | `WS_/DD_stpBulkScheduleJob_Insert`, `UTL_stpJob_Insert_Rated` | **Worker** | Same chain. |
| `UTL_stpJobBooking_Monitor` | Nightly monitor | configurator, project-dashboard | `usp_NightlyPrebookAndMonitor` | **Worker** | SQL Agent today. |
| `uspPrebookSet` | Nightly materialiser | despatchwebchanges (12), configurator (3), routed-operations (1) | `usp_NightlyPrebookAndMonitor` | **Worker** | Snapshot in source since 22 Sep. Hosted service makes it observable (F17). |
| `UTL_stpJob_ApplyRecurringFuelReprice` | Fuel reprice on recurring | despatchwebchanges (1) | `UTL_stpJobBooking_InsertSchedule` | **Worker** | Batch. |
| `UTL_stpRouteAutoAssign_Resolve` | Route resolver wrapper | routed-operations | 11 booking SPs | **Keep in SQL** until booking lifts | Geography + called from inside SPs; moves with the booking engine (NetTopologySuite). |
| `UTL_stpRouteAutoAssign_ResolveOneSide` | Per-side resolver | routed-operations (5) | `_Resolve` | **Keep in SQL** until booking lifts | Reads `tblRouteSchedule` (F17 key-space defect lives here). |
| `UTL_stpRouteAutoAssign_NormalizeZip` | Zip normaliser | none local | `_Resolve` | **Keep in SQL** | Trivial. |

**First lift, recommended:** the four `RVW_` / filter reads (zero risk, immediate test
coverage) and the **F20 AutoBook path built in C# as new code**. Then the nightly chain into a
worker. The booking/rating engine last, behind an API boundary with shadow-run, once the
off-PC caller inventory is complete.

---

## 9. Decisions needed from Steve

1. ~~Legacy ClientManager writer~~ - **decided 2026-09-29:** retiring; direct writes failing
   against the view after M2 is accepted (section 4.3).
2. ~~Per-day cutoff~~ - **decided 2026-09-29:** one relative rule per schedule; Monday offset was
   a visibility hack that next-N-occurrences removes (section 2.5).
3. ~~Header vs new table~~ - **decided 2026-09-30:** 1:1 detail table keyed on the header id,
   header untouched (section 2.1).
4. **Convert-on-save** (section 4.1): on, as written? It is the only way existing rows shrink in
   this plan. Off means the estate stays as-is until F18.
5. **F18 timing:** after the estate has largely converged, or held for the F9/F10 leg model so
   `tblRouteSchedule` moves to the leg in the same pass?

---

## Appendix A — columns on `tblBulkRunSchedule` today (Urgent prod export + 2026-09 additions)

`BulkRunScheduleId`, `ScheduleId` (FK header, 2026-09-08), `Name`, `DayOfWeek`, `StartTime`,
`EndTime`, `MaxJobs`, `Region`, `ClientId`, `SpeedId`, `CutoffHours`, `CutoffDay` (2026-09-24),
`CutoffTime` (2026-09-24), `Description`, `AutoBook`, `PostcodeGroupId`, `BookPickup`,
`PickupDepotId`, `StorageState`, `DeliveryState`, `PickupRatingSpeed`, `PickupPostcodeGroupId`,
`ParentSpeedId`, `PickupBoxDiscount`, `DropOffLocationID`, `ApplyPickupCutoff`, `PickupCutoff`,
`AutoBookScanAhead`, `IsRecurringSchedule`.

## Appendix B — tables that key on the day-row id (must survive unchanged until F18)

| Table | Column | Cascade? |
| :- | :- | :- |
| `tucJobBooking` | `ScheduleID` (+ `ScheduleName`) | no FK |
| `tucJob` | `ScheduleId` (+ `ScheduleName`) | no FK |
| `tblBulkJob` | `ScheduleId` | no FK |
| `tblRouteSchedule` | `ScheduleId` | **ON DELETE CASCADE** — never delete key rows |
| `tblBulkScheduleLinehaul` | `BulkRunScheduleId` | FK |
| `BulkZoneSchedule` | `ScheduleId` | FK |
| `ShopWindow` | (FK `FK_ShopWindow_tblBulkRunSchedule`) | FK - Shopify integration; confirmed A3 6 Oct |
| `BulkPickupZoneSchedule` | `ScheduleId` (FK `FK__BulkPicku__Sched__3C2ACFCE`) | FK - collection-side zone junction; named by Kerran 7 Oct |
| `tblSchedulePostcode`, `tblSchedulePolygon`, `tblScheduleClient` | `ScheduleName` | name-keyed (F18 Risk A) — unaffected by collapse, still wrong |

## Appendix C — read-only queries to run before M2 (Urgent prod + staging; C-block also on Medical prod)

Return results as CSV or a pasted table, tenant name on each.

```sql
-- A1. Time column types per tenant. Decides the view body (§2.4).
SELECT c.name, t.name AS type_name
FROM sys.columns c JOIN sys.types t ON t.user_type_id = c.user_type_id
WHERE c.object_id = OBJECT_ID('dbo.tblBulkRunSchedule') AND c.name IN ('StartTime','EndTime','CutoffTime');

-- A2. Everything in the DB that references the day table (real blast radius).
SELECT o.type_desc, o.name,
       CASE WHEN OBJECTPROPERTY(o.object_id,'IsSchemaBound') = 1 THEN 'SCHEMABOUND' END AS bound
FROM sys.sql_expression_dependencies d JOIN sys.objects o ON o.object_id = d.referencing_id
WHERE d.referenced_id = OBJECT_ID('dbo.tblBulkRunSchedule') ORDER BY o.type_desc, o.name;

-- A3. Anything that would fight sp_rename or the view.
SELECT 'trigger' AS kind, name FROM sys.triggers WHERE parent_id = OBJECT_ID('dbo.tblBulkRunSchedule')
UNION ALL SELECT 'synonym', name FROM sys.synonyms WHERE base_object_name LIKE '%tblBulkRunSchedule%'
UNION ALL SELECT 'fk_in', name FROM sys.foreign_keys WHERE referenced_object_id = OBJECT_ID('dbo.tblBulkRunSchedule');

-- A4. Procedures that WRITE the day table (approximate, body text).
SELECT o.name FROM sys.objects o
WHERE o.type IN ('P','TR') AND OBJECT_DEFINITION(o.object_id) LIKE '%tblBulkRunSchedule%'
  AND (OBJECT_DEFINITION(o.object_id) LIKE '%INSERT%tblBulkRunSchedule%'
    OR OBJECT_DEFINITION(o.object_id) LIKE '%UPDATE%tblBulkRunSchedule%'
    OR OBJECT_DEFINITION(o.object_id) LIKE '%DELETE%tblBulkRunSchedule%');

-- A4b. Writers of the day table, tightened: the table name must follow the verb within 60 chars.
SELECT o.type_desc, o.name
FROM sys.objects o
CROSS APPLY (SELECT OBJECT_DEFINITION(o.object_id) AS body) b
WHERE o.type IN ('P','TR','FN','IF','TF')
  AND (PATINDEX('%INSERT%INTO%tblBulkRunSchedule%', b.body) > 0
       AND PATINDEX('%tblBulkRunSchedule%', SUBSTRING(b.body, PATINDEX('%INSERT%INTO%tblBulkRunSchedule%', b.body), 60)) > 0
    OR PATINDEX('%UPDATE%tblBulkRunSchedule%', b.body) > 0
       AND PATINDEX('%tblBulkRunSchedule%', SUBSTRING(b.body, PATINDEX('%UPDATE%tblBulkRunSchedule%', b.body), 60)) > 0
    OR PATINDEX('%DELETE%FROM%tblBulkRunSchedule%', b.body) > 0
       AND PATINDEX('%tblBulkRunSchedule%', SUBSTRING(b.body, PATINDEX('%DELETE%FROM%tblBulkRunSchedule%', b.body), 60)) > 0)
  AND b.body NOT LIKE '%tblBulkRunScheduleHeader%' + REPLICATE('_', 0);   -- header/override/junction tables are fine; eyeball the result

-- B1b. Collapse readiness with the RELATIVE cutoff rule (replaces B1's CutoffVariesByDay).
--      Rule per row = legacy CutoffHours (hours before StartTime). Monday-only outliers are the
--      visibility offset and are reconciled, not refused.
;WITH r AS (
  SELECT s.ScheduleId, s.DayOfWeek, s.CutoffHours, s.StartTime, s.EndTime
  FROM dbo.tblBulkRunSchedule s
  JOIN dbo.tblBulkRunScheduleHeader h ON h.ScheduleId = s.ScheduleId AND h.RetiredUtc IS NULL),
v AS (
  SELECT ScheduleId,
         COUNT(*) AS Rows_, COUNT(DISTINCT DayOfWeek) AS Days_,
         COUNT(DISTINCT CONCAT(StartTime,'|',EndTime)) AS Windows_,
         COUNT(DISTINCT CASE WHEN DayOfWeek <> 1 THEN ISNULL(CutoffHours,-1) END) AS NonMonCutoffs_,
         MAX(CASE WHEN DayOfWeek = 1 THEN CutoffHours END) AS MonCutoff_,
         MAX(CASE WHEN DayOfWeek <> 1 THEN CutoffHours END) AS OtherCutoff_,
         SUM(CASE WHEN CutoffHours IS NULL THEN 1 ELSE 0 END) AS CutoffNull_
  FROM r GROUP BY ScheduleId)
SELECT COUNT(*) AS Headers,
  SUM(CASE WHEN Rows_ > Days_ THEN 1 ELSE 0 END) AS DuplicateDay,
  SUM(CASE WHEN Windows_ > 1 THEN 1 ELSE 0 END) AS WindowVariesByDay,
  SUM(CASE WHEN NonMonCutoffs_ > 1 THEN 1 ELSE 0 END) AS CutoffRuleVaries_TueToSun,
  SUM(CASE WHEN NonMonCutoffs_ <= 1 AND MonCutoff_ IS NOT NULL AND OtherCutoff_ IS NOT NULL
            AND MonCutoff_ <> OtherCutoff_ THEN 1 ELSE 0 END) AS MondayVisibilityOffset_Reconciled,
  SUM(CASE WHEN CutoffNull_ > 0 THEN 1 ELSE 0 END) AS CutoffNull,
  SUM(CASE WHEN Rows_ = Days_ AND Windows_ = 1 AND NonMonCutoffs_ <= 1 AND CutoffNull_ = 0 THEN 1 ELSE 0 END) AS CollapsibleNow
FROM v;

-- B1. Collapse readiness per header, after F1 fold + F11 backfill (the dry run in one query).
--     NOTE 6 Oct: CutoffVariesByDay_AfterF11 here counts ABSOLUTE CutoffDay differences, which a
--     Mon-Fri schedule always has. Use B1b for the readiness number; keep B1 for the other columns.
;WITH v AS (
  SELECT s.ScheduleId,
         COUNT(*) AS Rows_, COUNT(DISTINCT s.DayOfWeek) AS Days_,
         COUNT(DISTINCT CONCAT(s.StartTime,'|',s.EndTime)) AS Windows_,
         COUNT(DISTINCT CONCAT(s.CutoffDay,'|',s.CutoffTime)) AS CutoffPair_,
         SUM(CASE WHEN s.CutoffDay IS NULL THEN 1 ELSE 0 END) AS CutoffUnclean_,
         COUNT(DISTINCT CONCAT(s.MaxJobs,'|',s.Region,'|',s.SpeedId,'|',s.Description,'|',s.AutoBook,'|',
               s.PostcodeGroupId,'|',s.BookPickup,'|',s.PickupDepotId,'|',s.StorageState,'|',s.DeliveryState,'|',
               s.PickupRatingSpeed,'|',s.PickupPostcodeGroupId,'|',s.ParentSpeedId,'|',s.PickupBoxDiscount,'|',
               s.DropOffLocationID,'|',s.ApplyPickupCutoff,'|',s.PickupCutoff,'|',s.AutoBookScanAhead,'|',
               s.IsRecurringSchedule)) AS OtherPayload_
  FROM dbo.tblBulkRunSchedule s
  JOIN dbo.tblBulkRunScheduleHeader h ON h.ScheduleId = s.ScheduleId AND h.RetiredUtc IS NULL
  GROUP BY s.ScheduleId)
SELECT COUNT(*) AS Headers,
  SUM(CASE WHEN Rows_ > Days_ THEN 1 ELSE 0 END)      AS DuplicateDay,
  SUM(CASE WHEN Windows_ > 1 THEN 1 ELSE 0 END)       AS WindowVariesByDay,
  SUM(CASE WHEN CutoffPair_ > 1 THEN 1 ELSE 0 END)    AS CutoffVariesByDay_AfterF11,
  SUM(CASE WHEN CutoffUnclean_ > 0 THEN 1 ELSE 0 END) AS CutoffUnclean,
  SUM(CASE WHEN OtherPayload_ > 1 THEN 1 ELSE 0 END)  AS OtherPayloadVaries,
  SUM(CASE WHEN Rows_ = Days_ AND Windows_ = 1 AND CutoffPair_ = 1 AND CutoffUnclean_ = 0 AND OtherPayload_ = 1
           THEN 1 ELSE 0 END) AS CollapsibleNow,
  SUM(Rows_) AS DayRows
FROM v;

-- B2. Day-mask distribution.
SELECT WeekDays, COUNT(*) FROM (
  SELECT s.ScheduleId,
         (SELECT STRING_AGG(CASE WHEN EXISTS (SELECT 1 FROM dbo.tblBulkRunSchedule x WHERE x.ScheduleId = s.ScheduleId AND x.DayOfWeek = d.n) THEN '1' ELSE '0' END, '')
                 WITHIN GROUP (ORDER BY d.n) FROM (VALUES (1),(2),(3),(4),(5),(6),(7)) d(n)) AS WeekDays
  FROM dbo.tblBulkRunSchedule s GROUP BY s.ScheduleId) m
GROUP BY WeekDays ORDER BY COUNT(*) DESC;

-- C1. F17: junction bindings per route vs distinct schedules on the route's bookings.
SELECT r.RouteId, r.Name, r.Active,
       (SELECT COUNT(*) FROM dbo.tblRouteSchedule rs WHERE rs.RouteId = r.RouteId) AS BoundSchedules,
       (SELECT COUNT(DISTINCT b.ScheduleID) FROM dbo.tucJobBooking b WHERE b.RouteId = r.RouteId) AS BookingSchedules,
       (SELECT COUNT(*) FROM dbo.tucJobBooking b WHERE b.RouteId = r.RouteId) AS Bookings
FROM dbo.Routes r ORDER BY BoundSchedules DESC;

-- C2. F17: bindings that no longer resolve to a live day row.
SELECT rs.* FROM dbo.tblRouteSchedule rs
LEFT JOIN dbo.tblBulkRunSchedule s ON s.BulkRunScheduleId = rs.ScheduleId
LEFT JOIN dbo.tblBulkRunScheduleHeader h ON h.ScheduleId = s.ScheduleId
WHERE s.BulkRunScheduleId IS NULL OR h.RetiredUtc IS NOT NULL;

-- C4. F17 live reproduction (staging, Kevin): Urgent Prod shows no route with more than three
--     bound schedules, so the "breaks above ~3" report cannot be seen in data. Bind a 4th and a 5th
--     schedule to Route 1 (Waikato Outer) on staging via the Routes editor, capture the HTTP
--     response and server log on save, then re-run C1 and:
SELECT rs.RouteId, rs.ScheduleId, s.ScheduleId AS HeaderId, s.Name, s.DayOfWeek
FROM dbo.tblRouteSchedule rs
JOIN dbo.tblBulkRunSchedule s ON s.BulkRunScheduleId = rs.ScheduleId
WHERE rs.RouteId = 1 ORDER BY rs.ScheduleId;
--     Two things to check while doing it: (a) the schedule picker (GetSchedulesLookupAsync) filters
--     out every schedule with AutoBook = 1, so "Book immediately" schedules cannot be bound at all -
--     if the schedules ops wanted were AutoBook, that is the whole symptom; (b) if the save fails,
--     capture the PK (RouteId, ScheduleId) violation or other error. If it succeeds and the picker
--     showed the schedule, the symptom was on the legacy page and F17 closes with the F18 re-key.

-- C5. F17 (Medical Prod): for Route 5, every schedule its bookings use - is it bound, is it AutoBook?
--     If the unbound ones are all AutoBook = 1, the Routed Ops picker is hiding them (fix: drop the
--     AutoBook filter in GetSchedulesLookupAsync). If they are not AutoBook, ops are linking through the
--     single-pointer Configurator editor and the junction never sees them.
SELECT b.ScheduleID AS DayRowId, s.ScheduleId AS HeaderId, s.Name, s.DayOfWeek, s.AutoBook,
       CASE WHEN rs.ScheduleId IS NULL THEN 0 ELSE 1 END AS BoundToRoute5,
       COUNT(*) AS Bookings
FROM dbo.tucJobBooking b
LEFT JOIN dbo.tblBulkRunSchedule s ON s.BulkRunScheduleId = b.ScheduleID
LEFT JOIN dbo.tblRouteSchedule rs ON rs.RouteId = 5 AND rs.ScheduleId = b.ScheduleID
WHERE b.RouteId = 5
GROUP BY b.ScheduleID, s.ScheduleId, s.Name, s.DayOfWeek, s.AutoBook, rs.ScheduleId
ORDER BY Bookings DESC;

-- C3. F17: resolver outcomes, last 14 days, by route.
SELECT ResolvedRouteId, Outcome, Side, COUNT(*) AS N
FROM dbo.RouteAutoAssignLog
WHERE CreatedAtUtc >= DATEADD(DAY, -14, SYSUTCDATETIME())
GROUP BY ResolvedRouteId, Outcome, Side ORDER BY ResolvedRouteId, N DESC;
```
