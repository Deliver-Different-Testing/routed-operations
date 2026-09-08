---
title: Regression review — Kevin's schedule/client link rollout
date: 2026-09-09
revised: 2026-09-09 (v2 — verified against source by Kerran)
audience: Steve, George, Kevin, Kerran
status: Findings verified against source; three decisions open for Steve
reviews: KEVIN-SCHEDULE-CLIENT-LINK-BY-SCHEDULE-ID-2026-09-08.md
baseline_migration: scripts/schedule-rationalisation/sql/001_schedule_header_and_id_keyed_links.sql
---

# Regression review — schedule/client link by ScheduleId

## Verification status

**v1** was written without sighting the source — Kevin's implementation is not on
the GitHub mirror, only in GitLab (DBMigrationV2 + Routed Operations). Findings
were measured against the brief and the production data profile.

**v2** incorporates Kerran's line-by-line source review (2026-09-09). Every v1
finding now carries a verdict. One finding is refuted, one is downgraded, and
the source turned up a **new critical defect that is worse than what was
reported** — see finding 8.

| # | v1 finding | Verdict against source |
|---|---|---|
| 1 | UNION vs ELSE resolution rule | **CONFIRMED** — deliberate, at every site |
| 2 | `BulkRunScheduleId` key collision | **LARGELY REFUTED** — no live bug; latent hazard stands |
| 3 | Legacy `(name, clientId)` fallback | **REFUTED AS REPORTED** — superseded by finding 8 |
| 4 | NZ/US zone-layer drift | **REFUTED** — byte-identical; never parallel logic |
| 4b | Renamed migration re-run risk | **OPEN** — needs a DB query |
| 5 | `RetiredUtc IS NULL` hides history | **OPEN** — not yet checked |
| 6 | Legacy day-row `ClientId` writes | **OPEN** — not yet checked |
| 7 | Filter control inversion | **OPEN** — cosmetic |
| 8 | `uspPrebookSet` never switched to id resolution | **NEW — CRITICAL** |

Migrations in the rollout:

- `20260908120000` — header, day-row FK, link table re-key (step 4h deletes the
  default safety-net rows)
- `20260908120001_uspPrebookSetScheduleIdKeyed.sql`
- `20260908120002` — renamed to `20260908180000_UTL_fncJob_ScheduleIdAndZoneMatch.sql`
- `20260908120003` — `DD_fncJob…` (US variant)
- `20260908180000_UTL_fncJob_ScheduleIdAndZoneMatch.sql` (NZ variant, final)

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

## 8. CRITICAL (NEW) — `uspPrebookSet` never switched to id resolution, despite the migration's name

Found by Kerran in source. This did not appear in the rollout report at all.

`20260908120001_uspPrebookSetScheduleIdKeyed.sql` is named for id-keying, but
**all six schedule-active checks still resolve by name**:

```sql
WHERE h.Name = @CurScheduleName
```

at lines 254, 363, 434, 476, 502 and 534. `jb.ScheduleID` *is* fetched into
`@CurScheduleID` — but only ever used as a boolean gate
(`ISNULL(@CurScheduleID, 0) > 0`), never in a join.

**Why this is worse than v1 finding 3.** v1 flagged the name tuple as a
*temporary fallback retained for one release*. It is not a fallback. It is the
**permanent, everyday resolution path for every recurring booking re-book**, in
the exact stored procedure the brief was written to fix. The 164 ambiguous names
and 48 names shared between a default and client schedules are live on the
primary path, not a contingency.

**Compounding:** the filename asserts the opposite of what the file does.
Anyone auditing the migration list sees `uspPrebookSetScheduleIdKeyed` and
reasonably concludes prebook is id-keyed. It is not.

**Recommendation:** this is a re-do of `20260908120001`, not a tweak. Resolve
via `jb.ScheduleID` → header, at all six sites. Until that ships, the brief's
core objective is unmet for prebook — which is the highest-volume path in the
system.

**Test:** take a client on one of the 48 names shared by a default and a client
schedule, with a recurring booking. Re-book it. Confirm it resolves to the same
schedule definition it used before the rollout.

---

## 1. CRITICAL — the UNION resolution rule contradicts the brief and widens booking

**Verdict: CONFIRMED in source, and deliberate.**
`20260908120001_uspPrebookSetScheduleIdKeyed.sql` and
`20260908180000_UTL_fncJob_ScheduleIdAndZoneMatch.sql` both use
`EXISTS(link) OR h.IsDefault = 1` at every site. The migration header comment
states the reasoning almost verbatim to v1's reconstruction of it: the
ELSE-shaped safety-net INSERT made the operator UI show 268 pre-checked clients
on default schedules, so the rule was flipped to UNION and the safety-net rows
deleted in `20260908120000` step 4h.

**Brief §3 (the only rule the code should implement):**

> A client's schedules are the live headers (`RetiredUtc IS NULL`) it has a link
> row for. **If it has none**, its schedules are the live headers with
> `IsDefault = 1`.

