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

    // ---- helpers ----

    private static IFormFile MakeFormFile(string content, string fileName)
    {
        var bytes = System.Text.Encoding.UTF8.GetBytes(content);
        var stream = new MemoryStream(bytes);
        return new FormFile(stream, 0, bytes.Length, "file", fileName);
    }
}
