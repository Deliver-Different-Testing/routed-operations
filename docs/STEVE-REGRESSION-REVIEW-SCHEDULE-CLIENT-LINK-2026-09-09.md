---
title: Regression review — Kevin's schedule/client link rollout
date: 2026-09-09
revised: 2026-09-09 (v3 — reconciled against two independent source reviews)
audience: Steve, George, Kevin, Kerran
status: Findings verified against source; 4 live defects, 1 product decision
reviews: KEVIN-SCHEDULE-CLIENT-LINK-BY-SCHEDULE-ID-2026-09-08.md
baseline_migration: scripts/schedule-rationalisation/sql/001_schedule_header_and_id_keyed_links.sql
---

# Regression review — schedule/client link by ScheduleId

## Verification status

**v1** was written without sighting the source (Kevin's implementation is in
GitLab, not on the GitHub mirror), measured against the brief and the production
data profile.

**v2** incorporated Kerran's source review.

**v3** reconciles Kerran's review with Kevin's independent source review. The two
**disagree on findings 3 and 4a** — resolved below, in both cases because they
checked different layers. Kevin also ran the DB query finding 4b needed, closing
it, and turned up **two defects neither v1 nor Kerran caught**, one of which is
silent data loss.

Net: **four live defects**, one product decision, three latent hazards, one
closed.

| # | Finding | Verdict | Severity now |
|---|---|---|---|
| 6 | New day rows write `ClientId = null` | **CONFIRMED LIVE BUG** | **CRITICAL** |
| A | Postcode/polygon junctions orphaned on rename | **NEW — CONFIRMED LIVE** | **HIGH** |
| B | Migration step 4d wipes multi-client bindings | **NEW — SILENT DATA LOSS** | **HIGH** |
| 8 | `uspPrebookSet` resolves schedule-active by name | **CONFIRMED** (Kerran) | **HIGH** |
| 3 | Legacy tuple silently picks on ambiguity | **REINSTATED** — real in C# | **HIGH** |
| 1 | UNION vs the brief's ELSE | **CONFIRMED — deliberate** | Product decision |
| 2 | `BulkRunScheduleId` name collision | Latent, not live (both agree) | MEDIUM |
| 4a | NZ/US zone-layer difference | By design; latent if US enables | LOW |
| 5 | `RetiredUtc IS NULL` on reads | Correct today; codify the rule | LOW |
| 7 | Filter control inversion | By design | Release note |
| 4b | Renamed migration re-run risk | **CLOSED — safe** | — |

**Correction to v2:** v2 marked finding 3 refuted on Kerran's evidence. That was
a layer error — Kerran checked SQL, where there is indeed no fallback; Kevin
checked `ScheduleService`, where there are three. Finding 3 is real. Reinstated
below.

Migrations in the rollout:

- `20260908120000_AddScheduleHeaderAndIdKeyedLinks.sql` — header, day-row FK,
  link table re-key (step 4d wipes; step 4h deletes the safety-net rows)
- `20260908120001_uspPrebookSetScheduleIdKeyed.sql`
- `20260908120003_DD_fncJob_…ScheduleIdKeyed.sql` (US variant)
- `20260908180000_UTL_fncJob_ScheduleIdAndZoneMatch.sql` (NZ variant; was
  `120002` pre-CI)

Data profile (current production export):

| | |
|---|---|
| Day rows (`tblBulkRunSchedule`) | 11,110 |
| Schedules | 2,725 |
| … default (`ClientId` NULL) | 119 |
| … client-specific | 2,606 |
| Names with differing definitions | 164 |
| Names used by both a default and client schedules | 48 |

---

# Live defects

## 6. CRITICAL — new day rows are written with `ClientId = null`

**Confirmed by Kevin in source.** `ScheduleService.UpsertAsync` line 542 and
`CopyAsync` line 727 both set `ClientId = null` when creating day rows.

Brief §5 is explicit:

> Keep writing the legacy `ClientId` on new day rows for now so anything still
> reading it keeps working; stop once nothing reads it.

Known consumers still reading it: ClientManager `ScheduleService.GetByClient`,
booking `ScheduleService.GetRecurringScheduleIds`, and any legacy SP.

**Why this is the worst shape of bug:** it breaks *only on newly created
schedules*. All 11,110 existing day rows keep working, so nothing fails at
deploy. It surfaces days later, on the first schedule an operator creates, and
looks unrelated to the rollout.

**Fix:** `ClientId = header.LegacyClientId` at both sites.

**Test:** create a schedule through the new UI, `SELECT ClientId FROM
tblBulkRunSchedule` for the new rows. Must be populated. Repeat for copy.

---

