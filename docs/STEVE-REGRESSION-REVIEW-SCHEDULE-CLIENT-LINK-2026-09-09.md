---
title: Regression review — Kevin's schedule/client link rollout
date: 2026-09-09
audience: Steve, George, Kevin
status: Review — source not yet sighted, findings are against the reported design
reviews: KEVIN-SCHEDULE-CLIENT-LINK-BY-SCHEDULE-ID-2026-09-08.md
baseline_migration: scripts/schedule-rationalisation/sql/001_schedule_header_and_id_keyed_links.sql
---

# Regression review — schedule/client link by ScheduleId

## Status of this review

Kevin's implementation could not be sighted. It is not on the GitHub mirror:
every ref of `Deliver-Different-Testing/routed-operations` was searched for
`BulkRunScheduleGroupId`, `tblScheduleClient` and
`AddScheduleHeaderAndIdKeyedLinks` — no hits. `v2/backend` on the rationalise
branch has no `ScheduleService`, no `SchedulesController` and no
`BulkRunScheduleHeader` entity, so the reported backend work lives only in
GitLab (DBMigrationV2 + Routed Operations), which is not reachable from this
machine.

Findings below are therefore **against the reported design**, measured against
the brief (`KEVIN-SCHEDULE-CLIENT-LINK-BY-SCHEDULE-ID-2026-09-08.md`) and the
production data profile in `output/summary.csv`. Findings 1-3 are design-level
and stand on the report alone. Findings 4-7 are hazards that need the source to
confirm or clear.

Data profile used throughout (current production export):

| | |
|---|---|
| Day rows (`tblBulkRunSchedule`) | 11,110 |
| Schedules | 2,725 |
| … default (`ClientId` NULL) | 119 |
| … client-specific | 2,606 |
| Names with differing definitions | 164 |
| Names used by both a default and client schedules | 48 |

---

## 1. CRITICAL — the UNION resolution rule contradicts the brief and widens booking for every client that has its own schedule

**Reported:** "The final rule is `EXISTS client link OR h.IsDefault = 1`, rather
than the fallback shape in the original brief."

**Brief §3 (the only rule the code should implement):**

> A client's schedules are the live headers (`RetiredUtc IS NULL`) it has a link
> row for. **If it has none**, its schedules are the live headers with
> `IsDefault = 1`.

That is `ELSE`, not `OR`. The two differ for exactly one population: clients
that have a schedule of their own. Under the brief they see only their own.
Under UNION they additionally see all 119 default schedules.

**Blast radius:** all 2,606 client-specific schedules. Those clients get up to
119 extra options in the booking-time schedule picker
(`_fncJob_GetClientAvailableBulkRunSchedule` feeds booking, so this surfaces to
customers, not just operators).

**This fails the brief's own acceptance test**, §6:

> every existing client still gets exactly the schedules it had (compare
> `GET Schedules/Clients/{id}` before and after for a sample of clients,
> including one with none of its own)

The sample must include a client that *has* its own schedule. Under UNION that
comparison cannot pass.

**The stated justification does not hold.** The report gives two reasons for
switching: the fallback "required a 28k-row default-safety-net INSERT", and the
UI "showed 268 clients on every default schedule". Both are consequences of
*materialising link rows for defaults*, not of the fallback rule. The fallback
needs no rows at all — it is:

```sql
IF EXISTS (SELECT 1 FROM tblBulkRunScheduleClient WHERE ClientId = @ClientId)
    -- linked headers only
ELSE
    -- headers WHERE IsDefault = 1
```

Zero inserted rows, and no client appears on a default schedule in the UI. The
safety-net INSERT was avoidable without changing the resolution semantics. The
UI concern is real and is solved by the fallback, not by UNION.

**Recommendation:** revert to the `ELSE` rule and drop the safety-net rows.
If UNION is genuinely wanted as a product decision — "clients can always also
book the defaults" — that is a change to what customers can book and needs to
be Steve's call explicitly, with the before/after client schedule counts on
the table, not a side effect of a migration convenience.

---

## 2. HIGH — `BulkRunScheduleId` is already the day-row PK; reusing it as the header FK is a live join hazard

**Reported:** "`tblScheduleClient` is re-keyed from `ScheduleName` to
`BulkRunScheduleId`", and day rows FK the header via `BulkRunScheduleGroupId`.

