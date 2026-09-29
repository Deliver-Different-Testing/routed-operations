# Schedules: collapse day rows into one record, keep the SPs working

_Steve Bonnici → Kevin, 2026-09-29. Follows the F1 / F11 / F17 / F18 work in
`KEVIN-SCHEDULES-NEW-FIXES-2026-09-20.md`. Signed off by the strategic team as a
rationalisation goal; this document is the execution plan._

Sources: Kerran's `Schedule Table` export (11,110 rows, Urgent prod, 8 Sep 2026),
the dbmigrationsv2 migrations through 2026-09-25, the routed-operations `develop`
branch on GitLab as at 2026-09-29, and a call-site inventory across the repos held
on Steve's PC (see §9 for what that inventory does and does not cover).

---

## 0. TL;DR

| | |
| :- | :- |
| **Goal** | One row per schedule with a seven-day mask, instead of one row per operating day. |
| **Size** | 11,110 day rows → ~2,750 schedule rows on Urgent prod (75% reduction). With the F1 client fold, ~2,100. |
| **Losslessness** | Only two columns genuinely vary by day: `CutoffHours` (845 schedules, of which 776 are the Monday-weekend artefact F11 already replaces) and the window `StartTime`/`EndTime` (~75 schedules). Everything else is constant per schedule. |
| **Mechanism** | Payload moves up onto `tblBulkRunScheduleHeader` (which already exists and is already the FK target of every day row since 2026-09-08). Physical day table is renamed; a **view with the old name** fans collapsed headers back out per day, **preserving every existing `BulkRunScheduleId`**. |
| **Blast radius** | 26 SPs/functions read `DayOfWeek` off the day table. None of them changes. They keep reading `dbo.tblBulkRunSchedule`, which becomes the view. |
| **Rollout** | Four phases, each reversible. New schedules write collapsed first. Existing schedules collapse **a set at a time** via a dry-run/commit procedure, driven from the Schedules NEW list. Ops sets the pace. |
| **Day mask format** | `CHAR(7)`, position 1 = Monday, `'1'`/`'0'` — the convention `tucJobBooking.ucbkDays`, `tblBulkRunScheduleOverride.WeekDays` and `uspPrebookSet` already use. Not an int bitmask; that would be a third convention. |
| **Decisions needed** | §10. |

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

---

## 2. Target shape

### 2.1 `tblBulkRunScheduleHeader` — becomes *the* schedule row

Existing: `ScheduleId` (PK), `Name`, `IsDefault`, `LegacyClientId`, `DisplayName`,
`DisplayDescription`, `IsActive`, `OverrideCount`, `OverridesVersion`, `BaseScheduleId`,
`RetiredUtc/By`, `CreatedUtc/By`.

Add:

```sql
WeekDays            CHAR(7)      NULL,   -- '1111100' Mon..Sun. NULL until collapsed.
IsCollapsed         BIT NOT NULL CONSTRAINT DF_tblBulkRunScheduleHeader_IsCollapsed DEFAULT (0),
CollapsedUtc        DATETIME2(0) NULL,
CollapsedBy         NVARCHAR(100) NULL,

-- Payload lifted from the day row. Same names, same types as the day table
-- (see 2.4 for the NZ StartTime/EndTime type trap). All NULL until collapsed.
StartTime           TIME(0)      NULL,
EndTime             TIME(0)      NULL,
MaxJobs             INT          NULL,
Region              INT          NULL,
SpeedId             INT          NULL,
CutoffHours         INT          NULL,   -- legacy carrier only; F11 Phase D drops it
CutoffDay           TINYINT      NULL,
CutoffTime          TIME(0)      NULL,
Description         NVARCHAR(500) NULL,
AutoBook            BIT          NULL,
PostcodeGroupId     INT          NULL,
BookPickup          BIT          NULL,
PickupDepotId       INT          NULL,
StorageState        INT          NULL,
DeliveryState       INT          NULL,
PickupRatingSpeed   INT          NULL,
PickupPostcodeGroupId INT        NULL,
ParentSpeedId       INT          NULL,
PickupBoxDiscount   INT          NULL,
DropOffLocationID   INT          NULL,
ApplyPickupCutoff   BIT          NULL,
PickupCutoff        INT          NULL,
AutoBookScanAhead   INT          NULL,
IsRecurringSchedule BIT          NULL,

CONSTRAINT CK_tblBulkRunScheduleHeader_WeekDays
    CHECK (WeekDays IS NULL OR (LEN(WeekDays) = 7 AND WeekDays NOT LIKE '%[^01]%')),
CONSTRAINT CK_tblBulkRunScheduleHeader_CollapsedHasMask
    CHECK (IsCollapsed = 0 OR WeekDays IS NOT NULL)
```

