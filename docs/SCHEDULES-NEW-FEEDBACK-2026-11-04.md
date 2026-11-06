# Schedules NEW: November feedback, build spec

**For:** Kevin
**Date:** 2026-11-06
**Branch:** `docs/schedules-new-feedback-2026-11-04`
**Baseline:** latest `master` at build time. As of writing that is `fbe24c7`.

## 1. Where this came from

Three inputs from the week of 2 November.

1. **"New Schedules feedback November 4th 2026"** (Google Doc, Marcus with a section from Nisa).
   Mixed bag: real bugs, UX gaps, data tidy-up and three roadmap features.
2. **Marcus, 5 Nov, "Bug Fix Required - Some Schedules not Showing in Recurring Routes".**
   Two examples only: `Fresh Connection Whangarei` on live, and the Stryker Medical Run schedules
   on staging, which Naresh could not see either.
3. **Marcus, 6 Nov,** his reply to this spec. It decides D2 and D3, confirms B4 with a named
   schedule, reverses the section 6 ownership and moves one item from Kerran to Kevin. Section 1a
   summarises it.

Everything below is sorted into what is a bug with a code anchor, what is a build, what needs a
decision from Steve first, and what is not Kevin's work at all. Section 7 is the last of those and is
worth reading before anything is picked up, because three items in the source doc belong to Kerran.

**Codebase facts in this spec were read off `gl/master` `fbe24c7` on 6 Nov.** Where a claim in the
source documents could not be confirmed from code it is marked **to reproduce** rather than restated
as fact.

## 1a. Marcus's answers (6 Nov)

Marcus reviewed this spec on 6 Nov and answered all six questions. The answers are folded into the
sections below. This is the summary and, more importantly, what each answer changed.

| What | His answer | What it changed |
|---|---|---|
| **D2, custom versus default** | Build the per-schedule switch, scoped to block defaults "for this region and speed". Not sure the zone-group version will ever be needed; happy to come back to it if so. | **D2 decided, option 3.** Option 2 drops from "the right end state" to a maybe, which takes pricing spec 6.4 off this spec's critical path entirely. |
| **D3, Recurring Routes in two places** | Recurring routes live on the left-nav page. "No need for their own page in schedules at all." | **D3 decided**, and more cleanly than I proposed: the tab is removed rather than made read-only. |
| **B4, zone groups empty** | Schedule `#89 Zimmer AKL > CHC pre-10am medical` shows neither a collection nor a delivery zone group. "Basically every schedule I checked shows the same." | **B4 goes from needing reproduction to confirmed and estate-wide.** Two causes found in code, and they split the report in half. One of them is not a bug at all. See B4. |
| **B1, more examples** | None beyond Fresh Connection Whangarei and Stryker. Akhil and Naresh may have more. | The diagnostic query in B1 is now the only thing that separates the two causes. Run it before writing the fix. |
| **Section 6, the tidy-up** | Disagrees that it is an ops task. Thousands of schedules, and ops would be matching like for like by eye. Wants it done in bulk by a developer. | **Reversed.** T2, T3 and T4 become one bulk job and are no longer blocked behind search and export, which reorders the milestones. Owner needs deciding: D5. |
| **Section 7, the Kerran split** | Pricing to Kerran. But pulling the duplicated linehaul fields out belongs with Kevin, who owns that section and recurring routes, and removing them does not touch pricing. | One item moves from Kerran to Kevin, as **S7**. The other three stay with Kerran. |

**Two things he raised that were not in the original doc.**

He wants the book time inside operating days pulled out of the roadmap and into the build, on the
grounds that it is the smallest of the new features and is really the legacy "pickup minutes in
advance" under a better name. He attached two requirements to it that the source doc did not have.
Both are in section 7 as **R1**, and whether it joins this spec is **D7**.

He does not accept that Nisa's charge-once-only is the right fix for the problem behind it. His read
is that an unusual pricing structure is being forced through the schedule, and his alternative is a
different feature: two schedules that stitch together at booking. That is **D6**, and it is the one
answer that opens a question rather than closing one.

## 2. Bugs

### B1. The recurring routes picker silently drops schedules (Marcus, 5 Nov)

**Reported:** some schedules cannot be selected when attaching a schedule to a recurring route.
`Fresh Connection Whangarei` (live) and the Stryker Medical Run schedules (staging).

**The picker is `RecurringRouteService.GetSchedulesLookupAsync()` (`:934`).** It has two properties
that each produce the reported symptom, and they are independent. Do not assume one and stop.

