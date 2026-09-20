---
title: Kevin — Schedules (NEW) fix list: client overrides, migration defects, schedule shape
date: 2026-09-20
audience: Kevin
status: Active brief — fixes and product moves on the new Schedules view
source: Steve, walkthrough of the deployed new Schedules view, 2026-09-18 → 2026-09-20
supersedes: nothing — sits on top of KEVIN-SCHEDULES-NEW-ENHANCEMENTS-2026-09-18.md (E1/E2/E3 still stand)
related_docs:
  - KEVIN-SCHEDULES-NEW-ENHANCEMENTS-2026-09-18.md
  - KEVIN-NEW-SCHEDULES-VIEW-MULTI-CLIENT-2026-09-08.md
  - KEVIN-SCHEDULE-CLIENT-LINK-BY-SCHEDULE-ID-2026-09-08.md
  - STEVE-SCHEDULE-RATIONALISATION-KEVIN-2026-09-08.md
  - KEVIN-SCHEDULES-ZONES-ZONE-GROUPS-HANDOVER-2026-08-21.md
---

# Schedules (NEW) — fix list

## Where the code is

Everything referenced below is in the schedules module as it stands on branch
`claude/schedule-link-regression-review`:

```
v2/frontend/src/schedules/modules/schedules/
```

It is **not** on `main` yet. Line numbers are from that branch — if you have moved
on, take the anchors as landmarks rather than coordinates.

The three enhancements from Friday (E1 group membership, E2 wildcard member search,
E3 bound routes on the row) are unchanged and still queued behind the schedule-group
tables. Nothing in this document replaces them. This is the defect and direction list
from walking the deployed view.

## TL;DR

| # | Item | Kind |
| :- | :- | :- |
| **F1** | A client override creates a **full clone** of the schedule. It should record only the differences. | Model — biggest item |
| **F2** | Override rows sit in the schedule list as schedules, so Days / Origin / Dest / Mode render as `—` | Follows from F1 |
| **F3** | "Differs on" is stored, computed three different ways, and discarded on one save path | Bug |
| **F4** | Create override is dead in one of the two places the schedule modal is mounted | Wiring |
| **F5** | Storage / delivery state: the legacy **int** is handed to a string-valued select with no mapping | Migration defect |
| **F6** | A collection section appears on schedules that never booked a collection job | Migration defect |
| **F7** | Delivery zone group blank; zone rows are read one way and written another | Migration defect + data loss |
| **F8** | Row 0 of the day set decides every shared field, and `MaxJobs` is hardcoded to 10000 on save | Data loss (not reported — found) |
| **F9** | Linehaul detail and linehaul **pricing** live on the schedule; they belong on the run | Direction |
| **F10** | Collection should be driven by its zones, not by a pickup depot; needs a transfer source and inwards-goods locations | Direction |
| **F11** | Cut-off still reads backwards from the delivery job in hours; it should be a firm time with a collection window or on-demand | Direction |
| **F12** | "Book from client address" should be a depot setting — this is what moves eco runs onto schedules | Direction |
| **F13** | Schedule name vs client-facing display name | Small feature |
| **F14** | Collection box discount field is gone from the UI | Regression |
| **F15** | Rates, additional-item rules and dimension rules have no home in the new view | Separate piece — scoping only |
| **F16** | Depot filter is a dead control; some columns do not sort; overrides scatter when you do sort | Small fixes |

Order of work is in §5.

---

# 1. Client overrides

## F1 — What a client override actually creates today

**You asked what happens when a client override is created, and whether it is a full
custom schedule. It is a full custom schedule.** The intention — record only the
differences by client — is not what the code does.

### What the code does

`ScheduleTableView.tsx:180` (`handleCreateOverride`):

```ts
const override: Schedule = {
  ...base,                 // ← every field of the base, copied
  id: Date.now(),          // ← a new ScheduleId
  isOverride: true,
  baseScheduleId: base.id,
  visibility: 'specific',
  clientIds: [clientId],
  overriddenFields: [],
  ...
};
```

So an override is a complete second schedule: all legs, all zones, all speeds, all
day rows, the whole operating schedule, the whole leg chain — with a new id and a
pointer back to the base. `api/v2.ts:91` matches that shape: `POST
/api/v2/schedules/{id}/overrides` returns a full `ScheduleDto`.

There are **three** places that build one, and they do not agree:

