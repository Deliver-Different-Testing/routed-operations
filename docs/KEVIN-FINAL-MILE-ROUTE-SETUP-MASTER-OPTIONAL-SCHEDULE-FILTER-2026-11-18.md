# Final-mile recurring route setup: master job optional, schedules filtered by postcode

- **For:** Kevin (Routed Operations)
- **From:** Steve, 18 Nov 2026
- **Status:** Not started
- **Repo:** routed-operations (GitLab is the source of truth; this doc is on the GitHub mirror)
- **Related:** `docs/KEVIN-FINAL-MILE-TOTE-SCANNING-2026-10-16.md` (sections 4.1 and 4.7), `docs/FINAL-MILE-RECURRING-ROUTES-SPEC-2026-09-25.md`, polygon touched-postcodes spec 16 Nov 2026

## 1. What Steve asked for

Two changes to the Route editor on Recurring Routes (`wwwroot/app/react/pages/ScheduledRoutes.tsx`):

1. **Master job optional.** A final-mile route must be able to be set up and run without a master job. Today the editor reads as if one is needed.
2. **Schedule filter by postcode.** The Schedules list in the editor shows every live schedule on the tenant. Steve wants it to show only schedules that have postcodes in the route. It does not need to be a perfect match: one postcode in common is enough.

## 2. What the code does today (develop bb9bd5f)

### 2.1 Master job

- `ScheduledRoutes.tsx` shows a **Tote scanning** group whenever `direction === RouteDirection.FinalMile` (around line 1060). It holds the Master job picker and the Delivery scanning mode buttons.
- The help text under the picker says: "Without one there is nothing for the handset to open." The mode buttons are disabled with "Set a master job first: the mode is stored on it."
- Save does not block on a missing master. It sends `masterBookingId: masterBookingId ?? 0` (0 clears) and `finalMileDeliveryMode` only when a master is set (lines 787-796).
- `RecurringRouteService.ApplyMasterBookingAsync(int routeId, int? masterBookingId, byte? deliveryMode)` (line 349) clears or promotes the booking. It does not require one.

So Routed Ops itself already saves a final-mile route with no master. What is not known is whether everything after the save treats a master-less final-mile route as a normal route. That is M0.

### 2.2 Schedules list

- `recurringRouteService.getSchedules()` calls `GET /recurring-routes/schedules/lookup`, served by `RecurringRouteService.GetSchedulesLookupAsync()` (line 941). It returns one `ScheduleLookupDto` per live header: day-row id, name, start, end, days, header id, IsActive, client codes. No coverage.
- The only filter is the text box: name or client code (`filteredSchedules`, line 657).
- Route coverage in the editor is `zips` (postcode chips, `zipPolygonId`) plus `bulkPolygonIds` (custom polygons).

## 3. Change A: master job is an explicit, optional choice

### 3.1 Rule

A final-mile route either uses tote scanning or it does not.

- **Tote scanning off (the default for a new route):** no master job. The roster driver gets each delivery as its own job, the same as any other recurring route. Nothing in setup, the nightly build, dispatch, Route Viewer or the driver app may refuse, warn or skip the route because it has no master.
- **Tote scanning on:** a master job is picked and the delivery scanning mode is set, exactly as today.

### 3.2 Route editor

1. Replace the always-open Tote scanning group with a switch at the top of it: **Use tote scanning on this route**.
   - New route: off.
   - Existing route: on when `initial.masterBookingId` is set, off otherwise.
2. Switch off: hide the Master job picker and the Delivery scanning buttons. Show one line: "Drivers get each delivery as its own job."
3. Switch on: show the picker and the mode buttons as today. Remove the sentence "Without one there is nothing for the handset to open."
4. Switch on with no master picked: Save is refused with "Pick a master job, or turn tote scanning off." This is the only place a master is required, and only because the user asked for tote scanning.
5. Turning the switch off on a route that has a master clears it on save (the existing `masterBookingId: 0` path) and says so before saving: "Turning this off unbinds booking {label} from this route."
6. The routes list keeps showing the master where there is one. A route without one shows nothing in that place, not a warning.

### 3.3 Backend

- No change expected to `ApplyMasterBookingAsync` or the DTOs.
- Anything found at M0 that assumes a master on a `Direction = 2` route is fixed so the route behaves as a normal recurring route when it has none. Database objects go through dbmigrationsv2, re-emitted from master's latest.

### 3.4 Out of scope

- The red "No master job set" on a **linehaul run** in Schedules NEW (`ScheduleDetailModal.tsx` line 3223) stays. A linehaul run does need its master.
- The driver app tote screens. A route with no master simply never opens them.

## 4. Change B: only show schedules with postcodes in the route

### 4.1 Rule

