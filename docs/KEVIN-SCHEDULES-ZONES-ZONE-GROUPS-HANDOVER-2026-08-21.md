# Kevin — Routed Operations schedules + zones/zone groups handover

## Decision
This work is no longer owned as Configurator work.

It now belongs under **Routed Operations**.

This document is the split-out Kevin brief from:
- `scheduled-rate-builder/docs/STEVE-KERRAN-CLIENT-MODAL-AND-RATES-MIGRATION-2026-07-02.md`

But only for the slice related to:
- schedules
- postcode groups
- NZ/non-US postcode territory maintenance
- US zip/zone territory maintenance
- the schedule-linked boundary

It does **not** carry over the broader client modal / pricing / rate-code migration work.

---

## Executive call

### Does this include moving zones and zone groups?
**Yes — but with an important distinction Kevin must preserve during the transition.**

A clean schedules-only move would be misleading.

In legacy ClientManager:
- schedules reference **postcode groups** directly
- schedules also carry **per-schedule active zone rows**
- **NZ / non-US territory** uses `BulkZonePostcode`
- **US territory** uses `ZoneName` + `ZoneZip`
- zone groups sit above the US zip/zone structure

So Kevin's scope should be framed as:

> **Schedules + postcode-group dependency surface + territory maintenance split by NZ/non-US vs US**

not just "schedules" in isolation, and not as if all territory maintenance is one US-style zip/zone model.

That does **not** mean Kevin has to bring all historical pricing/rating maintenance with it.
It means Routed Operations needs the territory primitives that schedules actually rely on, while preserving the distinction between the two underlying models.

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
- **Postcode Groups** = shared schedule dependency surface
- **Territory (NZ / non-US)** = `BulkZonePostcode` maintenance
- **Territory (US)** = `ZoneGroup` / `ZoneName` / `ZoneZip` maintenance
- **Schedule-linked** = handoff/integration boundary between territory/rating context and schedules

This should live in:
- repo: `routed-operations`
- docs: `routed-operations/docs/`

The old `scheduled-rate-builder` repo remains useful background, but the practical React source Kevin should lift from is the **Configurator UI code** that already carries the schedules/territory work.

So the instruction is:
- **migrate this slice into Routed Operations**
- **reuse the existing Configurator UI code**
- **do not recreate the UI from scratch**

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

So postcode groups are part of the operational model, not just UI grouping.

### 4) NZ / non-US and US use different territory tables
**NZ / non-US path**
- `BulkZonePostcode`
- fields include `PostCode`, `FromSiteId`, `DepotId`, `PostcodeGroupId`
- this is the non-US postcode-based territory model used by pricing/territory logic

**US path**
- `ZoneGroup`
- `ZoneName`
- `ZoneZip`
- `ZoneZip.ZoneZipGroupId` still links a zip row into a postcode group

### 5) PricingService already preserves this distinction
`PricingService` explicitly splits:
- **US path** -> `ZoneName` with `ZoneZip`
- **Non-US path** -> `BulkZonePostcode`

That is the distinction Kevin must preserve.

So Kevin's move needs the schedule dependency surface plus a territory implementation that understands:
- schedules depend on postcode groups in both cases
- NZ/non-US territory rows are **not** the same thing as US zip/zone rows

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
But he **does** need parity for the same operational capability, and that parity must preserve:
- **NZ/non-US:** `BulkZonePostcode`
- **US:** `ZoneName` / `ZoneZip`

---

## React/UI work already available and should be reused

## Primary source: `Kerran-Configurator`
These are the files Kevin should copy/lift from first.

### territory UI already built
- `Kerran-Configurator/wwwroot/app/react/modules/territory/TerritoryPage.tsx`
- `Kerran-Configurator/wwwroot/app/react/modules/territory/components/ZipZonesTab.tsx`
- `Kerran-Configurator/wwwroot/app/react/modules/territory/components/ZoneGroupsTab.tsx`
- `Kerran-Configurator/wwwroot/app/react/modules/territory/components/DepotsTab.tsx`

