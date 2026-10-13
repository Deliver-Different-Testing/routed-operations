# Schedule availability: guard the rates path before the collapse ships

_Steve Bonnici -> Kevin, 2026-10-14. Short. Applies to `20261009179000_ScheduleCollapse_RetireDaysInFuture`
and to every later migration that re-emits `UTL_fncJob_GetClientAvailableBulkRunSchedule` or `DD_fncJob_GetClientAvailableBulkRunSchedule`._

## Why

8 Oct, Urgent prod, 18:12 to 20:25 NZDT: every rates call timed out at 30 s and the booking page could not
price or book. Performance Insights shows one statement doing it, the cross-region `INSERT INTO
@ClientNextAvailableBulkRunScheduleTemp` inside `UTL_fncJob_GetClientAvailableBulkRunSchedule`. Logical reads
per execution went from about 83k to 13.7 million after the 18:00 statistics job refreshed stats on
`BulkZoneSchedule` and `tblBulkRunSchedule`. Garry's write-up is in `20261009110000_RatesTablesFullscanStatistics.sql`.

Two things made it possible. The per-row scalar `UTL_fncBulkZonePostcode_IsActive`, which your collapse
migration already resolves once into `@ZoneActiveSchedules` (item 5, good, keep it). And the pickup-zone join
below, which is still in the collapse version at line 380 and has been in every version since
`20250725110037_UrgentDBChanges`. Your migration re-emits the function, which flushes its plan. That is exactly
the moment it is exposed, so ship the guard with it.

## Fix 1: the pickup-zone join (NZ function, cross-region block)

Today:

```sql
INNER JOIN bulkzonepostcode pickupPZ ON s.BookPickup = 1
    AND (s.PickupPostcodeGroupId IS NULL
        OR (ISNULL(s.PickupPostcodeGroupId, 0) = ISNULL(pickupPZ.PostcodeGroupId, 0) AND pickupPZ.PostCode = @FromPostCode))
```

When `s.PickupPostcodeGroupId IS NULL` nothing ties `pickupPZ` to the schedule, so every qualifying schedule row
is multiplied by the whole of `bulkzonepostcode` and `DISTINCT` throws the copies away. With a good plan the
optimiser filters early and you never notice. With a bad one you get 8 Oct.

Replace the join with predicates in the `WHERE`, same semantics, no fan-out:

```sql
-- remove the INNER JOIN bulkzonepostcode pickupPZ ... entirely, then in WHERE:
AND s.BookPickup = 1
AND (s.PickupPostcodeGroupId IS NULL
     OR EXISTS (SELECT 1 FROM bulkzonepostcode pz
                WHERE pz.PostCode = @FromPostCode
                  AND ISNULL(pz.PostcodeGroupId, 0) = s.PickupPostcodeGroupId))
```

The US function already does it the safe way (`LEFT JOIN ZoneZip pickupPZ ... AND (s.BookPickup = 0 OR
pickupPZ.Zip IS NOT NULL)`), so only the NZ function changes. The one behavioural edge, an empty
`bulkzonepostcode` table, returned nothing before and returns the schedule now. No tenant has an empty table.

## Fix 2: every re-emit of the availability functions ends with the stats guard

Append Garry's block to the end of `20261009179000` and to any later migration that re-emits either function.
Add the new tables the collapse introduces (`tblBulkRunScheduleDetail`, the renamed day table, the override table)
to the list, because the function now reads them and they start life with no statistics worth having.

```sql
UPDATE STATISTICS dbo.BulkZoneSchedule        WITH FULLSCAN, PERSIST_SAMPLE_PERCENT = ON;
UPDATE STATISTICS dbo.tblBulkRunSchedule      WITH FULLSCAN, PERSIST_SAMPLE_PERCENT = ON;
UPDATE STATISTICS dbo.BulkZonePostcode        WITH FULLSCAN, PERSIST_SAMPLE_PERCENT = ON;
UPDATE STATISTICS dbo.tblBulkRunScheduleDetail WITH FULLSCAN, PERSIST_SAMPLE_PERCENT = ON;  -- and the others the function reads
EXEC sp_recompile N'dbo.UTL_fncJob_GetClientAvailableBulkRunSchedule';
EXEC sp_recompile N'dbo.DD_fncJob_GetClientAvailableBulkRunSchedule';
```

Guard each line with `IF OBJECT_ID(...) IS NOT NULL` the way `20261009110000` does, so US and NZ tenants both pass.

## Fix 3: the migration proves the function is fast before it commits

DbUp runs the script in a transaction. Put a timing check after the `CREATE OR ALTER` so a bad plan fails the
deploy instead of the booking page. Pick one real client and postcode pair per tenant shape (Urgent: a
cross-region HelloFresh-style From/To; a same-region PB Tech-style pair). Two seconds is generous, the healthy
call is well under one.

```sql
DECLARE @t0 datetime2 = SYSUTCDATETIME(), @n int;
SELECT @n = COUNT(*) FROM dbo.UTL_fncJob_GetClientAvailableBulkRunSchedule(@ProbeClientId, NULL, GETDATE(), @ProbeFrom, @ProbeTo);
IF DATEDIFF(MILLISECOND, @t0, SYSUTCDATETIME()) > 2000
    RAISERROR('UTL_fncJob_GetClientAvailableBulkRunSchedule took longer than 2 s after re-emit; refusing to deploy', 16, 1);
```

Resolve `@ProbeClientId` from data (for example the client with the most rows in `tblScheduleClient`) so the
script is not tenant-specific. Skip the probe with a `PRINT` when the tenant has no schedules.

## Timing

Merge re-emits of these functions so the pipeline lands before 15:00 or after 21:00 NZDT. The 18:00 statistics
job and the evening booking peak overlap, and a fresh plan compiled in that window is the 8 Oct shape.

## Not yours, noted so nobody waits on you

- Booking's rates client deserialises a 400 error body as `RatesResponse` and turns a timeout into an unhandled 500. API or Booking owner.
- The 18:00 SQL Agent statistics job runs in the booking peak. Garry.

## Acceptance

1. `SET STATISTICS IO ON` on the probe call before and after the change on Urgent staging: logical reads on `bulkzonepostcode` drop to the postcode lookup only, result set identical row for row.
2. Deploy to staging, then run `UPDATE STATISTICS dbo.BulkZoneSchedule WITH SAMPLE 10 PERCENT; EXEC sp_recompile N'dbo.UTL_fncJob_GetClientAvailableBulkRunSchedule';` and call the function again. Still under one second. That is the 8 Oct trigger, reproduced on purpose.
3. The migration's timing probe is in the DbUp output for every tenant it ran on.
