# Schedule/client link — regression harness

Executable checks for the `KEVIN-SCHEDULE-CLIENT-LINK-BY-SCHEDULE-ID-2026-09-08`
rollout. Findings and rationale are in
`docs/STEVE-REGRESSION-TEST-SCHEDULE-CLIENT-LINK-2026-09-09.md`.

Everything here is read-only against production data. The only objects written
are three `dbo.ZZ_SchedRegr_*` capture tables, which can be dropped afterwards.

## Order of running

| When | Script | Answers |
|---|---|---|
| Before the migration | `01_capture_booking_baseline.sql` | What does each client see today? |
| Before retiring anything | `03_impact_recurring_and_linehaul.sql` | What breaks silently if schedules are retired? |
| After the migration | `02_compare_booking_sets.sql` | Did any client's schedule set change? |
| After the migration | `04_post_migration_structure_checks.sql` | Did the reshape land correctly? |

Run 01 and 02 once per territory: set `@Variant` to `UTL` for New Zealand and
`DD` for the United States, and use the same `@JobTypeID` and probe date for
both halves of a pair.

## What each script decides

**01 / 02 — the booking regression.** These decide finding 1. The live NZ and US
booking functions return a default schedule only where the client has none of
its own for the same `SpeedId` and `DayOfWeek`. A flat `EXISTS link OR IsDefault`
rule drops that suppression. Check 2 in script 02 isolates exactly those rows.
Non-zero output is the regression reproduced.

The parity comparison is on the schedule **definition** (name, weekday, start
time, speed, cutoff), not on ids, because the migration is entitled to change
ids.

**03 — the silent-failure paths.** Section A enumerates recurring bookings that
stop firing if their schedule is retired. `uspPrebookSet` gates each firing on an
existence check against day rows and simply skips when it fails, so this failure
never appears in a log. Section B lists historic linehaul jobs that RunViewer
would drop from depot-filtered lists, and simultaneously miscount into the
unassigned-depot bucket, if a retirement predicate reaches its joins.

Populate the `#ToRetire` temp table from the merge output
(`retired_schedule_rows.csv`) before running sections A2 and B1. Without it those
two sections return nothing.

**04 — the structure.** Confirms which of the two competing migrations landed,
measures how far the header and day-row id ranges overlap (the id-space
collision), checks the reshape counts against the production profile, and looks
for the duplicate rows a non-idempotent second run would leave after the
migration file was renamed from timestamp `120000` to `180000`.

## Reading the id-space check

Section 2 of script 04 runs the join a developer would naturally write:

```sql
JOIN tblBulkRunSchedule s ON s.BulkRunScheduleId = sc.BulkRunScheduleId
```

Under the reported naming, the left side is a day-row id and the right side is a
header id. Every row it returns is wrong. The reported percentage is how often
such a mistake would go unnoticed, because with 11,110 day rows against 2,725
headers the ranges overlap almost completely.

## Cleanup

```sql
DROP TABLE IF EXISTS dbo.ZZ_SchedRegr_After;
DROP TABLE IF EXISTS dbo.ZZ_SchedRegr_Baseline;
DROP TABLE IF EXISTS dbo.ZZ_SchedRegr_Probe;
```
