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
Due by: 2026-09-14 — Phase 1 (section 7) in tenant staging for testing, per Steve 2026-09-08

## TL;DR

Build a **new** Schedules view in Routed Operations, next to the existing
schedules screen, not in place of it. It is Dane's redesigned schedules module
(visual route builder, base schedules with client overrides, schedule groups)
adapted so that **a schedule has its own `ScheduleId` and any number of clients
attached to it**, per the link-table brief. The existing screen stays as it is
until ops confirm they can do their work in the new one.

- **Mockup of what to build:** https://claude.ai/code/artifact/e90fe293-31f1-4238-93bf-c54001ca7419 (interactive; *+ New Schedule* opens
  Dane's creator with the Clients row, attach clients, create an override, view
  as a client, open a group, open the Roster tab, switch to the Recurring
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
  not a separate page) — and every schedule has a Roster tab showing the
  routes and run that deliver it, including the run's **master job**.
  Section 2b explains the model and what is read-only here.
- **Where it lives:** in the Routed Operations shell as a second sidebar
  entry, "Schedules (NEW)", next to the existing Schedules page
  (`routedoperations.urgent.deliverdifferent.com/schedules`). The existing
  page and the existing Recurring Routes page are untouched.
- **React code to lift:** section 3.
- **Data model:** the header + link tables from migration 001, plus
  `BaseScheduleId` on the header and two small group tables (section 5).
- **Booking window:** the look-ahead moves from `Show Days in Future` in Admin
  Manager to *show the next n schedules* on the schedule itself, per Marcus's
  ticket (section 5b). Phase 1 ships the count only, and counting schedules
  means the booking path must read the holidays table to know it has bookable
  dates to return.

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

4. **Booking window** — a row under Clients in the header card: *show the next
   `n` schedules*. This is Marcus's look-ahead, moved off the Admin Manager
   speeds grid and onto the schedule, with a per-client value available on the
   link row. Section 5b has the model, the rules and what it depends on.

The header row on this modal, like the table's column headers, stays anchored
while the body scrolls.

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
   becomes *Schedule Config | Clients (n) | Client Overrides | Roster*, with
   Client Overrides disabled until the schedule is saved (an override needs a
   saved base to point at).
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

### Roster tab on a schedule (new)

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
- The row in the Schedules table summarises the same thing in a **Roster**
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
are deep-linked from the Roster tab.

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

## 3. Built: the React module in this repo

The view is coded, not just specified. It lives in this repo's Routed
Operations frontend and runs on sample data until Kevin's API is wired in:

| | |
|---|---|
| App | `v2/frontend` (Vite + React 18 + Tailwind, the Routed Operations shell) |
| Route | `/schedules` — sidebar entry "Schedules NEW" (`src/App.tsx`, `src/components/Shell.tsx`) |
| Page | `src/pages/SchedulesPage.tsx` wraps the module |
| Dane's module, vendored | `src/schedules/` = `admin-schedules-module/src` (components, features/import-export, modules/schedules, territory types) with his tokens merged into `tailwind.config.js` and his CSS in `src/schedules/schedules.css` |
| Run | `cd v2/frontend && npm install && npm run dev` → http://localhost:4595/routebuilder/schedules |
| Check | `npm run build` (tsc + vite, clean) · `npm test` (vitest) |

What was added on top of Dane's code, all under `src/schedules/modules/schedules/`:

| File | What it does |
|---|---|
| `types.ts` | `Schedule.visibility` ('all' \| 'specific'), `clientIds` (link rows), `baseScheduleId`; `isOverrideOf`, `getClientIds`, `getVisibility`; table rows nest by id; `multiDayToPerDay` **never writes the one-to-one ClientId** |
| `utils/clientLinks.ts` | The rules: resolution (override › shared › default), attach / detach / visibility, override creation moves the client's link, attach-to-group, clients-via-schedules, attach blockers |
| `dispatch/types.ts`, `dispatch/dispatchData.ts` | Recurring routes, linehaul runs, master job, roster resolution (date override › weekly › default), joins to schedules |
| `components/AttachClientsModal.tsx` | Search-and-tick picker with greyed-out blockers; single-pick mode for overrides |
| `components/ClientsTab.tsx` | Who can book: visibility radio, attached list, overrides list, create override |
| `components/DispatchTab.tsx` | The Roster tab: routes bound, linehaul runs, master job, seven-day roster strips |
| `components/RecurringRoutesTab.tsx` | The Recurring Routes rows with Type filter, Schedule(s), Clients via schedule, Master job |
| `components/ScheduleTable.tsx` | Clients and Roster columns, Defaults / Shared / Overrides filter, View as client, Attach action, overrides nested under their base |
| `components/ScheduleEditForm.tsx` | CLIENTS row in the header card; tab strip Schedule Config · Clients · Client Overrides · Roster (overrides disabled until saved) |
| `components/ScheduleTableView.tsx` | Controlled schedules, attach from the row, create / open override, override save moves the client off the base |
| `components/ScheduleGroupsTab.tsx`, `SchedulesPage.tsx` | Attach clients to group; Recurring Routes tab; one schedules state shared by all tabs |
| `api/v2.ts` | Typed client + DTOs for Kevin's ScheduleId-keyed endpoints (unused until `VITE_SCHEDULES_API` is set) |
| `data/sampleData.ts` | Dane's samples given link rows: a default, two shared schedules, a two-client schedule, an override by id |

