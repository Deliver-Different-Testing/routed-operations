---
title: Kevin — Schedules (NEW) fix list: client overrides, migration defects, schedule shape, job timing
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
E3 bound routes on the row) are unchanged and still queued behind the schedule-bundle
tables. Nothing in this document replaces them. This is the defect and direction list
from walking the deployed view.

## TL;DR

| # | Item | Kind |
| :- | :- | :- |
| **F1** | A client override creates a **full clone** of the schedule. It should be a scoped delta row keyed on ScheduleId. | Model — biggest item |
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
| **F17** | A recurring route breaks above ~3 linked schedules — and the binding is not modelled in any repo we hold | Investigation |
| **F19** | The parent job starts at the **delivery** leg's time. It must start at the booking, and the pickup at the next actually-available collection | Behaviour — half of it ships now |
| **F20** | `tblBulkJob` is staging for advance bulk work. A book-immediately schedule should not write a row there at all — and if "book immediately" is `AutoBook`, the new view's Active toggle is switching it | Architecture + a live hazard |
| **F18** | **Everything links on the schedule header id.** Not the day-row line, not the name. Schedule *groups* are renamed to *bundles* so the word stops meaning two things | Rule — read first |

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

### What it should be — one scoped override table, keyed on ScheduleId

Two decisions. The second is the answer to "surely we can do this smarter".

#### 1. Key it on ScheduleId

The override points at `dbo.tblBulkRunScheduleHeader.ScheduleId` — the identity
migration `001` created — and at nothing else:

- **not** the schedule *name*, which is what `ClientOverridesTab.tsx:26` and
  `types.ts:736` still do;
- **not** `tblBulkRunSchedule.BulkRunScheduleId`, the per-day row id — that is the
  same mistake as `Routes.ScheduleId` (2026-09-18 brief §4.2), and a day row is not a
  schedule;
- **not** `tblBulkRunSchedule.ClientId`, which `001` retired to
  `Header.LegacyClientId`.

This is the rule F18 states for the whole system, and F18 lists every other place
still holding a name or a line id.

`Schedule.baseScheduleId` then disappears from the model entirely. There is no base
and no child, because there is no second schedule — there is one schedule and a set
of per-client differences hanging off its ScheduleId.

#### 2. Scope the row

Your two examples are the reason a flat per-client row is not enough:

| You said | Where that value actually lives |
| :- | :- |
| "the pick up time is different" | the **collection leg** — `pickupTimeMode`, `pickupWindowStart/End` |
| "the delivery speed at destination is different" | the **delivery leg** — `SpeedId` |
| (and from your walkthrough) a 3-hour cut-off, Monday and Friday off | the **schedule** — `CutoffHours`, the day rows |

Three of those are leg facts and two are schedule facts. A single flat row per
client cannot say *which* leg it means without one column per (leg × field), which
is how you end up back at a clone. So the row carries a **scope**: either the
schedule, or one leg role.

One thing to know before reading the DDL: **there is no leg table.** Collection,
depot and delivery legs are derived on read from columns on the day rows
(`types.ts:612`, `:672`, `:688`) and given negative synthetic ids; only linehaul legs
are real rows in `TblBulkScheduleLinehaul`. So a leg-scoped override has nothing
durable to point at except the leg's **role** — which is fine, because the read
mapper can produce at most one collection, one depot and one delivery leg per
schedule. `LegOrdinal` is in the key anyway so that a second one later is not a
migration.

```sql
CREATE TABLE dbo.tblBulkRunScheduleOverride (
    -- surrogate only so the API can address a row; the CLUSTERED index below is
    -- the lookup key — see "Cost on the booking path".
    OverrideId  int IDENTITY(1,1) NOT NULL
        CONSTRAINT PK_tblBulkRunScheduleOverride PRIMARY KEY NONCLUSTERED,
    ScheduleId  int NOT NULL
        CONSTRAINT FK_tblBulkRunScheduleOverride_Header
        REFERENCES dbo.tblBulkRunScheduleHeader (ScheduleId),
    ClientId    int         NOT NULL,
    Scope       varchar(12) NOT NULL,   -- 'schedule' | 'collection' | 'depot' | 'delivery'
    LegOrdinal  tinyint     NOT NULL CONSTRAINT DF_..._LegOrdinal DEFAULT 0,
    DayOfWeek   tinyint     NOT NULL CONSTRAINT DF_..._DayOfWeek  DEFAULT 0,  -- 0 = every day

    -- ---- schedule scope: NULL = inherit -------------------------------
    CutoffHours        int           NULL,
    CutoffDay          tinyint       NULL,   -- absolute cut-off, when F11 lands
    CutoffTime         time(0)       NULL,
    WeekDays           char(7)       NULL,   -- '1111100' Mon..Sun
    IsActive           bit           NULL,
    DisplayName        nvarchar(200) NULL,   -- F13
    DisplayDescription nvarchar(500) NULL,

    -- ---- leg scope: NULL = inherit ------------------------------------
    SpeedId            int           NULL,   -- the speed of THAT leg
    ZoneGroupId        int           NULL,   -- that leg's zone / postcode group
    PickupTimeMode     varchar(10)   NULL,   -- 'window' | 'fixed' | 'on_demand'
    PickupWindowStart  time(0)       NULL,
    PickupWindowEnd    time(0)       NULL,
    AdditionalItemChargingLogic varchar(40) NULL,

    CreatedUtc datetime2(0)  NOT NULL CONSTRAINT DF_..._CreatedUtc DEFAULT SYSUTCDATETIME(),
    CreatedBy  nvarchar(100) NOT NULL,
    UpdatedUtc datetime2(0)  NULL,
    UpdatedBy  nvarchar(100) NULL,

    CONSTRAINT CK_tblBulkRunScheduleOverride_Scope
        CHECK (Scope IN ('schedule','collection','depot','delivery')),
    -- a schedule row carries no leg values and a leg row carries no schedule values
    CONSTRAINT CK_tblBulkRunScheduleOverride_ScopeFields CHECK (
        (Scope =  'schedule' AND SpeedId IS NULL AND ZoneGroupId IS NULL
                             AND PickupTimeMode IS NULL AND PickupWindowStart IS NULL
                             AND PickupWindowEnd IS NULL
                             AND AdditionalItemChargingLogic IS NULL)
     OR (Scope <> 'schedule' AND CutoffHours IS NULL AND CutoffDay IS NULL
                             AND CutoffTime IS NULL AND WeekDays IS NULL
                             AND IsActive IS NULL AND DisplayName IS NULL
                             AND DisplayDescription IS NULL)),
    -- never store a row that overrides nothing
    CONSTRAINT CK_tblBulkRunScheduleOverride_NotEmpty CHECK (
        CutoffHours IS NOT NULL OR CutoffDay IS NOT NULL OR CutoffTime IS NOT NULL
     OR WeekDays IS NOT NULL OR IsActive IS NOT NULL OR DisplayName IS NOT NULL
     OR DisplayDescription IS NOT NULL OR SpeedId IS NOT NULL OR ZoneGroupId IS NOT NULL
     OR PickupTimeMode IS NOT NULL OR PickupWindowStart IS NOT NULL
     OR PickupWindowEnd IS NOT NULL OR AdditionalItemChargingLogic IS NOT NULL)
);

-- the lookup key: every row a client has on one schedule is physically adjacent
CREATE UNIQUE CLUSTERED INDEX CX_tblBulkRunScheduleOverride
    ON dbo.tblBulkRunScheduleOverride (ScheduleId, ClientId, Scope, LegOrdinal, DayOfWeek);

-- "which schedules does this client differ on?"
CREATE INDEX IX_tblBulkRunScheduleOverride_Client
    ON dbo.tblBulkRunScheduleOverride (ClientId) INCLUDE (ScheduleId, Scope);
```