`ClientId` is **not** lifted; `Header.LegacyClientId` already carries it and the view emits it.
`Name` is already on the header.

### 2.2 `tblBulkRunScheduleDay` — the renamed physical day table

`sp_rename 'dbo.tblBulkRunSchedule', 'tblBulkRunScheduleDay'`. Constraints, indexes,
IDENTITY and the incoming FKs (`tblRouteSchedule`, `BulkZoneSchedule`,
`tblBulkScheduleLinehaul`) follow the rename automatically. **No id changes.**

For an **uncollapsed** header the day rows are unchanged. For a **collapsed** header the day
rows shrink to a key: `BulkRunScheduleId`, `ScheduleId`, `DayOfWeek`, `Name` (kept in sync),
`ClientId` (kept in sync); every payload column is set to NULL by the collapse procedure.
The rows stay because downstream still keys on `BulkRunScheduleId`:

- `tucJobBooking.ScheduleID`, `tucJob.ScheduleId`, `tblBulkJob` (booked day row)
- `tblRouteSchedule.ScheduleId` (representative day row — F17/F18 finding)
- `tblBulkScheduleLinehaul.BulkRunScheduleId`, `BulkZoneSchedule.ScheduleId`
- the `@UrgentScheduleSpeedID = ScheduleID * 1000 + SpeedID` packing in
  `WS_stpBulkScheduleJob_Insert` / `DD_stpBulkScheduleJob_Insert`

Until F18 remaps all of those to `Header.ScheduleId`, the day table is the id allocator.
New collapsed schedules therefore still insert one key row per masked day (§4.1).

### 2.3 View `dbo.tblBulkRunSchedule` — the compatibility surface

