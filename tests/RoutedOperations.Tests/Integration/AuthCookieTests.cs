// Cookie authentication redirect + SPA fallback coverage.
//
// Program.cs wires "Identity.Application" cookie auth with an
// OnRedirectToLogin handler that redirects to the PublicPath env var.
// HomeController.Index carries [Authorize], so an unauthenticated GET / is
// caught by the cookie handler before the controller runs and the redirect
// takes effect.
//
// SPA fallback (MapFallbackToController("Index", "Home")) also lands on
// HomeController.Index for unmatched non-API routes, so the same redirect
// applies to unknown paths like /cockpit or /jobs/123.
//
// The /api/* fallback is different: HomeController.Index short-circuits
// with 404 when the path starts with /api, but only after auth passes.
// Unauthenticated /api/* therefore also redirects to the public login.
using System.Net;

namespace RoutedOperations.Tests.Integration;

[Collection("EnvVarMutating")]
public class AuthCookieTests : IClassFixture<AuthCookieTests.SharedFactory>
{
    private readonly SharedFactory _factory;

    public AuthCookieTests(SharedFactory factory) => _factory = factory;

    [Fact]
    public async Task UnauthenticatedRoot_RedirectsToPublicPath()
    {
        using var client = _factory.CreateClient(new Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
        });

        var res = await client.GetAsync("/");

        // OnRedirectToLogin issues a 302 to PublicPath. The exact status
        // depends on the cookie handler's default (302 in older versions,
        // 302 preserved in newer). Accept any 3xx.
        Assert.True((int)res.StatusCode is >= 300 and < 400,
            $"Expected redirect, got {(int)res.StatusCode}");
        var location = res.Headers.Location?.ToString();
        Assert.False(string.IsNullOrEmpty(location));
        Assert.Contains("public.test", location);
    }

    [Fact]
    public async Task UnauthenticatedSpaFallbackPath_RedirectsToPublicPath()
    {
        using var client = _factory.CreateClient(new Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
        });

        // /cockpit is not a mapped route; SPA fallback routes it to
        // HomeController.Index, which is [Authorize], so cookie handler
        // catches it.
        var res = await client.GetAsync("/cockpit");

        Assert.True((int)res.StatusCode is >= 300 and < 400);
    }

    [Fact]
    public async Task UnauthenticatedApiPath_RedirectsOrDenies()
    {
        using var client = _factory.CreateClient(new Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
        });

        var res = await client.GetAsync("/api/foo");

        // Two acceptable behaviours depending on whether the /api path
        // matches any controller: if unmatched, SPA fallback -> [Authorize]
        // HomeController.Index -> 302 redirect. If matched by a real
        // [Authorize] controller, the cookie handler also redirects. Either
        // way we should not see a 200 from an unauthenticated caller.
        Assert.NotEqual(HttpStatusCode.OK, res.StatusCode);
    }

    [Fact]
    public async Task ForbiddenPage_IsAnonymouslyAccessible()
    {
        using var client = _factory.CreateClient();

        var res = await client.GetAsync("/Forbidden");

        // Forbidden action carries [AllowAnonymous] and returns the
        // Forbidden.cshtml view.
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var body = await res.Content.ReadAsStringAsync();
        Assert.Contains("Access denied", body);
    }

    [Fact]
    public async Task UnauthenticatedRoot_RedirectLocationUsesPublicPathEnvVar()
    {
        using var client = _factory.CreateClient(new Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
        });

        var res = await client.GetAsync("/");

        Assert.True((int)res.StatusCode is >= 300 and < 400);
        var location = res.Headers.Location?.ToString() ?? string.Empty;
        // TestFactory sets PublicPath = "https://public.test/login".
        Assert.Contains("public.test", location);
    }

    public sealed class SharedFactory : TestFactory { }
}
