using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Mvc;
using Serilog;

namespace RunBuilder.Controllers
{
    public class HomeController(IConnectionStringManager connectionStringManager) : Controller
    {
        public async Task<ActionResult> Index()
        {
            Log.Information("Index method called");

    
            if (HttpContext?.User?.Identity == null)
            {
                Log.Error("HttpContext.User.Identity is null");
            }
            else if (!HttpContext.User.Identity.IsAuthenticated)
            {
                Log.Error("User is not authenticated");
            }
            else
            {
                Log.Information($"User authenticated as: {HttpContext.User.Identity.Name}");
                Log.Information($"Claims found: {string.Join(", ", HttpContext.User.Claims.Select(c => c.Type))}");
            }
            var connectionString = HttpContext?.User.Claims.FirstOrDefault(x => x.Type == "Connection")?.Value;
            var tenantId = HttpContext?.User.Claims.FirstOrDefault(x => x.Type == "CurrentTenantID")?.Value;
            
            if (string.IsNullOrEmpty(connectionString))
            {
                Log.Error("Authentication Failed. No Connection String.");
            }
            var credentials = Environment.GetEnvironmentVariable("SQLCredentials") ?? "";
            if (string.IsNullOrEmpty(credentials))
            {
                throw new InvalidOperationException(
                    "Could not find a environment variable string named 'SQLCredentials'.");
            }
            await connectionStringManager.SetConnectionStringAsync($"{tenantId}-RunBuilder-Connection", connectionString+credentials);

            var maskedConnectionString = MaskSensitiveInfo(connectionString ?? "");
            Log.Debug($"Connection String Set: {maskedConnectionString}"); 
            return View();
        }

        public ActionResult About()
        {
            ViewBag.Message = "Your application description page.";

            return View();
        }

        public ActionResult Contact()
        {
            ViewBag.Message = "Your contact page.";

            return View();
        }
        
        private string MaskSensitiveInfo(string connectionString)
        {
            // Mask password
            var maskedString = Regex.Replace(connectionString, 
                @"(Password|Pwd)=[^;]*", "$1=********", 
                RegexOptions.IgnoreCase);

            // Mask user id if present
            maskedString = Regex.Replace(maskedString, 
                @"(User ID|Uid)=[^;]*", "$1=********", 
                RegexOptions.IgnoreCase);

            return maskedString;
        }
    }
}