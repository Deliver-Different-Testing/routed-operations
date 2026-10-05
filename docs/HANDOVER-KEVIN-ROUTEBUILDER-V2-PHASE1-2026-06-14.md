# HANDOVER — RouteBuilder v2 Phase 1 (Kevin)

**Author:** Steve
**Date:** 14 June 2026
**Owner:** Kevin
**Repo:** [`Deliver-Different-Testing/runbuilder`](https://github.com/Deliver-Different-Testing/runbuilder) (this repo)
**Frozen demo:** https://deliver-different-testing.github.io/runbuilder/demo/ — clickable mockup, never touched after handover so you have a behavioural reference
**Live (current build):** https://deliver-different-testing.github.io/runbuilder/

---

## 0. Claude Code Steps (run these first)

```bash
git fetch --tags
git checkout master
git pull

# 1. Verify the scaffold is here
ls -la v2/backend
ls -la v2/frontend
ls -la v2/backend/Migrations

# 2. Restore + build the backend (.NET 9 SDK required)
cd v2/backend
dotnet restore
dotnet build

# 3. Pull deps + build the frontend
cd ../frontend
NODE_ENV=development npm install
npm run build

# 4. Run the 3 SQL migrations against staging in order (manual until EF Core migrations are switched on)
#    See §6 Database Tables for what each does.
sqlcmd -S DESPATCH_HOST -d Despatch_PERTENANT -i v2/backend/Migrations/20260614_001_AddIsPickupAndCoordsToJobTables.sql
sqlcmd -S DESPATCH_HOST -d Despatch_PERTENANT -i v2/backend/Migrations/20260614_002_AddPolygonAndRecurringRouteTables.sql
sqlcmd -S DESPATCH_HOST -d Despatch_PERTENANT -i v2/backend/Migrations/20260614_003_AddQuoteTables.sql

# 5. Configure connection + JWT secret then run
cd ../backend
dotnet user-secrets set "ConnectionStrings:Despatch" "Server=tcp:STAGING_SQL,1433;Database=Despatch_PERTENANT;User Id=routebuilder;Password=...;TrustServerCertificate=true"
dotnet user-secrets set "Jwt:Key" "$(openssl rand -base64 64)"
dotnet run

# 6. SPA dev server (separate terminal)
cd ../frontend
npm run dev   # http://localhost:4595
```

---

## Table of Contents

1. [Feature Overview](#1-feature-overview)
2. [Architecture: built vs your work](#2-architecture-built-vs-your-work)
3. [Project layout](#3-project-layout)
4. [Step-by-step checklist for Kevin](#4-step-by-step-checklist-for-kevin)
5. [Decisions from the scoping doc](#5-decisions-from-the-scoping-doc)
6. [Database tables](#6-database-tables)
7. [API endpoints summary](#7-api-endpoints-summary)
8. [Frontend components](#8-frontend-components)
9. [Key questions answered](#9-key-questions-answered)
10. [Testing checklist](#10-testing-checklist)
11. [Known TODOs](#11-known-todos)

---

## 1. Feature Overview

RouteBuilder v2 is the React 19 + .NET 9 rebuild of the legacy RunBuilder. Phase 1 covers:

- **Routes cockpit** — 4-column despatchweb-style cockpit; unified Grouped Jobs (by ready time) + Jobs List + Detail + Run List + Run + Fleets + Couriers + Map. Pickups auto-match to runs by zip; unmatched ones render grey and can be right-clicked to assign.
- **Scheduled Routes** — recurring routes with zip polygons; selecting a route highlights its zone on the map + filters Jobs List. Same cockpit shape; Scheduled Routes panel replaces Run List.
- **Polygon Builder** — draw zones on Leaflet, snap-to-vertex/edge for shared borders, drag-edit vertices, click + midpoints to add new vertices, save as a scheduled route tagged to a depot/customer.
- **Quoting** — upload a CSV → engine simulates runs over a shadow `tblQuoteJob` table → recommended quote + driver count + margin.
- **Settings drawer** — vehicle / package size / time window / max-jobs / max-km persists per tenant in `tblBulkRunSetting`.
- **Right-side panel-move handle** — ⠿ icon lets dispatchers shuffle panels across columns (visual + slot state shipped; full content swap still pending — see §11).

---

## 2. Architecture: Built vs Your Work

### ✅ Already built (scaffolded in this commit)

| File | Status |
|---|---|
| `v2/backend/RouteBuilder.csproj` | .NET 9 web project, EF Core 9, cookie+JWT auth, Serilog, healthchecks |
| `v2/backend/Program.cs` | Smart auth scheme (cookie OR JWT), 5 feature-matrix policies, DI for all services, SPA fallback to React |
| `v2/backend/appsettings.json` | Connection string + Serilog config skeleton — set secrets via `dotnet user-secrets` |
| `v2/backend/Data/RouteBuilderDbContext.cs` | EF Core DbContext mapped to existing + new tables |
| `v2/backend/Entities/*.cs` | Entity definitions for all 8 existing + 6 new tables |
| `v2/backend/Dtos/*.cs` | DTOs for Jobs / Runs / Polygons / Scheduled Routes / Fleets / Quotes |
| `v2/backend/Services/*.cs` | Application-layer services (no SPs per Q4): `JobService` (fully implemented), `RunService` / `PolygonService` / `ScheduledRouteService` / `QuoteService` / `FleetService` (partial — see §11) |
| `v2/backend/Controllers/*.cs` | All 6 controllers (Jobs, Runs, Polygons, ScheduledRoutes, Fleets, Quote) gated by feature-matrix policies |
| `v2/backend/Migrations/20260614_00{1,2,3}_*.sql` | Idempotent SQL migrations — `IF NOT EXISTS` guards |
| `v2/frontend/src/lib/api.ts` | Typed API client (fetch wrappers, DTO↔Job mapping) |
| `v2/frontend/src/pages/RoutesPage.tsx` | Wired to live API, falls back to mock on error — **pattern to copy** for other pages |

### 🔧 What you need to do (priority order)

| # | Task | Hours | Priority |
|---|---|---|---|
| 1 | Stand up the backend locally (run §0 steps) | 1 | P0 |
| 2 | Run the 3 SQL migrations on staging Despatch DB | 0.5 | P0 |
| 3 | Wire `dotnet user-secrets` for connection + JWT key | 0.5 | P0 |
| 4 | Verify `GET /api/jobs?date=...` returns merged rows from `tblBulkJob` ∪ `tucJob` ∪ `tucJobBooking` | 1 | P0 |
| 5 | Implement `RunService.AssignPickupToRunAsync` (currently a TODO stub) — pick (a) or (b) from the comment in `RunService.cs:84` | 4 | P1 |
| 6 | Implement `RunService.AutoMatchPickupsByZipAsync` once #5 is done | 2 | P1 |
| 7 | Implement `ScheduledRouteService.BuildNowAsync` — call `IJobService.GetCandidateJobsAsync` filtered by zips, then `IRunService.CreateRunAsync` | 3 | P1 |
| 8 | Wire the remaining frontend pages (Quoting, ScheduledRoutes, PolygonBuilder) to `/api/*` using the same pattern as `RoutesPage.tsx` | 6 | P1 |
| 9 | Add a real route-build engine (currently `QuoteService.SimulateAsync` returns calibration values) — see `QuoteService.cs:32` | 8 | P2 |
| 10 | Add geocoding hooks (lat/lng on jobs is `NULL` until something fills it — HERE/Google batch lookups) | 4 | P2 |
| 11 | Wire HERE Map tile layer instead of OSM (config in `vite.config.ts` or runtime config) | 2 | P3 |
| 12 | Finish the panel-move structural refactor — slot state is wired but layout JSX is still hardcoded (see §11) | 6 | P3 |

---

## 3. Project layout

```
runbuilder/                           ← this repo
├── docs/
│   └── HANDOVER-KEVIN-ROUTEBUILDER-V2-PHASE1-2026-06-14.md   ← you are here
├── v2/
│   ├── backend/                      ← .NET 9 web app
│   │   ├── RouteBuilder.csproj
│   │   ├── Program.cs
│   │   ├── appsettings.json
│   │   ├── Controllers/              ← 6 controllers
│   │   ├── Data/RouteBuilderDbContext.cs
│   │   ├── Dtos/                     ← DTOs by feature
│   │   ├── Entities/                 ← EF entities (existing + new tables)
│   │   ├── Migrations/               ← 3 SQL migration scripts (run manually)
│   │   └── Services/                 ← Application layer (no SPs per Q4)
│   └── frontend/                     ← React 19 + Vite + Tailwind
│       ├── src/
│       │   ├── lib/
│       │   │   ├── api.ts            ← typed fetch wrappers
│       │   │   └── mockData.ts       ← fallback data (still used as fallback in Routes page)
│       │   ├── pages/
│       │   │   ├── RoutesPage.tsx    ← wired to API (sample for Kevin to copy)
│       │   │   ├── Quoting.tsx       ← TODO: wire to /api/quote/*
│       │   │   ├── ScheduledRoutes.tsx ← TODO: wire to /api/scheduled-routes
│       │   │   ├── PolygonBuilder.tsx ← TODO: wire to /api/polygons
│       │   │   └── Dashboard.tsx
│       │   └── components/CockpitPage.tsx   ← cockpit (no API knowledge — fed by pages)
│       └── package.json
├── docs/STEVE-RUNBUILDER-V2-SCOPING-2026-06-13.md   ← Phase 0 scoping doc (decisions)
└── (legacy RunBuilder code at repo root — left untouched, deploys from GitLab unchanged)
```

**Source of truth:** GitLab — clone this work back into a `v2` branch on GitLab as you go (per scoping doc Q2). GitHub is dev convenience for PR review.

---

## 4. Step-by-step checklist for Kevin

### 4.1 Stand up the backend

1. Install .NET 9 SDK locally (`brew install --cask dotnet-sdk` or the Windows installer).
2. From `v2/backend`, run `dotnet restore` then `dotnet build`. Should compile with 0 errors.
3. Run the migrations (§6) against your staging Despatch DB.
4. Set secrets:
   ```bash
   dotnet user-secrets init
   dotnet user-secrets set "ConnectionStrings:Despatch" "Server=...;Database=Despatch_PERTENANT;...;TrustServerCertificate=true"
   dotnet user-secrets set "Jwt:Key" "$(openssl rand -base64 64)"
   ```
5. `dotnet run`. Should bind to `http://localhost:5000` and `/health` returns 200.

### 4.2 Smoke test the API

```bash
# Auth: in Phase 1, the cookie comes from Hub. For local testing,
#   either set a dev policy that allows anonymous, OR provide a Bearer token issued by Hub.
# Anonymous is fine for the initial smoke test — comment out [Authorize] on JobsController only.

curl 'http://localhost:5000/api/jobs?date=2026-06-15' | jq length
curl 'http://localhost:5000/api/runs?date=2026-06-15'
curl 'http://localhost:5000/api/fleets'
curl 'http://localhost:5000/api/scheduled-routes'
curl 'http://localhost:5000/api/polygons'
```

### 4.3 Wire the SPA

1. `cd v2/frontend && npm install && npm run dev`. Dev server on `http://localhost:4595`.
2. `RoutesPage.tsx` already fetches from `/api/*`. Add a Vite proxy in `vite.config.ts` so `/api` hits your local backend during dev:
   ```ts
   server: {
     port: 4595, host: '0.0.0.0',
     proxy: { '/api': 'http://localhost:5000' },
   },
   ```
3. Hit `/runs` — if the backend has data, the cockpit renders live data; otherwise the amber bar appears and the mockup data still shows.

### 4.4 Replicate the wired pattern on the other pages

Copy the pattern in `RoutesPage.tsx` to:
- `Quoting.tsx` — upload to `POST /api/quote/upload`, simulate via `POST /api/quote/simulate`
- `ScheduledRoutes.tsx` — list via `GET /api/scheduled-routes`, build via `POST /api/scheduled-routes/{id}/build-now`
- `PolygonBuilder.tsx` — load via `GET /api/polygons`, create via `POST`, update via `PUT`, delete via `DELETE`, save-as-route via `POST .../save-as-scheduled-route`

The pattern is:
```tsx
const [data, setData] = useState(MOCK);
const [live, setLive] = useState(false);
const [error, setError] = useState<string | null>(null);
useEffect(() => {
  (async () => {
    try { const x = await fetchX(); setData(x); setLive(true); }
    catch (e) { setError(String(e)); }
  })();
}, []);
```

### 4.5 Cutover plan

- DF Admin owns the cutover per tenant (scoping doc Q9).
- Deploy v2 backend behind a separate URL during testing.
- Once a tenant is signed off, redirect their legacy RunBuilder URL to the v2 deployment.

---

## 5. Decisions from the scoping doc

For the full list see [`STEVE-RUNBUILDER-V2-SCOPING-2026-06-13.md`](./STEVE-RUNBUILDER-V2-SCOPING-2026-06-13.md). Recap:

| # | Topic | Decision |
|---|---|---|
| Q1 | Repo layout | `/v2/` for new; legacy stays at repo root |
| Q2 | Source of truth | **GitLab** — clone back into `v2` branch on GitLab as you go |
| Q3 | .NET version | **.NET 9 (LTS)** |
| Q4 | Backend approach | **Move away from SP-heavy code**. EF + application-layer services for ALL new work |
| Q5 | Frontend | DFRNT design + LH side menu, configurator pattern (`wwwroot/app/react/`) |
| Q6 | Data model | Reuse existing tables; **also surface `tucJob` + `tucJobBooking`** alongside `tblBulk*` |
| Q7 | Auth / access | **Feature-matrix-driven** — every endpoint gated on a Feature claim from Hub |
| Q8 | Mobile | Desktop-first; mobile-friendly is a bonus |
| Q9 | Cutover | DF Admin owns it per tenant |
| Q10 | Tenants | **Single tenant per deployment** — DB-swap pattern stays |

---

## 6. Database tables

### Existing tables (read-only in Phase 1, columns added per migration 001)

| Table | Used for | Columns added by migration |
|---|---|---|
| `tblBulkJob` | Bulk-imported jobs | `IsPickup BIT NULL`, `FromLat/Lng FLOAT NULL`, `ToLat/Lng FLOAT NULL` |
| `tblBulkRun` | Runs | `RecurringRouteId INT NULL`, `IsPickupRun BIT NULL` (+ FK to `tblRecurringRoute`) |
| `tblBulkJobRun` | Run ↔ Job join | (no changes) |
| `tblBulkRunSetting` | Per-tenant build settings | `VehicleType, AveragePackageSizeM3, TimeWindowMinutes, MaxJobsPerRoute, MaxKmPerRoute, ReturnToDepot, RespectColdChain, OptimiseStopOrder, TightPack, IncludePickupLeg, LastModified` |
| `tucJob` | Live jobs | `UcjbIsPickup BIT NULL`, `UcjbFromLat/Lng FLOAT NULL`, `UcjbToLat/Lng FLOAT NULL`, `UcjbFromPostCode/UcjbToPostCode INT NULL` |
| `tucJobBooking` | Booking-side jobs | `UcbkIsPickup BIT NULL`, `UcbkFromLat/Lng FLOAT NULL`, `UcbkToLat/Lng FLOAT NULL`, `UcbkFromPostCode/UcbkToPostCode INT NULL` |
| `tucFleet` | Courier fleets | (no changes) |
| `tucCourier` | Couriers | (no changes) |

### New v2 tables (created by migrations 002 + 003)

| Table | Purpose | Key columns | Indexes / FKs |
|---|---|---|---|
| `tblRecurringRoute` | Scheduled / recurring routes | `Name`, `Frequency`, `TimeWindowStart/End`, `AvgJobs`, `ServiceLevel`, `TagLocation`, `ColorHex`, `IsActive`, `LastBuiltUtc` | `IX_IsActive` |
| `tblRecurringRouteZip` | Zips covered by a route | `RecurringRouteId`, `ZipCode` | FK → `tblRecurringRoute` (CASCADE), UQ on (RouteId, ZipCode) |
| `tblBulkRunPolygon` | User-drawn polygons | `Name`, `ColorHex`, `RecurringRouteId` (nullable — set when saved as route), `TagLocation`, `CreatedUtc`, `LastModifiedUtc` | FK → `tblRecurringRoute` (SET NULL), IX on Name + RecurringRouteId |
| `tblBulkRunPolygonPoint` | Polygon corner points | `PolygonId`, `OrderIndex`, `Lat`, `Lng` | FK → `tblBulkRunPolygon` (CASCADE), IX on (PolygonId, OrderIndex) |
| `tblQuoteRun` | Simulated quote run | `QuoteSetCode`, `Name`, `JobCount`, `EstimatedMins`, `EstimatedKm`, `ProjectedRevenue/Cost`, `RecommendedQuote`, `DriversRequired`, `CreatedUtc` | IX on QuoteSetCode |
| `tblQuoteJob` | Uploaded quote-input rows (shadow) | `QuoteSetCode`, `QuoteRunId`, `Customer`, `From/ToAddress`, `From/ToPostCode`, `WeightKg`, `WindowStart/End`, `IsPickup`, `CreatedUtc` | FK → `tblQuoteRun` (CASCADE), IX on QuoteRunId, IX on (SetCode, FromPostCode) |

### Migrations to run (in order)

1. `Migrations/20260614_001_AddIsPickupAndCoordsToJobTables.sql`
2. `Migrations/20260614_002_AddPolygonAndRecurringRouteTables.sql`
3. `Migrations/20260614_003_AddQuoteTables.sql`

All three are idempotent (`IF COL_LENGTH(...) IS NULL` / `IF OBJECT_ID(...) IS NULL` guards) — safe to re-run.

---

## 7. API endpoints summary

All endpoints under `/api/*`. Authentication is Hub cookie OR Bearer JWT (Smart scheme — see `Program.cs:32`). Each endpoint is gated by a feature-matrix policy (see `Program.cs:73`).

| Method | Route | Policy | Purpose | Tables read | Tables written |
|---|---|---|---|---|---|
| GET | `/api/jobs?date=...&sources=...&pickupsOnly=...&zipCodes=...&search=...` | `RouteBuilder.Read` | Merged candidate jobs | tblBulkJob, tucJob, tucJobBooking | — |
| GET | `/api/jobs/{source}/{id}` | `RouteBuilder.Read` | Single job detail | one of the three | — |
| GET | `/api/jobs/groups?date=...&pickupsOnly=...` | `RouteBuilder.Read` | Grouped Jobs by ready time | merged | — |
| GET | `/api/runs?date=...` | `RouteBuilder.Read` | Run List | tblBulkRun, tucCourier | — |
| GET | `/api/runs/{id}` | `RouteBuilder.Read` | Run detail + stops + financial header | tblBulkRun, tblBulkJobRun, tblBulkJob, tucCourier | — |
| POST | `/api/runs` | `RouteBuilder.Build` | Create new run | tblBulkJob | tblBulkRun, tblBulkJobRun |
| POST | `/api/runs/{id}/assign-courier` | `RouteBuilder.Build` | Set courier | — | tblBulkRun |
| POST | `/api/runs/assign-pickup` | `RouteBuilder.Build` | Attach pickup to a run | — | (TODO Kevin — see #5) |
| POST | `/api/runs/auto-match-pickups?date=...` | `RouteBuilder.Build` | Auto-match all today's pickups by zip | — | (TODO Kevin) |
| GET | `/api/fleets` | `RouteBuilder.Read` | Fleet list | tucFleet | — |
| GET | `/api/fleets/{id}/couriers` | `RouteBuilder.Read` | Couriers in fleet | tucCourier | — |
| GET | `/api/scheduled-routes?activeOnly=true` | `RouteBuilder.Read` | All scheduled routes + zips | tblRecurringRoute, tblRecurringRouteZip | — |
| GET | `/api/scheduled-routes/{id}` | `RouteBuilder.Read` | Single route | same | — |
| POST | `/api/scheduled-routes` | `RouteBuilder.Admin` | Create new route | — | tblRecurringRoute, tblRecurringRouteZip |
| POST | `/api/scheduled-routes/{id}/build-now` | `RouteBuilder.Build` | Trigger build for a route | merged + scheduled route | tblBulkRun + tblBulkJobRun (via RunService) |
| GET | `/api/polygons` | `RouteBuilder.Polygon` | All polygons + points | tblBulkRunPolygon, tblBulkRunPolygonPoint | — |
| GET | `/api/polygons/{id}` | `RouteBuilder.Polygon` | Single polygon | same | — |
| POST | `/api/polygons` | `RouteBuilder.Polygon` | Save drawn polygon | — | tblBulkRunPolygon, tblBulkRunPolygonPoint |
| PUT | `/api/polygons/{id}` | `RouteBuilder.Polygon` | Update polygon (Name/Color/Points) | — | tblBulkRunPolygon, tblBulkRunPolygonPoint |
| DELETE | `/api/polygons/{id}` | `RouteBuilder.Polygon` | Delete polygon | — | tblBulkRunPolygon (cascade points) |
| POST | `/api/polygons/{id}/save-as-scheduled-route` | `RouteBuilder.Polygon` | Promote polygon → scheduled route | — | tblRecurringRoute, tblRecurringRouteZip, tblBulkRunPolygon |
| POST | `/api/quote/upload` | `RouteBuilder.Quote` | Upload quote dataset (CSV rows) | — | tblQuoteJob |
| POST | `/api/quote/simulate` | `RouteBuilder.Quote` | Simulate route-build | tblQuoteJob | (TODO Kevin: persist to tblQuoteRun) |

---

## 8. Frontend components

The cockpit (`CockpitPage.tsx`) is feature-agnostic. Each page (RoutesPage, Quoting, ScheduledRoutes) hands it data + config. To wire a page, replicate the pattern from `RoutesPage.tsx`:

```
src/pages/
├── Dashboard.tsx           ← static for now
├── RoutesPage.tsx          ✅ wired
├── Quoting.tsx             🔧 wire to /api/quote/*
├── ScheduledRoutes.tsx     🔧 wire to /api/scheduled-routes
└── PolygonBuilder.tsx      🔧 wire to /api/polygons

src/components/
├── CockpitPage.tsx         ← shared 4-column cockpit + grid + map
├── HereMap.tsx             ← Leaflet wrapper; supports polygons + colored markers
├── JobDetailModal.tsx      ← rich job-detail panel (matches despatchweb)
├── SettingsDrawer.tsx      ← right-side build-settings drawer
├── EditRunScopeModal.tsx   ← scope-picker modal (client/region/speed/date)
├── ContextMenu.tsx         ← right-click context menu
└── Panel.tsx               ← shared rounded-corner panel
```

---

## 9. Key questions answered

> **Can I reuse the legacy RunBuilder code at the repo root?**

No — the legacy `Models/`, `Controllers/`, `Views/` at the repo root stay frozen and continue to deploy from GitLab. v2 is a clean rewrite under `/v2/`. Legacy retires per tenant once v2 reaches parity (per scoping doc phasing).

> **What about stored procedures?**

Avoid all SPs in v2 — see Q4. All data access lives in `Services/*.cs` via EF Core. This is one of the explicit reasons for the rebuild. If you find existing logic in SPs, port to a service method.

> **How do I add a new endpoint?**

1. Add the DTO in `Dtos/...`.
2. Add the method to the relevant `IXxxService` + implementation.
3. Add the controller action with the appropriate `[Authorize(Policy = "...")]`.
4. Add the typed wrapper to `src/lib/api.ts`.
5. Call it from the page component.

> **Where do polygons live?**

`tblBulkRunPolygon` (header) + `tblBulkRunPolygonPoint` (corners, ordered). When a polygon is saved as a scheduled route, the `RecurringRouteId` FK is set and the points become the geo-gate for that route.

> **How do pickups attach to runs?**

Auto-match by zip — `tucJob.UcjbToPostCode` / `tucJobBooking.UcbkToPostCode` matches the zip set on `tblRecurringRoute` (via `tblRecurringRouteZip`). Manual override via the right-click menu. **The data-model side of this is TODO** (see §11) — design with me.

> **Where do I configure the Settings drawer values?**

`tblBulkRunSetting` — one row per tenant (single-tenant deployment). The drawer's Save button hits `PUT /api/settings` (controller still to add — see §11 #14).

---

## 10. Testing checklist

### Staging first

- [ ] Migrations 1-3 run cleanly on a staging copy of a tenant Despatch DB
- [ ] `dotnet run` boots; `/health` returns 200; `/api/jobs?date=today` returns merged rows
- [ ] At least one tenant's `tblBulkJob` row has `IsPickup` set; it returns with `isPickup: true` from the API
- [ ] Polygon CRUD: create → list → update → delete cycle works
- [ ] Save polygon as scheduled route → `tblRecurringRoute` + `tblRecurringRouteZip` populated; `RecurringRouteId` written back to `tblBulkRunPolygon`
- [ ] Run creation: POST `/api/runs` creates `tblBulkRun` + `tblBulkJobRun` rows with correct StopOrder
- [ ] Frontend `RoutesPage` loads, amber bar appears if API down, real data when API up

### Production rollout

- [ ] First tenant signed off by DF Admin
- [ ] Migration ran on production Despatch DB
- [ ] v2 reachable at the agreed URL
- [ ] Smoke test the cockpit, polygon draw + save as scheduled route, run creation
- [ ] Two-week soak with legacy still as the daily driver
- [ ] DF Admin flips the cutover for that tenant

---

## 11. Known TODOs (sorted by where they live)

| # | File / Service | TODO | Owner |
|---|---|---|---|
| 1 | `Services/RunService.cs` `AssignPickupToRunAsync` | Implement tucJob/tucJobBooking → run linkage. Two design options in the comment. | Kevin (pick + implement) |
| 2 | `Services/RunService.cs` `AutoMatchPickupsByZipAsync` | Iterate today's pickups, match to runs by zip. Depends on #1. | Kevin |
| 3 | `Services/ScheduledRouteService.cs` `BuildNowAsync` | Call `IJobService.GetCandidateJobsAsync` then `IRunService.CreateRunAsync`. | Kevin |
| 4 | `Services/QuoteService.cs` `SimulateAsync` | Replace calibration values with real engine output (HERE distance API + rate card). | Kevin (P2) |
| 5 | `Controllers/SettingsController.cs` | **File not yet created** — PUT/GET endpoints for `tblBulkRunSetting`. | Kevin (P1) |
| 6 | `frontend/src/pages/Quoting.tsx` | Wire upload + simulate to `/api/quote/*`. | Kevin |
| 7 | `frontend/src/pages/ScheduledRoutes.tsx` | Wire list + build-now to `/api/scheduled-routes`. | Kevin |
| 8 | `frontend/src/pages/PolygonBuilder.tsx` | Wire CRUD to `/api/polygons`. | Kevin |
| 9 | `frontend/src/components/CockpitPage.tsx` (panel-move) | Slot state ships; layout JSX is still hardcoded. Extract each Panel's JSX into a `panelMap` keyed by panel ID, then render columns via `slots[N]`. ~250 lines refactor. | Kevin (P3) |
| 10 | Geocoding pipeline | New lat/lng columns are nullable. Need a background job (HERE/Google batch) to fill them on insert. | Kevin (P2) |
| 11 | HERE Maps integration | Currently OSM tiles in Leaflet. Switch to HERE base map per scoping (config-driven). | Kevin (P3) |
| 12 | CSRF + cookie security | Cookie auth uses `.AspNet.SharedCookie` shared with Hub. Verify SameSite + Secure flags against staging Hub. | Kevin (P0 before any production tenant) |

---

## 12. References

- **Scoping doc (Phase 0):** [`docs/STEVE-RUNBUILDER-V2-SCOPING-2026-06-13.md`](./STEVE-RUNBUILDER-V2-SCOPING-2026-06-13.md)
- **Frozen demo (clickable mockup):** https://deliver-different-testing.github.io/runbuilder/demo/
- **Live current build:** https://deliver-different-testing.github.io/runbuilder/
- **Legacy code (this repo, master root):** `RunBuilder.csproj`, `Models/`, `Controllers/`, `Views/`
- **Despatchweb design reference (cockpit shape):** screenshots Steve shared 2026-06-14
- **Courier portal Phase 1 (auth pattern this mirrors):** [`dfrntdrive_configurator/docs/STEVE-COURIER-PORTAL-PHASE1-SMS-AUTH-SHELL-2026-06-13.md`](https://github.com/Deliver-Different-Testing/dfrntdrive_configurator/blob/master/docs/STEVE-COURIER-PORTAL-PHASE1-SMS-AUTH-SHELL-2026-06-13.md)
