---
title: Steve — tblBulkRunSchedule rationalisation into shared multi-client schedules
date: 2026-09-08
audience: Kevin
status: Proposal + generated migration, awaiting review
source_data: "Schedule Table" Google Sheet (export of tblBulkRunSchedule, 11,110 rows)
script: scripts/schedule-rationalisation/rationalise_schedules.py
migration: scripts/schedule-rationalisation/sql/001_schedule_header_and_id_keyed_links.sql
outputs: scripts/schedule-rationalisation/output/
related_docs:
  - KEVIN-SCHEDULES-ZONES-ZONE-GROUPS-HANDOVER-2026-08-21.md
---

# tblBulkRunSchedule rationalisation

## What this is

Historically every client-specific schedule was a private copy: the same run
("AKL > HLZ Pre 8am Medical Run", Mon-Fri, same times, same speed, same depot)
exists once per client, so 21 clients means 105 identical rows. Kevin has added
a schedule/client link table so one schedule can serve many clients.

**Decision (Steve, 2026-09-08): give every schedule a unique id first, then
merge.** Kevin's link table is keyed on `ScheduleName`; section 5 shows why
that cannot be made reliable on this data. So the work is two steps:

1. **`sql/001_schedule_header_and_id_keyed_links.sql`** — a schedule header
   table with `ScheduleId`, stamped on every day row, and the link table
   keyed on `ScheduleId` + `ClientId`. Every existing client schedule gets a
   link row. Nothing is merged yet; behaviour is unchanged.
2. **`rationalise_schedules.py`** → `output/rationalise_schedules.sql` — finds
   identical copies and folds them into one `ScheduleId`: link rows are
   re-pointed to the survivor, the copies' header rows are retired and their
   day rows removed.

Everything in step 2 is generated from a CSV export of the sheet, so it can be
re-run against a fresh export of the target environment before applying.

## 1. Rules used by the merge

- A **schedule** is the set of day rows that share `Name` + `ClientId`
  (one row per `DayOfWeek`). Migration 001 turns each into one `ScheduleId`.
- Names are compared **case-insensitively with whitespace collapsed**
  (`Hamilton  > BOP` == `Hamilton > BOP`). The migration trims and collapses
  spelling on the header and syncs the day rows to it.
- Two schedules are **the same schedule** when every day row matches on every
  column except `BulkRunScheduleId`, `ClientId`, `Name` and **`Description`**
  (ignored on Steve's instruction, 2026-09-08: the column holds some incorrect
  data). The survivor keeps its own description; every other description seen
  in the group is listed in `MergedSchedules` so the wrong ones can be fixed.
  Identical duplicate rows inside one schedule are ignored for the comparison.
  The ignored columns are a script parameter (`--ignore`).
- Same name + same definition → **one schedule**. If a default (`ClientId
  NULL`) has that definition it is the survivor; otherwise the client copy
  with the lowest `BulkRunScheduleId`. Every client's link row is re-pointed
  to the survivor's `ScheduleId`; the other copies are retired.
- Same name + **different** definition → separate `ScheduleId`s that happen to
  share a name (a "variant"). With an id key that is allowed, so nothing is
  renamed; the `Variants` sheet lists them so they can be given clearer names.
- **Default schedules** are never retired.

## 2. Result

| Metric | Value |
|---|---|
| Source rows | 11,110 |
| Schedules = `ScheduleId`s after migration 001 | 2,725 |
| … default (no client) | 119 |
| … client-specific | 2,606 |
| Names used by 2+ clients | 203 |
| Shared schedules after the merge (survivors with 2+ clients) | 179 |
| … of which the survivor is an existing default | 23 |
| Client schedules retired into a survivor | 522 |
| Schedules remaining after the merge | 2,203 |
| Client schedules that stay one-client | 1,928 |
| Day rows retired | 2,606 |
| Day rows remaining | 8,504 |
| Merge groups where the copies had differing descriptions | 40 |
| Names whose definitions still differ across clients / default | 164 |

Only a minority of the shared names are used identically by every client. The
other names hide different definitions — most often `CutoffHours`, then
`ParentSpeedId`, `StartTime`, `PickupBoxDiscount`, `SpeedId`, `AutoBook`.
Relaxing the rule further would merge more, but that is a business call:

