# Kevin — Routed Operations schedules + zones/zone groups handover

## Decision
This work is no longer owned as Configurator work.

It now belongs under **Routed Operations**.

This document is the split-out Kevin brief from:
- `scheduled-rate-builder/docs/STEVE-KERRAN-CLIENT-MODAL-AND-RATES-MIGRATION-2026-07-02.md`

But only for the slice related to:
- schedules
- zone groups
- zip/zones
- the schedule-linked boundary

It does **not** carry over the broader client modal / pricing / rate-code migration work.

---

## Executive call

### Does this include moving zones and zone groups?
**Yes — at least the zone/zone-group surface that schedules depend on.**

A clean schedules-only move would be misleading.

In legacy ClientManager:
- schedules reference **postcode groups** directly
- schedules also carry **per-schedule active zone rows**
- zone groups sit above the zip/zone structure used by the territory UI

So Kevin's scope should be framed as:

> **Schedules + zone groups + zip/zones dependency surface**

not just "schedules" in isolation.

That does **not** mean Kevin has to bring all historical pricing/rating maintenance with it.
It means the Routed Operations implementation needs the territory primitives that schedules actually rely on.

---

## What was split out of the original Kerran doc
From the original migration brief, keep only the parts tied to:
- `Location Management`
- `Zips & Zones`
- `Schedule-linked`
- the mounted `/schedules` prototype
- the mounted `/territory` prototype

Relevant source sections in the original doc:
- `Workstream 2 — Phase 2: keep schedule-linked behaviour aligned with Dane and clean up schedules-facing UX`
- `Workstream 3 — Phase 3: finish the rates/rating migration path`

Do **not** carry across:
- client/customer modal work
- `/customers` vs `/clients` reconciliation
- pricing tab migration outside the schedule-linked dependency boundary
- rate code / dimensions / broad pricing implementation

---

## New product framing
Use this framing going forward:

- **Routed Operations** = umbrella product / repo landing place
- **Schedules** = recurring/scheduled operations surface
- **Territory** = zip zones + zone groups + depot/location support surface
- **Schedule-linked** = handoff/integration boundary between territory/rating context and schedules

This should live in:
- repo: `routed-operations`
- docs: `routed-operations/docs/`

The old `scheduled-rate-builder` repo remains a **reference prototype source**, not the final ownership location for this slice.

---

## Legacy ClientManager source of truth to preserve

### Angular UI / API usage
- `gitlab-source/clientmanager/wwwroot/app/components/schedules/schedulesControl.js`
- `gitlab-source/clientmanager/wwwroot/app/services/schedulesService.js`
- `gitlab-source/clientmanager/wwwroot/app/components/schedules/schedulesView.html`
- `gitlab-source/clientmanager/wwwroot/app/components/pricing/zonesControl.js`
- `gitlab-source/clientmanager/wwwroot/app/components/pricing/zonesView.html`

### API controllers
- `gitlab-source/clientmanager/API/Controllers/SchedulesController.cs`
- `gitlab-source/clientmanager/API/Controllers/BulkZonePostcodeGroups.cs`
- `gitlab-source/clientmanager/API/Controllers/ZonesController.cs`
- `gitlab-source/clientmanager/API/Controllers/RegionsController.cs`

### Service layer
- `gitlab-source/clientmanager/Core/Application/Services/ScheduleService.cs`
- `gitlab-source/clientmanager/Core/Application/Services/BulkZonePostcodeGroupService.cs`
- `gitlab-source/clientmanager/Core/Application/Services/RegionService.cs`

### Key domain entities
- `gitlab-source/clientmanager/Core/Domain/Despatch/TblBulkRunSchedule.cs`
- `gitlab-source/clientmanager/Core/Domain/Despatch/BulkZoneSchedule.cs`
- `gitlab-source/clientmanager/Core/Domain/Despatch/BulkZonePostcodeGroup.cs`
- `gitlab-source/clientmanager/Core/Domain/Despatch/ZoneZip.cs`
- `gitlab-source/clientmanager/Core/Domain/Despatch/ZoneName.cs`
- `gitlab-source/clientmanager/Core/Domain/Despatch/ZoneGroup.cs`
- `gitlab-source/clientmanager/Core/Domain/Despatch/TblBulkRegion.cs`
- `gitlab-source/clientmanager/Core/Domain/Despatch/TblBulkScheduleLinehaul.cs`

---

## What the legacy model proves

### 1) schedules are coupled to postcode groups
`TblBulkRunSchedule` includes:
- `PostcodeGroupId`
- `PickupPostcodeGroupId`
- `Region`
- `PickupDepotId`
- `DropOffLocationId`

So schedules already depend on territory/location data.

### 2) schedules also carry active zone rows
`ScheduleService.GetByClient(...)` loads `BulkZoneSchedule` rows into `ScheduleZones`.

`BulkZoneSchedule` has:
- `Id`
- `Zone`
- `ScheduleId`
- `Active`

So the schedule definition itself includes zone activation logic.