```sql
SET ANSI_NULLS ON; SET QUOTED_IDENTIFIER ON;
GO
CREATE OR ALTER VIEW dbo.tblBulkRunSchedule
AS
SELECT
    d.BulkRunScheduleId,
    d.ScheduleId,
    h.Name,                                          -- header is canonical
    d.DayOfWeek,
    CASE WHEN h.IsCollapsed = 1 THEN h.StartTime          ELSE d.StartTime          END AS StartTime,
    CASE WHEN h.IsCollapsed = 1 THEN h.EndTime            ELSE d.EndTime            END AS EndTime,
    CASE WHEN h.IsCollapsed = 1 THEN h.MaxJobs            ELSE d.MaxJobs            END AS MaxJobs,
    CASE WHEN h.IsCollapsed = 1 THEN h.Region             ELSE d.Region             END AS Region,
    COALESCE(d.ClientId, h.LegacyClientId)                                          AS ClientId,
    CASE WHEN h.IsCollapsed = 1 THEN h.SpeedId            ELSE d.SpeedId            END AS SpeedId,
    CASE WHEN h.IsCollapsed = 1 THEN h.CutoffHours        ELSE d.CutoffHours        END AS CutoffHours,
    CASE WHEN h.IsCollapsed = 1 THEN h.CutoffDay          ELSE d.CutoffDay          END AS CutoffDay,
    CASE WHEN h.IsCollapsed = 1 THEN h.CutoffTime         ELSE d.CutoffTime         END AS CutoffTime,
    CASE WHEN h.IsCollapsed = 1 THEN h.Description        ELSE d.Description        END AS Description,
    CASE WHEN h.IsCollapsed = 1 THEN h.AutoBook           ELSE d.AutoBook           END AS AutoBook,
    CASE WHEN h.IsCollapsed = 1 THEN h.PostcodeGroupId    ELSE d.PostcodeGroupId    END AS PostcodeGroupId,
    CASE WHEN h.IsCollapsed = 1 THEN h.BookPickup         ELSE d.BookPickup         END AS BookPickup,
    CASE WHEN h.IsCollapsed = 1 THEN h.PickupDepotId      ELSE d.PickupDepotId      END AS PickupDepotId,
    CASE WHEN h.IsCollapsed = 1 THEN h.StorageState       ELSE d.StorageState       END AS StorageState,
    CASE WHEN h.IsCollapsed = 1 THEN h.DeliveryState      ELSE d.DeliveryState      END AS DeliveryState,
    CASE WHEN h.IsCollapsed = 1 THEN h.PickupRatingSpeed  ELSE d.PickupRatingSpeed  END AS PickupRatingSpeed,
    CASE WHEN h.IsCollapsed = 1 THEN h.PickupPostcodeGroupId ELSE d.PickupPostcodeGroupId END AS PickupPostcodeGroupId,
    CASE WHEN h.IsCollapsed = 1 THEN h.ParentSpeedId      ELSE d.ParentSpeedId      END AS ParentSpeedId,
    CASE WHEN h.IsCollapsed = 1 THEN h.PickupBoxDiscount  ELSE d.PickupBoxDiscount  END AS PickupBoxDiscount,
    CASE WHEN h.IsCollapsed = 1 THEN h.DropOffLocationID  ELSE d.DropOffLocationID  END AS DropOffLocationID,
    CASE WHEN h.IsCollapsed = 1 THEN h.ApplyPickupCutoff  ELSE d.ApplyPickupCutoff  END AS ApplyPickupCutoff,
    CASE WHEN h.IsCollapsed = 1 THEN h.PickupCutoff       ELSE d.PickupCutoff       END AS PickupCutoff,
    CASE WHEN h.IsCollapsed = 1 THEN h.AutoBookScanAhead  ELSE d.AutoBookScanAhead  END AS AutoBookScanAhead,
    CASE WHEN h.IsCollapsed = 1 THEN h.IsRecurringSchedule ELSE d.IsRecurringSchedule END AS IsRecurringSchedule
FROM dbo.tblBulkRunScheduleDay d
INNER JOIN dbo.tblBulkRunScheduleHeader h ON h.ScheduleId = d.ScheduleId
WHERE h.IsCollapsed = 0
   OR SUBSTRING(h.WeekDays, d.DayOfWeek, 1) = '1';
GO
```

Properties that matter:

- **Same column list, same names, same order as the table today**, so `SELECT *` callers and
  positional temp-table inserts (the availability functions use both) are unaffected.
- **Every existing `BulkRunScheduleId` still resolves**, so bookings, route bindings and
  linehaul legs need no remap in this project.
- For a collapsed header, a day row whose mask bit is `0` **disappears from the view**. That
  is how "switch this schedule off on Fridays" works after collapse: flip the mask, do not
  delete the row. The row stays as an id anchor.
- Plain inner join on the clustered key, no aggregates, no TOP, so predicates on
  `BulkRunScheduleId`, `ScheduleId`, `DayOfWeek` and `Name` push straight through.
  `IX_tblBulkRunScheduleDay (ScheduleId, DayOfWeek)` should exist; check.
- Writable? No, and it must not be. §2.5.

### 2.4 The NZ time-type trap

`TblBulkRunSchedule.cs` in routed-operations says `StartTime`/`EndTime` are **TIME on US but
DATETIME on NZ**, and the legacy SPs paper over it with `CAST(x AS datetime)`. Before M1
runs, confirm with:

```sql
SELECT c.name, t.name FROM sys.columns c JOIN sys.types t ON t.user_type_id = c.user_type_id
WHERE c.object_id = OBJECT_ID('dbo.tblBulkRunSchedule') AND c.name IN ('StartTime','EndTime');
```

If NZ is DATETIME, the header columns are still `TIME(0)` (the correct type), and the view's
`StartTime`/`EndTime` expressions are wrapped so the view emits the **legacy type of that
tenant**: `CAST(CAST(h.StartTime AS datetime) AS datetime)` on NZ, bare on US. The migration
branches on `sys.columns` at deploy time and builds the view body with `sp_executesql`. This
keeps every NZ SP that compares `StartTime` to a datetime unchanged. The F11 migrations
already do this kind of per-tenant branching, so the pattern exists.