**Cause A, the `AutoBook` filter.** The query's only `WHERE` is:

```csharp
.Where(s => (s.AutoBook ?? false) == false)
```

Every auto-book schedule is therefore absent from the picker, with no message and no empty-state
hint. `AutoBook` means book-immediately rather than stage (`ScheduleDtos.cs:91`), and `RunService`
(`:33`) does drop auto-book jobs out of runs, so the exclusion was probably deliberate. It is not
documented as deliberate anywhere, and a standing client run like Stryker Medical is exactly the
shape that tends to carry `AutoBook = 1`.

**Cause B, grouping on pre-identity fields.** The picker groups by
`(Name, StartTime, EndTime, ClientId, Region, SpeedId)` and returns `g.Min(x => x.BulkRunScheduleId)`
per group. That composite was the schedule's identity *before* the header table. It is not any more:
day rows have carried `ScheduleId` (FK to `tblBulkRunScheduleHeader`) since the September re-key.

So two distinct headers that happen to agree on those six values collapse into **one** picker entry
and the higher id is unreachable. That is not hypothetical on this tenant: the source doc asks for a
duplicate-schedule merge precisely because near-identical schedules exist in bulk, and the Step F
collapse work has been splitting and unconverting day rows across headers.

`BuildScheduleLookupAsync` (`:276`) groups the same way, and its doc comment says so explicitly, so
the read side and the picker are at least consistent with each other. Both are keyed on the wrong
thing.

**Also missing, and worth fixing in the same pass:** the query filters on neither `RetiredUtc` nor
`IsActive`, so retired and deactivated schedules are offered. That is the opposite complaint and
nobody has raised it, but it is the same query.

**Diagnostic, run this first.** It separates A from B without guessing:

```sql
-- the two reported schedules, with everything the picker keys on
SELECT h.ScheduleId, h.Name, h.IsDefault, h.IsActive, h.RetiredUtc,
       s.BulkRunScheduleId, s.AutoBook, s.ClientId, s.Region, s.SpeedId,
       s.StartTime, s.EndTime, s.DayOfWeek
FROM   tblBulkRunScheduleHeader h
JOIN   tblBulkRunSchedule s ON s.ScheduleId = h.ScheduleId
WHERE  h.Name LIKE '%Fresh Connection%' OR h.Name LIKE '%Stryker%'
ORDER  BY h.ScheduleId, s.DayOfWeek;

-- how many headers are being collapsed tenant-wide by the picker's key
SELECT s.Name, s.StartTime, s.EndTime, s.ClientId, s.Region, s.SpeedId,
       COUNT(DISTINCT s.ScheduleId) AS Headers
FROM   tblBulkRunSchedule s
GROUP  BY s.Name, s.StartTime, s.EndTime, s.ClientId, s.Region, s.SpeedId
HAVING COUNT(DISTINCT s.ScheduleId) > 1
ORDER  BY Headers DESC;
```

If the first query shows `AutoBook = 1` it is cause A. If the second returns rows covering those
names it is cause B. It can be both.

**Build.**

1. Re-key the picker on `ScheduleId`. Group by the header, not the legacy composite, and return the
   header id. Day aggregation stays as it is. `BuildScheduleLookupAsync` moves with it so the two
   stay in step, and its comment gets updated rather than left describing the old key.
2. Decide `AutoBook` per **D1** below rather than quietly dropping or keeping it.
3. Exclude `RetiredUtc IS NOT NULL`. Leave `IsActive` alone for now and surface it as a label on the
   row instead, because an operator may legitimately be wiring up a route ahead of activating the
   schedule.
4. The picker shows the client code next to the name. Both reported schedules are client-named, and
   an operator hunting a missing schedule should be able to see at a glance whether they are looking
   at the right one.

**Done when:** both reported schedules are selectable in their environments, and the second
diagnostic query returns no group whose headers are not all individually selectable.

### B2. Copying a schedule still writes a default (Nisa 2.3)

**`ScheduleService.CopyAsync` hardcodes `IsDefault = true` (`:2230`).**

Spec 6.1 made `IsDefault` a real setting on 20 Oct, but only on two of the three write paths. Upsert
honours the request on both arms (`:1439` on update, `:1487` on create). Copy was missed. So the
pre-6.1 behaviour survives on copy: the duplicate is a default, bookable by everyone, until someone
remembers to go back in and change it.

This is almost certainly also **the ticket Kenneth raised** that the source doc records as "client
specific is still being listed as a default". Confirm that before closing it as a duplicate, but do
not write a second fix for it.