## A. HIGH (NEW) — postcode and polygon junctions are silently orphaned on rename

**Found by Kevin. Neither v1 nor Kerran caught this.**

`ScheduleService.SyncPostcodesAsync(header.Name, …)` line 838 and
`SyncPolygonsAsync(header.Name, …)` line 855 both key on the **current** header
name. Rename a schedule `Foo` → `Bar` and `SyncPostcodesAsync("Bar", …)` never
sees the `ScheduleName = 'Foo'` rows. The existing bindings are orphaned, the
caller is handed a "fresh" empty list, and everything gets re-added under the
new name.

This is the exact failure mode the brief exists to eliminate — a name used as a
key, silently detaching dependants on rename (brief §2) — surviving in two
junctions that were out of scope for the id re-shape (brief §1). It also
undercuts brief §6's rename-safety acceptance criterion in spirit, even though
that criterion is worded about client links.

**Fix:** either cascade the rename (`UPDATE ScheduleName` old → new before the
sync) or port both junctions to `BulkRunScheduleId` in a follow-up MR. The
cascade is the smaller change; the port is the correct one.

**Test:** create a schedule with postcodes 1000 + 1001. Rename it. Edit again.
Expected: postcodes still bound. Actual today: bindings lost, list empty.

---

## B. HIGH (NEW) — migration step 4d silently discards multi-client bindings

**Found by Kevin. Raised here one level above his MEDIUM — see below.**

`20260908120000_AddScheduleHeaderAndIdKeyedLinks.sql` step 4d runs an
**unconditional `DELETE FROM tblScheduleClient`** on fresh apply, then
repopulates one row per header where `LegacyClientId IS NOT NULL`.

Any multi-client binding the Routed Operations UI wrote to `tblScheduleClient`
between **2026-08-25** (when the junction was created) and the apply date is
discarded. Repopulation only restores the 1:1 legacy relationships — a schedule
an operator attached a *second* client to comes back with that second client
gone.

Kevin verified the table was empty pre-wipe on `urgent-staging`. That clears
staging only. Any production tenant that took the 2026-08-25 junction **and** had
operator activity on it loses those rows.

**Why HIGH rather than MEDIUM:** it is unrecoverable operator work, it is
silent, and **no assertion in the migration catches it**. The migration prints
counts and two checks, and a wiped multi-client binding passes all of them — the
post-state looks perfectly consistent. Nobody finds out until an operator asks
why a client fell off a schedule.

**Fix, before any further tenant applies:**

1. On every tenant not yet migrated, capture the pre-state:
   ```sql
   SELECT * FROM dbo.tblScheduleClient;
   ```
   Keep it. This is the only copy.
2. Add an assertion to step 4d that hard-fails if `tblScheduleClient` contains
   any row not reproducible from `LegacyClientId` — i.e. any genuine
   multi-client binding — rather than deleting it.
3. For tenants already migrated, reconcile against backups taken before the
   apply date.

---

## 8. HIGH — `uspPrebookSet` resolves schedule-active checks by name

**Found by Kerran in source. Not yet confirmed by Kevin — flagged for him.**

`20260908120001_uspPrebookSetScheduleIdKeyed.sql` is named for id-keying, but
all six schedule-active checks resolve by name:

```sql
WHERE h.Name = @CurScheduleName
```

at lines 254, 363, 434, 476, 502, 534. `jb.ScheduleID` is fetched into
`@CurScheduleID` but used only as a boolean gate
(`ISNULL(@CurScheduleID, 0) > 0`), never in a join.

This is compatible with Kevin's finding 1 note that `uspPrebookSet` implements
the UNION rule — the *resolution rule* and the *schedule-active checks* are
different parts of the SP. Kevin's review did not cover these six sites.

If it holds, the 164-name / 48-shared-name ambiguity is the everyday path for
every recurring booking re-book, in the exact SP the brief names — and the
filename asserts the opposite of what the file does, so an auditor reading the
migration list concludes prebook is id-keyed when it is not.

**Kevin: please confirm or refute those six line numbers.** If confirmed this is
a re-do of `120001`, resolving via `jb.ScheduleID` → header at all six sites.

**Test:** client on one of the 48 shared names, with a recurring booking.
Re-book. Must resolve to the same definition as pre-rollout.

---

## 3. HIGH — the legacy tuple silently picks the first match on ambiguity

**REINSTATED.** v2 marked this refuted on Kerran's evidence; Kerran checked SQL,
where there is no such fallback. Kevin checked `ScheduleService`, where there
are three sites:

- `DeleteAsync(name, legacyClientId)` line 619
- `CopyAsync` lines 650-654
- `ToggleAutoBookAsync(name, legacyClientId)` line 800