`BulkRunScheduleId` is the existing identity PK of `tblBulkRunSchedule` (the
*day row*). The brief and the baseline migration deliberately avoid this: the
header PK is `ScheduleId`, the day-row FK is `ScheduleId`, and the link table
is `tblBulkRunScheduleClient`.

Under Kevin's naming, `tblScheduleClient.BulkRunScheduleId` points at the
*header*, while `tblBulkRunSchedule.BulkRunScheduleId` is a *day row*. Those are
different key spaces with the same column name. Any join written as

```sql
JOIN tblScheduleClient sc ON sc.BulkRunScheduleId = s.BulkRunScheduleId
```

compiles, runs, and silently returns wrong rows. With 11,110 day rows against
2,725 headers the id ranges overlap heavily, so it will not fail loudly — it
will return a plausible-looking wrong schedule.

Brief §2 flags this dependency explicitly: "`BulkZoneSchedule.ScheduleId` and
linehaul rows hang off the day-row id." Both key spaces are in use in the same
queries.

**Recommendation:** rename to the brief's names (`ScheduleId` on the header and
day rows, `tblBulkRunScheduleClient`). If the rename is refused, every join
touching either column needs an explicit review, and `BulkRunScheduleGroupId`
should at minimum be renamed `ScheduleId` so the two are visually distinct.

**Second-order:** the baseline migration
`001_schedule_header_and_id_keyed_links.sql` has `@Link =
dbo.tblBulkRunScheduleClient` and adds a `ScheduleId` column. Run after Kevin's
migration it will not detect his tables and will build a **parallel second**
header/link structure. One of the two migrations must be retired before either
is applied to an environment that has seen the other.

---

## 3. HIGH — the retained legacy `(name, legacyClientId)` fallback can resolve to the wrong schedule

**Reported:** "the legacy name + `legacyClientId` tuple retained as a fallback
for one release."

That tuple is precisely the key the brief was written to eliminate. Brief §2,
measured on production: **164 names map to more than one definition**, and **48
names are used by both a default schedule and client schedules**. A fallback
lookup on `("AKL > CHCH Pre 10am Medical", 16947)` has six candidate
definitions and no way to choose.

Keeping it as a silent fallback means the ambiguity is still reachable in
production for a release — and it will be reached exactly when the `scheduleId`
path fails, i.e. when something is already wrong.

**Recommendation:** keep the fallback if the API contract needs it, but log a
warning on every use, and make it hard-fail (not pick one) when the tuple
resolves to more than one live header. Then check the log before the release
that removes it — if it never fires, removal is free.

---

## 4. HIGH — two same-day rewrites of the same functions, merged by hand

**Reported:** "My file was renamed to timestamp 180000 so it applies after his
170731, with his ZoneRated + `UTL_fncBulkZonePostcode_IsActive` layer preserved
verbatim in the final body."

Kevin and Kerran both rewrote `_fncJob_GetClientAvailableBulkRunSchedule` on the
same day, and the reconciliation was a manual copy of Kerran's zone layer into
Kevin's body. That is the classic lost-update shape.

**Two specific risks:**

- **NZ vs US drift.** The report says Kerran's fix was merged into "the NZ
  variant". If the US variant did not get the zone layer, the two variants now
  differ in zone filtering. Confirm that is deliberate.
- **Renaming an applied migration.** If DBMigrationV2 tracks applied migrations
  by filename or timestamp, renaming `120000` → `180000` after it has run
  anywhere causes a re-run on that environment (or a skip). Confirm nothing has
  applied the old name.

**Test:** diff Kevin's final function body against Kerran's `170731` version and
confirm the ZoneRated / `UTL_fncBulkZonePostcode_IsActive` block is
byte-identical, not paraphrased. Then run a zone-rated booking through both
variants.

---

## 5. MEDIUM — `RetiredUtc IS NULL` on *all* SP reads will hide history

**Reported:** "All SP reads filter on `h.RetiredUtc IS NULL`."

Soft delete is right, and is what the brief asked for — but the point of it
(brief §5) is "so history and dependants survive". A blanket
`RetiredUtc IS NULL` on every read defeats that for any *historic* view:

- **RunViewer** renders completed runs. If its schedule join filters retired
  headers, a run booked against a since-retired schedule loses its schedule
  name — or the row drops out entirely if the join is inner.
- The rationalisation step that follows this work **retires 522 client
  schedules** (`summary.csv`). So this is not hypothetical: as soon as the merge
  runs, 522 schedules go retired and every historic run against them is exposed
  to this.