- **Route postcodes** = the route's postcode chips, plus every postcode touched by its selected custom polygons (`BulkRunPolygonZip`, any overlap, per the 16 Nov rule that a touched postcode is assessed).
- **Schedule postcodes** = the postcodes the schedule can be booked into, by the same definition availability uses. Do not write a second definition: at M0 name the existing read and reuse it.
  - NZ: postcodes of the schedule's ticked zones in its zone group, plus postcodes touched by that group's polygons.
  - US: ZIPs of its ticked zones (`ZoneZip`) plus its bound ZIPs (`tblSchedulePostcode`).
  - Neither set: the schedule is depot-wide. Treat it as covering every postcode under its depot.
- **Which end:** a final-mile route is compared with the schedule's delivery end, a first-mile route with its pickup end. Confirm the Transfer case at M0.
- **Match** = at least one postcode in common. It is not a perfect match and never needs to be.

### 4.2 API

New endpoint, POST because the editor's coverage is usually unsaved:

`POST /api/recurring-routes/schedules/coverage-match`

```
Request:  { direction: byte, zipPolygonIds: int[], bulkPolygonIds: int[] }
Response: { routePostcodeCount: int,
            rows: [ { scheduleId: int,      // same day-row id the lookup returns
                      matchedCount: int,    // route postcodes this schedule covers
                      depotWide: bool } ] }
```

- Only schedules with `matchedCount > 0` are returned. A depot-wide schedule is returned with `depotWide = true` when at least one route postcode sits under its depot.
- Set-based, one query per tenant shape. No per-schedule loop. Urgent has about 2,000 live headers, so measure it at M0 and say what it costs.
- Inherits `BaseController`, logs with a MessageId, NP and branch scope the same as the lookup.

### 4.3 Route editor

1. A tick box above the list: **Only schedules covering this route's postcodes**.
   - On by default when the route has any coverage.
   - Disabled with the hint "Add postcodes or a polygon to filter by coverage" when it has none.
2. On: the list shows matched schedules only, sorted by `matchedCount` descending, then name.
3. Each row shows the overlap in its second line: "12 of 40 postcodes", or "Whole depot" for a depot-wide schedule.
4. A schedule that is already ticked is always shown, even with no overlap, with a small amber "no postcodes in common" tag. Nothing is unticked automatically.
5. The text filter keeps working on top of the coverage filter.
6. The match is recalculated when coverage changes, debounced (about 400 ms), and when the route direction changes.
7. Off: the list is exactly as today.

## 5. Decisions

| # | Question | Default in this spec | Owner |
|---|----------|----------------------|-------|
| D1 | With no master, does the driver get each delivery as its own job, with no tote scanning? | Yes | Steve |
| D2 | Do depot-wide schedules show when the filter is on? | Yes, labelled "Whole depot" | Steve |
| D3 | Is the filter on by default? | Yes, when the route has coverage | Steve |
| D4 | Transfer routes: which schedule end is compared? | Kevin proposes at M0 | Kevin |

## 6. Tests and done-when

1. New final-mile route, tote scanning off, save: no master is written and no warning shows. On staging the next build gives the roster driver the deliveries as ordinary jobs.
2. Existing route with a master opens with the switch on and saves unchanged.
3. Switch on, no master, Save: refused with the message in 3.2.
4. Switch turned off on a route with a master: the booking is unbound and stops being `IsLinehaulMaster`.
5. Route with 40 postcodes, filter on: only schedules sharing at least one postcode are listed, each showing its count; a schedule sharing exactly one is listed.
6. A ticked schedule with no overlap stays listed with the amber tag.
7. Route with no coverage: the tick box is disabled and the full list shows.
8. Route covered only by a custom polygon: schedules covering a postcode the polygon touches are listed.
9. Filter off: the list matches today's lookup row for row.
10. US tenant (Medical or Cheetah staging) and NZ tenant (Urgent staging) both pass 5 to 9.

Unit tests for the match query (pure set logic) and one Playwright flow for the editor, per the repo testing rule. No full-page MSW vitest.

## 7. Milestones

| # | Milestone | Done when |
|---|-----------|-----------|
| M0 | Checks, read-only, posted before building | Every place that assumes a master on a final-mile route is listed (nightly build, dispatch, Route Viewer, driver app procs) with what happens today when there is none; the existing schedule coverage read is named for NZ and US; the match query is timed on Urgent; D4 proposed |
| M1 | Master job optional | Section 3 built; tests 1 to 4 pass locally |
| M2 | Coverage match endpoint | Section 4.2 built with unit tests; timing acceptable on Urgent staging |
| M3 | Schedule filter in the editor | Section 4.3 built; tests 5 to 9 pass |
| M4 | On staging | Urgent and one US tenant; test 10 passes; Steve signs off |
| M5 | Released | Production, release notes |