### schedules UI already built
- `Kerran-Configurator/wwwroot/app/react/modules/schedules/SchedulesPage.tsx`
- `Kerran-Configurator/wwwroot/app/react/modules/schedules/components/ScheduleTableView.tsx`
- `Kerran-Configurator/wwwroot/app/react/modules/schedules/components/ScheduleGroupsTab.tsx`
- `Kerran-Configurator/wwwroot/app/react/modules/schedules/components/ScheduleEditForm.tsx`
- `Kerran-Configurator/wwwroot/app/react/modules/schedules/components/OperatingScheduleSection.tsx`
- `Kerran-Configurator/wwwroot/app/react/modules/schedules/components/ZoneSelector.tsx`

## Secondary/background source: `scheduled-rate-builder`
Use this as background/reference only where helpful.

### route mounts / prototype lineage
- `scheduled-rate-builder/wwwroot/app/react/App.tsx`
  - `/schedules` -> `SchedulesPrototypePage`
  - `/territory` -> `TerritoryPage`
- `scheduled-rate-builder/wwwroot/app/react/prototypes/admin-schedules-module/SchedulesPrototypePage.tsx`
- `scheduled-rate-builder/wwwroot/app/react/prototypes/admin-schedules-module/src/modules/schedules/SchedulesPage.tsx`

## What this means
Kevin should **not** start from blank UI.

He already has reusable React UI in Configurator for:
1. schedules
2. schedule groups
3. territory maintenance screens
4. zone groups
5. depots / locations
6. schedule editing / zone selection patterns

So the job is to **migrate that UI into Routed Operations and wire it properly**, not recreate it.

Important: Kevin should treat that UI as a shared shell that must be wired to:
- **NZ/non-US postcode data** via `BulkZonePostcode`
- **US zip/zone data** via `ZoneName` / `ZoneZip`

He should not hard-wire the migrated UI to a US-only zip/zone assumption.

---

## Routed Operations UI references to align with
In `routed-operations` there is already forward work around scheduled operations:
- `v2/frontend/src/pages/ScheduledRoutes.tsx`
- `v2/frontend/src/pages/PolygonBuilder.tsx`

These are not the same feature as the admin schedules/territory maintenance UI, but they matter because they show the Routed Operations destination context:
- Scheduled Routes operational board
- Polygon / coverage editing workflow

That makes the right split:
- **admin setup / recurring template / territory maintenance** lifted from the existing **Configurator UI code**
- migrated into **Routed Operations**
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
   - postcode-group selection support used by schedules
   - NZ/non-US postcode maintenance via `BulkZonePostcode`
   - US zip/zone maintenance via `ZoneGroup` / `ZoneName` / `ZoneZip`
   - depots / drop-off locations / location support where needed for schedule maintenance

3. **Schedule-linked boundary**
   - keep as explicit handoff/integration boundary
   - do not recreate pricing maintenance inside schedules

4. **Adapter-based real data wiring**
   - map legacy DB/API shape into the React schedule + territory shapes
   - keep the mapping layer explicit
   - preserve separate adapters / mapping rules for:
     - NZ/non-US `BulkZonePostcode`
     - US `ZoneName` / `ZoneZip`

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
4. **Do not drag the whole pricing migration into Routed Operations.** Keep the scope to schedules + postcode groups + the required NZ/non-US and US territory dependency surface.
5. **Do not disturb legacy AngularJS schedules first.** Build the new surface in parallel, then prove parity.
6. **Do not wire prototype components directly to raw legacy shapes.** Add adapters.
7. **Do not collapse Schedule-linked into a second embedded maintenance UI.** Keep it as a clean boundary.

---

## Recommended implementation sequence

### Phase 1 — establish Routed Operations ownership
1. treat this doc as the new handover source of truth
2. keep `scheduled-rate-builder` as reference only
3. implement in `routed-operations`