| Path | File | Sets |
| :- | :- | :- |
| Clients tab → "Create override for a client…" | `ScheduleTableView.tsx:180` | `baseScheduleId`, `visibility`, `clientIds`, clears `displayName` |
| Side-by-side editor | `SideBySideOverrideEditor.tsx:44` | `baseScheduleId`, `clientVisibility`, renames to `Base (CLIENT)` |
| Client Overrides tab | `ClientOverridesTab.tsx:71` | **no** `baseScheduleId` — links by `baseScheduleName` only, **no** `visibility`/`clientIds`, sets legacy `clientId` |

The third one matches its overrides back to the base **by name**
(`ClientOverridesTab.tsx:26`), which is the exact failure mode the link-table brief
was written to end.

### Why this produces every symptom you saw

- *"It looks like it creates a new schedule ID"* — it does, by design of the current code.
- *"It says it differs on cut-off but I changed the speeds"* — see F3.
- *"I switched Monday and Friday off; Days is listed as differing but the day column is empty"* — see F2.
- 2,725 schedules today; every client who wants a different cut-off adds another one.
  This is precisely the proliferation the rationalisation exercise just spent
  11,110 rows → 2,725 schedules undoing.

### What it should be

An override is a **delta row per (schedule, client)**, not a schedule. The
overridable set is already closed and already written down — `types.ts:965`,
`OVERRIDABLE_FIELDS`: booking cut-off, operating days, delivery speed, pickup speed,
linehaul speed, delivery zone group, pickup zone group. `NON_OVERRIDABLE_FIELDS`
(`types.ts:975`) already says legs, origin type, pickup depot and region are *not*
overridable — which is the tell that an override was never meant to be a whole
schedule. A closed set means typed nullable columns, not an EAV table: resolution at
booking time is one `COALESCE` join rather than a pivot.

```sql
CREATE TABLE dbo.tblBulkRunScheduleClientOverride (
  ScheduleId            int NOT NULL REFERENCES dbo.tblBulkRunScheduleHeader (ScheduleId),
  ClientId              int NOT NULL,
  -- every value column: NULL = inherit from the base schedule
  CutoffHours           int           NULL,
  WeekDays              char(7)       NULL,  -- '1111100' Mon..Sun; NULL = inherit
  SpeedId               int           NULL,
  PickupRatingSpeed     int           NULL,
  ParentSpeedId         int           NULL,
  PostcodeGroupId       int           NULL,
  PickupPostcodeGroupId int           NULL,
  IsActive              bit           NULL,
  DisplayName           nvarchar(200) NULL,  -- F13
  DisplayDescription    nvarchar(500) NULL,
  CreatedUtc  datetime2(0)  NOT NULL DEFAULT SYSUTCDATETIME(),
  CreatedBy   nvarchar(100) NOT NULL,
  UpdatedUtc  datetime2(0)  NULL,
  UpdatedBy   nvarchar(100) NULL,
  PRIMARY KEY (ScheduleId, ClientId));

CREATE INDEX IX_tblBulkRunScheduleClientOverride_ClientId
  ON dbo.tblBulkRunScheduleClientOverride (ClientId) INCLUDE (ScheduleId);
```

Resolution at booking time is then one left join:

```sql
SELECT COALESCE(o.CutoffHours,       s.CutoffHours)       AS CutoffHours,
       COALESCE(o.SpeedId,           s.SpeedId)           AS SpeedId,
       COALESCE(o.PickupRatingSpeed, s.PickupRatingSpeed) AS PickupRatingSpeed,
       COALESCE(o.PostcodeGroupId,   s.PostcodeGroupId)   AS PostcodeGroupId,
       ...
  FROM dbo.tblBulkRunSchedule s
  JOIN dbo.tblBulkRunScheduleHeader h ON h.ScheduleId = s.ScheduleId
  LEFT JOIN dbo.tblBulkRunScheduleClientOverride o
         ON o.ScheduleId = h.ScheduleId AND o.ClientId = @ClientId
 WHERE h.ScheduleId = @ScheduleId;
```

Days deserve one note: days are **rows**, not a column, so "switch Monday and Friday
off for this client" is a row-level difference. `WeekDays char(7)` is the cheap
version and covers what you actually did — days on/off. Per-day *time* overrides
(Monday delivers 10:00 for this client only) are not covered and should stay out of
phase 1; if ops asks for them, they need a child table, and I would rather see the
demand first than build it.

### API

Replace `POST /api/v2/schedules/{id}/overrides` (returns a schedule) with:

| Method | Route | Body / notes |
| :- | :- | :- |
| GET | `/api/v2/schedules/{id}/overrides` | `[{ clientId, clientCode, clientName, fields: { cutoffHours?, weekDays?, speedId?, … }, updatedUtc, updatedBy }]` — only the keys actually set |
| PUT | `/api/v2/schedules/{id}/overrides/{clientId}` | Full replace of that client's delta. A key set to `null` clears the override and returns the client to the base value. An empty body deletes the row. |
| DELETE | `/api/v2/schedules/{id}/overrides/{clientId}` | Client returns to the base entirely |

`ScheduleDto.overriddenFields` stays "computed server-side" as `api/v2.ts:39` already
says — it becomes the key list of the delta row, which is the same thing and now
cannot drift (see F3).

An override no longer moves the client's link row off the base. The client stays
attached to the base schedule and carries a delta — that is the whole point.
`upsertOverride` and `attachBlocker` in `utils/clientLinks.ts` lose their
move-the-link behaviour; `effectiveSchedulesForClient` stops excluding overridden
bases, because there is no longer a second schedule to prefer.

**A default schedule is still overridable** and should stay that way: a client with a
delta on a default keeps using the default schedule, it does not get pulled out into
"specific". That falls out of the model for free once the override is a delta rather
than a schedule.

### Migration

Two populations:

1. **Clones created through the new view.** Fold each back: read the clone, diff it
   against its base over the overridable set, write one delta row, retire the clone
   header. Anything that differs *outside* the overridable set (a different leg
   chain, a different depot) is not an override — it is a genuinely different
   schedule and must be left alone and reported.
2. **Legacy client-specific schedules.** `types.ts:735` reads `isOverride:
   first.clientId != null`, so every legacy ClientId-bearing schedule presents as an
   override with no base. The rationalisation output already identifies which of
   these are variants of a common parent and what they differ on —
   `scripts/schedule-rationalisation/output/variants.csv` (`DiffersFromGroup1On`) and
   `merge_groups.csv`. Fold only the sets whose `DiffersFromGroup1On` is inside the
   overridable list; leave the rest as schedules.

Both directions are reversible, so do them under the same `@Commit = 0` harness as
`scripts/schedule-rationalisation/sql/001_schedule_header_and_id_keyed_links.sql`.
Suggested file: `scripts/schedule-rationalisation/sql/003_client_override_deltas.sql`.

### Acceptance

- Creating an override writes **one row** and **no new ScheduleId**. The schedule
  count is unchanged after a day of ops creating overrides.
- The client stays attached to the base; the base's client list does not shrink.
- Changing only the speed produces a delta whose only non-null value column is
  `SpeedId`, and the UI says it differs on speed and nothing else.
- Clearing an override field returns that client to the base value without touching
  anything else.
- Deleting the delta leaves the client on the base, unchanged.
- An override on a **default** schedule works, and the client still resolves to that
  default.

---

## F2 — Override rows in the schedule list

**Symptom.** You switched Monday and Friday off on the UCLMP override; the modal
lists Days as differing, but the Days column on the row is empty. Origin, Dest, Mode
show `—` and Roster shows "as base".

**Cause.** `ScheduleTable.tsx:359` renders the day pills only when
`!row.isOverride`; `:366`, `:371`, `:377`, `:389` hard-code `—` / "as base" for
override rows. That was a reasonable dodge while an override was a full clone whose
copied values were meaningless — but it means the one thing you did change is the one
thing the row will not show.

**Fix.** Once F1 lands, an override is not a row in the schedule list at all. The
schedule list shows schedules; an override shows as a badge on its base's Clients
cell (`UCLMP ±`) and is edited from the base's Client Overrides tab. If you want the
deltas listed, that is a separate view keyed by client — not rows interleaved into
the schedule table.

Interim (if F1 slips past the next deploy): render the override's **own** values in
Days / Speed / Mode, and mark the cells that differ from the base. Never blank a cell
the user just edited.

**Acceptance.** The day column on an override never contradicts the "differs on
days" chip. Either both say days changed, or neither does.

---

## F3 — "Differs on" is wrong

**Symptom.** It said the override differed on cut-off when you had changed the
speeds; after you changed the cut-off it showed 3 hours in the cut-off column.

**Cause.** `overriddenFields` is *stored on the record*, and three code paths
maintain it differently:

- `ScheduleEditForm.tsx:195` computes it correctly from `OVERRIDABLE_FIELDS` plus
  `isActive`/`bookingMode`/`displayName`/`displayDescription`, using dotted keys
  (`operatingSchedule.cutoffValue`, `operatingSchedule.days`).
