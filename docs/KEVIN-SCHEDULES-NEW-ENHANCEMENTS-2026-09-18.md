---
title: Kevin — Schedules (NEW) enhancements: group membership, wildcard schedule search, bound recurring routes
date: 2026-09-18
audience: Kevin
status: Active brief — three enhancements on the new Schedules view already in build
source: Steve, 2026-09-18
related_docs:
  - KEVIN-NEW-SCHEDULES-VIEW-MULTI-CLIENT-2026-09-08.md
  - KEVIN-SCHEDULE-CLIENT-LINK-BY-SCHEDULE-ID-2026-09-08.md
  - STEVE-REGRESSION-REVIEW-SCHEDULE-CLIENT-LINK-2026-09-09.md
  - KEVIN-SCHEDULES-ZONES-ZONE-GROUPS-HANDOVER-2026-08-21.md
---

# Schedules (NEW) — three enhancements

Workstream: Routed Operations, RunBuilder & RunViewer (schedules)
Applies to: the new Schedules view (`/schedules`, "Schedules (NEW)"), not the legacy screen.

## TL;DR

Three things ops cannot see or do in the new view today. All three are the same
underlying complaint: **a schedule does not show what it is connected to, and
connecting it forces you to know an integer id.**

| # | Enhancement | Where |
|---|---|---|
| **E1** | A schedule row and modal show **which schedule group(s)** it belongs to | Schedules tab |
| **E2** | Adding a schedule to a group is a **wildcard name search**, not a ScheduleId field | Schedule Groups tab |
| **E3** | A schedule shows the **recurring routes bound to it** | Schedules tab + Roster tab |

E1 and E2 need the two schedule-group tables that are still the launch blocker
from `KEVIN-NEW-SCHEDULES-VIEW-MULTI-CLIENT-2026-09-08.md` §3/§5 — DDL repeated
in section 4 below so this brief is self-contained. **E3 needs the
`Routes.ScheduleId` re-point in section 4.2 or it renders empty on real data.**

---

## E1 — Show schedule-group membership in the schedule view

### What ops sees today

A schedule row shows Name, Days, Origin, Dest, Roster, Speed, Booking mode,
Clients, Active, Actions. Nothing says the schedule is in a group. To answer
"is this schedule in a group?" you switch to the Schedule Groups tab and expand
every group looking for it. Groups are the bundle that bulk edits and
`Attach clients to group` operate on, so being inside one changes what a change
to the schedule is going to do — it should not be invisible from the schedule.

### Build

**Table column.** Add a `Groups` column to
`v2/frontend/src/schedules/modules/schedules/components/ScheduleTable.tsx`,
between `Clients` and `Active`. Render it the way the Clients column renders
client codes: up to two group-name chips, then `+n`, and `—` when the schedule
is in no group. Model it on the existing `DispatchCell` in that file (≈ line 31)
— same `Badge` primitive, `size="sm"`, a variant distinct from the blue route
chips and orange linehaul chips.

Clicking a group chip switches to the Schedule Groups tab with that group
expanded and scrolled to. `SchedulesPage.tsx` already holds one schedules state
shared by all tabs, so this is a tab change plus an `expandedGroupId` prop into
`ScheduleGroupsTab.tsx` — no new state container.

**Filter.** Add a `Group` `FilterDropdown` to the filter row in
`ScheduleTable.tsx` (alongside Status / Type / View as / Depot), options
`All groups`, `In no group`, then each group by name. `In no group` is the one
ops asked for by implication: it is how you find the schedules that were never
bundled.

**Modal.** In `ScheduleEditForm.tsx`, put the group chips in the header card
next to the Active toggle, read-only in this phase. An override inherits
nothing here — show the groups of the override itself, and if its base is in a
group show `Base in <group>` in muted text, because a bulk edit on the group
hits the base and not the override.

