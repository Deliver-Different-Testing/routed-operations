# Pricing and zones into Routed Operations: retiring Client Manager's Pricing area

_Steve Bonnici, 2026-10-09. Owner to be assigned (Kevin owns Schedules NEW; Kerran is on pricing fixes).
Sources: Steve + Marcus "Zone Groups chat" (9 Oct), Steve + Anisah "Configuring Rate Codes and Zones"
(9 Oct), 7 Oct standup. Code references are to routed-operations `origin/develop` at `f387df8`
(polygons merge) and dbmigrationsv2 `master` at `2a25e59`, both as at time of writing. Companion to
`KEVIN-CUSTOM-POLYGONS-ROUTES-AND-ZONES-2026-10-07.md`, `KEVIN-SCHEDULE-ORIGIN-CLIENT-ADDRESS-2026-10-07.md`,
the collapse plan and `KEVIN-SCHEDULES-ZONES-ZONE-GROUPS-HANDOVER-2026-08-21.md` (which carved pricing out;
this document is that carve-out)._

---

## 0. TL;DR

| | |
| :- | :- |
| **Why** | ClientManager and AdminManager are being retired. Client Manager's Pricing area (Rate Codes; Zones with its Depots / Zones / Rates / Dimensions tabs) is the last thing ops must still open to set up a routed client. Until Routed Operations can do it, ops cannot stop using the old screen. |
| **Where** | Under **Schedules NEW** in Routed Operations. Two new tabs beside Schedules / Schedule bundles / Recurring routes: **Zone groups** and **Pricing**. |
| **How** | Lift what Client Manager does today, then reimagine. Two changes are built in from the start, not deferred: (1) **a rate is a dollar figure, not a rate code**; (2) **a zone group is a named, reusable thing, not a depot's property**, and rates hang off the zone group. |
| **What ops gets** | Pick a zone group, see one grid: zone 1..10 down, speeds across, dollars in the cells. A "Default" sheet plus sparse per-client sheets ("turn on Zimmer", type only the cells that differ). A new medical client attaches to the Medical schedules and inherits the group's default sheet with no data entry. |
| **Risk control** | Rating output must not move. Phase 1 backfills `Amount` from `tucRateCode.ucrcAmount` row-for-row and the rating function reads `COALESCE(Amount, ucrcAmount)`. A re-rate of the last 30 days of zone-rated jobs must show zero difference before the rate-code join is removed. |
| **Decisions needed** | Section 9. |

---

## 1. What Client Manager does today (the flow ops must reproduce)

From Anisah's walkthrough, in the order she does it for a new client:

1. **Pricing > Rate Codes.** Create one `tucRateCode` per client, service and zone, named by convention:
   client short code, then `HAM` / `REG` / `COL` (Hamilton run / regional / collection), then `Z1`, `Z2`.
   Zimmer alone has a long list. A rate code's text can be copied but the code itself cannot be
   duplicated, so quoting means knowing which code applies.
2. **Pricing > Zones.** Type the client's short code over the default zone group to get a client view.
3. **Rates tab.** Pick region (depot) and schedule speed.
4. **Schedules.** Open the schedule and assign a rate code to each zone, for that speed and region.
   Pickup and delivery have separate speeds, so the two ends can price differently by zone.
5. Steps 1 to 3 must all exist before step 4 can be filled in.

Copying: a schedule is copied to another client by typing their short code into the copy field.
Zimmer is the medical template; every other medical client is a copy of Zimmer. There is no shared
medical default, and Anisah agreed one would be "way easier".

What step 4 actually writes is a `BulkZoneRate` row keyed on **(ClientId, DepotId, SpeedId, Zone)**
pointing at a `RateCodeId`. The schedule id is not in the key. That is why two clients can share a
schedule in Schedules NEW only if they share rates: rating looks up the client, the schedule's depot
(`tblBulkRunSchedule.Region`) and speed, never the schedule.

### 1.1 Tables behind it