- `SideBySideOverrideEditor.tsx:117` computes its own list with a *different*
  vocabulary (`operatingSchedule` as one whole-object key) — and then **throws it
  away**: `onSave({ ...formSchedule, updatedAt })` never includes the array it just
  built. Whatever was on the form object survives, which for a freshly created
  override is `[]` and for an edited one is the previous save's list.
- `ClientOverridesTab.tsx:71` sets no list at all.

So the chips are a stale artefact of whichever editor last saved, in whichever
vocabulary that editor uses.

**Fix.** Never store it. The delta row from F1 *is* the difference — the field list
is `SELECT` of its non-null value columns, computed server-side, exactly as
`api/v2.ts:39` already promises. Delete `Schedule.overriddenFields` as stored state
and derive it in the view. While the two editors still exist, they must share one
diff function and one field vocabulary.

**Acceptance.** Change the speed only → the chip says Speed and nothing else.
Change the cut-off as well → Speed and Cut-off. Reload → identical. No editor can
produce a different answer from another.

---

## F4 — "Client Override is not available on default schedules"

**What I found.** There is no rule anywhere that blocks overrides on defaults. The
button's only gate is `ClientsTab.tsx:143`: `disabled={isNew || !onCreateOverride}`.
`onCreateOverride` is threaded through `ScheduleEditForm.tsx:561` from the parent —
and only one of the two parents passes it:

- `ScheduleTableView.tsx:354` passes `allSchedules`, `clients`, `onCreateOverride`,
  `onOpenOverride` — works.
- `ScheduleListTab.tsx:217` passes `schedule`, `onSave`, `onCancel`, `isNew` and
  nothing else — so `allSchedules` defaults to `[]`, `clients` defaults to the sample
  list, `onCreateOverride` is undefined and the button is permanently disabled. The
  override count badge also reads 0 because `overridesOf([], …)` is empty.

So whether you can create an override depends on which mount you opened the schedule
from, not on whether the schedule is a default. That it looked like a default-only
rule is coincidence of which list you were in.

**Fix.** One mount, or one props contract. `ScheduleEditForm` should not silently
degrade: make `allSchedules`, `clients` and the override callbacks required, and let
the two call sites supply them. If a caller genuinely cannot create overrides, pass
an explicit `canCreateOverride={false}` so the disabled state is a decision rather
than a missing prop. Drop `clients = sampleClients` as a default —
a production screen should never fall back to sample data.

**Acceptance.** Create override is available from every place a saved schedule can be
opened, default or not, and the reason text when it is disabled is true.

---

# 2. Migration defects

These three came across in the copy from the old format and are all in the read
mapper, `types.ts` `perDayToMultiDay()` (`:560`–`:740`).

## F5 — A massive number of schedules flipped to frozen storage

**Cause.** `StorageState` and `DeliveryState` are integers in production. The mapper
casts them to the UI's string union and hands them straight to a string-valued
select:

```ts
// types.ts:681 and :697
storageState:  first.storageState  as unknown as TemperatureState,
deliveryState: first.deliveryState as unknown as TemperatureState,
```

`TemperatureState` is `'ambient' | 'chilled' | 'frozen'` (`types.ts:51`) and the
select's options are those three strings (`LegConfigPanel.tsx:239`, `:364`). There is
**no mapping table anywhere in the module**. `as unknown as` is not a conversion — it
is the compiler being told to stop asking. Whatever the deployed build renders for a
numeric state is accidental, and whatever it saves back is worse.

The blast radius matches your "massive number": across the 179 rationalised schedule
sets, `StorageState` is `1` on 87, `2` on 5, `3` on 3 and NULL on 84 —
`DeliveryState` identically. Every medical schedule in the set carries `1`. So a
mis-read of the value `1` hits roughly half the estate, and medical is exactly where
you would notice it.

**Fix.**

