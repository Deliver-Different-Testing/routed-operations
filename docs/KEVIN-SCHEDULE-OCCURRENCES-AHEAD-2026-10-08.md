# Occurrences ahead: retire DaysInFuture (collapse step M5)

**For:** Kevin  **From:** Steve (via EasyEA)  **Date:** 8 October 2026
**Part of:** the schedule collapse (`KEVIN-SCHEDULE-COLLAPSE-COMPAT-VIEW-2026-09-29.md`). This is step **M5**, built after M2 and before step F's batch.
**Repos:** dbmigrationsv2 (two availability functions, one seed), routed-operations (Schedules NEW detail field, client override field)
**Status:** decided by Steve 8 Oct. Build with the collapse.

---

## 0. TL;DR

| | |
|---|---|
| **Today** | The booking page offers a schedule on every date inside a window of `DaysInFuture` calendar days, a number stored per **client speed** in Admin Manager. A six-day window means five runs of a Monday-to-Friday schedule and one run of a Monday-only schedule. Ops have been raising it to make a schedule visible, which is a side effect, not a control. |
| **After** | The booking page offers the **next N occurrences** of each schedule whose cutoff has not passed. N lives on the **schedule** (detail table, default one week's worth) with a per-client override. DaysInFuture is no longer read. |
| **Why now** | The collapse introduces the detail table that N belongs on, and the converter already has to write it. Doing it in the same release means one seed, one function rewrite, one round of booking-page testing. |
| **Size** | One seed migration, one full-body re-emit of each availability function (NZ `UTL_fncJob_GetClientAvailableBulkRunSchedule`, US `DD_fncJob_GetClientAvailableBulkRunSchedule`), two form fields. uspPrebookSet, Shopify and the rating procs are untouched. |
| **Decisions** | Section 7. All closed. |

---

## 1. Where DaysInFuture is read today

Traced through the latest emitters in dbmigrationsv2 and the Shopify app source.

| Reader | Use | After M5 |
|---|---|---|
| `UTL_fncJob_GetClientAvailableBulkRunSchedule` (NZ) and `DD_fncJob_GetClientAvailableBulkRunSchedule` (US) | build the `@Temp` date list as `@DateTime .. @DateTime + DaysInFuture`, then split every branch into a "next available" variant (`DaysInFuture = 0`) and a windowed variant (`> 0`) | **rewritten**, section 4 |
| `UTL_fncJob_GetClientAvailableSpeed` and the rating / description procs (`UTL_fncJob_ExceleratorRate`, `WS_stpJobType_Rates`, `DD_stpJob_Scheduler_Rates`, `UTL_fncJob_RateAndDescription`, the NP rate procs, `DD_stpBulkScheduleJob_Insert` and others) | project the column through in their result shape; no decision made on it | unchanged; the column stays until a later drop |
| `uspPrebookSet` | not read. It books one `@Date` per call; the horizon is the scheduler's | unchanged |
| Shopify app (`WindowService`, `WindowUtility`) | not read. Windows carry their own `MaxDays` and a fixed six-day lookahead; the EF entity maps the column but nothing uses it | unchanged |
| Admin Manager, Available Services tab | the field ops edit | becomes dead. Admin Manager is retiring; no change there |

---

## 2. The rule

For a client booking on speed S from From to To on date D:

1. Collect the candidate schedule rows exactly as today (region match, zone match, client link or default, speed).
2. For each candidate schedule and each of its active days, generate occurrences from D forward, skipping holidays, with the same `BookDateTime` and `CutoffDateTime` arithmetic the function uses now.
3. Drop occurrences whose cutoff has passed (today's DELETE keeper).
4. Keep the first **N** occurrences per schedule, ordered by `BookDateTime`, where N = client override `OccurrencesAhead` if set, else the schedule's `OccurrencesAhead`.
5. Apply `NoSDailyLimit` per (speed, weekday) as today, with linked schedules ranked above defaults.

N = 1 is what the old `DaysInFuture = 0` "next available" branches did. They go.

---

## 3. Storage and defaults

| Column | Table | Type | Default / seed |
|---|---|---|---|
| `OccurrencesAhead` | `tblBulkRunScheduleDetail` (M1) | `TINYINT NOT NULL` | the number of `1`s in `WeekDays`, i.e. one week's worth. The converter writes this. Validation 1 to 14. |
| `OccurrencesAhead` | `tblBulkRunScheduleOverride` (M1, Kevin has added it) | `TINYINT NULL` | NULL = inherit. Seeded once by M5 where a client's current window differs from the default (section 5). |

Old-shape schedules (no detail row yet) resolve N as the count of distinct `DayOfWeek` rows, which is the same one-week default. (The day table has no `Active` column; a day row existing is what "active" means. Corrected 9 Oct after Kevin's review.)

**The compatibility view does not get this column** (corrected 9 Oct). The view's contract is column-for-column identity with the old table, so positional `INSERT ... SELECT *` keeps working and the V1 zero-row `EXCEPT` diff can run at all. The fallback lives in `fnScheduleForClient`, which gains one output column:

```sql
COALESCE(ov.OccurrencesAhead,                       -- client override, Scope = 'schedule', DayOfWeek 0
         x.OccurrencesAhead,                        -- detail row (converted schedules)
         (SELECT COUNT(DISTINCT d2.DayOfWeek)       -- old-shape fallback: one week's worth
            FROM dbo.tblBulkRunScheduleDay d2
           WHERE d2.ScheduleId = h.ScheduleId)) AS OccurrencesAhead
```

Section 4 reads N from `fnScheduleForClient`, so nothing else needs it.

---

## 4. Function changes (both tenants)

Full-body re-emit of each function, baselined from its latest emitter (NZ: `20260924112000`; US: the latest `DD_fncJob_...` file on develop at build time) and collision-reviewed against it.

1. **Date list.** `@Temp` is built from `master..spt_values` over a fixed horizon instead of `DaysInFuture`: `number BETWEEN 0 AND @HorizonDays`, where `@HorizonDays = 60` (D1). Holiday exclusion and the same-day time adjustments stay word for word. The `OUTER APPLY dbo.UTL_fncJob_GetClientAvailableSpeed` stays, because `NoSDailyLimit` and the speed set still come from it; only its `DaysInFuture` predicate is removed.
2. **Branches.** The four INSERT sites become two: cross-region and standard. Each loses its `ISNULL(a.DaysInFuture, 0) = 0` / `> 0` predicate and its sibling. Everything else in the INSERT (header join, strict client rule, zone match, cutoff expression) is unchanged.
3. **Cutoff keeper.** Unchanged, and it runs before the occurrence ranking so a passed occurrence does not consume one of the N.
4. **Occurrence ranking.** New step between the keeper and the final select:

```sql
;WITH ranked AS (
    SELECT t.*, 
           ROW_NUMBER() OVER (PARTITION BY t.ScheduleId ORDER BY t.BookDateTime) AS occ
    FROM @ClientAvailableBulkRunScheduleTemp t
)
DELETE r FROM ranked r
JOIN dbo.fnScheduleForClient(r.ScheduleId, @ClientID) f ON f.DayRowId = r.BulkRunScheduleId
WHERE r.occ > f.OccurrencesAhead;
```

   (Inline TVF in a DELETE on a CTE over a table variable is fine; if the optimiser objects, materialise N per ScheduleId into a second table variable first.)
5. **Final select.** Unchanged, including the `NoSDailyLimit` partition and the linked-first ranking.
6. **Result shape.** Unchanged. `DaysInFuture` is still projected (callers read the shape) but is no longer a decision input. Set it to the client-speed value as today so nothing downstream sees a change.

---

## 5. Seed (one-off, inside M5)

Clients whose window today is not the default get an override so the booking page offers the same number of dates after the change as before. Read-only preview first, then insert.

```sql
-- Preview: clients with a non-default window, and what N each schedule would get
SELECT cs.ClientID, cs.JobTypeID AS SpeedId, cs.DaysInFuture,
       h.ScheduleId, h.Name,
       CASE WHEN ISNULL(cs.DaysInFuture, 6) = 0 THEN 1
            ELSE CEILING(ad.ActiveDays * (ISNULL(cs.DaysInFuture, 6) + 1) / 7.0) END AS ProposedN
FROM dbo.tblClientAvailableSpeed cs
JOIN dbo.tblScheduleClient sc ON sc.ClientId = cs.ClientID
JOIN dbo.tblBulkRunScheduleHeader h ON h.ScheduleId = sc.ScheduleId AND h.RetiredUtc IS NULL
CROSS APPLY (SELECT COUNT(DISTINCT s.DayOfWeek) AS ActiveDays
             FROM dbo.tblBulkRunSchedule s
             WHERE s.ScheduleId = h.ScheduleId AND s.SpeedId = cs.JobTypeID) ad   -- no Active column on the day table; a row = an active day
WHERE ISNULL(cs.DaysInFuture, 6) <> 6
  AND ad.ActiveDays > 0
ORDER BY cs.ClientID, h.ScheduleId;
```

The insert writes one `Scope = 'schedule'` override row per (client, schedule) from that preview, `OccurrencesAhead = ProposedN`, only where no override row exists for that pair, else updates the column on the existing row. `ProposedN` is an approximation (the exact count depends on the weekday the window starts); accepted, D3. Defaults (`IsDefault = 1`) are covered through the same client speed rows because the join is on the client's linked schedules plus every default the client can see; Kevin to extend the join with `OR h.IsDefault = 1` and dedupe.

Table name `tblClientAvailableSpeed` confirmed by Kevin against Urgent Prod on 9 Oct; it is what `UTL_fncJob_GetClientAvailableSpeed` reads `DaysInFuture` from.

---

## 6. App changes (routed-operations)

| # | Where | Change |
|---|---|---|
| A1 | Schedules NEW detail modal, header card | "Occurrences ahead" numeric field, 1 to 14, default shown as the active-day count with helper text "how many upcoming runs the booking page offers". Writes `tblBulkRunScheduleDetail.OccurrencesAhead` via ScheduleService. |
| A2 | Client override editor (Client Overrides page and the per-client override panel) | same field, nullable, "inherit" when blank. Writes the override row's `OccurrencesAhead`. |
| A3 | Schedules NEW list | optional column, low priority. |
| A4 | Convert-on-save and `uspScheduleConvert` | write the default on the detail row; never touch overrides. |

No change to the booking page itself; it renders what the function returns.

---

## 7. Decisions (closed 8 Oct, Steve)

| # | Question | Decision |
|---|---|---|
| D1 | Horizon for generating candidate dates | 60 days. Bounds the date list; no schedule needs more than 14 occurrences and none runs less than weekly. |
| D2 | Range for N | 1 to 14, enforced in the app and by a CHECK on both columns. |
| D3 | Seed accuracy | the CEILING approximation in section 5 is accepted. Clients on the default window get no override and see one week's worth, which is what the default gives today for every schedule shape. |
| D4 | Admin Manager's DaysInFuture field | left in place, ignored after M5. Admin Manager is retiring; no work there. The column is dropped in a later cleanup, after the rating procs stop projecting it. |
| D5 | Where N lives | per schedule on the detail table, per client on the override table. Not per client speed. |

---

## 8. Acceptance (Urgent staging, then production; same on Medical)

1. VALUA, Regional Run, Nicholson Autos to Value Tyres, Thursday 11:16 after the 11:00 cutoff, schedule #2900 (Mon to Fri, N = 5): the booking page offers Fri, Mon, Tue, Wed, Thu of the custom schedule, regardless of VALUA's DaysInFuture.
2. A Monday-only schedule with N = 1 offers exactly the next Monday whose cutoff has not passed.
3. A client with an override N = 2 on a Mon-to-Fri schedule sees two dates; clearing the override returns five.
4. `NoSDailyLimit = 1` still shows the linked custom schedule, not the default, on a day both are offered.
5. Holidays are still skipped; a run whose only occurrence inside the horizon is a holiday is simply not offered.
6. Regression: for a sample of ten clients on the default window, the set of (schedule, date) pairs offered before and after is identical for the next seven days. Diff the two function outputs on staging.
7. uspPrebookSet materialises the same bookings as before (it does not read N).

---

## 9. Out of scope

- Dropping `DaysInFuture` from any table or result shape.
- Shopify windows (own horizon, own tables).
- Changing `NoSDailyLimit` semantics.
- The F18 re-key.
