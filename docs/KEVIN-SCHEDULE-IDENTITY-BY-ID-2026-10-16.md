# Schedule identity: resolve by ScheduleId everywhere, never by name

**For:** Kevin Chen · **From:** Steve Bonnici · **Date:** 16 Oct 2026 · **Status:** decided, build with and after the 6.2 / 6.3 re-emit
**Repos:** dbmigrationsv2 (master) + routed-operations (develop) · **Baseline:** latest emitter of each object on master at build time

## 1. Rule

A schedule is identified by `tblBulkRunScheduleHeader.ScheduleId` (header PK) or, where a day row is
genuinely meant, `tblBulkRunSchedule.BulkRunScheduleId`. **No SQL object, junction table or
application path resolves a schedule from its name.** `Name` is a label. It may be stamped on jobs,
bookings, logs and exports for people to read; it is never joined back to find the schedule.

Why now: Kevin's 16 Oct finding that `tblSchedulePostcode` is keyed on `ScheduleName`, which blocks
6.3 and repeats the coupling `20261009176000` had to repair (two headers drifted from their day rows
when a client was renamed Lima to Enovis). Steve, 16 Oct: all places that match on schedule name are
to be updated to match on schedule id.

## 2. Inventory, as of master 16 Oct (Kevin confirms with the sweep in section 4)

### Resolves by name today: fix

| # | Where | What it does | Fix |
|---|---|---|---|
| 1 | `dbo.tblSchedulePostcode (ScheduleName, PostCode)`, created `20260825120000`; Routed Ops `ScheduleService` (counts, read, copy, `SyncPostcodesAsync`) | Junction keyed on the header name | Re-key to `ScheduleId int NOT NULL` with FK to `tblBulkRunScheduleHeader(ScheduleId)` ON DELETE CASCADE, PK `(ScheduleId, PostCode)`; drop `ScheduleName`. Empty on Urgent prod, so no data move; on any tenant with rows, migrate by joining the header name once and fail the migration on an unmatched name. App: entity plus the five `ScheduleService` sites read and write `ScheduleId`. Order: migration adds the column, app switches, second migration drops the name column. Keep `PostCode int` (US has no zone gate). |
| 2 | `dbo.uspPrebookSet`, latest emitter `20260922120000`, six sites `WHERE h.Name = @CurScheduleName` | Prebook rows carry a schedule name and the proc resolves the header by it | The prebook source rows carry `ScheduleId` (column to confirm on the prebook table; add it if absent, backfill by name once, fail on unmatched). The six sites become `WHERE h.ScheduleId = @CurScheduleId`. Same re-emit as the 6.2 keeper rule, so prebook is touched once. |
| 3 | `dbo.UTL_stpJobBooking_InsertSchedule`, latest emitter `20261009164000` (US schedule path): `OUTER APPLY ... WHERE Name = tblJobBooking.ScheduleName AND DayOfWeek = @TargetIsoDayOfWeek AND (ClientId = ... OR ClientId IS NULL) ORDER BY ClientId DESC` | Resolves the day row from the booking's schedule name | `tblJobBooking` already has `ScheduleId int NULL` (`TucJobBooking.cs:293`). Resolve `WHERE s.ScheduleId = tblJobBooking.ScheduleId AND DayOfWeek = @TargetIsoDayOfWeek`; confirm the booking app writes `ScheduleId` on every path that writes `ScheduleName`, then drop the name predicate. The client tie-break goes with it: a header id is already unique. |
| 4 | `WS_` / `DD_stpBulkScheduleJob_Insert` and `_InsertChildJobs` family, latest emitters `20261009175000` and `20261009163000`: `@CTScheduleName = ScheduleName` read off the insert row, then `WHERE Name = @IPScheduleName` | Bulk-import and Shopify path resolves the schedule from `tblJob_BulkInsert.ScheduleName` / `tblBulkJob.ScheduleName` (`20260316173421` added the pass-through) | Carry the id: `tblJob_BulkInsert.ScheduleId` and `tblBulkJob.ScheduleId` (header id; `BulkImportJobFactory` already holds `request.ScheduleId`, which is a day-row id, so pick one and name it honestly; columns to confirm). Procs take `@IPScheduleId` and resolve by it; accept the name for one release where the id is NULL, write each fallback to `tblMigrationCheckLog`, then drop the fallback. |

### Name used as a label only: keep

`tucJob.ScheduleName`, `tucJobArchive.ScheduleName`, `tblBulkJob.ScheduleName` and
`tblJob_BulkInsert.ScheduleName` as display, the `@ScheduleName` parameters that stamp those columns,
`AutoAssignLogService`, the historic archive import, `BulkJobDto` labels, and DESWEB queries that
print the name. These stay; they stop being the key.

### Already done

`tblScheduleClient` re-keyed on 8 Sep (column renamed 9 Sep). `tblSchedulePolygon` dropped by
`20261007180000`. Both availability functions (`20261014160000`) and the three rating procs
(`20261015140000`) have no name matching. The compat view takes `Name` from the header
(`20261009177000`), so the day-row copy is derived, not stored twice.

## 3. Order

1. Row 2 lands with the 6.2 keeper re-emit (same proc, same migration).
2. Row 1 lands with 6.3, since the bound-postcode half needs the id key: migration, app, drop-column migration.
3. Rows 3 and 4 as one follow-on: app writes ids, procs resolve by id with a one-release name fallback, then a final migration removes the fallback and the sweep in section 4 must come back with label uses only.

## 4. Sweep (Kevin, both tenants, read-only; this is also the acceptance test)

```sql
-- modules that mention a schedule name
SELECT o.type_desc, OBJECT_SCHEMA_NAME(o.object_id) AS sch, o.name
FROM sys.sql_modules m JOIN sys.objects o ON o.object_id = m.object_id
WHERE m.definition LIKE '%ScheduleName%'
   OR m.definition LIKE '%Name = @%ScheduleName%'
   OR m.definition LIKE '%.Name = %ScheduleName%'
ORDER BY o.type_desc, o.name;

-- tables that carry one
SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE COLUMN_NAME LIKE '%ScheduleName%'
ORDER BY TABLE_NAME;
```

Classify every hit as label (keep) or resolver (fix) and append the list to section 2 before
building. Application side: search routed-operations develop and despatchweb for `ScheduleName ==`
and `.ScheduleName)` and classify the same way.

## 5. Acceptance

- Rename a schedule on staging in Schedules NEW. Booking, prebook, bulk import, Shopify and the US schedule booking path all still land on the same schedule, and its bound postcodes still apply.
- The section 4 sweep on Urgent and Medical staging returns only the label uses listed in section 2.
- A repeat of `20261009176000` cannot change behaviour: a header-name edit changes what people read and nothing else.
