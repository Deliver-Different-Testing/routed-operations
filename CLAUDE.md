# CLAUDE.md - Routed Operations

## Product context

Routed Operations is the umbrella product replacing the legacy RunBuilder AngularJS + .NET MVC app.

- **Stage 1 - Route Builder** cockpit (merged into `master`): feature parity with the legacy cockpit.
- **Stage 2 - sibling modules** (branch `feature/stage2-sibling-modules`, awaiting review):
  - **Scheduled Routes** + **Polygon Builder** reuse the Configurator `Route` / `ZipPolygon` / `Dispatch_RouteRoster` / `RouteZipcodes` tables so a route created here shows up cleanly in DF Admin → Operations → Recurring Routes and drives the same downstream `uspPrebookSet` cron. Backed by `RecurringRouteService` + `/api/recurring-routes/*`.
  - **Quoting** uses isolated shadow tables (`tblQuoteJob` + `tblQuoteRun`); rows never promote to `tblBulkJob` or `tucJob`.
- **Dynamic mode** is still scoped but not started (see `ROUTEBUILDER-DYNAMIC-PLAN` handover for the plan).

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
7. **Testing.** Every new controller / service / component / hook / pure utility / DTO ships with at least one test.
   - **Backend** tests live at `tests/RoutedOperations.Tests/<mirror>` (xUnit.v3 + NSubstitute + EF InMemory or SQLite). Run: `cd tests/RoutedOperations.Tests && dotnet run --configuration Release`.
   - **Frontend** tests live next to the code (`Foo.test.tsx` beside `Foo.tsx`) using Vitest + @testing-library/react + jsdom + MSW. Run: `npm run test`.
   - **Local pre-push gate** (Husky, auto-installed on `npm install`) runs lint + type-check + `npm run test` + backend tests. Bypass with `--no-verify` is forbidden.
   - **CI** blocks merges on any red test (`test:frontend:lint`, `test:frontend:unit`, `test:backend:unit`).
   - **Coverage target**: 100% raw (Kevin's 2026-08-13 call). Baseline after Wave 5 (1,676 frontend + 1,009 backend = 2,685 tests): frontend statements 86.8% / lines 86.8% / branches 80.8% / functions 74.6%; backend cobertura reported per MR. Vitest thresholds set at baseline-margin (lines/statements 82 / branches 76 / functions 70) so accidental regressions fail the pipeline but small dips do not. Reviewers bump the floor upward in every MR that meaningfully raises coverage until 100% is reached.
   - See `tests/RoutedOperations.Tests/README.md` for the full setup walkthrough.