| Concept | Table and columns (verified in EF entities / migrations unless marked) |
| :- | :- |
| Depot | `tblBulkRegion` (`BulkRegionId`, `Name`, `Active`). Called "Region" on `tblBulkRunSchedule.Region`. |
| Zone group (NZ) | `BulkZonePostcodeGroup` (`Id`, `Name`, `ClientId` null, `DepotId` null -> tblBulkRegion). **`DepotId` is the depot tie.** |
| Postcode -> zone (NZ) | `BulkZonePostcode` (`Id`, `Zone`, `PostCode` int, `FromSiteId`, `DepotId` null, `PostcodeGroupId` null, `FromLatLng`). Also carries `DepotId`. |
| Polygon -> zone (NZ) | `BulkZonePolygon` (`PostcodeGroupId`, `Zone`, `PolygonId`), migration `20261007170000`. |
| US territory | `ZoneGroup`, `ZoneName` (`LocationId` -> tblBulkRegion), `ZoneZip` (`ZoneZipGroupId` -> BulkZonePostcodeGroup). Separate model; see section 8. |
| Rates | `BulkZoneRate` (`Id`, `ClientId` null, `DepotId` null, `SpeedId` null, `StockSizeId` null, `Zone` 1..10, `RateCodeId`, `CourierPercentage`). **No CREATE TABLE in dbmigrationsv2**; exists only in the seed. Column list to confirm against the live schema before the ALTERs in section 4. |
| Rate codes | `tucRateCode` (`ucrcID`, `ucrcName` 50, `ucrcAmount` money, `ClientType`, `Active`, `Notes`, `PickUpPercentage`, `ActualCost`, audit). |
| Dimensions | `BulkZonePackageRate` (`Id`, `ClientId` null, `FromCubic`, `ToCubic`, `CubicRate`, `FromWeight`, `ToWeight`). |
| Surcharges | `BulkZonePostcodeSurcharge` (`Id`, `PostCode`, `ClientId` null, `Surcharge`). |
| Depot off per client | `tblBulkRegionClientLimit` (a row = depot deactivated for that client). |
| Bulk speeds | `BulkImportSpeed` (`Id`, `SpeedId` -> tucJobType, `ClientId` null). Only `tucJobType.ZoneRated = 1` speeds are offered. Duplicate check ignores ClientId, so a client row can never be added once a global row exists (known bug). |
| Available speeds | `tblClientAvailableSpeed`, falling back to `tblClientDefault_AvailableSpeed` (`UTL_fncJob_GetClientAvailableSpeed`). |
| Schedule -> zones | `tblBulkRunSchedule.Region`, `.PostcodeGroupId`, `.PickupPostcodeGroupId`, `.PickupDepotId`, `.SpeedId`, `.PickupRatingSpeed`; `BulkZoneSchedule` and `BulkPickupZoneSchedule` (zone numbers the leg fulfils). |

### 1.2 How a job is rated

`fncT_BulkZoneRate_WithLinehaul` (latest body at time of writing: dbmigrationsv2
`20260818182434_ClientReferenceExpansion.sql:10018`; baseline for any re-emit is the latest emitter
on master at build time). The rate lookup:

```sql
FROM BulkZoneRate LEFT JOIN tucRateCode ON ucrcID = RateCodeId
WHERE (ClientId = @ClientId OR ClientId IS NULL)
  AND (DepotId  = @SiteID   OR DepotId  IS NULL)      -- @SiteID is really tblBulkRegion.BulkRegionId
  AND (SpeedId  = @SpeedId  OR SpeedId  IS NULL)
  AND (StockSizeId = @StockSizeId OR StockSizeId IS NULL)
  AND Zone = @Zone AND ucrcAmount >= 0 AND Active = 1
ORDER BY ClientId DESC, DepotId DESC, SpeedId DESC, StockSizeId DESC   -- most specific wins
```

Amount = `ROUND(ucrcAmount x CubicRate)` x (1 + MFV) / PPDRate / (1 + `tucClient.Discount`), with
`CubicRate` from `BulkZonePackageRate` (client rows if any, else global) and extra items at the
add-on percentage (client available speed -> `tucClient.AddonPercentage` -> `tucJobType.AddonPercentage`
-> 0.8). The zone comes from `BulkZonePostcode` on the To postcode, the schedule's `PostcodeGroupId`
**and `bpc.DepotId = s.Region`** (`:10434-10436`); pickup leg the same via `PickupPostcodeGroupId`,
`PickupRatingSpeed` and `bpc.DepotId = S.PickupDepotId` (`:10207`).

Callers: `WS_stpBulkScheduleJob_Insert` / `DD_stpBulkScheduleJob_Insert`, `DD_stpJob_Scheduler_Rates`,
`UTL_stpJobBooking_InsertSchedule`, `fncT_StpBulkZoneRate_GetAmountByJobID`, and Routed Operations
`BulkImportRatingService.cs:312,321,397,406`. Add-ons: `sp_BulkZoneRate_AddPostCodeSurcharge`,
`sp_BulkZoneRate_AdditionalSpecialRate`.

### 1.3 What already exists in Routed Operations

- Zone group admin exists on the **legacy** `/schedules` page (`pages/Schedules.tsx:23-27`): tabs
  Schedules | Zones | Zone Groups | Depots (`pages/schedules/ZonesTab.tsx`, `ZoneGroupsTab.tsx`,
  `DepotsTab.tsx`) over `API/Controllers/TerritoryController.cs` (`postcode-groups` CRUD,
  `nz/postcodes`, `us/zip-zones`, `us/zone-names`, depot activate/deactivate) and
  `TerritoryService.cs`. Schedules NEW has no zone tab.
- Polygon Builder's zone drawer (`components/polygon/ZonesDrawer.tsx`, `GET api/zones/rating-postcodes`)
  reads depot -> group -> zone -> postcodes, and "Add to zone" writes `BulkZonePolygon`.
- **No pricing UI of any kind**: no zone rates, rate codes, package rates or surcharges.
- Schedules NEW filters zone groups by depot: `ScheduleDetailModal.tsx:1812,1825`
  (`g.depotId === advanced.pickupDepotId`) and `ChainBuilder.tsx:771`.
