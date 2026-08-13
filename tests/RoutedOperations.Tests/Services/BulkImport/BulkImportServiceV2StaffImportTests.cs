using RoutedOperations.Core.Application.Dtos.BulkImport.Bulk;
using RoutedOperations.Core.Domain;
using RoutedOperations.Core.Domain.Despatch;

namespace RoutedOperations.Tests.Services.BulkImport;

// Covers the StaffImport batch loader. The happy path calls
// INT_stpJob_BulkInsertAsync / DD_stpJob_InsertExceleratorAsync at its
// per-row exit, which the InMemory provider cannot execute. Tests focus on
// per-row validation and dictionary parsing (which is where the "does this
// spreadsheet row look sane?" logic lives).
public class BulkImportServiceV2StaffImportTests
{
    [Fact]
    public async Task StaffImport_ClientNotFound_RecordsFailedJob()
    {
        var svc = BulkImportServiceV2CoreTests.NewSvc(out _, out _, countryCode: "US", internalClaim: "True");
        var req = new StaffImportRequest
        {
            Jobs = new List<Dictionary<string, object>>
            {
                new()
                {
                    { "ClientID", 12345 },
                    { "JobNumber", "AAA" },
                    { "ToAddress", "Somewhere" }
                }
            }
        };

        var resp = await svc.StaffImport(contactId: 1, req);

        // Everything failed; response.Success is false when 0 succeed.
        Assert.False(resp.Success);
        Assert.Single(resp.FailedJobs);
        Assert.Equal("AAA", resp.FailedJobs.First().JobNumber);
        Assert.Contains("Client not found", resp.FailedJobs.First().Error);
    }

    [Fact]
    public async Task StaffImport_ClientCodeLookup_UnknownCode_RecordsFailedJob()
    {
        var svc = BulkImportServiceV2CoreTests.NewSvc(out _, out _, countryCode: "US");
        var req = new StaffImportRequest
        {
            Jobs = new List<Dictionary<string, object>>
            {
                new()
                {
                    { "ClientCode", "GHOSTCLIENT" },
                    { "JobNumber", "AAA" }
                }
            }
        };

        var resp = await svc.StaffImport(1, req);
        Assert.Single(resp.FailedJobs);
    }

    [Fact]
    public async Task StaffImport_RowWithoutClient_ReportsRowNumberInFailure()
    {
        var svc = BulkImportServiceV2CoreTests.NewSvc(out _, out _, countryCode: "US");
        var req = new StaffImportRequest
        {
            Jobs = new List<Dictionary<string, object>>
            {
                new() { }
            }
        };

        var resp = await svc.StaffImport(1, req);

        Assert.Single(resp.FailedJobs);
        Assert.Equal(1, resp.FailedJobs.First().RowNumber);
        Assert.Equal("Row 1", resp.FailedJobs.First().JobNumber); // JobNumber fallback
    }

    [Fact]
    public async Task StaffImport_MultipleFailedRows_SetsMessageWithFailedCount()
    {
        var svc = BulkImportServiceV2CoreTests.NewSvc(out _, out _, countryCode: "US");
        var req = new StaffImportRequest
        {
            Jobs = new List<Dictionary<string, object>>
            {
                new() { { "ClientID", 999 }, { "JobNumber", "A" } },
                new() { { "ClientID", 998 }, { "JobNumber", "B" } }
            }
        };
        var resp = await svc.StaffImport(1, req);

        Assert.Equal(2, resp.FailedCount);
        Assert.Equal(0, resp.SuccessCount);
        Assert.Contains(resp.Messages, m => m.Message?.Contains("Import completed with") == true);
    }

    [Fact]
    public async Task StaffImport_EmptyJobs_ReturnsSuccessFalseNoFailures()
    {
        var svc = BulkImportServiceV2CoreTests.NewSvc(out _, out _, countryCode: "US");
        var resp = await svc.StaffImport(1, new StaffImportRequest { Jobs = new List<Dictionary<string, object>>() });

        Assert.False(resp.Success);
        Assert.Empty(resp.FailedJobs);
        Assert.Contains(resp.Messages, m => m.Message?.Contains("Successfully imported 0") == true);
    }

