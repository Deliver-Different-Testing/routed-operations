using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Threading.Tasks;
using DeliverDifferent.AgentAccess;
using RoutedOperations.API.Authentication;
using RoutedOperations.Core.Application.Security;
using RoutedOperations.Core.Application.Utilities;
using RoutedOperations.Infrastructure;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.Caching.Distributed;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Protocols;
using Microsoft.IdentityModel.Protocols.OpenIdConnect;
using Microsoft.IdentityModel.Tokens;

namespace RoutedOperations.Tests.Api.Authentication;

public class AgentAccessTests : IAsyncDisposable
{
    private const string Hub = "https://hub.test.example";

    private readonly RsaSecurityKey _hubKey = new(RSA.Create(2048)) { KeyId = "k" };
    private readonly IConnectionStringManager _connections = Substitute.For<IConnectionStringManager>();
    private WebApplication? _app;

    private static IConfiguration Config(params (string Key, string? Value)[] values) =>
        new ConfigurationBuilder().AddInMemoryCollection(values.ToDictionary(v => v.Key, v => v.Value)).Build();

    [Fact]
    public void AgentAccess_IsOff_WithoutAHubBaseUrl() =>
        Assert.Null(AppAuthentication.AgentAccessOptionsFrom(Config(("HubBaseUrl", null))));

    [Fact]
    public void AgentAccess_UsesThisTenantsHub_AndTheAppsOwnCredentials()
    {
        var options = AppAuthentication.AgentAccessOptionsFrom(Config(
            ("HubBaseUrl", "https://hub.urgent.example"), ("PartnerDirectoryApiKey", "key"), ("SQLCredentials", "User ID=cfg;")))!;

        Assert.Equal("RoutedOperations", options.AppName);
        Assert.Equal("https://hub.urgent.example", options.HubAuthority);
        Assert.Equal("key", options.HubApiKey);
        Assert.Equal("User ID=cfg;", options.SqlCredentials);
    }

    [Fact]
    public async Task WithoutAgentAccess_TheDefaultSchemeIsStillTheCookie()
    {
        var services = new ServiceCollection().AddLogging();
        services.AddAppAuthentication("localhost");
        var schemes = services.BuildServiceProvider().GetRequiredService<IAuthenticationSchemeProvider>();

        Assert.Equal(AppAuthentication.CookieScheme, (await schemes.GetDefaultAuthenticateSchemeAsync())!.Name);
        Assert.Null(await schemes.GetSchemeAsync(AgentTokenAuthentication.Scheme));
    }

    [Fact]
    public async Task TheConnectionStore_UsesThisAppsOwnCacheKey()
    {
        var store = new AgentTenantConnectionStore(_connections);
        _connections.GetConnectionStringAsync(TenantConnectionCache.Key("7")).Returns("Server=db;");

        Assert.True(await store.HasAsync(7));
        Assert.False(await store.HasAsync(8));
        await store.SetAsync(9, "Server=db9;");
        await _connections.Received(1).SetConnectionStringAsync(TenantConnectionCache.Key("9"), "Server=db9;");
    }

    private async Task<HttpClient> Server(IDistributedCache cache)
    {
        var builder = WebApplication.CreateBuilder();
        builder.WebHost.UseTestServer();
        builder.Services.AddSingleton(cache);
        builder.Services.AddSingleton(_connections);
        builder.Services.AddAppAuthentication("localhost", new AgentAccessOptions
        {
            AppName = "RoutedOperations", HubAuthority = Hub, HubApiKey = "key", SqlCredentials = "User ID=cfg;"
        });
        builder.Services.PostConfigure<JwtBearerOptions>(AgentTokenAuthentication.Scheme, o =>
        {
            var config = new OpenIdConnectConfiguration { Issuer = Hub + "/" };
            config.SigningKeys.Add(_hubKey);
            o.Configuration = config;
            o.ConfigurationManager = new StaticConfigurationManager<OpenIdConnectConfiguration>(config);
        });
        builder.Services.AddAuthorization(options => options.AddPolicy("RouteBuilder.Read", policy =>
            policy.RequireAssertion(context => RouteBuilderPolicies.CanRead(context.User))));
        _app = builder.Build();
        _app.UseAuthentication();
        _app.UseAuthorization();
        _app.MapGet("/api/route-builder/{**rest}", (HttpContext c) => Results.Text(c.Items[AgentTokenAuthentication.OverrideTenantIdItem] as string ?? "none"))
            .RequireAuthorization("RouteBuilder.Read");
        _app.MapGet("/{**rest}", (HttpContext c) => Results.Text(c.Items[AgentTokenAuthentication.OverrideTenantIdItem] as string ?? "none"))
            .RequireAuthorization();
        await _app.StartAsync();
        return _app.GetTestClient();
    }

