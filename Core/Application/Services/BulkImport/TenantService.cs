using Microsoft.AspNetCore.Hosting;

namespace RoutedOperations.Core.Application.Services.BulkImport;

// Ported from BulkImportHyper. Resolves a tenant-specific logo asset path
// on the webroot, falling back to the shared Deliver Different mark when the
// tenant has no override on disk. Called by the Razor layout via the interface
// so tests can stub it.
public interface ITenantService
{
    string GetTenantLogoPath(string tenantCode);
}

public class TenantService(IWebHostEnvironment hostingEnvironment) : ITenantService
{
    public string GetTenantLogoPath(string tenantCode)
    {
        var defaultLogo = "~/images/deliverDifferentLogo.png";
        if (string.IsNullOrEmpty(tenantCode))
            return defaultLogo;

        var tenantLogoPath = $"~/images/{tenantCode}Logo.png";

        if (LogoFileExists(tenantLogoPath))
            return tenantLogoPath;

        return defaultLogo;
    }

    private bool LogoFileExists(string virtualPath)
    {
        var path = virtualPath.Replace("~/", "");
        var physicalPath = Path.Combine(hostingEnvironment.WebRootPath, path);
        return File.Exists(physicalPath);
    }
}