1. Get the legacy enum from ClientManager (`Core/Domain/Despatch`, or the Angular
   schedules view's state dropdown) and write it down — I need the number → label
   mapping confirmed, not guessed.
2. Add `STORAGE_STATE_BY_ID: Record<number, TemperatureState>` and its inverse to
   `types.ts`, map on read **and** on write (`multiDayToPerDay` currently passes
   `schedule.storageState` straight back out at `:539`).
3. `NULL` means *not set*, not ambient. `LegNode.tsx:96` currently renders
   `config.storageState || 'ambient'` — that invents a value. Show "—".
4. Before/after verification: `SELECT StorageState, COUNT(*) FROM dbo.tblBulkRunSchedule
   GROUP BY StorageState` must be identical before and after a bulk open-and-save.

**Acceptance.** Open a medical schedule, save it without touching anything, and its
`StorageState` is unchanged. The distribution query is byte-identical across the
estate after a no-op save sweep.

---

## F6 — Collection section on schedules with no collection job

**Cause.** The collection leg is created only when the flag is set —
`types.ts:612`, `if (first.bookPickup)`. So the section should not appear at all for
a schedule that never booked a collection. Two candidates, and they are distinguished
by one query:

1. **`first` is not representative.** The mapper takes row 0 of the day set as
   canonical for every shared field (see F8). If a schedule's day rows disagree on
   `BookPickup` — Monday books a pickup, the rest do not — then row 0 decides for the
   whole week.
2. **`BookPickup` is not the column the old screen's tick maps to.** The new module
   carries both `bookPickup` (schedule level) and `createPickupJob` (leg level,
   hard-coded `true` at `types.ts:629`, alongside a fabricated `pickupTimeMode:
   'window'`, `14:00`–`15:00` window and `bookFromClientAddress: false`). If the old
   tick you mean is a different column, the gate is reading the wrong flag.

```sql
-- Do the day rows of one schedule disagree about booking a pickup?
SELECT h.ScheduleId, COUNT(*) AS DayRows,
       MIN(CAST(s.BookPickup AS int)) AS MinFlag,
       MAX(CAST(s.BookPickup AS int)) AS MaxFlag
  FROM dbo.tblBulkRunSchedule s
  JOIN dbo.tblBulkRunScheduleHeader h ON h.ScheduleId = s.ScheduleId
 GROUP BY h.ScheduleId
HAVING MIN(CAST(s.BookPickup AS int)) <> MAX(CAST(s.BookPickup AS int));
```

Non-zero → cause 1, and F8 is the fix. Zero → cause 2, send me the ScheduleId of one
of the schedules in your screenshot and the column the old screen writes.

**Fix either way.** Stop fabricating collection defaults. If there is no collection
job the leg is absent; if there is one, its window, mode and source come from the
data, not from `'14:00'`. A collection leg with no configured values should read
"No collection job" rather than a filled-in section that nobody entered.

**Acceptance.** A schedule with the collection tick off in the old screen shows no
collection section in the new one. Round-tripping a schedule through the new view
does not turn a collection job on.

---

## F7 — Delivery zone group blank, and zones read ≠ zones written

**Symptom.** Delivery Zone Group ended up blank on some schedules. Collection zones
are not shown the way delivery zones are.

**Cause — read.** `types.ts:687`:

```ts
const deliveryZoneIds = first.postcodeGroupId ? [first.postcodeGroupId] : [];
```

Delivery zones are derived **only** from `PostcodeGroupId`. The `BulkZoneSchedule`
rows passed into the mapper are used for the *collection* leg
(`types.ts:613`–`:616`) and never for delivery. `PostcodeGroupId` is NULL on 81 of
the 179 rationalised sets — so every schedule whose delivery geography lives in zone
rows rather than in the postcode-group column shows blank. That is your bug, and it
is also why collection and delivery look inconsistent: collection reads zone rows
with a postcode-group fallback, delivery reads only the postcode group.

**Cause — write.** `types.ts:523`:

```ts
const zones = deliveryConfig ? deliveryConfig.deliveryZoneIds.map(zoneId => ({ zoneId })) : [];
```

Save writes zone rows **from the delivery leg only**, and writes `postcodeGroupId`
from the schedule-level field independently. So a schedule read from zone rows comes
in blank, and saving it writes that blank back over the zone rows. This is live data
loss, not just a display bug — it should be the first thing fixed in this section.

**Fix.**

1. One resolver for both legs: zone rows first, postcode group as the fallback, and
   the same function for collection and delivery.
2. Write back symmetrically: whatever the resolver reads, the writer writes — both
   legs' zone rows, and `PostcodeGroupId`/`PickupPostcodeGroupId` only when the
   schedule genuinely uses the group form.
3. Until it is symmetrical, **do not let the new view save zone rows at all** —
   read-only is better than lossy.
4. Surface collection zones the same way delivery zones are surfaced (the
   `ZoneSelector` at `LegConfigPanel.tsx:189` vs `:355` — same component, give it the
   same data).

**Acceptance.** A schedule whose delivery geography is in `BulkZoneSchedule` shows
its zones. Open-and-save with no edits leaves the zone rows byte-identical. The
before/after row count of `BulkZoneSchedule` across a save sweep is unchanged.

---

## F8 — Row 0 decides everything, and MaxJobs is overwritten (not reported — found)

Worth fixing while you are in this file, because it sits underneath F5, F6 and F7.

**Row 0 wins.** `perDayToMultiDay` takes `const first = rows[0]` (`types.ts:573`) and
reads every shared field from it — speeds, cut-off, zone groups, depot, states,
flags. `multiDayToPerDay` then writes those values back to **every** day row
(`types.ts:488`–`:556`). Any schedule whose days genuinely differ is silently
flattened to Monday's values on the first save from the new view.

```sql
-- How many schedules have day rows that disagree on a shared field?
SELECT COUNT(*) FROM (
  SELECT h.ScheduleId
    FROM dbo.tblBulkRunSchedule s
    JOIN dbo.tblBulkRunScheduleHeader h ON h.ScheduleId = s.ScheduleId
   GROUP BY h.ScheduleId
  HAVING MIN(s.CutoffHours) <> MAX(s.CutoffHours)
      OR MIN(ISNULL(s.SpeedId,-1)) <> MAX(ISNULL(s.SpeedId,-1))
      OR MIN(ISNULL(s.PostcodeGroupId,-1)) <> MAX(ISNULL(s.PostcodeGroupId,-1))
      OR MIN(CAST(s.BookPickup AS int)) <> MAX(CAST(s.BookPickup AS int))
) x;
```

If that count is 0, the flattening is harmless today and the fix is a guard to keep
it that way. If it is not 0, those schedules must be detected on read and either
shown as per-day values or refused for editing until the day rows agree.

**MaxJobs.** `types.ts:533` writes `maxJobs: 10000` unconditionally on every save.
The real value is never read into the Schedule object and is destroyed the first time
anyone saves. Read it, keep it, write it back.

**Same shape, same file:** `bookingMode: 'window'` (`:708`), `cutoffUnit: 'hours'`
(`:731`) and `isActive: first.autoBook ?? true` (`:734`) are all invented on read.
The first two make the Mode column and the cut-off unit meaningless (and feed F11);
the third conflates auto-booking with active, so the Active toggle in the list is
toggling `AutoBook`.

---

# 3. Schedule shape — the product moves

## F9 — Take linehaul out of the schedule

Your four points, mapped to the code:

1. **Naming the linehaul leg duplicates the run.** There is no leg-name input in
   `LegConfigPanel.tsx` on this branch, so either the deployed build is ahead of it
   or the field is on the node header — tell me which build you screenshotted.
   Either way the answer is the same: the leg is identified by its run. No second
   name.
2. **Linehaul detail belongs on the run.** The panel already shows day offset,
   transit and active days as read-only "Inherited from run"
   (`LegConfigPanel.tsx:291`) — but the **save path does not honour that**:
   `types.ts:498`–`:518` writes `departureAdvanceDays`, `weekDay`, `minutes`,
   `fromDepotId` and `toDepotId` back into `TblBulkScheduleLinehaul` from the leg. So
   the schedule still owns a private copy of the run's attributes, and the two can
   drift. Stop writing them: the schedule's linehaul row should carry the
   `LinehaulRunId` and nothing the run already owns.
3. **Linehaul pricing out of the schedule.** `amount`, `amountPercentage`,
   `applyDiscount`, `applyAddOnPercentage` are read at `types.ts:648`–`:655` and
   written at `:513`–`:517`. This is the reason a client with different linehaul
   pricing needs a whole variant schedule — which is the same proliferation problem
   as F1, one layer down. Move them to the client's rating against the run. Once
   they are gone and speed is variable, Hamilton home delivery, chilled and medical
   can feed off one schedule, which is the outcome you are after. **This is the
   single highest-leverage item on the list after F1** — do it before the pricing and
   zones piece (F15), because it shrinks what F15 has to solve.
4. **Book-from-client-address as a depot setting** — see F12.

**Acceptance.** Changing a run's departure time changes every schedule that uses it,
with no schedule edit. No pricing column on `TblBulkScheduleLinehaul` is written by
the new view. Two clients with different linehaul prices share one schedule.

---

## F10 — Collection driven by zones, not by a pickup depot

**Where it is now.** `LegConfigPanel.tsx:61` offers a Pickup Source of *From
customer* / *From depot* / *From booking*, and *From depot* reveals an Origin Depot
select (`:96`). The type is `'client_address' | 'depot' | 'booking'`
(`types.ts:254`).

**What you want.**

- Collection pricing and availability come from the **zones enabled on the collection
  job**, so the pickup depot lookup is unnecessary — the job starts wherever the zone
  puts it and lands at the depot set in the next leg of the chain.
- Pickup source is therefore **client** or **dynamic** (a return schedule back into a
  client or a depot). Depot is not a source.
- Collection zones shown the same way delivery zones are (that is F7's item 4).
- A **third source for transfers** — CHC airport → agent's depot for linehaul. My
  read is that this is not a fourth pickup source but the depot leg used as an
  origin: a transfer is depot → depot with no customer at either end. Worth twenty
  minutes on a call before either of us builds it, because it decides whether
  `originType` grows a value or the leg chain grows a rule.
- **Neither collection nor depot offers inwards-goods delivery locations.** The
  column exists and is already plumbed — `dropOffLocationId` on both the schedule and
  the linehaul row, with a "Dropoff Location" select on the *depot* leg only
  (`LegConfigPanel.tsx:227`). Extend the same list to the collection leg and to the
  depot field on the delivery side.

---

## F11 — Cut-off: firm time, collection window, or on demand

**Where it is now.** Cut-off is a relative offset that reads backwards from the
delivery job, which is exactly the framing you deliberately moved away from:

- `OperatingScheduleSection.tsx:157` — "Default Cutoff" as a number plus a
  Minutes/Hours/Days unit, helper text *"Bookings must be received this far before
  the scheduled time"*.
- `TimelinePreview.tsx:136` — the cut-off event is computed as `firstEvent.
  absoluteMinutes - cutoffMinutes`, i.e. derived from the collection or delivery time
  by subtraction.
- `types.ts:731` hard-codes `cutoffUnit: 'hours'` on read, so everything comes back
  in hours whatever was entered.
- Editing the cut-off *time* in the timeline (`TimelinePreview.tsx:199`) converts it
  straight back into an offset.

There is already a day-specific exception structure (`CutoffException`: delivery day,
cut-off day, cut-off time — `OperatingScheduleSection.tsx:183`) that is stored as an
**absolute** day+time. So the absolute form exists; it is the special case rather
than the norm.

**Fix.** Invert it. The stored form is a firm cut-off day and time; the offset
becomes a display convenience, not the truth. Then:

- **Collection**: firm start time with a collection window, *or* on demand. Both are
  first-class choices on the collection leg, not modes derived from a delivery time.
- Everything downstream flows **forward** from the cut-off / booking, matching how
  ops and customers actually think about it.
- `CutoffHours` in the database can stay as the legacy carrier for one release —
  compute it from the absolute pair on write — but the UI must stop asking for it.

This is the one item on the list that is a genuine rewrite of a component rather than
a fix. Budget for it accordingly, and do it after F1 so you are not rewriting the
override diff twice.

---

## F12 — Book-from-client-address as a depot setting

For an outbound delivery whose depot *is* the client's address. The field exists in
three places already and none of them is a depot setting:
`bookFromClientAddress` on the collection leg (`types.ts:251`),
`fromClientAddress` on the linehaul row (`types.ts:649`), and the `client_address`
pickup source.

Make it a property of the depot: a depot can be "the client's own address", and any
leg that lands on or departs from that depot resolves to the client address at
booking time. That is what lets eco runs move onto schedules without a schedule per
client, and it is the same shape as F1 and F9 — push the per-client difference down
to the thing that actually varies, and leave the schedule alone.

---

## F13 — Schedule name and display name

Already half-built: `Schedule.displayName` and `displayDescription` exist
(`types.ts:394`), `ScheduleEditForm.tsx:113` edits them and `:238` prefers
`displayName` in the modal header. But `types.ts` marks them **UI-only** — "Not
mapped to production schedule name" — so they are not persisted, and
`ScheduleTableView.tsx:188` clears them when an override is created.

**Fix.** Two real columns on `tblBulkRunScheduleHeader`:

```sql
ALTER TABLE dbo.tblBulkRunScheduleHeader
  ADD DisplayName        nvarchar(200) NULL,
      DisplayDescription nvarchar(500) NULL;
```

`Name` stays the operational name — what ops and sales search on, what the list
shows. `DisplayName` is what the booking page shows the client, falling back to
`Name` when null. The per-client override of the display name is already in the F1
delta table.

---

## F14 — Collection box discount

`pickupBoxDiscount` survives in the type (`types.ts:432`) and round-trips through
the mapper (`:546`, `:722`), but **there is no input for it anywhere in the module** —
the only use is `types.ts:623`, which reduces it to a boolean:

```ts
additionalItemChargingLogic: first.pickupBoxDiscount ? 'speed_second_box_discount' : 'none',
```

So the percentage is visible only as "this schedule has a second-box rule", and a new
schedule can never be given one. 108 of the 179 rationalised sets carry a value.

**Fix.** Put the field back on the collection leg, next to Additional Item Charging:
a percentage input, enabled when the charging logic is *Speed Second Box %*, disabled
otherwise. It is a two-line change in `LegConfigPanel.tsx` plus the leg config type —
do it with F7, same file, same leg.

---

## F15 — Pricing and zones

Not a fix — a scoping item, and you are right that it is the major separate piece.
The new view has no home for rates, additional-item rules or dimension rules;
`BookingSimulator.tsx:439` says as much out loud: *"Pricing will be available when the
rates module is connected."* Zone rates are still maintained in the old ClientManager
screens (`KEVIN-SCHEDULES-ZONES-ZONE-GROUPS-HANDOVER-2026-08-21.md`).

My recommendation on sequencing, since you asked where pallets fit: **do F9 first.**
Taking linehaul and its pricing out of the schedule removes the biggest reason
schedules multiply, and it settles where pallet pricing hangs — off the run and the
client's rating, not off the schedule. Trying to answer the pallets question while
linehaul pricing is still a schedule column means answering it twice.

I will write the pricing/zones brief separately once F9 is agreed.

---

## F16 — The list view

Three small things, all in `ScheduleTable.tsx`:

1. **The Depot filter is a dead control.** `:225`–`:232`: `selectedValues={[]}`,
   `onChange={() => {}}`, and `filteredRows` (`:100`–`:139`) never looks at a depot.
   It renders and does nothing. Wire it, and split it into **Origin depot** and
   **Destination depot** — the row already carries `originDepot` and `destDepot`.
2. **Sorting is partial.** Name, Origin, Dest, Speed, Mode and Status sort
   (`:248`–`:313`); Days, Roster and Clients do not. Days should sort by
   day-count then first day; Clients by attached count.
3. **Sorting scatters overrides.** The comparator at `:149` tries to keep an override
   next to its base by comparing `baseScheduleName` to the other row's name — which
   only fires when those two rows happen to be compared directly, so with a real sort
   the children end up anywhere. After F1 this problem disappears, because overrides
   are no longer rows. Until then, sort bases only and re-nest the overrides
   afterwards rather than sorting a flat list.

---

# 4. Database summary

Three scripts, all under the `@Commit = 0` harness used by `001`:

| Script | Contents | Blocks |
| :- | :- | :- |
| `002_group_tables_and_route_header_binding.sql` | Schedule group tables + `Routes.HeaderScheduleId` — unchanged from the 2026-09-18 brief §4 | E1, E2, E3 |
| `003_client_override_deltas.sql` | `tblBulkRunScheduleClientOverride` + fold clones and legacy variants into deltas | F1, F2, F3 |
| `004_display_names.sql` | `DisplayName` / `DisplayDescription` on the header | F13 |

No schema change is needed for F5–F8, F14 or F16 — they are mapper and view fixes.

---

# 5. Order of work

1. **F7 write path** — stop the zone rows being overwritten. One line, today, before
   anything else: it is live data loss.
2. **F8 MaxJobs** — same reason, same size.
3. **F5** — confirm the legacy state enum, add the mapping both ways. Half the estate
   is showing the wrong temperature state.
4. **F6** — run the disagreement query, then fix per the answer.
5. **F1 + F3 + F2 + F4** — the override model. One deployable slice; F2, F3 and F4
   fall out of F1 and should not be fixed separately first.
6. **F7 read path, F14, F16** — the small view fixes, one pass through
   `LegConfigPanel` and `ScheduleTable`.
7. **F9** — linehaul out of the schedule. Biggest structural win, and it unblocks F15.
8. **F13, F12, F10** — schedule shape.
9. **F11** — cut-off rewrite.
10. **F15** — pricing and zones, as its own brief.

E1/E2/E3 from the 2026-09-18 brief slot in after step 5 — they need the group tables,
and E1's Groups column is easier once overrides are out of the schedule rows.

---

# 6. What I need back

- The legacy `StorageState` / `DeliveryState` integer → label mapping, from
  ClientManager (F5).
- The result of the `BookPickup` disagreement query, and a ScheduleId from the
  collection-section screenshot (F6).
- The result of the row-0 disagreement query (F8).
- Which build the linehaul leg-name field is in — it is not in this branch (F9).
- Your read on the transfer source: a new pickup source, or a depot-to-depot leg
  rule (F10)?
- A date for steps 1–4. They are small and they are all data integrity.
