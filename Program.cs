using System.IO;
using System.Security.AccessControl;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Diagnostics.HealthChecks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.Server.Kestrel.Core;
using Microsoft.AspNetCore.StaticFiles;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.FileProviders;
using RoutedOperations.Core.Application.Services;
using RoutedOperations.Core.Application.Services.Courier;
using RoutedOperations.Core.Application.Services.Job;
using RoutedOperations.Core.Application.Services.Region;
using RoutedOperations.Core.Application.Services.Route;
using RoutedOperations.Core.Application.Services.Run;
using RoutedOperations.Core.Application.Services.Speed;
using RoutedOperations.Core.Application.Services.VehicleSize;
using RoutedOperations.Core.Domain;
using RoutedOperations.Infrastructure;
using Serilog;
using StackExchange.Redis;

// Bootstrap logger active BEFORE WebApplication.CreateBuilder so any early
// startup error (config load, DI wiring) still writes to stdout instead of
// disappearing. Kubernetes captures pod stdout and the cluster log agent
// (CloudWatch Container Insights on AWS, or Datadog agent where deployed)
// ships it centrally - same pattern every DFRNT app uses. No extra sink
// package needed on the app side.
Log.Logger = new LoggerConfiguration()
    .WriteTo.Console()
    .CreateBootstrapLogger();

var builder = WebApplication.CreateBuilder(args);

// Forwarded headers (proxy / K8s ingress).
builder.Services.Configure<ForwardedHeadersOptions>(options =>
{
    options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
    options.KnownIPNetworks.Clear();
    options.KnownProxies.Clear();
});

builder.Configuration.AddJsonFile("appsettings.json", optional: true, reloadOnChange: true);

// Reconfigure Serilog now that appsettings.json is loaded (picks up
// per-environment minimum-level overrides from the "Serilog" section that
// every DFRNT app ships in its appsettings.json).
Log.Logger = new LoggerConfiguration()
    .ReadFrom.Configuration(builder.Configuration)
    .WriteTo.Console()
    .CreateLogger();
builder.Host.UseSerilog();

// Health checks.
builder.Services.AddHealthChecks()
    .AddCheck<SqlServerHealthCheck>("despatch-db");

builder.Services.AddControllersWithViews()
    .AddNewtonsoftJson(options =>
    {
        options.SerializerSettings.ContractResolver =
            new Newtonsoft.Json.Serialization.CamelCasePropertyNamesContractResolver();
        options.SerializerSettings.DateTimeZoneHandling = Newtonsoft.Json.DateTimeZoneHandling.RoundtripKind;
        options.SerializerSettings.DateParseHandling = Newtonsoft.Json.DateParseHandling.DateTimeOffset;
    });

// Memory cache - explicit registration so ConnectionStringManager doesn't
// depend on the framework's transitive AddMvcCore -> AddMemoryCache chain.
builder.Services.AddMemoryCache();

// DataProtection: local file (dev) vs AWS SSM (prod). Mirrors the Configurator pattern so the
// shared cookie stays decryptable across the DFRNT app suite.
if (builder.Environment.IsDevelopment())
{
    var keyDirectory = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "DeliverDifferent", "DataProtection-Keys");

    if (!Directory.Exists(keyDirectory))
    {
        var dirInfo = Directory.CreateDirectory(keyDirectory);

        if (OperatingSystem.IsWindows())
        {
            var currentUser = System.Security.Principal.WindowsIdentity.GetCurrent();
            var accessRule = new FileSystemAccessRule(
                currentUser.Name,
                FileSystemRights.FullControl,
                InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit,
                PropagationFlags.None,
                AccessControlType.Allow);

            var security = dirInfo.GetAccessControl();
            security.AddAccessRule(accessRule);
            dirInfo.SetAccessControl(security);
        }
    }

    if (OperatingSystem.IsWindows())
    {
        builder.Services.AddDataProtection()
            .PersistKeysToFileSystem(new DirectoryInfo(keyDirectory))
            .SetApplicationName("DeliverDifferent")
            .ProtectKeysWithDpapi();
    }
}
else
{
    builder.Services.AddDataProtection()
        .PersistKeysToAWSSystemsManager("/Hub/DataProtection")
        .SetApplicationName("DeliverDifferent");
}

