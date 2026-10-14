# Rating procs: resolve the zone check once per call, not once per row

_Steve Bonnici -> Kevin, 2026-10-14 (evening). Companion to `KEVIN-SCHEDULE-AVAILABILITY-PLAN-GUARD-2026-10-14`.
Must land on Urgent prod **before or with** `20261014160000_AvailabilityPlanGuardAndDirectOrigin`.
Garry reviews and runs the probe._

## Why

It happened again tonight. Urgent prod, 18:05 to 20:49 NZDT, 14 Oct: every `POST /API/UrgentAPI/Rates`
timed out at 30 s and the booking page could not price or book. Same statement as 8 Oct, same trigger (the 18:00
statistics job refreshed stats on `tblBulkRunSchedule` and `BulkZoneSchedule`, the plans recompiled, one came
out bad). Performance Insights for 19:45 to 20:45:

| statement | execs/s | reads/exec | note |
|---|---|---|---|
| `INSERT INTO @ClientNextAvailableBulkRunScheduleTemp` (cross-region block of `UTL_fncJob_GetClientAvailableBulkRunSchedule`) | 0.03 | ~12 M | baseline yesterday ~42 k |
| `IF EXISTS(SELECT * FROM tblBulkRunSchedule s ...)` = the body of `UTL_fncBulkZonePostcode_IsActive` | 2,060 | 41 | per-row scalar, second heaviest statement on the server |

Garry cleared it at 20:44 with `UPDATE STATISTICS dbo.tblBulkRunSchedule WITH FULLSCAN, PERSIST_SAMPLE_PERCENT = ON`.
The full-scan stats migration `20261009110000` was already live on Urgent prod and did not prevent it. Stats
are mitigation. The fix is to stop calling a scalar function per candidate row.

Your `20261014160000` already does this inside the availability function (`@ZoneActiveSchedules`, resolved once,
then `EXISTS`). Its own comment says it deliberately left the rating procedures alone. This spec is the rating
procedures. Garry's count: the scalar ran about 92 million times in three days, and the 60-day horizon in your
migration multiplies the rows that still reach it by roughly 8.7x. That is why the ordering matters.

## What the scalar actually answers

`UTL_fncBulkZonePostcode_IsActive(@ScheduleId, @PostCode)` (latest emit `20261007160000_ZoneFunctions_SourceControlSnapshot`):

```sql
IF EXISTS(
    SELECT * FROM tblBulkRunSchedule s
    INNER JOIN BulkZoneSchedule zs ON s.BulkRunScheduleId = zs.ScheduleId
    INNER JOIN BulkZonePostcode p ON p.Zone = zs.Zone AND ISNULL(p.PostcodeGroupId,0) = ISNULL(s.PostcodeGroupId,0)
    WHERE s.BulkRunScheduleId = @ScheduleId AND zs.Active = 1
      AND p.Zone = zs.Zone AND p.DepotId = s.Region AND p.PostCode = @PostCode)
    RETURN 1
RETURN 0
```

Inside a rating proc the second argument is the proc's `@ToPostCode`, constant for the whole call. So "which
schedules are active for this postcode" is a set, resolvable once. Every call site below is a membership test
against that set.

## Call sites (latest emit of each proc on master at the time of writing; re-check at build time)

| proc | latest emit | calls | where |
|---|---|---|---|
| `WS_stpJobType_Rates` | `20260908154525_ScheduleDepotFilter` | 3 | `Rate` CASE, `SaleRate` CASE, `Availability` CASE |
| `WS_stpJob_Scheduler_Rates` | `20260818182434_ClientReferenceExpansion` | 3 | same three branches |
| `DD_stpJob_Scheduler_Rates` | `20260917130000_FixExceleratorRateArgCountRegression` | 1 | `Availability` CASE, called with `@ToZipCode` |
| `WS_stpJob_Insert` | `20261009175000_ScheduleOriginDirect_SingleJobKeepsBookingAddress` | 0 | reaches it through the rates procs only |

Garry named `WS_stpJob_Insert`. Its latest emit has no direct call, so it is covered by fixing the two WS rates
procs. **To confirm** before you start: grep `UTL_fncBulkZonePostcode_IsActive` across `DatabaseScripts/Migrations`
on master and take the newest emit of every proc or function that is not one of the two availability functions.

## Fix 1: `WS_stpJobType_Rates` and `WS_stpJob_Scheduler_Rates` (identical change)