Tests (`npm test`): new tests in `utils/clientLinks.test.ts`,
`dispatch/dispatchData.test.ts`, `compat.test.ts` and
`components/ClientsTab.test.tsx`. `compat.test.ts` is the compatibility suite
against the old view: one day row per enabled day as before, no ClientId
written on any day row, legacy rows with a ClientId still read as that
client's schedule, and on legacy one-to-one data the new resolution rule
returns exactly what the old rule returns (the only difference being a base
hidden behind a client's own override).

What Kevin still does: replace the sample-data sources with `api/v2.ts`
calls (the DTOs are the contract), wire Roster / Route / Run / master-job
deep links to the existing pages, **create the two schedule-group tables and
their API (below — a launch blocker)**, and keep the old Schedules page
alongside until ops sign off.

> **Launch blocker — schedule groups have no table yet.** The Schedule Groups
> tab (expand, Quick Copy, Copy & Edit, Add Client Override, Attach clients to
> group) is fully built and runs on sample rows only; Dane's module never had a
> production table for groups. Before this view launches, Kevin adds
> `tblBulkRunScheduleGroup` and `tblBulkRunScheduleGroupMember` (DDL in
> section 5) and the `/api/v2/schedule-groups` endpoints in `api/v2.ts`
> (list / create / update / delete, and `POST …/{id}/clients` which writes one
> link row per client per non-default member). Without them every group
> disappears on refresh. Steve, 2026-09-08.

## 3b. Where Dane's original React code is

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
showNextSchedules: number | null;   // booking look-ahead, header-level (section 5b); null = tenant default
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

-- booking look-ahead (section 5b): how many upcoming occurrences of this schedule to offer.
-- NULL on both = fall back to the tenant default. Do not back-fill from Show Days in Future.
ALTER TABLE dbo.tblBulkRunScheduleHeader ADD ShowNextSchedules int NULL;
ALTER TABLE dbo.tblBulkRunScheduleClient ADD ShowNextSchedules int NULL;  -- per-client value, beats the header
```

Attaching a client to a group writes link rows; the group is a convenience,
the link table is the only record of who uses what. **These two tables do not
exist today and must be created before launch** — the Schedule Groups tab has
nothing to persist to without them.

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

## 5b. Booking window — count schedules ahead, not days ahead

Marcus Pouwels-Strang asked for the booking look-ahead to be expressed as a
**number of upcoming schedules** rather than a number of calendar days
([Monday 10720956793](https://exsalerate.monday.com/boards/6935564321/pulses/10720956793),
raised 2025-12-07). His words: *"If we can change to show number of schedules
in the future it will be easier to keep to a low number of schedules returning
and manage Friday for Tuesday on public holidays without needing at least 4
schedules ahead."*

The ticket was written against Admin Manager's client *available speeds* grid,
where the field is `Show Days in Future`, sitting beside `NoS Daily Limit`.
That grid is no longer the home of this information; the schedule is. Steve's
call (2026-09-10): **build the setting here, in the new Schedules view, and
leave the Admin Manager grid alone.**

### Why days is the wrong unit

A day window is a proxy for the thing actually being capped, which is the
length of the list the booking screen returns. Its yield swings with each
schedule's own day pattern: three days ahead is three bookable dates on a
weekday schedule and none at all on a Tuesday-only one. Marcus's case is the
public-holiday one — to let a Friday booking reach the following Tuesday
across a Monday holiday, the day value has to be widened, which then floods
the list on every ordinary day. A count of occurrences is invariant to those
gaps, which is exactly the property he is asking for.

### Phase 1 is the count, and only the count

Steve, 2026-09-10: ship `ShowNextSchedules` on its own and leave the calendar
day value out of the new UI for Phase 1. Whoever sets a schedule up knows its
cadence and can pick a number that covers the days they need, so a second
control earns nothing yet.

Worth knowing what the day value was quietly doing, so the decision is
deliberate: it also capped **how far out** a booking could land. A count alone
does not. A weekly schedule set to show three occurrences accepts bookings
three weeks out, where three days ahead never could. If that turns out to
matter for a low-frequency schedule, the backstop to add later is
`MaxDaysAhead` on the header, applied as *whichever limit is smaller*. It is
not needed to make Marcus's change work, and it is not in Phase 1.

Do not confuse that with the horizon that stops the forward walk looping
(next section). The horizon is a code guard rail with a tenant constant behind
it; `MaxDaysAhead` would be an ops-facing limit on a schedule. Only the second
one is a decision anyone gets to make in this view, and it is deferred.

### What counts as one occurrence

Being precise here is what makes the number predictable. An occurrence is a
date this schedule runs where all of the following hold, tested **in this
order**:

1. the day is enabled on the schedule (a day row exists for it);
2. the date is not a holiday for any site the occurrence touches (holidays
   are held per region — see below);
3. the cut-off for that date has not passed (cut-off is per day);
4. the daily limit for that date is not already reached (`NoS Daily Limit`).

The generator does not scan a fixed window and filter it. It **walks forward
from today, one candidate date at a time, and keeps going until it has
collected `ShowNextSchedules` dates that pass all four tests**. That is the
whole point of counting schedules rather than days: the walk cannot run out of
window, so a holiday simply pushes the last occurrence further out instead of
dropping it off the end.

Counting **before** those filters returns a list of slots nobody can book,
which is the same complaint in a new shape.

Bound the walk so it terminates. A schedule with every day disabled, or one
sitting behind a long shutdown, must not spin: stop after a fixed horizon
(a tenant constant, not a per-schedule setting) and return however many
occurrences were found, with the UI saying the horizon was reached. This is a
guard rail in code, not the calendar-day control that Phase 1 leaves out.

### Reading the holidays table is mandatory, not optional

Steve, 2026-09-10: because the setting counts **schedules** rather than days,
the generator has to read the holidays table to be sure it actually has
bookable schedules to return.

This is the part that changes with the new unit. A day window is allowed to
come back short: ask for three days, get whatever falls inside them, possibly
nothing. A count is a **promise to return that many bookable occurrences**, so
the walk has to know which dates are non-operating before it can decide
whether it has finished. Skip the holidays table and the count silently
over-promises: the list shows occurrences on days nothing runs, and the client
books into a closed day.

It also makes Marcus's Friday-for-Tuesday case fall out for free. With Monday
a holiday, the walk skips Monday and takes Tuesday as the next occurrence, so
asking for two schedules still returns two bookable ones. No widening, and no
extra rows on ordinary days. The behaviour he reports today is consistent with
the holiday adjustment being applied *after* the look-ahead filter, so the
shifted date lands outside the window; walking with the calendar in hand
removes that ordering entirely.

Nothing in the schedules module has any concept of a public holiday today.
`CutoffException` in `types.ts` is a per-weekday cut-off rule, not a calendar,
so this is new wiring in the booking path rather than a switch to flip.

### Holidays are held per region, so the lookup is per site

Steve, 2026-09-10: holidays are recorded **by region**, with a site / region /
state on each holiday row. That matters more here than it looks, because
anniversary days are provincial: a date can be a holiday at one end of a
linehaul and an ordinary working day at the other. A single national lookup
would suppress bookable occurrences in regions that are working, which is the
same over-restriction Marcus is complaining about, just in a different place.

The rule the walk should apply:

- **Every site the occurrence touches must be operating on its own date.**
  The leg chain already names them: the collection site, the depots on a
  linehaul leg (`fromDepotId` / `toDepotId`), and the destination region
  (`tblBulkRunSchedule.Region`). A depot closed for its anniversary day cannot
  tranship, so a trunk leg through it is not bookable that day.
- **Pickup region governs collection and cut-off; destination region governs
  delivery.** The two ends are on different dates whenever the schedule spans
  days, so each is tested against its own date, not against the booking date.
- **Resolve a holiday row to the most specific match, then widen.** A date is
  non-operating for a site if a row matches that site, or its region, or its
  state. That way a national holiday needs one row and a local anniversary
  needs one row, with no duplication per site.

What I still need (section 9) is the table name and how a schedule's region and
depots key into its site / region / state columns. `Region` on the day row is a
`BulkRegion` and the legs carry depot ids, so unless those are the same
identifiers the holidays table uses, there is a small mapping to agree on.

### Per schedule, or one number for the client's whole list?

Open question for Steve and Marcus, and the only real fork here.

- **Per schedule** (what this section specifies). Faithful to what Marcus
  configures today: his grid already carries different values per service
  (`90minSchedule` at 3, `Afternoon Home` at 9), and a service maps to a
  schedule, so per-schedule keeps that ability. The tenant default does the
  work for the majority and ops only touch the outliers.
- **Per client, across the whole list.** Steve's example (2026-09-10) points
  at this reading: *"If they have 5 schedules a day, then they might need to
  put 20 or 30 into the future."* Five schedules a day, twenty offered, is
  four days of coverage across all of them. One schedule runs at most once a
  day in this model (one day row per day-of-week), so a number in the twenties
  only makes sense as a total across schedules.

They answer different questions and are not mutually exclusive: per schedule
stops one dense schedule flooding the list, per client keeps the total list
short. Build per schedule first, because that is the field being replaced and
it lives naturally in this view. If the total is what ops actually want to
control, that is a client-level number with no home in these tables yet, and
it needs a client settings row rather than the link table. Confirm before
Phase 2.

### Where the value lives

On the **header**, with a per-client value on the **link row**. Resolution,
mirroring the schedule resolution rule above:

1. `ShowNextSchedules` on the client's link row, if set;
2. `ShowNextSchedules` on the schedule header, if set;
3. the tenant default.

Per-client variation goes on the link row, **not** into a new override
schedule. Spawning an override to change one number would rebuild exactly the
per-client copy sprawl this workstream is retiring (522 copies), and an
override also drags along its own day rows and route. An override that exists
for other reasons carries its own value on its own header, as any schedule
does.

```sql
-- effective booking window for client @c on schedule @s
SELECT COALESCE(l.ShowNextSchedules, h.ShowNextSchedules, @TenantShowNextSchedules) AS ShowNextSchedules
FROM dbo.tblBulkRunScheduleHeader h
LEFT JOIN dbo.tblBulkRunScheduleClient l ON l.ScheduleId = h.ScheduleId AND l.ClientId = @c
WHERE h.ScheduleId = @s;
```

### Where it appears in the UI

| Place | What goes there |
|---|---|
| `ScheduleEditForm.tsx` | a **Booking window** row in the form's header card, directly under the CLIENTS row (both are schedule-level, not per-day): *Show the next `[n]` schedules* |
| `ClientsTab.tsx` | the effective number for each attached client, with an inline edit that writes the link row — so a client needing to see further ahead never needs its own schedule |
| `ScheduleTable.tsx` | an **Ahead** column, so ops can spot the schedules returning long lists |
| `BookingSimulator.tsx` | the Booking Tester lists the occurrences the booking screen would return for the chosen client and date — this is how the holiday case gets demonstrated without touching the booking path |
| `types.ts` | `showNextSchedules` on `Schedule` (header-level) and on the link row |
| `utils/clientLinks.ts` | the resolution helper beside `effectiveSchedulesForClient`, with unit tests |

Same rule as the one-to-one `ClientId` (section 8a): this field is
header-level and must **never** be written onto day rows by
`multiDayToPerDay`.

### Enforcement and migration

- **The UI setting is not the enforcement.** The booking path has to apply the
  cap when it builds the list of offered dates. That is backend work in the
  same booking procedures noted in section 8b, and it is where the ordering in
  *What counts as one occurrence* has to be implemented.
- **Do not convert the existing day values into occurrence counts.** Leave
  `ShowNextSchedules` null on migration so every schedule falls back to the
  tenant default, and let ops set the outliers in this view. The old value is
  per client **per speed**, and a schedule is not a speed, so there is no
  reliable arithmetic from one to the other.
- `Show Days in Future` stays where it is in Admin Manager and keeps working
  until the booking path reads the new setting. Nothing in this view writes it.

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
| PUT | `/api/v2/schedules/{id}/clients/{clientId}` | Body `{ showNextSchedules }` — the per-client booking window on the link row (section 5b); `null` clears it back to the header value. |
| POST | `/api/v2/schedules/{id}/overrides` | Body `{ clientId }` → creates the override, moves the link, returns the new schedule. |
| GET | `/api/v2/clients/{clientId}/schedules` | Resolution rule above, with `source`. |
| GET / POST / PUT / DELETE | `/api/v2/schedule-groups` | Groups + members. |
| GET | `/api/v2/schedules/{id}/dispatch` | Routes bound to the schedule (with the next 7 days of roster resolved: date override › weekly › default) and the linehaul runs behind its legs. Read-only. |
| GET | `/api/v2/recurring-routes?type=first\|middle\|final&q=` | The existing Recurring Routes rows (routes and runs) plus `scheduleIds[]`, `clientsViaSchedule[]`, and for runs `mode`, `speed`, `masterJob { jobNumber, materialisedUtc, itemsLinked }`. Writes stay on the existing Recurring Routes API. |
| POST | `/api/v2/schedule-groups/{id}/clients` | Body `{ clientIds: [] }` → link rows on every non-default member. |

`CreatedBy` on link rows is the logged-in user. The schedule payload carries
`showNextSchedules` on the header and on each link row, and
`/api/v2/clients/{clientId}/schedules` returns the **effective** value per
schedule (link row › header › tenant default) so the UI never re-derives it.

## 7. How to build it in Routed Operations

1. **New route, new sidebar entry** — `/schedules` under Routed Operations
   with the label "Schedules (new)". The Configurator / ClientManager schedules
   screen is untouched. Both read the same day rows, so ops can open a schedule
   in each and compare.
2. **Phase 1 — read-only list + modal** on the 001 tables: table with Clients
   and Roster columns, nesting by `BaseScheduleId`, View-as-client, modal
   with Clients / Route / Days / Roster tabs read-only, plus the read-only
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

The booking window (section 5b) rides along rather than forming its own phase:
the value is **displayed** in Phase 1, **editable** in Phase 2 with the other
link-row writes, and **enforced** in the booking path separately, on the
backend, alongside the section 8b work. The two columns need to exist before
Phase 1 so the list and modal can show the value.

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
- A schedule group created in the new view survives a refresh, and attaching a
  client to it writes the link rows on its non-default members (the group
  tables and API exist — see the launch blocker in section 3).
- A schedule with no booking window set shows the tenant default, and setting
  a value on one client's link row changes that client's number without
  creating an override or touching any other client.
- The Booking Tester, run for a client on a schedule, lists exactly the
  occurrences the resolved number allows, skips dates whose cut-off has
  passed, and never returns a date the day rows do not cover.
- With a public holiday on the next operating day, the same schedule still
  returns the full count, with the last occurrence pushed further out rather
  than the list coming back short. This is the Friday-for-Tuesday case, and it
  is the check that proves the holidays table is being read.
- On a provincial anniversary day, only the schedules touching that region lose
  the date. A schedule running wholly in another region returns its usual
  occurrences, and a linehaul between the two is suppressed for whichever end
  is closed. This is the check that proves the lookup is per region rather than
  national.

## 8a. The one-to-one ClientId is not exposed

Steve, 2026-09-08: the new UI never shows or edits `tblBulkRunSchedule.ClientId`.
Every client reference is a row in the schedule/client link table. The module
enforces that in `multiDayToPerDay` (day rows go out with no ClientId) and in
the UI (the only client controls are the CLIENTS row, the Clients tab and the
attach picker, all of which write link rows). Kevin's migration owns clearing
the legacy column; the view does not depend on it.

## 8a-ii. Import / Export is hidden for now

Steve, 2026-09-08: Dane's Import / Export button is removed from the page
header until the feature actually applies imports (today it ends in a console
log) and export is verified against the real table. The code stays under
`src/schedules/features/import-export/`; re-add the button in
`SchedulesPage.tsx` once both work.

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
- The name of the holidays table, and how a schedule keys into its site /
  region / state columns (section 5b). Holidays are per region, and a schedule
  carries a `BulkRegion` on the day row plus depot ids on its legs, so I need
  to know whether those are the same identifiers or need a mapping. Counting
  schedules ahead means the booking path must read this table to know it has
  real bookable dates to return, so it is a Phase 2 dependency, not a detail.
- Confirmation from Marcus that his ticket means *four days ahead*, not four
  schedules: the field he is looking at is labelled in days, so the wording
  reads both ways.
- Phase 1 is due in tenant staging on **2026-09-14** (on the dashboard card).