That is `ELSE`, not `OR`. The two differ for exactly one population: clients
that have a schedule of their own. Under the brief they see only their own.
Under UNION they additionally see all 119 default schedules.

**Blast radius:** all 2,606 client-specific schedules. Those clients get up to
119 extra options in the booking-time schedule picker. This surfaces to
customers, not just operators.

**This fails the brief's own acceptance test**, §6 — "every existing client
still gets exactly the schedules it had". Under UNION that comparison cannot
pass for a client that has its own schedule.

**The stated justification does not hold.** Both symptoms — the 28k-row
safety-net INSERT and the 268 clients on every default — are consequences of
*materialising link rows for defaults*, not of the fallback rule. The fallback
needs no rows at all:

```sql
IF EXISTS (SELECT 1 FROM tblScheduleClient WHERE ClientId = @ClientId)
    -- linked headers only
ELSE
    -- headers WHERE IsDefault = 1
```

Zero inserted rows, and no client appears on a default schedule in the UI. The
UI problem is real and is solved by the fallback, not by UNION.

Kerran's review confirms the decision was made **without** the before/after
client-schedule-count comparison the brief's acceptance criteria require. So the
scope of the behaviour change was never measured before it shipped.

**Recommendation:** revert to `ELSE`, keep the safety-net rows deleted. If UNION
is genuinely wanted as a product decision — "clients can always also book the
defaults" — that is Steve's call to make explicitly, with the before/after
counts on the table.

---

## 2. LATENT HAZARD (downgraded from HIGH) — the `BulkRunScheduleId` name collision

**Verdict: largely refuted for the shipped code.** v1 asserted a live
wrong-key join risk. Kerran checked every join site in both availability
functions and `uspPrebookSet`: the day-row → header join is
`s.BulkRunScheduleGroupId`, distinctly named. **No instance of the naive
wrong-key join exists in what shipped.** The migration file calls the trap out
explicitly ("Two columns share the name `BulkRunScheduleId` but on different
tables… day-row.`BulkRunScheduleId` is NOT header.`BulkRunScheduleId`").

So: no live bug. v1 overstated this.

**What still stands.** The landmine is real and un-renamed.
`tblScheduleClient.BulkRunScheduleId` points at the *header*, while
`tblBulkRunSchedule.BulkRunScheduleId` is a *day row* — two key spaces, one
column name, heavily overlapping id ranges. Kevin navigated it correctly and
documented it. The next person writing a join has to read that comment to avoid
silently returning wrong rows, and nothing enforces that they do.

**Recommendation:** rename to the brief's names (`ScheduleId` throughout,
`tblBulkRunScheduleClient`) while the surface is still small. If the rename is
refused, this stays a permanent tax on every future query against these tables.
Not a release blocker.

**Second-order (unchanged):** the baseline migration
`001_schedule_header_and_id_keyed_links.sql` targets `tblBulkRunScheduleClient`
and adds a `ScheduleId` column. Run after Kevin's it will not detect his tables
and will build a **parallel second** header/link structure. One of the two must
be retired before either touches an environment that has seen the other.

---

## 3. REFUTED AS REPORTED — superseded by finding 8

v1 flagged a retained legacy `(name, legacyClientId)` fallback "for one release".
No such separate fallback exists in source. The reality is worse, not milder:
name resolution is the primary path in `uspPrebookSet`. See **finding 8**.

---

## 4. REFUTED — no NZ/US zone-layer drift

**Verdict: refuted.** Kerran byte-diffed the zone-rated block
(`170731:125-153` and the other sites) against Kevin's final `180000` body:
**identical at all four sites.**

The premise of v1's concern was also wrong. The US variant (`DD_fncJob`,
`20260908120003`) never had the NZ `ZoneRated` /
`UTL_fncBulkZonePostcode_IsActive` mechanism. It has its own separate zone check
(`ZoneZip` / `pickupPZ`, from the July `AmericanScheduleTimesFix`), which is
also preserved verbatim in the new body. These were never parallel
implementations of the same logic, so there is nothing to drift.

No action.

---

## 4b. OPEN — was `20260908120002` recorded as applied before the rename?

The only part of finding 4 still live. The file was renamed
`20260908120002` → `20260908180000` to order it after Kerran's `170731`. If DbUp
journalled the **old** name in any environment before the rename, that
environment will now re-run the script under its new name (or skip it,
depending on which name landed).

Needs a DB query per environment — SELECT only:

```sql
SELECT ScriptName, Applied
FROM dbo.SchemaVersions
WHERE ScriptName LIKE '%2026090812000%'
   OR ScriptName LIKE '%20260908180000%'
ORDER BY Applied;
```

Both names present for the same script = the double-apply case. Run on staging
and on any tenant DB that has seen a 2026-09-08 deploy.

---

## 5. OPEN — `RetiredUtc IS NULL` on *all* SP reads will hide history

