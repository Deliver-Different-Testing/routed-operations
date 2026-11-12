using RoutedOperations.Core.Application.Services.Branches;

namespace RoutedOperations.Tests.Branches;

public class BranchRowFilterTests
{
    [Fact]
    public void Unrestricted_EverythingVisible()
    {
        var f = BranchRowFilter.Unrestricted;

        Assert.True(f.IsUnrestricted);
        Assert.True(f.IsJobVisible(null, null));
        Assert.True(f.IsLegVisible(null, null, null, null));
        var rows = new List<int?> { 1, null };
        Assert.Same(rows, f.FilterClients(rows, x => x));
    }

    [Theory]
    [InlineData(10, null, null, null, true)]   // client
    [InlineData(20, 100, null, null, true)]    // courier
    [InlineData(20, null, 44, null, true)]     // pickup suburb site
    [InlineData(20, null, null, 44, true)]     // delivery suburb site
    [InlineData(20, 200, 43, 43, false)]       // nothing in branch
    [InlineData(null, null, null, null, false)]
    public void IsLegVisible_AnyArm(int? client, int? courier, int? fromSite, int? toSite, bool expected)
    {
        var f = BranchRowFilter.Restricted(new[] { 10 }, new[] { 100 }, new[] { 44 });

        Assert.Equal(expected, f.IsLegVisible(client, courier, fromSite, toSite));
    }

    [Fact]
    public void IsJobVisible_ClientOrCourier()
    {
        var f = BranchRowFilter.Restricted(new[] { 10 }, new[] { 100 }, new[] { 44 });

        Assert.True(f.IsJobVisible(10, 200));
        Assert.True(f.IsJobVisible(20, 100));
        Assert.False(f.IsJobVisible(20, 200));
        Assert.False(f.IsJobVisible(20, null));
    }

    [Fact]
    public void FilterClients_And_FilterCouriers()
    {
        var f = BranchRowFilter.Restricted(new[] { 10 }, new[] { 100 });

        Assert.Equal(new int?[] { 10 }, f.FilterClients(new List<int?> { 10, 20, null }, x => x));
        Assert.Equal(new int?[] { 100 }, f.FilterCouriers(new List<int?> { 100, 200, null }, x => x));
    }
}