All three:

```csharp
.FirstOrDefaultAsync(h => h.Name == trimmed && h.LegacyClientId == legacyClientId && …)
```

`FirstOrDefault` on an ambiguous key: **silently picks one, no log, no throw.**
With 164 names mapping to multiple definitions in production, this fires
precisely when the tuple is ambiguous — and the operations are `Delete`, `Copy`
and `ToggleAutoBook`. A silent wrong pick on `DeleteAsync` retires the wrong
schedule.

**Fix:** hard-fail on more than one match rather than picking; log every use of
the legacy path. Then check the log before the release that removes it — if it
never fires, removal is free.

---

# Product decision

## 1. UNION vs the brief's ELSE — Steve's call

**Confirmed by both reviewers. Deliberate, documented, not a bug.**

All three SPs (`uspPrebookSet`, `UTL_fncJob_…`, `DD_fncJob_…`) implement
`EXISTS (SELECT 1 FROM tblScheduleClient sc WHERE …) OR h.IsDefault = 1`.
Routed Operations `ScheduleService.ListSummaryAsync` line 169 does the same
in-memory: `linkedHeaderIds.Contains(…) || headersById[…].IsDefault`.

Recorded in `.claude/sp-reference/schedule-id-migration-2026-09-08.md` under
"Resolution rule (UNION, revised 2026-09-08)". Kevin's mental model: *defaults
are for everyone always*, not *defaults are the fallback when nothing else is
bound*.

Trigger on the record: on the first NZ apply an operator opened a default
schedule and saw 268 pre-checked client chips, because the ELSE rule's
28k-row safety-net INSERT had materialised every default × every client.

**Both reviewers agree the ELSE rule achieves the same UI outcome without the
safety-net rows**, and that UNION genuinely widens booking for the 2,606
clients that already have their own schedule — brief §6 test 1 fails as
predicted.

So the choice is clean and it is Steve's:

- **Revert to ELSE** — matches the brief, no behaviour change for any client,
  UI problem solved by not materialising default link rows.
- **Keep UNION** — accept that every client can also book the 119 defaults.
  A change to what customers can book. If taking this, run the before/after
  client-schedule-count comparison first; it was never run.

---

# Latent hazards

## 2. MEDIUM — the `BulkRunScheduleId` name collision

Both reviewers agree: **real, not live.** `tblBulkRunSchedule.BulkRunScheduleId`
is the day-row PK; `tblBulkRunScheduleHeader.BulkRunScheduleId` is the header
PK. A join written `ON sc.BulkRunScheduleId = s.BulkRunScheduleId` compiles and
silently returns wrong rows.

Kevin grepped Routed Operations and `DBMigrationV2/Migrations/2026*.sql` for
that shape: zero matches. Kerran confirmed every shipped join uses the distinctly
named `s.BulkRunScheduleGroupId`. The trap is documented in the migration header
and the sp-reference doc.

Documentation does not stop the next developer writing the wrong join. Rename to
distinct names while the surface is small, or accept a permanent tax.

**Second-order, unchanged and real:** `001_schedule_header_and_id_keyed_links.sql`
targets `tblBulkRunScheduleClient` and adds a `ScheduleId` column. Run after
Kevin's on the same tenant it builds a **parallel second** header/link
structure. Retire one before either touches an environment that has seen the
other.

## 4a. LOW — NZ has the zone layer, US does not

Reviewers differed in framing; the facts reconcile.

The NZ variant (`20260908180000`) carries `ZoneRated` /
`UTL_fncBulkZonePostcode_IsActive` — 6 references, byte-identical to Kerran's
`170731` at all four sites (Kerran diffed them). The US variant (`120003`) has
zero references to that mechanism; it has its own zone check (`ZoneZip` /
`pickupPZ`, from the July `AmericanScheduleTimesFix`), also preserved verbatim.

These were never parallel implementations, so nothing drifted in this rollout —
Kerran's original fix was NZ-only by design. Kevin adds the mitigation: the US
tenant `mssql-dfrnt` has the `ZoneRated` column but **zero speeds with
`ZoneRated = 1`**, so the filter would be a no-op there today.

**Latent trigger:** the day a US tenant marks a speed `ZoneRated = 1`, US gets no
zone filtering from this path. Worth a note in the sp-reference doc rather than
code today.

## 5. LOW — `RetiredUtc IS NULL` is correct today; codify the rule

Kevin verified via `sys.sql_modules` that only the three schedule-selection SPs
reference `tblBulkRunScheduleHeader`. All three are "what can I book" selection
paths, where the filter is correct. **No display-path SP joins the header at
all** — RunViewer and historic rendering read `tucJob.ScheduleName` directly.

