using System.IO;
using System.Security.AccessControl;
using System.Threading.Tasks;
using FluentValidation;
using FluentValidation.AspNetCore;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Diagnostics.HealthChecks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.ResponseCompression;
using Microsoft.AspNetCore.Server.Kestrel.Core;
using Microsoft.AspNetCore.StaticFiles;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.FileProviders;
using RoutedOperations.Core.Application.Services;
using RoutedOperations.Core.Application.Services.Courier;
using RoutedOperations.Core.Application.Services.Job;
using RoutedOperations.Core.Application.Services.Region;
using RoutedOperations.Core.Application.Services.Routing;
using RoutedOperations.Core.Application.Services.Run;
using RoutedOperations.Core.Application.Services.Quote;
using RoutedOperations.Core.Application.Services.RecurringRoute;
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

builder.Services.AddControllersWithViews(mvc =>
    {
        // Match legacy BulkImportHyper's model-binding behaviour: legacy runs on
        // a stack without Nullable Reference Types, so DTO strings without an
        // explicit [Required] attribute accept JSON null happily. Under .NET 8+
        // NRT semantics, every non-nullable `string` property becomes an
        // implicit [Required], which rejected valid legacy payloads like
        // PickupJobToCreateDto's Return/ShopRef1..5/CourierNotes/etc. with 400.
        // Suppressing the implicit rule restores parity - explicit [Required]
        // and FluentValidation rules still apply where authors added them.
        mvc.SuppressImplicitRequiredAttributeForNonNullableReferenceTypes = true;
    })
    .AddNewtonsoftJson(options =>
    {
        options.SerializerSettings.ContractResolver =
            new Newtonsoft.Json.Serialization.CamelCasePropertyNamesContractResolver();
        options.SerializerSettings.DateTimeZoneHandling = Newtonsoft.Json.DateTimeZoneHandling.RoundtripKind;
        options.SerializerSettings.DateParseHandling = Newtonsoft.Json.DateParseHandling.DateTimeOffset;
    });

// FluentValidation auto-validation. Discovers every IValidator<T> in this
// assembly and wires it into MVC's model-binding pipeline so [FromBody]
// requests get validated before the action executes. Mirrors the same
// three-line block BulkImportHyper's Program.cs uses.
builder.Services.AddFluentValidationAutoValidation();
builder.Services.AddFluentValidationClientsideAdapters();
builder.Services.AddValidatorsFromAssemblyContaining<Program>();

// Memory cache - explicit registration so ConnectionStringManager doesn't
// depend on the framework's transitive AddMvcCore -> AddMemoryCache chain.
builder.Services.AddMemoryCache();

// Response compression. The cockpit's /api/jobs response for a busy day is
// ~400-600 KB of JSON uncompressed; Brotli or Gzip typically shrinks that
// 5-10x. Brotli preferred when the browser accepts it, Gzip as fallback.
// EnableForHttps=true because local + prod both serve over TLS via the
// shared cookie domain, and BREACH-style attacks aren't a concern for
// authenticated JSON responses that don't reflect user input verbatim.
builder.Services.AddResponseCompression(options =>
{
    options.EnableForHttps = true;
    options.Providers.Add<BrotliCompressionProvider>();
    options.Providers.Add<GzipCompressionProvider>();
});
builder.Services.Configure<BrotliCompressionProviderOptions>(o =>
{
    o.Level = System.IO.Compression.CompressionLevel.Fastest;
});
builder.Services.Configure<GzipCompressionProviderOptions>(o =>
{
    o.Level = System.IO.Compression.CompressionLevel.Fastest;
});

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
// GoogleMapsDevKey resolution: in Development, prefer DevKey when set so
// the local browser hits an unbilled / referrer-free key instead of the
// prod-scoped one. The SPA still reads a single `googleMapsKey` field
// via the bootstrap blob; the pick happens here so no frontend branch is
// needed. In non-Development environments the prod key wins.
var googleMapsDevKey = builder.Configuration["GoogleMapsDevKey"] ?? string.Empty;
var googleMapsProdKey = builder.Configuration["GoogleMapsKey"] ?? string.Empty;
var effectiveGoogleMapsKey =
    builder.Environment.IsDevelopment() && !string.IsNullOrEmpty(googleMapsDevKey)
        ? googleMapsDevKey
        : googleMapsProdKey;
