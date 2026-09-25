# Routed Operations

Product line umbrella; first module is **Route Builder** (Stage 1 = RunBuilder feature parity).

Rewritten on the standardised DFRNT stack (Configurator reference implementation):

- Backend: .NET 10 + ASP.NET Core, EF Core 10 + Dapper for legacy SP wrappers, Serilog console sink.
- Multi-tenant: `DynamicDespatchDbContextFactory` resolves the per-tenant Despatch DB from the `CurrentTenantID` claim on the shared Hub cookie. Connection string caching: memory + Redis.
- Auth: `.AspNet.SharedCookie` (Hub-shared), sliding 20 min expiry.
- Frontend: React 18 + TypeScript 5.7 + Vite 6 + Tailwind 3.4 + React Router 6.
- Mapping: HERE Maps (sequencing) + RouteSavvy (optimisation), server-side proxies.

## Repo layout

```
API/                     REST controllers (BaseController pattern)
Core/Application/        DTOs + application services
Core/Domain/             EF Core entities + DynamicDespatchDbContext
Infrastructure/          AppSettings, ConnectionStringManager, factory, health check
Views/                   Razor host view (mounts React root div)
wwwroot/app/react/       Vite src tree (React SPA)
wwwroot/dist/            Vite build output (served under /dist)
Migrations/              Reserved for future .sql scripts (none needed for Stage 1)
```

## Environment variables

| Var | Purpose |
| --- | --- |
| `Domain` | Cookie domain (leading dot). Shared across the DFRNT app suite. |
| `RedisConfig` | StackExchange.Redis config string. |
| `SQLCredentials` | `;User Id=...;Password=...;` suffix appended to the per-tenant connection string. |
| `PublicPath` | Central login URL - redirect target when the shared cookie is missing. |
| `SQLHealthCheckConnection` | Connection string used by `/healthz`. |
| `RouteSavyID` | RouteSavvy optimiser app id. |
| `HeremapApiKey` | HERE Maps API key. |
| `ASPNETCORE_ENVIRONMENT` | Development / Production. Prod uses AWS SSM for DataProtection keys. |

## Local dev

```powershell
# Backend
dotnet restore
dotnet run

# Frontend (in a second shell)
npm ci
npm run dev        # Vite dev server on http://localhost:5173, proxies /api to Kestrel
```

Build production bundle:

```powershell
npm run build      # → wwwroot/dist/app.js
dotnet publish -c Release -o out
```

## Stage 1 vs later modules

Stage 1 = full RunBuilder cockpit parity (Routes page, run building, dispatch, void, bulk moves, HD sync).
Quoting, Scheduled Routes, and Polygon Builder are scaffold shells at this point; Dynamic mode ships later.

The dispatch flow (`UTL_stpJob_InsertFromRunBuilder` / `UTL_stpJob_InsertFromTblBulkJob`) is intentionally still called via Dapper - safer than a first-pass EF Core rewrite of the 140-column multibox-recursion body. See `Core/Application/Services/Run/RunCommitService.cs` for the TODO.
