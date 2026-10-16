# Schedule identity: resolve by ScheduleId everywhere, never by name

**For:** Kevin Chen · **From:** Steve Bonnici · **Date:** 16 Oct 2026 · **Status:** decided 16 Oct; Kevin's sweep folded in 17 Oct (section 2a); two decisions pending in section 6
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
| 2 | `dbo.uspPrebookSet`, latest emitter `20260922120000`, six sites `WHERE h.Name = @CurScheduleName` | Prebook rows carry a schedule name and the proc resolves the header by it | **Header route (Kevin, 16 Oct).** The booking tables carry a day-row id (`tblBulkRunSchedule.BulkRunScheduleId`), not a header id: on Urgent prod 60 of 76 stamped bookings match a day row with the name agreeing, and the other 16 match a header id by numeric collision with the name agreeing on none. So the six sites resolve the stored day-row id to its header first (`SELECT ScheduleId FROM tblBulkRunSchedule WHERE BulkRunScheduleId = @CurBulkRunScheduleId`), then match day rows on that header, which is exactly today's set-of-day-rows behaviour under a name. Zero name-only rows exist, so the name predicate drops with no backfill. Same re-emit as the 6.2 keeper rule. Note the smaller truth: only 4 of 822 live recurring bookings carry a schedule at all (section 6, decision A). |
| 3 | `dbo.UTL_stpJobBooking_InsertSchedule`, latest emitter `20261009164000` (US schedule path): `OUTER APPLY ... WHERE Name = tblJobBooking.ScheduleName AND DayOfWeek = @TargetIsoDayOfWeek AND (ClientId = ... OR ClientId IS NULL) ORDER BY ClientId DESC` | Resolves the day row from the booking's schedule name | `tblJobBooking.ScheduleId` and `tucJobBooking.ScheduleID` hold a **day-row id** (Kevin, 16 Oct; see row 2), so NOT `WHERE s.ScheduleId = tblJobBooking.ScheduleId`, which would bind the 16 colliding rows to the wrong schedule. Header route: resolve the stored day-row id to its header `ScheduleId`, then `WHERE s.ScheduleId = @HeaderId AND DayOfWeek = @TargetIsoDayOfWeek`. Confirm the booking app writes the id on every path that writes `ScheduleName`, then drop the name predicate and the client tie-break. No write-path change: the booking keeps carrying the day-row id it has today, and the spec names it as such. |
| 4 | `WS_` / `DD_stpBulkScheduleJob_Insert` and `_InsertChildJobs` family, latest emitters `20261009175000` and `20261009163000`: `@CTScheduleName = ScheduleName` read off the insert row, then `WHERE Name = @IPScheduleName` | Bulk-import and Shopify path resolves the schedule from `tblJob_BulkInsert.ScheduleName` / `tblBulkJob.ScheduleName` (`20260316173421` added the pass-through) | Carry the id: `tblJob_BulkInsert.ScheduleId` and `tblBulkJob.ScheduleId` (header id; `BulkImportJobFactory` already holds `request.ScheduleId`, which is a day-row id, so pick one and name it honestly; columns to confirm). Procs take `@IPScheduleId` and resolve by it; accept the name for one release where the id is NULL, write each fallback to `tblMigrationCheckLog`, then drop the fallback. |
| 4a | `WS_stpJob_Insert` and `DD_stpJob_InsertExcelerator`: `WHERE Name = @IPScheduleName` (Kevin's sweep, 16 Oct) | The single-job booking procs; these are the ones actually using the `@IPScheduleName` predicate, while the four `stpBulkScheduleJob` procs in row 4 match on `ScheduleName` read off the insert row | Same treatment as row 4: take the id, resolve by it, one-release name fallback logged, then drop. Three of the label-only procs already take a `@ScheduleID` parameter beside the name, so the parameter shape exists. |
| 4b | `UTL_stpJob_InsertFromTblBulkJob`: resolves on `ScheduleName` (Kevin's sweep) | Bulk-job to job insert | With row 4: carry `tblBulkJob.ScheduleId` and resolve by it. |
| 5 | DespatchWeb `RecurringJobRepository.cs:534`: `.Where(s => s.Name == meta.ScheduleName && (s.ClientId == clientId \|\| s.ClientId == null))` (Kevin's sweep) | Loads a recurring template's bookable days by schedule name with the same client tie-break as row 3; a renamed schedule silently changes which days a template may book | One line: `meta.ScheduleId` is already in the guard above it. Repo despatchweb (GitHub mirror `despatchwebchanges`); owner and ordering in section 6, decision B. DespatchWeb production deploy is a manual pipeline gate. |
| 6 | `tblScheduleClient.ScheduleName` column | Leftover from the 8 Sep re-key; nothing resolves on it, next one to drift | Drop it in the same migration that re-keys `tblSchedulePostcode` (row 1). |

### Name used as a label only: keep

`tucJob.ScheduleName`, `tucJobArchive.ScheduleName`, `tblBulkJob.ScheduleName` and
`tblJob_BulkInsert.ScheduleName` as display, the `@ScheduleName` parameters that stamp those columns,
`AutoAssignLogService`, the historic archive import, `BulkJobDto` labels, and DESWEB queries that
print the name. These stay; they stop being the key.

Kevin's module sweep (16 Oct, identical on Urgent prod and Medical prod, 17 objects): nine resolve by name (rows 2, 3, 4 x4, 4a x2, 4b) and eight carry it as a label only: `DD_stpJob_Excelerator_Insert`, `DD_stpJob_InsertNationwide`, `DD_stpJob_NationWideFlight_Insert`, `UTL_stpJob_BulkInsert`, `UTL_stpJob_BulkInsert_Nationwide`, `UTL_stpJob_BulkInsert_Prebook`, `UTL_stpJob_tblBulkJobWithFilter`, `DESWEB_qryDespatch`. Column sweep: 25 objects on Urgent, 26 on Medical (backup tables only differ); label columns also on `tblJob_Archive`, `tblJob_Today`, `tblJobBooking`, `tucJobBooking`. Routed Ops: six `ScheduleService` sites plus the EF composite key in `DespatchContext.cs`, not five. Everything else Kevin found in DespatchWeb and WebAPI is a label.

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

## 6. Decisions still open (Kevin, 16 Oct 16:05)

**A. How prebook picks a schedule.** Of 822 live recurring bookings on Urgent prod, 4 carry a schedule id and 818 carry neither id nor name; the top twelve clients by recurring volume have none, and Zimmer's one live recurring booking (P5620T) carries no schedule. So the six-site keeper edit (6.2) is correct for the 4 and changes nothing for the 818: prebook is not choosing between schedules for them because none is bound. The 6.2 acceptance line about Zimmer's recurring jobs is therefore withdrawn. Options: (i) bind a schedule on the recurring template (data plus UI, and a decision on who sets it), or (ii) prebook resolves at run time by lane, speed and day through the same availability function the booking page uses, taking a schedule only when exactly one client-linked schedule matches and never auto-binding a default. **Recommendation: (ii) as its own item after this batch; (i) stays available as an override on the template.** Steve to confirm.

**B. Where the DespatchWeb fix (row 5) lives.** One line in `RecurringJobRepository.cs`, outside the two repos this spec named, touching recurring bookings. **Recommendation: Kevin makes the change on a despatchweb branch since he has the context, Jacob reviews and owns the manual production deploy, and it ships with the row 3 and 4 follow-on, not before.** Steve to confirm.

Decided 17 Oct: header route for rows 2 and 3 (yes); `tblScheduleClient.ScheduleName` dropped in the row 1 migration (yes); Hyper is a 6.3 case and is not in the 13-client ops review (agreed).

## Milestones

| # | Milestone | Done when |
|---|---|---|
| M1 | Sweep classified on both tenants | Section 2 lists every resolver and every label from the sys.sql_modules and column sweeps (done 16 Oct, Kevin). |
| M2 | Prebook on the header route | uspPrebookSet six sites resolve day-row id to header, no name predicate; ships in the 6.2 re-emit. |
| M3 | tblSchedulePostcode re-keyed, tblScheduleClient.ScheduleName dropped | Migration applied on staging; ScheduleService writes ScheduleId; drop-column migration follows the app. |
| M4 | US booking path on the header route | UTL_stpJobBooking_InsertSchedule resolves from the stored day-row id; no name predicate. |
| M5 | Bulk and single-job insert procs resolve by id | Rows 4, 4a, 4b take the id with a one-release name fallback logged to tblMigrationCheckLog. |
| M6 | DespatchWeb recurring-days lookup by id | RecurringJobRepository uses meta.ScheduleId; deployed through the manual production gate. |
| M7 | Fallbacks removed, sweep clean | Final migration drops the name fallbacks; the section 4 sweep returns label uses only on Urgent and Medical staging; rename test in section 5 passes. |
