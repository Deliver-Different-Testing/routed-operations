---
title: Regression review — Kevin's schedule/client link rollout
date: 2026-09-09
revised: 2026-09-09 (v5 — A3 confirmed and promoted; Kerran signed off on ranking)
audience: Steve, George, Kevin, Kerran
status: Findings verified against source; 5 live defects, 1 product decision
reviews: KEVIN-SCHEDULE-CLIENT-LINK-BY-SCHEDULE-ID-2026-09-08.md
baseline_migration: scripts/schedule-rationalisation/sql/001_schedule_header_and_id_keyed_links.sql
---

# Regression review — schedule/client link by ScheduleId

## Verification status

**v1** was written without sighting the source (Kevin's implementation is in
GitLab, not on the GitHub mirror), measured against the brief and the production
data profile.

**v2** incorporated Kerran's source review.

**v3** reconciled Kerran's review with Kevin's independent source review. The two
**disagreed on findings 3 and 4a** — resolved below, in both cases because they
checked different layers. Kevin also ran the DB query finding 4b needed, closing
it, and turned up **two defects neither v1 nor Kerran caught**.

**v4** folded in Kerran's final analysis, escalating the postcode/polygon finding
and raising **A3** as an unverified inference.

**v5** — Kerran confirmed A3 from the EF model, and it is **worse than v4
framed it**. It is not a risk that same-named schedules *might* share bindings:
the composite primary key makes them **the same row**. It is true in production
today, needs no rename and no further migration to trigger, and it is now the
top item. Kerran has signed off on this ranking. v5 also corrects v4's
overstatement that finding 4b is fully closed.

Net: **five live defects**, one product decision, three latent hazards.

| # | Finding | Verdict | Severity now |
|---|---|---|---|
| A3 | Postcode/polygon PK is `(ScheduleName, …)` | **CONFIRMED — true today** | **CRITICAL** |
| 6 | New day rows write `ClientId = null` | **CONFIRMED ×2** | **CRITICAL** |
| A1/A2 | Rename orphans / mis-attaches bindings | **CONFIRMED ×2** | **CRITICAL** |
| B | Migration step 4d wipes multi-client bindings | **CONFIRMED ×2 — data loss** | **HIGH** |
| 8 | `uspPrebookSet` resolves schedule-active by name | **CONFIRMED** (Kerran) | **HIGH** |
| 3 | Legacy tuple silently picks on ambiguity | **CONFIRMED — API-reachable** | **HIGH** |
| 1 | UNION vs the brief's ELSE | **CONFIRMED — deliberate** | Product decision |
| 2 | `BulkRunScheduleId` name collision | Latent, not live (both agree) | MEDIUM |
| 4a | NZ/US zone-layer difference | By design; latent if US enables | LOW |
| 5 | `RetiredUtc IS NULL` on reads | Correct today; codify the rule | LOW |
| 7 | Filter control inversion | **CONFIRMED** — by design | Release note |
| 4b | Renamed migration re-run risk | Git half confirmed; DB half single-sourced | LOW |

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

## A3. CRITICAL — same-named schedules share one postcode/polygon set, by primary key

**Confirmed by Kerran from the EF model.** v4 raised this as an inference to
check. It is confirmed, and the mechanism is more absolute than v4 suggested.

`DespatchContext.cs:249-256`:

```csharp
// Postcode + polygon junctions still keyed on ScheduleName (out of scope for this MR)
modelBuilder.Entity<SchedulePostcode>(entity => { entity.HasKey(e => new { e.ScheduleName, e.PostCode }); });
modelBuilder.Entity<SchedulePolygon>(entity => { entity.HasKey(e => new { e.ScheduleName, e.PolygonId }); });
```

There is **no client column and no schedule-id column on either table.**

So this is not "two same-named schedules might read each other's rows". The
primary key is `(ScheduleName, PostCode)`. Two schedules sharing a name
**structurally cannot hold different postcode sets — they are the same row.**

Against production data: **164 names map to multiple definitions** and **48
names are shared between a default and client schedules**. Every one of those
groups is currently sharing a single postcode and polygon binding across
schedules that are, operationally, different schedules.

**This is present tense.** It needs no rename, no further migration, and no
future trigger. It is true in production right now. That is why it sits above
finding B: B is damage the *next* apply would do; A3 is damage already done.

**In fairness to the rollout:** the code comment says "out of scope for this
MR", and brief §1 does place these junctions out of scope. This is not something
Kevin broke. But the brief's entire thesis is that `ScheduleName` cannot carry
identity — and the id re-shape was applied to one of four binding types while
two others sit on a primary key that makes the ambiguity structural. Leaving
them was a reasonable scope call for the MR; leaving them *and* shipping is not.

**The hard part of the fix.** Porting these junctions to `BulkRunScheduleId` is
not a mechanical re-key. For the 164 duplicate-name groups **the data to
disambiguate does not exist** — the rows were never stored separately, so
nothing records which schedule owned which postcode. Re-keying will need, per
collision, either an operator decision or a rule (e.g. copy the shared set to
every schedule in the group, then let ops prune). Budget for that; it is not a
one-day task, and it gets more expensive as more schedules are created.