Both procs already build `@ClientAvailableSchedule` (from the availability function) and `@BulkZones`
(`BulkZonePostcode` rows for `@ToPostCode` joined to those schedules on region and postcode group), and the
main SELECT already does `INNER JOIN @BulkZones z ON s.BulkRunScheduleId = z.BulkRunScheduleId`. The scalar
adds one thing `@BulkZones` does not have: the zone must be **active on the schedule** in `BulkZoneSchedule`.

**1a. Declare and fill the set once, next to `@BulkZones`.** Use the scalar's own body so the semantics are
provably identical, the same way you did in `20261014160000`:

```sql
DECLARE @ZoneActiveSchedules TABLE (BulkRunScheduleId int PRIMARY KEY)

-- after INSERT INTO @BulkZones ...
INSERT INTO @ZoneActiveSchedules (BulkRunScheduleId)
SELECT DISTINCT s.BulkRunScheduleId
FROM tblBulkRunSchedule s
INNER JOIN BulkZoneSchedule zs ON s.BulkRunScheduleId = zs.ScheduleId
INNER JOIN BulkZonePostcode p ON p.Zone = zs.Zone
    AND ISNULL(p.PostcodeGroupId, 0) = ISNULL(s.PostcodeGroupId, 0)
WHERE zs.Active = 1
  AND p.DepotId = s.Region
  AND p.PostCode = @ToPostCode
```

If you would rather scope it to the client's schedules only, `FROM @BulkZones z INNER JOIN BulkZoneSchedule zs
ON zs.ScheduleId = z.BulkRunScheduleId AND zs.Zone = z.Zone AND zs.Active = 1` gives the same answer for every
row the main SELECT can produce, because `z` is already an inner join there. Either is fine. Pick one and use
it in both procs.

**1b. Join it in the main SELECT**, after the existing `@BulkZones` join:

```sql
INNER JOIN @ClientAvailableSpeed A ON A.SpeedID = tblJobType.JobTypeID
LEFT  JOIN @ClientAvailableSchedule s ON s.SpeedId = tblJobType.JobTypeID
INNER JOIN @BulkZones z ON s.BulkRunScheduleId = z.BulkRunScheduleId
LEFT  JOIN @ZoneActiveSchedules za ON za.BulkRunScheduleId = s.BulkRunScheduleId   -- new
```

**1c. Replace the three predicates.** NULL behaviour is preserved: the scalar returns 0 for a NULL
`BulkRunScheduleId`, and `za.BulkRunScheduleId` is NULL for the same rows.

```sql
-- Rate and SaleRate branches, today:
WHEN ISNULL(tblJobType.ZoneRated,0) > 0 AND [dbo].[UTL_fncBulkZonePostcode_IsActive](S.BulkRunScheduleId, @ToPostCode) = 1 THEN
-- becomes:
WHEN ISNULL(tblJobType.ZoneRated,0) > 0 AND za.BulkRunScheduleId IS NOT NULL THEN

-- Availability branch, today:
WHEN ISNULL(A.UseSchedules, 0) > 0 AND ISNULL(tblJobType.ZoneRated,0) > 0
     AND (ISNULL(S.BulkRunScheduleId,0) = 0 OR [dbo].[UTL_fncBulkZonePostcode_IsActive](S.BulkRunScheduleId, @ToPostCode) = 0) THEN N'Unavailable'
-- becomes:
WHEN ISNULL(A.UseSchedules, 0) > 0 AND ISNULL(tblJobType.ZoneRated,0) > 0
     AND za.BulkRunScheduleId IS NULL THEN N'Unavailable'