// Strongly-typed AppSettings singleton.
var appSettings = new AppSettings
{
    RouteSavvyAppId = builder.Configuration["RouteSavyID"] ?? string.Empty,
    HereMapsApiKey = builder.Configuration["HeremapApiKey"] ?? string.Empty,
    GoogleMapsKey = builder.Configuration["GoogleMapsKey"] ?? string.Empty,
};
builder.Services.AddSingleton(appSettings);

builder.Services.AddSingleton<IConnectionStringManager, ConnectionStringManager>();

// Cookie policy.
builder.Services.Configure<CookiePolicyOptions>(options =>
{
    options.CheckConsentNeeded = _ => true;
    options.MinimumSameSitePolicy = SameSiteMode.Lax;
    options.Secure = builder.Environment.IsDevelopment()
        ? CookieSecurePolicy.SameAsRequest
        : CookieSecurePolicy.Always;
});

// File size limits (25 MB).
const long maxFileSize = 25L * 1024 * 1024;
builder.Services.Configure<FormOptions>(x =>
{
    x.ValueLengthLimit = (int)maxFileSize;
    x.MultipartBodyLengthLimit = maxFileSize;
    x.MultipartHeadersLengthLimit = 32768;
});
builder.Services.Configure<IISServerOptions>(options => { options.MaxRequestBodySize = maxFileSize; });
builder.Services.Configure<KestrelServerOptions>(options => { options.Limits.MaxRequestBodySize = maxFileSize; });

// Authorization policies matching the parity build plan.
builder.Services.AddAuthorization(options =>
{
    // Read - any authenticated tenant user can see the cockpit.
    options.AddPolicy("RouteBuilder.Read", policy =>
        policy.RequireAssertion(context =>
        {
            var tenantId = context.User.FindFirst("CurrentTenantID")?.Value;
            return !string.IsNullOrEmpty(tenantId);
        }));

    // Build - author runs. Same admit rule as Read for Stage 1; matrix will refine later.
    options.AddPolicy("RouteBuilder.Build", policy =>
        policy.RequireAssertion(context =>
        {
            var tenantId = context.User.FindFirst("CurrentTenantID")?.Value;
            var isCourier = context.User.FindFirst("IsCourier")?.Value;
            return !string.IsNullOrEmpty(tenantId)
                && !string.Equals(isCourier, "True", StringComparison.OrdinalIgnoreCase);
        }));

    // Admin - dispatch + destructive ops.
    options.AddPolicy("RouteBuilder.Admin", policy =>
        policy.RequireAssertion(context =>
        {
            var userGroupId = context.User.FindFirst("UserGroupID")?.Value;
            var tenantId = context.User.FindFirst("CurrentTenantID")?.Value;
            var isCourier = context.User.FindFirst("IsCourier")?.Value;
            if (string.Equals(userGroupId, "1", StringComparison.Ordinal)) return true;
            return !string.IsNullOrEmpty(tenantId)
                && !string.Equals(isCourier, "True", StringComparison.OrdinalIgnoreCase);
        }));

    // Placeholder policies for the deferred modules so controller scaffolds compile.
    options.AddPolicy("RouteBuilder.Quote", policy =>
        policy.RequireAssertion(context =>
            !string.IsNullOrEmpty(context.User.FindFirst("CurrentTenantID")?.Value)));
    options.AddPolicy("RouteBuilder.Polygon", policy =>
        policy.RequireAssertion(context =>
            !string.IsNullOrEmpty(context.User.FindFirst("CurrentTenantID")?.Value)));
});

builder.Services.AddHttpClient();
builder.Services.AddHttpContextAccessor();