**Test:** find two live schedules sharing a name with different definitions.
Open both in the UI and compare their postcode lists. Expected today: identical,
because it is one row. Change one; the other changes too.

---

## 6. CRITICAL — new day rows are written with `ClientId = null`

**Confirmed independently by Kevin and Kerran.** `ScheduleService.UpsertAsync`
lines 539-545 and `CopyAsync` line 727 set `ClientId = null` on every new day
row, **unconditionally** — regardless of `req.ClientIds` / `req.ClientCodes`.

Kerran traced where those resolved client ids actually go: into
`SyncClientsAsync` → the new `tblScheduleClient` junction (line 589), and
nowhere else. They never flow back onto `TblBulkRunSchedule.ClientId`. So this
is not a missed edge case — the legacy column was simply dropped from the write
path.

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

## A. CRITICAL — postcode and polygon bindings were never id-keyed at all

**Found by Kevin, then independently by Kerran with a sharper reading that
escalates it.** Neither v1 nor v2 caught this.

`SyncPostcodesAsync` / `SyncPolygonsAsync` (`ScheduleService.cs:838-869`) and
**their read sites** key strictly on the name:

```csharp
Context.SchedulePostcodes.Where(x => x.ScheduleName == name)
```

The underlying domain models `SchedulePostcode` / `SchedulePolygon`
(`ScheduleGroupJunctions.cs`) are **untouched by this migration**.

So the rollout id-keyed **one of the four binding types**. The client link was
fixed; postcode and polygon were left on the string key that the entire brief
exists to eliminate. That is the headline: this is not a bug inside the new
design, it is the new design not having been applied.

Three consequences, in increasing order of nastiness.

**A1 — rename orphans the bindings (live today).** `UpsertAsync` permits
renaming a header (lines 493-494, cascading to day rows) and then calls both
syncs with the **new** name. `SyncPostcodesAsync("Bar", …)` never sees the
`ScheduleName = 'Foo'` rows. The old bindings are stranded under the old name,
the caller is handed a "fresh" empty list, and the desired set is re-added under
the new name. Operator work silently lost.

**A2 — a later rename can attach the *wrong* set (Kerran).** The stranded `Foo`
rows are still in the table. Production has **164 names mapping to multiple
definitions**. The day any schedule is renamed *to* `Foo` — or a new one is
created with that name — it silently inherits the orphaned postcode/polygon set
belonging to a completely different schedule. Not lost data: **wrong data**,
presented as correct. This is precisely the ambiguity class the migration was
written to close, left open on two of four binding types.

**A3 — same-named schedules already share one binding set.** Confirmed and
promoted to its own finding above; it is the root cause of A1 and A2 rather than
a consequence of them.

**The cheap fix is unsafe on this data.** A rename cascade
(`UPDATE ScheduleName` old → new before the sync) fixes A1 but *worsens* A2 —
and given A3's composite primary key it does not merely produce wrong data, it
collides on the key itself: if a schedule named `Bar` already has postcode 1000,
cascading `Foo` → `Bar` hits an existing `(Bar, 1000)` row. With 48 names shared
between a default and client schedules, that will happen. **Do not ship the
cascade alone.** The correct fix is to port both junctions to
`BulkRunScheduleId` — with the caveat under A3 that the disambiguating data does
not exist for the 164 duplicate-name groups.

**Test:** create a schedule with postcodes 1000 + 1001. Rename it. Edit again.
Expected: still bound. Actual today: lost. Then create a second schedule under
the original name and confirm it does **not** inherit the stranded set.

---

## B. HIGH (NEW) — migration step 4d silently discards multi-client bindings

**Found by Kevin, mechanism independently confirmed by Kerran from the migration
file. Raised here one level above Kevin's MEDIUM — see below.**

`20260908120000_AddScheduleHeaderAndIdKeyedLinks.sql` step 4d runs
`DELETE FROM tblScheduleClient`, guarded on `BulkRunScheduleId` still being
nullable — which is true on fresh apply, so on a fresh apply it always fires.
The repopulate step then inserts **one row per header from `LegacyClientId`**,
and only that. It has no mechanism to recover a second client bound through the
UI.

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

Kerran's line references: `613, 619` (Delete), `794, 800` (ToggleAutoBook),
`650-654` (Copy).

`FirstOrDefault` on an ambiguous key: **silently picks one, no log, no throw.**
With 164 names mapping to multiple definitions in production, this fires
precisely when the tuple is ambiguous — and the operations are `Delete`, `Copy`
and `ToggleAutoBook`. A silent wrong pick on `DeleteAsync` retires the wrong
schedule.

**How exposed is it?** `SchedulesController.cs:132-153` wires both the
`scheduleId` path and the name/`legacyClientId` fallback to the same DELETE
route, commented "Preferred call: scheduleId. Legacy tuple retained for one
release." The current `SchedulesTab.tsx` always sends `scheduleId`, so Routed
Operations' own UI will not hit it. But the route still accepts and silently
resolves the ambiguous tuple for **anything else that calls it** — a stale
cached frontend, a script, another integration. Narrower than "everyday path",
but reachable from outside the app, which is the part that matters.

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