`ScheduleCopyRequest` already carries `ClientIds` and `CopyClientLinks` (`ScheduleRequests.cs:181`),
so the copy can already attach clients. It just cannot stop being a default while it does.

**Build.** `CopyAsync` takes `IsDefault` from the request, same shape as `UpsertAsync`, and the same
guard applies: `IsDefault = 0` requires at least one link row, so a copy that is client-specific must
carry clients or be refused. Nisa's ask is that this is offered **at copy time**, so the copy dialog
gets the client picker and the default/specific choice rather than making her reopen the copy
afterwards.

Nisa also asks for an **activate now or not** choice on the same dialog. `IsActive` already exists
and already has its own endpoint (`SchedulesV2Controller.cs:448`), so this is one more field on the
dialog, defaulting to inactive on a copy. Default-to-inactive is the deliberate choice here: her
stated reason for asking is that a copy is usually edited before anyone should be able to book it.

### B3. A client cannot be added to a bundle of defaults (Nisa 3.1)

**`BundleModal.tsx:345`:**

```tsx
disabled={pickedClients.length === 0 || nonDefaultCount === 0 || attachMut.isPending}
```

with `nonDefaultCount = members.filter((m) => !m.isDefault).length` (`:113`). The tooltip says
"Every member is a default; there is nothing to link a client to."

That was true when it was written and 6.1 made it false. Under 6.1 a link row on a default means
**configured for this client**: it ranks first for that client within its speed and it is the hook an
override hangs off. There is now something to link a client to. Nisa hit this on a bundle whose only
member is an all-clients schedule, which is a perfectly ordinary bundle.

**Build.** Drop `nonDefaultCount === 0` from the disabled condition. Rewrite the three pieces of
copy that assert the old premise (`:337` placeholder, `:347` title, `:389` and `:396` body text) to
say what a link row on a default actually does. The backend `AttachClientsAsync` path already
handles it; this is a frontend guard that outlived its reason.

Note `ScheduleService.cs:3381` carries the matching comment ("Default members are skipped per...").
Check whether the server also skips defaults when attaching bundle clients. If it does, that is the
real fix and the frontend guard is just the visible half.

### B4. Collection and delivery zone groups render empty (Marcus, confirmed 6 Nov)

**Confirmed and estate-wide.** The example is schedule `#89 Zimmer AKL > CHC pre-10am medical`, which
shows no collection zone group and no delivery zone group, and Marcus's note is that basically every
schedule he checked does the same. That removes the reproduction step, and it rules out a data problem
on one schedule.

There are two causes and they split the report cleanly in half.

**The collection half is not a bug. It is the unbuilt Collection card.** `ScheduleGroupDto.PickupZones`
carries the answer in its own doc comment: "Zones the collection leg collects from. Empty on every
schedule until the Collection card starts writing them." Nothing writes `BulkPickupZoneSchedule` yet,
so every schedule in the estate reads back an empty collection set, exactly as reported. There is
nothing to repair on the read side.

This is also why the source doc's suggestion to switch all the radio buttons on when the group looks
empty **must not be actioned**. The ticks gate nothing today. Writing `Active = 1` across a group now
would sit dormant and then become live behaviour on the day pricing spec 6.4 ships, which is the one
change in this area nobody would connect back to a tidy-up done months earlier.

**The delivery half is a real read-side defect.** `ScheduleService.MapGroup` builds both zone lists
from the first day row only:

```csharp
var t = rows[0];
var zones       = t.BulkZoneSchedules.OrderBy(z => z.Zone)...
var pickupZones = t.BulkPickupZoneSchedules.OrderBy(z => z.Zone)...
```

`rows` is ordered by `DayOfWeek`, and `BulkZoneSchedule.ScheduleId` holds a **day-row** id rather than
a header id despite its name. `TblBulkRunScheduleDay.cs` carries the warning in as many words:
"Naming trap worth keeping in view: `BulkZoneSchedule.ScheduleId` and
`BulkPickupZoneSchedule.ScheduleId` hold a DAY-ROW id, not a header id, despite the name."

So a schedule whose zone rows were written against any day row other than its earliest renders as
having no zones, while the booking path, which reads the day rows directly, still honours them. No
error is raised either way. A `NULL` `DayOfWeek` row sorts first in SQL Server and produces the same
result. The write path sets these rows per day row, so a schedule edited one day at a time is a
plausible way to arrive here, and "basically every schedule" is consistent with the zone rows sitting
on a day row that `rows[0]` is not.