// Application services (per the parity plan).
builder.Services.AddScoped<JobService>();
builder.Services.AddScoped<RunService>();
builder.Services.AddScoped<RunCommitService>();
builder.Services.AddScoped<HdJobSyncService>();
builder.Services.AddScoped<VoidJobService>();
builder.Services.AddScoped<BulkRegionService>();
builder.Services.AddScoped<SpeedService>();
builder.Services.AddScoped<VehicleSizeService>();
builder.Services.AddScoped<CourierService>();
builder.Services.AddScoped<RouteOptimizationService>();
builder.Services.AddScoped<HereMapService>();

// DespatchContext registered with a placeholder connection string; the real one is
// resolved per-request from the tenant claim by DynamicDespatchDbContextFactory.
builder.Services.AddDbContextFactory<DespatchContext>(options =>
        options.UseSqlServer("Server=(localdb)\\mssqllocaldb;Database=dummy;Trusted_Connection=True;"),
    ServiceLifetime.Transient);

builder.Services.AddScoped<IDbContextFactory<DespatchContext>, DynamicDespatchDbContextFactory>();
builder.Services.AddScoped<IDbContextFactory<DynamicDespatchDbContext>>(sp =>
{
    var inner = sp.GetRequiredService<IDbContextFactory<DespatchContext>>();
    return new DynamicDespatchDbContextFactoryAdapter(inner);
});

// Warm the large EF model at startup so first-request latency stays low.
builder.Services.AddHostedService<EfModelWarmupService>();

// Cookie domain - shared with the rest of the DFRNT app suite.
var domain = Environment.GetEnvironmentVariable("Domain") ?? string.Empty;
if (string.IsNullOrEmpty(domain))
    throw new InvalidOperationException("Env var 'Domain' is not set - shared cookie cannot be issued.");
if (!domain.StartsWith('.'))
    domain = "." + domain;

// Redis distributed cache + session.
var redisConfig = Environment.GetEnvironmentVariable("RedisConfig");
if (string.IsNullOrEmpty(redisConfig))
    throw new InvalidOperationException("Env var 'RedisConfig' is not set - Redis session store is required.");
var redisConfigurationOptions = ConfigurationOptions.Parse(redisConfig);
builder.Services.AddStackExchangeRedisCache(redisCacheConfig =>
{
    redisCacheConfig.ConfigurationOptions = redisConfigurationOptions;
});

// Shared cookie auth. The scheme name MUST be "Identity.Application" to match
// what Hub (and every other DFRNT app) uses - the CookieAuthenticationHandler
// derives its DataProtection purpose string from the scheme name, so a mismatch
// makes cookies from other apps undecryptable and every request lands as
// unauthenticated no matter how good the cookie looks in the browser.
builder.Services.AddAuthentication("Identity.Application")
    .AddCookie("Identity.Application", options =>
    {
        options.Cookie.Name = ".AspNet.SharedCookie";
        options.ExpireTimeSpan = TimeSpan.FromMinutes(20);
        options.SlidingExpiration = true;
        options.AccessDeniedPath = "/Forbidden/";
        options.Events = new CookieAuthenticationEvents
        {
            OnRedirectToLogin = context =>
            {
                context.HttpContext.Response.Redirect(
                    Environment.GetEnvironmentVariable("PublicPath") ?? string.Empty);
                return Task.CompletedTask;
            }
        };
        options.Cookie.HttpOnly = true;
        options.Cookie.Domain = domain;
    });

builder.Services.AddSession(options =>
{
    options.Cookie.Name = "routed_operations_session";
    options.IdleTimeout = TimeSpan.FromMinutes(60 * 24);
});

var app = builder.Build();

// Liveness probe - no checks.
app.MapHealthChecks("/health/live", new HealthCheckOptions { Predicate = _ => false });

app.UseForwardedHeaders();

// Readiness probe - SqlServer check with a JSON body.
app.MapHealthChecks("/healthz", new HealthCheckOptions
{
    ResponseWriter = async (context, report) =>
    {
        context.Response.ContentType = "application/json";
        var response = new
        {
            Status = report.Status.ToString(),
            Checks = report.Entries.Select(e => new
            {
                Component = e.Key,
                Status = e.Value.Status.ToString(),
                e.Value.Description
            }),
            Duration = report.TotalDuration
        };
        await context.Response.WriteAsJsonAsync(response);
    }
});