### 3) postcode groups are not just labels
`BulkZonePostcodeGroup` is linked to:
- `ClientId`
- `DepotId`
- `TblBulkRunSchedule`
- `ZoneZip`

So a postcode/zone group is part of the operational data model, not just UI grouping.

### 4) zone groups sit above zone names and zips
`ZoneName` links to:
- `ZoneGroupId`
- `LocationId`

`ZoneZip` links to:
- `ZoneNameId`
- `ZoneZipGroupId`

So the hierarchy is effectively:
- zone group
- zone name
- zip/zone row
- postcode/zone grouping relationships
- schedules referencing postcode groups and active schedule zones

That is why Kevin's move needs the territory dependency surface, not just the schedule screen.

---

## Legacy endpoints Kevin should mirror or replace cleanly

From `schedulesService.js` the important reads/writes are:

### schedules
- `GET API/Schedules/Defaults`
- `GET API/Schedules/Clients/{id}`
- `POST API/Schedules`
- `POST API/Schedules/{id}`
- `POST API/Schedules/AutoBookUpdate/{id}`
- `DELETE API/Schedules/{id}`

### schedule support data
- `GET API/Regions`
- `GET API/Speeds`
- `GET API/Schedules/DropOffLocations`
- `GET API/Schedules/Couriers`
- `GET API/LinehaulRuns`

### postcode / zone groups
- `GET API/BulkZonePostcodeGroups`
- `GET API/BulkZonePostcodeGroups/Clients/{id}`

### zone maintenance surface
- `GET API/Zones/Depots`
- `GET API/Zones/Depots/Clients/{id}`
- plus postcode/zone CRUD endpoints in `ZonesController`

Kevin does **not** need to preserve these route shapes exactly if Routed Operations uses cleaner endpoints.
But he **does** need parity for the same operational capability.

---

## React/UI work already available and should be reused

## In `scheduled-rate-builder`

### route mounts
- `wwwroot/app/react/App.tsx`
  - `/schedules` -> `SchedulesPrototypePage`
  - `/territory` -> `TerritoryPage`

### schedules prototype wrapper
- `wwwroot/app/react/prototypes/admin-schedules-module/SchedulesPrototypePage.tsx`

### vendored schedules prototype
- `wwwroot/app/react/prototypes/admin-schedules-module/src/modules/schedules/SchedulesPage.tsx`
- `wwwroot/app/react/prototypes/admin-schedules-module/src/modules/schedules/components/*`
- `wwwroot/app/react/prototypes/admin-schedules-module/src/features/import-export/*`

### local territory UI already built
- `wwwroot/app/react/modules/territory/TerritoryPage.tsx`
- `wwwroot/app/react/modules/territory/components/ZipZonesTab.tsx`
- `wwwroot/app/react/modules/territory/components/ZoneGroupsTab.tsx`
- `wwwroot/app/react/modules/territory/components/DepotsTab.tsx`
- `wwwroot/app/react/modules/territory/types.ts`
- `wwwroot/app/react/modules/territory/data/sampleData.ts`

### local schedules shell also exists
- `wwwroot/app/react/modules/schedules/SchedulesPage.tsx`
- `wwwroot/app/react/modules/schedules/components/OperatingScheduleSection.tsx`

## What this means
Kevin should **not** start from blank UI.

He already has:
1. a real schedules prototype mount
2. a real territory page with tabs for:
   - All Zip Zones
   - Zone Groups
   - Depots/Locations
3. schedule/group interaction patterns
4. connection-tag / cross-navigation ideas already expressed in React

---

## Routed Operations UI references to align with
In `routed-operations` there is already forward work around scheduled operations:
- `v2/frontend/src/pages/ScheduledRoutes.tsx`
- `v2/frontend/src/pages/PolygonBuilder.tsx`

These are not the same feature as the admin schedules/territory maintenance UI, but they matter because they show the Routed Operations destination context:
- Scheduled Routes operational board
- Polygon / coverage editing workflow

That makes the right split:
- **admin setup / recurring template / territory maintenance** from `scheduled-rate-builder`
- landing under **Routed Operations**
- while staying conceptually aligned with the existing Scheduled Routes and Polygon Builder work

---

## Scope Kevin should implement now

## Include
1. **Schedules surface**
   - list / search / edit schedule templates
   - schedule groups
   - client visibility / override concepts already present in the prototype
   - operating schedule / cutoff / speed / route-rule fields
   - linehaul-related schedule support where already part of the schedule model

2. **Territory surface required by schedules**
   - zip zones
   - zone groups
   - depots / drop-off locations / location support where needed for schedule maintenance
   - postcode-group selection support used by schedules

3. **Schedule-linked boundary**
   - keep as explicit handoff/integration boundary
   - do not recreate pricing maintenance inside schedules

4. **Adapter-based real data wiring**
   - map legacy DB/API shape into the React schedule + territory shapes
   - keep the mapping layer explicit