**Type.** `ScheduleGroup` already exists (`types.ts` line 758) with
`scheduleIds: number[]`. Derive membership with a memoised
`Map<scheduleId, ScheduleGroup[]>` built once in `SchedulesPage.tsx` and passed
down — do not scan `groups` per row, the table renders 2,700 rows.

### API

Add `groups` to the schedule DTO (`api/v2.ts` `ScheduleDto`) so the table does
not need the full group list loaded before it can render:

```
GET /api/v2/schedules?type=&q=&groupId=
  → ScheduleDto[] , each now carrying:
      groups: [{ groupId: int, name: string }]
```

- `groups` is `tblBulkRunScheduleGroupMember` joined to
  `tblBulkRunScheduleGroup` where `IsActive = 1`, ordered by name.
- New optional `groupId` query param filters to members of that group.
  `groupId=0` means "in no group" (`NOT EXISTS` against the member table).
- Same addition on `GET /api/v2/schedules/{id}`.

### Acceptance

- A schedule in two groups shows two chips; one in none shows `—`.
- `Group` filter set to a group lists exactly that group's members; set to
  `In no group` lists exactly the schedules with no member row.
- Clicking a chip lands on the Schedule Groups tab with that group expanded.
- Retiring a schedule (`RetiredUtc`) removes it from the Groups column without
  deleting its member row — history stays, as everywhere else in this model.

---

## E2 — Wildcard search when putting a schedule into a group

### What ops sees today

Adding a schedule to a group requires the **ScheduleId**. Nobody knows that
number. `ScheduleGroupsTab.tsx` has a search box (line 65) but it searches
*groups* by name — there is no member picker in the vendored module at all, so
the id field is the only way in. Meanwhile the schedule/client attach flow
already does this correctly: `AttachClientsModal.tsx` is a search-and-tick
picker with greyed-out blockers and reasons. Group membership should work the
same way.

### Build

New `components/AddSchedulesToGroupModal.tsx`, deliberately a near-copy of
`AttachClientsModal.tsx` (same `Modal` shell, same search input, same tick
list, same `blockerFor` / `noteFor` pattern, `single={false}`). Differences:

- Items are schedules, not clients. Each row shows **name**, `#ScheduleId` in
  muted text, the day pills, and the client count — enough to tell two
  same-named schedules apart, which is the whole reason ids existed here.
- `blockerFor` returns `"Already in this group"` for existing members and
  `"Retired"` for retired headers. Both stay visible and greyed, so ops sees
  that the thing they searched for *is* there rather than assuming the search
  is broken.
- `noteFor` returns `"Default — clients are not attached via groups"` on
  `IsDefault = 1` schedules, matching the existing rule that
  `Attach clients to group` skips defaults.

Wire it to an `Add schedules` button in the expanded group panel of
`ScheduleGroupsTab.tsx`, in the action row beside `Attach clients to group`
(≈ line 137), and add a Remove (`X`) on each member row in the
`Member Schedules` list (≈ line 197).

### What "wildcard" means here

Ops should be able to type `*gisborne*`, `gisborne`, `AKL > CHC`, or `1947` and
get sensible results. Implement it as:

1. Trim; collapse double spaces (the header `Name` is stored trimmed and
   collapsed, so raw input with double spaces would otherwise miss — the exact
   `Hamilton  > BOP` failure from the link-table brief §2).
2. **Escape LIKE metacharacters in the user's text** — `%`, `_`, `[` — with an
   `ESCAPE` clause. Skipping this is the bug: a search for `50_pallet` would
   otherwise wildcard the underscore.
3. Translate a user-typed `*` to `%` *after* escaping.
4. If no `*` was typed, wrap the whole term: `'%' + @q + '%'`.
5. Match against `Name` **and** `Description`.
6. If `@q` is all digits, also return the header whose `ScheduleId` = that
   number, unioned in and sorted first. Typing the id keeps working for anyone
   who has it — it just stops being the only way.