// Serve the Vite build output at /dist/*.
var provider = new FileExtensionContentTypeProvider
{
    Mappings =
    {
        [".map"] = "application/json",
        [".mjs"] = "text/javascript"
    }
};

app.UseStaticFiles(new StaticFileOptions
{
    ContentTypeProvider = provider
});

app.UseStaticFiles(new StaticFileOptions
{
    FileProvider = new PhysicalFileProvider(
        Path.Combine(builder.Environment.ContentRootPath, "wwwroot", "dist")),
    RequestPath = "/dist",
    ContentTypeProvider = provider,
    // Vite writes to fixed filenames (app.js / app.css) with no content hash,
    // so browsers cache them aggressively and don't re-fetch after a rebuild.
    // In dev, force no-cache so every request revalidates with an If-None-Match.
    // Prod deploys should switch to hashed filenames or add a build-id query
    // string on the <script src> in Views/Home/Index.cshtml.
    OnPrepareResponse = ctx =>
    {
        if (app.Environment.IsDevelopment())
        {
            ctx.Context.Response.Headers.CacheControl = "no-cache, no-store, must-revalidate";
            ctx.Context.Response.Headers.Pragma = "no-cache";
            ctx.Context.Response.Headers.Expires = "0";
        }
    }
});

// CSRF: browsers must send X-Requested-With for state-changing requests.
app.Use(async (context, next) =>
{
    var method = context.Request.Method;
    var isStateChanging = method is "POST" or "PUT" or "PATCH" or "DELETE";
    if (isStateChanging && !context.Request.Path.StartsWithSegments("/healthz"))
    {
        var hasXhr = context.Request.Headers.XRequestedWith == "XMLHttpRequest";
        if (!hasXhr)
        {
            context.Response.StatusCode = 400;
            await context.Response.WriteAsync("Invalid request - missing required header");
            return;
        }
    }
    await next();
});

// Security headers.
app.Use(async (context, next) =>
{
    var headers = context.Response.Headers;
    headers.XContentTypeOptions = "nosniff";
    headers.XFrameOptions = "DENY";
    headers["Referrer-Policy"] = "strict-origin-when-cross-origin";
    headers["Permissions-Policy"] = "geolocation=(), microphone=()";

    if (!app.Environment.IsDevelopment())
        headers.StrictTransportSecurity = "max-age=31536000; includeSubDomains";

    var csp =
        "default-src 'self'; " +
        "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.api.here.com https://maps.googleapis.com https://maps.gstatic.com; " +
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://js.api.here.com https://maps.googleapis.com; " +
        "img-src 'self' data: blob: https:; " +
        "font-src 'self' https://fonts.gstatic.com data:; " +
        "connect-src 'self' blob: wss: ws: https://*.hereapi.com https://*.here.com https://*.base.maps.ls.hereapi.com https://maps.googleapis.com https://maps.gstatic.com" +
            (app.Environment.IsDevelopment() ? " http://localhost:*" : "") + "; " +
        "worker-src 'self' blob:; " +
        "frame-ancestors 'none'; " +
        "frame-src 'self' blob:; " +
        "object-src 'none'; " +
        "manifest-src 'self'; " +
        "base-uri 'self'; " +
        "form-action 'self';";

    if (!app.Environment.IsDevelopment())
        csp += " upgrade-insecure-requests;";

    headers.ContentSecurityPolicy = csp;
    await next();
});

app.UseCookiePolicy();
app.UseRouting();
app.UseAuthentication();
app.UseAuthorization();
app.UseSession();

// One structured log line per HTTP request (method, path, status, duration).
// Replaces the noisy default ASP.NET Core request logs. Serialised to stdout
// where the K8s log agent picks it up as a searchable structured event
// (CloudWatch and Datadog both handle Serilog's JSON format out of the box).
app.UseSerilogRequestLogging();

app.MapControllerRoute(
    name: "default",
    pattern: "{controller=Home}/{action=Index}/{id?}");

// SPA fallback - unmatched non-API paths render the React shell.
app.MapFallbackToController("Index", "Home");

app.Run();