**What is not the cause.** The named group fields, `PostcodeGroupId` and `PickupPostcodeGroupId`, are
separate from the zone ticks and read correctly through the `tblBulkRunSchedule` compatibility view,
which coalesces the day row over the detail row for both columns (migration `20261009177000`, lines
531 and 537). A collapsed schedule therefore still reports its groups, so Garry's 5 Nov collapse run
is not implicated. If `#89` shows no group **name**, confirm the group was ever set on it before
treating the UI as at fault. The first query below answers that in one go.

**Diagnostics.** Settle `#89` first:

```sql
SELECT h.ScheduleId, h.Name, d.BulkRunScheduleId, d.DayOfWeek,
       d.PostcodeGroupId, d.PickupPostcodeGroupId,
       (SELECT COUNT(*) FROM BulkZoneSchedule z
          WHERE z.ScheduleId = d.BulkRunScheduleId) AS DeliveryZoneRows,
       (SELECT COUNT(*) FROM BulkPickupZoneSchedule p
          WHERE p.ScheduleId = d.BulkRunScheduleId) AS CollectionZoneRows
FROM tblBulkRunScheduleHeader h
JOIN tblBulkRunScheduleDay   d ON d.ScheduleId = h.ScheduleId
WHERE h.ScheduleId = 89
ORDER BY d.DayOfWeek;
```

If the group columns are populated and `DeliveryZoneRows` is non-zero on a row that is not the first,
the `rows[0]` defect is confirmed on a named schedule. Then size it across the estate:

```sql
-- Headers holding delivery zone rows that MapGroup cannot see, because they
-- hang off a day row other than the earliest one. The inner ORDER BY mirrors
-- EF's OrderBy(DayOfWeek); ties are arbitrary in both, so treat a count of 1
-- as approximate and the pattern as the finding.
SELECT h.ScheduleId, h.Name, COUNT(*) AS HiddenZoneRows
FROM tblBulkRunScheduleHeader h
JOIN tblBulkRunScheduleDay   d ON d.ScheduleId = h.ScheduleId
JOIN BulkZoneSchedule        z ON z.ScheduleId = d.BulkRunScheduleId
WHERE h.RetiredUtc IS NULL
  AND d.BulkRunScheduleId <> (
        SELECT TOP 1 d2.BulkRunScheduleId
        FROM tblBulkRunScheduleDay d2
        WHERE d2.ScheduleId = h.ScheduleId
        ORDER BY d2.DayOfWeek, d2.BulkRunScheduleId)
GROUP BY h.ScheduleId, h.Name
ORDER BY HiddenZoneRows DESC;
```

**Build.** Read the zones for the whole schedule rather than from `rows[0]`: union the zone rows
across every day row of the header, distinct on `(Zone, Active)`, and surface a conflict rather than
silently taking one day's answer when two days disagree. Leave the write path keyed on day rows in
this pass, because changing the key is a migration and the read fix alone restores what ops see. Do
not attempt the collection half: it needs the Collection card, which is pricing spec 6.4 work.

### B5. Bundle modal dropdown clipping: fix exists, not merged

Fixed on 21 Oct on the GitHub mirror, branch `fix/bundle-modal-dropdown-clipping`, commit `126faaf`.
It is **not on `master`**, confirmed on 6 Nov. One line: `min-h-[32rem]` on the modal content
wrapper, because the shared `Modal` body is `overflow-auto` (`Modal.tsx:106`) and clips the
absolutely positioned picker lists at the panel edge.

That was flagged at the time as the cheap fix. The complete one is to portal both dropdown lists out
to the overlay so no ancestor can clip them, which also covers opening a picker while the body is
scrolled. Since the bundles modal is being touched again for **B3**, do it properly now and drop the
`min-h` approach.

## 3. Zone groups

This is the largest coherent block in the feedback and the one with the clearest payback: both Marcus
and Nisa independently describe the same workflow failing, which is reading and editing the postcodes
inside a group.

