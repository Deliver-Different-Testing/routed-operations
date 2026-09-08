---
title: Kevin — new Schedules view in Routed Operations, one schedule for many clients
date: 2026-09-08
audience: Kevin
status: Active brief — build as a NEW view alongside the existing schedules screen
mockup: https://claude.ai/code/artifact/e90fe293-31f1-4238-93bf-c54001ca7419
mockup_source: docs/mockup-schedules-multi-client.html
base_design_live: https://deliver-different-testing.github.io/scheduled-rate-builder/#/schedules
related_docs:
  - KEVIN-SCHEDULE-CLIENT-LINK-BY-SCHEDULE-ID-2026-09-08.md
  - STEVE-SCHEDULE-RATIONALISATION-KEVIN-2026-09-08.md
  - KEVIN-SCHEDULES-ZONES-ZONE-GROUPS-HANDOVER-2026-08-21.md
---

# New Schedules view — one schedule, many clients

Workstream: Routed Operations, RunBuilder & RunViewer (schedules)
Due by: to be agreed with Steve at handover

## TL;DR

Build a **new** Schedules view in Routed Operations, next to the existing
schedules screen, not in place of it. It is Dane's redesigned schedules module
(visual route builder, base schedules with client overrides, schedule groups)
adapted so that **a schedule has its own `ScheduleId` and any number of clients
attached to it**, per the link-table brief. The existing screen stays as it is
until ops confirm they can do their work in the new one.

- **Mockup of what to build:** https://claude.ai/code/artifact/e90fe293-31f1-4238-93bf-c54001ca7419 (interactive; *+ New Schedule* opens
  Dane's creator with the Clients row, attach clients, create an override, view
  as a client, open a group, open the Dispatch tab, switch to the Recurring
  Routes tab). Source file:
  `docs/mockup-schedules-multi-client.html` in this repo.
- **Look and feel:** Steve's call (2026-09-08) is to keep it looking like
  Dane's live prototype at
  https://deliver-different-testing.github.io/scheduled-rate-builder/#/schedules
  — same page header, card with tabs, search-then-filters row, compact table
  with day pills, `O` badge and `+n` on nested overrides, toggle for status,
  icon actions. The mockup is styled on those tokens (`index.css` in the
  module: brand cyan / dark, surface-light, text-primary/secondary/muted). Do
  not invent a new visual language; reuse Dane's `components/ui`, `layout`,
  `filters` and `data` primitives.
- **One UI for schedules, recurring routes and linehaul:** the page carries
  three tabs — Schedules, Schedule Groups, Recurring Routes (with the live
  page's First / Middle / Final mile types, so linehaul runs are rows there,
  not a separate page) — and every schedule has a Dispatch tab showing the
  routes and run that deliver it, including the run's **master job**.
  Section 2b explains the model and what is read-only here.
- **Where it lives:** in the Routed Operations shell as a second sidebar
  entry, "Schedules (NEW)", next to the existing Schedules page
  (`routedoperations.urgent.deliverdifferent.com/schedules`). The existing
  page and the existing Recurring Routes page are untouched.
- **React code to lift:** section 3.
- **Data model:** the header + link tables from migration 001, plus
  `BaseScheduleId` on the header and two small group tables (section 5).

## 1. Why

- Today a schedule is a private copy per client: 2,606 client schedules for
  1,891 names, and 21 clients means 21 identical copies of "AKL > HLZ Pre 8am
  Medical Run". Every change is made 21 times.
- Dane's redesign fixed the *editor* (one visual route instead of a 30-field
  wall) and modelled client variations as **overrides of a base**, but it still
  assumes one client per schedule and links an override to its base by
  **name**. Kevin's first link table also keyed on name. Names are not unique
  (169 names map to several definitions), so neither can be made reliable.
- With `ScheduleId` in place (migration 001), the same schedule can be shared
  by many clients through link rows, an override is a real row with
  `BaseScheduleId`, and "copy to another client" mostly becomes "attach".

## 2. What the new view does

Everything below is in the mockup. Tab names and layout follow Dane's module.

