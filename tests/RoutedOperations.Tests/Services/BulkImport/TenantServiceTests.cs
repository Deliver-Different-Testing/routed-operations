using Microsoft.AspNetCore.Hosting;
using RoutedOperations.Core.Application.Services.BulkImport;

namespace RoutedOperations.Tests.Services.BulkImport;

// Covers the tenant logo-path resolver. The tricky bit is that
// LogoFileExists uses File.Exists against a physical path built from
// IWebHostEnvironment.WebRootPath, so each test creates a temp directory
// per case and plants (or does not plant) the expected PNG.
public class TenantServiceTests : IDisposable
{
    private readonly string _webRoot;

    public TenantServiceTests()
    {
        _webRoot = Path.Combine(Path.GetTempPath(), "ro-tenantsvc-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(Path.Combine(_webRoot, "images"));
    }

    public void Dispose()
    {
        try { Directory.Delete(_webRoot, recursive: true); } catch { }
    }

    private TenantService NewSvc()
    {
        var env = Substitute.For<IWebHostEnvironment>();
        env.WebRootPath.Returns(_webRoot);
        return new TenantService(env);
    }

    private void PlantLogo(string filename)
    {
        File.WriteAllText(Path.Combine(_webRoot, "images", filename), "png-bytes");
    }

    [Fact]
    public void GetTenantLogoPath_NullCode_ReturnsDefault()
    {
        var svc = NewSvc();
        Assert.Equal("~/images/deliverDifferentLogo.png", svc.GetTenantLogoPath(null));
    }

    [Fact]
    public void GetTenantLogoPath_EmptyCode_ReturnsDefault()
    {
        var svc = NewSvc();
        Assert.Equal("~/images/deliverDifferentLogo.png", svc.GetTenantLogoPath(string.Empty));
    }

    [Fact]
    public void GetTenantLogoPath_TenantLogoFileMissing_FallsBackToDefault()
    {
        var svc = NewSvc();
        Assert.Equal("~/images/deliverDifferentLogo.png", svc.GetTenantLogoPath("acme"));
    }

    [Fact]
    public void GetTenantLogoPath_TenantLogoFilePresent_ReturnsTenantPath()
    {
        PlantLogo("acmeLogo.png");
        var svc = NewSvc();
        Assert.Equal("~/images/acmeLogo.png", svc.GetTenantLogoPath("acme"));
    }

    [Fact]
    public void GetTenantLogoPath_CaseSensitiveOnFileMatch_ReturnsTenantPathWhenExact()
    {
        // Only the exact-cased filename should map; a different-cased tenant
        // code produces a distinct filename and should fall back.
        PlantLogo("AcmeLogo.png");
        var svc = NewSvc();
        // Path we build is "~/images/{tenantCode}Logo.png", so lookup uses the
        // literal tenantCode. On Windows File.Exists is case-insensitive, so
        // this test just confirms that the presence check drives the return.
        Assert.Equal("~/images/AcmeLogo.png", svc.GetTenantLogoPath("Acme"));
    }
}