| # | Build | Source |
|---|---|---|
| Z1 | Search and filter on the zone groups list. Today it is an unfiltered list that has to be eyeballed. | Marcus |
| Z2 | Show the postcodes in a zone. The group view shows zone number, a label and a count, and no way to reach the postcodes behind the count. | Marcus, Nisa 1.1 |
| Z3 | Export a group to CSV: zone, suburb name, postcode, matching what Client Manager gives today. Nisa's team copies these out to send to clients. | Nisa 1.2 |
| Z4 | Edit a postcode's zone from inside the group. Today the only route is the Zones tab, one postcode at a time, selecting depot and group each time. Marcus's example is moving Papakura from zone 3 to zone 2 on AH. | Marcus, Nisa 1.3 |
| Z5 | Copy a zone group. The row menu has open, edit, bind polygons and delete, and no duplicate. Nisa's new empty group had to be populated by hand. | Marcus, Nisa 1.3 |
| Z6 | Bulk insert postcodes into a group, by paste or upload. | Marcus, Nisa 1.3 |
| Z7 | Make the linked-schedules list clickable through to the schedule. | Marcus |
| Z8 | Remove the Depots sub-view. Depots are maintained in Settings / Admin setup, and listing them here read-only with no add or edit invites the assumption they are maintained here. | Marcus |

Z2, Z3 and Z4 are the three that remove manual work today; Z5 and Z6 are what make a new group
possible without an afternoon of typing. Z1 is small. Z7 is small. Z8 is a deletion.

**Z9, map view (not in this phase).** A map of the postcodes coloured by zone, to build groups
visually off depot locations. Marcus calls it "super valuable". It is a different sized piece of work
to the rest of this table and should not sit in the same milestone. Polygon Builder already has the
map and the zone binding, so this may be a Polygon Builder feature rather than a Zone groups one.
Flagged for its own scoping rather than specified here.

## 4. Schedules page

| # | Build | Source |
|---|---|---|
| S1 | Split the single Depot filter into **origin depot** and **destination depot**. | Marcus |
| S2 | More filters, matching what Client Manager's schedules page offers, plus an Active / Inactive / both filter. | Nisa 2.1 |
| S3 | Make inactive-account schedules findable. Today they cannot be searched, which is what blocks the HelloFresh cleanup in T2. | Marcus |
| S4 | Widen or wrap the schedule name in the add-to-group picker. The name is unreadable at current width. | Marcus |
| S5 | Put the cutoff on the booking page automatically from the schedule's cutoff, instead of ops typing "Book by 11am" into the description by hand on every custom schedule. | Nisa 2.4 |
| S6 | Remove the Recurring Routes tab from Schedules NEW. Recurring routes are maintained on the left-nav page only. **Decided by Marcus, 6 Nov (D3).** | Marcus |
| S7 | Remove the duplicated linehaul route fields from the schedule, so they are set once on the linehaul run in recurring routes and the schedule ties to the run while holding only speed, add-on percentage and discount rules. **Moved to Kevin from Kerran by Marcus, 6 Nov:** he owns this section and recurring routes, and removing the fields does not touch pricing. | Marcus |

**S5 is the highest-value item on this page** and the only one that removes a recurring manual task
rather than making an existing one faster. The cutoff is already computed: `ScheduleService.CutoffFor`
was extracted in the F23 work so the occurrences preview and the availability function could not
drift. The booking page should render from that, not from a description string. Check whether the
description field then needs a migration to strip the hand-typed ones, or whether they can be left to
age out.

**S6 is now decided.** Marcus's answer on 6 Nov: recurring routes live on the left-nav page and need
no place inside Schedules at all. So the tab is deleted rather than made read-only, which is less work
than the reconciliation this row originally asked for.

It does not reduce the B1 fix. `GetSchedulesLookupAsync` (`:934`) and `BuildScheduleLookupAsync`
(`:276`) both carry the same bad grouping key and both need correcting: the one behind the surviving
page because it is the bug Marcus reported, and the other because dead code with a known defect in it
should be deleted along with the tab, not left to be rediscovered later.

**S7 is a deletion, which is an argument for doing it early.** It removes fields rather than adding
any, and every schedule saved against the duplicated fields in the meantime is more data to reconcile
afterwards. Confirm with Kerran before dropping the columns rather than just the UI: Marcus is right
that the route fields are not themselves priced, but rating reads parts of this shape.

## 5. Custom versus default: DECIDED, option 3 (D2)

This was the most consequential item in the feedback. Marcus settled it on 6 Nov: build the
per-schedule switch. His words: "Yes do the per schedule block defaults for this region and speed.
I'm not sure if we will ever need V2 using zones but we can come back to it later if we do."

**What that means for the build**, stated precisely because the scope is the whole point of this
section. The switch is a per-schedule flag on a custom schedule. When it is on, defaults matching
**that schedule's region and speed** are suppressed for the clients linked to it, with no
postcode-level or day-of-week term. That is option 1's blanket behaviour, made opt-in per schedule
rather than automatic, so the Rotorua problem can no longer happen by accident: it happens only where
someone deliberately asks for it.

