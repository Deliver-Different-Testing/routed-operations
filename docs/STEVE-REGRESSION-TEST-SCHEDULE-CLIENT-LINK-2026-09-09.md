---
title: Regression test — schedule/client link rollout, against RunViewer bookings and Routed Operations
date: 2026-09-09
audience: Steve, George, Kevin, Kerran
status: Tested against baseline source. Kevin's implementation still not sighted.
supersedes: STEVE-REGRESSION-REVIEW-SCHEDULE-CLIENT-LINK-2026-09-09.md
sources_read:
  - Deliver-Different-Testing/dbmigrationsv2 @ 6195617
  - Deliver-Different-Testing/runviewer @ 2233d0c
  - Deliver-Different-Testing/routed-operations @ 85cf272 (+ two claude/* branches)
---

# Regression test — schedule/client link by ScheduleId

## What changed since the 2026-09-09 review

The earlier review measured the reported design against the brief and a data
profile. This pass measures it against **the code it will actually land on**.
Two more repositories were pulled and read: `dbmigrationsv2` (the live stored
procedures and migration runner) and `runviewer`.

That changes three conclusions and adds four findings. The most important
change: the earlier review said the `UNION` rule "contradicts the brief". It
does — but the stronger objection is that it contradicts **the function running
in production today**, which implements the fallback rule explicitly. That
moves finding 1 from a specification disagreement to a measurable behaviour
regression.

## Still not sighted

Kevin's implementation could not be read. Concretely:

- `dbmigrationsv2` on GitHub ends at `20260613040000_SeedComplianceChildFeatures.sql`.
  None of the five September migrations are there, and no file in the repository
  mentions `tblBulkRunScheduleHeader`, `BulkRunScheduleGroupId`, `tblScheduleClient`
  or `AddScheduleHeaderAndIdKeyedLinks`.
- `routed-operations` has **zero changed C# files** on any branch relative to
  `main`. There is no `ScheduleService`, no `SchedulesController`, no
  `BulkRunScheduleHeader` entity. `Models/DespatchContext.cs` is byte-identical
  across every ref, so the reported `DespatchContext` wiring is not there.
- No control named "Include client-specific" or "Client-specific only" exists in
  any ref, so there is no filter logic to have inverted.

So findings below are still against the reported design. What is new is that
every one is now anchored to code that exists, with the file and line that
breaks.

---

## 1. CRITICAL — `UNION` regresses booking behaviour that is explicitly implemented in production

The live NZ booking function is
`UTL_fncJob_GetClientAvailableBulkRunSchedule`, last altered in
`dbmigrationsv2/DatabaseScripts/Migrations/20260507121318_FixScheduleBookedNextWeekIssue.sql`.
Its final statement is the resolution rule, and it is a fallback, not a union:

```sql
WHERE ClientId = @ClientID
    OR (ClientId IS NULL AND (@IsShopifyShopClient = 1
        OR NOT EXISTS (SELECT 1 FROM @ClientAvailableBulkRunScheduleTemp t2
            WHERE t2.ClientId = @ClientID AND t1.SpeedId = t2.SpeedId AND t1.DayOfWeek = t2.DayOfWeek)))
```

A default schedule is returned **only where the client has no schedule of its
own for that same SpeedId and DayOfWeek**. The same suppression is applied a
second time, at SpeedId granularity, by the `DELETE` immediately above it. The
US variant `DD_fncJob_GetClientAvailableBulkRunSchedule`
(`20251207171350_FixRegionNameTruncatedIssue.sql`) carries the identical rule.

Kevin's reported rule is `EXISTS client link OR h.IsDefault = 1`, with no
suppression term. That is a different function. For every client holding a
schedule on a given speed and weekday, the matching default now returns
alongside it. The earlier review sized this at 2,606 client-specific schedules
against 119 defaults; the mechanism is now confirmed rather than inferred.

Three consequences the report does not mention, all in the same function:

- **The Shopify carve-out becomes unreachable.** `@IsShopifyShopClient` exists
  precisely to give some clients the union behaviour as an exception. A flat
  union makes the exception meaningless. If the rewrite dropped the branch
  rather than leaving it inert, Shopify clients are unaffected but everyone
  else silently inherits their rule.
- **`NoSDailyLimit` is applied over the same partition.** The final select is
  `WHERE TOP# <= ISNULL(NoSDailyLimit, 999)` over
  `PARTITION BY SpeedId, DayOfWeek ORDER BY ClientID DESC`. Adding default rows
  into partitions that previously held only the client's own rows consumes
  slots under that cap. Where `NoSDailyLimit` is small, a union can push a
  client's own schedule out of its own result.
- **Two hardcoded client carve-outs read the day-row `ClientId`.** The cutoff
  exemption `ISNULL(ClientId, 0) <> 15829` and a 32-client holiday-exempt list
  both key on the day row's client column, not on a header.

**Recommendation unchanged, evidence stronger.** Restore the fallback, matching
production. If the union is wanted as a product decision, it is a change to what
customers can book and belongs to Steve explicitly.

Worth knowing: the mock frontend already disagrees with the brief in Kevin's
direction. `v2/frontend/src/schedules/modules/schedules/utils/clientLinks.ts`
lines 44-59 implement a union, and `clientLinks.test.ts` lines 57-61 pin it with
an assertion that a linked client "sees it plus defaults". So the union is not
an accident, but it was settled in a sample-data module rather than against the
booking function.

---

## 2. CRITICAL — retiring schedules will silently stop recurring bookings

This finding is new. `uspPrebookSet`
(`20260521114303_uspPrebookSetIncludeRoute.sql`) drives recurring bookings. It
reads `ScheduleID` and `ScheduleName` denormalised onto `tucJobBooking`, then
gates every firing on an existence check against the day rows:

```sql
IF NOT EXISTS (
    SELECT 1 FROM tblBulkRunSchedule
    WHERE Name = @CurScheduleName
      AND (ClientId = @CurClientID OR ClientId IS NULL)
      AND DayOfWeek = @TargetIsoDayOfWeek
)
    SET @TargetMatch = 0
```

There are six of these in the procedure. When the check fails the booking simply
does not fire; nothing is logged and nothing errors.

Two ways the rollout breaks it:

- **Soft delete.** "All SP reads filter on `h.RetiredUtc IS NULL`". If that
  predicate reaches this check, then the rationalisation that follows — which
  retires **522 client schedules** per `summary.csv` — stops every recurring
  booking bound to them. Silently. This is the highest-consequence path in the
  whole workstream, because it is customer deliveries that simply stop
  appearing rather than an operator-visible error.
- **Dropping the legacy day-row `ClientId`.** The predicate is
  `ClientId = @CurClientID OR ClientId IS NULL`. If new day rows stop carrying
  `ClientId`, they read as defaults and match **every** client with a booking of
  that schedule name. Bookings then fire against another client's schedule.

The second is not hypothetical. The repository's own
`v2/frontend/src/schedules/modules/schedules/compat.test.ts` lines 53-60 asserts
the opposite of the brief: *"never writes the one-to-one ClientId: every day row
goes out with no ClientId"*. Brief §5 says keep writing it. The test currently
encodes the behaviour that breaks this procedure.

**Test:** before retiring anything, run check 4 in the harness. It lists every
active recurring booking whose schedule would be retired by the merge.

---

## 3. HIGH — the id-space collision has 57 live join sites

The earlier review flagged the naming hazard. It is now measured.

`ScheduleID` on job and booking rows holds a **day-row** id, and is joined to
`tblBulkRunSchedule.BulkRunScheduleId` at **57 sites across 46 migration
files**, for example:

```sql
left join tblBulkRunSchedule s on tblBulkJob.ScheduleID = s.BulkRunScheduleId
INNER JOIN tblBulkRunSchedule s ON b.ScheduleID = s.BulkRunScheduleId
```

A third table compounds it: `tblBulkScheduleLinehaul.BulkRunScheduleId` is also
a day-row key —
`LEFT JOIN tblBulkScheduleLinehaul bsl ON bsl.BulkRunScheduleId = brs.BulkRunScheduleId`
(`20260525100000_RvwLinehaulSpsRecurringRoutes.sql:174`).

Under Kevin's naming, `tblScheduleClient.BulkRunScheduleId` is a **header** id.
So `BulkRunScheduleId` will mean a day row in two tables and a header in a
third. `20260526200000_RecurringRouteSpsConsolidated.sql:1329` even
string-concatenates the day-row id into a synthetic `SpeedID`, so day-row ids
are already baked into other keys.

With 11,110 day rows against 2,725 headers the ranges overlap almost entirely.
A wrong join returns plausible rows rather than failing.

**Recommendation:** use the brief's names — `ScheduleId` on the header and day
rows, `tblBulkRunScheduleClient` for the link table. That is also what the
baseline migration already builds, which resolves the collision described in
finding 8 at the same time.

---

## 4. HIGH — RunViewer linehaul: a retirement predicate both drops rows and miscounts them

RunViewer holds no schedule entity, no schedule table mapping and no raw SQL.
Its entire schedule exposure is two stored procedures, both called live:
`RVW_stpLinehaulOverview` (`Repositories/RunRepository.cs:355`) and
`RVW_stpLinehaulJobs` (`RunRepository.cs:740`), defined in
`20260525100000_RvwLinehaulSpsRecurringRoutes.sql`.

Their schedule joins are `LEFT JOIN`, which looks safe. The `WHERE` clauses turn
them into effective inner joins as soon as a depot is selected:

```sql
and ((@ToDepotID = 0 and bsl.BulkRunScheduleId is null)
  or (@ToDepotID != 0 and bsl.ToDepotId = @ToDepotID and ...))
```

(lines 357 and 452). If `RetiredUtc IS NULL` is pushed into these joins, a
completed linehaul job whose schedule was later retired fails the depot branch
and **disappears from every depot-filtered historic list** — and is
simultaneously **counted into the "unassigned depot" bucket**, because that
branch tests for a null schedule join. A drop-out and a miscount from one
predicate.

Two mitigating facts, both worth protecting deliberately:

- The main run views — `RVW_stpRunOverview`, `RVW_stpBulkRuns_2`,
  `RVW_stpBulkRunJobs` in `20260528100000_RvwOverviewIncludeLhpDeliveryRegion.sql`
  — contain no schedule reference at all. Historic bulk runs cannot lose rows to
  a retirement.
- `ScheduleName` is denormalised onto both `tblBulkJob` and `tucJob`
  (`runviewer/Models/TblBulkJob.cs:174`, `Models/TucJob.cs:368`). That copy is
  what protects historic display. It must not be "tidied up" into a live header
  join as part of this work.

**Rule, restated from the earlier review and now with the code to apply it to:**
filter `RetiredUtc IS NULL` on selection paths only. Never on display of
existing records.

Seven further procedures RunViewer calls have no definition in the migrations
repository — they come from the `DFRNT_SEED_2025.bak` baseline and cannot be
read from source. `RVW_stpLineHaulRuns` (`RunRepository.cs:819`) is the one to
check first, given both its siblings join schedules.

---

## 5. MEDIUM — the migration rename re-runs the reshape rather than skipping it

The runner is DbUp 6.0.0 (`DBMigrationsV2.csproj:26`), journalling to
`dbo.SchemaVersions` **by filename**:

```csharp
.WithTransaction()
.WithExecutionTimeout(TimeSpan.FromMinutes(5))
.JournalToSqlTable("dbo", "SchemaVersions")
```

So renaming `...120000_AddScheduleHeaderAndIdKeyedLinks.sql` to `...180000_...`
does not cause a skip. DbUp sees an unknown script name and **runs it**. Any
environment that already applied `120000` will replay the entire data reshape
under the new name. That is survivable only if the idempotency claim holds in
full, which makes it the single most important thing to test.

There is an upside worth stating: on an environment where Kevin's `120000` ran
before Kerran's `170731` arrived, Kerran's function definition would have
overwritten Kevin's. The rename repairs that environment, provided the `180000`
body genuinely contains the merged result.

Two corrections to the risk model:

- **"Partial retry" is not reachable under this runner.** `.WithTransaction()`
  in DbUp 6 wraps the *entire* upgrade — all pending scripts and their journal
  rows — in one transaction. A mid-run failure rolls everything back. Kevin's
  idempotency work is good defensive practice, but the failure mode it is
  written for cannot occur here. Fresh-apply and repeat-apply are the two cases
  that need testing.
- **All five migrations commit atomically with anything else pending**, and hold
  their locks on `tblBulkRunSchedule` for the whole run. Schedule the window
  accordingly; the table is on the live booking path.

---

## 6. MEDIUM — an `ALTER TABLE` on `tblBulkRunSchedule` must refresh dependent views

Adding `BulkRunScheduleGroupId` to `tblBulkRunSchedule` is a column-changing
`ALTER TABLE`. The repository enforces a convention for exactly that case, in
`git-hooks/pre-commit`:

> ERROR: Contains ALTER TABLE but does not call procRefreshAllViews.
> Dependent views (e.g. tblJob, DESWEB_qryDespatch) may break at runtime.

220 migrations comply. Two views read `tblBulkRunSchedule` directly:
`DESWEB_qryDespatch` and `tblJobBooking`. If the migration was committed with
`--no-verify`, those views can break at runtime after the column is added.

**Test:** confirm the migration contains `EXEC procRefreshAllViews`.

---

## 7. MEDIUM — NZ and US variants have already drifted five months

The report says both variants were rewritten and Kerran's zone fix merged into
the NZ one. The baseline they were rewritten from is not symmetrical:

| | NZ (`UTL_`) | US (`DD_`) |
|---|---|---|
| Last altered | 2026-05-07 | 2025-12-07 |
| Shopify carve-out | yes | no |
| Cutoff exemption for client 15829 | yes | no |
| Tenant-local cutoff fix (`UTL_GetTenantLocalDateTime`) | yes | no |

The tenant-local fix is the May 2026 bug fix whose own comment says the previous
behaviour "wrongly dropped every requested slot and the function returned the
next-week occurrence instead". The US variant still has the bug.

Rewriting both variants in one pass risks either propagating NZ-only carve-outs
into the US or losing them from the NZ. **Test:** diff both post-change bodies
against these baselines and confirm each difference is deliberate.

---

## 8. MEDIUM — the two migrations build parallel structures

Unchanged from the earlier review, now with both definitions read.

| | Baseline `001_schedule_header_and_id_keyed_links.sql` | Kevin, as reported |
|---|---|---|
| Header table | `tblBulkRunScheduleHeader` | `tblBulkRunScheduleHeader` |
| Header PK | `ScheduleId` | (identity PK, name not stated) |
| Day-row FK column | `ScheduleId` | `BulkRunScheduleGroupId` |
| Link table | `tblBulkRunScheduleClient` | `tblScheduleClient` |
| Link FK column | `ScheduleId` | `BulkRunScheduleId` |

The baseline detects an existing name-keyed link table and adds `ScheduleId` to
it, but it looks for `dbo.tblBulkRunScheduleClient`. It will not recognise
`tblScheduleClient`, so run after Kevin's migration it builds a **second**
link table alongside his. One of the two must be retired before either reaches
an environment that has seen the other.

Note the baseline is a dry run as committed: it ends
`IF @Commit = 1 COMMIT TRAN ELSE ROLLBACK TRAN;` with `@Commit bit = 0`.

---

## 9. LOW — legacy tuple fallback, and the filter rename

Both unchanged from the earlier review, and both still stand.

The `(name, legacyClientId)` fallback resolves against a key that 164 names make
ambiguous. Keep it if the contract needs it, but log every use and hard-fail on
a multi-row resolution rather than picking one.

The checkbox rename inverts an existing control's meaning. It does not exist in
any ref, so there is nothing to verify; it needs a release note, not a code
change.

---

## Regression test set

Executable checks are in `scripts/schedule-regression/`. Run 01 before the
migration, 02 after, 03 and 04 at both points.

### Booking — the customer-facing path

| # | Test | Expected |
|---|---|---|
| 1 | Schedule-set parity for clients that have their own schedule | Identical before and after. **Expected to fail on the union rule.** |
| 2 | Schedule-set parity for clients with none of their own | Identical; the 119 defaults |
| 3 | A name shared by a default and a client schedule (48 of these) | Same definition as before |
| 4 | A name with differing definitions (164 of these) | `CutoffHours`, `StartTime`, `SpeedId` match the pre-migration values |
| 5 | Shopify client schedule set | Unchanged; carve-out still reachable |
| 6 | A client whose `NoSDailyLimit` is at or below its schedule count | No schedule displaced by a default |
| 7 | Zone-rated booking, NZ and US | Kerran's layer applies in both |
| 8 | Client 15829 past cutoff | Still exempt |

### Recurring bookings — the silent-failure path

| # | Test | Expected |
|---|---|---|
| 9 | Active bookings bound to a to-be-retired schedule | Enumerated before any retirement; count must be zero after remediation |
| 10 | Create a schedule through the new path, inspect day rows | `ClientId` populated per brief §5 |
| 11 | Retire a schedule with an active recurring booking | Booking still fires, or fails loudly. Never silently |

### RunViewer

| # | Test | Expected |
|---|---|---|
| 12 | Historic linehaul job on a retired schedule, depot filter set | Row still returned |
| 13 | Same job with `@ToDepotID = 0` | Not counted into the unassigned bucket |
| 14 | Historic run against a merged-away schedule | Schedule name still renders |
| 15 | `RVW_stpLineHaulRuns` read against the live database | No header/day-row id confusion |

### Routed Operations

| # | Test | Expected |
|---|---|---|
| 16 | Create, rename, attach, detach, delete | Brief §6, all four criteria |
| 17 | FK and PK enforcement on the link table | Rejected as specified |
| 18 | Legacy tuple fallback on an ambiguous name | Hard fail, not a silent pick |

### Migration

| # | Test | Expected |
|---|---|---|
| 19 | Fresh apply on staging | 2,725 headers / 119 defaults / 11,110 day rows |
| 20 | Re-apply the renamed file on a database that already ran `120000` | No duplicate headers or link rows |
| 21 | `EXEC procRefreshAllViews` present | Yes |
| 22 | Both migrations cannot both apply | Confirmed, per finding 8 |

## What is still needed

The five migration files and the Routed Operations diff, or Kevin's branch
pushed to the mirror. With the source, findings 1, 2, 4 and 6 become
line-by-line confirmations rather than tests to run.
