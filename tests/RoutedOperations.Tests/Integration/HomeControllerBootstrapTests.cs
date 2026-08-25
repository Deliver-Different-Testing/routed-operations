// Direct-instantiation coverage of HomeController.Index (AppUserBootstrap
// projection + short-circuits). Bypasses WebApplicationFactory so every
// branch of the record construction, claim parsing (bool.TryParse /
// int.TryParse), and env-var guard clauses can be exercised in isolation.
//
// The controller pattern - IConnectionStringManager + AppSettings ctor
// injection - is the same shape as Configurator's HomeController tests
// (see .claude/sp-reference/routed-operations-handover-2026-07-14.md for
// the parity list). Tests here mirror JobsControllerTests' NewCtl helper.
using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ViewFeatures;
using Microsoft.AspNetCore.Routing;
using RoutedOperations.Controllers;
using RoutedOperations.Infrastructure;

namespace RoutedOperations.Tests.Integration;

// Two tests here mutate process-wide env vars (PublicPath / SQLCredentials)
// to exercise their guard branches. Assigning this class to a xUnit
// collection disables parallel execution against BootstrapTests /
// AuthCookieTests, whose WebApplicationFactory also reads those env vars
// via Program.cs. Same-class tests already serialize by default.
[Collection("EnvVarMutating")]
public class HomeControllerBootstrapTests
{
    // Sentinel connection string used by every "authenticated" test. The
    // full string HomeController writes to the cache is `Connection + credentials`
    // where credentials comes from the SQLCredentials env var.
    private const string ConnClaim = "Server=tenant-db;Database=X;";
    private const string SqlCreds = ";User Id=tenant-user;Password=hunter2";

    private static (HomeController Ctl, FakeConnectionStringManager Fake, AppSettings Settings) NewCtl(
        IEnumerable<Claim>? claims = null,
        string? identityName = null,
        AppSettings? settings = null)
    {
        Environment.SetEnvironmentVariable("SQLCredentials", SqlCreds);
        Environment.SetEnvironmentVariable("PublicPath", "https://public.test/login");

        var fake = new FakeConnectionStringManager();
        var appSettings = settings ?? new AppSettings
        {
            HereMapsApiKey = "here-key",
            GoogleMapsKey = "google-key",
            DespatchWebBaseUrl = "https://despatch.test",
        };

        var ctl = new HomeController(fake, appSettings);

        var identity = new ClaimsIdentity(
            claims ?? Array.Empty<Claim>(),
            authenticationType: identityName == null ? null : "Test",
            nameType: ClaimTypes.Name,
            roleType: ClaimTypes.Role);

        // If identityName was supplied, add it as a Name claim so
        // HttpContext.User.Identity.Name resolves it.
        if (identityName != null)
        {
            identity.AddClaim(new Claim(ClaimTypes.Name, identityName));
        }

        var httpCtx = new DefaultHttpContext
        {
            User = new ClaimsPrincipal(identity),
        };
        httpCtx.Request.Path = "/";
        httpCtx.Request.Method = "GET";

        ctl.ControllerContext = new ControllerContext
        {
            HttpContext = httpCtx,
            RouteData = new RouteData(),
            ActionDescriptor = new Microsoft.AspNetCore.Mvc.Controllers.ControllerActionDescriptor(),
        };

        return (ctl, fake, appSettings);
    }

    // ─────────────────────────────────────────────────────────────────────
    // /api short-circuit: HomeController.Index returns NotFound before
    // reading any claim when the path starts with /api.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Index_ApiPath_Returns404_WithoutTouchingClaims()
    {
        var (ctl, fake, _) = NewCtl();
        ctl.HttpContext.Request.Path = "/api/anything";

        var result = await ctl.Index();

        Assert.IsType<NotFoundResult>(result);
        Assert.Empty(fake.Cache); // no connection string was cached
    }

    // ─────────────────────────────────────────────────────────────────────
    // Missing connection / tenant claim => redirect to PublicPath.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Index_MissingConnectionClaim_RedirectsToPublicPath()
    {
        var (ctl, _, _) = NewCtl(new[]
        {
            new Claim("CurrentTenantID", "42"),
        });

        var result = await ctl.Index();

        var redirect = Assert.IsType<RedirectResult>(result);
        Assert.Contains("public.test", redirect.Url);
    }