Frontend: debounce 250 ms, minimum 2 characters, cap at 50 rows with a
`showing first 50 of n — refine your search` line. The picker hits the API
rather than filtering the in-memory list, because the in-memory list is the
current tab's filtered page, not all 2,725 schedules.

### API

`GET /api/v2/schedules?q=` already exists (§6 of the 2026-09-08 brief). This
enhancement **defines** `q` as the rules above and adds the member writes,
which have no endpoint today:

| Method | Route | Notes |
|---|---|---|
| `PUT` | `/api/v2/schedule-groups/{id}/schedules` | Body `{ scheduleIds: [] }` — full replace of `tblBulkRunScheduleGroupMember` for that group, same full-replace shape as `PUT /schedules/{id}/clients`. `400` if any id is not a live header. |
| `POST` | `/api/v2/schedule-groups/{id}/schedules` | Body `{ scheduleIds: [] }` — additive. Ignores ids already members (idempotent, no `409`). |
| `DELETE` | `/api/v2/schedule-groups/{id}/schedules/{scheduleId}` | Remove one member. |

Adding a member does **not** retroactively write client link rows — a group is
a convenience, the link table stays the only record of who uses what
(2026-09-08 brief §5). If the group has clients attached and a schedule is
added afterwards, return a `warning` on the response body
(`"3 clients are attached to this group; run Attach clients to group again to
include this schedule"`) and surface it as a toast. Do not silently write the
rows — ops needs to choose that.

### Acceptance

- Typing `gisborne` returns every schedule with Gisborne in the name or
  description, regardless of case or double spaces.
- Typing `*pre 8*` and `pre 8` return the same rows.
- Typing `50_pallet` matches the literal underscore, not any character.
- Typing `1947` returns schedule `#1947` first, then name/description matches.
- A schedule already in the group appears greyed with `Already in this group`.
- Add, refresh, still there. Remove, refresh, gone. No ScheduleId typed at any
  point in the flow.

---

## E3 — Show the recurring routes a schedule is bound to

### What ops sees today

Nothing, on real data. The reverse direction was specified — the Recurring
Routes tab shows `Schedule(s)` chips per route — but from a schedule you cannot
see which routes deliver it without going to the Configurator Routes editor and
reading bindings one at a time.

The frontend for this is **already written and already in the repo**; it is
running on sample rows:

| Built | File |
|---|---|
| `Roster` column chips (`2 routes`, `LH AUC→CHC 21:30`) | `components/ScheduleTable.tsx`, `DispatchCell` ≈ line 31 |
| Roster tab: routes bound, linehaul runs, master job, 7-day roster strips | `components/DispatchTab.tsx` |
| Join + roster resolution (date override › weekly › default) | `dispatch/dispatchData.ts`, `dispatch/types.ts` |

`DispatchCell` imports `sampleRecurringRoutes` / `sampleLinehaulRuns` directly
from `dispatch/dispatchData`. **E3 is mostly a wiring job, not a build job** —
replace those two imports with real data and the column lights up.

### Build

1. **Batch the list-level data.** The table renders every schedule; one
   `/schedules/{id}/dispatch` call per row is 2,700 calls. Add a single batch
   endpoint (below), fetch it once in `SchedulesPage.tsx`, hold it in a
   `Map<scheduleId, DispatchSummary>` and pass that into `ScheduleTable`.
   `DispatchCell` takes the summary as a prop instead of importing samples.
2. **Roster tab** (`DispatchTab.tsx`) calls the existing
   `GET /api/v2/schedules/{id}/dispatch` on modal open — full detail, per
   schedule, lazily. `schedulesApi.dispatch(id)` in `api/v2.ts` is already
   typed for it.
3. **Click-through.** A route chip opens the Recurring Routes tab filtered to
   that route; a linehaul chip opens the Edit Linehaul Run modal. Keep the
   Route Roster / Linehaul Roster editors where they are and deep-link, as the
   2026-09-08 brief already settled.