- `BulkZoneSchedule` rows hang off the day-row id. Retiring a header must not
  orphan them.

**Rule to apply:** filter `RetiredUtc IS NULL` on *selection* paths (what can I
book / what can I attach a client to). Do **not** filter it on *display of
existing records* paths.

**Test:** book a job against a schedule, retire that schedule, then open the run
in RunViewer. The schedule name must still render.

---

## 6. MEDIUM — confirm new day rows still write the legacy `ClientId`

Brief §5 is explicit:

> Keep writing the legacy `ClientId` on new day rows for now so anything still
> reading it keeps working; stop once nothing reads it.

The report does not mention it. If create-schedule stopped populating day-row
`ClientId`, every consumer still reading it breaks silently on newly created
schedules only — which is the worst failure shape, because existing data keeps
working and the bug surfaces days later.

**Test:** create a schedule through the new UI, then `SELECT ClientId FROM
tblBulkRunSchedule` for the new rows. Must be populated.

---

## 7. LOW — the Schedules tab filter inverts an existing control's meaning

**Reported:** "'Include client-specific' now means per-client only when ticked,
excluding defaults. Renamed to 'Client-specific only'."

The rename is good and the new semantics are defensible. Flagging only because
it is a behaviour change to an existing control that is not in the brief: an
operator who ticked that box yesterday to *widen* the list now *narrows* it.
Worth a line in the release note rather than a code change.

---

## Regression test set

Run before sign-off. Findings 1, 5 and 6 are the ones that reach customers.

### Booking (`_fncJob_GetClientAvailableBulkRunSchedule`, `uspPrebookSet`)

1. **Schedule-set parity, client WITH its own schedule.** Capture
   `GET API/Schedules/Clients/{id}` before and after for ~20 clients that have
   client-specific schedules. Sets must be identical. *Expected to FAIL on the
   UNION rule (finding 1).*
2. **Schedule-set parity, client with NONE of its own.** Same comparison. Must
   return the 119 defaults, unchanged.
3. **Ambiguous name.** Pick a client on one of the 48 names shared by a default
   and a client schedule. Confirm it resolves to the same definition as before.
4. **Variant name.** Pick one of the 164 names with differing definitions.
   Confirm the returned `CutoffHours` / `StartTime` / `SpeedId` match the
   pre-migration values for that client.
5. **Zone-rated booking, NZ and US.** Exercises Kerran's merged layer in both
   variants (finding 4).
6. **`uspPrebookSet` end to end** — place a prebook against a client-specific
   schedule and against a default, both territories.

### RunViewer

7. **Historic run against a retired schedule** renders the schedule name
   (finding 5).
8. **Run against a merged-away schedule** — after the later rationalisation
   retires 522 schedules, historic runs against them still render.
9. **Zone/linehaul offsets** still resolve — `BulkZoneSchedule.ScheduleId` keys
   on the day-row id, which the header FK must not have disturbed.

### Routed Operations

10. **Create schedule** → header, day rows with the FK, link row for the owning
    client, **and legacy day-row `ClientId` populated** (finding 6).
11. **Rename schedule** → clients still linked (brief §6).
12. **Attach then detach a second client** → link rows only, day rows untouched
    (brief §6).
13. **Delete schedule** → header retired, day rows and link rows intact.
14. **FK / PK enforcement** → link row to a non-existent schedule rejected;
    duplicate `(schedule, client)` rejected.
15. **Legacy fallback path** → call the endpoint with the name + `legacyClientId`
    tuple for an ambiguous name; confirm it does not silently pick one
    (finding 3).

### Migration

16. Run on staging with `@Commit = 0` first. Counts must be 2,725 headers /
    119 defaults / 11,110 day rows.
17. Both checks empty: link rows without an id, client schedules without a link
    row.
18. **Idempotency** — re-run on an already-migrated database; no duplicate
    headers, no duplicate link rows.
19. **Partial-failure retry** — kill mid-run, re-run, confirm clean.
20. **Confirm the two migrations cannot both apply** (finding 2, second-order).

## What is needed to finish this review

Any one of:

- read-only GitLab access to DBMigrationV2 + Routed Operations at Kevin's
  commits, or
- the 5 migration `.sql` files and the Routed Operations backend/frontend diff,
  or
- Kevin's branch pushed to the GitHub mirror.

With the source I can confirm findings 4-7, check the SP bodies line by line,
and verify the migration is genuinely idempotent across the three cases the
report claims (fresh apply, partial retry, repair).