So v1's specific RunViewer regression does not manifest. Also confirmed:
`BulkZoneSchedule.ScheduleId` keys on the day-row PK, not the header, so
retiring a header orphans nothing.

The caution still holds for the future: the next person adding a display-path SP
that joins the header will copy the same `RetiredUtc IS NULL` pattern and hit
exactly the predicted bug — and the rationalisation retires **522** schedules,
so there will be plenty to hit. Codify in the sp-reference doc: filter
`RetiredUtc IS NULL` on *selection* paths; never on *display of existing
records*.

## 7. Release note — the Schedules tab filter inversion

"Include client-specific" now means per-client only when ticked, excluding
defaults; renamed "Client-specific only". Kevin's explicit call, documented.
Release-note line: an operator who ticked that box to *widen* the list now
*narrows* it.

---

# Closed

## 4b. CLOSED — the `120002` → `180000` rename is safe

Kevin ran the check. `git log --all -- …20260908120002_*` returns nothing — the
file was never committed under the old name. `SchemaVersions` on `urgent-staging`
and US has zero rows referencing `120002`, `ScheduleIdKeyed` or
`AddScheduleHeader`. The rename happened pre-first-CI; no tenant ever saw the old
name. No risk.

---

# Recommended order of work

Phase 1 staging is due **2026-09-14** — five days.

**Before any further tenant applies migration `20260908120000`:**

1. **B** — capture `SELECT * FROM tblScheduleClient` on every un-migrated
   tenant, and add the step 4d assertion. This is the only irreversible item on
   the list.

**Blockers for Phase 1:**

2. **6** — one-line fix at two sites (`ClientId = header.LegacyClientId`).
3. **A** — rename cascade for the postcode/polygon junctions.
4. **8** — pending Kevin's confirmation; if confirmed, a re-do of `120001`.
5. **1** — Steve's decision. If reverting to ELSE, it lands in the same pass as 8.

**Fast-follow:**

6. **3** — hard-fail + log on the legacy tuple.
7. **2** — rename decision, and retire one of the two competing migrations.
8. **4a, 5** — sp-reference doc notes.
9. **7** — release note.

---

# Regression test set

## Booking

1. **Recurring re-book on an ambiguous name** — client on one of the 48 shared
   names. Must resolve to the pre-rollout definition. *Fails on finding 8.*
2. **Schedule-set parity, client WITH its own schedule** —
   `GET API/Schedules/Clients/{id}` before/after for ~20 such clients. Sets
   identical. *Fails on finding 1 while UNION stands.*
3. **Schedule-set parity, client with NONE of its own** — the 119 defaults,
   unchanged.
4. **Variant name** — one of the 164. `CutoffHours` / `StartTime` / `SpeedId`
   match pre-migration values for that client.
5. **Zone-rated booking, NZ** (`ZoneRated`) **and US** (`ZoneZip` / `pickupPZ`).
6. **`uspPrebookSet` end to end** — client-specific and default, both
   territories.

## Routed Operations

7. **Create schedule** → header, day rows with FK, link row, **and legacy
   day-row `ClientId` populated** (finding 6). Repeat for **copy**.
8. **Rename schedule** → clients still linked (brief §6) **and postcodes /
   polygons still bound** (finding A).
9. **Attach then detach a second client** → link rows only, day rows untouched.
10. **Delete schedule with an ambiguous name** → retires the *intended*
    schedule, not the first match (finding 3).
11. **FK / PK enforcement** → link row to a non-existent schedule rejected;
    duplicate `(schedule, client)` rejected.

## RunViewer

12. **Historic run against a retired schedule** renders the schedule name.
    Expected to pass today (finding 5) — this is the guard test for later.
13. **Zone/linehaul offsets** still resolve.

## Migration

14. **Multi-client binding preservation** — seed `tblScheduleClient` with a
    genuine second-client row, apply, confirm it survives (finding B).
    *Fails today.*
15. Staging with `@Commit = 0` first. Counts: 2,725 headers / 119 defaults /
    11,110 day rows.
16. Both checks empty: link rows without an id, client schedules without a link
    row.
17. **Idempotency** — re-run on a migrated database; no duplicate headers or
    link rows.
18. **Partial-failure retry** — kill mid-run, re-run, confirm clean.
19. **Confirm the two competing migrations cannot both apply** (finding 2,
    second-order).

---

## Open items

- **Kevin** to confirm or refute finding 8's six line numbers in `120001`.
- **Steve** to call finding 1 (UNION vs ELSE).
- Findings 5 and 7 were verified by Kevin against source; findings 2 and 4a are
  agreed by both reviewers. No item now rests on the report alone.
