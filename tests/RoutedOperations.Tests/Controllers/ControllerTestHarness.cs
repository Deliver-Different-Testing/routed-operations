using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using RoutedOperations.Core.Application.Utilities;
using RoutedOperations.Core.Domain;

namespace RoutedOperations.Tests.Controllers;

// Shared plumbing for controller unit tests. The services under test are
// concrete classes with non-virtual methods, so NSubstitute cannot intercept
// their calls; instead we construct real service instances backed by an
// InMemory EF Core store (per-test Guid db name so each test is isolated)
// and let the controller flow through them. Assertions target the controller
// wrapping (response envelope, MutationResult -> HTTP status mapping,
// ModelState short-circuits) rather than the service's own projection logic,
// which is covered independently in Services/*.
internal static class ControllerTestHarness
{
    internal static DbContextOptions<DespatchContext> NewOptions() =>
        new DbContextOptionsBuilder<DespatchContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString(), b => b.EnableNullChecks(false))
            .Options;

    internal static DynamicDespatchDbContext Context(DbContextOptions<DespatchContext> options) =>
        new(options);

    internal static IDbContextFactory<DynamicDespatchDbContext> Factory(DbContextOptions<DespatchContext> options)
    {
        var factory = Substitute.For<IDbContextFactory<DynamicDespatchDbContext>>();
        factory.CreateDbContext().Returns(_ => new DynamicDespatchDbContext(options));
        factory.CreateDbContextAsync(Arg.Any<CancellationToken>())
            .Returns(_ => Task.FromResult(new DynamicDespatchDbContext(options)));
        return factory;
    }

    // Build an accessor with the exact claim set the caller needs. Passing
    // null / omitting a claim leaves it absent so the SUT sees its default
    // behaviour (e.g. no CountryCode => IsNzTenant / IsUsTenant both false).
    internal static IHttpContextAccessor Accessor(
        string? countryCode = null,
        string? internalClaim = null,
        string? tenantId = "1",
        string? contactId = null)
    {
        var accessor = Substitute.For<IHttpContextAccessor>();
        var ctx = new DefaultHttpContext();
        var claims = new List<Claim>();
        if (countryCode != null) claims.Add(new Claim("CountryCode", countryCode));
        if (internalClaim != null) claims.Add(new Claim("Internal", internalClaim));
        if (tenantId != null) claims.Add(new Claim("CurrentTenantID", tenantId));
        if (contactId != null) claims.Add(new Claim("ContactID", contactId));
        ctx.User = new ClaimsPrincipal(new ClaimsIdentity(claims));
        accessor.HttpContext.Returns(ctx);
        return accessor;
    }

    internal static TenantScopedCache Cache(IHttpContextAccessor accessor) =>
        new(new MemoryCache(new MemoryCacheOptions()), accessor);

    // Wire the controller's own HttpContext (needed for BaseController's
    // model state + logging path that read Request.Method / Request.Path).
    // Callers may pass the same accessor they gave to the service so the
    // ContactID claim is visible to the controller's GetCurrentContactId()
    // helper as well.
    internal static void AttachHttpContext(
        ControllerBase controller,
        string? contactId = null,
        string? internalClaim = null,
        string? countryCode = null,
        string? tenantId = "1",
        string method = "GET",
        string path = "/api/test")
    {
        var ctx = new DefaultHttpContext();
        var claims = new List<Claim>();
        if (countryCode != null) claims.Add(new Claim("CountryCode", countryCode));
        if (internalClaim != null) claims.Add(new Claim("Internal", internalClaim));
        if (tenantId != null) claims.Add(new Claim("CurrentTenantID", tenantId));
        if (contactId != null) claims.Add(new Claim("ContactID", contactId));
        ctx.User = new ClaimsPrincipal(new ClaimsIdentity(claims));
        ctx.Request.Method = method;
        ctx.Request.Path = path;
        controller.ControllerContext = new ControllerContext
        {
            HttpContext = ctx,
            RouteData = new RouteData(),
            ActionDescriptor = new Microsoft.AspNetCore.Mvc.Controllers.ControllerActionDescriptor(),
        };
    }

    // Extract the anonymous { response = X } envelope's `response` value so
    // tests can assert on the payload without a runtime cast dance.
    internal static object? ExtractResponse(OkObjectResult ok)
    {
        var val = ok.Value!;
        var prop = val.GetType().GetProperty("response");
        return prop?.GetValue(val);
    }
}