| Comparison | Shared schedules | Clients on shared schedules | Copies retired | Rows retired |
|---|---|---|---|---|
| Strict (every column) | 164 | 626 | 482 | 2,433 |
| **Ignore `Description` (as generated)** | 179 | 678 | 522 | 2,606 |
| Ignore `Description` + `CutoffHours` | 208 | 798 | 624 | 3,004 |

Of the 40 groups whose copies disagreed on description, most differ by an
appended note ("NO DGs allowed") or a wrong town/time ("delivered before 8am"
vs "10am", "New Plymouth" vs "Napier"). The `DescriptionValues` column shows
each value with how many rows carry it.

## 3. Files

| File | Contents |
|---|---|
| `sql/001_schedule_header_and_id_keyed_links.sql` | Step 1 migration: header table, `ScheduleId` on day rows, id-keyed link table, one link row per client schedule |
| `output/rationalise_schedules.sql` | Step 2 merge, transaction + safety checks, `@Commit = 0` by default |
| `output/rationalise_schedules_staging.sql` | Step 2 for staging: snapshots, merge, remove zone rows of retired copies, clear legacy `ClientId` |
| `output/restore_merge_staging.sql` | Puts staging back from the snapshots |
| `output/schedule_clients.csv` | Clients on each shared schedule in the link-table shape (`ScheduleName, ClientId, CreatedUtc, CreatedBy`) — for reading |
| `output/schedule_clients_by_row.csv` | Same rows keyed by the survivor's lowest day-row id (what the SQL resolves to a `ScheduleId`) |
| `output/merge_groups.csv` | One row per shared schedule: clients, survivor / retired row ids, key fields |
| `output/retired_schedule_rows.csv` | Every retired `BulkRunScheduleId` → the schedule and survivor that replace it |
| `output/variants.csv` | Names with differing definitions and which fields differ |
| `output/data_quality.csv` | Findings not auto-fixed (section 4) |
| `output/schedule-rationalisation.xlsx` | All of the above as one workbook with a Summary sheet |

## 4. Data-quality findings (168, in `data_quality.csv`)

- **48 names exist both as a default schedule and as client schedules.** 24 of
  those client copies are identical to the default; the merge links them to
  the default. The other 24 are different definitions under the same name.
- **41 schedules contain fully identical duplicate day rows** (e.g. client
  17732 "Monday 2 hour express" has 7 copies of the Monday row). Harmless for
  the merge, but worth de-duplicating.
- **31 schedules have several *different* rows for the same day** (different
  windows on one day). Legitimate, but it means Name + ClientId + DayOfWeek is
  not a key either.
- **3 names differ only by case/whitespace**, plus a few obvious typos
  (`Auckland Afternoonss`, `Simday 2 hour express`) that nothing here fixes.

## 5. Why the name-keyed link table was not robust

1. **`Name` is not a key in `tblBulkRunSchedule`.** A schedule had no id of
   its own — its identity was implicit in (`Name`, `ClientId`) spread over
   1..n day rows. 169 names map to more than one definition, and 48 names are
   also used by a default schedule. A link row `("AKL > CHCH Pre 10am Medical",
   16947)` could not say *which* of the six definitions it meant.
2. **No referential integrity is possible on a non-unique string.** Nothing
   stops a link row pointing at a schedule that has been renamed or deleted,
   and renames do happen (time suffixes and typos edited in place). Every
   rename silently detaches every client on that schedule.
3. **String matching is fragile.** `Hamilton  > BOP` vs `Hamilton > BOP` do
   not join (collation ignores case, not whitespace).
4. **No unique constraint, no soft delete, no audit** of removals.
5. **Schedules have dependants a name does not carry.** `BulkZoneSchedule`
   and `tblBulkScheduleLinehaul` hang off the day-row id. Two clients' copies
   can have identical day rows but different zone activations — the merge
   cannot see that, which is why its SQL lists retired rows that own zone
   rows and refuses to be committed until that check is empty.

### What migration 001 does about it