- Client overrides on a schedule exist and work (`tblBulkRunScheduleOverride`, `20260922123000`).
  Entry point: open the **base** schedule, **Clients tab**, "Configure override" / "Edit override"
  next to the attached client; or click the nested override row on the list. Steve and Anisah could
  not find it on 9 Oct because they looked on the Collection leg. UX item, section 6.

---

## 2. Target model

### 2.1 Zone groups are named and reusable; a schedule attaches one

A zone group is a named set of (zone number -> postcodes and polygons). It is **not** owned by a
depot. Any schedule in any region attaches whichever group fits: "Auckland postcodes" works for a
schedule out of ScheduleDepot, the NZ depot, the Qantas depot or a client's own address.

- `BulkZonePostcodeGroup.DepotId` stops being a selection filter. It stays as an optional **home
  depot** label (Decision 1 covers whether to replace it with a site/region label).
- Schedules NEW's zone group pickers list all active groups for the tenant with a search box, default
  groups first, then client-specific groups (`ClientId` set), with the home depot as a hint.
- `BulkZonePostcode.DepotId` and the `bpc.DepotId = s.Region` / `= S.PickupDepotId` predicates in the
  rating and availability functions go: membership is by `PostcodeGroupId` alone (section 4.3).

The reason zone groups were tied to depots is that **rates** were keyed on depot (zone 1 from the
North Shore is a different price from zone 1 from Mangere). That concern moves to the rate rows,
which is where it belongs:

### 2.2 Rates hang off the zone group, as dollars

A rate row answers: for **this zone group**, **this zone**, **this speed** (and optionally this
client and stock size), what is the dollar figure.

```
BulkZoneRate
  Id
  PostcodeGroupId  INT NULL -> BulkZonePostcodeGroup     NEW   null = applies to any group (legacy global rows)
  ClientId         INT NULL                               as today
  DepotId          INT NULL                               as today, legacy only; no new rows written with it
  SpeedId          INT NULL                               as today
  StockSizeId      INT NULL                               as today
  Zone             INT      1..10
  Amount           MONEY NULL                             NEW   the rate. Null only while RateCodeId still carries it
  Label            NVARCHAR(50) NULL                      NEW   carried over from tucRateCode.ucrcName ("ZIM HAM Z1"); informational
  Active           BIT NOT NULL DEFAULT 1                 NEW   replaces "ucrcAmount >= 0 AND tucRateCode.Active = 1"
  RateCodeId       INT NULL                               made nullable; read-only after Phase 1; dropped in Phase 2
  CourierPercentage                                       as today
```

Specificity order becomes `ClientId DESC, PostcodeGroupId DESC, DepotId DESC, SpeedId DESC, StockSizeId DESC`.
A client row for the group beats the group default; a group default beats a legacy depot row; a
legacy depot row beats the global default. Decision 2 confirms the position of `PostcodeGroupId`
relative to `DepotId` during the transition.

**Pickup and delivery price separately without a second sheet.** The schedule's delivery speed and
`PickupRatingSpeed` each select a column of the same grid, exactly as the function already does.

### 2.3 Defaults and sparse client sheets

- The **Default** sheet for a group = rows with `ClientId NULL, PostcodeGroupId = G`.
- A **client sheet** = rows with `ClientId = C, PostcodeGroupId = G`, and only for the cells that
  differ. The UI shows inherited default values greyed and typed overrides in full. This is the same
  sparse-override model as schedule client overrides, so ops learns one idea.
- "Turn on Zimmer in this group" creates no rows. It is the act of opening Zimmer's sheet; the first
  changed cell creates the first row. (Decision 7 if Steve would rather copy the defaults into client
  rows at turn-on.)
- A new medical client therefore needs: attach to the Medical schedules (exists), done. Pricing is the
  Medical group's default sheet. Zimmer stops being copied.
- Default **available speeds** already fall back from `tblClientAvailableSpeed` to
  `tblClientDefault_AvailableSpeed`. The Pricing tab exposes the bulk-speed list per group as the
  columns of the grid; adding a column is adding a `BulkImportSpeed` row (fix the duplicate check so
  client rows can coexist with global rows).

### 2.4 Rate codes

- Routed Operations never creates, shows or needs a `tucRateCode` for a bulk zone rate.
- `tucRateCode` stays as a table because on-demand rating uses it: `tucClient.ucclRate`,
  `ExpressRateCode`, `TruckRateCode`, `UTRateCode` and the `tblClientDefault` columns, read by
  AdminManager's client and client-default forms and by `UTL_fncJob_Rate`. That maintenance screen
  needs a new home when Client Manager goes. Decision 3; recommendation is the Configurator
  Settings app, next to the client form that consumes the dropdowns, not Routed Operations.

---

## 3. UI

### 3.1 Placement

`pages/SchedulesNew.tsx` `type Tab = 'schedules' | 'bundles' | 'routes'` (line 47) gains
`'zonegroups' | 'pricing'`; two `TabButton`s in the nav at lines 152-163; two bodies at 166-174.
Tabs are local state, not routes; keep that, but add `?tab=` so a pricing link can be shared.