### 2.5 Guard trigger on the day table

Two writers exist today: Schedules NEW (`ScheduleService` in routed-operations, EF) and
the legacy ClientManager `/api/Schedules` endpoints behind the AdminManager `admin-ui`
schedules module (source not on this PC; see §9). Once a header is collapsed, a payload write
to its day rows would be silently ignored by the view. Fail loudly instead:

```sql
CREATE OR ALTER TRIGGER dbo.trg_tblBulkRunScheduleDay_GuardCollapsed
ON dbo.tblBulkRunScheduleDay
AFTER UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    IF UPDATE(StartTime) OR UPDATE(EndTime) OR UPDATE(MaxJobs) OR UPDATE(Region)
       OR UPDATE(SpeedId) OR UPDATE(CutoffHours) OR UPDATE(CutoffDay) OR UPDATE(CutoffTime)
       OR UPDATE(Description) OR UPDATE(AutoBook) OR UPDATE(PostcodeGroupId) OR UPDATE(BookPickup)
       OR UPDATE(PickupDepotId) OR UPDATE(StorageState) OR UPDATE(DeliveryState)
       OR UPDATE(PickupRatingSpeed) OR UPDATE(PickupPostcodeGroupId) OR UPDATE(ParentSpeedId)
       OR UPDATE(PickupBoxDiscount) OR UPDATE(DropOffLocationID) OR UPDATE(ApplyPickupCutoff)
       OR UPDATE(PickupCutoff) OR UPDATE(AutoBookScanAhead) OR UPDATE(IsRecurringSchedule)
    BEGIN
        IF EXISTS (SELECT 1 FROM inserted i
                   JOIN dbo.tblBulkRunScheduleHeader h ON h.ScheduleId = i.ScheduleId
                   WHERE h.IsCollapsed = 1
                     AND SESSION_CONTEXT(N'ScheduleCollapseBypass') IS NULL)
        BEGIN
            ;THROW 51000, 'Schedule is collapsed: edit tblBulkRunScheduleHeader, not the day row.', 1;
        END
    END
END
```

The collapse/uncollapse procedures set `EXEC sp_set_session_context 'ScheduleCollapseBypass', 1`
so they can null/restore payload. `tblBulkRunScheduleDay` is post-2024 in shape but is the
legacy table by identity; the trigger opens with `SET QUOTED_IDENTIFIER ON` / `SET ANSI_NULLS ON`
per the legacy-DB policy.

---

## 3. Migrations (dbmigrationsv2 conventions)

Every script: `SET ANSI_NULLS ON; SET QUOTED_IDENTIFIER ON;`, idempotent guards, GRANT
mirroring via the `sys.database_permissions` discovery pattern from
`20260908120004`, `EXEC procRefreshAllViews` wherever a table changes shape.

| # | Name | Contents | Reversible by |
| :- | :- | :- | :- |
| M1 | `…_ScheduleCollapse_HeaderPayloadColumns` | §2.1 columns + checks on `tblBulkRunScheduleHeader`. Data-free. `procRefreshAllViews`. | drop columns |
| M2 | `…_ScheduleCollapse_RenameDayTableAndCompatView` | `sp_rename` to `tblBulkRunScheduleDay`; create view `dbo.tblBulkRunSchedule` (§2.3, per-tenant time-type branch §2.4); re-issue GRANTs on both objects; `procRefreshAllViews`. **Behaviour identical**: `IsCollapsed = 0` everywhere. | drop view, rename back |
| M3 | `…_ScheduleCollapse_GuardTrigger` | §2.5 trigger. | drop trigger |
| M4 | `…_ScheduleCollapse_Procedures` | `dbo.uspScheduleCollapse @ScheduleId INT, @Commit BIT = 0` and `dbo.uspScheduleUncollapse @ScheduleId INT`. §5. | drop procs |
| M5 | `…_ScheduleCollapse_DropDayPayload` | **Only after every non-retired header is collapsed.** Drop payload columns from `tblBulkRunScheduleDay`; simplify the view to read header only. | not needed once gate met |
| M6 | F18 remap (separate project) | Repoint `tucJobBooking`, `tucJob`, `tblBulkJob`, `tblRouteSchedule`, `tblBulkScheduleLinehaul`, `BulkZoneSchedule` to `Header.ScheduleId`; retire the day table and the view. | — |