### Schedules tab

- **Table** — Schedule (name, `#ScheduleId`, description), Route (leg strip in
  Dane's colours), Days, Window, Cut-off (`66/18` = Monday / other days,
  because cut-off is per day in production), **Clients**, Active, Actions.
- **Clients column** — `All clients` badge for a default; otherwise client
  code chips with `+n`. This is the link table, rendered.
- **Overrides nest under their base**, amber, showing `Based on #id` and the
  fields that differ. Nesting uses `BaseScheduleId`, never the name.
- **Type filter** — All / Defaults / Shared / Overrides.
- **View as client** — shows the schedules that client can actually book,
  each tagged `Own override`, `Shared` or `Default`. This is the resolution
  rule made visible (section 5) and is how ops will check a client after
  attaching them.
- **Row actions** — Attach clients, Copy (new `ScheduleId`, same route, no
  clients), Retire (sets `RetiredUtc`; links and history stay).

### Schedule modal / edit form

Opening a schedule uses Dane's centred modal exactly as `ScheduleTableView.tsx`
does today (90vw up to `max-w-6xl`, 85vh tall, dark blurred overlay, header on
surface-light with the close X, sticky footer) — not a side drawer. Inside it,
Dane's `ScheduleEditForm` with the **Clients tab first** and reworked:

1. **Who can book this schedule** — radio: *All clients (default)* (no link
   rows) or *Specific clients* (link rows). An override is always specific.
2. **Attached clients** — list with code, id, attached date, Remove. *Attach
   clients* opens a search-and-tick modal; a client already attached, or one
   that has its own override of this base, is shown disabled with the reason.
3. **Client overrides** — the overrides of this base with their clients and
   differing fields; click opens the override in the same modal with Dane's
   amber "Editing client override … based on #id" chrome and structure locked.
   *Create override for a client…* picks one client, creates a new
   `ScheduleId` with `BaseScheduleId` set, copies the base's rows, and **moves
   that client's link row from the base to the override** so a client is never
   on both.

Route and Operating days tabs are Dane's, unchanged (per-day cut-off shown on
each day cell). An override can have **several clients** (Gisborne pre 10am in
the mockup: two clients share the Monday-60h variant).

### Creating a schedule (Dane's New Schedule modal, plus a Clients row)

*+ New Schedule* opens Dane's creator as it is on the live prototype — keep
it as is, with one row added:

1. **Header card** — editable name ("New Schedule" placeholder), *+ Add
   description*, **Active** toggle, booking mode radio **Fixed Time / Window**,
   and the **OPERATING DAYS** pills (M T W T F S S, weekdays on by default).
2. **CLIENTS row** (new) directly under Operating days: *All clients (default)*
   or *Specific*, and for Specific the attached client chips with an *Attach
   clients* button that opens the same search-and-tick modal used everywhere
   else. Most schedules are client-specific (2,606 of 2,725), so Specific is
   the default and the schedule cannot be created until at least one client is
   attached or it is made a default. This is the only place the multi-client
   model touches Dane's creator, and it is there so who-can-book is decided at
   creation, not discovered later.
3. **Delivery Route card** — `0 legs` badge, the dashed **Choose first leg**
   chooser (Collection / Depot / Linehaul / Delivery), "No route legs
   configured" until one is chosen, then Dane's vertical stacked legs with one
   expanded inline at a time and the chooser repeated after the last leg (any
   leg after any leg; a route may end at a depot or linehaul). The leg colour
   legend and the amber "Route has no legs configured" warning stay. A
   Linehaul leg's inline config picks the **linehaul run** (`LinehaulRunId`),
   which is what links the schedule to the Recurring Routes middle-mile row and
   its master job.
4. **Bottom tab strip** — Dane has *Schedule Config | Client Overrides*. It
   becomes *Schedule Config | Clients (n) | Client Overrides*, with Client
   Overrides disabled until the schedule is saved (an override needs a saved
   base to point at).
5. **Create** writes the header (`IsDefault` from the Clients row), one day row
   per operating day, and the link rows, then opens the schedule in the edit
   modal.

