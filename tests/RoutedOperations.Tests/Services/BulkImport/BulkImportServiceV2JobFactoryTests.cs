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
        var svc = BulkImportServiceV2CoreTests.NewSvc(out var seed, out _, countryCode: "US", clientTypeId: "4", timeZone: "UTC");
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
        var svc = BulkImportServiceV2CoreTests.NewSvc(out var seed, out _, countryCode: "US", clientTypeId: "4", timeZone: "UTC");
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
        var svc = BulkImportServiceV2CoreTests.NewSvc(out var seed, out _, countryCode: "US", clientTypeId: "4", timeZone: "UTC");
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
        var svc = BulkImportServiceV2CoreTests.NewSvc(out var seed, out _, countryCode: "US", clientTypeId: "4", timeZone: "UTC");
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
        var svc = BulkImportServiceV2CoreTests.NewSvc(out var seed, out _, countryCode: "US", clientTypeId: "4", timeZone: "UTC");
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
        var svc = BulkImportServiceV2CoreTests.NewSvc(out var seed, out _, countryCode: "US", clientTypeId: "4", timeZone: "UTC");
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
        var svc = BulkImportServiceV2CoreTests.NewSvc(out var seed, out _, countryCode: "US", clientTypeId: "4", timeZone: "UTC");
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
        var svc = BulkImportServiceV2CoreTests.NewSvc(out var seed, out _, countryCode: "US", clientTypeId: "4", timeZone: "UTC");
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
        // Staff only: a customer's override is dropped (BulkImportCustomerScopeTests).
        var svc = BulkImportServiceV2CoreTests.NewSvc(out _, out _, countryCode: "US", clientTypeId: "4");
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
    // clientTypeId="4" (tenant staff) bypasses that.
    // "Invalid suburb(s)." on its own gave the operator nothing to look for in
    // a file of hundreds of rows. The message now names each row the server
    // could not place and the suburb and postcode it was given, so the row can
    // be found and fixed. The client-site origin carries no pickup suburb on
    // NZ, so the pickup side is reported too.
    [Fact]
    public async Task Import_Routed_Nz_UnknownSuburb_NamesTheRowAndTheValue()
    {
        var svc = BulkImportServiceV2CoreTests.NewSvc(out var seed, out _, countryCode: "NZ", clientTypeId: "4", timeZone: "UTC");
        SeedMinimalClient(seed, 5, speedId: 1);
        seed.TucSuburbs.Add(new TucSuburb { UcsuId = 1, UcsuName = "Ponsonby", PostCode = "1011" });
        await seed.SaveChangesAsync();

        var req = new BulkImportRequest
        {
            ClientId = 5,
            SpeedId = 1,
            BookDate = DateTime.UtcNow.AddDays(10),
            JobType = "routed",
            RouteFromClientSite = true,
            Jobs = new List<BulkImportJobCreateDto>
            {
                new() { JobNumber = "J1", FromAddress = "1 Pick St", ToAddress = "T", ToContact = "C", ToSuburb = "Ponsonby", ToPostCode = "1011" },
                new() { JobNumber = "J2", FromAddress = "1 Pick St", ToAddress = "T", ToContact = "C", ToSuburb = "Nowhereville", ToPostCode = "614" },
            }
        };
        var resp = await svc.Import(contactId: 1, req);

        Assert.False(resp.Success);
        var msg = Assert.Single(resp.Messages).Message;
        Assert.StartsWith("Invalid suburb(s)", msg);
        Assert.Contains("row 2", msg);
        Assert.Contains("'Nowhereville'", msg);
        Assert.Contains("614", msg);
        // Row 1's delivery suburb resolved, so it is reported for pickup only.
        Assert.DoesNotContain("'Ponsonby'", msg);
    }

    // #316/#319 server side. A blank name / address / job number cell hit a
    // bare .Trim() in the job build and threw, so the operator saw
    // "Import failed: <stack>". Each blank cell must come back as one line
    // naming the row (1-based within this request) and the column, with the
    // labels the Map Columns step shows for the tenant.
    [Theory]
    [InlineData("NZ", "To Contact", "To Address")]
    [InlineData("US", "Contact", "Address")]
    public async Task Import_Routed_BlankRequiredCells_NameTheRowAndColumn(string country, string contactLabel, string addressLabel)
    {
        var svc = BulkImportServiceV2CoreTests.NewSvc(out var seed, out _, countryCode: country, clientTypeId: "4", timeZone: "UTC");
        SeedMinimalClient(seed, 5, speedId: 1);
        seed.TucSuburbs.Add(new TucSuburb { UcsuId = 1, UcsuName = "Ponsonby", PostCode = "1011" });
        await seed.SaveChangesAsync();

        var req = new BulkImportRequest
        {
            ClientId = 5,
            SpeedId = 1,
            BookDate = DateTime.UtcNow.AddDays(10),
            JobType = "routed",
            RouteFromClientSite = true,
            Jobs = new List<BulkImportJobCreateDto>
            {
                new() { JobNumber = "J1", FromAddress = "1 Pick St", ToAddress = "T", ToContact = "C", ToSuburb = "Ponsonby", ToPostCode = "1011" },
                new() { JobNumber = "J2", FromAddress = "1 Pick St", ToAddress = "T", ToContact = null, ToSuburb = "Ponsonby", ToPostCode = "1011" },
                new() { JobNumber = "J3", FromAddress = "1 Pick St", ToAddress = "  ", ToContact = "C", ToSuburb = "Ponsonby", ToPostCode = "1011" },
                new() { JobNumber = null, FromAddress = "1 Pick St", ToAddress = "T", ToContact = "C", ToSuburb = "Ponsonby", ToPostCode = "1011" },
            }
        };
        var resp = await svc.Import(contactId: 1, req);

        Assert.False(resp.Success);
        Assert.Equal(new[]
        {
            $"Row 2: {contactLabel} is blank",
            $"Row 3: {addressLabel} is blank",
            "Row 4: Job Number is blank",
        }, resp.Messages.Select(m => m.Message).ToArray());
    }

    // #332 server half: the on-demand / truck pickup geocode overwrote a
    // filled-in sheet postcode with HERE's suggestion. There is no accept
    // step for the pickup, so the sheet value must win and the geocoder may
    // only fill a blank cell.
    [Theory]
    [InlineData("0614", "1062", "0614", "0614")]   // sheet filled: kept
    [InlineData("02110", "02139", "02110", "02110")] // US zip: kept
    [InlineData("", "1062", "0614", "1062")]       // blank: suggestion fills it
    [InlineData(null, null, "0614", "0614")]       // blank, no suggestion: geocoded echo
    public void OriginPostCodeAfterGeocode_SheetValueWins(string sheet, string suggested, string geocoded, string expected)
    {
        Assert.Equal(expected, BulkImportServiceV2.OriginPostCodeAfterGeocode(sheet, suggested, geocoded));
    }

    internal static void SeedMinimalClient(DynamicDespatchDbContext seed, int clientId, int speedId)
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
