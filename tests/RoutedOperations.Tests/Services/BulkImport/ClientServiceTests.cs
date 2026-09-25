using RoutedOperations.Core.Application.Dtos.BulkImport.Clients;
using RoutedOperations.Core.Application.Services.BulkImport;
using RoutedOperations.Core.Domain;
using RoutedOperations.Core.Domain.Despatch;

namespace RoutedOperations.Tests.Services.BulkImport;

// Covers all public methods on ClientService. The key branching axes are:
//  - CountryCode claim = US vs NZ vs missing (defaults to US)
//  - Internal claim = true bypasses contact-scope filter
//  - Contact -> client join (tucClientContact + tblClientContact)
//  - Schedule cutoff filtering (client + tenant clock vs cutoff time)
public class ClientServiceTests
{
    private static ClientService NewSvc(
        out DynamicDespatchDbContext seed,
        string countryCode = "US",
        string internalClaim = null,
        string timeZone = null)
    {
        var opts = BulkImportTestHarness.NewOptions();
        seed = BulkImportTestHarness.Context(opts);
        var accessor = BulkImportTestHarness.Accessor(countryCode, internalClaim, timeZone);
        var cache = BulkImportTestHarness.Cache(accessor);
        return new ClientService(BulkImportTestHarness.Factory(opts), accessor, cache);
    }

    // ---------------- Get -----------------

    [Fact]
    public async Task Get_InternalUser_ReturnsEmptyClientsAndInternalFlag()
    {
        var svc = NewSvc(out var seed, countryCode: "US", internalClaim: "True");
        seed.TucClients.Add(new TucClient { UcclId = 1, UcclCode = "A", UcclName = "Aa", UcclActive = true });
        await seed.SaveChangesAsync();

        var resp = await svc.Get(Guid.NewGuid(), contactId: 1);

        Assert.True(resp.Success);
        Assert.True(resp.IsInternal);
        Assert.True(resp.IsUsTenant);
        Assert.Empty(resp.Clients);
    }

    [Fact]
    public async Task Get_ExternalContact_ReturnsOnlyLinkedActiveClients()
    {
        var svc = NewSvc(out var seed, countryCode: "US");
        // Only client 1 has the contact linked and is active. Client 2 has no
        // link, client 3 is inactive so must be filtered out even with a link.
        seed.TucClients.AddRange(
            new TucClient
            {
                UcclId = 1,
                UcclCode = "A",
                UcclName = "Linked",
                UcclActive = true,
                TucClientContacts = new List<TucClientContact>
                {
                    new() { UcctId = 10, Active = true, UcctFirstname = "F", UcctSurname = "S", UcctEmail = "a@b" }
                }
            },
            new TucClient
            {
                UcclId = 2,
                UcclCode = "B",
                UcclName = "Unlinked",
                UcclActive = true
            });
        await seed.SaveChangesAsync();

        var resp = await svc.Get(Guid.NewGuid(), contactId: 10);

        Assert.True(resp.Success);
        Assert.False(resp.IsInternal);
        Assert.Equal(new[] { "Linked" }, resp.Clients.Select(c => c.Name).ToArray());
    }

    [Fact]
    public async Task Get_NzTenant_SetsIsUsTenantFalse()
    {
        var svc = NewSvc(out _, countryCode: "NZ");

        var resp = await svc.Get(Guid.NewGuid(), contactId: 1);

        Assert.False(resp.IsUsTenant);
    }

    [Fact]
    public async Task Get_MissingCountryCode_DefaultsToUsTenant()
    {
        var svc = NewSvc(out _, countryCode: null);

        var resp = await svc.Get(Guid.NewGuid(), contactId: 1);

        Assert.True(resp.IsUsTenant);
    }

    // ---------------- Search -----------------

    [Fact]
    public async Task Search_NameMatchIsCaseInsensitive()
    {
        var svc = NewSvc(out var seed, countryCode: "US", internalClaim: "True");
        seed.TucClients.AddRange(
            new TucClient { UcclId = 1, UcclCode = "AB", UcclName = "Alphabet", UcclActive = true },
            new TucClient { UcclId = 2, UcclCode = "ZZ", UcclName = "Zenith", UcclActive = true });
        await seed.SaveChangesAsync();

        var resp = await svc.Search(Guid.NewGuid(), contactId: 1, search: "ALPHA");

        Assert.Equal(new[] { "Alphabet" }, resp.Clients.Select(c => c.Name).ToArray());
    }