4. **Unbound is a state, not a blank.** A schedule with no bound route and no
   linehaul leg shows a muted `No routes bound` rather than `—`, and a `Routes`
   filter gets a `Not bound` option. That is the operational question behind
   this enhancement: which schedules are we relying on ad-hoc matching for.
5. **Master job red flag** already renders in `DispatchTab.tsx`; make sure the
   real DTO populates `masterJob: null` rather than omitting it, so the flag
   fires. A run with no master job means the driver sees every item as its own
   job.

### API

Existing, now actually consumed:

```
GET /api/v2/schedules/{id}/dispatch  → DispatchDto { routes[], runs[] }
```

New batch endpoint for the table:

```
GET /api/v2/schedules/dispatch-summary?scheduleIds=1,2,3   (omit = all live)
  → [{ scheduleId: int,
        routes: [{ routeId, name, type: 'first'|'final' }],
        runs:   [{ runId, name, fromDepot, toDepot, departTime,
                   hasMasterJob: bool }] }]
```

Routes come from `Routes.ScheduleId`; runs from
`TblBulkScheduleLinehaul.LinehaulRunId` → `TblbulkLinehaulRun`. No roster
resolution in the summary — the 7-day strip stays on the detail call, it is
expensive and the table does not show it.

### 4.2 is a hard prerequisite — read it before starting E3

`Routes.ScheduleId` currently points at a **representative day-row id**, not at
the header `ScheduleId` (`ScheduleLookup.id` in `tenant_routeService.ts`;
2026-09-08 brief §2b). Joining the summary endpoint on the header id against
today's column returns **zero rows for nearly every schedule**, and it will look
like the feature works and the data is empty rather than like a broken join. Do
the re-point in section 4.2 first, and check the count before wiring the UI.

### Acceptance

- A schedule with two bound routes shows `2 routes`; hovering names them.
- A schedule with a linehaul leg shows `LH AUC→CHC 21:30`, sourced from
  `TblbulkLinehaulRun`, not from sample data.
- A schedule with neither shows `No routes bound`, and the `Not bound` filter
  returns exactly that set.
- Opening the schedule's Roster tab lists the same routes and runs, plus the
  7-day roster strip with date overrides in amber.
- A run with no `tucJobBooking` where `IsLinehaulMaster = 1` shows the red
  missing-master-job flag.
- A route bound to more than one schedule shows `shared by n schedules` (this
  stays M:1 until the join table lands — the chip just needs to tolerate the
  plural).
- Count check before and after the 4.2 re-point:
  `SELECT COUNT(*) FROM Routes WHERE ScheduleId IS NOT NULL` is unchanged, and
  every non-null `ScheduleId` now resolves to a live header.

---

## 4. Database

### 4.1 Schedule group tables (still outstanding from 2026-09-08 §5)

E1 and E2 both persist to these. They do not exist yet; groups still vanish on
refresh. Repeated here so this brief stands alone — if you have already created
them, skip.

```sql
CREATE TABLE dbo.tblBulkRunScheduleGroup (
  GroupId     int IDENTITY PRIMARY KEY,
  Name        nvarchar(200) NOT NULL,
  Description nvarchar(500) NULL,
  IsActive    bit NOT NULL DEFAULT 1,
  CreatedUtc  datetime2(0) NOT NULL DEFAULT SYSUTCDATETIME(),
  CreatedBy   nvarchar(100) NOT NULL);

CREATE TABLE dbo.tblBulkRunScheduleGroupMember (
  GroupId    int NOT NULL REFERENCES dbo.tblBulkRunScheduleGroup (GroupId),
  ScheduleId int NOT NULL REFERENCES dbo.tblBulkRunScheduleHeader (ScheduleId),
  CreatedUtc datetime2(0) NOT NULL DEFAULT SYSUTCDATETIME(),
  CreatedBy  nvarchar(100) NOT NULL,
  PRIMARY KEY (GroupId, ScheduleId));

CREATE INDEX IX_tblBulkRunScheduleGroupMember_ScheduleId
  ON dbo.tblBulkRunScheduleGroupMember (ScheduleId) INCLUDE (GroupId);
```

