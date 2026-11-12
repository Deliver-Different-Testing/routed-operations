using RoutedOperations.Core.Application.Services.Branches;

namespace RoutedOperations.Tests.Branches;

public class BranchRowFilterTests
{
    private sealed record Row(int? ClientId, int? CourierId);

    [Fact]
    public void Unrestricted_KeepsEverything_SameList()
    {
        var rows = new List<Row> { new(1, 1), new(null, null) };

        Assert.Same(rows, BranchRowFilter.Unrestricted.FilterJobs(rows, r => r.ClientId, r => r.CourierId));
        Assert.True(BranchRowFilter.Unrestricted.IsJobVisible(null, null));
    }

    [Fact]
    public void OptionA_JobsFollowClientOnly()
    {
        var filter = BranchRowFilter.Restricted(new[] { 10 }, new[] { 100 }, jobVisibleViaCourier: false);
        var rows = new List<Row> { new(10, 200), new(20, 100), new(null, 100) };

        var kept = filter.FilterJobs(rows, r => r.ClientId, r => r.CourierId);

        Assert.Equal(new[] { new Row(10, 200) }, kept);
    }

    [Fact]
    public void OptionB_JobsAlsoFollowCourier()
    {
        var filter = BranchRowFilter.Restricted(new[] { 10 }, new[] { 100 }, jobVisibleViaCourier: true);
        var rows = new List<Row> { new(10, 200), new(20, 100), new(20, 200), new(20, null) };

        var kept = filter.FilterJobs(rows, r => r.ClientId, r => r.CourierId);

        Assert.Equal(new[] { new Row(10, 200), new Row(20, 100) }, kept);
    }

    [Fact]
    public void FilterClients_And_FilterCouriers()
    {
        var filter = BranchRowFilter.Restricted(new[] { 10 }, new[] { 100 }, false);

        Assert.Equal(new int?[] { 10 }, filter.FilterClients(new List<int?> { 10, 20, null }, x => x));
        Assert.Equal(new int?[] { 100 }, filter.FilterCouriers(new List<int?> { 100, 200, null }, x => x));
    }
}
