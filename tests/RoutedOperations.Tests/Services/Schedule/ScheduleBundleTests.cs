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
///     with "on n of m" coverage over every live member (non-default
///     only until B3, 2026-11-12).
///   * DetachClientFromBundleAsync - link rows removed on every member,
///     other clients untouched.
///   * AddBundleMembersAsync(linkExistingClients: true) - the clients
///     already on the bundle get a link row on every new member, defaults
///     included since B3 (2026-11-12).
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
    private const string EmptyBundleMessage =
        "This bundle has no schedules yet. Add a schedule to the bundle before adding clients.";

    private static ScheduleService NewSvc(out DynamicDespatchDbContext seed)
    {
        var opts = CockpitTestHarness.NewInMemoryOptions();
        seed = CockpitTestHarness.Context(opts);
        var accessor = new HttpContextAccessor();
        var cache = new TenantScopedCache(
            new MemoryCache(new MemoryCacheOptions()),
            accessor);
        return new ScheduleService(
            CockpitTestHarness.Factory(opts),
            NullLogger<ScheduleService>.Instance,
            cache,
            Substitute.For<IScheduleConverter>(),
            accessor);
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

        // B3: coverage counts every live member (3), the default included,
        // because a bundle attach now links the default too.
        Assert.Equal(3, d.Clients.Count);
        var zim = d.Clients.Single(c => c.ClientId == Zimmer);
        Assert.Equal("ZIM", zim.Code);
        Assert.Equal(2, zim.OnMembers);
        Assert.Equal(3, zim.OfMembers);
        var nuva = d.Clients.Single(c => c.ClientId == NuVasive);
        Assert.Equal(1, nuva.OnMembers);
        Assert.Equal(3, nuva.OfMembers);
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
    public async Task AddBundleMembersAsync_with_linkExistingClients_links_bundle_clients_to_every_new_member()
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
        // ...and, since B3 (2026-11-12), on the new default too, the same
        // rule as a bundle attach. Before B3 the default got nothing and
        // every client then read "on n of m".
        Assert.Equal(
            new[] { Zimmer, Stryker, NuVasive }.OrderBy(x => x),
            links.Where(l => l.ScheduleId == NewDefault).Select(l => l.ClientId).OrderBy(x => x));
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
        Assert.All(d.Clients, c => Assert.Equal(4, c.OfMembers));
        Assert.Equal(2, d.Clients.Single(c => c.ClientId == Zimmer).OnMembers);   // now "on 2 of 4"
    }

    // ── B3 (Schedules NEW November feedback, Nisa 3.1) ──────────────────
    // Under spec 6.1 a link row on a default means "configured for this
    // client" (ranks first within its speed, hook for an override), so a
    // bundle whose members are all defaults is an ordinary bundle and a
    // client must be attachable to it.

    /// <summary>A bundle whose only members are defaults. Before B3 the
    /// attach returned 0 and wrote nothing, so Nisa's "add client" did
    /// nothing at all.</summary>
    [Fact]
    public async Task AttachClientsToBundleAsync_links_the_client_to_default_members()
    {
        var svc = NewSvc(out var seed);
        seed.TucClients.Add(new TucClient { UcclId = Zimmer, UcclCode = "ZIM", UcclName = "Zimmer Biomet" });
        Header(seed, DefaultSched, "AKL 8am", isDefault: true);
        Header(seed, 1002, "AKL Overnight", isDefault: true);
        seed.BulkRunScheduleBundles.Add(new BulkRunScheduleBundle
        {
            BundleId = BundleId, Name = "Defaults", IsActive = true, CreatedUtc = DateTime.UtcNow, CreatedBy = "seed",
        });
        seed.BulkRunScheduleBundleMembers.Add(new BulkRunScheduleBundleMember { BundleId = BundleId, ScheduleId = DefaultSched });
        seed.BulkRunScheduleBundleMembers.Add(new BulkRunScheduleBundleMember { BundleId = BundleId, ScheduleId = 1002 });
        await seed.SaveChangesAsync();

        var added = await svc.AttachClientsToBundleAsync(BundleId, new[] { Zimmer });

        Assert.Equal(2, added);
        var links = await seed.ScheduleClients.AsNoTracking().ToListAsync();
        Assert.Equal(new[] { DefaultSched, 1002 }, links.Where(l => l.ClientId == Zimmer).Select(l => l.ScheduleId).OrderBy(x => x));
        // Idempotent: a second attach adds nothing.
        Assert.Equal(0, await svc.AttachClientsToBundleAsync(BundleId, new[] { Zimmer }));
        // And the bundle modal shows the client, on 2 of 2 members.
        var d = await svc.GetBundleDetailAsync(BundleId);
        var zim = Assert.Single(d.Clients);
        Assert.Equal(2, zim.OnMembers);
        Assert.Equal(2, zim.OfMembers);
    }

    /// <summary>Mixed bundle: the attach now covers the default member too.</summary>
    [Fact]
    public async Task AttachClientsToBundleAsync_on_a_mixed_bundle_links_every_live_member()
    {
        var svc = NewSvc(out var seed);
        await SeedBundleAsync(seed);
        const int Smith = 105;
        seed.TucClients.Add(new TucClient { UcclId = Smith, UcclCode = "SMI", UcclName = "Smith" });
        await seed.SaveChangesAsync();

        var added = await svc.AttachClientsToBundleAsync(BundleId, new[] { Smith });

        Assert.Equal(3, added);
        var onSmith = (await seed.ScheduleClients.AsNoTracking().Where(l => l.ClientId == Smith).ToListAsync())
            .Select(l => l.ScheduleId).OrderBy(x => x);
        Assert.Equal(new[] { DefaultSched, MedicalWlg, MedicalChc }, onSmith);
        Assert.StartsWith("RoutedOps:bundle-attach:", (await seed.ScheduleClients.AsNoTracking().FirstAsync(l => l.ClientId == Smith)).CreatedBy);
    }

    /// <summary>No members at all, or only retired ones: one clear message
    /// instead of "Bundle 7 has no members." or a silent 0.</summary>
    [Fact]
    public async Task AttachClientsToBundleAsync_on_an_empty_bundle_says_so()
    {
        var svc = NewSvc(out var seed);
        seed.BulkRunScheduleBundles.Add(new BulkRunScheduleBundle
        {
            BundleId = BundleId, Name = "Medical Nationwide", IsActive = true, CreatedUtc = DateTime.UtcNow, CreatedBy = "seed",
        });
        await seed.SaveChangesAsync();

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(
            () => svc.AttachClientsToBundleAsync(BundleId, new[] { Zimmer }));
        Assert.Equal(EmptyBundleMessage, ex.Message);

        // A bundle whose only member is retired is empty too.
        seed.BulkRunScheduleHeaders.Add(new BulkRunScheduleHeader
        {
            ScheduleId = 1020, Name = "Gone", IsDefault = false, IsActive = true,
            CreatedUtc = DateTime.UtcNow, CreatedBy = "seed", RetiredUtc = DateTime.UtcNow,
        });
        seed.BulkRunScheduleBundleMembers.Add(new BulkRunScheduleBundleMember { BundleId = BundleId, ScheduleId = 1020 });
        await seed.SaveChangesAsync();
        ex = await Assert.ThrowsAsync<InvalidOperationException>(
            () => svc.AttachClientsToBundleAsync(BundleId, new[] { Zimmer }));
        Assert.Equal(EmptyBundleMessage, ex.Message);
    }

    /// <summary>Spec 6.1 rule 3, the same rule DetachClientAsync applies to
    /// one schedule: a non-default schedule with no LegacyClientId needs at
    /// least one client. Before this guard, removing NuVasive from a bundle
    /// where it was the only client on a member left that member bookable
    /// by nobody. The refusal is all-or-nothing and names the schedule.</summary>
    [Fact]
    public async Task DetachClientFromBundleAsync_refuses_to_remove_the_last_client_of_a_specific_member()
    {
        var svc = NewSvc(out var seed);
        await SeedBundleAsync(seed);
        const int MedicalHam = 1011;
        Header(seed, MedicalHam, "Medical HAM 8am", isDefault: false);
        Link(seed, MedicalHam, NuVasive);   // NuVasive is the only client here
        seed.BulkRunScheduleBundleMembers.Add(new BulkRunScheduleBundleMember { BundleId = BundleId, ScheduleId = MedicalHam });
        await seed.SaveChangesAsync();

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(
            () => svc.DetachClientFromBundleAsync(BundleId, NuVasive));
        Assert.Contains("Medical HAM 8am", ex.Message);
        Assert.Contains("#1011", ex.Message);

        // Nothing removed anywhere, including the member where it was not the last.
        var nuva = await seed.ScheduleClients.AsNoTracking().Where(l => l.ClientId == NuVasive).ToListAsync();
        Assert.Equal(new[] { MedicalChc, MedicalHam }, nuva.Select(l => l.ScheduleId).OrderBy(x => x));
    }

    /// <summary>The guard does not fire on a default member: a default is
    /// bookable by every client whether or not anyone is linked.</summary>
    [Fact]
    public async Task DetachClientFromBundleAsync_removes_the_only_link_on_a_default_member()
    {
        var svc = NewSvc(out var seed);
        await SeedBundleAsync(seed);
        Link(seed, DefaultSched, NuVasive);
        await seed.SaveChangesAsync();

        var removed = await svc.DetachClientFromBundleAsync(BundleId, NuVasive);

        Assert.Equal(2, removed);   // DefaultSched + MedicalChc
        Assert.DoesNotContain(await seed.ScheduleClients.AsNoTracking().ToListAsync(), l => l.ClientId == NuVasive);
    }
}