    [Fact]
    public async Task StaffImport_NullJobs_FatalErrorPathReturnsMessage()
    {
        var svc = BulkImportServiceV2CoreTests.NewSvc(out _, out _, countryCode: "US");
        var resp = await svc.StaffImport(1, new StaffImportRequest { Jobs = null });

        Assert.False(resp.Success);
        Assert.Contains(resp.Messages, m => m.Message?.StartsWith("Import failed:") == true);
    }

    [Fact]
    public async Task StaffImport_ClientCache_UsesCachedInstanceForRepeatedClient()
    {
        var svc = BulkImportServiceV2CoreTests.NewSvc(out var seed, out _, countryCode: "US", internalClaim: "True");
        seed.TucClients.Add(new TucClient { UcclId = 5, UcclCode = "X", UcclName = "N", UcclActive = true, JobPrefix = "P" });
        await seed.SaveChangesAsync();

        var req = new StaffImportRequest
        {
            Jobs = new List<Dictionary<string, object>>
            {
                new() { { "ClientID", 5 }, { "JobNumber", "A" }, { "ToAddress", "X" } },
                new() { { "ClientID", 5 }, { "JobNumber", "B" }, { "ToAddress", "X" } }
            }
        };
        // Both rows will fail at the SP call but the client lookup should hit
        // the cache on the second row (behavioural, no direct assertion) - the
        // test just proves the cache path doesn't throw NRE.
        var resp = await svc.StaffImport(1, req);
        Assert.Equal(2, resp.FailedCount);
    }

    // ---------------- Value-parser helpers (via public path) -----------------
    // GetStringValue / GetIntValue etc. are private but their behaviour is
    // load-bearing on StaffImport - each row's ClientID / JobNumber / dates
    // etc. flow through them. Exercise via the observable API: a row that
    // supplies a numeric ClientID as a string still resolves.

    [Fact]
    public async Task StaffImport_ClientIdAsString_IsParsed()
    {
        var svc = BulkImportServiceV2CoreTests.NewSvc(out var seed, out _, countryCode: "US", internalClaim: "True");
        seed.TucClients.Add(new TucClient { UcclId = 5, UcclCode = "X", UcclName = "N", UcclActive = true, JobPrefix = "P" });
        await seed.SaveChangesAsync();

        var req = new StaffImportRequest
        {
            Jobs = new List<Dictionary<string, object>>
            {
                new() { { "ClientID", "5" }, { "JobNumber", "AAA" } }
            }
        };
        var resp = await svc.StaffImport(1, req);
        // Client lookup succeeded (the client existed), row fails at the SP.
        Assert.Single(resp.FailedJobs);
        Assert.DoesNotContain("Client not found", resp.FailedJobs.First().Error);
    }

    [Fact]
    public async Task StaffImport_ClientCodeCaseInsensitiveMatch()
    {
        var svc = BulkImportServiceV2CoreTests.NewSvc(out var seed, out _, countryCode: "US", internalClaim: "True");
        seed.TucClients.Add(new TucClient { UcclId = 5, UcclCode = "abc", UcclName = "N", UcclActive = true, JobPrefix = "P" });
        await seed.SaveChangesAsync();

        var req = new StaffImportRequest
        {
            Jobs = new List<Dictionary<string, object>>
            {
                new() { { "ClientCode", "ABC" }, { "JobNumber", "AAA" } }
            }
        };
        var resp = await svc.StaffImport(1, req);
        // Client found; failure now happens downstream at SP call.
        Assert.DoesNotContain(resp.FailedJobs, f => f.Error.Contains("Client not found"));
    }

    [Fact]
    public async Task StaffImport_NzTenant_UsesNzBranch()
    {
        // NZ tenant - failure happens further down but we exercise the NZ
        // codepath (INT_stpJob_BulkInsertAsync) at least until the SP call.
        var svc = BulkImportServiceV2CoreTests.NewSvc(out var seed, out _, countryCode: "NZ", internalClaim: "True");
        seed.TucClients.Add(new TucClient { UcclId = 5, UcclCode = "X", UcclName = "N", UcclActive = true, JobPrefix = "P" });
        await seed.SaveChangesAsync();

        var req = new StaffImportRequest
        {
            Jobs = new List<Dictionary<string, object>>
            {
                new() { { "ClientID", 5 }, { "JobNumber", "AAA" }, { "ToAddress", "17 Main" } }
            }
        };
        var resp = await svc.StaffImport(1, req);
        Assert.Single(resp.FailedJobs);
    }
}