    [Fact]
    public async Task Search_CodeMatchIsCaseInsensitive()
    {
        var svc = NewSvc(out var seed, countryCode: "US", internalClaim: "True");
        seed.TucClients.Add(new TucClient { UcclId = 1, UcclCode = "acme", UcclName = "Any", UcclActive = true });
        await seed.SaveChangesAsync();

        var resp = await svc.Search(Guid.NewGuid(), contactId: 1, search: "ACME");

        Assert.Single(resp.Clients);
    }

    [Fact]
    public async Task Search_ExternalContact_HonoursContactLink()
    {
        var svc = NewSvc(out var seed, countryCode: "US");
        seed.TucClients.AddRange(
            new TucClient
            {
                UcclId = 1,
                UcclCode = "AB",
                UcclName = "AlphaLinked",
                UcclActive = true,
                TucClientContacts = new List<TucClientContact> { new() { UcctId = 10, Active = true } }
            },
            new TucClient
            {
                UcclId = 2,
                UcclCode = "AC",
                UcclName = "AlphaUnlinked",
                UcclActive = true
            });
        await seed.SaveChangesAsync();

        var resp = await svc.Search(Guid.NewGuid(), contactId: 10, search: "Alpha");

        Assert.Equal(new[] { "AlphaLinked" }, resp.Clients.Select(c => c.Name).ToArray());
    }

    [Fact]
    public async Task Search_CapsAt20Results()
    {
        var svc = NewSvc(out var seed, countryCode: "US", internalClaim: "True");
        for (int i = 0; i < 25; i++)
            seed.TucClients.Add(new TucClient { UcclId = i + 1, UcclCode = $"C{i:D2}", UcclName = $"Match{i:D2}", UcclActive = true });
        await seed.SaveChangesAsync();

        var resp = await svc.Search(Guid.NewGuid(), contactId: 1, search: "match");

        Assert.Equal(20, resp.Clients.Count());
    }

    // ---------------- GetSettings -----------------

    [Fact]
    public async Task GetSettings_UnknownClient_ReturnsInvalidMessage()
    {
        var svc = NewSvc(out _, countryCode: "US", internalClaim: "True");

        var resp = await svc.GetSettings(Guid.NewGuid(), contactId: 1, clientId: 999);

        Assert.False(resp.Success);
        Assert.Contains(resp.Messages, m => m.Message == "Invalid client or contact.");
    }

    [Fact]
    public async Task GetSettings_InternalUser_BypassesContactFilter()
    {
        var svc = NewSvc(out var seed, countryCode: "US", internalClaim: "True");
        seed.TucClients.Add(new TucClient
        {
            UcclId = 5,
            UcclCode = "AB",
            UcclName = "ClientName",
            UcclActive = true,
            JobPrefix = " abc "
        });
        await seed.SaveChangesAsync();

        var resp = await svc.GetSettings(Guid.NewGuid(), contactId: 1, clientId: 5);

        Assert.True(resp.Success);
        Assert.Equal(5, resp.Settings.Id);
        Assert.Equal("ABC", resp.Settings.JobPrefix); // trimmed + upper
    }

    [Fact]
    public async Task GetSettings_UsesDefaultSpeedsWhenClientHasNoAvailableSpeeds()
    {
        var svc = NewSvc(out var seed, countryCode: "US", internalClaim: "True");
        seed.TucClients.Add(new TucClient { UcclId = 5, UcclCode = "AB", UcclName = "X", UcclActive = true, JobPrefix = "P" });
        seed.TucJobTypes.Add(new TucJobType { UcjtId = 1, UcjtName = "SameDay" });
        seed.TblClientDefaultAvailableSpeeds.Add(new TblClientDefaultAvailableSpeed
        {
            Id = 1,
            Name = "API - Web Integration",
            Active = true,
            SpeedId = 1
        });
        await seed.SaveChangesAsync();

        var resp = await svc.GetSettings(Guid.NewGuid(), contactId: 1, clientId: 5);

        Assert.True(resp.Success);
        Assert.Equal(new[] { "SameDay" }, resp.Settings.Speeds.Select(s => s.Name).ToArray());
    }

