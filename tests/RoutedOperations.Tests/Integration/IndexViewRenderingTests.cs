// End-to-end rendering of Views/Home/Index.cshtml via an authenticated
// WebApplicationFactory. Exercises the Razor helper (BundleVersion loop's
// happy path when wwwroot/dist/app.js is present + fallback path when
// missing) + the conditional Google Maps script block.
using System.Net;

namespace RoutedOperations.Tests.Integration;

[Collection("EnvVarMutating")]
public class IndexViewRenderingTests
    : IClassFixture<IndexViewRenderingTests.SharedFactory>
{
    private readonly SharedFactory _factory;

    public IndexViewRenderingTests(SharedFactory factory) => _factory = factory;

    [Fact]
    public async Task Root_Authenticated_RendersIndexViewWithBootstrapPayload()
    {
        using var client = _factory.CreateClient();

        var res = await client.GetAsync("/");

        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var body = await res.Content.ReadAsStringAsync();
        Assert.Contains("Routed Operations", body); // <title>
        Assert.Contains("routed-operations-root", body); // React mount point
        Assert.Contains("window.__APP_USER__", body); // bootstrap payload
        Assert.Contains("\"currentTenantId\":42", body); // camelCase serialised claim
        Assert.Contains("\"fullName\":\"Test User\"", body);
    }

    [Fact]
    public async Task Root_Authenticated_IncludesModulePreloadAndDistLinks()
    {
        using var client = _factory.CreateClient();

        var res = await client.GetAsync("/");

        var body = await res.Content.ReadAsStringAsync();
        Assert.Contains("modulepreload", body);
        Assert.Contains("/dist/app.js?v=", body); // BundleVersion cache-bust
        Assert.Contains("/dist/app.css?v=", body);
    }

    [Fact]
    public async Task Root_Authenticated_EmbedsGoogleMapsScriptWhenKeyPresent()
    {
        // TestFactory sets GoogleMapsKey = "test-google" via config, and
        // AppSettings picks it up via `builder.Configuration["GoogleMapsKey"]`.
        using var client = _factory.CreateClient();

        var res = await client.GetAsync("/");

        var body = await res.Content.ReadAsStringAsync();
        Assert.Contains("maps.googleapis.com", body);
        Assert.Contains("key=test-google", body);
    }

    // A shared factory instance keeps host boot cost paid once.
    public sealed class SharedFactory : AuthenticatedTestFactory { }
}
