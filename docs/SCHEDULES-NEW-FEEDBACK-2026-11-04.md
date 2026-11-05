# Schedules NEW: November feedback, build spec

**For:** Kevin
**Date:** 2026-11-06
**Branch:** `docs/schedules-new-feedback-2026-11-04`
**Baseline:** latest `master` at build time. As of writing that is `fbe24c7`.

## 1. Where this came from

Two inputs, both from the week of 2 November.

1. **"New Schedules feedback November 4th 2026"** (Google Doc, Marcus with a section from Nisa).
   Mixed bag: real bugs, UX gaps, data tidy-up and three roadmap features.
2. **Marcus, 5 Nov, "Bug Fix Required - Some Schedules not Showing in Recurring Routes".**
   Two examples only: `Fresh Connection Whangarei` on live, and the Stryker Medical Run schedules
   on staging, which Naresh could not see either.

Everything below is sorted into what is a bug with a code anchor, what is a build, what needs a
decision from Steve first, and what is not Kevin's work at all. Section 7 is the last of those and is
worth reading before anything is picked up, because four items in the source doc belong to Kerran.

**Codebase facts in this spec were read off `gl/master` `fbe24c7` on 6 Nov.** Where a claim in the
source documents could not be confirmed from code it is marked **to reproduce** rather than restated
as fact.

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

### B4. Collection and delivery zone groups render empty (source doc, Collections)

**To reproduce.** The doc reports that the collection zone group now displays as empty in the UI,
that nothing fails so the binding is presumably still applied underneath, and that the same has
happened to delivery zones. There is no screenshot evidence in the doc beyond one image reference and
I could not confirm a cause from code, so this is a reproduction task before it is a build task.

Worth knowing while reproducing: `BulkPickupZoneSchedule` and `BulkZoneSchedule` are both keyed on
the **day row** id despite the column being called `ScheduleId`, and the pickup table is
`NOT NULL` on both `ScheduleId` and `Active` where the delivery one is nullable. A read that joins on
the header id instead of the day row id returns nothing and fails silently, which matches the
reported symptom exactly. That is the first place to look.

The doc also asks that all radio buttons be switched on when the group is empty, on the grounds that
collection zones used to default to the entire group. **Do not do that blind.** Writing `Active = 1`
across a group is a data change on live rows, and section 6.4 of the pricing spec is still unbuilt,
so the ticks do not gate anything yet and an incorrect mass tick would become live behaviour the day
6.4 ships. Reproduce first, report what the rows actually say, then decide.

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
| S6 | Reconcile Recurring Routes appearing both as a tab inside Schedules NEW and as its own left-nav section, with different UI and different language in each. | Marcus |

**S5 is the highest-value item on this page** and the only one that removes a recurring manual task
rather than making an existing one faster. The cutoff is already computed: `ScheduleService.CutoffFor`
was extracted in the F23 work so the occurrences preview and the availability function could not
drift. The booking page should render from that, not from a description string. Check whether the
description field then needs a migration to strip the hand-typed ones, or whether they can be left to
age out.

**S6 is a decision before it is a build.** See D3.

## 5. Custom versus default: the scope question (D2)

This is the most consequential item in the feedback and it is a decision, not a build.

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

**Recommendation: 3 now, 2 later.** Option 3 unblocks ops this month without waiting on 6.4, and it
is reversible. Option 2 is the right end state and should be built on top of 6.4 rather than instead
of it, because if 6.4 lands first the ticks become the natural mechanism and option 3's switch can
default to on for schedules that have ticks.

**Steve to decide. Nothing here should be built until he does.**

## 6. Data tidy-up

Not code, but it is in the feedback and it changes what the code has to cope with.

| # | Task | Owner |
|---|---|---|
| T1 | Run the squash. | Kevin + Garry, already in flight |
| T2 | Remove customs linked to inactive accounts, HelloFresh and similar, then remove zone groups left tied to no schedule. Blocked on **S3**. | Ops, after S3 |
| T3 | Find duplicate zone groups. The same Auckland zones exist separately for UC, AirNZ and Qantas because the old format needed one per depot. | Ops, needs **Z1** and **Z3** to be practical |
| T4 | Find schedules that are identical but flagged custom per client, and merge the clients onto one schedule. | Ops, needs **S2** |

T2, T3 and T4 all depend on search and export landing first. That is the argument for doing Z1, Z3
and S2 early: they are small, and three cleanup jobs are waiting behind them.

