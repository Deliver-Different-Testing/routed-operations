
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Diagnostics.HealthChecks;
using Microsoft.AspNetCore.StaticFiles;
using Microsoft.EntityFrameworkCore;
using RunBuilder;
using RunBuilder.Models;
using RunBuilder.Models.Repository;
using Serilog;
using StackExchange.Redis;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddHealthChecks()
    .AddCheck<SqlServerHealthCheck>("sql_server_health_check");
builder.Configuration.AddJsonFile("appsettings.json", optional: true, reloadOnChange: true);
Log.Logger = new LoggerConfiguration().ReadFrom.Configuration(builder.Configuration).WriteTo.Console().CreateLogger();
if (builder.Environment.IsDevelopment())
{
    var keyDirectory = System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "DeliverDifferent", "DataProtection-Keys");


    // Ensure directory exists with proper permissions
    if (!Directory.Exists(keyDirectory))
    {
        var dirInfo = Directory.CreateDirectory(keyDirectory);

        if (OperatingSystem.IsWindows())
        {
            // Get current user's identity
            var currentUser = System.Security.Principal.WindowsIdentity.GetCurrent();
            var fileSystemRights = System.Security.AccessControl.FileSystemRights.FullControl;
            var inheritanceFlags = System.Security.AccessControl.InheritanceFlags.ContainerInherit |
                                   System.Security.AccessControl.InheritanceFlags.ObjectInherit;
            var propagationFlags = System.Security.AccessControl.PropagationFlags.None;
            var accessControlType = System.Security.AccessControl.AccessControlType.Allow;

            var accessRule = new System.Security.AccessControl.FileSystemAccessRule(
                currentUser.Name,
                fileSystemRights,
                inheritanceFlags,
                propagationFlags,
                accessControlType);

            var security = dirInfo.GetAccessControl();
            security.AddAccessRule(accessRule);
            dirInfo.SetAccessControl(security);
        }
    }

    builder.Services.AddDataProtection()
        .PersistKeysToFileSystem(new DirectoryInfo(keyDirectory))
        .SetApplicationName("DeliverDifferent")
        .ProtectKeysWithDpapi();

    Log.Information($"DataProtection configured to use directory: {keyDirectory}");

}
else
{
    builder.Services.AddDataProtection().PersistKeysToAWSSystemsManager("/Hub/DataProtection").SetApplicationName("DeliverDifferent");
}

builder.Services.AddSingleton<IConnectionStringManager, ConnectionStringManager>();
// Add services to the container.
builder.Services.AddControllersWithViews().AddJsonOptions(options =>
    options.JsonSerializerOptions.PropertyNamingPolicy = null); 


builder.Services.AddHttpClient<RouteRepository>(client =>
{
    client.DefaultRequestHeaders.Add("Accept", "application/json");
    client.Timeout = TimeSpan.FromSeconds(60); // Adjust timeout as needed
});

builder.Services.AddHttpContextAccessor();



builder.Services.AddDbContextFactory<DespatchContext>(options =>
    options.UseSqlServer(
        "Server=(localdb)\\mssqllocaldb;Database=dummy;Trusted_Connection=True;"
    ), ServiceLifetime.Transient);

builder.Services.AddScoped<IDbContextFactory<DynamicDespatchDbContext>, DynamicDespatchDbContextFactory>();


var domain = Environment.GetEnvironmentVariable("Domain") ?? "";
if (string.IsNullOrEmpty(domain))
{
    throw new InvalidOperationException(
        "Could not find a env var string named 'Domain'.");
}

// Configure Redis Based Distributed Session
var redisConfig = Environment.GetEnvironmentVariable("RedisConfig");
if (string.IsNullOrEmpty(redisConfig))
{
    throw new InvalidOperationException(
        "Could not find a Redis Env Var named 'RedisConfig'.");
}
var redisConfigurationOptions = ConfigurationOptions.Parse(redisConfig);

builder.Services.AddStackExchangeRedisCache(redisCacheConfig =>
{
    redisCacheConfig.ConfigurationOptions = redisConfigurationOptions;
});

try 
{
    var redis = ConnectionMultiplexer.Connect(redisConfigurationOptions);
    Log.Information("Redis connection successful");
}
catch (Exception ex)
{
    Log.Error(ex, "Redis connection failed");
}
builder.Services.AddAuthentication("Identity.Application")
    .AddCookie("Identity.Application", options =>
    {
        options.Cookie.Name = ".AspNet.SharedCookie";
        options.ExpireTimeSpan = TimeSpan.FromMinutes(20);
        options.SlidingExpiration = true;
        options.AccessDeniedPath = "/Forbidden/";
        options.Events = new CookieAuthenticationEvents()
        {
            OnRedirectToLogin = (context) =>
            {
                context.HttpContext.Response.Redirect(Environment.GetEnvironmentVariable("PublicPath") ?? "");
                return Task.CompletedTask;
            }
        };
        options.Cookie.HttpOnly = true;
        options.Cookie.Domain = domain;
    });



builder.Services.AddSession(options => {
    options.Cookie.Name = "hub_session";
    options.IdleTimeout = TimeSpan.FromMinutes(60 * 24);
});


builder.Services.AddScoped<JobRepository, JobRepository>();
builder.Services.AddScoped<RouteRepository, RouteRepository>();
builder.Services.AddScoped<CourierRepository, CourierRepository>();
builder.Services.AddScoped<GoogleDirectionRepository, GoogleDirectionRepository>();

var app = builder.Build();

if (!app.Environment.IsDevelopment())
{
    app.UseHsts();
}


app.MapHealthChecks("/health/live", new HealthCheckOptions { Predicate = _ => false });
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
                Description = e.Value.Description
            }),
            Duration = report.TotalDuration
        };

        await context.Response.WriteAsJsonAsync(response);
    }
});

// Configure the HTTP request pipeline.
var provider = new FileExtensionContentTypeProvider { Mappings = { [".tpl"] = "text/plain" } };
app.UseStaticFiles(new StaticFileOptions
{

    ContentTypeProvider = provider
});



app.UseSession();


app.UseCookiePolicy();
app.UseRouting();
app.UseAuthentication();
app.UseAuthorization();
app.MapDefaultControllerRoute();


app.Run();