    private string Token(string clientTypeId = "4") => new JsonWebTokenHandler().CreateToken(new SecurityTokenDescriptor
    {
        Issuer = Hub + "/",
        Audience = "dfrnt-apps",
        Expires = DateTime.UtcNow.AddMinutes(15),
        Subject = new ClaimsIdentity([
            new Claim("sub", "u1"), new Claim("CurrentTenantID", "7"), new Claim("StaffID", "42"), new Claim("ClientTypeId", clientTypeId),
            new Claim("grant_id", "g1"), new Claim("scope", "read"), new Claim("auth_kind", "agent")
        ]),
        SigningCredentials = new SigningCredentials(_hubKey, SecurityAlgorithms.RsaSha256)
    });

    private static IDistributedCache Cache(bool grantLive)
    {
        var cache = new MemoryDistributedCache(Options.Create(new MemoryDistributedCacheOptions()));
        if (grantLive) cache.Set("agent-grant:g1", [1]);
        return cache;
    }

    private static Task<HttpResponseMessage> Send(HttpClient client, string path, string? bearer)
    {
        var request = new HttpRequestMessage(HttpMethod.Get, path);
        if (bearer is not null) request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", bearer);
        return client.SendAsync(request);
    }

    [Fact]
    public async Task AnAgentRead_RunsInTheUsersTenant()
    {
        _connections.GetConnectionStringAsync(TenantConnectionCache.Key("7")).Returns("Server=db;");
        var response = await Send(await Server(Cache(grantLive: true)), "/api/runs", Token());

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("7", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task AnAgentPass_ForANonStaffUser_IsRefused_BeforeAnyPolicyRuns()
    {
        _connections.GetConnectionStringAsync(TenantConnectionCache.Key("7")).Returns("Server=db;");
        Assert.Equal(HttpStatusCode.Unauthorized, (await Send(await Server(Cache(grantLive: true)), "/api/route-builder/runs", Token("1"))).StatusCode);
    }

    [Fact]
    public async Task AnAgentRead_ByTenantStaff_PassesTheRouteBuilderPolicy()
    {
        _connections.GetConnectionStringAsync(TenantConnectionCache.Key("7")).Returns("Server=db;");
        Assert.Equal(HttpStatusCode.OK, (await Send(await Server(Cache(grantLive: true)), "/api/route-builder/runs", Token("4"))).StatusCode);
    }

    [Fact]
    public async Task ARevokedGrant_IsUnauthorized() =>
        Assert.Equal(HttpStatusCode.Unauthorized, (await Send(await Server(Cache(grantLive: false)), "/api/runs", Token())).StatusCode);

    [Fact]
    public async Task ABogusBearer_IsUnauthorized_AndNeverFallsBackToTheCookie() =>
        Assert.Equal(HttpStatusCode.Unauthorized, (await Send(await Server(Cache(grantLive: true)), "/api/runs", "not-a-jwt")).StatusCode);

    [Fact]
    public async Task WithoutABearer_TheCookieChallengeIsUnchanged() =>
        Assert.Equal(HttpStatusCode.Redirect, (await Send(await Server(Cache(grantLive: true)), "/api/runs", null)).StatusCode);

    public async ValueTask DisposeAsync()
    {
        if (_app is not null) await _app.DisposeAsync();
        GC.SuppressFinalize(this);
    }
}