```

(`ISNULL(S.BulkRunScheduleId,0) = 0` collapses into `za IS NULL`, since a NULL schedule can never be in the set.)

Nothing else in either proc changes. Re-emit each from its latest emitter on master at build time, not from
the files named above if something newer has landed.

## Fix 2: `DD_stpJob_Scheduler_Rates` (US)

One call, in the `Availability` CASE, and it passes `@ToZipCode` into a function that looks up
`BulkZonePostcode.PostCode`, an NZ table. On a US tenant that can only ever return 0, so a zone-rated speed with
`UseSchedules` on reads `Unavailable` regardless. **To confirm with Garry** whether any US tenant has
`tblJobType.ZoneRated > 0`; I expect not, which makes this dead code that still costs a scalar call per row.

Do the same shape as Fix 1 but against the US tables, which is what the proc already uses for `@BulkZones`
(`ZoneZip`). If you confirm no US tenant is zone-rated, the simpler, honest change is to drop the scalar term
and leave `ISNULL(S.BulkRunScheduleId,0) = 0` as the only `Unavailable` condition. Write which one you chose in
the migration header.

## Fix 3: close the function to new callers

Separate, later migration, once grep on master shows no caller outside superseded emits:
drop `UTL_fncBulkZonePostcode_IsActive`. Until then leave it alone; `20261014160000` says the same.
If you prefer to keep a helper for ad-hoc use, re-create it as an inline table-valued function
(`RETURNS TABLE AS RETURN SELECT 1 AS IsActive WHERE EXISTS (...)`) so the optimiser can inline it, and never a
scalar again.

## Migration shape

One migration, `2026101417xxxx_RatingProcs_SetBasedZoneCheck.sql` or similar, applied to Urgent prod
**before** `20261014160000` or in the same pipeline run ahead of it. Sections:

1. Header: why (link this doc and `20261009110000`), the three procs, the chosen variant for Fix 1 and Fix 2.
2. `CREATE OR ALTER` the three procs.
3. Stats guard, same block as the plan-guard spec, so the re-emit does not itself expose a fresh plan:

```sql
UPDATE STATISTICS dbo.BulkZoneSchedule          WITH FULLSCAN, PERSIST_SAMPLE_PERCENT = ON;
UPDATE STATISTICS dbo.tblBulkRunScheduleDay     WITH FULLSCAN, PERSIST_SAMPLE_PERCENT = ON;  -- tblBulkRunSchedule is a view after 20261009177000
UPDATE STATISTICS dbo.tblBulkRunScheduleDetail  WITH FULLSCAN, PERSIST_SAMPLE_PERCENT = ON;
UPDATE STATISTICS dbo.BulkZonePostcode          WITH FULLSCAN, PERSIST_SAMPLE_PERCENT = ON;
EXEC sp_recompile N'dbo.WS_stpJobType_Rates';
EXEC sp_recompile N'dbo.WS_stpJob_Scheduler_Rates';
EXEC sp_recompile N'dbo.DD_stpJob_Scheduler_Rates';
```

   If this lands on a tenant before the collapse batch, `tblBulkRunSchedule` is still a table there; guard the
   statement with `IF OBJECT_ID('dbo.tblBulkRunScheduleDay','U') IS NOT NULL ... ELSE ...`.
4. Warm-and-time probe, same as yours: call `WS_stpJobType_Rates` for a known Urgent client and postcode, PRINT the
   elapsed ms, `@FailOnSlowProbe = 0` for now.

## Timing

- Urgent staging first, with `20261014160000` in the same run (George runs the manual `urgent-staging` job).
- Urgent prod outside 15:00 to 21:00 NZDT, and not until this is in. The booking page has now failed twice in
  the 18:00 to 21:00 window; do not give it a third plan flush in that window.
- Garry is building a targeted alarm on this tomorrow (15 Oct). That is the safety net, not a reason to wait.

## Not yours, noted so nobody waits on you

- The 18:00 SQL Agent statistics job and whether its sampled refresh on these four tables should be excluded
  once PERSIST_SAMPLE_PERCENT is on everywhere: Garry.
- The alarm: Garry.
- Application code: checked 15 Oct. No app repo (DespatchWeb, API, Booking, Configurator, Hub, Routed Ops,
  AdminManager) references `UTL_fncBulkZonePostcode_IsActive`. The only non-SQL hits are prose strings in
  dfrnt-ops docs and the proposed MCP tools, none of which execute it. It is SQL-only. Attributing every real
  call line on master to its enclosing object gives exactly four callers: the three rating procs above and
  `UTL_fncJob_GetClientAvailableBulkRunSchedule` (which your 20261014160000 already fixes). `UCL_fncT_GetBulkZone`
  shares the snapshot file but does not call it.

## Acceptance

1. On Urgent prod, Performance Insights no longer lists the `IF EXISTS(SELECT * FROM tblBulkRunSchedule s ...)`
   statement (sql id `7B1CC4976DF094D01FE4FE8D13A1239FF53DD1A8`) in top SQL during a 19:00 to 21:00 window.
2. `WS_stpJobType_Rates` output is row-for-row identical before and after for: an Urgent client with a
   zone-rated speed and an active zone for the postcode; the same client with the zone set inactive in
   `BulkZoneSchedule`; a postcode outside every zone; a speed with `UseSchedules = 0`. Staging, your test
   clients, paste the four result sets or a diff into the MR.
3. Rates timeouts in the booking log (`/aws/eks/urgent-couriers-hosting/booking-618-urgent-prod`, filter
   `"Execution Timeout Expired"`) are zero across the first 18:00 stats run after deploy. Steve checks that one.
