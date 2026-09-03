using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using RoutedOperations.Core.Application.Dtos.HistoricArchive;
using RoutedOperations.Core.Application.Services.HistoricArchive;
using RoutedOperations.Core.Domain;
using RoutedOperations.Core.Domain.Despatch;

namespace RoutedOperations.Tests.Services.HistoricArchive;

// Note: EF InMemory doesn't run raw SQL (Database.SqlQueryRaw). The CommitAsync
// path issues a MAX(ucjbID) query against a UNION of tucJob + tucJobArchive
// that InMemory rejects. Those tests are marked Skip= and will run against
// a real SQL Server E2E on the migration-applied staging DB. Everything the
// InMemory harness *can* verify (parse, mapping validation, sentinel recipe
// on a built row, per-row cast errors, batch audit fields) is covered here.
public class HistoricArchiveServiceTests
{
    // Shared-name InMemory DB so every context the service opens
    // (`await using var ctx = ...`) points at the same store even after
    // one gets disposed. Matches how production DI hands out a fresh
    // context per resolve.
    private static DbContextOptions<DynamicDespatchDbContext> NewOptions() =>
        new DbContextOptionsBuilder<DynamicDespatchDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .ConfigureWarnings(w => w.Ignore(Microsoft.EntityFrameworkCore.Diagnostics.InMemoryEventId.TransactionIgnoredWarning))
            .Options;

    private static IDbContextFactory<DynamicDespatchDbContext> FactoryOn(DbContextOptions<DynamicDespatchDbContext> options)
    {
        var factory = Substitute.For<IDbContextFactory<DynamicDespatchDbContext>>();
        factory.CreateDbContext().Returns(_ => new DynamicDespatchDbContext(options));
        factory.CreateDbContextAsync().Returns(_ => Task.FromResult(new DynamicDespatchDbContext(options)));
        return factory;
    }

    private static IHttpContextAccessor NewAccessor()
    {
        var acc = Substitute.For<IHttpContextAccessor>();
        acc.HttpContext.Returns((HttpContext?)null);
        return acc;
    }

    // ---- parse ----

    [Fact]
    public async Task ParseUploadAsync_NullFile_ReturnsEmptyGridWithFieldLists()
    {
        var svc = new HistoricArchiveService(FactoryOn(NewOptions()), NewAccessor());
        var response = await svc.ParseUploadAsync(null);

        Assert.Empty(response.Headers);
        Assert.Empty(response.Rows);
        Assert.Contains(HistoricArchiveField.JobNumber, response.CanonicalFields);
        Assert.Contains(HistoricArchiveField.JobNumber, response.RequiredFields);
    }

    [Fact]
    public async Task ParseUploadAsync_UnsupportedExtension_Throws()
    {
        var svc = new HistoricArchiveService(FactoryOn(NewOptions()), NewAccessor());
        var file = MakeFormFile("hello", "hello.txt");
        await Assert.ThrowsAsync<InvalidOperationException>(() => svc.ParseUploadAsync(file));
    }

    [Fact]
    public async Task ParseUploadAsync_Csv_HeadersAndRowsMaterialised()
    {
        var svc = new HistoricArchiveService(FactoryOn(NewOptions()), NewAccessor());
        var file = MakeFormFile(
            "JobNumber,Amount,Notes\nJRK1000,22.29,First\nJRK1001,13.41,\"Has, comma\"\n",
            "sample.csv");

        var response = await svc.ParseUploadAsync(file);

        Assert.Equal(3, response.Headers.Count);
        Assert.Equal(new[] { "JobNumber", "Amount", "Notes" }, response.Headers);
        Assert.Equal(2, response.Rows.Count);
        Assert.Equal("JRK1000", response.Rows[0]["JobNumber"]);
        Assert.Equal("22.29", response.Rows[0]["Amount"]);
        Assert.Equal("Has, comma", response.Rows[1]["Notes"]);
    }

    // ---- commit (in-memory-safe subset) ----