M1–M4 can ship in one release. M5 and M6 are gated.

**Coordination with in-flight work.** M2 renames the table Kevin's F11 Phase C/D and F19 SP
re-emits all reference. Nothing in those SPs changes, but the migration ordering must put M2
after the last F11/F19 SP migration in the same deploy, and the `COLLISION-REVIEWED` header
convention should name them.

---

## 4. Application changes

### 4.1 routed-operations `ScheduleService` (Schedules NEW) — the only writer we control

Today `UpsertGroupAsync` creates a header and then one `TblBulkRunSchedule` per
`req.DayWindows`, calling `ApplyGroupTemplateToRow` to stamp the shared payload on every row
(`ScheduleService.cs` ~1120–1200 on develop).

After M1–M4:

- **EF mapping.** `TblBulkRunSchedule` entity → map to **view** `tblBulkRunSchedule` for reads
  (keep the key; EF is fine with a keyed view for queries). New entity `TblBulkRunScheduleDay`
  → table, for writes. `BulkRunScheduleHeader` gains the payload properties.
  `BulkZoneSchedule`, `TblBulkScheduleLinehaul` and `Route.Schedules` FKs point at the Day
  entity (same ids).
- **Create / update** writes collapsed: payload on the header, `WeekDays` from the selected
  days, `IsCollapsed = 1`, and **one key row per masked day** in `tblBulkRunScheduleDay`
  (`Name`, `ClientId`, `ScheduleId`, `DayOfWeek` only). Unticking a day flips the mask bit;
  the key row is not deleted (its id may be on a booking).
- **Editing an uncollapsed header** in Schedules NEW: either collapse-on-save (call
  `uspScheduleCollapse` first, refuse the save with the dry-run reasons if it cannot collapse)
  or keep writing day rows. Recommend **collapse-on-save** so the estate converges without a
  separate campaign, with the refusal list telling the operator exactly what to fix.
- `ApplyGroupTemplateToRow` goes away for collapsed headers; the F8 "row 0 decides everything"
  problem disappears with it, because there is one row.
- Per-day window in the UI: the day tab stops offering a per-day start/end. If a schedule needs
  Monday 07:00–20:00 and Tue–Fri 07:00–08:00, that is two schedules. Offer "Split by window"
  in the refusal UI.
- `fnScheduleForClient` (F1 resolver) reads `s.StartTime`, `s.EndTime`, `s.CutoffHours`,
  `s.SpeedId`, `s.PostcodeGroupId`, `s.PickupPostcodeGroupId` from `tblBulkRunSchedule s` —
  it keeps working through the view; later it reads the header directly and drops the day join.

### 4.2 Schedules NEW list — the "Collapse" action

Multi-select on the list → **Dry run** → report table (per header: `CanCollapse`, `Reason`,
proposed `WeekDays`, proposed `CutoffDay/CutoffTime`, columns that differ) → **Commit** for
the ones that passed. Backed by `POST /api/v2/schedules/collapse` calling `uspScheduleCollapse`
per id with `@Commit` as chosen. Refusals link to the schedule for fixing. This is the
"set at a time" control ops asked for.

Filters that make useful sets: by client, by region (`Region`), by name prefix, by "mask =
1111100 and no variance" (the 1,600 easy ones).

### 4.3 dfrntdrive_configurator

`TenantSchedulesService`, `TenantRouteService`, `TenantLinehaulService` read
`TblBulkRunSchedule` only (no `Add`/`Remove` found). They keep working through the view.
`Route.cs` still carries the legacy `Routes.ScheduleId` single pointer; unchanged here, retired
under F18.

### 4.4 Legacy ClientManager `/api/Schedules` (AdminManager)

Writes day rows directly (POST/PUT/DELETE `/api/Schedules`, `POST /api/Schedules/AutoBook/{id}`).
Source is not on this PC. Two options: point the admin-ui schedules module at Schedules NEW's
API, or leave it and let the trigger reject edits to collapsed schedules with a clear message.
The trigger is the safety net either way. **Decision needed (§10).**

---

## 5. `uspScheduleCollapse` — one schedule, dry-run then commit