```
Schedules NEW
[ Schedules ] [ Schedule bundles ] [ Recurring routes ] [ Zone groups ] [ Pricing ]
```

Legacy `/schedules` page: its Zones / Zone Groups / Depots tabs move under **Zone groups**; the legacy
page then has nothing left and is removed (its Schedules tab is already superseded).

### 3.2 Zone groups tab

Re-home `ZoneGroupsTab.tsx`, `ZonesTab.tsx`, `DepotsTab.tsx` as sub-views. Changes while moving:

- Group list shows Name, Type (Default / Client: code), home depot (hint only), zones used, postcode
  and polygon counts, schedules attached (count, click to list).
- Create / rename / duplicate group. Duplicate copies zone membership (postcodes and polygons) and,
  with a checkbox, the group's default rate sheet.
- A zone row lists its postcodes then its polygons (same shape as Polygon Builder's drawer).
- Depots sub-view keeps activate/deactivate and per-client depot limits (`tblBulkRegionClientLimit`).

### 3.3 Pricing tab

Header: **Zone group** picker (search), **Client** picker (Default, or a client; client list = clients
attached to any schedule using this group, plus search for any client). Sub-views: **Zone rates** |
**Dimensions** | **Surcharges** | **Speeds**.

**Zone rates** (the grid):

```
Zone group: Auckland postcodes          Client: [ Default v ]        [ + Speed ]  [ Export ]

           | Overnight | 8am     | Same day | Hamilton run | Collection |
 Zone 1    |   12.50   |  18.00  |   25.00  |    30.00     |    9.00    |
 Zone 2    |   14.00   |  19.50  |   27.00  |    32.00     |   10.00    |
 ...
 Zone 10   |   48.00   |  60.00  |   85.00  |    95.00     |   30.00    |

 Courier %  per column (CourierPercentage), shown as a footer row.
```

Switch Client to Zimmer: inherited cells render grey ("12.50"), overridden cells render black with a
dot; typing into a grey cell creates the client row; clearing a black cell deletes it. A "Differs from
default: 6 cells" chip in the header, with "Reset all to default".

Stock size (`StockSizeId`) is a third dimension the current data uses rarely; show it as an optional
"by stock size" expander under a column rather than a third axis. To confirm how many rows carry it
(query in section 7).

**Dimensions**: `BulkZonePackageRate` bands (cubic from/to, weight from/to, cubic rate), Default or
client. Today a client with any rows uses only its own rows (no merge); keep that rule and say so on
screen.

**Surcharges**: `BulkZonePostcodeSurcharge` list, Default or client, postcode typeahead.

**Speeds**: `BulkImportSpeed` list (global and client), limited to `tucJobType.ZoneRated = 1`.

### 3.4 Schedule modal

- Zone group pickers on the Delivery and Collection cards list all groups (section 2.1); the depot
  filter goes.
- Each card shows a **"View rates"** link that opens the Pricing tab for that group and the schedule's
  speed column highlighted, with Client = the client being viewed-as (F16) or Default.
- The Clients tab's "Configure override" button gets a one-line caption: "Client differs on cut-off,
  auto-book, display name, speed. Prices live in Pricing > zone group > client."

---

## 4. Data and SQL work

### 4.1 Snapshot first

Migration `20261007160000` snapshotted `UCL_fncT_GetBulkZone` and `UTL_fncBulkZonePostcode_IsActive`.
Before any change here, add to dbmigrationsv2 as no-op snapshots whatever of the following is still
only in the tenant databases (check each; some may already be covered by `20260818182434`):
`fncT_BulkZoneRate`, `fncT_BulkZoneRate_WithLinehaul`, `fncT_StpBulkZoneRate_GetAmountByJobID`,
`fncBulkZoneRate*`, `sp_BulkZoneRate_AddPostCodeSurcharge`, `sp_BulkZoneRate_AdditionalSpecialRate`,
`UCL_StpBulkZoneRate_GetAmountByJobID`, and a `CREATE TABLE` snapshot of `BulkZoneRate`,
`BulkZonePackageRate`, `BulkZonePostcodeSurcharge`, `BulkImportSpeed` (none are in the repo).

### 4.2 Phase 1 migration: dollars

```sql
ALTER TABLE dbo.BulkZoneRate ADD
    PostcodeGroupId INT NULL CONSTRAINT FK_BulkZoneRate_Group FOREIGN KEY REFERENCES dbo.BulkZonePostcodeGroup (Id),
    Amount          MONEY NULL,
    Label           NVARCHAR(50) NULL,
    Active          BIT NOT NULL CONSTRAINT DF_BulkZoneRate_Active DEFAULT (1);
ALTER TABLE dbo.BulkZoneRate ALTER COLUMN RateCodeId INT NULL;   -- to confirm current nullability

UPDATE r SET r.Amount = rc.ucrcAmount,
             r.Label  = rc.ucrcName,
             r.Active = CASE WHEN rc.Active = 1 AND rc.ucrcAmount >= 0 THEN 1 ELSE 0 END
FROM dbo.BulkZoneRate r JOIN dbo.tucRateCode rc ON rc.ucrcID = r.RateCodeId;
-- rows whose RateCodeId matches no tucRateCode: report, leave Amount NULL, Active = 0
```

Both tenants (Urgent, Medical). Idempotent: the UPDATE only touches rows where `Amount IS NULL`.

Rating function change (re-emit from the latest emitter on master at build time): replace
`ucrcAmount` with `COALESCE(r.Amount, rc.ucrcAmount)` and the `ucrcAmount >= 0 AND Active = 1`
pair with `r.Active = 1`. Add `PostcodeGroupId` to the predicate and the ORDER BY (section 2.2). The
function needs the group id: callers already have `@PostcodeGroupId` (`WS_stpBulkScheduleJob_Insert`
~line 262) and `tblBulkRunSchedule.PickupPostcodeGroupId`; add an optional `@PostcodeGroupId` parameter
defaulting to NULL so existing callers compile, and pass it from the two insert procs and from
`BulkImportRatingService`. Same for the `DD_` twin and `fncT_StpBulkZoneRate_GetAmountByJobID`.

**Gate to pass before Phase 1 is deployed to prod:** re-rate the last 30 days of zone-rated jobs on
staging with the old and new function bodies and diff `Amount` per job. Expected: zero rows differ.
Any difference is a bug in the backfill, not an accepted change.

### 4.3 Phase 2 migration: decouple from depot

- `UTL_fncJob_GetClientAvailableBulkRunSchedule` / `DD_` twin: the `@FromRegions` / `@ToRegions`
  population (`SELECT DISTINCT DepotId, PostcodeGroupId FROM BulkZonePostcode WHERE PostCode = @X`)
  becomes `SELECT DISTINCT PostcodeGroupId ...`, and candidate schedules are those whose
  `PostcodeGroupId` (or `PickupPostcodeGroupId`) is in that set, regardless of `Region`. The polygon
  branch added in `20261007210000` returns `(DepotId, PostcodeGroupId, Zone)`; drop `DepotId` from
  its output the same way.
- `UCL_fncT_GetBulkZone`, `UTL_fncBulkZonePostcode_IsActive`, `fncT_StpBulkZoneRate_GetAmountByJobID`:
  remove `bpc.DepotId = s.Region` and `bpc.DepotId = S.PickupDepotId`; join on `PostcodeGroupId` only.
- `BulkZonePostcode.DepotId`: stop writing it; leave the column until the functions above are
  re-emitted on both tenants, then drop.
- `BulkZoneRate.DepotId` and `RateCodeId`: after Phase 1 has run clean for a release, one-off rewrite
  of legacy depot rows to group rows where the mapping is unambiguous (one default group per depot),
  report the rest for ops, then drop both columns.
- `BulkZonePostcodeGroup.DepotId`: keep as home depot or replace per Decision 1.

### 4.4 Routed Operations API

New controller `API/Controllers/PricingController.cs` (`api/pricing`), policy `RouteBuilder.Admin`
for writes, `RouteBuilder.Read` for reads:

```
GET    api/pricing/groups/{groupId}/rates?clientId=            -> grid (default + client deltas)
PUT    api/pricing/groups/{groupId}/rates                       -> upsert cells [{zone, speedId, stockSizeId?, clientId?, amount, courierPercentage}]
DELETE api/pricing/rates/{id}
GET    api/pricing/package-rates?clientId=   PUT/DELETE
GET    api/pricing/surcharges?clientId=      PUT/DELETE
GET    api/pricing/speeds?clientId=          PUT/DELETE          (BulkImportSpeed; fix duplicate check to include ClientId)
GET    api/pricing/groups/{groupId}/clients                     -> clients attached to schedules using the group
```

EF: add `BulkZoneRate`, `BulkZonePackageRate`, `BulkZonePostcodeSurcharge`, `BulkImportSpeed` entities
to `DespatchContext` (none exist in `Core/Domain/Despatch` today; `BulkZonePostcodeGroup`,
`BulkZonePostcode`, `BulkZonePolygon` do).

---

## 5. Phases and order

| Phase | Scope | Ships when |
| :- | :- | :- |
| **0. Snapshot** | 4.1. No behaviour change. | First. Same discipline as the polygons spec step 0. |
| **1. Lift, in dollars** | 4.2 schema + backfill; rating function reads Amount; Pricing tab (grid, Dimensions, Surcharges, Speeds) and Zone groups tab in Schedules NEW; legacy `/schedules` page removed. Client Manager's Pricing > Zones / Rates / Dimensions become read-only for Urgent and Medical (or are simply no longer opened; Decision 4). | After the 30-day re-rate diff is zero on staging. |
| **2. Decouple** | 4.3; depot filter removed from the schedule modal; one-off report of duplicate per-depot groups for ops to merge; pickup zone groups that are strict subsets of a default group retired into it (polygons spec decision 3, after the Collection card can pick zones). | After Phase 1 has run a release in prod. |
| **3. Defaults** | "Medical" and "Urgent" default groups with default sheets; duplicate-group-with-rates; onboarding: new client = attach to schedules, no pricing entry. Rate-code maintenance for on-demand moves to its new home (Decision 3). | After Phase 2. |

Phase 1 is the one that lets ops stop opening Client Manager for a new routed client.

---

## 6. Smaller gaps from the Anisah session, and where they land

| Gap | Lands |
| :- | :- |
| Nowhere in Schedules NEW to assign a rate per zone per speed | Pricing tab grid (3.3). This is the one item no existing spec covered. |
| Client override: cannot see how to add one | Exists on the base schedule's Clients tab. Add the caption in 3.4; consider surfacing "Configure override" on the nested client row of the list too. |
| View-as filters by schedule name, not client | F16 on Kevin's list (`KEVIN-SCHEDULES-NEW-FIXES-2026-09-20.md`), bumped; re-prioritise after Phase 1. |
| No shared medical default; Zimmer copied to every client | Phase 3; the model in 2.3 makes it a default sheet. |
| Collection zone group looks like a double-up with the zones | It is. Polygons spec decision 3: once the Collection card selects the zone numbers it collects from, pickup groups that only express a subset retire into the default group. |
| Attaching a client to a default schedule appears to turn it into a client schedule (Marcus, 9 Oct) | Section 6.1. UI derivation bug plus a missing explicit setting; the data and the booking function already behave the way Steve wants. |
| A client with a custom schedule into an area still sees the defaults for that area (Steve, 9 Oct) | Section 6.2. The old engine's suppression rule was dropped on 8 Sep; restore it in the availability functions and prebook. |

### 6.1 A default schedule with attached clients must stay a default (Marcus, 9 Oct)

**Wanted:** one "Medical Hamilton run" available to every medical client; any client can carry an
override for its own quirks; the schedule remains bookable by everyone else.

**What the code does today (develop `f387df8`):**

- `tblBulkRunScheduleHeader.IsDefault` is set to 1 on create (`ScheduleService.cs:1175,1484`) and
  **nothing in Routed Operations ever sets it to 0**. `AttachClientsAsync` (`:2057`) only inserts
  `tblScheduleClient` rows. So in the database the schedule stays a default after a client is attached.
- The booking function agrees: a day row qualifies for a client if the client has a link row **or**
  `h.IsDefault = 1` (`20261007210000_Polygons_AvailabilityPolygonFallback.sql:276-278` and the three
  sibling predicates). Attaching Zimmer does not remove the run from anyone else.
- The link row's only effects are (a) ranking: within the same `SpeedId` (and day) partition a
  link-bound row outranks a default row for that client (`:457-477`, `:494-532`), and (b) it is the
  hook an override delta hangs off (`tblBulkRunScheduleOverride`).
- **Confirmed by test (Steve + Anisah, 9 Oct):** a client was attached to a default schedule; a
  booking to the same destination on a *different* account was still offered that schedule, and an
  override could be configured for the attached client. The data and the function are right.
- **The UI contradicts this in three places, all deriving "default" from "no attached clients"
  instead of reading `header.IsDefault`:**
  1. **List filter.** `SchedulesV2Controller.cs:111-112`: the Defaults pill is
     `BaseScheduleId == null && LegacyClientId == null && ClientCount == 0`; Shared is the negation.
     The controller's own doc comment (`:52-53`) says "IsDefault = 1 only", but the code never looks
     at the flag. This is why the schedule moved out of Defaults into Shared when a client was attached.
  2. **List chip.** `SchedulesNew.tsx:945`: "All clients" only when `clientCount === 0`; one attached
     client and the row shows client code chips instead.
  3. **Modal, Clients tab.** `ScheduleDetailModal.tsx:1272` derives
     `isDefault = legacyClientId == null && clientIds.length === 0` and renders the "Who can book this
     schedule" radios (`:1372-1380`) from it, so "All clients (default)" un-ticks and "Specific
     clients: only the clients attached below" ticks, which is false. The radios are display-only;
     there is no control that sets IsDefault at all.
  So ops is told the schedule became client-specific when it did not, and there is no way in the new
  UI to make one that genuinely is.

**Rule to build:**

1. **Bookable by all clients** is an explicit header setting bound to `IsDefault`, editable in the
   modal, independent of link rows. Attaching or detaching a client never changes it.
2. A link row means **configured for this client**: ranked first for that client within its speed, and
   the place an override lives. Rename the Clients tab action from "Attach" to "Configure for client"
   so it does not read as a restriction.
3. Setting "Bookable by all" off requires at least one link row, otherwise nobody can book it;
   validate in `ScheduleService` (same pattern as the client-origin guard at `:1156`).
4. List chip: `IsDefault = 1` shows "All clients", plus "+N configured" with the codes when links exist.
   `IsDefault = 0` shows the client codes only, as today. Type pill "Shared" (`SchedulesV2Controller.cs:53`,
   "IsDefault = 0 AND has links") keeps its meaning; "Defaults" includes defaults that have configured
   clients.
5. Modal radios become real controls on `IsDefault`; hints rewritten: "All clients: every client can
   book it; configured clients below get their own settings" / "Specific clients: only the clients
   below".
6. No migration: the column exists; legacy headers with `IsDefault = 0` and `LegacyClientId` set are
   untouched.

The ranking in (2) is weaker than it looks; section 6.2 explains why defaults still leak through.

### 6.2 A configured client must stop seeing the defaults for that lane (Steve, 9 Oct)

**Wanted:** the old engine's behaviour. If a client has a custom schedule into an area through a given
depot or destination, the booking app shows the client only its custom schedules for that lane, not
the defaults as well. Multiple clients per schedule lost that filtering.

**What the old function did** (NZ, through `20260903120002_UTL_fncJob_GetClientAvailableBulkRunScheduleJunctionDualPath.sql:430-444`,
and the same shape on the US side at `20251126105900:196`): the candidate set is already cut to the
From/To depot pair resolved from the postcodes (the "lane"). Within it, a default row survived only if
the client had **no client-specific row with the same `SpeedId`**:

```sql
OR (ClientId IS NULL
    AND NOT EXISTS (SELECT 1 FROM tblScheduleClient sc WHERE sc.ScheduleName = t1.Name)
    AND NOT EXISTS (SELECT 1 FROM @ClientAvailableBulkRunScheduleTemp t2
                    WHERE (t2.ClientId = @ClientID OR <t2 linked to @ClientID>)
                      AND t1.SpeedId = t2.SpeedId))
```

So a Zimmer 8am Hamilton run (Overnight) hid the default Overnight Hamilton run from Zimmer, and left
the default Same-day Hamilton run visible because it is a different speed.

**What replaced it** (`20260908120001` header comment, Kevin 2026-09-08 "revised same day"): the UNION
rule, "defaults broadcast to every client regardless of whether the client also has per-client
bindings". The `NOT EXISTS` suppression went; in its place the final select ranks link-bound rows
first within `PARTITION BY SpeedId, DayOfWeek` and keeps `TOP# <= ISNULL(NoSDailyLimit, 999)`
(`20261007210000:513-532`). With `NoSDailyLimit` NULL on most schedules, the cap is 999, so the
ranking changes order only: every default for the same lane, speed and day still comes through
behind the configured one. The reason given for the change was operator confusion over a 28k-row
safety-net insert that made default schedules show "268 clients"; that safety net is gone, so the
reason no longer applies to the suppression rule itself.

**Rule to restore** (in `UTL_fncJob_GetClientAvailableBulkRunSchedule`, its `DD_` twin and the six
predicate sites in `uspPrebookSet`; baseline from the latest emitter on master at build time):

```
keep row IF  linked to @ClientID
         OR  (IsDefault = 1
              AND NOT EXISTS (another candidate row linked to @ClientID
                              with the same SpeedId          -- legacy scope
                              [AND the same DayOfWeek]))     -- Decision 8
         OR  ShopifyShop special case, unchanged
```

The candidate set is already the lane (From/To depot pair, and after Phase 2 of this spec the
From/To zone groups), so "that particular area through that particular depot or destination" is
inherited, not re-implemented. The `NoSDailyLimit` cap then applies to what remains, as today.

The booking app needs no change: it shows what the function returns. The Schedules NEW list is
unaffected: this is a booking-time rule, and the list keeps showing the default to ops with its
configured clients (6.1).

**Acceptance:** attach Zimmer to "Medical Hamilton 8am" (Overnight, default). Booking as Zimmer to a
Hamilton postcode offers Medical Hamilton 8am and not the default Overnight Hamilton run; the default
Same-day Hamilton run is still offered (Decision 8 scope a). Booking as Life Healthcare, not attached,
still offers the default Overnight Hamilton run. Prebook (`uspPrebookSet`) books Zimmer's recurring
jobs onto Medical Hamilton 8am only.

---

## 7. Queries to run before building (SELECT only, Urgent and Medical)

```sql
-- shape of the rate data
SELECT COUNT(*) rows_, SUM(CASE WHEN ClientId IS NULL THEN 1 ELSE 0 END) global_,
       SUM(CASE WHEN DepotId IS NULL THEN 1 ELSE 0 END) no_depot,
       SUM(CASE WHEN StockSizeId IS NOT NULL THEN 1 ELSE 0 END) with_stock_size,
       COUNT(DISTINCT RateCodeId) rate_codes
FROM BulkZoneRate;
-- rate codes shared by more than one rate row (editing one reprices all of them today)
SELECT RateCodeId, COUNT(*) FROM BulkZoneRate GROUP BY RateCodeId HAVING COUNT(*) > 1;
-- rate codes referenced by bulk rates AND by on-demand client columns (must survive as tucRateCode)
SELECT r.RateCodeId FROM BulkZoneRate r
WHERE EXISTS (SELECT 1 FROM tucClient c WHERE c.ucclRate = r.RateCodeId OR c.ExpressRateCode = r.RateCodeId
              OR c.TruckRateCode = r.RateCodeId OR c.UTRateCode = r.RateCodeId);
-- zone groups per depot, and groups that are strict subsets of their depot's default group
SELECT DepotId, COUNT(*) groups_, SUM(CASE WHEN ClientId IS NULL THEN 1 ELSE 0 END) defaults_
FROM BulkZonePostcodeGroup GROUP BY DepotId;
-- depot rows that map to exactly one default group (safe to rewrite to PostcodeGroupId in Phase 2)
SELECT r.DepotId, COUNT(DISTINCT g.Id) default_groups
FROM BulkZoneRate r JOIN BulkZonePostcodeGroup g ON g.DepotId = r.DepotId AND g.ClientId IS NULL
GROUP BY r.DepotId;
```

The last query decides how much of the Phase 2 rewrite is automatic.

---

## 8. Out of scope

- US territory (`ZoneGroup` / `ZoneName` / `ZoneZip`, `ZoneCombo` flight rates). The Zone groups tab
  re-homes the existing US sub-views unchanged; US rating is a different engine.
- On-demand rating (`UTL_fncJob_Rate`, `tucClient` rate-code columns, `tblClientDefault`). Only the
  maintenance screen's new home is decided here (Decision 3).
- Rate cards / markups (`20251202143759_ZoneRateCardId` and siblings) and the Configurator rating
  rewrite (`RATING_REWRITE_SCREEN_SPEC.md`). That design is the long-run shape; this spec gets ops off
  Client Manager first.
- `tucRateCode.PickUpPercentage` and `ActualCost`: to confirm whether any bulk path reads them; if so,
  carry them onto `BulkZoneRate` in Phase 1.

---

## 9. Decisions needed from Steve

1. **Zone group scoping.** Flat tenant-wide list with search and a home-depot hint (recommended), or
   group by site (`tucPostCode.SiteID`: Auckland / Wellington) so Dunedin groups do not show on an
   Auckland schedule. Nothing finer exists in the data without inventing a region entity.
2. **Transition precedence.** `PostcodeGroupId` outranks `DepotId` in the rate lookup from Phase 1
   (recommended; new rows are always group rows), or the reverse until Phase 2.
3. **Home for on-demand rate-code maintenance** (`tucRateCode` for `tucClient` / `tblClientDefault`):
   Configurator Settings app (recommended; Kerran, beside the client form that uses the dropdowns) or
   a Settings area in Routed Operations (does not exist today).
4. **Client Manager cut-off for bulk pricing.** Make Pricing > Zones / Rates / Dimensions read-only
   in Client Manager at Phase 1 (recommended; prevents two writers), or leave it writable and rely on
   ops discipline.
5. **Owner.** Kevin (owns Schedules NEW and the rating function changes are next to his schedule
   work) or Kerran (on pricing fixes now). Recommendation: Kevin for Phases 0 to 2, with Kerran on the
   Configurator side of Decision 3.
6. **Grid axes.** Zone down, speed across, client as a selector (recommended), with stock size as an
   expander. Alternative: speed as the selector and client across, which matches Client Manager's
   Rates tab but hides client differences.
7. **"Turn on client" semantics.** Sparse overrides only (recommended; no rows until a cell differs)
   or copy the default sheet into client rows at turn-on (more rows, but a client sheet is then
   frozen against later default edits).
8. **Suppression scope** (6.2). (a) Legacy scope: a configured schedule hides defaults on the same
   lane with the same **speed** (recommended; restores pre-8 Sep behaviour exactly, so the Same-day
   default still shows beside a custom Overnight run). (b) Same lane, same speed **and day**
   (narrower: a Mon/Wed/Fri custom run leaves the default visible on Tue/Thu). (c) Same lane, any
   speed (widest: one custom run hides every default into that area). A per-client setting could
   switch between (a) and (c) later; pick one default now.

---

## 10. Acceptance

1. Phase 1: for every zone-rated job booked in the 30 days before cut-over, on both tenants,
   `fncT_StpBulkZoneRate_GetAmountByJobID` returns the same amount with the new function body as with
   the old. Zero differences.
2. In Schedules NEW > Pricing, choose "Auckland postcodes" > Default: the grid shows the amounts that
   Client Manager's Rates tab shows for the Auckland depot per speed per zone. Change Zone 3 /
   Overnight to a new figure; a test booking to a Zone 3 postcode on an Overnight schedule rates at the
   new figure. No `tucRateCode` row is created or changed.
3. Switch Client to Zimmer: cells render as inherited; type one cell; a booking for Zimmer rates at the
   typed figure and a booking for another client on the same schedule still rates at the default.
4. Phase 2: a schedule out of the Qantas depot attaches "Auckland postcodes"; a booking to a Zone 2
   postcode is offered and rates at the group's Zone 2 figure, with no `BulkZoneRate` row carrying
   that depot.
5. Phase 3: attach a new client to the Medical schedules with no pricing entry; a booking rates at the
   Medical group default sheet.
6. Legacy `/schedules` page is gone; Zone groups and Pricing tabs are reachable from Schedules NEW
   with `?tab=` deep links.
