// BulkImport.Use (ro-bulk-import-customer-scope): the interim policy that lets
// customers into Bulk Import, and only Bulk Import.
//
// The business rule these pin: a customer can reach the Bulk Import screens
// (Steve 2026-09-30, "Customers get Bulk Import and Route Viewer") but opening
// that door must not open any Route Builder or Route Viewer endpoint, and
// couriers, partners and anyone without a tenant or a client type stay out.
using System.Security.Claims;
using RoutedOperations.Core.Application.Security;

namespace RoutedOperations.Tests.Security;

public class BulkImportPoliciesTests
{
    private static ClaimsPrincipal User(params (string Type, string Value)[] claims) =>
        new(new ClaimsIdentity(claims.Select(c => new Claim(c.Type, c.Value)), "test"));

    private static ClaimsPrincipal Customer() =>
        User(("CurrentTenantID", "42"), ("ClientTypeId", "2"), ("ContactID", "9"));

    [Theory]
    [InlineData("4")]
    [InlineData("5")]
    public void Staff_pass(string clientTypeId) =>
        Assert.True(BulkImportPolicies.CanUse(User(("CurrentTenantID", "42"), ("ClientTypeId", clientTypeId))));

    [Fact]
    public void Customer_passes_BulkImport_but_still_fails_every_RouteBuilder_and_RouteViewer_policy()
    {
        var customer = Customer();
        Assert.True(BulkImportPolicies.CanUse(customer));

        Assert.False(RouteBuilderPolicies.CanRead(customer));
        Assert.False(RouteBuilderPolicies.CanBuild(customer));
        Assert.False(RouteBuilderPolicies.CanAdmin(customer));
        Assert.False(RouteBuilderPolicies.CanUsePlaceholderModule(customer));
        Assert.False(RouteViewerPolicies.CanRead(customer));
        Assert.False(RouteViewerPolicies.CanAdmin(customer));
        Assert.False(RouteViewerPolicies.CanUseNpScope(customer));
    }

    [Fact]
    public void Courier_fails_even_with_a_customer_or_staff_client_type()
    {
        Assert.False(BulkImportPolicies.CanUse(User(("CurrentTenantID", "42"), ("IsCourier", "True"))));
        Assert.False(BulkImportPolicies.CanUse(User(("CurrentTenantID", "42"), ("ClientTypeId", "2"), ("IsCourier", "True"))));
        Assert.False(BulkImportPolicies.CanUse(User(("CurrentTenantID", "42"), ("ClientTypeId", "4"), ("IsCourier", "True"))));
    }

    [Fact]
    public void Network_partner_fails_whatever_its_client_type()
    {
        Assert.False(BulkImportPolicies.CanUse(User(("CurrentTenantID", "42"), ("ClientTypeId", "3"), ("IsNetworkPartner", "True"))));
        Assert.False(BulkImportPolicies.CanUse(User(("CurrentTenantID", "42"), ("ClientTypeId", "2"), ("IsNetworkPartner", "True"))));
        Assert.False(BulkImportPolicies.CanUse(User(("CurrentTenantID", "42"), ("ClientTypeId", "4"), ("IsNetworkPartner", "True"))));
    }

    [Fact]
    public void No_tenant_fails()
    {
        Assert.False(BulkImportPolicies.CanUse(User(("ClientTypeId", "2"))));
        Assert.False(BulkImportPolicies.CanUse(User(("ClientTypeId", "4"))));
        Assert.False(BulkImportPolicies.CanUse(User()));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("1")]   // Internal: carries no permission (Steve 2026-10-08)
    [InlineData("3")]   // partner type without the partner flag
    [InlineData("abc")]
    public void Missing_or_other_client_type_fails_closed(string? clientTypeId)
    {
        var claims = new List<(string, string)> { ("CurrentTenantID", "42"), ("Internal", "True"), ("UserGroupID", "1") };
        if (clientTypeId != null) claims.Add(("ClientTypeId", clientTypeId));
        Assert.False(BulkImportPolicies.CanUse(User(claims.ToArray())));
    }
}