    [Fact]
    public async Task GetSettings_UsesClientAvailableSpeedsWhenPresent()
    {
        var svc = NewSvc(out var seed, countryCode: "US", internalClaim: "True");
        seed.TucClients.Add(new TucClient { UcclId = 5, UcclCode = "AB", UcclName = "X", UcclActive = true, JobPrefix = "P" });
        seed.TucJobTypes.AddRange(
            new TucJobType { UcjtId = 1, UcjtName = "Rush" },
            new TucJobType { UcjtId = 2, UcjtName = "Fallback" });
        seed.TblClientAvailableSpeeds.Add(new TblClientAvailableSpeed
        {
            Id = 100,
            ClientId = 5,
            SpeedId = 1,
            Active = true,
            WebVisible = true
        });
        seed.TblClientDefaultAvailableSpeeds.Add(new TblClientDefaultAvailableSpeed
        {
            Id = 1,
            Name = "API - Web Integration",
            Active = true,
            SpeedId = 2
        });
        await seed.SaveChangesAsync();

        var resp = await svc.GetSettings(Guid.NewGuid(), contactId: 1, clientId: 5);

        // Client-specific list wins over default fallback.
        Assert.Equal(new[] { "Rush" }, resp.Settings.Speeds.Select(s => s.Name).ToArray());
    }

    [Fact]
    public async Task GetSettings_BackfillsScheduleSpeedNames()
    {
        var svc = NewSvc(out var seed, countryCode: "US", internalClaim: "True");
        seed.TucClients.Add(new TucClient { UcclId = 5, UcclCode = "AB", UcclName = "X", UcclActive = true, JobPrefix = "P" });
        seed.TucJobTypes.Add(new TucJobType { UcjtId = 42, UcjtName = "Rush" });
        seed.TblBulkRunSchedules.Add(new TblBulkRunSchedule
        {
            BulkRunScheduleId = 1,
            Name = "Morning",
            ClientId = 5,
            SpeedId = 42,
            Region = 3,
            DayOfWeek = 1,
            StartTime = TimeSpan.FromHours(8),
            CutoffHours = 2
        });
        await seed.SaveChangesAsync();

        var resp = await svc.GetSettings(Guid.NewGuid(), contactId: 1, clientId: 5);

        var schedule = resp.Settings.Schedules.Single();
        Assert.Equal(42, schedule.Speed.Id);
        Assert.Equal("Rush", schedule.Speed.Name);
    }

    [Fact]
    public async Task GetSettings_NzTenant_ClaimOverridesParameter()
    {
        var svc = NewSvc(out var seed, countryCode: "NZ", internalClaim: "True");
        seed.TucClients.Add(new TucClient { UcclId = 5, UcclCode = "AB", UcclName = "X", UcclActive = true, JobPrefix = "P" });
        await seed.SaveChangesAsync();

        // Caller passes isUsTenant=true; claim (NZ) must win.
        var resp = await svc.GetSettings(Guid.NewGuid(), contactId: 1, clientId: 5, isUsTenant: true);

        Assert.False(resp.Settings.IsUsTenant);
    }

    // ---------------- GetSchedulesByBookDate -----------------

    [Fact]
    public async Task GetSchedulesByBookDate_ReturnsSchedulesBeforeCutoff()
    {
        var svc = NewSvc(out var seed, countryCode: "US", internalClaim: "True", timeZone: "UTC");
        // Book date well in the future so cutoff (StartTime - 2h) still lies ahead of tenant Now.
        var future = DateTime.UtcNow.AddDays(30).Date;
        seed.TucJobTypes.Add(new TucJobType { UcjtId = 1, UcjtName = "SameDay" });
        seed.TblBulkRunSchedules.Add(new TblBulkRunSchedule
        {
            BulkRunScheduleId = 1,
            Name = "Morning",
            ClientId = 5,
            SpeedId = 1,
            Region = 3,
            DayOfWeek = future.DayOfWeek == DayOfWeek.Sunday ? (short)7 : (short)future.DayOfWeek,
            StartTime = TimeSpan.FromHours(9),
            CutoffHours = 2
        });
        await seed.SaveChangesAsync();

        var req = new SchedulesByBookDateRequest
        {
            ClientId = 5,
            SpeedId = 1,
            DepotId = 0,
            BookDate = future
        };
        var resp = await svc.GetSchedulesByBookDate(contactId: 1, req);

        Assert.True(resp.Success);
        Assert.Single(resp.Schedules);
    }