**Confirmed by Kerran against the `SchedulesTab.tsx` diff**, exactly as
reported. Same `includeClientSpecific` state variable, same checkbox — only the
meaning changed:

- **Old tooltip:** "Include schedules bound to a specific client… off by default
  because the widened set can be much larger" → ticking **widens**.
- **New tooltip:** "Tick to switch the browse to per-client… only. Off = default
  schedules only" → ticking **narrows**.

Kevin's explicit call and documented. Two notes:

- There is **no migration path for an operator's existing habit** — the control
  looks identical and does the opposite. Needs a release-note line, and it is
  worth telling the ops team directly rather than relying on them reading it.
- The state variable is still named `includeClientSpecific`, which now means the
  opposite of what it says. Rename it while the change is fresh, or it will
  mislead the next reader.

---

# Closed

## 4b. LOW — the `120002` → `180000` rename: git half confirmed, DB half single-sourced

**Correcting v4, which marked this fully closed.**

**Confirmed independently.** Kerran re-ran `git log --all -- "*20260908120002*"`
in `dbmigrationsv2` himself: zero hits. The file genuinely never existed under
the old name in that repo's history. Two reviewers, same result — solid.

**Not independently confirmed.** The `SchemaVersions` journal check on
`urgent-staging` and US is Kevin's claim, and Kerran could not verify it without
a DB connection. It is almost certainly right — a file never committed under the
old name is unlikely to have been journalled under it — but it rests on one
source.

Cheap to close properly. SELECT only:

```sql
SELECT ScriptName, Applied
FROM dbo.SchemaVersions
WHERE ScriptName LIKE '%2026090812000%'
   OR ScriptName LIKE '%20260908180000%'
ORDER BY Applied;
```

Worth running on each tenant during the Phase 1 checks rather than leaving it on
one person's word.

---

# Recommended order of work

Phase 1 staging is due **2026-09-14** — five days.

**Before any further tenant applies migration `20260908120000`:**

1. **B** — capture `SELECT * FROM tblScheduleClient` on every un-migrated
   tenant, and add the step 4d assertion. This is the only irreversible item on
   the list.

**Scope first, because it is already true and it sizes the release:**

2. **A3** — confirmed. Two schedules sharing a name share one postcode/polygon
   row, in production, now. Decide whether Phase 1 ships with that standing.
   The re-key needs a disambiguation rule for the 164 duplicate-name groups
   (the data to resolve them does not exist), so this is a scoping decision
   before it is an engineering task.

**Blockers for Phase 1:**

3. **6** — one-line fix at two sites (`ClientId = header.LegacyClientId`).
4. **A1/A2** — port both junctions to `BulkRunScheduleId`. **Not** the rename
   cascade on its own: on data with 48 shared names it collides on the
   `(ScheduleName, PostCode)` key.
5. **8** — pending Kevin's confirmation; if confirmed, a re-do of `120001`.
6. **1** — Steve's decision. If reverting to ELSE, it lands in the same pass as 8.

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

## Postcode / polygon bindings

14. **Shared-name binding check (A3)** — find two live schedules sharing a name
    with different definitions. Compare their postcode lists. Expected today:
    identical, because it is one row. Edit one, confirm the other changes.
    *Fails today, by primary key.*
15. **Rename retains bindings (A1)** — schedule with postcodes 1000 + 1001,
    rename, re-edit. Expected: still bound. *Fails today.*
16. **Rename onto a stranded name (A2)** — after 15, create a schedule under the
    original name. Must **not** inherit the stranded set.

## Migration

17. **Multi-client binding preservation** — seed `tblScheduleClient` with a
    genuine second-client row, apply, confirm it survives (finding B).
    *Fails today.*
18. Staging with `@Commit = 0` first. Counts: 2,725 headers / 119 defaults /
    11,110 day rows.
19. Both checks empty: link rows without an id, client schedules without a link
    row.
20. **Idempotency** — re-run on a migrated database; no duplicate headers or
    link rows.
21. **Partial-failure retry** — kill mid-run, re-run, confirm clean.
22. **Confirm the two competing migrations cannot both apply** (finding 2,
    second-order).

---

## Open items

- **Kevin** to confirm or refute finding 8's six line numbers in `120001` — the
  last finding resting on a single reviewer.
- **Steve** to call finding 1 (UNION vs ELSE), and to scope A3 in or out of
  Phase 1.
- **Anyone with a DB connection** to run the `SchemaVersions` query under 4b, so
  that finding is closed on evidence rather than on one person's word.

Every finding on this page has been checked against source. Findings 6, 7, A,
A3, 3, B and 4b (git half) were verified by both Kevin and Kerran
independently; 2 and 4a are agreed by both; 5 was verified by Kevin. Nothing
rests on the rollout report alone, and the one remaining inference from v4 — A3
— is now confirmed from the EF model.

Kerran has signed off on this ranking.
