using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging.Abstractions;
using RoutedOperations.Core.Application.Services.Schedule;
using RoutedOperations.Core.Application.Utilities;
using RoutedOperations.Core.Domain;
using RoutedOperations.Core.Domain.Despatch;

namespace RoutedOperations.Tests.Services.Schedule;

/// <summary>
/// Bundle modal reads and writes (SCHEDULE-BUNDLES-UI-2026-10-16):
///   * GetBundleDetailAsync - members with depot / speed / days, clients
///     with "on n of m" coverage over non-default members only.
///   * DetachClientFromBundleAsync - link rows removed on every member,
///     other clients untouched.
///   * AddBundleMembersAsync(linkExistingClients: true) - the clients
///     already on the bundle get a link row on the new non-default member
///     and nothing on a new default member.
/// InMemory, like ListSummaryAsync's test: the detail read seeds the
/// tblBulkRunSchedule view entity directly, which a relational provider
/// refuses.
/// </summary>
public class ScheduleBundleTests
{
    private const int BundleId = 7;
    private const int DefaultSched = 1001;   // IsDefault = 1, nobody needs a link
    private const int MedicalWlg = 1009;     // client-specific
    private const int MedicalChc = 1010;     // client-specific
    private const int Zimmer = 101;
    private const int Stryker = 103;
    private const int NuVasive = 104;

    private static ScheduleService NewSvc(out DynamicDespatchDbContext seed)
    {
        var opts = CockpitTestHarness.NewInMemoryOptions();
        seed = CockpitTestHarness.Context(opts);
        var cache = new TenantScopedCache(
            new MemoryCache(new MemoryCacheOptions()),
            new HttpContextAccessor());
        return new ScheduleService(
            CockpitTestHarness.Factory(opts),
            NullLogger<ScheduleService>.Instance,
            cache,
            Substitute.For<IScheduleConverter>());
    }

    private static void Header(DynamicDespatchDbContext seed, int id, string name, bool isDefault)
    {
        seed.BulkRunScheduleHeaders.Add(new BulkRunScheduleHeader
        {
            ScheduleId = id, Name = name, IsDefault = isDefault, IsActive = true,
            CreatedUtc = DateTime.UtcNow, CreatedBy = "seed",
        });
        seed.TblBulkRunSchedules.Add(new TblBulkRunSchedule
        {
            Name = name, ScheduleId = id, DayOfWeek = 1, Region = 1, SpeedId = 2,
            StartTime = TimeSpan.Parse("08:00"), EndTime = TimeSpan.Parse("17:00"), MaxJobs = 10000,
        });
        seed.TblBulkRunSchedules.Add(new TblBulkRunSchedule
        {
            Name = name, ScheduleId = id, DayOfWeek = 3, Region = 1, SpeedId = 2,
            StartTime = TimeSpan.Parse("08:00"), EndTime = TimeSpan.Parse("17:00"), MaxJobs = 10000,
        });
    }

    private static void Link(DynamicDespatchDbContext seed, int scheduleId, int clientId) =>
        seed.ScheduleClients.Add(new ScheduleClient
        {
            ScheduleId = scheduleId, ClientId = clientId, CreatedUtc = DateTime.UtcNow, CreatedBy = "seed",
        });

    /// <summary>Bundle of one default + two client-specific schedules.
    /// Zimmer and Stryker are on both specifics; NuVasive only on CHC.</summary>
    private static async Task SeedBundleAsync(DynamicDespatchDbContext seed)
    {
        seed.TblBulkRegions.Add(new TblBulkRegion { BulkRegionId = 1, Name = "Wellington" });
        seed.TucJobTypes.Add(new TucJobType { UcjtId = 2, UcjtName = "8am" });
        seed.TucClients.Add(new TucClient { UcclId = Zimmer, UcclCode = "ZIM", UcclName = "Zimmer Biomet" });
        seed.TucClients.Add(new TucClient { UcclId = Stryker, UcclCode = "STRY", UcclName = "Stryker" });
        seed.TucClients.Add(new TucClient { UcclId = NuVasive, UcclCode = "NUVA", UcclName = "NuVasive" });

        Header(seed, DefaultSched, "AKL 8am", isDefault: true);
        Header(seed, MedicalWlg, "Medical WLG 8am", isDefault: false);
        Header(seed, MedicalChc, "Medical CHC Overnight", isDefault: false);

        Link(seed, MedicalWlg, Zimmer);
        Link(seed, MedicalWlg, Stryker);
        Link(seed, MedicalChc, Zimmer);
        Link(seed, MedicalChc, Stryker);
        Link(seed, MedicalChc, NuVasive);

        seed.BulkRunScheduleBundles.Add(new BulkRunScheduleBundle
        {
            BundleId = BundleId, Name = "Medical nationwide", Description = "desc", IsActive = true,
            CreatedUtc = DateTime.UtcNow, CreatedBy = "seed",
        });
        foreach (var id in new[] { DefaultSched, MedicalWlg, MedicalChc })
            seed.BulkRunScheduleBundleMembers.Add(new BulkRunScheduleBundleMember { BundleId = BundleId, ScheduleId = id });
        await seed.SaveChangesAsync();
    }

