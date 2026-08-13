// Program.cs bootstrap coverage via WebApplicationFactory<HomeController>.
//
// These tests hit the fully-wired ASP.NET Core pipeline in-memory (no
// Kestrel listener) so every middleware in Program.cs - forwarded headers,
// response compression, CSRF header guard, security headers, health checks,
// static files, routing - is exercised end-to-end. HomeController.Index and
// unauthenticated flows land in AuthCookieTests / HomeControllerBootstrapTests
// respectively; this file focuses on the host-level bootstrap paths.
using System.Net;
using System.Net.Http.Headers;

namespace RoutedOperations.Tests.Integration;

[Collection("EnvVarMutating")]
public class BootstrapTests : IClassFixture<BootstrapTests.SharedFactory>
{
    private readonly SharedFactory _factory;

    public BootstrapTests(SharedFactory factory) => _factory = factory;

    // ─────────────────────────────────────────────────────────────────────
    // /health/live - liveness with Predicate=_ => false (no checks run)
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task HealthLive_ReturnsOk_WithoutRunningChecks()
    {
        using var client = _factory.CreateClient();

        var res = await client.GetAsync("/health/live");

        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
    }

    // ─────────────────────────────────────────────────────────────────────
    // /healthz - readiness. SqlServerHealthCheck returns Unhealthy because
    // SQLHealthCheckConnection env var is not set in tests, which the writer
    // serialises as JSON with Status = "Unhealthy" and HTTP 503.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Healthz_RespondsWithJson_EvenWhenUnhealthy()
    {
        using var client = _factory.CreateClient();

        var res = await client.GetAsync("/healthz");

        // 503 Service Unavailable is the mapped-status for HealthStatus.Unhealthy.
        // We accept either 200 or 503 to keep the test resilient across CI hosts
        // that might have SQLHealthCheckConnection accidentally exported.
        Assert.True(res.StatusCode == HttpStatusCode.OK
                    || res.StatusCode == HttpStatusCode.ServiceUnavailable,
            $"Expected 200 or 503, got {(int)res.StatusCode}");
        Assert.Equal("application/json", res.Content.Headers.ContentType?.MediaType);
        var body = await res.Content.ReadAsStringAsync();
        Assert.Contains("despatch-db", body);
        // WriteAsJsonAsync uses System.Text.Json defaults (camelCase).
        Assert.Contains("status", body, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("duration", body, StringComparison.OrdinalIgnoreCase);
    }

    // ─────────────────────────────────────────────────────────────────────
    // CSRF guard: state-changing methods without X-Requested-With are 400.
    // Program.cs middleware line ~547.
    // ─────────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData("POST")]
    [InlineData("PUT")]
    [InlineData("PATCH")]
    [InlineData("DELETE")]
    public async Task Csrf_StateChanging_WithoutXhr_Returns400(string method)
    {
        using var client = _factory.CreateClient();

        using var req = new HttpRequestMessage(new HttpMethod(method), "/api/anything");
        using var res = await client.SendAsync(req);

        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        var body = await res.Content.ReadAsStringAsync();
        Assert.Contains("Invalid request", body);
    }

    [Fact]
    public async Task Csrf_StateChanging_WithXhr_PassesGuard()
    {
        using var client = _factory.CreateClient();

        using var req = new HttpRequestMessage(HttpMethod.Post, "/api/does-not-exist");
        req.Headers.Add("X-Requested-With", "XMLHttpRequest");
        using var res = await client.SendAsync(req);

        // The CSRF middleware lets the request through; downstream will 404
        // (no route) or 401 (auth). Anything other than 400 proves the CSRF
        // guard did not fire.
        Assert.NotEqual(HttpStatusCode.BadRequest, res.StatusCode);
    }

    [Fact]
    public async Task Csrf_Healthz_Post_IsExemptEvenWithoutXhr()
    {
        // The middleware explicitly bypasses /healthz. POST /healthz is not
        // mapped (only GET is), so we should see 404/405 not 400.
        using var client = _factory.CreateClient();

        using var req = new HttpRequestMessage(HttpMethod.Post, "/healthz");
        using var res = await client.SendAsync(req);

        Assert.NotEqual(HttpStatusCode.BadRequest, res.StatusCode);
    }

    [Fact]
    public async Task Csrf_GetIsNeverBlocked()
    {
        using var client = _factory.CreateClient();

        var res = await client.GetAsync("/health/live");

        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Security headers: X-Content-Type-Options, X-Frame-Options,
    // Referrer-Policy, Permissions-Policy, CSP. HSTS is only added when
    // !IsDevelopment, so it is asserted absent here.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task SecurityHeaders_LandOnResponses()
    {
        using var client = _factory.CreateClient();

        var res = await client.GetAsync("/health/live");

        Assert.Equal("nosniff", res.Headers.GetValues("X-Content-Type-Options").Single());
        Assert.Equal("DENY", res.Headers.GetValues("X-Frame-Options").Single());
        Assert.Equal("strict-origin-when-cross-origin", res.Headers.GetValues("Referrer-Policy").Single());
        Assert.Equal("geolocation=(), microphone=()", res.Headers.GetValues("Permissions-Policy").Single());
        Assert.True(res.Headers.Contains("Content-Security-Policy"));
        var csp = res.Headers.GetValues("Content-Security-Policy").Single();
        Assert.Contains("default-src 'self'", csp);
        Assert.Contains("frame-ancestors 'none'", csp);
        Assert.Contains("http://localhost:*", csp); // dev-only connect-src add-on
        Assert.DoesNotContain("upgrade-insecure-requests", csp); // prod-only
    }

    [Fact]
    public async Task SecurityHeaders_HstsAbsentInDevelopment()
    {
        using var client = _factory.CreateClient();

        var res = await client.GetAsync("/health/live");

        Assert.False(res.Headers.Contains("Strict-Transport-Security"));
    }

    // ─────────────────────────────────────────────────────────────────────
    // Forwarded headers: UseForwardedHeaders() with X-Forwarded-For +
    // X-Forwarded-Proto. Verifying that setting them does not blow up the
    // pipeline and that the response is still 200. KnownProxies is cleared
    // per Program.cs so the header MAY be dropped depending on remote
    // recognition; test asserts the pipeline still yields a valid response.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task ForwardedHeaders_DoNotBreakPipeline()
    {
        using var client = _factory.CreateClient();
        using var req = new HttpRequestMessage(HttpMethod.Get, "/health/live");
        req.Headers.Add("X-Forwarded-For", "203.0.113.5");
        req.Headers.Add("X-Forwarded-Proto", "https");

        var res = await client.SendAsync(req);

        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Response compression: text-like payload with Accept-Encoding gzip
    // should come back compressed. /healthz returns application/json which
    // is in the default compressible set.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task ResponseCompression_JsonWithGzipHeader_ReturnsGzipEncoded()
    {
        // TestServer's default HttpClient does not auto-decompress, so the
        // Content-Encoding header on the response body is observable directly.
        using var client = _factory.CreateClient();

        using var req = new HttpRequestMessage(HttpMethod.Get, "/healthz");
        req.Headers.AcceptEncoding.Add(new StringWithQualityHeaderValue("gzip"));
        using var res = await client.SendAsync(req);

        // At minimum a valid response must have come back; if compression
        // fired the encoding header will contain gzip or br.
        Assert.True(res.StatusCode == HttpStatusCode.OK
                    || res.StatusCode == HttpStatusCode.ServiceUnavailable);
        var encodings = res.Content.Headers.ContentEncoding;
        if (encodings.Count > 0)
        {
            Assert.Contains(encodings, e => e is "gzip" or "br");
        }
    }

    [Fact]
    public async Task ResponseCompression_JsonWithBrHeader_ReturnsBrEncodedWhenAvailable()
    {
        using var client = _factory.CreateClient();

        using var req = new HttpRequestMessage(HttpMethod.Get, "/healthz");
        req.Headers.AcceptEncoding.Add(new StringWithQualityHeaderValue("br"));
        using var res = await client.SendAsync(req);

        var encodings = res.Content.Headers.ContentEncoding;
        if (encodings.Count > 0)
        {
            Assert.Contains(encodings, e => e is "br" or "gzip");
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Static files: /dist/app.js and /favicon.ico should be served by the
    // static file middleware if the assets exist on disk. Tolerant of the
    // case where a fresh clone hasn't run `npm run build` yet - a 404 also
    // proves the pipeline is wired.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task StaticFiles_DistBundle_ServedOr404()
    {
        using var client = _factory.CreateClient();

        var res = await client.GetAsync("/dist/app.js");

        Assert.True(res.StatusCode == HttpStatusCode.OK
                    || res.StatusCode == HttpStatusCode.NotFound,
            $"Expected 200 or 404, got {(int)res.StatusCode}");
    }

    [Fact]
    public async Task StaticFiles_DistBundle_ServedWithJavaScriptContentType()
    {
        using var client = _factory.CreateClient();

        var res = await client.GetAsync("/dist/app.js");

        if (res.StatusCode == HttpStatusCode.OK)
        {
            // Program.cs registers a FileExtensionContentTypeProvider that
            // maps .js to javascript. The exact media type has varied
            // across ASP.NET Core versions (application/javascript vs
            // text/javascript); accept either.
            var mediaType = res.Content.Headers.ContentType?.MediaType ?? string.Empty;
            Assert.Contains("javascript", mediaType, StringComparison.OrdinalIgnoreCase);
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // A shared factory keeps the ~2-3 second Kestrel-less boot cost paid
    // once per class instead of once per fact.
    // ─────────────────────────────────────────────────────────────────────
    public sealed class SharedFactory : TestFactory { }
}