var appSettings = new AppSettings
{
    RouteSavvyAppId = builder.Configuration["RouteSavyID"] ?? string.Empty,
    HereMapsApiKey = builder.Configuration["HeremapApiKey"] ?? string.Empty,
    GoogleMapsKey = effectiveGoogleMapsKey,
    GoogleMapsDevKey = googleMapsDevKey,
    // Mirrors Configurator's Program.cs pattern - trim trailing slash so the
    // SPA can safely concatenate paths like `/#!/recurringJobs` without
    // getting a "//".
    DespatchWebBaseUrl = (builder.Configuration["DespatchWebBaseUrl"] ?? string.Empty).TrimEnd('/'),
    // Route Viewer P0 - SSRS env-var contract. Populated at startup so P11
    // Report module bodies read from a strongly-typed source instead of
    // Environment.GetEnvironmentVariable at request time.
    ReportBase = (builder.Configuration["ReportBase"] ?? string.Empty).TrimEnd('/'),
    ReportUsername = builder.Configuration["ReportUsername"] ?? string.Empty,
    ReportPassword = builder.Configuration["ReportPassword"] ?? string.Empty,
    ReportDomain = builder.Configuration["ReportDomain"] ?? string.Empty,
    SslCertificate = builder.Configuration["SSL_CERTIFICATE"] ?? string.Empty,
};
builder.Services.AddSingleton(appSettings);

if (string.IsNullOrEmpty(appSettings.DespatchWebBaseUrl))
{
    Log.Warning("DespatchWebBaseUrl not set - the Recurring Jobs tab (deep-link to DespatchWeb) and the Used-by-Schedules 'Open' links will be hidden.");
}
else
{
    Log.Information("DespatchWebBaseUrl: {Url}", appSettings.DespatchWebBaseUrl);
}

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

// File size limits. 20 MB cap prevents a ZIP-bomb XLSX from expanding to
// millions of cells and OOMing the shared multi-tenant pod. Controller
// [RequestSizeLimit] carries the same cap so the rejection lands
// consistently at every layer.
const long maxFileSize = 20L * 1024 * 1024;
builder.Services.Configure<FormOptions>(x =>
{
    x.ValueLengthLimit = (int)maxFileSize;
    x.MultipartBodyLengthLimit = maxFileSize;
    x.MultipartHeadersLengthLimit = 32768;
});
builder.Services.Configure<IISServerOptions>(options => { options.MaxRequestBodySize = maxFileSize; });
builder.Services.Configure<KestrelServerOptions>(options =>
{
    options.Limits.MaxRequestBodySize = maxFileSize;
    // Phase 1 Task 7: mirror BulkImportHyper's 15-minute header timeout so
    // long-running direct-insert imports (Excel parse + N job inserts +
    // linehaul split) don't get chopped off by Kestrel's 30-second default.
    // Paired with AddRequestTimeouts below for the response-side cap.
    options.Limits.RequestHeadersTimeout = TimeSpan.FromMinutes(15);
    options.Limits.KeepAliveTimeout = TimeSpan.FromMinutes(15);
});