**T4 interacts with B1.** Merging duplicates reduces the collapsing in the picker. It does not fix
it, because the key is still wrong, and the merge is ops work that will take weeks. Fix B1 on its own
merits.

## 7. Not in this spec

**Kerran's, per the standing rule that rating work goes to Kerran even when it is SQL:**

- Linehaul pricing living inside the schedule, and moving the rates for each speed and linehaul run
  into rating alongside the zone rates by speed.
- Removing the duplicated linehaul route fields from the schedule so they are set once on the
  linehaul run in recurring routes, with the schedule tying to the run and holding only speed,
  add-on percentage and discount rules.
- **Nisa 2.5, charge-once-only on the linehaul leg.** Her example is schedule `#2911 Betscharts CHC >
  AKL Chilled`: she needs the linehaul charged once regardless of item count while the final mile
  stays per item with the add-on percentage. Kerran's existing "cartons once" checkbox flattens both.
  She is asking for the separate "charge once only" that the collection part already has. This is a
  specific, well-evidenced rating bug and should go to Kerran as its own item rather than sit in a
  Schedules NEW spec.
- Direct Drive Sameday on the delivery leg for the new US speeds. Kerran already did the equivalent
  for the old Urgent P2P speeds.

**Roadmap, needs its own scoping, not fixes:**

- Set book time within operating days, so a 1pm cutoff can make collections live from 2pm and
  delivery next day 8am. Marcus's case is holding freight for bulk collection to target lower-value
  goods on routes already covered, plus baggage and home-delivery collections.
- Flights as linehaul legs, with flight rating rather than item rates. Zimmer has wanted this for ETA
  certainty; Nelson, Dunedin and Invercargill are the named lanes.
- Collection-only schedules ending at a depot, the mirror of the delivery-only schedule already
  enabled for the Whakatane case.
- Z9, the zone map view.

**Already decided, no action:** client-specific zone groups. Marcus's own conclusion in the doc is
that a client-specific zone group is just a zone group used by one client, which needs no feature.

## 8. Decisions

| # | Decision | Recommendation |
|---|---|---|
| D1 | **B1, `AutoBook` in the recurring routes picker.** Is excluding auto-book schedules deliberate? If it is, the picker should say so in its empty state instead of silently omitting them. If it is not, drop the filter. | Ask Kevin first: he or Garry will know whether an auto-book schedule can meaningfully carry a route. Decide before building B1, since it changes the fix. |
| D2 | **Custom versus default scope.** Section 5, four options. | Option 3 now, option 2 once 6.4 is built. Steve. |
| D3 | **S6, Recurring Routes in two places.** One is the Schedules NEW tab, one is the left-nav section, and they differ in UI and wording. Which survives? | Keep the left-nav section as the maintenance surface and make the Schedules tab a read-only view that links to it. Steve to confirm. |
| D4 | **B2, activate-on-copy default.** Should a copied schedule be inactive until someone activates it? | Yes, inactive. Nisa's reason for asking is that a copy is edited before anyone should book it. |

## 9. Milestones

| # | Milestone | Done when |
|---|---|---|
| M0 | D1 and D3 answered | Kevin answers `AutoBook`; Steve answers Recurring Routes duplication. |
| M1 | B1 recurring routes picker | Both reported schedules selectable; picker keyed on `ScheduleId`; retired excluded; diagnostic query returns no unreachable header. |
| M2 | B2 copy honours `IsDefault` | Copy dialog offers default/specific plus clients plus activate; `CopyAsync` no longer hardcodes; Kenneth's ticket confirmed as the same bug and closed. |
| M3 | B3 and B5 bundles | Client can be added to an all-defaults bundle, server path checked, copy rewritten; dropdowns portalled so nothing clips. |
| M4 | B4 zone groups empty | Reproduced, cause reported, fix agreed with Steve before any `Active` rows are written. |
| M5 | Z1, Z3, S2, S3 search and export | The four cleanup jobs in section 6 are unblocked. |
| M6 | Z2, Z4, Z5, Z6 zone group editing | A group can be read, duplicated, bulk-filled and re-zoned without using the Zones tab. |
| M7 | Z7, Z8, S1, S4 small items | Linked schedules clickable; Depots sub-view gone; origin and destination depot filters; schedule name readable in the group picker. |
| M8 | S5 cutoff on the booking page | Booking page renders cutoff from `CutoffFor`; no new schedule needs "Book by" typed into its description. |
| M9 | D2 built | Whichever option Steve picks in section 5, live and confirmed by Marcus against the medical and baggage cases he raised. |
