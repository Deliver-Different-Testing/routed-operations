// Shared WebApplicationFactory for bootstrap + host-level integration tests.
//
// Uses RoutedOperations.Controllers.HomeController as the TEntryPoint marker
// because Program.cs is emitted as `internal partial class Program` by the
// top-level-statements compiler and adding InternalsVisibleTo would modify
// the SUT project. WebApplicationFactory<TEntryPoint> only uses TEntryPoint
// to locate the entry assembly via typeof(T).Assembly; any public type in
// the RoutedOperations assembly serves the same purpose.
//
// The factory pre-seeds the env vars Program.cs demands at startup (Domain,
// RedisConfig, SQLCredentials) via ConfigureAppConfiguration in-memory keys
// and Environment.SetEnvironmentVariable side-effects (Program reads Domain
// / RedisConfig / SQLCredentials directly from Environment, not from
// IConfiguration). Data protection is redirected to in-memory so the shared
// cookie ring does not need to be provisioned on the test host.
using System.Collections.Generic;
using System.Security.Claims;
using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.Caching.Distributed;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using RoutedOperations.Controllers;
using RoutedOperations.Infrastructure;

namespace RoutedOperations.Tests.Integration;

public class TestFactory : WebApplicationFactory<HomeController>
{
    protected override IHost CreateHost(IHostBuilder builder)
    {
        // Program.cs reads these three via Environment.GetEnvironmentVariable,
        // not IConfiguration - if any is missing the host throws before the
        // pipeline is even built.
        Environment.SetEnvironmentVariable("Domain", "localhost");
        Environment.SetEnvironmentVariable("RedisConfig", "localhost:6379,abortConnect=false");
        Environment.SetEnvironmentVariable("SQLCredentials", ";User Id=x;Password=x");
        Environment.SetEnvironmentVariable("PublicPath", "https://public.test/login");
        // AppSettings is materialized during WebApplication.CreateBuilder in
        // Program.cs (reads builder.Configuration["GoogleMapsKey"] etc), which
        // runs BEFORE the framework invokes any ConfigureAppConfiguration on
        // the host builder. Env vars are the only injection point that lands
        // in time: WebApplication.CreateBuilder adds an env-var source eagerly.
        Environment.SetEnvironmentVariable("HeremapApiKey", "test-here");
        Environment.SetEnvironmentVariable("GoogleMapsKey", "test-google");
        Environment.SetEnvironmentVariable("RouteSavyID", "test-rs");
        Environment.SetEnvironmentVariable("DespatchWebBaseUrl", "https://despatch.test/");

        return base.CreateHost(builder);
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Development");

        builder.ConfigureTestServices(services =>
        {
            // In-memory distributed cache so Redis is not required. This
            // replaces the StackExchangeRedis cache registered in Program.cs.
            services.RemoveAll<IDistributedCache>();
            services.AddDistributedMemoryCache();

            // Ephemeral data protection so the cookie ring does not need a
            // Windows DPAPI key folder or AWS SSM path.
            services.AddDataProtection()
                .SetApplicationName("DeliverDifferent")
                .UseEphemeralDataProtectionProvider();

            // Swap the real IConnectionStringManager for a fake so
            // HomeController.Index's SetConnectionStringAsync call does not
            // require Redis. Tests that assert on cache writes can retrieve
            // the singleton back via factory.Services.
            services.RemoveAll<IConnectionStringManager>();
            services.AddSingleton<IConnectionStringManager, FakeConnectionStringManager>();
        });
    }
}

// Factory variant that force-authenticates every request as a test user.
// Used by tests that need to hit [Authorize] endpoints (e.g. rendering
// Views/Home/Index.cshtml end-to-end). Replaces the cookie handler on the
// "Identity.Application" scheme with a stub that always succeeds.
public class AuthenticatedTestFactory : TestFactory
{
    // Overridable claim set so a per-test customization can inject variants
    // (US tenant, missing GoogleMapsKey, etc.).
    public static readonly List<Claim> DefaultClaims = new()
    {
        new Claim(ClaimTypes.Name, "test@nz.test"),
        new Claim(ClaimTypes.Email, "test@nz.test"),
        new Claim("Connection", "Server=test;Database=X;"),
        new Claim("CurrentTenantID", "42"),
        new Claim("TimeZone", "Pacific/Auckland"),
        new Claim("CountryCode", "NZ"),
        new Claim("FirstName", "Test"),
        new Claim("Surname", "User"),
    };

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        base.ConfigureWebHost(builder);

        builder.ConfigureTestServices(services =>
        {
            // Program.cs already registered the "Identity.Application" cookie
            // scheme. Removing it from AuthenticationOptions.SchemeMap does NOT
            // remove it from the private _schemes list that the provider ctor
            // iterates, so re-adding under the same name double-registers and
            // throws "Scheme already exists". Register the stub under a fresh
            // name instead and repoint the defaults at it - the cookie scheme
            // stays registered but is never the challenge target.
            services.AddAuthentication(o =>
                {
                    o.DefaultAuthenticateScheme = TestAuthScheme;
                    o.DefaultChallengeScheme = TestAuthScheme;
                    o.DefaultScheme = TestAuthScheme;
                })
                .AddScheme<AuthenticationSchemeOptions, StubAuthHandler>(
                    TestAuthScheme, _ => { });
        });
    }

    public const string TestAuthScheme = "TestStub";
}

// Minimal always-succeeds auth handler. Stamps DefaultClaims onto every
// request so [Authorize] passes and HomeController.Index sees a valid
// tenant + connection claim, letting it advance to the View(bootstrap)
// call and render Index.cshtml end-to-end.
public sealed class StubAuthHandler : AuthenticationHandler<AuthenticationSchemeOptions>
{
    public StubAuthHandler(
        IOptionsMonitor<AuthenticationSchemeOptions> options,
        ILoggerFactory logger,
        UrlEncoder encoder)
        : base(options, logger, encoder) { }

    protected override Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        var identity = new ClaimsIdentity(AuthenticatedTestFactory.DefaultClaims, "Test");
        var principal = new ClaimsPrincipal(identity);
        var ticket = new AuthenticationTicket(principal, AuthenticatedTestFactory.TestAuthScheme);
        return Task.FromResult(AuthenticateResult.Success(ticket));
    }
}

// Helper that removes all registrations of TService before a re-add. The
// stock ServiceCollection Remove* methods only take a ServiceDescriptor;
// this generic variant is what every ASP.NET Core test harness ends up
// writing eventually.
public static class ServiceCollectionRemoveExtensions
{
    public static void RemoveAll<TService>(this IServiceCollection services)
    {
        for (var i = services.Count - 1; i >= 0; i--)
        {
            if (services[i].ServiceType == typeof(TService))
                services.RemoveAt(i);
        }
    }
}

// In-memory stand-in for ConnectionStringManager. Exposes the last Set call
// so bootstrap tests can assert HomeController.Index cached the tenant
// connection string as a side effect.
public sealed class FakeConnectionStringManager : IConnectionStringManager
{
    public Dictionary<string, string> Cache { get; } = new();

    public Task SetConnectionStringAsync(string tenantAppCacheKey, string connectionString)
    {
        Cache[tenantAppCacheKey] = connectionString;
        return Task.CompletedTask;
    }

    public Task<string?> GetConnectionStringAsync(string tenantAppCacheKey)
    {
        return Task.FromResult(Cache.TryGetValue(tenantAppCacheKey, out var v) ? v : null);
    }
}
