# CLAUDE.md - Routed Operations

## Product context

Routed Operations is the umbrella product replacing the legacy RunBuilder AngularJS + .NET MVC app. Stage 1 (Route Builder) aims for feature parity with the legacy cockpit; later modules (Quoting, Scheduled Routes, Polygon Builder, Dynamic mode) are scaffolded but not built out yet.

Reference implementation for the stack + conventions: `C:\Gitlab\Configurator_Root\Configurator`. Legacy source for feature parity: `C:\Gitlab\RunBuilder_Root`.

**Session handover docs** (start here when resuming, latest first):

1. `C:\Gitlab\.claude\sp-reference\routed-operations-handover-2026-07-16.md` - Day 3: feature-parity gap fill (map right-click, JobDetail editing, Fix GPS, multibox expansion, sort/filter, group bulk-move, send-selected, layout save/load). Also carries the explicitly-not-migrated list (prebook + filter-by-time - do not re-add).
2. `C:\Gitlab\.claude\sp-reference\routed-operations-handover-2026-07-14.md` - Day 1: scaffolding + auth + cockpit + HERE Maps + Delivery Window feature. Original 9 cross-tenant gotchas glossary still lives here.

## Backend stack

- .NET 10, ASP.NET Core minimal hosting.
- EF Core 10 for read-side queries and CRUD.
- Dapper for wrapping high-risk stored procedures (`RunCommitService`, `HdJobSyncService`) that are too dangerous to rewrite in this pass.
- Serilog console sink, structured logging.
- Multi-tenant via `DynamicDespatchDbContextFactory` reading `CurrentTenantID` from the Hub-issued shared cookie.
- Redis distributed cache for connection strings + sessions.
- Health checks: `/health/live` (liveness, no checks) + `/healthz` (SqlServer).

## Frontend stack

- React 18 + TypeScript 5.7 + Vite 6.
- Tailwind CSS 3.4 with DFRNT brand palette.
- React Router 6.
- Fetch wrapper (`services/api.ts`) + Context API for global state.
- HERE Maps JS SDK loaded from CDN in the Razor host view.

## Rules for Claude

1. Do NOT rewrite `UTL_stpJob_InsertFromRunBuilder` / `UTL_stpJob_InsertFromTblBulkJob` in this project. Wrap them via Dapper. The lift lives in a later phase per `STEVE-ROUTEBUILDER-V2-PARITY-LIFT-PLAN-KEVIN-2026-06-20.md`.
2. DB schema changes go into `C:\Gitlab\DBMigrationV2\DatabaseScripts\Migrations\`, not this repo. No `ALTER`/`CREATE` runs from here.
3. Every new controller must inherit `BaseController` and log request + response with a MessageId Guid.
4. Every new service must inherit `BaseService` (lazy `DynamicDespatchDbContext`).
5. No em-dashes anywhere. Plain ASCII hyphens only.
6. Do NOT touch `changes.log` in this repo (per user's global preference).