DDL as written is in `scripts/schedule-rationalisation/sql/003_client_override_deltas.sql`,
with the same `@Commit = 0` rollback harness as `001`.

#### Your three cases, as rows

Base schedule #1947, *AKL > HLZ Afternoon*, Mon–Fri, 2-hour cut-off, delivery speed
110, collection window 14:00–15:00.

```sql
-- UCLMP: 3-hour cut-off, and Monday and Friday off
(1947, UCLMP, 'schedule', 0, 0, CutoffHours = 3, WeekDays = '0111000')

-- A client whose pickup happens in the morning
(1947, ACME,  'collection', 0, 0, PickupWindowStart = '09:00', PickupWindowEnd = '11:00')

-- A client who pays for Pre 10am into the destination
(1947, MEDCO, 'delivery',   0, 0, SpeedId = 164)
```

Three clients, three rows, **one schedule**. No new ScheduleId, no copied day rows,
no copied legs, no copied zones. Ops can read the whole difference in one line, and
"which clients are on a non-standard delivery speed?" is
`WHERE Scope = 'delivery' AND SpeedId IS NOT NULL` instead of a diff across 2,725
schedules.

#### Resolving it

The readable form is one left join per scope, then `COALESCE` — but read "Cost on the
booking path" below before you implement it, because the shipped resolver pivots in a
single seek instead:

```sql
SELECT COALESCE(so.CutoffHours, s.CutoffHours)          AS CutoffHours,
       COALESCE(dl.SpeedId,     s.SpeedId)              AS DeliverySpeedId,
       COALESCE(dl.ZoneGroupId, s.PostcodeGroupId)      AS DeliveryZoneGroupId,
       COALESCE(cl.SpeedId,     s.PickupRatingSpeed)    AS PickupSpeedId,
       COALESCE(cl.PickupWindowStart, s.StartTime)      AS PickupWindowStart,
       COALESCE(cl.PickupWindowEnd,   s.EndTime)        AS PickupWindowEnd
  FROM dbo.tblBulkRunSchedule s
  LEFT JOIN dbo.tblBulkRunScheduleOverride so
         ON so.ScheduleId = s.ScheduleId AND so.ClientId = @ClientId
        AND so.Scope = 'schedule'  AND so.DayOfWeek IN (0, s.DayOfWeek)
  LEFT JOIN dbo.tblBulkRunScheduleOverride cl
         ON cl.ScheduleId = s.ScheduleId AND cl.ClientId = @ClientId
        AND cl.Scope = 'collection' AND cl.LegOrdinal = 0
        AND cl.DayOfWeek IN (0, s.DayOfWeek)
  LEFT JOIN dbo.tblBulkRunScheduleOverride dl
         ON dl.ScheduleId = s.ScheduleId AND dl.ClientId = @ClientId
        AND dl.Scope = 'delivery'   AND dl.LegOrdinal = 0
        AND dl.DayOfWeek IN (0, s.DayOfWeek)
 WHERE s.ScheduleId = @ScheduleId;
```

Days-off resolve one level up: a schedule-scope `WeekDays` filters which day rows the
client sees at all. Put that in one view or one function —
`dbo.fnScheduleForClient(@ScheduleId, @ClientId)` — and have every caller use it. The
moment two call sites resolve overrides with their own SQL, they will disagree, which
is how the list and the modal disagree today.

#### Cost on the booking path

This sits in the middle of pricing and dispatch, so the resolve has to be a seek and
nothing else. Five things make it one.

**1. Cluster on the lookup key, not on the surrogate.**

```sql
CONSTRAINT PK_tblBulkRunScheduleOverride PRIMARY KEY NONCLUSTERED (OverrideId),
...
CREATE UNIQUE CLUSTERED INDEX CX_tblBulkRunScheduleOverride
    ON dbo.tblBulkRunScheduleOverride (ScheduleId, ClientId, Scope, LegOrdinal, DayOfWeek);
```

Every row a client has on one schedule is then physically adjacent: **one seek, one
page, one to three rows.** Clustering on `OverrideId` instead would scatter them and
turn the resolve into three separate reads for no benefit — the surrogate exists only
so the API can address a row.

**2. One seek, not one join per scope.**

The three-left-join form earlier in this section reads the same index three times.
Pivot instead:

```sql
SELECT MAX(CASE WHEN o.Scope = 'schedule'   THEN o.CutoffHours       END) AS CutoffHours,
       MAX(CASE WHEN o.Scope = 'schedule'   THEN o.WeekDays          END) AS WeekDays,
       MAX(CASE WHEN o.Scope = 'delivery'   THEN o.SpeedId           END) AS DeliverySpeedId,
       MAX(CASE WHEN o.Scope = 'delivery'   THEN o.ZoneGroupId       END) AS DeliveryZoneGroupId,
       MAX(CASE WHEN o.Scope = 'collection' THEN o.SpeedId           END) AS PickupSpeedId,
       MAX(CASE WHEN o.Scope = 'collection' THEN o.PickupWindowStart END) AS PickupWindowStart,
       MAX(CASE WHEN o.Scope = 'collection' THEN o.PickupWindowEnd   END) AS PickupWindowEnd
  FROM dbo.tblBulkRunScheduleOverride o
 WHERE o.ScheduleId = @ScheduleId AND o.ClientId = @ClientId AND o.DayOfWeek = 0;
```

One range seek over adjacent rows, one pass, every scope resolved together.

While per-day overrides are unused, keep the predicate `DayOfWeek = 0` — a pure
equality seek. It becomes `IN (0, s.DayOfWeek)` only when per-day actually lands.

**3. An inline table-valued function. Never a scalar UDF, never multi-statement.**