## Exclude for this Kevin brief
- client/customer modal migration
- broad pricing/rate-code migration
- dimensions / air freight / accessorial UI migration
- full Configurator IA work
- any forced rewrite of unrelated legacy pricing screens

---

## Non-negotiable implementation rules
1. **Do not treat this as Configurator work anymore.**
2. **Do not rebuild the schedules UI from scratch.** Reuse the existing mounted prototype and territory work.
3. **Do not pretend schedules can move without territory dependencies.**
4. **Do not drag the whole pricing migration into Routed Operations.** Keep the scope to schedules + zone groups + zip/zones dependency surface.
5. **Do not disturb legacy AngularJS schedules first.** Build the new surface in parallel, then prove parity.
6. **Do not wire prototype components directly to raw legacy shapes.** Add adapters.
7. **Do not collapse Schedule-linked into a second embedded maintenance UI.** Keep it as a clean boundary.

---

## Recommended implementation sequence

### Phase 1 — establish Routed Operations ownership
1. treat this doc as the new handover source of truth
2. keep `scheduled-rate-builder` as reference only
3. implement in `routed-operations`

### Phase 2 — port the React surface first
1. bring the schedules prototype surface into the Routed Operations frontend
2. bring the territory surface into the Routed Operations frontend
3. preserve the existing tab split:
   - Schedules
   - Schedule Groups
   - All Zip Zones
   - Zone Groups
   - Depots/Locations

### Phase 3 — wire read models
1. schedules list/detail reads
2. regions / speeds / couriers / linehaul runs
3. postcode group reads
4. zip/zone reads
5. depot/location reads

### Phase 4 — wire writes
1. create/update/delete schedules
2. auto-book toggle update
3. zone-group maintenance needed by the schedule flow
4. zip/zone maintenance needed by the territory flow

### Phase 5 — prove operational fit
1. confirm schedule records round-trip correctly from legacy data
2. confirm postcode-group-linked schedules behave correctly
3. confirm active schedule-zone rows are preserved
4. confirm territory edits support the schedule workflow cleanly
5. confirm the new Routed Operations surface can coexist with legacy until cutover

---

## Suggested backend shape
Kevin can modernise the API shape, but the service boundary needs to cover:
- schedules
- schedule groups if persisted separately / derived logically
- postcode groups
- zip zones
- zone groups
- depots / locations
- support lookups: regions, speeds, couriers, drop-off locations, linehaul runs

At minimum, preserve parity for these legacy concepts:
- `TblBulkRunSchedule`
- `BulkZoneSchedule`
- `BulkZonePostcodeGroup`
- `ZoneZip`
- `ZoneName`
- `ZoneGroup`

---

## Concrete files Kevin should read first

### legacy reference
- `gitlab-source/clientmanager/wwwroot/app/components/schedules/schedulesControl.js`
- `gitlab-source/clientmanager/wwwroot/app/services/schedulesService.js`
- `gitlab-source/clientmanager/Core/Application/Services/ScheduleService.cs`
- `gitlab-source/clientmanager/Core/Application/Services/BulkZonePostcodeGroupService.cs`
- `gitlab-source/clientmanager/Core/Domain/Despatch/TblBulkRunSchedule.cs`
- `gitlab-source/clientmanager/Core/Domain/Despatch/BulkZoneSchedule.cs`
- `gitlab-source/clientmanager/Core/Domain/Despatch/BulkZonePostcodeGroup.cs`
- `gitlab-source/clientmanager/Core/Domain/Despatch/ZoneZip.cs`
- `gitlab-source/clientmanager/Core/Domain/Despatch/ZoneName.cs`
- `gitlab-source/clientmanager/Core/Domain/Despatch/ZoneGroup.cs`

### React reference to reuse
- `scheduled-rate-builder/wwwroot/app/react/App.tsx`
- `scheduled-rate-builder/wwwroot/app/react/prototypes/admin-schedules-module/SchedulesPrototypePage.tsx`
- `scheduled-rate-builder/wwwroot/app/react/prototypes/admin-schedules-module/src/modules/schedules/SchedulesPage.tsx`
- `scheduled-rate-builder/wwwroot/app/react/modules/territory/TerritoryPage.tsx`
- `scheduled-rate-builder/wwwroot/app/react/modules/territory/components/ZipZonesTab.tsx`
- `scheduled-rate-builder/wwwroot/app/react/modules/territory/components/ZoneGroupsTab.tsx`
- `scheduled-rate-builder/wwwroot/app/react/modules/territory/components/DepotsTab.tsx`

### Routed Operations context
- `routed-operations/v2/frontend/src/pages/ScheduledRoutes.tsx`
- `routed-operations/v2/frontend/src/pages/PolygonBuilder.tsx`

---

## Bottom line for Steve
The honest split is:

> move **schedules + zone groups + zip/zones dependency surface** to Kevin under **Routed Operations**

not:

> move only the schedule page and leave its territory model behind

That narrower wording would hide a real dependency and will create churn later.

So yes — this work **does include zones and zone groups**, but only to the extent required to make the schedules/territory maintenance surface real inside Routed Operations.