Where that creator lives in Dane's code (same files in both copies; the
admin-schedules-module copy is the newer one):

| Piece of the modal | File under `src/modules/schedules/components/` |
|---|---|
| Modal shell, header card (name, `+ Add description`, Active toggle, Fixed Time / Window), bottom *Schedule Config \| Client Overrides* strip | `ScheduleEditForm.tsx` (header ≈ lines 300–350, tab strip ≈ 400–420, override tab ≈ 466) |
| OPERATING DAYS pills | `DayPillsEditor.tsx`, wrapped by `OperatingScheduleSection.tsx` (per-day windows and cut-off) |
| Delivery Route card, `0 legs` badge, dashed *Choose first leg* chooser, "No route legs configured", legend, "Route has no legs configured" warning | `ChainBuilder.tsx` |
| One leg card, expand/collapse, inline config per leg type | `LegNode.tsx`, `LegConfigPanel.tsx`, `ZoneSelector.tsx` |
| Client Overrides tab content | `ClientOverridesTab.tsx` (+ `SideBySideOverrideEditor.tsx`) |

In `Deliver-Different-Testing/Adminmanagerupdate` the same files sit under
`admin-ui/src/modules/schedules/components/`; `OverrideEditor.tsx` there is the
older 478-line version that the extracted module replaced with override mode
inside `ScheduleEditForm`.

### Dispatch tab on a schedule (new)

Read-only in the first phases. Shows, for this schedule:

- **Recurring routes bound to it** (`Routes.ScheduleId` → this header): name,
  area, zip count, mapped stops, default target (Courier / Agent / NP), and a
  seven-day strip of who is rostered each day (date overrides win over the
  weekly pattern, shown amber). "Roster" opens the Configurator Route Roster
  page for that route. A route bound to several schedules carries a
  "shared by n schedules" chip.