The flag is new state on the schedule, so it needs a column on `tblBulkRunScheduleHeader` beside
`IsDefault`, surfaced in the dedupe step of the availability function rather than in its eligibility
predicate. The eligibility predicate stays `EXISTS(link) OR IsDefault = 1`; this flag belongs where
6.2's same-lane-same-speed dedupe already lives, which is the only place that can see both the custom
and the default in one pass.

**What it takes off the critical path.** Option 2 depended on pricing spec 6.4, the collection zone
ticks actually gating availability. Marcus has now said he may never need it. So 6.4 is no longer
blocking anything in this spec, and B4's collection half can stay unbuilt without holding up D2. Keep
6.4 in the pricing spec on its own merits.

The four options and their costs are kept below, because the reasoning is what makes the scope
defensible if it is questioned later.



**What shipped.** Spec 6.2, live since 19 Oct, suppresses a default for a client that has their own
schedule of the same speed on the same lane. That was decision 8, scope (a): same lane, same speed,
no day-of-week term. The narrower scope was chosen deliberately so that a custom schedule to Rotorua
would not blank out the defaults to Cambridge and Hamilton.

**What Marcus reports it doing.** The narrowness is now the problem. A medical client with a custom
afternoon delivery covering one postcode, and baggage clients with outer zones on an afternoon
delivery, are both still being offered the metro Auckland defaults, which is what ops wanted
suppressed. The intended protection became the hole.

**The four options in the doc, with what each costs:**

1. **Back to blanket.** If a custom exists for that speed and region, no default. Simplest to build
   and to explain. Reintroduces the Rotorua problem exactly as it was.
2. **Suppress on the postcodes in the group tied to the schedule.** Use the same postcode group as
   the default and switch on only the zone carrying the wanted postcodes; the rest become
   unavailable by design. This is the option Marcus reasons through furthest, and it is the only one
   that matches how ops already think about zone groups. It is also the one with a hard dependency:
   it needs the collection and delivery zone ticks to actually gate availability, and **that is
   section 6.4 of the pricing spec, which is still not built**.
3. **A per-schedule switch: "do not show defaults when this custom applies."** Explicit, per
   schedule, no inference. Cheapest to build after option 1, and it puts the decision with the person
   creating the schedule. The cost is one more thing for ops to get wrong, silently.
4. **A new speed per selective-availability case.** The doc names this as possible but not easy, and
   notes speed proliferation confuses dispatch. Recorded for completeness; not recommended.

**Recommended 3 now, 2 later. Marcus took 3 and left 2 open.** Option 3 unblocks ops this month
without waiting on 6.4, and it is reversible. If 6.4 is ever built, the ticks become the natural
mechanism and this switch can default to on for schedules that have ticks, so taking 3 now does not
foreclose 2.

**One thing to watch.** Option 3 puts the decision with whoever creates the schedule, and a missed
tick is silent: the client keeps seeing defaults and nobody finds out until they book the wrong one.
Worth showing the flag on the schedules list as a column rather than burying it in the detail modal,
so an unticked custom is visible without opening it.

## 6. Data tidy-up

Marcus reversed the assumption here on 6 Nov. The original draft had T2, T3 and T4 as ops jobs waiting
on search and export. His answer: "Disagree this should be done in bulk by a dev as we have 1000's of
schedules and would need to do like for like matching by eye if we make this an ops task."

He is right, and it is the better outcome for the schedule as well as for ops. Like-for-like matching
by eye across thousands of schedules is slow, unauditable and wrong often enough to matter, and the
duplicate-detection is a query rather than a judgement in most cases. It also **unblocks three jobs
that were sitting behind the zone group and search work**, which changes the milestone order: Z1, Z3
and S2 no longer gate the cleanup, so they can be scheduled on their own merit.

| # | Task | Owner |
|---|---|---|
| T1 | Run the squash. | Kevin + Garry, already in flight |
| T2 | Remove customs linked to inactive accounts, HelloFresh and similar, then remove zone groups left tied to no schedule. | Bulk, D5 |
| T3 | Merge duplicate zone groups. The same Auckland zones exist separately for UC, AirNZ and Qantas because the old format needed one per depot. | Bulk, D5 |
| T4 | Find schedules that are identical but flagged custom per client, and merge the clients onto one schedule. | Bulk, D5 |