### Phase 2 — port the existing React surface first
1. copy/lift the schedules UI from `Kerran-Configurator` into the Routed Operations frontend
2. copy/lift the territory UI from `Kerran-Configurator` into the Routed Operations frontend
3. preserve the existing tab split:
   - Schedules
   - Schedule Groups
   - All Zip Zones
   - Zone Groups
   - Depots/Locations
4. do not spend time redesigning or recreating the UI unless wiring constraints force a small adjustment

### Phase 3 — wire read models
1. schedules list/detail reads
2. regions / speeds / couriers / linehaul runs
3. postcode group reads
4. NZ/non-US territory reads via `BulkZonePostcode`
5. US territory reads via `ZoneName` / `ZoneZip`
6. depot/location reads

### Phase 4 — wire writes
1. create/update/delete schedules
2. auto-book toggle update
3. postcode-group maintenance needed by the schedule flow
4. NZ/non-US postcode maintenance needed by the territory flow
5. US zip/zone maintenance needed by the territory flow

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
- NZ/non-US postcode territory rows
- US zone/zip territory rows
- depots / locations
- support lookups: regions, speeds, couriers, drop-off locations, linehaul runs

At minimum, preserve parity for these legacy concepts:
- `TblBulkRunSchedule`
- `BulkZoneSchedule`
- `BulkZonePostcodeGroup`
- `BulkZonePostcode`
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
- `gitlab-source/clientmanager/Core/Domain/Despatch/BulkZonePostcode.cs`
- `gitlab-source/clientmanager/Core/Domain/Despatch/ZoneZip.cs`
- `gitlab-source/clientmanager/Core/Domain/Despatch/ZoneName.cs`
- `gitlab-source/clientmanager/Core/Domain/Despatch/ZoneGroup.cs`
- `gitlab-source/clientmanager/Core/Application/Services/PricingService.cs`

### React reference to reuse
- `Kerran-Configurator/wwwroot/app/react/modules/schedules/SchedulesPage.tsx`
- `Kerran-Configurator/wwwroot/app/react/modules/schedules/components/ScheduleTableView.tsx`
- `Kerran-Configurator/wwwroot/app/react/modules/schedules/components/ScheduleGroupsTab.tsx`
- `Kerran-Configurator/wwwroot/app/react/modules/schedules/components/ScheduleEditForm.tsx`
- `Kerran-Configurator/wwwroot/app/react/modules/schedules/components/ZoneSelector.tsx`
- `Kerran-Configurator/wwwroot/app/react/modules/territory/TerritoryPage.tsx`
- `Kerran-Configurator/wwwroot/app/react/modules/territory/components/ZipZonesTab.tsx`
- `Kerran-Configurator/wwwroot/app/react/modules/territory/components/ZoneGroupsTab.tsx`
- `Kerran-Configurator/wwwroot/app/react/modules/territory/components/DepotsTab.tsx`

### Routed Operations context
- `routed-operations/v2/frontend/src/pages/ScheduledRoutes.tsx`
- `routed-operations/v2/frontend/src/pages/PolygonBuilder.tsx`

---

## Bottom line for Steve
The honest split is:

> migrate **schedules + postcode-group dependency surface** into **Routed Operations**, have Kevin **reuse the existing Configurator UI code**, and preserve the territory split between **NZ/non-US `BulkZonePostcode`** and **US `ZoneName` / `ZoneZip`**

not:

> move only the schedule page and leave its territory model behind

and not:

> treat all territory maintenance as one US-style zip/zone model

and not:

> ask Kevin to redesign or recreate the UI from scratch

That narrower wording would hide a real dependency and create churn later.

So yes — this work still includes the territory pieces schedules rely on, but Kevin needs to maintain the distinction between:
- **NZ/non-US postcode territory maintenance**
- **US zip/zone territory maintenance**

while lifting the existing Configurator schedules/territory UI into Routed Operations and wiring it to the real legacy-backed data model.