```
uspScheduleCollapse @ScheduleId INT, @Commit BIT = 0, @By NVARCHAR(100) = NULL
```

1. Load the header; refuse if retired or already collapsed.
2. Load its day rows from `tblBulkRunScheduleDay`.
3. **Checks** (all reported, any one refuses):
   - `DuplicateDay`: the same `DayOfWeek` appears more than once. Report whether the
     duplicates are identical (safe to delete the higher id) or two windows (split needed).
   - `WindowVariesByDay`: `StartTime` or `EndTime` differ across rows. Report per day. Split
     needed.
   - `PayloadVaries:<column>` for every other payload column that differs across rows
     (`Description`, `StorageState`, … — the ≤ 11-schedule cases in §1). Report the values;
     operator fixes the data or accepts the majority value (`@AcceptMajority BIT` option).
   - `CutoffUnclean`: any row with `CutoffDay IS NULL` after the F11 backfill. Report
     `CutoffHours` per day. Operator sets the absolute pair on the header explicitly.
   - `CutoffVariesByDay`: `CutoffDay`/`CutoffTime` differ across rows **after** the F11
     conversion. Genuine per-day cutoff; today that is the `CutoffException` structure F11
     describes. Refuse in v1; revisit if the count is material (expected to be near zero).
4. Compute `WeekDays` from the set of `DayOfWeek` values present.
5. `@Commit = 0`: return one row `(ScheduleId, Name, CanCollapse, Reasons, ProposedWeekDays,
   ProposedCutoffDay, ProposedCutoffTime, RowCount)` plus a detail rowset of differing columns.
6. `@Commit = 1` and `CanCollapse = 1`, in one transaction with the bypass session flag set:
   copy payload to header, set `WeekDays`, `IsCollapsed = 1`, `CollapsedUtc/By`; null the
   payload columns on the day rows; write an audit row (`ScheduleId`, before-JSON of the day
   rows) to `tblBulkRunScheduleCollapseLog` so `uspScheduleUncollapse` is exact.

`uspScheduleUncollapse @ScheduleId` reverses: restore day payload from the header (identical by
construction) or from the log, clear the header payload and mask, `IsCollapsed = 0`.

**Batch driver.** `uspScheduleCollapseBatch @Filter…, @Commit` loops headers and returns the
combined report; the Schedules NEW action calls this. Sets of 50–200 are comfortable to review.

---

## 6. Rollout

| Phase | What ships | Gate to proceed | Rollback |
| :- | :- | :- | :- |
| **A. Schema + view** | M1, M2, M3, M4. `IsCollapsed = 0` everywhere. | Staging: full regression on booking, availability, run viewer, uspPrebookSet with the view in place. Diff `SELECT * FROM tblBulkRunSchedule` before/after M2 on staging: **zero differences**. | Drop view, rename back. Minutes. |
| **B. New schedules write collapsed** | Schedules NEW upsert change (§4.1), EF mapping. | A week of new schedules on staging then prod; bookings on them behave identically. | Revert app; collapsed headers can be uncollapsed with `uspScheduleUncollapse`. |
| **C. Collapse existing, set by set** | Collapse action (§4.2). Ops runs dry-runs, fixes refusals, commits. Suggested order: (1) the ~1,600 `1111100` no-variance schedules, (2) single-day schedules, (3) 6/7-day, (4) the refusal tail. | Each set: dry run clean → commit → spot-check bookings the next morning. `uspPrebookSet` nightly output unchanged for affected clients. | Per schedule, `uspScheduleUncollapse`. |
| **D. Finish** | M5 drops day payload columns; view simplifies. | `SELECT COUNT(*) FROM tblBulkRunScheduleHeader WHERE RetiredUtc IS NULL AND IsCollapsed = 0` = 0. | — |
| **E. F18** | Remap consumers to `Header.ScheduleId`; retire day table + view. | Separate plan. | — |

---

## 7. Verification queries

