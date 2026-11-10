using DeliverDifferent.AgentAccess;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using RoutedOperations.Core.Application.Utilities;
using RoutedOperations.Infrastructure;

namespace RoutedOperations.API.Authentication;

public static class AppAuthentication
{
    public const string CookieScheme = "Identity.Application";

    /// <summary>
    /// Agent access (Hub-issued app pass from the MCP server) is on wherever HubBaseUrl is set. Hub keeps it closed per
    /// tenant until its gate opens, so no tenant gets agent traffic before that.
    /// </summary>
    public static AgentAccessOptions? AgentAccessOptionsFrom(IConfiguration configuration)
    {
        var hubUrl = configuration["HubBaseUrl"];
        if (!Uri.TryCreate(hubUrl, UriKind.Absolute, out var hub) || hub.Scheme is not ("http" or "https")) return null;

        return new AgentAccessOptions
        {
            AppName = TenantConnectionCache.AppName,
            HubAuthority = hubUrl!,
            HubApiKey = configuration["PartnerDirectoryApiKey"] ?? string.Empty,
            SqlCredentials = configuration["SQLCredentials"] ?? string.Empty
        };
    }

    // The scheme name MUST be "Identity.Application" to match what Hub (and every other DFRNT app) uses - the
    // CookieAuthenticationHandler derives its DataProtection purpose string from it.
    public static AuthenticationBuilder AddAppAuthentication(this IServiceCollection services, string domain, AgentAccessOptions? agentAccess = null)
    {
        var authentication = services.AddAuthentication(agentAccess is null ? CookieScheme : AgentTokenAuthentication.HubOrAgentScheme)
            .AddCookie(CookieScheme, options =>
            {
                options.Cookie.Name = ".AspNet.SharedCookie";
                options.ExpireTimeSpan = TimeSpan.FromMinutes(20);
                options.SlidingExpiration = true;
                options.AccessDeniedPath = "/Forbidden/";
                options.Events = new CookieAuthenticationEvents
                {
                    OnRedirectToLogin = context =>
                    {
                        context.HttpContext.Response.Redirect(Environment.GetEnvironmentVariable("PublicPath") ?? string.Empty);
                        return Task.CompletedTask;
                    }
                };
                options.Cookie.HttpOnly = true;
                options.Cookie.Domain = domain;
            });

        if (agentAccess is not null)
        {
            authentication.AddHubOrAgentPolicyScheme(CookieScheme).AddAgentTokenAuthentication(agentAccess);
            services.AddAgentTenantConnectionStore<AgentTenantConnectionStore>();
        }

        return authentication;
    }
}