`CreatedUtc` / `CreatedBy` on the member table are an addition to the
2026-09-08 DDL: E2 makes membership something ops edits by hand, so it needs
the same audit the client link rows have. The `ScheduleId` index is what makes
E1's Groups column cheap — that lookup is schedule → groups, the opposite
direction to the PK.

### 4.2 Re-point `Routes.ScheduleId` at the header (blocks E3)

```sql
-- Confirm the current state first: how many route bindings resolve to a day row
SELECT COUNT(*) AS Bindings,
       SUM(CASE WHEN s.ScheduleId IS NULL THEN 1 ELSE 0 END) AS Unresolvable
  FROM dbo.Routes r
  LEFT JOIN dbo.tblBulkRunSchedule s ON s.BulkRunScheduleId = r.ScheduleId
 WHERE r.ScheduleId IS NOT NULL;
-- Unresolvable must be 0 before proceeding.

BEGIN TRAN;

ALTER TABLE dbo.Routes ADD HeaderScheduleId int NULL
  CONSTRAINT FK_Routes_ScheduleHeader
  REFERENCES dbo.tblBulkRunScheduleHeader (ScheduleId);

UPDATE r
   SET r.HeaderScheduleId = s.ScheduleId
  FROM dbo.Routes r
  JOIN dbo.tblBulkRunSchedule s ON s.BulkRunScheduleId = r.ScheduleId
 WHERE r.ScheduleId IS NOT NULL;

-- Both must return 0
SELECT COUNT(*) FROM dbo.Routes
 WHERE ScheduleId IS NOT NULL AND HeaderScheduleId IS NULL;
SELECT COUNT(*) FROM dbo.Routes r
  LEFT JOIN dbo.tblBulkRunScheduleHeader h ON h.ScheduleId = r.HeaderScheduleId
 WHERE r.HeaderScheduleId IS NOT NULL AND h.ScheduleId IS NULL;

-- COMMIT;  ROLLBACK;
```

Add the column beside the old one rather than changing `Routes.ScheduleId` in
place: `tenant_routeService.ts` and the existing Recurring Routes page still
read the day-row id, and nothing in this brief should break the page ops uses
today. Drop `Routes.ScheduleId` only once the Configurator route editor reads
`HeaderScheduleId`, which is a separate piece of work.

Suggested file:
`scripts/schedule-rationalisation/sql/002_group_tables_and_route_header_binding.sql`,
same `@Commit = 0` rollback harness as `001`.

---

## 5. Order of work

1. **4.1 group tables + `/api/v2/schedule-groups` CRUD** — the standing launch
   blocker; E1 and E2 are both dead without it.
2. **E2** — the member picker. It is the one ops is actively blocked on, and it
   is a copy of `AttachClientsModal.tsx`.
3. **E1** — Groups column, filter, modal chips. Small once the tables exist.
4. **4.2 route re-point**, with the count checks.
5. **E3** — batch endpoint, swap the two sample imports, wire the Roster tab.

E1 + E2 are one deployable slice; E3 is the second.

## 6. Not in scope

- Bulk-editing a schedule *from* the Groups column. Group bulk edit stays where
  it is, in the Schedule Groups tab.
- N:M route ↔ schedule binding. Still M:1; the `shared by n schedules` chip
  just needs to survive the day that changes.
- Attaching clients to routes or runs. Clients attach to schedules only — the
  route's clients are derived through the binding, and that stays the one truth.
- Writing client link rows automatically when a schedule joins a group that has
  clients attached (E2 warns instead — see E2 § API).

## 7. What I need back

- Confirmation the group tables are in, and the names if they differ from 4.1.
- The `Unresolvable` count from the 4.2 pre-check before you run the update.
- A date for the E1 + E2 slice in tenant staging.