**How a bulk job should run, given it is production data.** Each of the three is a candidate query
plus a change, and the two should be separated: emit the candidate list, have ops confirm the list
rather than each row, then apply. T4 in particular needs an agreed definition of identical before any
merge, because "identical but flagged custom per client" is exactly the shape that `tblScheduleClient`
now represents properly, so the merge is a link-rows change rather than a delete. Retire rather than
delete wherever `RetiredUtc` exists, so the whole job is reversible.

**T4 still interacts with B1.** Merging duplicates reduces the collapsing in the picker but does not
fix it, because the grouping key is still wrong. Fix B1 on its own merits and do not let the cleanup
become its justification.

## 7. Not in this spec

**Kerran's, per the standing rule that rating work goes to Kerran even when it is SQL.** Status
checked against `gitlab.com/deliver-different` on 6 Nov: everything Kerran has merged is on `master`
in all six repos he works in, with nothing of his left on `develop`. So none of the below is sitting
half-shipped; they are simply not built yet.

- Linehaul pricing living inside the schedule, and moving the rates for each speed and linehaul run
  into rating alongside the zone rates by speed.
- ~~Removing the duplicated linehaul route fields from the schedule.~~ **Moved to Kevin on 6 Nov at
  Marcus's request.** Now **S7** in section 4. His reasoning: Kevin owns the linehaul section and
  recurring routes, and removing the fields does not impact pricing.
- **Nisa 2.5, charge-once-only on the linehaul leg.** Her example is schedule `#2911 Betscharts CHC >
  AKL Chilled`: she needs the linehaul charged once regardless of item count while the final mile
  stays per item with the add-on percentage. Kerran's existing "cartons once" checkbox flattens both.
  She is asking for the separate "charge once only" that the collection part already has. This is a
  specific, well-evidenced rating bug and should go to Kerran as its own item rather than sit in a
  Schedules NEW spec.

  **Marcus does not think this is the right fix (6 Nov).** See **D6**: he reads it as sales having
  built an unusual pricing structure, pallet rates on the linehaul and cartons on delivery, and then
  forcing the schedule to carry it. His alternative is two schedules that stitch together at booking.
  Kerran can still do the follow-up, but it should not start before D6 is answered.

  **Confirmed not built (6 Nov).** No commit touching cartons-once, charge-once or linehaul rating
  exists on configurator `master` in the last 60 days; the only linehaul commit in that window is
  Jacob's Mantine conversion. Worth saying plainly when this goes to Kerran: the checkbox he built is
  the thing Nisa is reporting as wrong, so this reads as a follow-up to his own work rather than a
  new ask.
- Direct Drive Sameday on the delivery leg for the new US speeds. Kerran already did the equivalent
  for the old Urgent P2P speeds.

**R1. Book time within operating days. Marcus asks for this in scope (D7).**

Set book time within operating days, so a 1pm cutoff can make collections live from 2pm and delivery
next day 8am. The case is holding freight for bulk collection to target lower-value goods on routes
already covered, plus baggage and home-delivery collections.

Marcus's 6 Nov position is that this is the smallest of the new features, not a roadmap item: "its
basically a set time for pickup which we used to have with 'pickup minutes in advance'". That is a
useful anchor, because it means the feature has a precedent in the legacy app and does not need
designing from nothing. He added two requirements the source doc did not have:

- **Operating days should read down the day in the order things happen:** cutoff, then collection,
  then delivery. Today the fields do not present in that order, which is why a 1pm cutoff producing a
  next-day 8am delivery is hard to read back.
- **Copy Monday's settings to the following days.** Setting five to seven days by typing every time
  and day by hand is, in his words, time consuming and finicky. Note this is the same complaint that
  the collapse work addresses in the data; here it is about the editor.

The second of those is worth doing **whether or not D7 goes ahead**, because it applies to every
schedule anyone sets up today, and it is independent of the book-time field.

**Roadmap, needs its own scoping, not fixes:**
- Flights as linehaul legs, with flight rating rather than item rates. Zimmer has wanted this for ETA
  certainty; Nelson, Dunedin and Invercargill are the named lanes.
- Collection-only schedules ending at a depot, the mirror of the delivery-only schedule already
  enabled for the Whakatane case.
- Z9, the zone map view.

**Already decided, no action:** client-specific zone groups. Marcus's own conclusion in the doc is
that a client-specific zone group is just a zone group used by one client, which needs no feature.

## 8. Decisions