// Phase 1 Task 7: 15-minute request timeout policy for the direct-insert
// bulk-import flow. Applied as the default so every controller inherits
// it, matching BulkImportHyper's Program.cs. Deliberately using 408
// (Request Timeout) rather than 503 - the request itself timed out, the
// service is still healthy, and the React wizard renders a friendlier
// message for 408 than for a generic Service Unavailable.
builder.Services.AddRequestTimeouts(options =>
{
    options.DefaultPolicy = new Microsoft.AspNetCore.Http.Timeouts.RequestTimeoutPolicy
    {
        Timeout = TimeSpan.FromMinutes(15),
        TimeoutStatusCode = StatusCodes.Status408RequestTimeout
    };
});

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

    // Route Viewer P0 policies (2026-08-07). Parallel to the RouteBuilder
    // set so downstream policy changes on RouteBuilder cannot silently
    // affect Route Viewer. NpScope is a marker that a controller expects
    // to run under NP-aware guard rails; the actual row-level enforcement
    // is done via INpScopeGuard.
    options.AddPolicy("RouteViewer.Read", policy =>
        policy.RequireAssertion(context =>
            !string.IsNullOrEmpty(context.User.FindFirst("CurrentTenantID")?.Value)));
    options.AddPolicy("RouteViewer.Admin", policy =>
        policy.RequireAssertion(context =>
        {
            var userGroupId = context.User.FindFirst("UserGroupID")?.Value;
            var tenantId = context.User.FindFirst("CurrentTenantID")?.Value;
            var isCourier = context.User.FindFirst("IsCourier")?.Value;
            if (string.Equals(userGroupId, "1", StringComparison.Ordinal)) return true;
            return !string.IsNullOrEmpty(tenantId)
                && !string.Equals(isCourier, "True", StringComparison.OrdinalIgnoreCase);
        }));
    options.AddPolicy("RouteViewer.NpScope", policy =>
        policy.RequireAssertion(context =>
            !string.IsNullOrEmpty(context.User.FindFirst("CurrentTenantID")?.Value)));
});

builder.Services.AddHttpClient();
builder.Services.AddHttpContextAccessor();

// Tenant-scoped in-memory cache helper (Phase 2 perf). Wraps IMemoryCache
// with a per-request tenant prefix so lookup responses (couriers, speeds,
// regions, suburbs, ...) never leak across tenants. Scoped lifetime picks up
// the correct HttpContext per request; the underlying IMemoryCache is
// Singleton via AddMemoryCache() above.
builder.Services.AddScoped<RoutedOperations.Core.Application.Utilities.TenantScopedCache>();

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
// HERE Maps geocoder (address -> lat/lng). Consumed by the BulkImportHyper
// AddressService (fallback path) and any other service that needs geocoding.
// Typed HttpClient with a 5-second timeout so a HERE outage does not stall
// the request on the default 100 s. AddHttpClient<T>() is Transient by
// default; the extra Scoped registration below pulls the transient client
// on demand so existing constructor injection keeps working.
builder.Services.AddHttpClient<HereGeocodeService>(client =>
{
    client.Timeout = TimeSpan.FromSeconds(5);
});
// Stage 2 - sibling modules.
builder.Services.AddScoped<QuoteService>();
builder.Services.AddScoped<RecurringRouteService>();
builder.Services.AddScoped<RoutedOperations.Core.Application.Services.RecurringLinehaul.RecurringLinehaulService>();
builder.Services.AddScoped<RoutedOperations.Core.Application.Services.RecurringLinehaul.RecurringLinehaulJobsService>();
builder.Services.AddScoped<RoutedOperations.Core.Application.Services.BulkPolygon.BulkPolygonService>();
// Polygon Builder VIEW Zones drawer + resolver diagnostic page.
builder.Services.AddScoped<RoutedOperations.Core.Application.Services.Zone.ZoneLookupService>();
// Schedules module (nightly booking templates + territory maintenance).
builder.Services.AddScoped<RoutedOperations.Core.Application.Services.Schedule.ScheduleService>();
builder.Services.AddScoped<RoutedOperations.Core.Application.Services.Schedule.ScheduleOverrideService>();
// Driver Scheduling module (2026-09-07 port from CourierManager). Two
// per-tenant abstractions live behind the service - PhoneNormaliser
// reads the CountryCode auth claim, HubUrlProvider reads DriverHubUrl.
// See plan `abundant-sniffing-sparkle.md` phase 3 for the modernise
// rationale (NZ + US Day-1 live).
builder.Services.AddScoped<RoutedOperations.Core.Application.Services.DriverScheduling.IPhoneNormaliser,
                           RoutedOperations.Core.Application.Services.DriverScheduling.PhoneNormaliser>();