    [Fact]
    public async Task CommitAsync_MissingRequiredMapping_Throws()
    {
        var svc = new HistoricArchiveService(FactoryOn(NewOptions()), NewAccessor());
        var request = new HistoricArchiveCommitRequest
        {
            FileName = "x.csv",
            Mapping = new Dictionary<string, string>
            {
                ["JobNumber"] = HistoricArchiveField.JobNumber,
                // JobDate + ClientCode intentionally missing
            },
            Rows = new List<Dictionary<string, string?>>
            {
                new() { ["JobNumber"] = "JRK1000" },
            },
        };

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() => svc.CommitAsync(request, contactId: 1));
        Assert.Contains("JobDate", ex.Message);
        Assert.Contains("ClientCode", ex.Message);
    }

    [Fact]
    public async Task CommitAsync_AllRowsInvalid_WritesAuditBatchWithZeroInserted()
    {
        var options = NewOptions();
        var svc = new HistoricArchiveService(FactoryOn(options), NewAccessor());
        var request = new HistoricArchiveCommitRequest
        {
            FileName = "x.csv",
            Mapping = new Dictionary<string, string>
            {
                ["JobNumber"]  = HistoricArchiveField.JobNumber,
                ["JobDate"]    = HistoricArchiveField.JobDate,
                ["ClientCode"] = HistoricArchiveField.ClientCode,
            },
            Rows = new List<Dictionary<string, string?>>
            {
                new() { ["JobNumber"] = "", ["JobDate"] = "2026-04-10", ["ClientCode"] = "JRWHC" },
                new() { ["JobNumber"] = "JRK2", ["JobDate"] = "not-a-date", ["ClientCode"] = "JRWHC" },
            },
        };

        var response = await svc.CommitAsync(request, contactId: 42);

        Assert.Equal(0, response.InsertedCount);
        Assert.Equal(2, response.RejectedCount);
        Assert.Equal(2, response.Errors.Count);
        Assert.Null(response.ImportedIdStart);
        Assert.NotEqual(0, response.BatchId);

        await using var readCtx = new DynamicDespatchDbContext(options);
        var batch = await readCtx.HistoricArchiveImportBatches.SingleAsync();
        Assert.Equal(42, batch.UploadedByContact);
        Assert.Equal("x.csv", batch.FileName);
        Assert.Equal(2, batch.RowCount);
        Assert.Equal(0, batch.InsertedCount);
        Assert.Equal(2, batch.RejectedCount);

        // Errors JSON persisted so the drill-down UI can render reasons
        // after the wizard is dismissed.
        Assert.False(string.IsNullOrWhiteSpace(batch.Errors));
        var deserialized = HistoricArchiveService.DeserializeErrors(batch.Errors);
        Assert.Equal(2, deserialized.Count);
        Assert.Contains(deserialized, e => e.RowIndex == 1);
        Assert.Contains(deserialized, e => e.RowIndex == 2 && e.JobNumber == "JRK2");
    }

    [Fact]
    public async Task GetBatchAsync_ReturnsDeserializedErrors_WhenPersisted()
    {
        var options = NewOptions();
        await using (var seed = new DynamicDespatchDbContext(options))
        {
            seed.HistoricArchiveImportBatches.Add(new()
            {
                UploadedByContact = 1,
                UploadedAt = DateTime.UtcNow,
                FileName = "seed.csv",
                TenantCode = "test",
                RowCount = 3,
                InsertedCount = 1,
                RejectedCount = 2,
                ImportedIdStart = 1_900_000_000,
                ImportedIdEnd = 1_900_000_000,
                Errors = "[{\"rowIndex\":2,\"jobNumber\":\"J2\",\"message\":\"missing date\"}," +
                         " {\"rowIndex\":3,\"jobNumber\":null,\"message\":\"blank number\"}]",
            });
            await seed.SaveChangesAsync();
        }

        var svc = new HistoricArchiveService(FactoryOn(options), NewAccessor());
        var detail = await svc.GetBatchAsync(1);

        Assert.NotNull(detail);
        Assert.Equal(2, detail!.Errors.Count);
        Assert.Equal("missing date", detail.Errors[0].Message);
        Assert.Equal("J2", detail.Errors[0].JobNumber);
        Assert.Null(detail.Errors[1].JobNumber);
    }

    // ---- GetBatchJobsAsync ----

    [Fact]
    public async Task GetBatchJobsAsync_UnknownBatch_Throws()
    {
        var options = NewOptions();
        var svc = new HistoricArchiveService(FactoryOn(options), NewAccessor());

        await Assert.ThrowsAsync<InvalidOperationException>(
            () => svc.GetBatchJobsAsync(batchId: 999, limit: 50, offset: 0));
    }

    [Fact]
    public async Task GetBatchJobsAsync_AllRejectedBatch_ReturnsEmpty()
    {
        var options = NewOptions();
        await using (var seed = new DynamicDespatchDbContext(options))
        {
            seed.HistoricArchiveImportBatches.Add(new()
            {
                UploadedByContact = 1,
                UploadedAt = DateTime.UtcNow,
                FileName = "empty.csv",
                TenantCode = "test",
                RowCount = 2,
                InsertedCount = 0,
                RejectedCount = 2,
                ImportedIdStart = null,
                ImportedIdEnd = null,
            });
            await seed.SaveChangesAsync();
        }

        var svc = new HistoricArchiveService(FactoryOn(options), NewAccessor());
        var page = await svc.GetBatchJobsAsync(1, 50, 0);

        Assert.Equal(0, page.Total);
        Assert.Empty(page.Rows);
    }

    [Fact]
    public async Task GetBatchJobsAsync_ReturnsRowsInRange_FiltersBySourceId()
    {
        var options = NewOptions();
        await using (var seed = new DynamicDespatchDbContext(options))
        {
            // Range [100..103] - 3 valid rows at 100/101/102 (SourceID=900),
            // a WRONG-SOURCE row at 103 (in range but SourceID != 900),
            // and an OUT-OF-RANGE row at 500 (SourceID=900 but outside
            // the range). Only the first 3 should surface.
            seed.HistoricArchiveImportBatches.Add(new()
            {
                UploadedByContact = 1,
                UploadedAt = DateTime.UtcNow,
                FileName = "b.csv",
                TenantCode = "test",
                RowCount = 3,
                InsertedCount = 3,
                RejectedCount = 0,
                ImportedIdStart = 1_900_000_100,
                ImportedIdEnd = 1_900_000_103,
            });
            for (var i = 0; i < 3; i++)
            {
                seed.TucJobArchives.Add(new()
                {
                    UcjbId = 1_900_000_100 + i,
                    UcjbNumber = $"JR-{i:D3}",
                    UcjbClientCode = "JRWHC",
                    UcjbDate = new DateTime(2026, 4, 10),
                    UcjbAmount = 10m * (i + 1),
                    SourceId = 900,
                    RatedManually = true,
                    UcjbJobDone = true,
                    UcjbVoid = false,
                });
            }
            seed.TucJobArchives.Add(new()
            {
                UcjbId = 1_900_000_103,
                UcjbNumber = "WRONG-SOURCE",
                UcjbClientCode = "OTH",
                UcjbDate = new DateTime(2026, 4, 10),
                SourceId = 42,
                RatedManually = true,
                UcjbJobDone = true,
                UcjbVoid = false,
            });
            seed.TucJobArchives.Add(new()
            {
                UcjbId = 1_900_000_500,
                UcjbNumber = "OUT-OF-RANGE",
                UcjbClientCode = "X",
                UcjbDate = new DateTime(2026, 4, 10),
                SourceId = 900,
                RatedManually = true,
                UcjbJobDone = true,
                UcjbVoid = false,
            });
            await seed.SaveChangesAsync();
        }

        var svc = new HistoricArchiveService(FactoryOn(options), NewAccessor());
        var page = await svc.GetBatchJobsAsync(1, 50, 0);

        Assert.Equal(3, page.Total);
        Assert.Equal(3, page.Rows.Count);
        Assert.All(page.Rows, r => Assert.Equal("JRWHC", r.ClientCode));
        Assert.Equal("JR-000", page.Rows[0].JobNumber);
        Assert.Equal(30m, page.Rows[2].Amount);
    }

    [Fact]
    public async Task GetBatchJobsAsync_Pagination_ReturnsExpectedWindow()
    {
        var options = NewOptions();
        await using (var seed = new DynamicDespatchDbContext(options))
        {
            seed.HistoricArchiveImportBatches.Add(new()
            {
                UploadedByContact = 1,
                UploadedAt = DateTime.UtcNow,
                FileName = "b.csv",
                TenantCode = "test",
                RowCount = 5,
                InsertedCount = 5,
                RejectedCount = 0,
                ImportedIdStart = 1_900_000_200,
                ImportedIdEnd = 1_900_000_204,
            });
            for (var i = 0; i < 5; i++)
            {
                seed.TucJobArchives.Add(new()
                {
                    UcjbId = 1_900_000_200 + i,
                    UcjbNumber = $"P-{i}",
                    UcjbClientCode = "X",
                    UcjbDate = new DateTime(2026, 4, 10),
                    SourceId = 900,
                    RatedManually = true,
                    UcjbJobDone = true,
                    UcjbVoid = false,
                });
            }
            await seed.SaveChangesAsync();
        }

        var svc = new HistoricArchiveService(FactoryOn(options), NewAccessor());
        var page = await svc.GetBatchJobsAsync(1, limit: 2, offset: 2);

        Assert.Equal(5, page.Total);
        Assert.Equal(2, page.Rows.Count);
        Assert.Equal("P-2", page.Rows[0].JobNumber);
        Assert.Equal("P-3", page.Rows[1].JobNumber);
    }

    // ---- OTG historic-upload E2E (Steve 2026-09-03 bug report) ----
    //
    // The wizard has three distinct stages: (1) parse the upload,
    // (2) frontend auto-maps headers to canonical field names, and
    // (3) the server BuildRow(rawDict, canonicalToHeader) constructs a
    // TucJobArchive. This test exercises (1) + (3) directly - stage (2)
    // is exercised separately by historicArchiveAutoMap.test.ts - and
    // asserts every field on Steve's real OTG_JOBS_COMBINED CSV lands
    // on the correct TucJobArchive column with the correct type.
    //
    // The mapping payload here is the SAME shape the frontend produces
    // for the same headers (verified in the vitest scenario "maps the
    // real OTG_JOBS_COMBINED headers end-to-end"). If the two lists
    // drift, one of the tests fails.
    [Fact]
    public async Task OtgHistoricCsv_ParseAndBuildRow_LandsEveryMappedFieldCorrectly()
    {
        // Real header + first data row from the OTG file Steve attached:
        // "OTG Clients - OTG_JOBS_COMBINED_010125_TO_071226.csv"
        // Line 1 is the header, line 2 is a real IMPERIAL BAG job.
        // The trailing comma count matches the header count exactly so
        // our simple SplitCsvLine keeps the empty tail cells intact.
        const string OtgCsv =
            "OrderTrackingID,Client Code,Company Name,Ref#,Pieces,Weight,"
            + "Pickup Company,Pickup City,Pickup State,"
            + "Delivery Company,Delivery City,Delivery State,"
            + "Grand Total,Driver Pay,"
            + "[P] Target From,[D] Target From,[P] Arrival,[P] Departure,"
            + "POD Name,POD Date/Time,"
            + "CSR,Status,Pricing Mode,Service,Vehicle,DriverNo,Driver Quote,"
            + "Pickup Zip,Delivery Zip,Packages,Documents,Ref#2,Type,Driver Class,Master Contractor/Agent\n"
            + "53.123024,445,\"IMPERIAL BAG & PAPER CO,LLC\",MAIL,1,25,"
            + "IMPERIAL BAG,North Bergen,NJ,"
            + "IMPERIAL BAG & PAPER,Jersey City,NJ,"
            + "$44.25,$30.00,"
            + "01/02/2025 8:00,01/02/2025 10:00,01/02/2025 8:26,01/02/2025 8:26,"
            + "Milly martinez,01/02/2025 9:06,"
            + "Cathy,P,1,IMPERIAL,VAN,868,$0.00,"
            + "7047,7306,[1] Box,0,,S PMMAILRUN,,\n";

        // ---- Stage 1: parse ----
        var svc = new HistoricArchiveService(FactoryOn(NewOptions()), NewAccessor());
        var response = await svc.ParseUploadAsync(MakeFormFile(OtgCsv, "otg.csv"));

        Assert.Equal(35, response.Headers.Count);
        Assert.Single(response.Rows);
        var raw = response.Rows[0];
        Assert.Equal("53.123024", raw["OrderTrackingID"]);
        Assert.Equal("IMPERIAL BAG & PAPER CO,LLC", raw["Company Name"]);
        Assert.Equal("$44.25", raw["Grand Total"]);
        Assert.Equal("01/02/2025 8:26", raw["[P] Arrival"]);

        // ---- Stage 2 (simulated - identical to autoMapHeaders output) ----
        // The frontend produces this exact canonical -> header dict for
        // this header set (see historicArchiveAutoMap.test.ts). We build
        // it here directly so the test does not depend on the JS runtime.
        var canonicalToHeader = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            [HistoricArchiveField.JobNumber]            = "OrderTrackingID",
            [HistoricArchiveField.ClientCode]           = "Client Code",
            [HistoricArchiveField.CustomerName]         = "Company Name",   // frontend picks "Company Name" over "Delivery Company"
            [HistoricArchiveField.ClientRefA]           = "Ref#",
            [HistoricArchiveField.Quantity]             = "Pieces",
            [HistoricArchiveField.Weight]               = "Weight",
            [HistoricArchiveField.PickupCompany]        = "Pickup Company",
            [HistoricArchiveField.PickupAddressCity]    = "Pickup City",
            [HistoricArchiveField.PickupState]          = "Pickup State",
            [HistoricArchiveField.DeliveryAddressCity]  = "Delivery City",
            [HistoricArchiveField.DeliveryState]        = "Delivery State",
            [HistoricArchiveField.Amount]               = "Grand Total",
            [HistoricArchiveField.CourierPayment]       = "Driver Pay",
            [HistoricArchiveField.RequiredDeliveryTime] = "[P] Target From",
            [HistoricArchiveField.DeliverByTime]        = "[D] Target From",
            [HistoricArchiveField.PickupArrivalTime]    = "[P] Arrival",
            [HistoricArchiveField.PodName]              = "POD Name",
            [HistoricArchiveField.CompletedTime]        = "POD Date/Time",
            [HistoricArchiveField.CourierId]            = "DriverNo",
            [HistoricArchiveField.PickupPostCode]       = "Pickup Zip",
            [HistoricArchiveField.DeliveryPostCode]     = "Delivery Zip",
            [HistoricArchiveField.ClientRefB]           = "Ref#2",
            // ServiceName / VehicleName are NEW auto-aliases (2026-09-03)
            // that resolve to UcjbSpeed / UcjbSize via tucJobType +
            // VehicleSize lookups at commit. Assert the resolver picks
            // the right IDs below.
            [HistoricArchiveField.ServiceName]          = "Service",
            [HistoricArchiveField.VehicleName]          = "Vehicle",
            // JobDate is not in the OTG file; the operator MUST map one
            // manually before commit. For this BuildRow test we borrow
            // POD Date/Time as the book date so the "required" check
            // passes; the row would still commit under the operator's
            // real mapping choice.
            [HistoricArchiveField.JobDate]              = "POD Date/Time",
        };

        // Synthetic lookup dicts. In production CommitAsync hydrates
        // these from tucJobType + VehicleSize per tenant. We seed the
        // OTG values here so we can assert the resolver end-to-end
        // without a live DB dependency.
        var serviceLookup = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase)
        {
            ["IMPERIAL"]    = 900_001,
            ["VAN SERVICE"] = 394,   // real DFRNT ucjtID
        };
        var vehicleLookup = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase)
        {
            ["Van"]      = 1,
            ["Truck"]    = 2,
            ["Sprinter"] = 28,
            ["Car"]      = 29,
        };

        // ---- Stage 3: BuildRow via reflection ----
        var buildRow = typeof(HistoricArchiveService)
            .GetMethod("BuildRow", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Static);
        Assert.NotNull(buildRow);
        var built = (TucJobArchive)buildRow!.Invoke(null, [raw, canonicalToHeader, serviceLookup, vehicleLookup])!;

        // Core identity
        Assert.Equal("53.123024", built.UcjbNumber);
        Assert.Equal("445", built.UcjbClientCode);
        Assert.Equal("MAIL", built.UcjbClientRefa);
        Assert.Equal("", built.UcjbClientRefb ?? "");  // empty Ref#2 -> null via OptString

        // Delivery party
        Assert.Equal("IMPERIAL BAG & PAPER CO,LLC", built.DeliveryAddressLine1);  // CustomerName
        Assert.Equal("Jersey City", built.DeliveryAddressLine5);                  // City
        Assert.Equal("NJ", built.DeliveryAddressLine6);                           // State
        Assert.Equal("7306", built.DeliveryAddressLine7);                         // Zip

        // Pickup party (NEW: Pickup Company preserved separately)
        Assert.Equal("IMPERIAL BAG", built.PickUpFromContact);
        Assert.Equal("North Bergen", built.PickupAddressLine5);
        Assert.Equal("NJ", built.PickupAddressLine6);
        Assert.Equal("7047", built.PickupAddressLine7);

        // Freight + money (dollar-sign / comma stripping via OptDecimal).
        // UcjbQty is short? - cast the literal so Assert.Equal picks the
        // right generic overload instead of stumbling into DateTime.
        Assert.Equal((short?)1, built.UcjbQty);
        Assert.Equal(25d, built.UcjbWeight);
        Assert.Equal(44.25m, built.UcjbAmount);
        Assert.Equal(30.00m, built.CourierPayment);

        // Timing / milestone (Steve minimum uplift new fields)
        Assert.Equal(new DateTime(2025, 1, 2, 8, 0, 0), built.RequiredDeliveryTime);
        Assert.Equal(new DateTime(2025, 1, 2, 10, 0, 0), built.DeliverByTime);
        Assert.Equal(new DateTime(2025, 1, 2, 8, 26, 0), built.PickupArrivalTime);
        Assert.Equal(new DateTime(2025, 1, 2, 9, 6, 0), built.UcjbComplTime);

        // POD + Courier
        Assert.Equal("Milly martinez", built.UcjbPodname);
        Assert.Equal(868, built.UcjbCourierId);

        // Service / Vehicle name resolution (NEW 2026-09-03).
        // OTG row 1 has Service="IMPERIAL", Vehicle="VAN". Our
        // synthetic lookups translate to UcjbSpeed=900001 and
        // UcjbSize=1 (Van). Case-insensitive match works for VAN vs Van.
        Assert.Equal(900_001, built.UcjbSpeed);
        Assert.Equal(1, built.UcjbSize);

        // Sentinel recipe still applied (billing exclusion). Constants
        // are declared `internal const` on the service, not visible to
        // this project, so assert against the literal values documented
        // in the service header comment.
        Assert.Equal(6, built.UcjbStatus);                    // UcjbStatusCompleted
        Assert.True(built.UcjbJobDone);
        Assert.False(built.UcjbVoid);
        Assert.Equal(900, built.SourceId);                    // SourceIdHistoricImport
        Assert.Equal(999999, built.UcjbInvoiceNo);            // UcjbInvoiceNoSentinel
        Assert.Equal(999999, built.InvoiceProcessId);         // InvoiceProcessIdSentinel
        Assert.Equal(999999, built.JournalHeaderId);          // JournalHeaderIdSentinel
        Assert.Null(built.AgentBctiRunId);
        Assert.Null(built.CourierSettlementBatchId);
        Assert.True(built.RatedManually);
        Assert.False(built.AutoDespatch);

        // ucjbMonth / Year derived from UcjbDate (which we mapped from
        // POD Date/Time above = 2025-01-02).
        Assert.Equal((byte)1, built.UcjbMonth);
        Assert.Equal((short)2025, built.UcjbYear);
    }

    // ---- helpers ----

    private static IFormFile MakeFormFile(string content, string fileName)
    {
        var bytes = System.Text.Encoding.UTF8.GetBytes(content);
        var stream = new MemoryStream(bytes);
        return new FormFile(stream, 0, bytes.Length, "file", fileName);
    }
}