Not yet checked against source.

Soft delete is right and is what the brief asked for — but the point of it
(brief §5) is "so history and dependants survive". A blanket
`RetiredUtc IS NULL` on every read defeats that for any *historic* view:

- **RunViewer** renders completed runs. If its schedule join filters retired
  headers, a run booked against a since-retired schedule loses its schedule
  name — or drops out entirely if the join is inner.
- The rationalisation that follows this work **retires 522 client schedules**
  (`summary.csv`). Not hypothetical: as soon as the merge runs, every historic
  run against those 522 is exposed.
- `BulkZoneSchedule` rows hang off the day-row id. Retiring a header must not
  orphan them.

**Rule to apply:** filter `RetiredUtc IS NULL` on *selection* paths (what can I
book / attach a client to). Do **not** filter it on *display of existing
records* paths.

**Test:** book a job against a schedule, retire that schedule, open the run in
RunViewer. The schedule name must still render.

---

## 6. OPEN — confirm new day rows still write the legacy `ClientId`

Not yet checked against source. Brief §5 is explicit:

> Keep writing the legacy `ClientId` on new day rows for now so anything still
> reading it keeps working; stop once nothing reads it.

The report does not mention it. If create-schedule stopped populating day-row
`ClientId`, consumers still reading it break **only on newly created
schedules** — the worst failure shape, because existing data keeps working and
the bug surfaces days later.

**Test:** create a schedule through the new UI, then `SELECT ClientId FROM
tblBulkRunSchedule` for the new rows. Must be populated.

---

## 7. LOW — the Schedules tab filter inverts an existing control's meaning

"Include client-specific" now means per-client only when ticked, excluding
defaults; renamed to "Client-specific only". The rename is good and the new
semantics are defensible. Flagged only because it is a behaviour change to an
existing control that is not in the brief: an operator who ticked that box
yesterday to *widen* the list now *narrows* it. Release-note line, not a code
change.

---

## Decisions for Steve

1. **UNION vs ELSE** (finding 1) — revert to the brief, or accept UNION as a
   deliberate product change to what customers can book? If accepting, get the
   before/after client-schedule-count comparison first; it was never run.
2. **`uspPrebookSet` re-do** (finding 8) — this is the brief's core objective
   unmet on the highest-volume path. Blocker for Phase 1 staging (due
   2026-09-14) or a fast-follow?
3. **Rename now or live with it** (finding 2) — `ScheduleId` /
   `tblBulkRunScheduleClient` while the surface is small, or accept the
   permanent naming tax and retire one of the two competing migrations.

---

## Regression test set

Findings 8, 1, 5 and 6 are the ones that reach customers.

### Booking (`_fncJob_GetClientAvailableBulkRunSchedule`, `uspPrebookSet`)

1. **Recurring re-book on an ambiguous name** — client on one of the 48 names
   shared by a default and a client schedule, with a recurring booking. Re-book
   and confirm the same schedule definition as pre-rollout. *Expected to FAIL on
   finding 8.*
2. **Schedule-set parity, client WITH its own schedule.** Capture
   `GET API/Schedules/Clients/{id}` before and after for ~20 clients that have
   client-specific schedules. Sets must be identical. *Expected to FAIL on
   finding 1.*
3. **Schedule-set parity, client with NONE of its own.** Must return the 119
   defaults, unchanged.
4. **Variant name.** One of the 164 names with differing definitions. Confirm
   returned `CutoffHours` / `StartTime` / `SpeedId` match the pre-migration
   values for that client.
5. **Zone-rated booking, NZ** (`ZoneRated` / `UTL_fncBulkZonePostcode_IsActive`)
   **and US** (`ZoneZip` / `pickupPZ`). Both mechanisms confirmed preserved in
   source — this is the runtime check.
6. **`uspPrebookSet` end to end** — prebook against a client-specific schedule
   and against a default, both territories.

### RunViewer

7. **Historic run against a retired schedule** renders the schedule name
   (finding 5).
8. **Run against a merged-away schedule** — after the rationalisation retires
   522 schedules, historic runs against them still render.
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

### Migration

15. **DbUp journal check** for the `120002` → `180000` rename (finding 4b), on
    staging and every tenant DB that has seen a 2026-09-08 deploy.
16. Run on staging with `@Commit = 0` first. Counts must be 2,725 headers /
    119 defaults / 11,110 day rows.
17. Both checks empty: link rows without an id, client schedules without a link
    row.
18. **Idempotency** — re-run on an already-migrated database; no duplicate
    headers, no duplicate link rows.
19. **Partial-failure retry** — kill mid-run, re-run, confirm clean.
20. **Confirm the two competing migrations cannot both apply** (finding 2,
    second-order).

## Still unsighted

Findings 5, 6 and 7 have not been checked against source. Read-only GitLab
access to DBMigrationV2 + Routed Operations, or the relevant diffs, would close
them.
