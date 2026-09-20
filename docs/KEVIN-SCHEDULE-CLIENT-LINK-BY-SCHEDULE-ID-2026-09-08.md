---
title: Kevin — key the schedule/client link on a ScheduleId
date: 2026-09-08
audience: Kevin
status: Active brief — standalone piece of work, precedes any merging
migration: scripts/schedule-rationalisation/sql/001_schedule_header_and_id_keyed_links.sql
related_docs:
  - STEVE-SCHEDULE-RATIONALISATION-KEVIN-2026-09-08.md
  - KEVIN-SCHEDULES-ZONES-ZONE-GROUPS-HANDOVER-2026-08-21.md
---

# Key the schedule/client link on a ScheduleId

Workstream: Routed Operations, RunBuilder & RunViewer (schedules)
Due by: to be agreed with Steve at handover

## Decision

The new schedule/client link table currently keys on `ScheduleName`. That
cannot be made reliable on the data we have (section 2). **Before any
schedules are merged, give every schedule its own `ScheduleId`, and key the
link table on it.** Merging identical client copies into shared schedules is a
separate, later piece of work; nothing in this brief changes which schedule
any client uses today.

## 1. Scope

In scope:

1. A **schedule header** table, one row per schedule, with an identity
   `ScheduleId`.
2. `ScheduleId` on every `tblBulkRunSchedule` day row, not null, foreign key.
3. The **link table keyed on `(ScheduleId, ClientId)`**, foreign key to the
   header, one row per existing client-specific schedule.
4. Schedule read/write paths in the Routed Operations API and the schedules
   UI use `ScheduleId` and the link table, not `Name` / `ClientId` on the rows.

Out of scope (later): merging duplicate copies, renaming variants, fixing
`Description` / `CutoffHours` data, removing `ClientId` from the day rows.

## 2. Why the name key is not robust

Measured on the current production export (11,110 rows, 2,725 schedules):

- **A schedule has no identity of its own.** It is 1..n day rows that share
  `Name` + `ClientId`. `Name` alone maps to more than one definition for
  **164 names**, and **48 names** are used by both a default schedule and
  client schedules. A link row `("AKL > CHCH Pre 10am Medical", 16947)`
  cannot say which of the six definitions it means.
- **No foreign key is possible on a non-unique string**, so nothing stops a
  link row pointing at a schedule that has been renamed or deleted. Names do
  get edited in place (time suffixes, typos), and each rename would silently
  detach every client on that schedule.
- **String matching is fragile**: `Hamilton  > BOP` and `Hamilton > BOP` both
  exist and do not join (collation ignores case, not whitespace).
- No unique constraint on the pair, no removal audit.
- Dependants (`BulkZoneSchedule.ScheduleId`, linehaul rows) hang off the
  day-row id; a name carries none of that.

## 3. Target model

```
tblBulkRunScheduleHeader            -- the schedule
  ScheduleId      int identity PK
  Name            nvarchar(200) not null   -- trimmed, double spaces collapsed (CHECK)
  IsDefault       bit not null             -- 1 = available to clients with no schedule of their own
  LegacyClientId  int null                 -- the ClientId the day rows carried; informational
  CreatedUtc, CreatedBy, RetiredUtc, RetiredBy

tblBulkRunSchedule                  -- the day rows, unchanged apart from:
  ScheduleId      int not null FK -> header   (indexed with DayOfWeek)
  ClientId        int null                    -- legacy; no longer the source of truth

tblBulkRunScheduleClient            -- which clients use which schedule
  ScheduleId      int not null FK -> header
  ClientId        int not null
  CreatedUtc, CreatedBy
  PK (ScheduleId, ClientId), index on ClientId
```

Names are deliberately **not** unique: several live schedules legitimately
share a name with different definitions today. Uniqueness, if wanted later,
is a filtered unique index on the header.

**Resolution rule** (the only rule the code should implement):

> A client's schedules are the live headers (`RetiredUtc IS NULL`) it has a
> link row for. If it has none, its schedules are the live headers with
> `IsDefault = 1`.

## 4. Migration

`scripts/schedule-rationalisation/sql/001_schedule_header_and_id_keyed_links.sql`
does all of the data work in one transaction (`@Commit = 0` rolls back):

1. Creates the header and back-fills one row per distinct (`Name`,
   `ClientId`), spelling from the group's lowest `BulkRunScheduleId`, trimmed
   and collapsed; `IsDefault = 1` where `ClientId` is null.
2. Adds `ScheduleId` to the day rows, fills it, throws if any row is left
   without a header, syncs day-row `Name` to the header, sets `NOT NULL`,
   adds the FK and index.
3. Creates the link table keyed on `ScheduleId`. If the name-keyed table
   already exists, adds `ScheduleId` beside `ScheduleName`, back-fills it
   where the name resolves to exactly one live client schedule, and leaves
   the rest null for the check below; `ScheduleName` is dropped once every
   row has an id.
4. Inserts a link row for every existing client-specific schedule.
5. Prints counts (expect 2,725 headers / 119 defaults / 11,110 day rows on
   current data) and two checks that must be empty: link rows without a
   `ScheduleId`, and client schedules without a link row.

`@Link` at the top is the link table name; change it if yours differs.

## 5. Code changes

Reads:

- `GET API/Schedules/Clients/{clientId}` — via the link table, then defaults
  if the client has none (resolution rule above). Return `ScheduleId` on
  every schedule.
- `GET API/Schedules/Defaults` — headers with `IsDefault = 1`.
- Day rows are fetched by `ScheduleId`, never by `Name` + `ClientId`.
- `ScheduleService.GetByClient(...)` zone loading (`BulkZoneSchedule`) is
  unchanged; it already keys on the day-row id.

Writes:

- Create schedule: insert the header first, then the day rows with its
  `ScheduleId`, then a link row for the owning client (or `IsDefault = 1`).
- Update schedule: by `ScheduleId`; a rename touches the header `Name` and
  the day rows together (or the day-row `Name` is dropped from the API and
  read from the header).
- Attach / detach a client: insert / delete a link row. Deleting a schedule
  retires the header (`RetiredUtc`) rather than deleting rows, so history and
  dependants survive.
- Keep writing the legacy `ClientId` on new day rows for now so anything
  still reading it keeps working; stop once nothing reads it.

UI (Configurator schedules module lifted into Routed Operations):

- Schedule list and edit form carry `ScheduleId`; the client picker on a
  schedule reads and writes the link table.
- A schedule with several clients shows them; removing a client is a link
  delete, not a schedule delete.

## 6. Acceptance

- Migration runs on staging with `@Commit = 1`; both checks empty; counts as
  expected; every existing client still gets exactly the schedules it had
  (compare `GET Schedules/Clients/{id}` before and after for a sample of
  clients, including one with none of its own).
- FK prevents a link row to a non-existent schedule; PK prevents a duplicate
  client on a schedule.
- Renaming a schedule does not change which clients are linked to it.
- A client can be attached to a second schedule and detached again without
  touching day rows.

## 7. What comes after (not this brief)

With ids in place the merge is a re-point: identical copies' link rows move to
one surviving `ScheduleId` and the copies are retired. The generator and
scripts for that already exist (`STEVE-SCHEDULE-RATIONALISATION-KEVIN-2026-09-08.md`)
and will be re-run against a fresh export when we get to it.
