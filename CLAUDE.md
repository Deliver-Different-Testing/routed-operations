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

1. `C:\Gitlab\.claude\sp-reference\client-override-deltas-2026-09-22.md` - Steve Bucket C (F1/F3/F7/F8/F13/F17/F18/F21) shipped 2026-09-22/23. `tblBulkRunScheduleOverride` delta table + `fnScheduleForClient` inline TVF + Header extensions + Group→Bundle rename + `uspPrebookSet` snapshot. Replaces clone-header `BaseScheduleId` model.
2. `C:\Gitlab\.claude\sp-reference\driver-scheduling-2026-09-07.md` - CourierManager scheduler port into Routed Operations. 14 endpoints under `api/driver-scheduling`, 5 EF entities, `IPhoneNormaliser` + `IHubUrlProvider` per-tenant abstractions, DB trigger analysis + Day-1 US enablement checklist.
3. `C:\Gitlab\.claude\sp-reference\routed-operations-handover-2026-07-16.md` - Day 3: feature-parity gap fill (map right-click, JobDetail editing, Fix GPS, multibox expansion, sort/filter, group bulk-move, send-selected, layout save/load). Also carries the explicitly-not-migrated list (prebook + filter-by-time - do not re-add).
4. `C:\Gitlab\.claude\sp-reference\routed-operations-handover-2026-07-14.md` - Day 1: scaffolding + auth + cockpit + HERE Maps + Delivery Window feature. Original 9 cross-tenant gotchas glossary still lives here.

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
7. **Testing.** Write tests that pay for themselves. Kevin's 2026-08-21 call revised the earlier "every controller / service / component / hook / pure utility / DTO ships with a test" policy after 1942 vitest tests + 1203 xUnit tests started producing more CI drag than regression coverage (see the 4-iteration debug cycle on the RouteRosterTab remove-override test on `fix/routeviewer-runs-kms-cast`).
   - **Prefer** Playwright E2E in `tests/e2e/` for user-facing flows (opens page, does clicks, verifies outcome). One E2E replaces 5-8 fragile MSW+full-render vitest tests.
   - **Prefer** vitest for **pure-logic modules** (utils, mappers, formatters, selectors, hooks that do not fetch). These are fast, deterministic, and catch real bugs. E.g. `runFinancials.test.ts`, `mapDefaults.test.ts`, `timezone.test.ts`.
   - **Prefer** vitest for **small render tests on individual components** (buttons, chips, small pieces). Also fast, catches prop mismatches.
   - **Avoid** vitest for **integration-shaped tests**: full-page render + MSW mocks + multi-step user interaction + fetch + re-render + DOM assertion. These are the ones that fail on CI while passing locally because the slow shared runner cannot match the test's timing assumptions. Move them to Playwright.
   - **Avoid** controller / service / DTO tests that just verify the framework wired something up. TypeScript + compiler already enforces the shape; a "controller returns 200" test with no logic exercises no product code.
   - **Backend** tests live at `tests/RoutedOperations.Tests/<mirror>` (xUnit.v3 + NSubstitute + EF InMemory or SQLite). Run: `cd tests/RoutedOperations.Tests && dotnet run --configuration Release`.
   - **Frontend** tests live next to the code (`Foo.test.tsx` beside `Foo.tsx`) using Vitest + @testing-library/react + jsdom + MSW. Run: `npm run test`.
   - **Local pre-push gate** (Husky, auto-installed on `npm install`) runs lint + type-check + `npm run test` + backend tests. Bypass with `--no-verify` is forbidden.
   - **CI** blocks merges on any red test (`test:frontend:lint`, `test:frontend:unit`, `test:backend:unit`). Coverage no longer blocks merges - `test:frontend:unit:coverage` runs on merge-to-master + on-demand on MRs.
   - **Coverage**: no hard threshold. Number is still measured + reported to the GitLab MR widget; write tests for value, not for the number. Aim for the pattern DespatchWeb settled on (fast focused unit tests + E2E for flows). See its `.gitlab-ci.yml` for the reference config.
   - See `tests/RoutedOperations.Tests/README.md` for the full setup walkthrough.