```sql
-- V1. View reproduces the table exactly (run on staging around M2, before any collapse).
SELECT COUNT(*) FROM (SELECT * FROM dbo.tblBulkRunSchedule EXCEPT SELECT * FROM dbo.tblBulkRunScheduleDay) x;
SELECT COUNT(*) FROM (SELECT * FROM dbo.tblBulkRunScheduleDay EXCEPT SELECT * FROM dbo.tblBulkRunSchedule) x;

-- V2. After a collapse: every masked day still has a key row, and no unmasked day leaks.
SELECT h.ScheduleId
FROM dbo.tblBulkRunScheduleHeader h
CROSS APPLY (VALUES (1),(2),(3),(4),(5),(6),(7)) d(dow)
LEFT JOIN dbo.tblBulkRunScheduleDay r ON r.ScheduleId = h.ScheduleId AND r.DayOfWeek = d.dow
WHERE h.IsCollapsed = 1
  AND SUBSTRING(h.WeekDays, d.dow, 1) = '1'
  AND r.BulkRunScheduleId IS NULL;

-- V3. No collapsed header has payload left on a day row.
SELECT COUNT(*) FROM dbo.tblBulkRunScheduleDay d
JOIN dbo.tblBulkRunScheduleHeader h ON h.ScheduleId = d.ScheduleId
WHERE h.IsCollapsed = 1 AND (d.StartTime IS NOT NULL OR d.CutoffHours IS NOT NULL OR d.SpeedId IS NOT NULL);

-- V4. Availability unchanged for a client (run before/after collapsing that client's set).
SELECT * FROM dbo.UTL_fncJob_GetClientAvailableBulkRunSchedule(@ClientId, @SpeedId, @DateTime, @FromPostCode, @ToPostCode)
ORDER BY BulkRunScheduleId;

-- V5. Progress.
SELECT IsCollapsed, COUNT(*) Headers FROM dbo.tblBulkRunScheduleHeader WHERE RetiredUtc IS NULL GROUP BY IsCollapsed;
```

---

## 8. How this fits the open F-items

- **F1 (client deltas):** unchanged. `fnScheduleForClient` resolves against the view now and
  the header later. `tblBulkRunScheduleOverride.WeekDays` already has the same `CHAR(7)` shape,
  so a client override of days composes naturally: effective mask = override mask if present,
  else header mask.
- **F11 (cutoff):** the collapse depends on the F11 backfill having run. The `CutoffUnclean`
  refusal reason is the 603-row "unclean" set from Kevin's 24 Sep preview surfacing per schedule.
- **F17 / recurring routes:** untouched here. Binding stays on the representative day-row id
  until F18. The collapse does not delete key rows, so `tblRouteSchedule` cascade deletes cannot
  fire from this work.
- **F18 (one key):** this plan is the precondition that makes F18 mechanical. Once the header
  is the only payload holder, remapping bookings and bindings to `Header.ScheduleId` is a pure
  id swap.
- **F20 (book immediately):** nothing here blocks building the AutoBook path in C# against the
  header from day one (see §9 lift assessment).

---

## 9. Inventory: the 26 SPs/functions that read schedule day rows, and what can be lifted into EF Core

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
| `UTL_fncJob_GetClientAvailableBulkRunSchedule` | NZ client availability | none local (booking site / DespatchWeb) | `WS_stpBulkScheduleJob_Insert`, `WS_stpJob_Insert` | **After re-point** | Customer-facing; both tenants; used by SPs too. |
| `DD_fncJob_GetClientAvailableBulkRunSchedule` | US client availability | dfrnt-ops (proposed MCP tools only) | `DD_stpBulkScheduleJob_Insert`, `DD_stpJob_InsertExcelerator` | **After re-point** | As above. |
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

## 10. Decisions needed from Steve

1. **Collapse-on-save** in Schedules NEW for uncollapsed headers (recommended), or keep
   writing day rows until ops collapses explicitly?
2. **Legacy ClientManager `/api/Schedules` writer:** re-point admin-ui to Schedules NEW, or
   leave it behind the trigger?
3. **`CutoffVariesByDay` after F11 conversion:** refuse (recommended for v1) or support a
   per-day cutoff exception row?
4. **Order of sets** for Phase C, and who on the Urgent team drives it.
5. **F18 timing:** run M6 straight after Phase D, or hold until F9/F10 leg model lands so
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
| `tblSchedulePostcode`, `tblSchedulePolygon`, `tblScheduleClient` | `ScheduleName` | name-keyed (F18 Risk A) — unaffected by collapse, still wrong |