| # | Decision | Status |
|---|---|---|
| D1 | **B1, `AutoBook` in the recurring routes picker.** Is excluding auto-book schedules deliberate? If it is, the picker should say so in its empty state instead of silently omitting them. If it is not, drop the filter. | **Open.** Ask Kevin: he or Garry will know whether an auto-book schedule can meaningfully carry a route. Decide before building B1, since it changes the fix. |
| D2 | **Custom versus default scope.** Section 5. | **DECIDED, Marcus 6 Nov: option 3**, per-schedule switch scoped to region and speed. Option 2 parked, possibly permanently. |
| D3 | **S6, Recurring Routes in two places.** | **DECIDED, Marcus 6 Nov:** left-nav page only. The Schedules tab is removed, not made read-only. |
| D4 | **B2, activate-on-copy default.** Should a copied schedule be inactive until someone activates it? | **Open, recommend yes.** Nisa's reason for asking is that a copy is edited before anyone should book it. |
| D5 | **Who runs the section 6 bulk tidy-up.** Marcus has ruled out ops doing it by eye. It is production data across thousands of rows, so it is SQL rather than a UI feature. | **Open, Steve.** Recommend Kerran: he holds production write access and the standing split sends row-level production fixes to him, with Kevin on the code. If it goes to Kevin instead he will need the write path arranged, which is the slower route. |
| D6 | **Nisa 2.5 versus Marcus's alternative.** Nisa asks for charge-once-only on the linehaul leg. Marcus argues the real problem is an unusual pricing structure being forced through one schedule, and that the answer is two schedules stitched together at booking. | **Open, Steve, and it is the consequential one.** Nisa's version is a small rating change against a real booking she cannot price today. Marcus's version is a new feature with no estimate and would not land this month. Recommend doing Nisa's as the unblock and scoping Marcus's separately, but he should hear that framing rather than see his point dropped. |
| D7 | **R1, book time within operating days: in this spec or its own?** Marcus asks for it in scope and calls it the smallest of the new features. | **Open, Steve.** It is still a new feature in a fix spec, and this spec already carries five bugs, a decided D2 build and a deletion. Recommend taking only the copy-Monday-to-other-days part now, which is editor work Kevin is already in, and scoping the book-time field separately. |

## 9. Milestones

Reordered on 6 Nov after Marcus's answers. D2 and D3 are decided, so M0 is smaller; the section 6
cleanup is no longer behind search and export, so M5 no longer gates it.

| # | Milestone | Done when |
|---|---|---|
| M0 | D1 answered, D5 to D7 decided | Kevin answers `AutoBook`; Steve answers the tidy-up owner, the Nisa 2.5 question and whether R1 is in scope. |
| M1 | B1 recurring routes picker | Both reported schedules selectable; picker keyed on `ScheduleId`; retired and inactive excluded; diagnostic query returns no unreachable header. Both lookup methods corrected. |
| M2 | B2 copy honours `IsDefault` | Copy dialog offers default/specific plus clients plus activate; `CopyAsync` no longer hardcodes; Kenneth's ticket confirmed as the same bug and closed. |
| M3 | B3 and B5 bundles | Client can be added to an all-defaults bundle, server path checked, guard rewritten; dropdowns portalled so nothing clips. |
| M4 | B4 delivery zones read correctly | `#89` diagnostic run and reported; zones read across all day rows of the header rather than `rows[0]`; estate query returns zero. The collection half stays unbuilt and no `Active` row is written. |
| M5 | D2 built | The per-schedule switch live, visible on the list, and confirmed by Marcus against the medical and baggage cases he raised. |
| M6 | S6 and S7 deletions | Recurring Routes tab gone from Schedules NEW; duplicated linehaul route fields gone from the schedule, confirmed with Kerran. |
| M7 | Section 6 bulk tidy-up | T2, T3 and T4 candidate lists emitted, confirmed by ops, applied reversibly. Owner per D5. |
| M8 | Z1, Z3, S2, S3 search and export | A zone group's postcodes can be searched, read and exported; inactive-account schedules findable. |
| M9 | Z2, Z4, Z5, Z6 zone group editing | A group can be read, duplicated, bulk-filled and re-zoned without using the Zones tab. |
| M10 | Z7, Z8, S1, S4 small items | Linked schedules clickable; Depots sub-view gone; origin and destination depot filters; schedule name readable in the group picker. |
| M11 | S5 cutoff on the booking page | Booking page renders cutoff from `CutoffFor`; no new schedule needs "Book by" typed into its description. |
| M12 | R1, if D7 says yes | Operating days read cutoff, collection, delivery in order; Monday's settings copy to the other days; book time within operating days honoured by the booking page. |