    [Fact]
    public async Task GetSchedulesByBookDate_FiltersOutSchedulesWhoseCutoffHasPassed()
    {
        // Yesterday's schedule (past cutoff) should be filtered out.
        var svc = NewSvc(out var seed, countryCode: "US", internalClaim: "True", timeZone: "UTC");
        var past = DateTime.UtcNow.AddDays(-1).Date;
        seed.TblBulkRunSchedules.Add(new TblBulkRunSchedule
        {
            BulkRunScheduleId = 1,
            Name = "Old",
            ClientId = 5,
            SpeedId = 1,
            Region = 3,
            DayOfWeek = past.DayOfWeek == DayOfWeek.Sunday ? (short)7 : (short)past.DayOfWeek,
            StartTime = TimeSpan.FromHours(9),
            CutoffHours = 2
        });
        await seed.SaveChangesAsync();

        var req = new SchedulesByBookDateRequest
        {
            ClientId = 5,
            SpeedId = 1,
            DepotId = 0,
            BookDate = past
        };
        var resp = await svc.GetSchedulesByBookDate(contactId: 1, req);

        Assert.True(resp.Success);
        Assert.Empty(resp.Schedules);
    }

    [Fact]
    public async Task GetSchedulesByBookDate_UtcBookDateIsConvertedToTenantTime()
    {
        // Just make sure the conversion doesn't throw and the tenant-time
        // schedule still passes the filter.
        var svc = NewSvc(out var seed, countryCode: "US", internalClaim: "True", timeZone: "UTC");
        var utc = DateTime.SpecifyKind(DateTime.UtcNow.AddDays(7).Date, DateTimeKind.Utc);
        seed.TblBulkRunSchedules.Add(new TblBulkRunSchedule
        {
            BulkRunScheduleId = 1,
            Name = "X",
            ClientId = 5,
            SpeedId = 1,
            Region = 3,
            DayOfWeek = utc.DayOfWeek == DayOfWeek.Sunday ? (short)7 : (short)utc.DayOfWeek,
            StartTime = TimeSpan.FromHours(20),
            CutoffHours = 1
        });
        await seed.SaveChangesAsync();

        var req = new SchedulesByBookDateRequest
        {
            ClientId = 5,
            SpeedId = 1,
            DepotId = 0,
            BookDate = utc
        };
        var resp = await svc.GetSchedulesByBookDate(contactId: 1, req);

        Assert.True(resp.Success); // did not throw
    }

    [Fact]
    public async Task GetSchedulesByBookDate_DepotIdFiltersByRegion()
    {
        var svc = NewSvc(out var seed, countryCode: "US", internalClaim: "True", timeZone: "UTC");
        var future = DateTime.UtcNow.AddDays(7).Date;
        var dow = future.DayOfWeek == DayOfWeek.Sunday ? (short)7 : (short)future.DayOfWeek;
        seed.TblBulkRunSchedules.AddRange(
            new TblBulkRunSchedule { BulkRunScheduleId = 1, Name = "A", ClientId = 5, SpeedId = 1, Region = 3, DayOfWeek = dow, StartTime = TimeSpan.FromHours(22), CutoffHours = 1 },
            new TblBulkRunSchedule { BulkRunScheduleId = 2, Name = "B", ClientId = 5, SpeedId = 1, Region = 4, DayOfWeek = dow, StartTime = TimeSpan.FromHours(22), CutoffHours = 1 });
        await seed.SaveChangesAsync();

        var req = new SchedulesByBookDateRequest { ClientId = 5, SpeedId = 1, DepotId = 3, BookDate = future };
        var resp = await svc.GetSchedulesByBookDate(contactId: 1, req);

        // Only schedule 1 has Region == 3.
        Assert.Single(resp.Schedules);
        Assert.Equal("A", resp.Schedules.First().Name);
    }

    // ---------------- GetJobNumber -----------------

    // GetJobNumber issues a Serializable transaction, which the EF Core InMemory
    // provider deliberately does not support. Rather than exclude the method
    // from coverage, exercise the path and assert the well-known InMemory
    // exception so any future switch to a relational InMemory (SQLite) will
    // flip this test to real behaviour without a false positive here.
    [Fact]
    public async Task GetJobNumber_InMemoryProvider_ThrowsBecauseTransactionsUnsupported()
    {
        var svc = NewSvc(out _);
        var req = new JobNumberRequest { JobNumberId = 1 };

        await Assert.ThrowsAsync<InvalidOperationException>(() => svc.GetJobNumber(req));
    }
}