    [Fact]
    public async Task GetBundleDetailAsync_lists_members_with_row_facts_and_clients_with_coverage()
    {
        var svc = NewSvc(out var seed);
        await SeedBundleAsync(seed);

        var d = await svc.GetBundleDetailAsync(BundleId);

        Assert.Equal("Medical nationwide", d.Name);
        Assert.Equal(3, d.Members.Count);
        var def = d.Members.Single(m => m.ScheduleId == DefaultSched);
        Assert.True(def.IsDefault);
        Assert.Equal(0, def.ClientCount);
        var chc = d.Members.Single(m => m.ScheduleId == MedicalChc);
        Assert.False(chc.IsDefault);
        Assert.Equal(3, chc.ClientCount);
        Assert.Equal("Wellington", chc.RegionName);
        Assert.Equal("8am", chc.SpeedName);
        Assert.Equal(new[] { 1, 3 }, chc.ActiveDays);

        // Coverage counts non-default members only (2), never the default.
        Assert.Equal(3, d.Clients.Count);
        var zim = d.Clients.Single(c => c.ClientId == Zimmer);
        Assert.Equal("ZIM", zim.Code);
        Assert.Equal(2, zim.OnMembers);
        Assert.Equal(2, zim.OfMembers);
        var nuva = d.Clients.Single(c => c.ClientId == NuVasive);
        Assert.Equal(1, nuva.OnMembers);
        Assert.Equal(2, nuva.OfMembers);
        // Fully covered clients sort first, then by code.
        Assert.Equal(new[] { "STRY", "ZIM", "NUVA" }, d.Clients.Select(c => c.Code).ToArray());
    }

    [Fact]
    public async Task GetBundleDetailAsync_unknown_bundle_throws()
    {
        var svc = NewSvc(out var seed);
        await SeedBundleAsync(seed);
        await Assert.ThrowsAsync<InvalidOperationException>(() => svc.GetBundleDetailAsync(999));
    }

    [Fact]
    public async Task DetachClientFromBundleAsync_removes_the_client_on_every_member_and_nothing_else()
    {
        var svc = NewSvc(out var seed);
        await SeedBundleAsync(seed);

        var removed = await svc.DetachClientFromBundleAsync(BundleId, Zimmer);

        Assert.Equal(2, removed);
        var remaining = await seed.ScheduleClients.AsNoTracking().ToListAsync();
        Assert.DoesNotContain(remaining, l => l.ClientId == Zimmer);
        Assert.Equal(3, remaining.Count);   // Stryker x2 + NuVasive x1
        Assert.Equal(0, await svc.DetachClientFromBundleAsync(BundleId, Zimmer));   // idempotent
    }

    [Fact]
    public async Task AddBundleMembersAsync_with_linkExistingClients_links_bundle_clients_to_the_new_specific_member_only()
    {
        var svc = NewSvc(out var seed);
        await SeedBundleAsync(seed);
        const int NewSpecific = 1011;
        const int NewDefault = 1012;
        Header(seed, NewSpecific, "Medical HAM 8am", isDefault: false);
        Header(seed, NewDefault, "WLG Same day", isDefault: true);
        await seed.SaveChangesAsync();

        var added = await svc.AddBundleMembersAsync(BundleId, new[] { NewSpecific, NewDefault }, linkExistingClients: true);

        Assert.Equal(2, added);
        var links = await seed.ScheduleClients.AsNoTracking().ToListAsync();
        // All three clients on the bundle (Zimmer, Stryker, NuVasive) land on the new specific member...
        Assert.Equal(
            new[] { Zimmer, Stryker, NuVasive }.OrderBy(x => x),
            links.Where(l => l.ScheduleId == NewSpecific).Select(l => l.ClientId).OrderBy(x => x));
        // ...and none on the new default.
        Assert.DoesNotContain(links, l => l.ScheduleId == NewDefault);
        Assert.StartsWith("RoutedOps:bundle-member-link:", links.First(l => l.ScheduleId == NewSpecific).CreatedBy);
    }

    [Fact]
    public async Task AddBundleMembersAsync_without_linkExistingClients_adds_no_link_rows()
    {
        var svc = NewSvc(out var seed);
        await SeedBundleAsync(seed);
        const int NewSpecific = 1011;
        Header(seed, NewSpecific, "Medical HAM 8am", isDefault: false);
        await seed.SaveChangesAsync();

        var added = await svc.AddBundleMembersAsync(BundleId, new[] { NewSpecific });

        Assert.Equal(1, added);
        Assert.DoesNotContain(await seed.ScheduleClients.AsNoTracking().ToListAsync(), l => l.ScheduleId == NewSpecific);
        var d = await svc.GetBundleDetailAsync(BundleId);
        Assert.All(d.Clients, c => Assert.Equal(3, c.OfMembers));
        Assert.Equal(2, d.Clients.Single(c => c.ClientId == Zimmer).OnMembers);   // now "on 2 of 3"
    }
}
