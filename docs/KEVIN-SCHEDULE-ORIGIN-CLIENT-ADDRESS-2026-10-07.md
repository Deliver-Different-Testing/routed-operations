# Schedule origin: the first Depot leg can be "Client address"

_Steve Bonnici -> Kevin, 2026-10-07 (revised same day to Marcus's shape). Closes the "From client
address" confusion discussed with Kerran on 6 Oct. Supersedes F10's pickup-source wording and F12 in
`KEVIN-SCHEDULES-NEW-FIXES-2026-09-20.md`. Companion to
`KEVIN-SCHEDULE-COLLAPSE-COMPAT-VIEW-2026-09-29.md` (one new column on the detail table)._

Code references are to routed-operations `develop` on GitLab as at 2026-09-29 and the
dbmigrationsv2 SP re-emits of 2026-09-25 / 2026-09-28.

---

## 0. TL;DR

| | |
| :- | :- |
| **Problem** | "Pick up from client address" lives inside the Collection leg. Choosing it nulls `PickupDepotId` but the schedule still books a pickup job (LHP) from the client to the depot, then a delivery from the depot. That is the opposite of what the setting is for. |
| **Intent** | Some clients (warehouses, distribution centres) want runs built **from their own site**. The client address *is* the origin. There is no collection job and no consolidation at our depot. One delivery job per consignment, runs fan out from the client. |
| **Decision (Steve, Marcus)** | The chain's **first Depot leg** gains a dropdown value **"Client address"**. A schedule that delivers straight from a client's warehouse is **Depot (Client address) -> Delivery**, optionally with Linehaul legs in between. There is **no Collection leg**. Client-origin schedules are client-specific, never default. **No real depot rows per client** (avoid region sprawl). |
| **Good news** | The booking SP already produces the right job when a schedule has no pickup schedule and no linehaul: one job from the booking's own From address to the consignee. No new booking SQL. |
| **Real blockers (two)** | (1) Route Builder's region filter finds jobs by matching **pickup lat/long or From address to `tblBulkRegion`**; a client-address pickup matches no depot, so the job never appears when filtering by region. The filter must also admit `tblBulkJob.RegionID` for these schedules. (2) **Bulk Import** resolves a routed job's origin from the **schedule's Region depot first** (NZ: only), so imported jobs on a client-origin schedule would be stamped with the dispatch depot's coordinates. The resolver must take the client's saved site address instead (section 4.4). |
| **Remove** | The Pickup source dropdown on the Collection leg, including the "Booking-declared" value on develop that has no backend meaning. |
| **Dispatch region** | When the Depot leg is "Client address" nothing writes `Region`, which is how Route Builder / Route Viewer scope work to a team. The Depot card shows a **Dispatch region** picker in that case. |
| **Storage** | `OriginType` on `tblBulkRunScheduleDetail` (collapse plan M1). Interim derivation rule in section 5 until that ships. |

---

## 1. What the code does today

### 1.1 The UI invents a Collection leg for every schedule

`ScheduleDetailModal.tsx` `seedLegsFromDto` (~line 212) **always** pushes a Collection leg,
with `pickupSource = pickupDepotId ? 'depot' : 'client_address'`. Whether the schedule actually
books a pickup (`BookPickup`) is not consulted. So the "3 Hour Express 15:00-18:00" on-demand
schedule in the screenshot shows "Collect from Auckland" even though it is a delivery-only
schedule. This is F6 from the September list, seen from the other side.

![Collection leg with Pickup source dropdown, today](images/schedule-origin-2026-10-07/collection-leg-pickup-source-today.png)

On develop the dropdown has **three** values (`ChainBuilder.tsx` ~line 546): Client address,
Depot, Booking-declared. The deployed build shows two. All the dropdown does on save
(`NewScheduleModal.tsx:220`, `ScheduleDetailModal.tsx:136`) is:

```ts
pickupDepotId = leg.pickupSource === 'depot' ? leg.pickupDepotId : null;
```

"Client address" and "Booking-declared" are indistinguishable to the backend. `BookPickup` is a
separate checkbox under Advanced (`ScheduleDetailModal.tsx:1757`), unrelated to the leg.

### 1.2 What actually creates a pickup job

`WS_stpBulkScheduleJob_Insert` (and the `DD_` twin):

```sql
@HasPickupSchedule = ISNULL(s1.BookPickup, 0)                      -- line ~255
@InsertParentJob   = CASE WHEN @HasPickupSchedule = 1 OR @HasLinehaulSchedule = 1 THEN 1 ELSE 0 END
```

- `BookPickup = 1` -> parent + **LHP** (client -> depot) + DEL (depot -> consignee). The parent
  and DEL `From*` columns are overwritten with the depot; the client's address is kept in
  `BookFrom*` for the LHP (`InsertChildJobs` ~line 524-640 reads `s.PickupDepotId` for the LHP
  destination via `tblbulkRegion`).
- `BookPickup = 0` and no active linehaul rows -> `@InsertParentJob = 0` -> **one job**, `From*`
  = the booking's own From address (the client), `To*` = the consignee, `RegionID = s1.Region`.

So **Client origin = `BookPickup = 0`, `PickupDepotId = NULL`, no Collection leg.** The SP
already does the right thing for that combination. Nothing in the booking path needs to
change for a delivery-only client-origin schedule.

Linehaul legs that load at the client site are also already supported:
`tblBulkScheduleLinehaul.BookFromClientAddress = 1` makes `InsertChildJobs` (~line 710) address
the LH leg from the booking's `From*` instead of `tblBulkRegion`. That is the HelloFresh case.

### 1.3 Why Route Builder cannot see these jobs

`RunService.cs` ~line 64-104 (and the matching "R2.1" block in `JobService`): when the operator
filters by region, the job set is **not** `tblBulkJob.RegionID IN (...)`. It is a raw SQL join:

```sql
LEFT JOIN tblBulkRegion breg
  ON ((breg.PickupLatitude = j.PickUpLatitude AND breg.PickupLongitude = j.PickUpLongitude)
   OR LOWER(RTRIM(breg.FromAddress)) = <normalised j.FromAddress>)
WHERE breg.BulkRegionId IN (...)
```

A job whose pickup is a client address matches no `tblBulkRegion` row, so it is excluded from
every region-filtered Route Builder view. This mirrors a legacy SP and was correct when every
bulk job started at a depot. It is the actual reason client-origin schedules "don't work".

Run start is **not** depot-bound: `RunDtos.cs:105` / `RunService.cs:517` - the operator marks one
job in the run as `IsStart`, and `routeService.ts` sends that stop as the HERE `start`. So once
the jobs are visible, building a run that fans out from the client site needs no new concept.

---

## 2. The model

### 2.1 Origin is expressed by the first Depot leg

The chain already begins with a Depot leg that says where the goods are at the start. That leg's
dropdown gains one value, **Client address**, alongside the real depots.

![Depot leg dropdown today - gains a "Client address" value](images/schedule-origin-2026-10-07/depot-leg-dropdown-marcus.png)

| First Depot leg | Chain | Booking result | Run |
| :- | :- | :- | :- |
| **A real depot** (today's model) | optional **Collection** (collect from client into the depot, zone-driven per F10) -> **Depot** -> 0..n **Linehaul** -> **Delivery** | `BookPickup` as set; LHP if a Collection leg exists; DEL from depot | Starts at the depot (or wherever the operator marks `IsStart`) |
| **Client address** (new) | **Depot (Client address)** -> 0..n **Linehaul** (`BookFromClientAddress = 1`, optionally landing at a real Depot) -> **Delivery**. **No Collection leg.** | `BookPickup = 0`, `PickupDepotId = NULL`; one DEL job from the client's From address (or LH legs from the client, then DEL) | Jobs grouped under the schedule's **Dispatch region**; start = client site, from the booking's own pickup coordinates |

Examples: *Afternoon home from the Auckland depot* = Depot (Auckland) -> Delivery.
*PB Tech warehouse* = Depot (Client address) -> Delivery. *HelloFresh* = Depot (Client address)
-> Linehaul -> Depot (Auckland) -> Delivery.

Rules:

- Client-origin schedules are **client-specific**. A default schedule cannot have a Client-address
  first depot (validation: requires at least one client link and `IsDefault = 0`).
- A **Collection leg cannot coexist** with a Client-address first depot. Collection means
  "collect from the client into the depot"; when the depot *is* the client there is nothing to
  collect. ChainBuilder disables "Add Collection" and removes an existing one on confirm.
- **Dispatch region** is mandatory. For a real depot it is the depot's region as today. For
  Client address, the Depot card shows a Dispatch region picker (the same `tblBulkRegion` list)
  and that value is written to `Region`. It means "which dispatch team owns these runs", not
  "where the truck starts". The list column stays as it is.
- The Collection leg means exactly one thing from now on: **collect from the client's address
  into the depot**. Its "Pickup source" dropdown is deleted. Its zones (F10) decide coverage.

### 2.1a Why not a real depot row per client warehouse

The dropdown already contains partner premises modelled as depots (GF Dunedin, KB Distributors,
Mainfreight sites). A PB Tech warehouse *could* be set up the same way with no code change, and
Route Builder's coordinate match would even work because `tblBulkRegion` stores
`PickupLatitude` / `PickupLongitude`. **Decided against (Steve, 7 Oct):** every client warehouse
would become a depot in every filter and dropdown, and someone has to maintain the row. The
booking already carries the client's pickup coordinates; the run starts from those. "Client
address" in the Depot leg is the right abstraction.

### 2.2 What is removed

- `pickupSource` on `CollectionLeg` (`ChainBuilder.tsx:28`) and the dropdown (~line 540-549).
- The `'booking'` / "Booking-declared" value. No backend reads it; it writes the same null depot
  as Client address.
- The "Pickup source" summary line on the collapsed Collection card (`ChainBuilder.tsx:460`).
- `seedLegsFromDto` unconditionally adding a Collection leg (section 1.1).

### 2.3 Not changed

- The linehaul row's `fromClientAddress` checkbox ("Book from client address (overrides From
  depot)", `ChainBuilder.tsx:797`). It is a per-leg concern and the SP honours it. On a
  Client-origin schedule it defaults to **on** for the first LH leg.
- `BookPickup` as the DB truth for "has a collection job". The UI stops exposing it as a loose
  checkbox; it is derived: `BookPickup = (OriginType = 'depot' AND chain has a Collection leg)`.

---

## 3. UI

### 3.1 Depot card (first Depot leg), both `NewScheduleModal` and `ScheduleDetailModal`

The existing depot dropdown gains **"Client address"** as its first entry (above the real
depots). When selected:

```
DEPOT   Client address                         edit v  Remove
        Goods are at the client's own address at the start of this schedule.
        Dispatch region  [ Auckland            v ]      Storage state  [ - v ]
```

- **Dispatch region** picker appears (same `tblBulkRegion` list). Required. Writes `Region`.
- Card title reads "From client address" instead of "{Depot name}".
- If a Collection leg exists: confirm "Client-origin schedules have no collection job. Remove the
  Collection leg?" Yes removes it; No reverts the dropdown.
- Switching back to a real depot: Collection leg is **not** auto-added; the operator adds it if the
  schedule really collects. Dispatch region picker hides; `Region` = the chosen depot.
- Only the **first** Depot leg offers "Client address". A later Depot leg (after a Linehaul) is a
  real depot.

### 3.2 Chain builder

- Collection card: title "Collect from client address -> {depot}". Fields: speed (rating), zones
  (F10), collection box discount. No source dropdown.
- "Add Collection" button disabled with tooltip when the first Depot leg is "Client address".
- Linehaul card on a Client-origin schedule: `fromClientAddress` defaults true on the first LH
  leg; From-depot select disabled while it is on (already the behaviour at `ChainBuilder.tsx:686`).

### 3.3 Schedules NEW list

The existing Origin / depot column shows "Client address" (with the dispatch region in the
tooltip) for these schedules. Filterable. Useful for ops to find
the client-origin set when building runs.

### 3.4 Advanced

Remove the `BookPickup` checkbox from Advanced (`ScheduleDetailModal.tsx:1757`,
`NewScheduleModal.tsx:654`). Derived per section 2.3.

---

## 4. Route Builder

### 4.1 Region filter (the blocker)

`RunService` ~line 64 and the `JobService` R2.1 block: extend the raw SQL so a job qualifies if
**either** its pickup matches a depot (today's rule) **or** it belongs to a Client-origin
schedule whose `Region` is in the filter:

```sql
WHERE ( breg.BulkRegionId IN ({inList})
     OR ( j.RegionID IN ({inList})
          AND EXISTS (SELECT 1
                      FROM dbo.tblBulkRunSchedule s           -- compat view after collapse M2
                      JOIN dbo.tblBulkRunScheduleDetail x ON x.ScheduleId = s.ScheduleId
                      WHERE s.BulkRunScheduleId = j.ScheduleId
                        AND x.OriginType = 'client') ) )
  AND ISNULL(j.Done, 0) = 0
  {dateClause}
```

Until `tblBulkRunScheduleDetail` exists, use the interim derivation in section 5 in place of
the `EXISTS`. Same change in the Route Viewer region filter if it shares the SP pattern.

### 4.2 Grouping and start

- Jobs from a Client-origin schedule group into runs by `(RegionID, ClientId, BookDate)` in the
  cockpit's default grouping, so one client's fan-out does not mix with depot runs.
- Default `IsStart` for such a run: the first job's **pickup** stop (which is the client site,
  from the booking's own `PickUpLatitude` / `PickUpLongitude`). Today the operator picks it;
  defaulting it is a convenience, not a requirement. No `tblBulkRegion` row is involved.
- `ReturnToStart` default on (back to the client site), operator can switch off.

### 4.3 Where a job's pickup coordinates come from

A client-origin job must carry the **client site's** coordinates, never a depot's. Two entry
paths:

| Path | Today | Client origin |
| :- | :- | :- |
| Web / API booking (`WS_stpJob_Insert`, `WS_/DD_stpBulkScheduleJob_Insert`) | `@PickUpLatitude/@PickUpLongitude` come from the booking's From address. With `BookPickup = 0` and no linehaul they are stamped on the job unchanged (~line 470). | **No change.** |
| Bulk Import, routed (`BulkImportJobFactory.ResolveRoutedOriginLocal`, ~line 781) | Origin precedence: **Step 1 = the schedule's `RegionNavigation` depot** (address + `PickupLatitude/Longitude`). NZ "always resolves at Step 1". US then tries `RouteFromClientSite` -> per-row From address -> `OriginLocationId` region. | **Change required** - section 4.4. |

### 4.4 Bulk Import origin precedence

The wizard already has a **"Route starts from client site"** checkbox (`BulkImportRequest.
RouteFromClientSite`, `MapColumnsModal`). When ticked, `BulkImportJobFactory` (~line 735) fills
every row's `From*` and `FromLatitude/FromLongitude` from the client record's saved site address
(`tucClient` address + `Latitude`/`Longitude`). Two problems for our case: the schedule-depot
step runs **before** it, and the client-site branch is inside `if (isUs)`.

Rule: **when the chosen schedule's first Depot leg is Client address, the import behaves as if
`RouteFromClientSite = true`, on both tenants, and the schedule-depot step is skipped.**

```csharp
bool clientOrigin = schedule?.OriginType == "client";          // from detail row / interim rule
if (clientOrigin) request.RouteFromClientSite = true;          // implied by the schedule

ResolvedRoutedOrigin ResolveRoutedOriginLocal(BulkImportJobCreateDto j)
{
    if (!clientOrigin && schedule?.RegionNavigation != null) { /* depot origin, as today */ }
    if (request.RouteFromClientSite && !string.IsNullOrWhiteSpace(j.FromAddress))
    {   /* existing client-site branch, no longer gated on isUs */ }
    ...
}
```

The wizard shows the checkbox pre-ticked and disabled for a client-origin schedule, with the
hint "This schedule starts at the client's address".

### 4.5 Prerequisite: the client record is geocoded

The client-site branch is only correct if `tucClient.Latitude/Longitude` are populated.

- **Schedules NEW save**: when the first Depot leg is Client address, look up each linked
  client; if any has no site coordinates, show a warning naming them ("PB Tech has no geocoded
  site address - runs will not start in the right place") and offer the client record link.
  Warn, do not block, because the booking path still works from the per-booking address.
- **Bulk Import**: if the client has no site coordinates and the rows carry no From coordinates,
  **refuse the batch** with that message rather than falling back to a depot. A silently wrong
  run start is the failure mode this spec exists to remove.
- Geocoding the client site is a one-off via the existing HERE geocoder
  (`HereGeocodeService`); add a "Geocode site address" action on the client record if it is
  not already there.

### 4.6 Nothing else

Resolver (`UTL_stpRouteAutoAssign_*`), pricing, `uspPrebookSet`: unchanged. The job is a plain
delivery job to them.

---

## 5. Data model and migration

### 5.1 Column

On `tblBulkRunScheduleDetail` (collapse plan M1):

```sql
OriginType  CHAR(6) NOT NULL CONSTRAINT DF_tblBulkRunScheduleDetail_OriginType DEFAULT ('depot')
    CONSTRAINT CK_tblBulkRunScheduleDetail_OriginType CHECK (OriginType IN ('depot','client')),
```

If this spec ships **before** M1, put the same column on `tblBulkRunScheduleHeader` (nullable,
default 'depot') and move it in M1. Do not put it on the day row.

### 5.2 Interim derivation for existing schedules (no detail row yet)

```sql
OriginType = CASE WHEN ISNULL(BookPickup,0) = 0 AND PickupDepotId IS NULL
                   AND NOT EXISTS (SELECT 1 FROM dbo.tblBulkScheduleLinehaul l
                                   WHERE l.BulkRunScheduleId = s.BulkRunScheduleId
                                     AND l.Active = 1 AND ISNULL(l.BookFromClientAddress,0) = 0)
             THEN 'client' ELSE 'depot' END
```

i.e. no collection, no depot, and any linehaul loads at the client. Everything else is Depot.

### 5.3 Count before deciding the default (Kerran, read-only, Urgent prod)

```sql
SELECT
  SUM(CASE WHEN ISNULL(s.BookPickup,0)=0 AND s.PickupDepotId IS NULL THEN 1 ELSE 0 END) AS NoPickupNoDepot,
  SUM(CASE WHEN ISNULL(s.BookPickup,0)=0 AND s.PickupDepotId IS NOT NULL THEN 1 ELSE 0 END) AS NoPickupButDepot,
  SUM(CASE WHEN ISNULL(s.BookPickup,0)=1 AND s.PickupDepotId IS NULL THEN 1 ELSE 0 END) AS PickupNoDepot,
  SUM(CASE WHEN ISNULL(s.BookPickup,0)=1 AND s.PickupDepotId IS NOT NULL THEN 1 ELSE 0 END) AS PickupAndDepot,
  COUNT(*) AS DayRows
FROM dbo.tblBulkRunSchedule s
JOIN dbo.tblBulkRunScheduleHeader h ON h.ScheduleId = s.ScheduleId AND h.RetiredUtc IS NULL;
```

`NoPickupNoDepot` is the candidate Client-origin set, but it also contains ordinary
depot-origin, delivery-only schedules whose depot is implied by `Region`. **Do not auto-classify
those as Client origin.** Default everything to `'depot'` and let ops flag the genuine
client-origin schedules (expected: a handful of warehouse / DC clients). The `PickupNoDepot`
count is the set the old dropdown produced by accident; each of those is a real collection
whose depot should be set to `Region`.

---

## 6. Acceptance

1. A schedule saved with the first Depot leg = Client address has `BookPickup = 0`,
   `PickupDepotId = NULL`, `Region` = the chosen dispatch region, no Collection leg, and
   `OriginType = 'client'`. Booking a job on it creates **one** tucJob
   (or LH legs + DEL when linehaul legs exist) with From = the client's address. No LHP.
2. That job appears in Route Builder when filtering by the schedule's dispatch region, and can
   be built into a run whose start is the client site.
2a. A routed **Bulk Import** on that schedule stamps every job with the client site's address
   and coordinates, on NZ and US, without the operator ticking "Route starts from client site".
2b. The same import for a client with no geocoded site address is refused with a clear message.
3. A schedule saved with a real first depot and a Collection leg still produces LHP + DEL exactly
   as today (regression on an existing medical corridor schedule).
4. The Pickup source dropdown and the `'booking'` value no longer exist in the code.
5. `seedLegsFromDto` adds a Collection leg **only** when `BookPickup = 1`. F6 closes with it.
6. A default schedule cannot be saved with a Client-address first depot.
7. No new `tblBulkRegion` rows are needed for any of this.

---

## 7. Supersedes

- **F10** "Pickup source is client or dynamic": there is no pickup source any more. Collection
  always starts at the client; origin is on the schedule.
- **F12** "Book-from-client-address as a depot setting": this *is* that, expressed as a value of
  the Depot leg rather than a property of a depot row. The per-leg linehaul flag stays.
- **F6**: fixed as a side effect of section 2.2.

## 8. Open

- Whether Route Viewer's region filter shares the geospatial SP join and needs the same
  extension (section 4.1). Kevin to confirm.
- Whether the client record already exposes a geocode action anywhere in Routed Operations or
  only in legacy ClientManager (section 4.5).
- Whether ops wants `ReturnToStart` on by default for client-origin runs (section 4.2).
