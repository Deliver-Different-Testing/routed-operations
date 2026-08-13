# RoutedOperations.Tests

Backend + frontend unit tests for RoutedOperations. Backfill programme approved 2026-08-13. Phase 1 (this MR) lands the scaffold, CI gate, pre-push hook, and ~50 seed tests. Phases 2-4 backfill the remaining ~200+ files to 100% raw coverage.

## Stack

- **Backend**: [xUnit.v3](https://xunit.net/docs/getting-started/v3/microsoft-testing-platform) + [NSubstitute](https://nsubstitute.github.io/) + EF Core `InMemory` (default) or `Sqlite` (opt-in per test) + coverlet.
  - Runner: `dotnet run --configuration Release` (Microsoft Testing Platform, NOT `dotnet test`).
  - Matches Configurator + DespatchWeb's proven shape.
- **Frontend**: [Vitest](https://vitest.dev/) + [@testing-library/react](https://testing-library.com/docs/react-testing-library/intro) + jsdom + [MSW](https://mswjs.io/).
  - Config: `vitest.config.ts` at repo root.
  - Shared setup: `wwwroot/app/react/test/setup.ts`.
  - Test render helper: `wwwroot/app/react/test/renderWithProviders.tsx`.

## Running tests locally

**Frontend only:**
```bash
npm run test          # single pass
npm run test:watch    # watch mode
npm run test:ci       # coverage + junit + cobertura reports
```

**Backend only:**
```bash
cd tests/RoutedOperations.Tests
dotnet run --configuration Release
```

**Full local gate (what the Husky pre-push hook runs):**
```bash
npm run test:precommit
```

## Husky pre-push hook

The `.husky/pre-push` hook installs automatically via the `prepare` script the first time you run `npm install`. On `git push` it runs:

1. `npm run lint`
2. `npm run type-check`
3. `npm run test`
4. `dotnet run --project tests/RoutedOperations.Tests --configuration Release`

Any red step aborts the push. If the hook does not fire after a fresh clone, run `npx husky` once manually and try again.

**Do not bypass with `--no-verify`.** The global CLAUDE.md rule forbids it. If the hook is legitimately broken, fix the hook or fix the test.

## CI (GitLab)

`.gitlab-ci.yml` runs three blocking jobs on every MR targeting `staging` / `master` / `main` and on every push to `master`:

- `test:frontend:lint` - `npm run lint` + `npm run type-check`.
- `test:frontend:unit` - `npm run test:ci` with coverage badge + junit + cobertura.
- `test:backend:unit` - `dotnet run --project tests/RoutedOperations.Tests --configuration Release` with NuGet cache.

CI is the authoritative gate; a red pipeline blocks the merge button.

## Where to put a new test

### Backend

Mirror the source path under `tests/RoutedOperations.Tests/`:

| Source | Test |
|---|---|
| `Core/Application/Services/RecurringLinehaul/RecurringLinehaulService.cs` | `tests/RoutedOperations.Tests/Services/RecurringLinehaul/RecurringLinehaulServiceTests.cs` |
| `Core/Application/Services/Np/NpScopeGuard.cs` | `tests/RoutedOperations.Tests/Np/NpScopeGuardTests.cs` |
| `Core/Application/Validators/BulkImportRequestValidator.cs` | `tests/RoutedOperations.Tests/Validators/BulkImportRequestValidatorTests.cs` |
| `API/Controllers/RecurringLinehaulRunsController.cs` | `tests/RoutedOperations.Tests/Controllers/RecurringLinehaulRunsControllerTests.cs` |

Global `using Xunit;` + `using NSubstitute;` are wired via the csproj, so test files can skip those.

### Frontend

Tests live NEXT TO the code (not under a parallel tree):

| Source | Test |
|---|---|
| `wwwroot/app/react/lib/tenantLabels.ts` | `wwwroot/app/react/lib/tenantLabels.test.ts` |
| `wwwroot/app/react/components/common/Button.tsx` | `wwwroot/app/react/components/common/Button.test.tsx` |
| `wwwroot/app/react/context/ConfirmContext.tsx` | `wwwroot/app/react/context/ConfirmContext.test.tsx` |
| `wwwroot/app/react/services/api.ts` | `wwwroot/app/react/services/api.test.ts` |

Import the test render helper for components:
```ts
import { renderWithProviders } from '@/test/renderWithProviders';
```

## Fixture patterns

### Backend: EF InMemory DbContext

```csharp
var options = new DbContextOptionsBuilder<DynamicDespatchDbContext>()
    .UseInMemoryDatabase(Guid.NewGuid().ToString())
    .Options;
await using var ctx = new DynamicDespatchDbContext(options);
ctx.TucJobs.Add(new TucJob { UcjbId = 1, UcjbNumber = "US-1", NpAgentId = 42 });
await ctx.SaveChangesAsync();

var factory = Substitute.For<IDbContextFactory<DynamicDespatchDbContext>>();
factory.CreateDbContextAsync().Returns(ctx);
```

### Backend: HttpContext with claims

```csharp
var httpAccessor = Substitute.For<IHttpContextAccessor>();
var ctx = new DefaultHttpContext();
ctx.User = new ClaimsPrincipal(new ClaimsIdentity(new[]
{
    new Claim("CurrentTenantID", "1"),
    new Claim("TimeZone", "Pacific/Auckland"),
    new Claim("IsNetworkPartner", "True"),
    new Claim("NpAgentId", "42"),
}));
httpAccessor.HttpContext.Returns(ctx);
```

### Frontend: MSW handler override

```ts
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';

server.use(
  http.get('/api/recurring-routes', () => HttpResponse.json({ response: [] })),
);
```

## Coverage measurement

Vitest coverage lives at `coverage/` after `npm run test:ci`. Open `coverage/index.html` for the browsable report. Cobertura XML at `coverage/cobertura-coverage.xml` is what CI uploads to the GitLab MR widget.

Backend coverage collection: `dotnet run --project tests/RoutedOperations.Tests --configuration Release -- --collect coverlet.collector` (Phase 4 wires this into CI).

## Phase status

- **Phase 1 (this MR)**: scaffold + husky + CI + ~50 seed tests. LANDED.
- **Phase 2**: backfill all 46 remaining backend service files. PENDING.
- **Phase 3**: backfill all 143 remaining frontend files (components + pages + hooks + services + contexts). PENDING.
- **Phase 4**: coverage floor enforcement (Kevin's 2026-08-13 call: 100% raw target). PENDING.

The full multi-phase plan lives at `C:\Users\kevinc.URGENTD\.claude\plans\rustling-tumbling-sutherland.md`.