builder.Services.AddScoped<RoutedOperations.Core.Application.Services.DriverScheduling.IHubUrlProvider,
                           RoutedOperations.Core.Application.Services.DriverScheduling.HubUrlProvider>();
builder.Services.AddScoped<RoutedOperations.Core.Application.Services.DriverScheduling.DriverSchedulingService>();
builder.Services.AddScoped<RoutedOperations.Core.Application.Services.Territory.TerritoryService>();
builder.Services.AddScoped<RoutedOperations.Core.Application.Services.Territory.PolygonBindingService>();
builder.Services.AddScoped<RoutedOperations.Core.Application.Services.Diagnostics.AutoAssignLogService>();
// Historic Archive Upload (2026-08-19). Writes legacy job-history rows
// into tucJobArchive with the billing-sentinel recipe. Scoped so the
// per-request DynamicDespatchDbContext + IHttpContextAccessor claim
// lookups behave.
builder.Services.AddScoped<RoutedOperations.Core.Application.Services.HistoricArchive.HistoricArchiveService>();

// Route Viewer P0 (2026-08-07) - NP-scope services. Scoped lifetime so
// the per-request HttpContext.Items cache on NpScopeResolver behaves.
// Every Route Viewer read/write path resolves scope + guards rows before
// returning; controllers translate NpLabelScopeException to HTTP 403.
builder.Services.AddScoped<
    RoutedOperations.Core.Application.Services.Np.INpScopeResolver,
    RoutedOperations.Core.Application.Services.Np.NpScopeResolver>();
builder.Services.AddScoped<
    RoutedOperations.Core.Application.Services.Np.INpScopeGuard,
    RoutedOperations.Core.Application.Services.Np.NpScopeGuard>();

// Route Viewer P1 (2026-08-07) - read-side services. Scoped lifetime;
// each service extends BaseService for lazy DynamicDespatchDbContext.
// SqlTimeZoneNormalizer is scoped too even though the host-platform
// probe is static-cached, because it takes IDbContextFactory to run
// the probe on first use.
builder.Services.AddScoped<RoutedOperations.Core.Application.Services.RouteViewer.SqlTimeZoneNormalizer>();
builder.Services.AddScoped<RoutedOperations.Core.Application.Services.RouteViewer.RouteViewerRunService>();
builder.Services.AddScoped<RoutedOperations.Core.Application.Services.RouteViewer.RouteViewerFilterService>();
builder.Services.AddScoped<RoutedOperations.Core.Application.Services.RouteViewer.RouteViewerCourierService>();
builder.Services.AddScoped<RoutedOperations.Core.Application.Services.RouteViewer.RouteViewerJobService>();
builder.Services.AddScoped<RoutedOperations.Core.Application.Services.RouteViewer.RouteViewerScanService>();