- **Linehaul legs**: the run behind each linehaul leg
  (`TblBulkScheduleLinehaul.LinehaulRunId` → `TblbulkLinehaulRun`): from → to,
  mode (Road / Flight), despatch and depart times, default target (Courier /
  Agent / NP), speed (schedule default or the run's own), seven-day roster
  strip, how many schedules use the run, and the **master job** — the
  booking that represents the run (job number chip, and today's state: when
  it materialised and how many items are linked to it). A run without a
  master job is flagged red, because the driver would then see every item as
  its own job.
- The row in the Schedules table summarises the same thing in a **Dispatch**
  column: `2 routes` and `LH AUC→CHR 21:30` chips, so ops can see at a glance
  which schedules have a rostered pickup run and a trunk leg and which rely on
  ad-hoc matching.

### Recurring Routes tab (new here, same rows as the existing page)

The Routed Operations Recurring Routes page already lists first-mile routes,
middle-mile (linehaul) runs and final-mile routes in one table with a Type
chip and a "Used by schedules" count. That table moves in here unchanged in
shape, with a Type filter (All / First mile / Middle mile / Final mile) and
three columns the existing page cannot show:

- **Schedule(s)** — the bound schedules as clickable chips that open the
  schedule modal (`Routes.ScheduleId` for routes,
  `TblBulkScheduleLinehaul.LinehaulRunId` for runs). Unbound routes show
  `Unbound`.
- **Clients via schedule** — the union of the clients attached to those
  schedules and their overrides. This is the answer to "who is actually on
  this run", which today needs a trip through three pages.
- **Master job** — for middle-mile runs, the booking that represents the run
  (the Edit Linehaul Run modal's *Master job* field, `IsLinehaulMaster`), with
  today's state; click opens it in Route Viewer.

"This week" is the seven-day roster strip (date override › weekly pattern ›
default target). Row click opens the existing Edit Route / Edit Linehaul Run
modal; the Route Roster and Linehaul Roster editors stay on their pages and
are deep-linked from the Dispatch tab.

### Why the master job matters here

A linehaul driver should see one or two jobs on the handheld, not fifty. The
run's master job is the booking every item on the run is associated with, so
picking up the master marks all items picked up. Today that association is
only visible inside the Edit Linehaul Run modal. In the new view it is on the
run row and on every schedule that rides the run, and a missing master job is
an obvious red flag rather than something found on the road.

### Schedule Groups tab

Dane's groups are named bundles of schedules with Quick copy, Copy & edit and
Add client override. Keep all three and add the one action the link table
makes possible: **Attach clients to group** — one link row per client per
member schedule; members that are defaults are skipped; clients already on a
member keep their row. The expanded group shows which clients are on every
member and how many overrides hang off it. Groups need a home in the database
(section 5) — in Dane's prototype they were frontend-only.

## 2b. How schedules, recurring routes and linehaul fit together

This is the model the UI above makes visible. It is the layered model already
agreed in `HANDOVER-GARRY-ROUTE-SCHEDULE-BINDING-2026-06-02.md` and
`RECURRING-ROUTES-VS-SCHEDULES-ANALYSIS.md` (dfrntdrive_configurator docs),
with the schedule now identified by `ScheduleId`:

| Layer | Owns | Table(s) | Edited in |
|---|---|---|---|
| **Schedule** | Time window, days, per-day cut-off, legs, speeds, zones, commercials; **which clients** (link table) | `tblBulkRunScheduleHeader`, `tblBulkRunSchedule`, `tblBulkRunScheduleClient` | this view |
| **Recurring route** | Pickup geography (zip cluster), default target, `ScheduleId` binding | `Routes`, `RouteZipcodes` | Configurator Routes editor (opened from here) |
| **Route roster** | Who runs the route per weekday / date (Courier / Agent / NP) | `Dispatch_RouteRoster` | Configurator Route Roster (deep link) |
| **Linehaul run** | The trunk movement: depots, despatch/depart, mode, default target, speed, **master job** (`tucJobBooking` with `IsLinehaulMaster = 1`) | `TblbulkLinehaulRun`, `tucJobBooking` | Recurring Routes (Middle mile) / Linehaul Roster |
| **Booking** | `tucJobBooking.ScheduleID` + `RouteId` — the join at run time | | dispatch, not this view |

Rules for the join:

- `Routes.ScheduleId` currently points at a representative day-row id
  (`ScheduleLookup.id` in `tenant_routeService.ts`). After migration 001 it
  should point at the **header** `ScheduleId`; back-fill by
  `tblBulkRunSchedule.ScheduleId` of that row. That is a one-line ALTER plus
  update and removes the last name-based join in the route page.
- Binding is **M:1** today (many routes → one schedule). The 2026-08-03 spec
  proposes N:M with the effective window being the tightest across the bound
  schedules; the mockup shows that state as "shared by n schedules". Build
  the view on M:1 and let the chip become plural when the join table lands.
- Linehaul is already bound by id (`TblBulkScheduleLinehaul.LinehaulRunId`),
  so the Linehaul Runs tab needs no schema change.
- Clients never attach to a route or a run. They attach to schedules; the
  route's clients are derived through the binding. That keeps one truth.

## 3. Where the React code is

| Repo / path | What it is | Use it? |
|---|---|---|
| `Deliver-Different-Testing/admin-schedules-module` → `src/modules/schedules/` | Dane's schedules module, standalone. **Newest version**: includes the override-mode simplification (commit `6130a03`, one editor, no separate override UI). `docs/SCHEDULES.md` is the locked design + production field map. | **Yes — lift from here.** |
| `Deliver-Different-Testing/scheduled-rate-builder` → `wwwroot/app/react/prototypes/admin-schedules-module/` | Byte-identical vendored copy of the above, mounted at `/schedules`; this is what the live Pages demo runs. | Same code; use whichever is handier. |
| `Deliver-Different-Testing/Adminmanagerupdate` → `admin-ui/src/modules/schedules/` | Dane's *original* admin-manager rebuild. **Older** in 7 files (`OverrideEditor.tsx` is the 478-line pre-simplification version, `ClientOverridesTab.tsx` 455 vs 205 lines). | Reference for the Tag/Connections system (`TAG-SYSTEM-SPEC.md`) only. Do not lift schedules from here. |
| `Kerran-Configurator` (any branch) | Start-here doc says a schedules module was transplanted; **it is not there** on GitHub. `/scheduling` there is NP driver scheduling. | No. |
| `Kerran-Configurator` → `wwwroot/app/react/pages/tenant/RecurringRoutes.tsx` (+ `LinehaulTab.tsx`, `LinehaulRosterTab.tsx`, `services/tenant_routeService.ts`) | The Recurring Routes page: route table, editor, roster (weekly pattern, date overrides, 14-day preview), linehaul tabs. `TenantRoute` / `RosterEntry` / `ScheduleLookup` types. | **Yes** — the route and linehaul list rows, the `ScheduleChip`, `TargetTypeChip` and the roster preview logic are what the new tabs and Dispatch tab reuse. |
| `scheduled-rate-builder` → `wwwroot/app/react/modules/schedules/` | An older native module with string ids and `clientVisibility`/`clientIds`. | No, but its `clientVisibility: 'all' \| 'specific'` is the shape we want on the header. |

Files that carry the behaviour described above, all under
`src/modules/schedules/`:

- `SchedulesPage.tsx` — tabs, filters, `handleApplyClientOverrides`,
  `handleCopyGroup`.
- `components/ScheduleTable.tsx`, `ScheduleTableView.tsx`, `ScheduleListTab.tsx`
  — list, nesting (`baseScheduleName === base.name` → replace with
  `baseScheduleId === base.id`).
- `components/ScheduleEditForm.tsx` + `ClientOverridesTab.tsx` — edit form with
  the Clients tab; override mode chrome.
- `components/ScheduleGroupsTab.tsx`, `CopyGroupModal.tsx`,
  `AddClientOverrideModal.tsx`, `BulkEditFieldSelector.tsx`,
  `BulkEditPreview.tsx` — groups and bulk actions.
- `components/LegConfigPanel.tsx`, `LegNode.tsx`, `ChainBuilder.tsx`,
  `OperatingScheduleSection.tsx`, `DayPillsEditor.tsx`, `ZoneSelector.tsx` —
  the route builder; keep as-is.
- `types.ts` — `Schedule`, `BulkRunScheduleRow`, `multiDayToPerDay` /
  `perDayToMultiDay` (the per-day row mapping to `tblBulkRunSchedule`).
- `api.ts` — talks to the legacy `/api/Schedules/{clientId}` endpoints; replace
  with section 6.

Read `docs/SCHEDULES.md` §6 before wiring saves: it lists the fields Dane's
mapping silently loses (per-day cut-off collapsed to one value, `MaxJobs`
hard-coded to 10000, `IsRecurringSchedule` dropped, zone payload shape). Those
are real bugs to fix in the new view, not design choices.

## 4. Model changes in the React code

`Schedule` in `types.ts` gains / changes:

```ts
scheduleId: number;                 // header id, replaces the synthetic `id`
rowIds: number[];                   // day rows (unchanged)
visibility: 'all' | 'specific';     // IsDefault on the header
clients: { clientId: number; code: string; name: string; attachedUtc: string }[];  // link rows
baseScheduleId: number | null;      // override → its base; replaces baseScheduleName
isOverride: boolean;                // derived: baseScheduleId != null
overriddenFields: string[];         // computed by diffing against the base
// remove: clientId, clientIds, clientVisibility, baseScheduleName
```

Rules the UI enforces:

- A schedule with `visibility = 'all'` has no link rows. Switching to
  *specific* requires at least one client before save.
- A client is on a base **or** on one of its overrides, never both. Creating an
  override moves the link; deleting an override moves it back.
- Overrides cannot change visibility, structure (legs) or days-on; only the
  override-contract fields Dane locked in.
- Retire, don't delete: a header with `RetiredUtc` is hidden by default and
  its day rows stay for history.

## 5. Data model

From migration 001 (`scripts/schedule-rationalisation/sql/001_…sql`):
`tblBulkRunScheduleHeader (ScheduleId, Name, IsDefault, LegacyClientId,
Created/Retired audit)`, `tblBulkRunSchedule.ScheduleId` (FK), and the link
table `tblBulkRunScheduleClient (ScheduleId, ClientId, CreatedUtc, CreatedBy)`.

Add for this view:

```sql
ALTER TABLE dbo.tblBulkRunScheduleHeader ADD BaseScheduleId int NULL
  CONSTRAINT FK_tblBulkRunScheduleHeader_Base REFERENCES dbo.tblBulkRunScheduleHeader (ScheduleId);
-- back-fill: same trimmed Name as a live default or shared schedule, different definition → BaseScheduleId
-- (the Variants sheet in the rationalisation workbook lists exactly these)

CREATE TABLE dbo.tblBulkRunScheduleGroup (
  GroupId int IDENTITY PRIMARY KEY, Name nvarchar(200) NOT NULL, Description nvarchar(500) NULL,
  IsActive bit NOT NULL DEFAULT 1, CreatedUtc datetime2(0) NOT NULL DEFAULT SYSUTCDATETIME(), CreatedBy nvarchar(100) NOT NULL);
CREATE TABLE dbo.tblBulkRunScheduleGroupMember (
  GroupId int NOT NULL REFERENCES dbo.tblBulkRunScheduleGroup (GroupId),
  ScheduleId int NOT NULL REFERENCES dbo.tblBulkRunScheduleHeader (ScheduleId),
  PRIMARY KEY (GroupId, ScheduleId));
```

Attaching a client to a group writes link rows; the group is a convenience,
the link table is the only record of who uses what.

**Resolution rule** (one query, used by *View as client* and by dispatch once
it moves to the new tables):

```sql
-- schedules client @c can book
SELECT h.ScheduleId, 'override' AS Source FROM tblBulkRunScheduleHeader h
  JOIN tblBulkRunScheduleClient l ON l.ScheduleId = h.ScheduleId AND l.ClientId = @c
 WHERE h.RetiredUtc IS NULL AND h.BaseScheduleId IS NOT NULL
UNION ALL
SELECT h.ScheduleId, 'shared' FROM tblBulkRunScheduleHeader h
  JOIN tblBulkRunScheduleClient l ON l.ScheduleId = h.ScheduleId AND l.ClientId = @c
 WHERE h.RetiredUtc IS NULL AND h.BaseScheduleId IS NULL
UNION ALL
SELECT h.ScheduleId, 'default' FROM tblBulkRunScheduleHeader h
 WHERE h.RetiredUtc IS NULL AND h.IsDefault = 1
   AND NOT EXISTS (SELECT 1 FROM tblBulkRunScheduleHeader o JOIN tblBulkRunScheduleClient l ON l.ScheduleId = o.ScheduleId
                   WHERE o.BaseScheduleId = h.ScheduleId AND l.ClientId = @c);
```

## 6. API for the new view (Routed Operations backend)

Leave the legacy `API/Schedules/*` endpoints alone; the old screen keeps using
them. New, id-keyed:

| Method | Route | Notes |
|---|---|---|
| GET | `/api/v2/schedules?type=all\|default\|shared\|override&q=` | Headers with day rows, clients (link rows), `baseScheduleId`, `overriddenFields`. Retired excluded unless `includeRetired`. |
| GET | `/api/v2/schedules/{id}` | One schedule, same shape. |
| POST / PUT | `/api/v2/schedules` `/{id}` | Header + day rows in one payload (Dane's `multiDayToPerDay` output). Create-on-day-enable, delete-on-day-disable, per-day `CutoffHours`. |
| POST | `/api/v2/schedules/{id}/retire` | Sets `RetiredUtc/By`. |
| POST | `/api/v2/schedules/{id}/copy` | New `ScheduleId`, same rows, no clients. |
| PUT | `/api/v2/schedules/{id}/clients` | Body `{ clientIds: [] }` — full replace of the link rows; 409 if a client is on an override of this base. |
| DELETE | `/api/v2/schedules/{id}/clients/{clientId}` | Remove one link. |
| POST | `/api/v2/schedules/{id}/overrides` | Body `{ clientId }` → creates the override, moves the link, returns the new schedule. |
| GET | `/api/v2/clients/{clientId}/schedules` | Resolution rule above, with `source`. |
| GET / POST / PUT / DELETE | `/api/v2/schedule-groups` | Groups + members. |
| GET | `/api/v2/schedules/{id}/dispatch` | Routes bound to the schedule (with the next 7 days of roster resolved: date override › weekly › default) and the linehaul runs behind its legs. Read-only. |
| GET | `/api/v2/recurring-routes?type=first\|middle\|final&q=` | The existing Recurring Routes rows (routes and runs) plus `scheduleIds[]`, `clientsViaSchedule[]`, and for runs `mode`, `speed`, `masterJob { jobNumber, materialisedUtc, itemsLinked }`. Writes stay on the existing Recurring Routes API. |
| POST | `/api/v2/schedule-groups/{id}/clients` | Body `{ clientIds: [] }` → link rows on every non-default member. |

`CreatedBy` on link rows is the logged-in user.

## 7. How to build it in Routed Operations

1. **New route, new sidebar entry** — `/schedules` under Routed Operations
   with the label "Schedules (new)". The Configurator / ClientManager schedules
   screen is untouched. Both read the same day rows, so ops can open a schedule
   in each and compare.
2. **Phase 1 — read-only list + modal** on the 001 tables: table with Clients
   and Dispatch columns, nesting by `BaseScheduleId`, View-as-client, modal
   with Clients / Route / Days / Dispatch tabs read-only, plus the read-only
   Recurring Routes tab with the Schedule(s), Clients via schedule and Master
   job columns. This is enough for ops to validate
   the rationalisation on staging and to see routes and runs against
   schedules for the first time.
3. **Phase 2 — attach / detach / visibility / retire** (link table writes).
4. **Phase 3 — overrides** (create override, override-mode editor).
5. **Phase 4 — groups** (two tables, attach to group).
6. **Phase 5 — full editing** through Dane's route builder, with the §6
   silent-loss fixes.
7. Only after ops sign off does the old screen get retired. Not this brief.

## 8. Acceptance (against the staging data after migration 001)

- "AKL > CHCH Pre 8am Medical" shows once with its 11 clients; its Rangitoto
  cut-off variant shows nested under it as an override of one client.
- "AKL > Gisborne pre 10am" shows an override carrying **two** clients.
- "Hamilton > BOP" shows as a default with the six-client pickup-zone variant
  nested under it.
- *View as* any of those clients lists exactly the schedules the resolution
  query returns, with the right source tag; a client with no schedules of its
  own sees only defaults.
- Attaching a client to a group adds a link row on every non-default member
  and none on defaults; detaching removes only that row.
- Creating an override moves the client off the base; the base's client count
  drops by one and the override's is one.
- The old schedules screen still lists every schedule it listed before.

## 8b. Noted for the booking path, not this view

Steve, 2026-09-08: the current schedule setup ties the **parent (booking)
job's time to the delivery job's start time**, so the parent carries the
delivery window's start rather than the time the job was actually booked. The
parent job's time should be the booking time; the delivery job keeps the
schedule's window. This lives in the booking stored procedures that
materialise schedule jobs (`WS_stpJob_Insert` /
`WS_stpBulkScheduleJob_Insert` / `UTL_stpJobBooking_InsertSchedule` and the
US `DD_` equivalents), not in the schedule tables or this view. It is out of
scope here and recorded so the schedule rebuild does not bake the same
assumption into anything new: nothing in the new view should read a schedule's
day-of-week or start time as the parent job's time.

## 9. What I need from you

- The name of the link table you created, so 001 and this brief match it.
- Whether the new view lives at `/schedules` in Routed Operations or somewhere
  else in the shell.
- A delivery date for Phase 1, which then goes on the dashboard card.
