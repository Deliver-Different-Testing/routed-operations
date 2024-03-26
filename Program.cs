
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.StaticFiles;
using Microsoft.EntityFrameworkCore;
using Mindscape.Raygun4Net.AspNetCore;
using RunBuilder.Models;
using RunBuilder.Models.Repository;
using StackExchange.Redis;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddHealthChecks();
builder.Configuration.AddJsonFile("appsettings.json", optional: true, reloadOnChange: true);
// Add services to the container.
builder.Services.AddDataProtection().PersistKeysToAWSSystemsManager("/Hub/DataProtection").SetApplicationName("DeliverDifferent");

builder.Services.AddRaygun(builder.Configuration);
// Add services to the container.
builder.Services.AddControllersWithViews().AddJsonOptions(options =>
    options.JsonSerializerOptions.PropertyNamingPolicy = null); ;
builder.Services.AddScoped<JobRepository, JobRepository>();
builder.Services.AddScoped<RouteRepository, RouteRepository>();
builder.Services.AddScoped<CourierRepository, CourierRepository>();
builder.Services.AddScoped<GoogleDirectionRepository, GoogleDirectionRepository>();

var connectionString = Environment.GetEnvironmentVariable("SQLConnection") ?? "";
if (string.IsNullOrEmpty(connectionString))
{
    throw new InvalidOperationException(
        "Could not find a connection string named 'SQLConnection'.");
}
builder.Services.AddHealthChecks().AddSqlServer(connectionString);
builder.Services.AddDbContext<DespatchContext>(x =>
{
    x.UseSqlServer(connectionString);
#if DEBUG
    x.UseLoggerFactory(LoggerFactory.Create(c => c.AddDebug()));
#endif
});

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

var app = builder.Build();

if (!app.Environment.IsDevelopment())
{
    app.UseHsts();
}


app.MapHealthChecks("/healthz");

// Configure the HTTP request pipeline.
var provider = new FileExtensionContentTypeProvider { Mappings = { [".tpl"] = "text/plain" } };
app.UseStaticFiles(new StaticFileOptions
{

    ContentTypeProvider = provider
});


//app.UseHttpsRedirection();
app.UseSession();
app.UseRaygun();

//app.UseHttpsRedirection();
app.UseCookiePolicy();
app.UseRouting();
app.UseAuthentication();
app.UseAuthorization();
app.MapDefaultControllerRoute();


app.Run();
