using Microsoft.Data.SqlClient;
using RoutedOperations.Core.Application.Utilities;

namespace RoutedOperations.Tests.Utilities;

/// <summary>
/// Covers TenantConnectionCache, the fix for the 2026-08-25 Medical incident where
/// four apps shared one Redis cache entry for the tenant connection string and each
/// wrote it with its own SQLCredentials, so an app could end up connecting under
/// another app's SQL login and be denied EXECUTE on a stored procedure.
/// </summary>
public class TenantConnectionCacheTests
{
    private const string Base =
        "server=sql.example.com,1433;database=Despatch-Medical-Prod;TrustServerCertificate=True;";

    [Fact]
    public void Key_IsNamespacedToThisApp()
    {
        Assert.Equal("8-RoutedOperations-Connection", TenantConnectionCache.Key("8"));
    }

    [Fact]
    public void Key_DoesNotCollideWithTheLegacySharedKey()
    {
        Assert.Equal("8-ClientManager-Connection", TenantConnectionCache.LegacyKey("8"));
        Assert.NotEqual(TenantConnectionCache.Key("8"), TenantConnectionCache.LegacyKey("8"));
    }

    [Fact]
    public void ApplyOwnCredentials_OverridesAnotherAppsLogin()
    {
        var poisoned = Base + "UID=ClientManager;pwd=someothersecret";

        var result = TenantConnectionCache.ApplyOwnCredentials(
            poisoned, "user id=InternetUser;pwd=ourssecret");

        var builder = new SqlConnectionStringBuilder(result);
        Assert.Equal("InternetUser", builder.UserID);
        Assert.Equal("ourssecret", builder.Password);
        Assert.Equal("Despatch-Medical-Prod", builder.InitialCatalog);
        Assert.Equal("sql.example.com,1433", builder.DataSource);
    }

    [Fact]
    public void ApplyOwnCredentials_LeavesAnUnrecognisableConnectionStringUntouched()
    {
        // SqlConnectionStringBuilder drops what it cannot parse instead of throwing,
        // so rewriting this would return credentials with no server or database.
        const string unrecognisable = "this is not a connection string===;;;";

        Assert.Equal(unrecognisable,
            TenantConnectionCache.ApplyOwnCredentials(unrecognisable, "uid=X;pwd=y"));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void ApplyOwnCredentials_ReturnsInputWhenCredentialsMissing(string? credentials)
    {
        var input = Base + "uid=Whoever;pwd=x";

        Assert.Equal(input, TenantConnectionCache.ApplyOwnCredentials(input, credentials));
    }
}