    [Fact]
    public async Task Index_MissingTenantClaim_RedirectsToPublicPath()
    {
        var (ctl, _, _) = NewCtl(new[]
        {
            new Claim("Connection", ConnClaim),
        });

        var result = await ctl.Index();

        var redirect = Assert.IsType<RedirectResult>(result);
        Assert.Contains("public.test", redirect.Url);
    }

    [Fact]
    public async Task Index_MissingBothClaims_RedirectsToPublicPath()
    {
        var (ctl, _, _) = NewCtl();

        var result = await ctl.Index();

        var redirect = Assert.IsType<RedirectResult>(result);
        Assert.False(string.IsNullOrEmpty(redirect.Url));
    }

    [Fact]
    public async Task Index_MissingPublicPathEnvVar_RedirectsToDefaultUrl()
    {
        // NewCtl unconditionally re-seeds PublicPath, so clear it AFTER the
        // controller is built. Restore in finally so parallel tests are not
        // affected by the temporary clear.
        var (ctl, _, _) = NewCtl();
        var previous = Environment.GetEnvironmentVariable("PublicPath");
        Environment.SetEnvironmentVariable("PublicPath", null);
        try
        {
            var result = await ctl.Index();

            var redirect = Assert.IsType<RedirectResult>(result);
            Assert.Equal("https://deliverdifferent.com/", redirect.Url);
        }
        finally
        {
            Environment.SetEnvironmentVariable("PublicPath", previous);
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Missing SQLCredentials env var throws.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Index_MissingSqlCredentialsEnv_Throws()
    {
        var (ctl, _, _) = NewCtl(new[]
        {
            new Claim("Connection", ConnClaim),
            new Claim("CurrentTenantID", "42"),
        });
        var current = Environment.GetEnvironmentVariable("SQLCredentials");
        Environment.SetEnvironmentVariable("SQLCredentials", null);
        try
        {
            await Assert.ThrowsAsync<InvalidOperationException>(() => ctl.Index());
        }
        finally
        {
            Environment.SetEnvironmentVariable("SQLCredentials", current ?? SqlCreds);
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Happy path: full claim set flows into AppUserBootstrap and the tenant
    // connection string is cached with the expected key shape.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Index_FullClaimSet_CachesConnectionAndReturnsBootstrap()
    {
        var (ctl, fake, settings) = NewCtl(new[]
        {
            new Claim("Connection", ConnClaim),
            new Claim("CurrentTenantID", "42"),
            new Claim("TimeZone", "Pacific/Auckland"),
            new Claim("CountryCode", "NZ"),
            new Claim(ClaimTypes.Email, "user@nz.test"),
            new Claim("FirstName", "Kevin"),
            new Claim("Surname", "Chen"),
            new Claim("Internal", "true"),
            new Claim("IsNetworkPartner", "true"),
            new Claim("NpAgentId", "77"),
            new Claim("ClientTypeId", "premium"),
            new Claim("ContactID", "555"),
            new Claim("ClientID", "1234"),
            new Claim("ClientCount", "3"),
            new Claim("ClientString", "1,2,3"),
        });

        var result = await ctl.Index();

        var view = Assert.IsType<ViewResult>(result);
        var boot = Assert.IsType<AppUserBootstrap>(view.Model);
        Assert.Equal(42, boot.CurrentTenantId);
        Assert.Equal("Kevin Chen", boot.FullName);
        Assert.Equal("user@nz.test", boot.Email);
        Assert.Equal("Pacific/Auckland", boot.TimeZone);
        Assert.Equal("NZ", boot.CountryCode);
        Assert.False(boot.IsUsTenant);
        Assert.True(boot.IsInternal);
        Assert.Equal("here-key", boot.HereMapsApiKey);
        Assert.Equal("google-key", boot.GoogleMapsKey);
        Assert.True(boot.IsNetworkPartner);
        Assert.Equal(77, boot.NpAgentId);
        Assert.Equal("premium", boot.ClientTypeId);
        Assert.Equal(555, boot.ContactId);
        Assert.Equal(1234, boot.ClientId);
        Assert.Equal(3, boot.ClientCount);
        Assert.Equal("1,2,3", boot.ClientString);
        Assert.Equal("https://despatch.test", boot.DespatchWebBaseUrl);

        // Connection string cached with tenant-prefixed key.
        Assert.True(fake.Cache.ContainsKey("42-RoutedOperations-Connection"));
        Assert.Equal(ConnClaim + SqlCreds, fake.Cache["42-RoutedOperations-Connection"]);
    }

    // ─────────────────────────────────────────────────────────────────────
    // IsUsTenant is true when CountryCode == "US" (case-insensitive).
    // ─────────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData("US", true)]
    [InlineData("us", true)]
    [InlineData("Us", true)]
    [InlineData("NZ", false)]
    [InlineData("AU", false)]
    public async Task Index_IsUsTenant_MatchesCountryCode(string country, bool expected)
    {
        var (ctl, _, _) = NewCtl(new[]
        {
            new Claim("Connection", ConnClaim),
            new Claim("CurrentTenantID", "1"),
            new Claim("CountryCode", country),
        });

        var view = Assert.IsType<ViewResult>(await ctl.Index());
        var boot = Assert.IsType<AppUserBootstrap>(view.Model);
        Assert.Equal(expected, boot.IsUsTenant);
    }

    [Fact]
    public async Task Index_MissingCountryCode_IsUsTenantFalse()
    {
        var (ctl, _, _) = NewCtl(new[]
        {
            new Claim("Connection", ConnClaim),
            new Claim("CurrentTenantID", "1"),
        });

        var view = Assert.IsType<ViewResult>(await ctl.Index());
        var boot = Assert.IsType<AppUserBootstrap>(view.Model);
        Assert.False(boot.IsUsTenant);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Name composition: FirstName+Surname beats Identity.Name (which is
    // the email). Missing both name claims falls back to Identity.Name.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Index_FirstNameAndSurname_ComposeFullName()
    {
        var (ctl, _, _) = NewCtl(
            claims: new[]
            {
                new Claim("Connection", ConnClaim),
                new Claim("CurrentTenantID", "1"),
                new Claim("FirstName", "Alice"),
                new Claim("Surname", "Smith"),
            },
            identityName: "alice@test.com");

        var view = Assert.IsType<ViewResult>(await ctl.Index());
        var boot = Assert.IsType<AppUserBootstrap>(view.Model);
        Assert.Equal("Alice Smith", boot.FullName);
    }

    [Fact]
    public async Task Index_OnlyFirstName_ComposeIgnoresBlank()
    {
        var (ctl, _, _) = NewCtl(new[]
        {
            new Claim("Connection", ConnClaim),
            new Claim("CurrentTenantID", "1"),
            new Claim("FirstName", "Alice"),
        });

        var view = Assert.IsType<ViewResult>(await ctl.Index());
        var boot = Assert.IsType<AppUserBootstrap>(view.Model);
        Assert.Equal("Alice", boot.FullName);
    }

    [Fact]
    public async Task Index_OnlySurname_ComposeIgnoresBlank()
    {
        var (ctl, _, _) = NewCtl(new[]
        {
            new Claim("Connection", ConnClaim),
            new Claim("CurrentTenantID", "1"),
            new Claim("Surname", "Smith"),
        });

        var view = Assert.IsType<ViewResult>(await ctl.Index());
        var boot = Assert.IsType<AppUserBootstrap>(view.Model);
        Assert.Equal("Smith", boot.FullName);
    }

    [Fact]
    public async Task Index_NoNameClaims_FallsBackToIdentityName()
    {
        var (ctl, _, _) = NewCtl(
            claims: new[]
            {
                new Claim("Connection", ConnClaim),
                new Claim("CurrentTenantID", "1"),
            },
            identityName: "bob@test.com");

        var view = Assert.IsType<ViewResult>(await ctl.Index());
        var boot = Assert.IsType<AppUserBootstrap>(view.Model);
        Assert.Equal("bob@test.com", boot.FullName);
    }

    [Fact]
    public async Task Index_BlankFirstAndSurname_FallsBackToIdentityName()
    {
        var (ctl, _, _) = NewCtl(
            claims: new[]
            {
                new Claim("Connection", ConnClaim),
                new Claim("CurrentTenantID", "1"),
                new Claim("FirstName", "  "),
                new Claim("Surname", "\t"),
            },
            identityName: "bob@test.com");

        var view = Assert.IsType<ViewResult>(await ctl.Index());
        var boot = Assert.IsType<AppUserBootstrap>(view.Model);
        Assert.Equal("bob@test.com", boot.FullName);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Email resolution: prefer ClaimTypes.Email, fall back to Identity.Name
    // only when it looks like an email.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Index_EmailClaim_IsPreferred()
    {
        var (ctl, _, _) = NewCtl(
            claims: new[]
            {
                new Claim("Connection", ConnClaim),
                new Claim("CurrentTenantID", "1"),
                new Claim(ClaimTypes.Email, "explicit@test.com"),
            },
            identityName: "wrong@test.com");

        var view = Assert.IsType<ViewResult>(await ctl.Index());
        var boot = Assert.IsType<AppUserBootstrap>(view.Model);
        Assert.Equal("explicit@test.com", boot.Email);
    }

    [Fact]
    public async Task Index_NoEmailClaim_FallsBackToIdentityNameWhenItIsAnEmail()
    {
        var (ctl, _, _) = NewCtl(
            claims: new[]
            {
                new Claim("Connection", ConnClaim),
                new Claim("CurrentTenantID", "1"),
            },
            identityName: "fallback@test.com");

        var view = Assert.IsType<ViewResult>(await ctl.Index());
        var boot = Assert.IsType<AppUserBootstrap>(view.Model);
        Assert.Equal("fallback@test.com", boot.Email);
    }

    [Fact]
    public async Task Index_NoEmailClaimAndIdentityNameNotEmail_ReturnsNullEmail()
    {
        var (ctl, _, _) = NewCtl(
            claims: new[]
            {
                new Claim("Connection", ConnClaim),
                new Claim("CurrentTenantID", "1"),
            },
            identityName: "bob-no-at-sign");

        var view = Assert.IsType<ViewResult>(await ctl.Index());
        var boot = Assert.IsType<AppUserBootstrap>(view.Model);
        Assert.Null(boot.Email);
    }

    [Fact]
    public async Task Index_NoEmailAndNoIdentityName_ReturnsNullEmail()
    {
        var (ctl, _, _) = NewCtl(new[]
        {
            new Claim("Connection", ConnClaim),
            new Claim("CurrentTenantID", "1"),
        });

        var view = Assert.IsType<ViewResult>(await ctl.Index());
        var boot = Assert.IsType<AppUserBootstrap>(view.Model);
        Assert.Null(boot.Email);
    }

    // ─────────────────────────────────────────────────────────────────────
    // IsInternal boolean parsing.
    // ─────────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData("true", true)]
    [InlineData("True", true)]
    [InlineData("TRUE", true)]
    [InlineData("false", false)]
    [InlineData("False", false)]
    [InlineData("garbage", false)]
    [InlineData("", false)]
    public async Task Index_IsInternal_ParsedFromClaim(string raw, bool expected)
    {
        var claims = new List<Claim>
        {
            new("Connection", ConnClaim),
            new("CurrentTenantID", "1"),
        };
        // Empty string still adds the claim so we exercise the
        // string.IsNullOrEmpty branch on the parsed side.
        claims.Add(new Claim("Internal", raw));

        var (ctl, _, _) = NewCtl(claims);

        var view = Assert.IsType<ViewResult>(await ctl.Index());
        var boot = Assert.IsType<AppUserBootstrap>(view.Model);
        Assert.Equal(expected, boot.IsInternal);
    }

    [Fact]
    public async Task Index_MissingInternalClaim_IsInternalFalse()
    {
        var (ctl, _, _) = NewCtl(new[]
        {
            new Claim("Connection", ConnClaim),
            new Claim("CurrentTenantID", "1"),
        });

        var view = Assert.IsType<ViewResult>(await ctl.Index());
        var boot = Assert.IsType<AppUserBootstrap>(view.Model);
        Assert.False(boot.IsInternal);
    }

    // ─────────────────────────────────────────────────────────────────────
    // IsNetworkPartner boolean parsing (mirrors IsInternal).
    // ─────────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData("true", true)]
    [InlineData("false", false)]
    [InlineData("nonsense", false)]
    public async Task Index_IsNetworkPartner_ParsedFromClaim(string raw, bool expected)
    {
        var (ctl, _, _) = NewCtl(new[]
        {
            new Claim("Connection", ConnClaim),
            new Claim("CurrentTenantID", "1"),
            new Claim("IsNetworkPartner", raw),
        });

        var view = Assert.IsType<ViewResult>(await ctl.Index());
        var boot = Assert.IsType<AppUserBootstrap>(view.Model);
        Assert.Equal(expected, boot.IsNetworkPartner);
    }

    [Fact]
    public async Task Index_MissingNpClaim_IsNetworkPartnerFalse()
    {
        var (ctl, _, _) = NewCtl(new[]
        {
            new Claim("Connection", ConnClaim),
            new Claim("CurrentTenantID", "1"),
        });

        var view = Assert.IsType<ViewResult>(await ctl.Index());
        var boot = Assert.IsType<AppUserBootstrap>(view.Model);
        Assert.False(boot.IsNetworkPartner);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Int parsing branches (NpAgentId, ContactID, ClientID, ClientCount,
    // CurrentTenantID).
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Index_IntClaims_ParseCleanValues()
    {
        var (ctl, _, _) = NewCtl(new[]
        {
            new Claim("Connection", ConnClaim),
            new Claim("CurrentTenantID", "99"),
            new Claim("NpAgentId", "1"),
            new Claim("ContactID", "2"),
            new Claim("ClientID", "3"),
            new Claim("ClientCount", "4"),
        });

        var view = Assert.IsType<ViewResult>(await ctl.Index());
        var boot = Assert.IsType<AppUserBootstrap>(view.Model);
        Assert.Equal(99, boot.CurrentTenantId);
        Assert.Equal(1, boot.NpAgentId);
        Assert.Equal(2, boot.ContactId);
        Assert.Equal(3, boot.ClientId);
        Assert.Equal(4, boot.ClientCount);
    }

    [Fact]
    public async Task Index_IntClaims_ReturnNullOnBadValue()
    {
        var (ctl, _, _) = NewCtl(new[]
        {
            new Claim("Connection", ConnClaim),
            new Claim("CurrentTenantID", "not-a-number"),
            new Claim("NpAgentId", "abc"),
            new Claim("ContactID", ""),
            new Claim("ClientID", "1.5"),
            new Claim("ClientCount", "999999999999999999"), // overflows int
        });

        var view = Assert.IsType<ViewResult>(await ctl.Index());
        var boot = Assert.IsType<AppUserBootstrap>(view.Model);
        Assert.Null(boot.CurrentTenantId);
        Assert.Null(boot.NpAgentId);
        Assert.Null(boot.ContactId);
        Assert.Null(boot.ClientId);
        Assert.Null(boot.ClientCount);
    }

    [Fact]
    public async Task Index_IntClaims_MissingReturnNull()
    {
        var (ctl, _, _) = NewCtl(new[]
        {
            new Claim("Connection", ConnClaim),
            new Claim("CurrentTenantID", "1"),
        });

        var view = Assert.IsType<ViewResult>(await ctl.Index());
        var boot = Assert.IsType<AppUserBootstrap>(view.Model);
        Assert.Equal(1, boot.CurrentTenantId);
        Assert.Null(boot.NpAgentId);
        Assert.Null(boot.ContactId);
        Assert.Null(boot.ClientId);
        Assert.Null(boot.ClientCount);
    }

    // ─────────────────────────────────────────────────────────────────────
    // DespatchWebBaseUrl null-guard: empty AppSettings value should surface
    // as null (not "") so the SPA's `!!user.despatchWebBaseUrl` check hides
    // the deep-link.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Index_EmptyDespatchWebBaseUrl_ProjectsNull()
    {
        var settings = new AppSettings
        {
            HereMapsApiKey = "k",
            GoogleMapsKey = "g",
            DespatchWebBaseUrl = string.Empty,
        };
        var (ctl, _, _) = NewCtl(
            new[]
            {
                new Claim("Connection", ConnClaim),
                new Claim("CurrentTenantID", "1"),
            },
            settings: settings);

        var view = Assert.IsType<ViewResult>(await ctl.Index());
        var boot = Assert.IsType<AppUserBootstrap>(view.Model);
        Assert.Null(boot.DespatchWebBaseUrl);
    }

    [Fact]
    public async Task Index_PopulatedDespatchWebBaseUrl_ProjectsValue()
    {
        var settings = new AppSettings { DespatchWebBaseUrl = "https://d.test" };
        var (ctl, _, _) = NewCtl(
            new[]
            {
                new Claim("Connection", ConnClaim),
                new Claim("CurrentTenantID", "1"),
            },
            settings: settings);

        var view = Assert.IsType<ViewResult>(await ctl.Index());
        var boot = Assert.IsType<AppUserBootstrap>(view.Model);
        Assert.Equal("https://d.test", boot.DespatchWebBaseUrl);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Forbidden action - AllowAnonymous view action.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void Forbidden_ReturnsViewResult()
    {
        var (ctl, _, _) = NewCtl();

        var result = ctl.Forbidden();

        Assert.IsType<ViewResult>(result);
    }
}
