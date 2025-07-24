using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Mvc;
using RunBuilder.Models;
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
            var countryCode = HttpContext.User.Claims.FirstOrDefault(x => x.Type == "CountryCode")?.Value;
            var tenantTimeZone = HttpContext.User.Claims.FirstOrDefault(x => x.Type == "TimeZone")?.Value;
            var usa = Country.Us.GetDescription();
            var isUsTenantFlag = countryCode?.ToUpper().Equals(usa);

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

            //var cid = HttpContext.User.Claims.FirstOrDefault(x => x.Type == "ContactID")?.Value;

            //if (!string.IsNullOrEmpty(cid))
            //{
            //var contactDetail = repo.GetContact(int.Parse(cid));
            //var clientDetail = repo.GetClient(contactDetail.ClientId);

            //var availableClients = repo.GetAvailableClients(int.Parse(cid));
            //string availableClientsString = null;
            //if (availableClients.Count > 1)
            //{
            //    availableClientsString = "";

            //    for (int i = 0; i < availableClients.Count; i++)
            //    {
            //        availableClientsString += availableClients[i].ClientId + ", ";
            //    }
            //}

            //ViewBag.ClientCount = contactDetail.ContactCount;
            //ViewBag.ClientString = availableClientsString?.TrimEnd([',', ' ']);
            //ViewBag.ContactID = cid;
            //ViewBag.ClientName = clientDetail.Name;
            //ViewBag.ClientInternal = clientDetail.Internal;
            //ViewBag.ClientID = contactDetail.ClientId;
            //ViewBag.Email = clientDetail.Email;
            //ViewBag.Created = ((DateTimeOffset)clientDetail.Created).ToUnixTimeSeconds();            
            //}

            ViewBag.IsUsTenant = isUsTenantFlag ?? false;
            ViewBag.TimeZone = tenantTimeZone;

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