using Microsoft.EntityFrameworkCore;
using RoutedOperations.Core.Application.Services.Branches;
using RoutedOperations.Core.Domain;
using RoutedOperations.Core.Domain.Despatch;
using RoutedOperations.Infrastructure;
using RoutedOperations.Tests.Services;

namespace RoutedOperations.Tests.Branches;

// tblSetting.ParentJobCourierId is the placeholder courier split parents are parked on. It has no branch, so the courier arm used to
// treat it as the default branch's courier and open every split family to the default branch. As a JOB-visibility link it now counts
// for nothing; a run's own courier and the courier pickers are untouched.
public class ParentJobCourierBranchTests
{
    private const int Sydney = 1;
    private const int Melbourne = 2;
    private const int ParentsCourier = 4;
    private static readonly DateTime Day = new(2026, 11, 16);

    private readonly DbContextOptions<DespatchContext> _options = CockpitTestHarness.NewInMemoryOptions();

    private async Task Seed(bool configured, params object[] rows)
    {
        await using var context = CockpitTestHarness.Context(_options);
        context.AddRange(
            new TblBranch { BranchId = Sydney, IsDefault = true, Active = true, SiteId = 43 },
            new TblBranch { BranchId = Melbourne, IsDefault = false, Active = true, SiteId = 44 },
            new TucClient { UcclId = 10, BranchId = Sydney, ClientTypeId = 2, UcclActive = true, UcclName = "Sydney Co" },
            new TucClient { UcclId = 20, BranchId = Melbourne, ClientTypeId = 2, UcclActive = true, UcclName = "Melbourne Co" },
            new TucCourier { UccrId = 100, UccrName = "Syd", UccrSurname = "Driver", Code = "S1", Active = true, BranchId = Sydney },
            new TucCourier { UccrId = 200, UccrName = "Mel", UccrSurname = "Driver", Code = "M1", Active = true, BranchId = Melbourne },
            new TucCourier { UccrId = ParentsCourier, UccrName = "Parent", UccrSurname = "Jobs", Code = "PJ", Active = true, BranchId = null },
            new TucSuburb { UcsuId = 900, SiteId = 43 },
            new TucSuburb { UcsuId = 910, SiteId = 44 });
        if (configured) context.Add(new TblSetting { SettingId = 1, ParentJobCourierId = ParentsCourier });
        context.AddRange(rows);
        await context.SaveChangesAsync(TestContext.Current.CancellationToken);
    }

    private BranchScopeGuard Guard(int branch)
    {
        var resolver = Substitute.For<IBranchScopeResolver>();
        resolver.Resolve().Returns(BranchScope.Restricted([branch]));
        return new BranchScopeGuard(resolver, CockpitTestHarness.Factory(_options));
    }

    private static TucJob Job(int id, int client, int? courier, int? parent = null, int? root = null, int? from = null, int? to = null) => new()
    {
        UcjbId = id, UcjbNumber = $"J{id}", UcjbClientId = client, UcjbCourierId = courier, ParentId = parent, RootParentId = root,
        UcjbFrom = from, UcjbTo = to,
    };

    // A split family that is entirely Melbourne: the parent sits on the placeholder courier, the leg has a Melbourne courier.
    private static object[] MelbourneOnlyFamily() => [Job(50, 20, ParentsCourier), Job(51, 20, 200, parent: 50, root: 50)];

    [Fact]
    public async Task SydneyDefaultBranchUser_DoesNotSee_AMelbourneOnlySplitFamily_ThroughTheParentCourier()
    {
        await Seed(true, MelbourneOnlyFamily());

        var visible = await Guard(Sydney).VisibleJobIdsAsync([50, 51]);

        Assert.Empty(visible);
    }

    [Fact]
    public async Task Control_WithoutTheSetting_TheParentCourierDoesOpenTheFamilyToTheDefaultBranch()
    {
        await Seed(false, MelbourneOnlyFamily());

        var visible = await Guard(Sydney).VisibleJobIdsAsync([50, 51]);

        Assert.Equal([50, 51], visible.Order());   // the leak the exclusion closes: courier 4 has no branch, so it counts as Sydney's
    }

    [Fact]
    public async Task MelbourneUser_StillSees_ItsOwnSplitFamily()
    {
        await Seed(true, MelbourneOnlyFamily());

        var visible = await Guard(Melbourne).VisibleJobIdsAsync([50, 51]);

        Assert.Equal([50, 51], visible.Order());
    }

    [Fact]
    public async Task Family_StaysVisible_ThroughItsClient()
    {
        await Seed(true, Job(60, 10, ParentsCourier));

        Assert.Contains(60, await Guard(Sydney).VisibleJobIdsAsync([60]));
    }

    [Fact]
    public async Task Family_StaysVisible_ThroughARealLegCourier()
    {
        await Seed(true, Job(70, 20, ParentsCourier), Job(71, 20, 100, parent: 70, root: 70));

        var visible = await Guard(Sydney).VisibleJobIdsAsync([70, 71]);

        Assert.Equal([70, 71], visible.Order());   // the Sydney leg courier shows the whole family, parent included
    }

    [Fact]
    public async Task Family_StaysVisible_ThroughASuburbOnTheirSite()
    {
        await Seed(true, Job(80, 20, ParentsCourier, from: 900, to: 910));

        Assert.Contains(80, await Guard(Sydney).VisibleJobIdsAsync([80]));
        Assert.Contains(80, await Guard(Melbourne).VisibleJobIdsAsync([80]));
    }

    [Fact]
    public async Task ParentCourier_IsStillAPickableCourier_ButNotAJobLink()
    {
        await Seed(true);
        var guard = Guard(Sydney);

        Assert.Contains(ParentsCourier, await guard.VisibleCourierIdsAsync([ParentsCourier, 100, 200]));
        Assert.Equal([100], (await guard.VisibleJobCourierIdsAsync([ParentsCourier, 100, 200])).Order());
    }

    [Fact]
    public async Task ARunAssignedToTheParentCourier_IsUnaffected()
    {
        await Seed(true, new TblBulkRun { Id = 9, CourierId = ParentsCourier });

        Assert.True(await Guard(Sydney).IsRunFullyVisibleAsync(9));
        Assert.Contains(9, await Guard(Sydney).VisibleRunIdsAsync([9]));
    }

    [Fact]
    public async Task ABulkJobWithNoTucJob_OnTheParentCourier_IsNotVisibleThroughThatCourier()
    {
        await Seed(true, new TblBulkJob
        {
            BulkJobId = 31, JobNumber = "B31", BookDate = Day, BookTime = Day, ClientId = 20, ClientCode = "C20", Speed = 1,
            FromAddress = "F", ToAddress = "T", CourierId = ParentsCourier,
        });

        Assert.Empty(await Guard(Sydney).VisibleBulkJobIdsAsync([31]));
    }

    [Fact]
    public async Task FilterJobRows_DropsARowThatOnlyHasTheParentCourier()
    {
        await Seed(true);
        var rows = new List<(int? Job, int? Client, int? Courier)> { (null, 20, ParentsCourier), (null, 20, 100) };

        var kept = await Guard(Sydney).FilterJobRowsAsync(rows, r => r.Job, r => r.Client, r => r.Courier);

        Assert.Equal([100], kept.Select(r => r.Courier!.Value));
    }
}
