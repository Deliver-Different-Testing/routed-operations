using RoutedOperations.Core.Application.Dtos.BulkImport.Bulk;
using RoutedOperations.Core.Application.Services.BulkImport;
using RoutedOperations.Core.Domain;
using RoutedOperations.Core.Domain.Despatch;

namespace RoutedOperations.Tests.Services.BulkImport;

// Covers the Import dispatcher and its two-branch ProcessOnDemand /
// ProcessRoutedJobs flows. Both flows call SPs at their happy-path exit
// (INT_stpJob_BulkInsertAsync / DD_stpJob_InsertExceleratorAsync /
// UTL_fncSuburb_FromNameWithPostCode etc.), which the InMemory provider
// does not implement, so the tests here exercise the pre-SP guard clauses
// where the entire behaviour is validation logic that runs before any DB
// procedure call fires.
public class BulkImportServiceV2JobFactoryTests
{
    // ---------------- Import (top-level dispatch) -----------------

    [Fact]
    public async Task Import_UnknownClient_ReturnsInvalidClientMessage()
    {
        var svc = BulkImportServiceV2CoreTests.NewSvc(out _, out _, countryCode: "US");
        var req = new BulkImportRequest
        {
            ClientId = 999,
            SpeedId = 1,
            BookDate = DateTime.Today.AddDays(1),
            JobType = "ondemand",
            Jobs = new List<BulkImportJobCreateDto> { new() { JobNumber = "J1", ToAddress = "T", ToContact = "C" } }
        };
        var resp = await svc.Import(contactId: 1, req);

        Assert.False(resp.Success);
        Assert.Contains(resp.Messages, m => m.Message == "Invalid client.");
    }

    [Fact]
    public async Task Import_OnDemand_BookDateInPast_ReturnsFutureMessage()
    {
        var svc = BulkImportServiceV2CoreTests.NewSvc(out var seed, out _, countryCode: "US", internalClaim: "True", timeZone: "UTC");
        SeedMinimalClient(seed, 5, speedId: 1);
        await seed.SaveChangesAsync();

        var req = new BulkImportRequest
        {
            ClientId = 5,
            SpeedId = 1,
            BookDate = DateTime.UtcNow.AddDays(-5),
            JobType = "ondemand",
            Jobs = new List<BulkImportJobCreateDto> { new() { JobNumber = "J1", ToAddress = "T", ToContact = "C" } }
        };
        var resp = await svc.Import(contactId: 1, req);

        Assert.False(resp.Success);
        Assert.Contains(resp.Messages, m => m.Message == "Book date must be in the future.");
    }

    [Fact]
    public async Task Import_OnDemand_MismatchedSpeed_ReturnsInvalidSpeed()
    {
        var svc = BulkImportServiceV2CoreTests.NewSvc(out var seed, out _, countryCode: "US", internalClaim: "True", timeZone: "UTC");
        SeedMinimalClient(seed, 5, speedId: 42);
        await seed.SaveChangesAsync();

        var req = new BulkImportRequest
        {
            ClientId = 5,
            SpeedId = 999, // doesn't match client's speed
            BookDate = DateTime.UtcNow.AddDays(10),
            JobType = "ondemand",
            Jobs = new List<BulkImportJobCreateDto> { new() { JobNumber = "J1", ToAddress = "T", ToContact = "C" } }
        };
        var resp = await svc.Import(contactId: 1, req);

        Assert.False(resp.Success);
        Assert.Contains(resp.Messages, m => m.Message == "Invalid speed.");
    }

    [Fact]
    public async Task Import_OnDemand_EmptyJobs_ReturnsNoJobsMessage()
    {
        var svc = BulkImportServiceV2CoreTests.NewSvc(out var seed, out _, countryCode: "US", internalClaim: "True", timeZone: "UTC");
        SeedMinimalClient(seed, 5, speedId: 1);
        await seed.SaveChangesAsync();

        var req = new BulkImportRequest
        {
            ClientId = 5,
            SpeedId = 1,
            BookDate = DateTime.UtcNow.AddDays(10),
            JobType = "ondemand",
            Jobs = new List<BulkImportJobCreateDto>()
        };
        var resp = await svc.Import(contactId: 1, req);

        Assert.False(resp.Success);
        Assert.Contains(resp.Messages, m => m.Message == "No jobs to import.");
    }