// Route Viewer P0 close-out (2026-08-07) - AWS S3 for POD photo +
// Client Intel image reads; AWS SES for the P7 SendPOD email path
// (SDK + DI wired at P0 close so P7 only writes the service body).
// Region defaults to APSoutheast2 to match legacy RunViewer
// (Program.cs used same). Credentials resolve via the standard AWSSDK
// chain (env vars in prod, SSO / FallbackFactory in dev).
builder.Services.AddDefaultAWSOptions(new Amazon.Extensions.NETCore.Setup.AWSOptions
{
    Region = Amazon.RegionEndpoint.APSoutheast2,
});
builder.Services.AddAWSService<Amazon.S3.IAmazonS3>();
builder.Services.AddAWSService<Amazon.SimpleEmail.IAmazonSimpleEmailService>();
builder.Services.AddScoped<RoutedOperations.Core.Application.Services.RouteViewer.S3PhotoReader>();
builder.Services.AddScoped<RoutedOperations.Core.Application.Services.RouteViewer.RouteViewerEventService>();
builder.Services.AddScoped<RoutedOperations.Core.Application.Services.RouteViewer.RouteViewerAssignmentService>();
builder.Services.AddScoped<RoutedOperations.Core.Application.Services.RouteViewer.RouteViewerRouteTransferService>();
// RouteViewerLabelService generates label PDFs directly via the shared
// DeliverDifferent.AlertLabel.Data package (GitLab project 809). Keeps
// a typed HttpClient for the two still-proxied endpoints
// (SendPodEmailAsync + GetLineHaulManifestCsvAsync); those two require
// env var RunViewerLabelProxyUrl to be set until they are ported off
// legacy. Label PDFs no longer need any env var. Swapped 2026-09-18
// from the P14-interim HTTP proxy.
DeliverDifferent.AlertLabel.Data.Extensions.ServiceCollectionExtensions.AddAlertLabelService(builder.Services);
builder.Services.AddHttpClient<RoutedOperations.Core.Application.Services.RouteViewer.RouteViewerLabelService>(client =>
{
    client.Timeout = TimeSpan.FromSeconds(60);
});
builder.Services.AddScoped<RoutedOperations.Core.Application.Services.RouteViewer.RouteViewerReportService>();
builder.Services.AddScoped<RoutedOperations.Core.Application.Services.RouteViewer.RouteViewerJobActionService>();
// NWShip / GoSweetSpot booking transport (Redelivery + One-off + Top-up).
// Typed HttpClient so the base URL / timeout is per-service isolated;
// bearer token is read at call time from env NWSHIP_API_TOKEN.
builder.Services.AddHttpClient<RoutedOperations.Core.Application.Services.RouteViewer.NwShipBookingService>(client =>
{
    client.Timeout = TimeSpan.FromSeconds(30);
});
// BulkImportHyper direct-insert service quartet (Phase 1 Task 6).
// BulkImportServiceV2 is a partial class split across three files
// (BulkImportServiceV2.cs + BulkImportJobFactory.cs + BulkImportRatingService.cs)
// - a single Scoped registration covers all three surfaces. The peer
// services below (Address/Client/Template/Tenant) are what the new
// BulkImport / Clients / Address controllers depend on.
builder.Services.AddScoped<RoutedOperations.Core.Application.Services.BulkImport.BulkImportServiceV2>();
builder.Services.AddScoped<RoutedOperations.Core.Application.Services.BulkImport.AddressService>();
builder.Services.AddScoped<RoutedOperations.Core.Application.Services.BulkImport.ClientService>();
builder.Services.AddScoped<RoutedOperations.Core.Application.Services.BulkImport.TemplateService>();
// TenantService is stateless + only reads IWebHostEnvironment - Singleton
// is safe and matches the source's registration lifetime.
builder.Services.AddSingleton<RoutedOperations.Core.Application.Services.BulkImport.ITenantService,
    RoutedOperations.Core.Application.Services.BulkImport.TenantService>();

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

// Response compression - registered before UseStaticFiles + UseRouting so
// every response (static assets + API JSON) gets a chance to be compressed.
// The middleware inspects the Accept-Encoding header and content type; only
// text-like responses (JSON, JS, CSS, HTML) get compressed by default.
app.UseResponseCompression();

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
// Phase 1 Task 7: activate the RequestTimeouts middleware BEFORE routing
// so a slow bulk-import request is bounded at the pipeline entry point,
// not after routing has already matched an endpoint. Paired with the
// Kestrel RequestHeadersTimeout / KeepAliveTimeout bumps above.
app.UseRequestTimeouts();
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