`fnScheduleForClient` must be `RETURNS TABLE AS RETURN <one SELECT>` so SQL Server
expands it into the caller's plan. A scalar UDF or a multi-statement TVF executes
per row and disables parallelism in the calling query — same logic, an order of
magnitude worse, and it is the easiest way to turn this into exactly the load you are
worried about. (SQL Server 2019+ can inline some scalar UDFs; do not rely on it.)

**4. Skip the table entirely for schedules that have no overrides — which is most of them.**

```sql
ALTER TABLE dbo.tblBulkRunScheduleHeader
  ADD OverrideCount int NOT NULL CONSTRAINT DF_..._OverrideCount DEFAULT 0;
```

Maintained in the same transaction as the override write. The booking path already
has the header row in hand; when `OverrideCount = 0` it never touches the override
table. `003` ships a reconcile query so a drifted counter is detectable rather than
silent.

**5. Cache on a version, invalidate on write.**

Overrides change when ops edits them, not per booking. Add `OverridesVersion
rowversion` to the header and cache resolved values keyed
`(ScheduleId, ClientId, OverridesVersion)`. The booking path then usually does no
database work at all for the override layer.

**Expected size.** One row per (schedule, client, scope that differs) — hundreds,
low thousands at the very outside. Worth being explicit about the direction of
travel: today an override is a header **plus five day rows plus zone rows plus
linehaul rows**. The delta model *removes* rows from the database. It is smaller and
cheaper than what it replaces, not an extra layer on top.

**Watch it.** If any single schedule passes ~20 override rows, or the table passes
~10k, something has gone wrong — either the chain-shape rule is being ignored or ops
is expressing a second schedule as deltas. A weekly count catches it:

```sql
SELECT TOP 20 ScheduleId, COUNT(*) AS Rows_
  FROM dbo.tblBulkRunScheduleOverride
 GROUP BY ScheduleId ORDER BY COUNT(*) DESC;
```

**What not to do**

- **Do not materialise a resolved row per (schedule × client).** That is the clone
  problem again wearing a cache table, and it has to be maintained on every schedule
  edit.
- **Do not resolve per row in the list view.** One batch call for the page, the way
  E3 does for dispatch. 2,700 resolves is the N+1 that E3 exists to avoid.
- **Do not resolve in the app layer** by loading every override and joining in C#.
  The join belongs where the data is; the app gets a resolved row.

#### Deliberately not in phase 1

- **Linehaul overrides.** No `'linehaul'` scope. Per-client linehaul differences are
  F9's job — they belong on the client's rating against the run, not on the schedule.
  Adding the scope here would re-import the exact problem F9 removes. If a client
  needs a different linehaul *speed*, that is an argument for F9 landing sooner, not
  for a fourth scope.
- **Per-day overrides.** `DayOfWeek` is in the table and in the unique key, always
  written as `0` for now. The hook costs nothing today and means "ACME's Monday
  pickup is 07:00, the rest of the week is 09:00" needs no migration when ops asks
  for it.
- **Clearing a value the base sets.** NULL means inherit, so an override cannot say
  "this client has *no* delivery zone group when the schedule has one". Nothing in the
  estate needs it today and `003` reports any case it finds rather than guessing. If
  it turns out to be real, the answer is a sentinel per column, not a second meaning
  for NULL — tell me before anyone invents one.
- **The chain shape.** See below — this is the rule that keeps the table from
  becoming a schedule again.

#### What is never overridable

Which legs exist, in what order, the origin and destination depots, the region, and
the linehaul runs. `types.ts:975` (`NON_OVERRIDABLE_FIELDS`) already says as much and
it should now be enforced by the API, not just the UI: a `PUT` that tries to set a
field outside the scoped column list is a `400`.

If what differs between two clients *is* the chain shape, it is not an override — it
is a different schedule, and the UI should offer **Copy schedule**, not **Create
override**. That single rule is the difference between this table staying small and
it turning into the clone problem wearing a new hat.

#### Why not the other two shapes

| Shape | Why not |
| :- | :- |
| **JSON patch column** — one row per client holding `{"cutoffHours":3}` | No foreign keys, so a `SpeedId` can point at a deleted speed and nothing complains. No index, so "who overrides speed 164?" is a table scan with `OPENJSON`. And a patch can carry a key that no longer exists, which is how the current `overriddenFields` drifted (F3). |
| **EAV** — `(ScheduleId, ClientId, FieldKey, Value nvarchar)` | Everything typed as a string, every read a pivot, every write unvalidated. The overridable set is small and closed — there is no flexibility to buy here, only integrity to lose. |

Typed columns win because the set of things ops is allowed to vary per client is a
decision, not an open question. When the set changes, that should be a migration
someone signs off, not a new string appearing in a JSON blob.

### API

Replace `POST /api/v2/schedules/{id}/overrides` (`api/v2.ts:91`, returns a whole
`ScheduleDto`) with a delta-shaped resource. `{id}` is the **ScheduleId**
throughout — the same id as everywhere else in the v2 API.

| Method | Route | Body / notes |
| :- | :- | :- |
| GET | `/api/v2/schedules/{id}/overrides` | `[{ clientId, clientCode, clientName, scopes: { schedule?: {...}, collection?: {...}, delivery?: {...} }, updatedUtc, updatedBy }]` — only the keys actually set |
| PUT | `/api/v2/schedules/{id}/overrides/{clientId}` | Full replace of that client's delta, all scopes in one body. A key set to `null` clears that one field; an empty scope object deletes that scope's row; an empty body deletes the client's override entirely. `400` on any key outside the scoped column list, or on a leg scope the schedule does not have. |
| DELETE | `/api/v2/schedules/{id}/overrides/{clientId}` | The client returns to the base schedule in full |
| GET | `/api/v2/clients/{clientId}/overrides` | Every schedule this client differs on — the view ops actually wants, and impossible today without opening 2,725 schedules |

`ScheduleDto.overriddenFields` stays "computed server-side" as `api/v2.ts:39`
already promises. It becomes `scope.field` keys read off the delta row — the same
source the editor diffs against, so it cannot drift (F3).

The client's link row **stays on the base schedule**. An override no longer moves it,
so `upsertOverride` and `attachBlocker` in `utils/clientLinks.ts` lose their
move-the-link behaviour, and `effectiveSchedulesForClient` stops excluding overridden
bases — there is no second schedule to prefer any more.

**A default schedule is overridable**, and the client stays on the default. That
falls out for free once the override is a delta rather than a schedule, and it is
what F4 was tripping over.

### Migration

Two populations, both folded into the new table by
`scripts/schedule-rationalisation/sql/003_client_override_deltas.sql`:

1. **Clones created through the new view** (`BaseScheduleId IS NOT NULL`, or a header
   whose name matches another's with a `LegacyClientId`). Diff each against its base
   over the scoped column list; write one row per scope that differs; retire the
   clone header. A clone that differs **outside** the scoped list — a different leg
   chain, depot or region — is not an override: leave it alone and list it in the
   script's report. Those are genuinely different schedules and a human decides.
2. **Legacy client-specific schedules.** `types.ts:735` reads `isOverride:
   first.clientId != null`, so every legacy ClientId-bearing schedule presents as an
   override with no base. `scripts/schedule-rationalisation/output/variants.csv`
   already groups them and names what each differs on in `DiffersFromGroup1On`. Fold
   only the sets whose differences are inside the scoped list; everything else stays
   a schedule.

The script reports, before it commits: rows folded, clones retired, and the ones it
refused to touch with the reason. Run it with `@Commit = 0` first and send me that
report.

### Acceptance

- Creating an override writes **one row per scope touched** and **no new
  ScheduleId**. The schedule count is unchanged after a day of ops creating
  overrides.
- The client stays attached to the base; the base's client list does not shrink.
- UCLMP with a 3-hour cut-off and Mon/Fri off is one `schedule`-scope row, and the
  base schedule's day rows are untouched.
- A client with a different pickup window is one `collection`-scope row; a client
  with a different destination speed is one `delivery`-scope row. Neither writes
  anything to the other's scope.
- Changing only the speed produces a delta whose only non-null value column is
  `SpeedId`, and the UI says it differs on delivery speed and nothing else.
- Clearing one field returns that client to the base value and leaves the rest of
  the delta alone. Deleting the delta leaves the client on the base, unchanged.
- An override on a **default** schedule works, and the client still resolves to that
  default.
- Two clients with different pickup times on the same schedule both book correctly
  through `fnScheduleForClient`, and the schedule itself has one row set in
  `tblBulkRunSchedule`.

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

**Read F20 before fixing that third one.** If `AutoBook` is the book-immediately
flag, this is not a conflation to tidy up — it means ops can switch a schedule
between booking immediately and staging into bulk by clicking a toggle labelled
Active. Until that is confirmed, treat the Active toggle in the new view as
unsafe.

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
override diff twice — and build F19b in the same pass, because it is the same
inversion applied to the job records rather than the UI.

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

## F17 — A recurring route stops working above three linked schedules

Reported: link more than about three schedules to a recurring route and the route
becomes non-functional.

### What is actually in source — and what is not

I went looking for the route ↔ schedule binding in every repo we hold:

| Repo | What its route model carries |
| :- | :- |
| `routed-operations` | `v2/backend/Entities/TblRecurringRoute.cs` — name, frequency, window, avg jobs, service level, colour, zips. **No schedule column at all.** |
| `dfrntdrive-configurator` | `Core/Domain/Despatch/Route.cs` — `RouteId`, `Name`, `Area`, `DefaultCourierId`, `Active`, audit columns, plus zip polygons, roster and jobs. **No `ScheduleId` column.** `TenantRouteService.cs` and `wwwroot/app/react/services/tenant_routeService.ts` never mention a schedule. |
| `dfrntdrive_configurator` | App-config only; no schedules, no routes. |

The link is made on the **booking**, not on the route: `tucJobBooking` carries both
`RouteId` and `ScheduleID`, and the thing that reads them nightly is
**`uspPrebookSet`** — named at `TenantRouteService.cs:17` ("is read downstream by
uspPrebookSet (each night, to materialise tucJob…)") and again in the UI at
`RecurringRoutes.tsx:414`. **That stored procedure is not in any repository.**

So the first finding is structural, and it is the real answer to "why is this
cumbersome":

> "The schedules linked to a recurring route" is not a modelled relationship
> anywhere in source. It is emergent — bookings stamped with one `RouteId` happen to
> carry several different `ScheduleID`s — and the logic that consumes it lives in a
> stored procedure that nobody has in version control.

That is why no one can say what the limit is or why it exists. It also means the
behaviour cannot be changed safely today: there is no diff, no review, and no way to
tell whether an edit to that proc breaks dispatch until the next morning.

One thing to settle alongside it: the 2026-09-08 brief §2b and the 2026-09-18 brief
§4.2 both describe the binding as `Routes.ScheduleId`, M:1. The `Routes` entity in
the configurator has no such column. Either the column exists in the tenant database
and the EF model is stale, or the binding those briefs describe is somewhere else
again. That is the same question §4.2 already asks — it now matters twice, so answer
it first.

### Step 1 — put the proc in version control

```sql
SELECT OBJECT_DEFINITION(OBJECT_ID('dbo.uspPrebookSet')) AS Definition;
```

Commit it to `database/` beside the numbered migrations. Nothing below can be
answered without reading it, and a nightly job that materialises production dispatch
should not exist only inside the server.

### Step 2 — get the numbers

```sql
-- how many distinct schedules feed each route
SELECT  b.RouteId,
        COUNT(DISTINCT b.ScheduleID) AS Schedules,
        COUNT(*)                     AS Bookings
  FROM  dbo.tucJobBooking b
 WHERE  b.RouteId IS NOT NULL
 GROUP BY b.RouteId
 ORDER BY Schedules DESC;
```

Line that up against the routes ops says are broken. **If every broken route has 4+
and every working route has ≤3, it is a hard limit — hypothesis 1 or 3. If some
5-schedule routes work fine, it is 2 or 4.** That single comparison decides where to
look, and it costs one query.

### Step 3 — the four candidates, ranked

| # | Cause | What it looks like, and how to tell |
| :- | :- | :- |
| **1** | **A delimited id list, truncated.** This codebase passes id lists as delimited strings — `UTL_stpJob_tblBulkJobWithFilter(@clientIDs, @regions, @ourRefs, @speeds)` at `Models/IDespatchContextProcedures.cs:23` is exactly that shape. SQL Server truncates a string **silently** when it is assigned to a too-short `varchar(n)`: `'1947,1948,1949'` fits a `varchar(16)`, the fourth id does not. | Look for a `varchar`/`nvarchar` parameter or local holding a list of schedule ids with a declared length. Fix: `varchar(max)`, or better a table-valued parameter / `STRING_SPLIT`. Gives a hard cut at the same count every time, which fits "above 3" exactly. |
| **2** | **Fan-out.** Each extra schedule multiplies candidate rows before filtering — an unkeyed join, or a `CROSS APPLY` per schedule. At four the nightly job exceeds its window. | Runtime grows faster than linearly with schedule count; the route fails intermittently rather than always. `SET STATISTICS IO, TIME ON` and run the proc against a 3-schedule and a 4-schedule route. |
| **3** | **A literal 3.** `TOP 3`, a three-way `UNION`, or `Schedule1/2/3`-shaped columns. | Grep the proc. Crude, and it happens. |
| **4** | **Empty window intersection.** If the effective window is the tightest across the bound schedules — the N:M rule the 2026-08-03 spec proposes and 2026-09-08 §2b records — then every schedule added can only narrow it. By the fourth the intersection is often empty, so the route produces nothing. It is not broken; it is correctly producing no jobs from an impossible window. | The schedules on a failing route have non-overlapping windows or disjoint day masks. **This is the one where "3" is correlation, not a limit** — check the windows on a broken route before assuming a bug. |

### Why this connects to F1 and F9

Hypothesis 4 deserves the extra attention because it points at the same root cause as
the rest of this brief. Ask why one route ended up with five schedules in the first
place. If the answer is "because those clients needed a different cut-off, a
different pickup time and a different destination speed", then **F1 removes most of
them** — they collapse into one schedule with delta rows, and the route binds to one
schedule again. F9 removes the ones that exist only because linehaul pricing
differed.

So: **land F1 and F9, then re-run the count in step 2.** There is a real chance this
problem shrinks to a handful of routes on its own, and what is left is then worth
engineering properly rather than working around now. That said, step 1 — getting
`uspPrebookSet` into the repo — is worth doing this week regardless of anything else
on this list.

### Acceptance

- `uspPrebookSet` is in `database/`, reviewed, and changes to it go through a merge
  request like everything else.
- The schedules-per-route count exists and is repeatable.
- The cause is named from the proc, not inferred — and if it is hypothesis 4, the
  route is documented as behaving correctly and the fix is at the schedule layer.
- A route with eight linked schedules materialises the same jobs as eight routes with
  one each.

---

## F18 — One key everywhere: the schedule header id. Never the line, never the name

This is a rule, not a defect, and it cuts across F1, F17 and the 2026-09-18 brief's
§4.2. Steve's instruction: **linking is on the schedule id that identifies the whole
schedule — not the individual schedule line — and nothing anywhere links on the
schedule name.**

### First, the word "group" means two different things

They are unrelated, and wiring the wrong one would be a quiet disaster, so fix the
vocabulary before writing any code:

| Thing | Key | What it is |
| :- | :- | :- |
| **Schedule line** (day row) | `tblBulkRunSchedule.BulkRunScheduleId` | One row per operating day. Five rows for a Mon–Fri schedule. **Never a link target.** |
| **Schedule** — the group of those lines | `tblBulkRunScheduleHeader.ScheduleId` | The schedule as ops means it. Created by migration `001`. **This is the only thing anything links to.** |
| **Schedule bundle** (E1, E2) | `tblBulkRunScheduleBundle.BundleId` | A convenience collection of *several schedules* for bulk edit and attach-clients. Not an identity. Nothing resolves through it at booking time. Called a "group" until 2026-09-20 — renamed, see below. |

When this brief and the 2026-09-18 brief say "the schedule group id", they mean the
middle row — `Header.ScheduleId`. The bottom row is a different feature that happens
to share the English word.

**Decided 2026-09-20 (Steve): they are bundles.** The tables do not exist yet, so the
rename is free today and costs a migration plus a UI pass once they hold data. This
supersedes the DDL in the 2026-09-18 brief §4.1 — build `002` from
`scripts/schedule-rationalisation/sql/002_bundle_tables_and_route_header_binding.sql`,
not from that section. The rename surface is small and entirely ahead of us:

| Layer | Was | Is |
| :- | :- | :- |
| Tables | `tblBulkRunScheduleGroup`, `tblBulkRunScheduleGroupMember` | `tblBulkRunScheduleBundle`, `tblBulkRunScheduleBundleMember` |
| Key | `GroupId` | `BundleId` |
| Index | `IX_…GroupMember_ScheduleId` | `IX_…BundleMember_ScheduleId` |
| API | `/api/v2/schedule-groups`, `?groupId=`, `ScheduleGroupDto` | `/api/v2/schedule-bundles`, `?bundleId=`, `ScheduleBundleDto` |
| Types | `ScheduleGroup` (`types.ts:758`) | `ScheduleBundle` |
| Components | `ScheduleGroupsTab.tsx`, `CopyGroupModal.tsx`, `AddSchedulesToGroupModal.tsx` (E2, unbuilt) | `ScheduleBundlesTab.tsx`, `CopyBundleModal.tsx`, `AddSchedulesToBundleModal.tsx` |
| Helpers | `attachClientsToGroup` (`clientLinks.ts`), `expandedGroupId` | `attachClientsToBundle`, `expandedBundleId` |
| UI copy | "Schedule Groups", "Attach clients to group" | "Schedule Bundles", "Attach clients to bundle" |

Nine files in the module plus the two tables. Do it in one pass before E1/E2 start,
not alongside them.

The rule that outlives the rename: **the API never exposes a field called
`scheduleGroupId`.** The header is `scheduleId`, the bundle is `bundleId`, and
nothing that resolves at booking time ever takes a `bundleId` at all.

### Every place a schedule is referenced

| Holder | Column | Today | Must be |
| :- | :- | :- | :- |
| Day rows | `tblBulkRunSchedule.ScheduleId` | FK to header, added by `001` | ✔ done |
| Client links | `tblBulkRunScheduleClient.ScheduleId` + `ScheduleName` | `001` adds the id beside the name and back-fills where unambiguous | drop `ScheduleName` — `001` already leaves the `ALTER` commented and ready |
| Client overrides | `tblBulkRunScheduleOverride.ScheduleId` | new in `003` | header id, FK enforced — already correct |
| Bundle members | `tblBulkRunScheduleBundleMember.ScheduleId` | not built | header id, FK enforced — a bundle holds schedules, and holds nothing else |
| Recurring routes | `Routes.ScheduleId` | points at a **day-row** id (2026-09-08 §2b) — or does not exist at all; the configurator's `Route` entity has no such column (F17) | header id, via `HeaderScheduleId` per the 2026-09-18 brief §4.2 |
| Linehaul legs | `TblBulkScheduleLinehaul.BulkRunScheduleId` | points at a **day row** — `types.ts:636` reads only the legs attached to row 0 | header id |
| Bookings | `tucJobBooking.ScheduleId` **and** `tucJobBooking.ScheduleName` | both exist (`TucJobBooking.cs:289` and `:293`); which one dispatch trusts is unconfirmed | header id; the name becomes display-only, then goes |
| Jobs | `tucJob.ScheduleId` **and** `tucJob.ScheduleName` | both exist (`TucJob.cs:368`, `:488`) | same |
| Nightly materialiser | `uspPrebookSet` | not in version control (F17) | audit once it is in the repo |
| Front end: override → base | `isOverrideOf` (`types.ts:1079`) | id first, **falls back to `baseScheduleName === base.name`** | id only; delete the fallback |
| Front end: base lookup | `baseOf` (`clientLinks.ts:30`) | same name fallback | id only |
| Front end: row grouping | `groupRowsByName` (`types.ts:744`) | groups production rows **by Name** | group by `ScheduleId` |
| Front end: override tab | `ClientOverridesTab.tsx:26` | matches overrides by `baseScheduleName` | dead once F1 lands — the tab edits deltas |

The one legitimate use of the name is `001` itself, which bootstraps identity from
`(Name, ClientId)` because that is all the old model had. After `001`, the name is a
label: it is what ops reads, it is never what the system joins on.

### Why this is not just tidiness

Two of the worst symptoms in this brief are name-matching in disguise:

- `types.ts:736` sets `baseScheduleName` to the schedule's own name for **every**
  legacy client-specific schedule. Two schedules with the same name and different
  clients therefore look like overrides of each other. That is F3's phantom chips and
  part of F2.
- The linehaul row binds to a day row, so a Mon–Fri schedule's linehaul leg hangs off
  Monday. Read row 0 and it appears; read any other day and it does not. That is the
  same class of bug as `Routes.ScheduleId`, and it is why F8's flattening matters
  beyond tidiness.

And the performance argument from F1 only holds on an id: the single-seek resolve is
a seek because the clustered key starts with an `int ScheduleId`. A name-based or
line-based join cannot be made cheap — an `nvarchar(200)` key is wider, collates, and
cannot be trusted to be unique in the first place.

### Verification

The rule is testable. These should all return zero rows once the work is done:

```sql
-- 1. Every client link row resolves to a live header (and no name column is left).
SELECT COUNT(*) FROM dbo.tblBulkRunScheduleClient l
  LEFT JOIN dbo.tblBulkRunScheduleHeader h ON h.ScheduleId = l.ScheduleId
 WHERE h.ScheduleId IS NULL;
SELECT COL_LENGTH('dbo.tblBulkRunScheduleClient', 'ScheduleName');  -- must be NULL

-- 2. No route binds to a day row.
SELECT COUNT(*) FROM dbo.Routes r
 WHERE r.HeaderScheduleId IS NULL AND r.ScheduleId IS NOT NULL;

-- 3. No booking carries a ScheduleId that is not a header id.
SELECT COUNT(*) FROM dbo.tucJobBooking b
  LEFT JOIN dbo.tblBulkRunScheduleHeader h ON h.ScheduleId = b.ScheduleId
 WHERE b.ScheduleId IS NOT NULL AND h.ScheduleId IS NULL;

-- 4. Names are not unique, which is the whole point — this will NOT be zero,
--    and every one of these is a pair the old model could not tell apart.
SELECT Name, COUNT(*) AS Headers
  FROM dbo.tblBulkRunScheduleHeader WHERE RetiredUtc IS NULL
 GROUP BY Name HAVING COUNT(*) > 1 ORDER BY COUNT(*) DESC;
```

Query 4 is the one to run first and send back. It is the size of the problem
name-matching has been hiding, and it sets how careful the `Routes` and `tucJobBooking`
back-fills have to be.

### Acceptance

- `grep -rn "ScheduleName\|baseScheduleName" v2/frontend/src/schedules` returns only
  display strings — no comparisons, no lookups, no `find`.
- `isOverrideOf`, `baseOf` and `groupRowsByName` take ids only. Deleting the name
  fallback does not change any rendered list.
- Queries 1–3 above return zero.
- A schedule renamed in ops breaks nothing: every link survives the rename, because
  nothing joined on the name.

---

## F19 — The parent starts at the booking; the pickup starts at the next available collection

Reported: the parent job is created with the same start time as the delivery leg. It
should start at the **booking time**, and the collection leg should start at the
**first pickup actually available** from that booking — this afternoon if the booking
makes today's run, otherwise tomorrow's, or Monday's.

### What the model does today

The delivery window is the anchor and everything else is produced by subtracting from
it. Two places show it plainly:

- `TimelinePreview.tsx:80` builds the delivery event first, then walks the leg chain
  **backwards** (`const reversedLegs = [...schedule.legs].sort((a, b) => b.order - a.order)`),
  and finally places the cut-off at `firstEvent.absoluteMinutes - cutoffMinutes`.
- `BookingSimulator.tsx` check 5 computes
  `deliveryStartTime` = the **booking day** at the operating day's `startTime`, then
  `cutoffTime = deliveryStartTime - cutoffOffset`, and passes only when
  `bookingDateTime <= cutoffTime`.

Two consequences fall straight out of that second one. It assumes delivery happens on
the day of the booking — there is no roll-forward anywhere. And a booking that misses
the cut-off is a **failure**, not a later collection: the simulator marks it failed and
stops. That is the behaviour to invert.

The collection leg has no real time to start from either: `types.ts:629` fabricates
`pickupTimeMode: 'window'`, `'14:00'`–`'15:00'` for every collection leg it builds
(F6).

This is F11's complaint expressed in job records instead of UI copy, which is why the
two should be built together — but see the split at the end, because half of this is
shippable on its own.

### What it must be

1. **Parent start = the booking time.** Not the delivery window, not the collection.
2. **Collection leg start = the first collection opportunity at or after the booking.**
3. **Delivery becomes a consequence** — collection plus the chain: linehaul departure
   and day offsets, transit, then the delivery window on the arrival day.
4. **The cut-off stops being an offset** and becomes the thing that decides *which*
   collection you catch. It is then a promise to the customer ("book by 15:00 and it
   goes today") rather than a validation error.

### The rule

Resolve the schedule through `fnScheduleForClient` first — never the raw columns, or
a client whose override moves the cut-off or drops a day gets the wrong answer
(F1, F18).

```
A = the anchor: the earliest the freight can be collected
  = MAX(booking timestamp, requested ready time if the customer gave one)
S = the client's resolved schedule

for D in [day of A .. day of A + 14]:
    if D is not an operating day of S:            continue
    if D is a non-working day (holiday calendar): continue
    C = the collection time on D:
          'fixed'     -> the fixed start time
          'window'    -> the window start
          'on_demand' -> MAX(A + lead time, window start if one is set)
    if D is A's day and A > the cut-off for D:    continue   # missed today's run
    if C < A:                                     continue   # today's run has gone
    return (D, C)

no D in 14 days -> the booking cannot be served. Fail loudly and say why.
```

Then: parent start = A's booking timestamp; collection leg start = `C` on `D` (a
window keeps its end as well); every later leg offsets forward from `C`.

All comparisons in **tenant local time**. `tucJobBooking` carries both `CreatedTime`
and `CreatedTimeUtc`, so whichever is chosen, choose it once and write it down.

### Decisions baked into that, so they are arguable rather than accidental

| Decision | Chosen | Why |
| :- | :- | :- |
| Cut-off boundary | **inclusive** — "book by 15:00" passes at 15:00:00 | It is what the words say to a customer. |
| Anchor when the customer names a ready time | `MAX(booking, requested ready)` | Freight that is not ready cannot be collected, and a booking cannot reach backwards. |
| On-demand collections | need a **lead time in minutes** on the collection leg | The field does not exist today; add it with F11's three modes. Without it "on demand" has no computable start. |
| Search horizon | **14 days**, then fail | A mis-configured schedule must not silently produce a job three months out. |
| Non-operating days | honoured, **including a client's `WeekDays` override** | Otherwise F1's day override is cosmetic. |

Both of the questions this section originally left open are answered (Steve,
2026-09-20):

- **The parent's start time is `tblBulkJob.BookDate` + `BookTime`.** Both are non-null
  today. F19a is therefore unblocked — it is these two columns that must carry the
  booking time rather than the delivery leg's.
- **A holidays table exists.** Neither scaffolded EF context in the repos I can read
  includes it, so it is either reached outside EF or the model is stale — Kevin, name
  the table and the rule above uses it directly. Note that
  `tucJobBooking.HolidayDeliveryOption` (`DespatchContext.cs:3755`, *0 = Don't Book,
  1 = Deliver Next Day*) is the per-booking **policy** that sits on top of the
  calendar. So the full rule is: skip non-working days per the calendar, then apply
  `HolidayDeliveryOption` to decide what happens to a booking that lands on one.

See F20 for where these two jobs are written, and why a book-immediately schedule
should not be writing a `tblBulkJob` row at all.

### Acceptance

- Book at 09:00 on an operating day, before cut-off → parent starts **09:00**,
  collection at today's collection time, delivery derived forward from it.
- Book at 16:00 against a 15:00 cut-off → parent still starts **16:00**, collection is
  tomorrow's. **Nothing fails.**
- Book Friday 16:00 on a Mon–Fri schedule → collection Monday.
- Two bookings ten minutes apart straddling the cut-off land on different collection
  days, and both produce a job.
- A client whose override moves the cut-off to 13:00 rolls forward earlier — with no
  second schedule anywhere.
- The parent's start equals the delivery leg's start only when the booking genuinely
  happened then.

```sql
-- After the change: nothing may be collected before it was booked.
-- Confirm first how BookDate and BookTime combine in this tenant — they are two
-- datetime columns, and only one of them is meant to carry the time.
SELECT TOP 50 BulkJobId, BookDate, BookTime, PickupReadyDateTime
  FROM dbo.tblBulkJob
 WHERE PickupReadyDateTime IS NOT NULL
   AND PickupReadyDateTime < BookTime;
```

### Ship it in two halves

**F19a — parent start = booking time**, written to `tblBulkJob.BookDate` /
`BookTime`. Independent of everything else here: it does not need the collection
modes, the cut-off rewrite or F1, and the column question is now answered. Do it
early — it is the half you asked for, and it pairs with F20.

**F19b — next available collection.** Needs F11's collection modes (fixed / window /
on demand) and the on-demand lead time to exist, and resolves through F1 so client
overrides count. Build it with F11, not before.

---

## F20 — `tblBulkJob` is staging for advance bulk work, not the road every job takes

The rule, from Steve on 2026-09-20:

1. `tblBulkJob.BookDate` + `BookTime` **are the job's start time** (F19a).
2. The **parent and the delivery move straight from `tblBulk` to `tucJob`.**
3. If the schedule has **book immediately** ticked, **nothing goes into `tblBulkJob`
   at all.**
4. `tblBulkJob` is a **staging and run-building area for bulk deliveries booked in
   advance.** That is its whole job.

### Why the current path cannot honour that

A staged bulk job becomes a `tucJob` **only through run building.** In this repo
there is exactly one route:

- `JobRepository.InsertJobAsync` (`Models/Repository/JobRepository.cs:130`) calls
  `UTL_stpJob_InsertFromRunBuilder(@BulkJobID, @CourierID, @RunName, @RunOrder, …)`;
- its only caller is the `foreach (var job in run.Jobs)` loop at `:122`, inside run
  dispatch.

So a job that has to exist before anyone builds a run waits for a run that may never
be built, and a book-immediately job staged into `tblBulkJob` is stuck there **by
design, not by accident**. Both halves of the instruction follow from that.

### The routing decision, made once at booking

```
resolve the schedule for this client (fnScheduleForClient — F1, F18)

if the schedule books immediately:
    create the tucJob parent and its legs now.
    NO tblBulkJob row. Nothing to stage; nothing to wait for.
else:
    write the tblBulkJob staging row, with
        BookDate / BookTime = the booking time          (F19a)
        the collection leg  = the next available collection (F19b)
    the parent and the delivery flow through to tucJob without waiting for a run.
    Run building then attaches courier and run order to jobs that already exist,
    rather than being the thing that brings them into existence.
```

That last line is the real change in the second branch: run building stops being the
gate between a booking and a job, and goes back to being what its name says.

### Which flag is "book immediately"? — and a live hazard if it is `AutoBook`

The likeliest candidate is `tblBulkRunSchedule.AutoBook`. **If it is, there is a bug
already on this list whose severity changes completely:**

`types.ts:734` reads `isActive: first.autoBook ?? true`, so in the new Schedules view
the **Active toggle is bound to `AutoBook`** — and it is a live control on every row
of the list (the Status column's `ActiveToggle`, `ScheduleTable.tsx:418`). If
`AutoBook` is the immediate-booking flag, then switching a schedule Active or
Inactive in the list is **silently switching that schedule between booking
immediately and staging into bulk.**

F8 already lists this as "conflates auto-book with active". That was written as a
cosmetic conflation. If `AutoBook` means book-immediately it is not cosmetic: it is
ops changing the dispatch pathway of a schedule by clicking a toggle labelled
something else.

**So: confirm what `AutoBook` means before F8 is touched, and until it is confirmed,
treat the Active toggle in the new view as unsafe.** If book-immediately turns out to
be a different flag, then the schedule needs one explicitly, in its own column, and
Active goes back to meaning active.

### Before removing the bulk row, count what reads it

The staging row is not only a staging record. Anything joining `tblBulkJob` stops
seeing immediately-booked work the day this ships:

- reporting and DIFOT
- the historic OTG upload (`KEVIN-ROUTED-OPERATIONS-HISTORIC-OTG-UPLOAD-2026-08-17.md`)
- `tblBulkJobRun` history, and anything keyed on `BulkJobId`
- `tblBulkJob.JobId` is the handle from a staged row to its `tucJob`; a bypassed job
  has no bulk row, so any code walking that link loses it. `tucJob` already carries
  `ScheduleId` — per F18 that is the join to use instead.

```sql
-- How much of the estate would stop writing a staging row?
SELECT s.AutoBook, COUNT(DISTINCT h.ScheduleId) AS Schedules
  FROM dbo.tblBulkRunScheduleHeader h
  JOIN dbo.tblBulkRunSchedule s ON s.ScheduleId = h.ScheduleId
 WHERE h.RetiredUtc IS NULL
 GROUP BY s.AutoBook;

-- Staged and never materialised: bookings that became a bulk row and never a job.
-- Worth running for its own sake, whatever happens to this item.
SELECT CAST(BookDate AS date) AS BookDate,
       COUNT(*)                                        AS Rows_,
       SUM(CASE WHEN JobId IS NULL THEN 1 ELSE 0 END)  AS NeverMaterialised
  FROM dbo.tblBulkJob
 WHERE BookDate >= DATEADD(day, -90, GETDATE())
 GROUP BY CAST(BookDate AS date)
 ORDER BY BookDate DESC;
```

### Open

- Where do the **collection and linehaul** legs sit in the straight-through path? The
  instruction names the parent and the delivery. My assumption is that all legs of an
  immediately-booked job are created together, and that in the staged path the
  collection leg still materialises on the same trigger as the parent — but say so
  either way rather than leaving it to whoever writes it.
- Does `PrebookJob` (`Models/TblBulkJob.cs:86`) already distinguish advance work from
  immediate work? If it does, the routing decision may have a home already.

### Acceptance

- A schedule with book-immediately ticked produces a `tucJob` and **no** `tblBulkJob`
  row.
- A schedule without it produces a `tblBulkJob` row whose `BookDate` / `BookTime` are
  the booking time — not the delivery window — and its parent and delivery reach
  `tucJob` without waiting for a run to be built.
- Run building attaches courier and run order, and no longer creates jobs that should
  already exist.
- The two counts above are taken before and after; nothing in reporting loses rows
  without someone having decided it should.

---

# 4. Database summary

Three scripts, all under the `@Commit = 0` harness used by `001`:

`001_schedule_header_and_id_keyed_links.sql` is on the rationalisation branch, not on
`main`; `003` below builds on the header and link tables it creates and is written to
sit beside it in the same folder.

| Script | Contents | Blocks |
| :- | :- | :- |
| `002_bundle_tables_and_route_header_binding.sql` | Schedule **bundle** tables + `Routes.HeaderScheduleId`. Written, in this branch. Supersedes the 2026-09-18 brief §4.1 DDL, and carries the `sp_rename` block in case those tables were already created as groups | E1, E2, E3 |
| `003_client_override_deltas.sql` | `tblBulkRunScheduleOverride` (ScheduleId-keyed, scope per schedule/leg, clustered on the lookup key) + `Header.OverrideCount` / `OverridesVersion` + `fnScheduleForClient` + fold clones and legacy variants into deltas | F1, F2, F3 |
| `004_display_names.sql` | `DisplayName` / `DisplayDescription` on the header | F13 |
| `005_drop_name_joins.sql` | Drop `tblBulkRunScheduleClient.ScheduleName` (the `ALTER` is already written and commented in `001`), re-point `TblBulkScheduleLinehaul` and `tucJobBooking` / `tucJob` at the header id, with the F18 verification queries as the gate | F18 |

No schema change is needed for F5–F8, F14 or F16 — they are mapper and view fixes.

---

# 5. Order of work

0. **F20's first question** — what does `AutoBook` mean? One answer, and it either
   downgrades to a naming tidy-up or stops ops using the Active toggle today. Ask
   before anything else on this list is touched.
0. **F18** — read it first. It is one page, it costs nothing, and it decides the key
   every other item on this list writes. The group → bundle rename is decided: do it
   in one pass before E1/E2 start, while those tables still do not exist.
0. **F17 step 1** — get `uspPrebookSet` out of the server and into `database/`. It
   is a `SELECT OBJECT_DEFINITION(...)` and a commit, it blocks nothing else, and
   until it is done a nightly production job has no review and no history.
1. **F7 write path** — stop the zone rows being overwritten. One line, today, before
   anything else: it is live data loss.
2. **F8 MaxJobs** — same reason, same size.
3. **F5** — confirm the legacy state enum, add the mapping both ways. Half the estate
   is showing the wrong temperature state.
4. **F6** — run the disagreement query, then fix per the answer.
5. **F1 + F3 + F2 + F4** — the override model. One deployable slice; F2, F3 and F4
   fall out of F1 and should not be fixed separately first.
6. **F7 read path, F14, F16, F19a** — the small fixes. F19a (parent start = booking
   time, into `tblBulkJob.BookDate`/`BookTime`) is unblocked and does not wait for
   F11.
7. **F9** — linehaul out of the schedule. Biggest structural win, and it unblocks F15.
8. **F13, F12, F10** — schedule shape.
9. **F11 + F19b** — cut-off rewrite, and the next-available-collection rule that
   depends on its collection modes.
10. **F15** — pricing and zones, as its own brief.
11. **F17 proper** — after F1 and F9, re-run the schedules-per-route count. Engineer
    what is left; there is a fair chance most of it dissolves.
12. **F20** — the staging bypass. It needs the `AutoBook` answer from step 0 and the
    read-impact counts; the straight-through path for parent and delivery can start
    as soon as those are in.

E1/E2/E3 from the 2026-09-18 brief slot in after step 5 — they need the bundle tables,
and E1's Groups column is easier once overrides are out of the schedule rows.

---

# 6. What I need back

- The legacy `StorageState` / `DeliveryState` integer → label mapping, from
  ClientManager (F5).
- The result of the `BookPickup` disagreement query, and a ScheduleId from the
  collection-section screenshot (F6).
- The result of the row-0 disagreement query (F8).
- Which build the linehaul leg-name field is in — it is not in this branch (F9).
- **What `AutoBook` actually means** — book immediately, or something else (F20).
  This is the one I need first.
- The name of the holidays table (F19, F20) — Steve confirms it exists; it is not in
  either scaffolded EF context.
- Where the collection and linehaul legs sit in the straight-through path (F20).
- The two counts in F20: schedules by `AutoBook`, and staged bulk rows that never
  became a job.
- The duplicate-header-name count — query 4 in F18. Run this one first; it sizes what
  name-matching has been hiding.
- Your call on renaming the E1/E2 schedule *group* tables to *bundles*, before they
  are created (F18).
- The `uspPrebookSet` definition, the schedules-per-route counts, and one RouteId
  that works next to one that does not (F17).
- Whether `Routes.ScheduleId` exists in the tenant database — the configurator's
  `Route` entity has no such column, and two briefs assume it does (F17).
- Your read on the transfer source: a new pickup source, or a depot-to-depot leg
  rule (F10)?
- A date for steps 1–4. They are small and they are all data integrity.