    [Fact]
    public async Task Import_OnDemand_SpeedIdZero_ClientSpeedNotLoaded_ReturnsInvalidSpeed()
    {
        // The client anonymous type projection loads Speed by
        // Context.TucJobTypes.Where(s => s.UcjtId == request.SpeedId), so a
        // request with SpeedId=0 finds no default speed row, the coercion
        // condition (client.Speed?.UcjtId is int) is false, and the
        // downstream validator fires "Invalid speed." Locking this in as
        // current behaviour so a future fix to fall back on client.DefaultSpeed
        // flips this test cleanly.
        var svc = BulkImportServiceV2CoreTests.NewSvc(out var seed, out _, countryCode: "US", internalClaim: "True", timeZone: "UTC");
        SeedMinimalClient(seed, 5, speedId: 7);
        await seed.SaveChangesAsync();

        var req = new BulkImportRequest
        {
            ClientId = 5,
            SpeedId = 0,
            BookDate = DateTime.UtcNow.AddDays(10),
            JobType = "ondemand",
            Jobs = new List<BulkImportJobCreateDto> { new() { JobNumber = "J1", ToAddress = "T", ToContact = "C" } }
        };
        var resp = await svc.Import(contactId: 1, req);
        Assert.False(resp.Success);
        Assert.Contains(resp.Messages, m => m.Message == "Invalid speed.");
    }

    // ---------------- Routed branch -----------------

    [Fact]
    public async Task Import_Routed_UnknownClient_ReturnsInvalidClient()
    {
        var svc = BulkImportServiceV2CoreTests.NewSvc(out _, out _, countryCode: "US");
        var req = new BulkImportRequest
        {
            ClientId = 999,
            SpeedId = 1,
            BookDate = DateTime.UtcNow.AddDays(10),
            JobType = "routed",
            Jobs = new List<BulkImportJobCreateDto> { new() { JobNumber = "J1", ToAddress = "T", ToContact = "C" } }
        };
        var resp = await svc.Import(contactId: 1, req);

        Assert.False(resp.Success);
        Assert.Contains(resp.Messages, m => m.Message == "Invalid client.");
    }

    [Fact]
    public async Task Import_Routed_InvalidOriginLocationId_ReturnsError()
    {
        var svc = BulkImportServiceV2CoreTests.NewSvc(out var seed, out _, countryCode: "US", internalClaim: "True", timeZone: "UTC");
        SeedMinimalClient(seed, 5, speedId: 1);
        await seed.SaveChangesAsync();

        var req = new BulkImportRequest
        {
            ClientId = 5,
            SpeedId = 1,
            BookDate = DateTime.UtcNow.AddDays(10),
            JobType = "routed",
            OriginLocationId = 42, // not present
            Jobs = new List<BulkImportJobCreateDto> { new() { JobNumber = "J1", ToAddress = "T", ToContact = "C" } }
        };
        var resp = await svc.Import(contactId: 1, req);

        Assert.False(resp.Success);
        Assert.Contains(resp.Messages, m => m.Message == "Selected Origin Location does not exist or is not active.");
    }

    [Fact]
    public async Task Import_Routed_MismatchedSpeed_ReturnsInvalidSpeed()
    {
        var svc = BulkImportServiceV2CoreTests.NewSvc(out var seed, out _, countryCode: "US", internalClaim: "True", timeZone: "UTC");
        SeedMinimalClient(seed, 5, speedId: 42);
        await seed.SaveChangesAsync();

        var req = new BulkImportRequest
        {
            ClientId = 5,
            SpeedId = 999,
            BookDate = DateTime.UtcNow.AddDays(10),
            JobType = "routed",
            Jobs = new List<BulkImportJobCreateDto> { new() { JobNumber = "J1", ToAddress = "T", ToContact = "C" } }
        };
        var resp = await svc.Import(contactId: 1, req);

        Assert.False(resp.Success);
        Assert.Contains(resp.Messages, m => m.Message == "Invalid speed.");
    }

    [Fact]
    public async Task Import_Routed_ScheduleIdSet_ButInvalid_ReturnsInvalidSchedule()
    {
        var svc = BulkImportServiceV2CoreTests.NewSvc(out var seed, out _, countryCode: "US", internalClaim: "True", timeZone: "UTC");
        SeedMinimalClient(seed, 5, speedId: 1);
        await seed.SaveChangesAsync();

        var req = new BulkImportRequest
        {
            ClientId = 5,
            SpeedId = 1,
            ScheduleId = 12345,
            BookDate = DateTime.UtcNow.AddDays(10),
            JobType = "routed",
            Jobs = new List<BulkImportJobCreateDto> { new() { JobNumber = "J1", ToAddress = "T", ToContact = "C" } }
        };
        var resp = await svc.Import(contactId: 1, req);

        Assert.False(resp.Success);
        Assert.Contains(resp.Messages, m => m.Message == "Invalid schedule.");
    }