- `tblBulkRunScheduleHeader (ScheduleId identity, Name, IsDefault,
  LegacyClientId, CreatedUtc/By, RetiredUtc/By)` — one row per schedule,
  back-filled from distinct (`Name`, `ClientId`); spelling trimmed and
  double spaces collapsed; a `CHECK` keeps names trimmed.
- `tblBulkRunSchedule.ScheduleId NOT NULL` with an FK to the header, indexed
  with `DayOfWeek`. Day-row `Name` is synced to the header.
- Link table `(ScheduleId FK, ClientId, CreatedUtc, CreatedBy)`, primary key
  on the pair. If Kevin's name-keyed table already exists, `ScheduleId` is
  added beside `ScheduleName` and back-filled where the name resolves to
  exactly one live client schedule; unresolved rows are listed by the check
  at the end, and `ScheduleName` can be dropped once they are fixed.
- One link row per existing client schedule, so the link table is complete
  from day one and `tblBulkRunSchedule.ClientId` becomes legacy (kept as
  `LegacyClientId` on the header).
- Resolution rule for Kevin's code: a client's schedules are the live headers
  it is linked to; if it has none, the live headers with `IsDefault = 1`.

Names remain non-unique on purpose (variants). If a unique name per live
schedule is wanted later, it is a filtered unique index on the header.

## 6. Applying it (production)

1. Run `sql/001_schedule_header_and_id_keyed_links.sql` with `@Commit = 0`;
   the counts should read 2,725 headers / 119 defaults / 11,110 day rows on
   current data, and the two check selects must be empty. Then `@Commit = 1`.
2. Export the table to CSV and regenerate the merge from it (ids must match
   the environment):
   `python3 scripts/schedule-rationalisation/rationalise_schedules.py schedules.csv --created-by <who>`
   Table names are parameters (`--link-table`, `--header-table`, `--schedule-table`).
3. Run `output/rationalise_schedules.sql` with `@Commit = 0`. It resolves the
   `ScheduleId`s from the day-row ids in the export, checks every pair
   resolved to two different live schedules still owned by the expected
   client, and lists retired rows that own zone/linehaul rows. All checks
   must be empty. Then `@Commit = 1`.

## 7. Staging: apply everything and switch the 1-1 schedules off

`tblBulkRunSchedule` has no active/disabled flag, so "disable the 1-1
schedules" means: the link table is the only way a client reaches a schedule,
and nothing is left for the legacy `ClientId` lookup to find. After migration
001 every client schedule already has a link row, so staging only needs the
merge plus one extra step. `output/rationalise_schedules_staging.sql`:

| Step | What it does |
|---|---|
| 0 | Snapshots `tblBulkRunSchedule`, the header, the link table and `BulkZoneSchedule` into `*_PreMerge_20260908` tables |
| 1-2 | Resolves the 522 merge pairs to `ScheduleId`s and runs the safety checks |
| 3 | Re-points the retired schedules' link rows to the survivor |
| 4 | Removes the 2,606 retired day rows and (`@RetireDependants = 1`) their `BulkZoneSchedule` rows; marks the headers retired |
| 5 | `@DisableLegacyClientId = 1`: sets `ClientId = NULL` on every remaining day row |

After it commits, `tblBulkRunSchedule.ClientId` is NULL everywhere. The old
lookup (`ClientId = @client`, else the NULL rows as defaults) would therefore
see every schedule as a default, so only run this against a staging
environment that dispatches through Kevin's link-table resolution.

Procedure:

1. Run migration 001 on staging (as in section 6, step 1).
2. Export the staging table and regenerate (`--created-by`, table names as
   needed); ids differ from production.
3. Run `rationalise_schedules_staging.sql` with `@Commit = 0`, check the
   selects and the result counts, then `@Commit = 1`.
4. Test. `restore_merge_staging.sql` puts back the link rows, header retired
   flags, retired day rows, `ClientId`s and zone rows from the snapshots.
   Drop the snapshot tables when done.

The restore assumes `BulkRunScheduleId` and `BulkZoneSchedule.Id` are identity
columns (`IDENTITY_INSERT`); remove those lines if they are not. The linehaul
dependant check is left commented because the column name on
`tblBulkScheduleLinehaul` is not in this repo.