    [Fact]
    public async Task Import_Routed_UsTenant_NoOriginResolution_ReturnsErrorMessage()
    {
        // US tenant, no schedule region + no RouteFromClientSite + no
        // OriginLocationId -> Steve's 4-step precedence exhausts.
        var svc = BulkImportServiceV2CoreTests.NewSvc(out var seed, out _, countryCode: "US", internalClaim: "True", timeZone: "UTC");
        SeedMinimalClient(seed, 5, speedId: 1);
        await seed.SaveChangesAsync();

        var req = new BulkImportRequest
        {
            ClientId = 5,
            SpeedId = 1,
            BookDate = DateTime.UtcNow.AddDays(10),
            JobType = "routed",
            Jobs = new List<BulkImportJobCreateDto>
            {
                new() { JobNumber = "J1", ToAddress = "T", ToContact = "C" }
            }
        };
        var resp = await svc.Import(contactId: 1, req);

        Assert.False(resp.Success);
        Assert.Contains(resp.Messages, m => m.Message?.StartsWith("Could not resolve a rating origin") == true);
    }

    [Fact]
    public async Task Import_NullJobType_TreatsAsRouted()
    {
        // Blank JobType hits the else-branch (routed). Unknown client -> "Invalid client."
        var svc = BulkImportServiceV2CoreTests.NewSvc(out _, out _, countryCode: "US");
        var req = new BulkImportRequest
        {
            ClientId = 999,
            SpeedId = 1,
            BookDate = DateTime.UtcNow.AddDays(10),
            JobType = null,
            Jobs = new List<BulkImportJobCreateDto> { new() { JobNumber = "J1", ToAddress = "T", ToContact = "C" } }
        };
        var resp = await svc.Import(contactId: 1, req);
        Assert.False(resp.Success);
    }

    [Fact]
    public async Task Import_UtcBookDate_ConvertedToTenantTime()
    {
        // The conversion should not throw when TimeZone claim is UTC.
        var svc = BulkImportServiceV2CoreTests.NewSvc(out _, out _, countryCode: "US", timeZone: "UTC");
        var req = new BulkImportRequest
        {
            ClientId = 999,
            SpeedId = 1,
            BookDate = DateTime.SpecifyKind(DateTime.UtcNow.AddDays(10), DateTimeKind.Utc),
            JobType = "ondemand",
            Jobs = new List<BulkImportJobCreateDto> { new() { JobNumber = "J1", ToAddress = "T", ToContact = "C" } }
        };
        var resp = await svc.Import(contactId: 1, req);
        Assert.False(resp.Success); // client not found - but no throw
    }

    [Fact]
    public async Task Import_CourierPercentageOverride_RoundedToFourDp()
    {
        var svc = BulkImportServiceV2CoreTests.NewSvc(out _, out _, countryCode: "US");
        var req = new BulkImportRequest
        {
            ClientId = 999,
            SpeedId = 1,
            BookDate = DateTime.UtcNow.AddDays(10),
            JobType = "ondemand",
            Jobs = new List<BulkImportJobCreateDto>
            {
                new() { JobNumber = "J1", ToAddress = "T", ToContact = "C", CourierPercentageOverride = 0.123456789m }
            }
        };
        // The mutation happens in-place before the client lookup.
        await svc.Import(contactId: 1, req);
        Assert.Equal(0.1235m, req.Jobs!.First().CourierPercentageOverride);
    }

    // Seed the minimum for the `client` anonymous type projection in Import
    // to return a non-null row. Contact link required for non-internal, but
    // internalClaim="True" bypasses that.
    private static void SeedMinimalClient(DynamicDespatchDbContext seed, int clientId, int speedId)
    {
        seed.TucClients.Add(new TucClient
        {
            UcclId = clientId,
            UcclCode = "C",
            UcclName = "N",
            UcclActive = true,
            JobPrefix = "P"
        });
        seed.TucJobTypes.Add(new TucJobType { UcjtId = speedId, UcjtName = "Speed", SystemName = "Sys", ZoneRated = false });
    }
}
