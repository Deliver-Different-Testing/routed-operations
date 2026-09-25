using System.Net;
using System.Net.Http;
using System.Text;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using RoutedOperations.Core.Application.Dtos.BulkImport.Bulk;
using RoutedOperations.Core.Application.Dtos.BulkImport.Common;
using RoutedOperations.Core.Application.Services.BulkImport;
using RoutedOperations.Core.Application.Services.Routing;
using RoutedOperations.Core.Domain;
using RoutedOperations.Core.Domain.Despatch;
using RoutedOperations.Infrastructure;

namespace RoutedOperations.Tests.Services.BulkImport;

// Covers the public surface of BulkImportServiceV2 that does NOT require
// executing a stored procedure. The Import / StaffImport / BulkComplete paths
// end at Procedures.* / ExecuteSqlRaw calls that the InMemory provider does
// not implement, so those tests exercise the pre-SP guard clauses only.
//
// Split into three files by concern (this file, BulkImportServiceV2JobFactoryTests,
// BulkImportServiceV2StaffImportTests, BulkImportServiceV2RatingTests) so the
// per-file line count stays readable and the failing test names surface which
// partial owns the failure.
public class BulkImportServiceV2CoreTests
{
    // Trivial HttpMessageHandler used for the Google Drive HTTP fake and the
    // shared HERE HttpClient. Captures the last URL so tests can assert the
    // service reached the expected endpoint.
    internal sealed class FakeHandler : HttpMessageHandler
    {
        private readonly Queue<HttpResponseMessage> _queued;
        public List<string> Urls { get; } = new();
        public FakeHandler(params HttpResponseMessage[] responses)
        {
            _queued = new Queue<HttpResponseMessage>(responses.Length == 0
                ? new[] { new HttpResponseMessage(HttpStatusCode.InternalServerError) { Content = new StringContent("") } }
                : responses);
        }
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Urls.Add(request.RequestUri!.ToString());
            var next = _queued.Count > 0 ? _queued.Dequeue() : new HttpResponseMessage(HttpStatusCode.InternalServerError) { Content = new StringContent("") };
            return Task.FromResult(next);
        }
    }

    private static HereGeocodeService StubHereSvc()
    {
        var settings = new AppSettings { HereMapsApiKey = string.Empty };
        return new HereGeocodeService(new HttpClient(new FakeHandler()), settings);
    }

    // Shared factory that returns a fresh HttpClient per CreateClient() call
    // so BulkImportServiceV2's HERE distance helper (which uses a fresh
    // HttpClient per call) doesn't deadlock on the same handler instance.
    private sealed class FakeHttpClientFactory : IHttpClientFactory
    {
        private readonly HttpMessageHandler _handler;
        public FakeHttpClientFactory(HttpMessageHandler handler) { _handler = handler; }
        public HttpClient CreateClient(string name) => new(_handler, disposeHandler: false);
    }

    internal static BulkImportServiceV2 NewSvc(
        out DynamicDespatchDbContext seed,
        out IHttpContextAccessor accessor,
        string countryCode = "US",
        string internalClaim = null,
        string timeZone = null,
        HttpMessageHandler httpHandler = null)
    {
        var opts = BulkImportTestHarness.NewOptions();
        seed = BulkImportTestHarness.Context(opts);
        accessor = BulkImportTestHarness.Accessor(countryCode, internalClaim, timeZone);
        var factory = new FakeHttpClientFactory(httpHandler ?? new FakeHandler());
        var cache = BulkImportTestHarness.Cache(accessor);
        var addressSvc = new AddressService(BulkImportTestHarness.Factory(opts), accessor, StubHereSvc(), cache);
        return new BulkImportServiceV2(BulkImportTestHarness.Factory(opts), factory, accessor, addressSvc);
    }

    // ---------------- UploadFile -----------------

    private static IFormFile MakeFormFile(string filename, string body)
    {
        var bytes = Encoding.UTF8.GetBytes(body);
        var stream = new MemoryStream(bytes);
        return new FormFile(stream, 0, bytes.Length, "file", filename)
        {
            Headers = new HeaderDictionary(),
            ContentType = "text/csv"
        };
    }

    [Fact]
    public async Task UploadFile_NullFile_ReturnsEmpty()
    {
        var svc = NewSvc(out _, out _);
        Assert.Equal(string.Empty, await svc.UploadFile(1, null));
    }

    [Fact]
    public async Task UploadFile_BlankFilename_ReturnsEmpty()
    {
        var svc = NewSvc(out _, out _);
        var f = MakeFormFile("   ", "abc");
        Assert.Equal(string.Empty, await svc.UploadFile(1, f));
    }

    [Fact]
    public async Task UploadFile_NoExtension_ReturnsEmpty()
    {
        var svc = NewSvc(out _, out _);
        var f = MakeFormFile("noext", "a,b,c\n1,2,3");
        Assert.Equal(string.Empty, await svc.UploadFile(1, f));
    }

    [Fact]
    public async Task UploadFile_UnsupportedExtension_ReturnsEmpty()
    {
        var svc = NewSvc(out _, out _);
        var f = MakeFormFile("data.pdf", "a,b,c\n1,2,3");
        Assert.Equal(string.Empty, await svc.UploadFile(1, f));
    }

    [Fact]
    public async Task UploadFile_EmptyCsv_ReturnsEmpty()
    {
        var svc = NewSvc(out _, out _);
        var f = MakeFormFile("empty.csv", "");
        Assert.Equal(string.Empty, await svc.UploadFile(1, f));
    }

    [Fact]
    public async Task UploadFile_HeaderOnly_ReturnsEmpty()
    {
        // Header row with no data rows produces an empty dataList, which the
        // service treats as "nothing to import" and returns empty string.
        var svc = NewSvc(out _, out _);
        var f = MakeFormFile("headers.csv", "a,b,c");
        var json = await svc.UploadFile(1, f);
        Assert.Equal(string.Empty, json);
    }

    [Fact]
    public async Task UploadFile_CommaDelimitedCsv_ReturnsJson()
    {
        var svc = NewSvc(out _, out _);
        var f = MakeFormFile("data.csv", "JobNumber,ToAddress\nJ1,17 Main\nJ2,42 Elm");
        var json = await svc.UploadFile(1, f);
        Assert.Contains("J1", json);
        Assert.Contains("17 Main", json);
        Assert.Contains("42 Elm", json);
    }

    [Fact]
    public async Task UploadFile_SemicolonDelimited_AutoDetected()
    {
        var svc = NewSvc(out _, out _);
        var f = MakeFormFile("data.csv", "JobNumber;ToAddress\nJ1;17 Main");
        var json = await svc.UploadFile(1, f);
        Assert.Contains("J1", json);
        Assert.Contains("17 Main", json);
    }

    [Fact]
    public async Task UploadFile_TabDelimited_AutoDetected()
    {
        var svc = NewSvc(out _, out _);
        var f = MakeFormFile("data.csv", "JobNumber\tToAddress\nJ1\t17 Main");
        var json = await svc.UploadFile(1, f);
        Assert.Contains("J1", json);
        Assert.Contains("17 Main", json);
    }

    [Fact]
    public async Task UploadFile_QuotedField_HandlesDoubledQuotesAndEmbeddedCommas()
    {
        var svc = NewSvc(out _, out _);
        // Quoted field with an embedded comma + a doubled quote to escape.
        var body = "JobNumber,Notes\nJ1,\"He said \"\"hi\"\", then left\"";
        var f = MakeFormFile("data.csv", body);
        var json = await svc.UploadFile(1, f);
        Assert.Contains("hi", json);
    }

    [Fact]
    public async Task UploadFile_BlankColumnHeader_GetsSyntheticName()
    {
        var svc = NewSvc(out _, out _);
        var f = MakeFormFile("data.csv", ",b\nx,y");
        var json = await svc.UploadFile(1, f);
        Assert.Contains("Column1", json);
    }

    [Fact]
    public async Task UploadFile_TrailingBlankRow_IsSkipped()
    {
        var svc = NewSvc(out _, out _);
        var f = MakeFormFile("data.csv", "JobNumber\nJ1\n\n");
        var json = await svc.UploadFile(1, f);
        Assert.Contains("J1", json);
        // No spurious placeholder row.
        Assert.DoesNotContain("\"JobNumber\":null", json);
    }

    [Fact]
    public async Task UploadFile_CrlfLineEndings_ParseSameAsLf()
    {
        var svc = NewSvc(out _, out _);
        var f = MakeFormFile("data.csv", "JobNumber\r\nJ1\r\nJ2");
        var json = await svc.UploadFile(1, f);
        Assert.Contains("J1", json);
        Assert.Contains("J2", json);
    }

    // ---------------- ImportFromGoogleDrive -----------------

    [Fact]
    public async Task ImportFromGoogleDrive_MetadataFailure_ReturnsMessage()
    {
        var handler = new FakeHandler(new HttpResponseMessage(HttpStatusCode.Forbidden) { Content = new StringContent("") });
        var svc = NewSvc(out _, out _, httpHandler: handler);

        var resp = await svc.ImportFromGoogleDrive(1, new GoogleDriveImportRequest
        {
            FileId = "abc",
            FileName = "x.csv",
            AccessToken = "tok"
        });

        // Note: the service catches its own exception too, but for a Forbidden
        // response the "failed to get file metadata" message wins.
        Assert.False(resp.Success);
        Assert.NotEmpty(resp.Messages);
    }

    [Fact]
    public async Task ImportFromGoogleDrive_ExceptionInside_SwallowsAndReturnsMessage()
    {
        // Handler that throws to force the outer catch block.
        var handler = new ThrowingHandler();
        var svc = NewSvc(out _, out _, httpHandler: handler);

        var resp = await svc.ImportFromGoogleDrive(1, new GoogleDriveImportRequest { FileId = "abc", FileName = "x.csv", AccessToken = "tok" });

        Assert.False(resp.Success);
        Assert.NotEmpty(resp.Messages);
    }

    private sealed class ThrowingHandler : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
            => throw new HttpRequestException("boom");
    }

    // ---------------- DeleteBulkJob -----------------

    [Fact]
    public async Task DeleteBulkJob_NoMatchingRows_ReturnsNotFound()
    {
        var svc = NewSvc(out _, out _);
        var resp = await svc.DeleteBulkJob(1, new IdRequest { Id = 42 });
        Assert.False(resp.Success);
        Assert.Contains(resp.Messages, m => m.Message == "Job not found or cannot be deleted.");
    }

    [Fact]
    public async Task DeleteBulkJob_RowLockedByJobId_ReturnsNotFound()
    {
        var svc = NewSvc(out var seed, out _);
        // Add a matching row but with Done=true and JobId set so the guard filters it out.
        var batch = new BulkImportBatch { Id = 1, ContactId = 1, Created = DateTime.Now };
        seed.BulkImportBatches.Add(batch);
        seed.TblBulkJobs.Add(new TblBulkJob
        {
            BulkJobId = 10,
            JobNumber = "J1",
            BookDate = DateTime.Today,
            Done = true,
            JobId = 500,
            ImportId = 1,
            Import = batch
        });
        await seed.SaveChangesAsync();

        var resp = await svc.DeleteBulkJob(1, new IdRequest { Id = 10 });
        Assert.False(resp.Success);
    }

    // ---------------- DeleteTucJob -----------------

    [Fact]
    public async Task DeleteTucJob_NoMatching_ReturnsNotFound()
    {
        var svc = NewSvc(out _, out _);
        var resp = await svc.DeleteTucJob(1, new IdRequest { Id = 99 });

        Assert.False(resp.Success);
        Assert.Contains(resp.Messages, m => m.Message == "On-demand job not found or cannot be deleted (invalid status).");
    }

    [Fact]
    public async Task DeleteTucJob_ExistingRow_VoidsAndAnnotates()
    {
        var svc = NewSvc(out var seed, out _);
        seed.TucJobs.Add(new TucJob { UcjbId = 10, UcjbNumber = "N1", UcjbStatus = 0 });
        seed.TucClientContacts.Add(new TucClientContact { UcctId = 1, Active = true, UcctFirstname = "A", UcctSurname = "B", UcctEmail = "x@y" });
        await seed.SaveChangesAsync();

        var resp = await svc.DeleteTucJob(contactId: 1, new IdRequest { Id = 10 });

        Assert.True(resp.Success);
        using var check = BulkImportTestHarness.Context(BulkImportTestHarness.NewOptions()); // fresh disposable
        // The change happens on the SUT's context; re-read via a new one that
        // shares the same InMemory store isn't possible here without lifting
        // options into scope. Reload from the same seed context instead.
        await seed.Entry(seed.TucJobs.Find(10)!).ReloadAsync();
        var job = seed.TucJobs.Find(10)!;
        Assert.True(job.UcjbVoid);
        Assert.Equal(1000, job.UcjbStatus);
        Assert.Contains("[DELETED]", job.UcjbNotes ?? string.Empty);
    }

    [Fact]
    public async Task DeleteTucJob_RowWithHighStatus_NotAllowed()
    {
        var svc = NewSvc(out var seed, out _);
        // Status 5 is NOT in the allowed list (null, 0, 1, 1000).
        seed.TucJobs.Add(new TucJob { UcjbId = 10, UcjbNumber = "N1", UcjbStatus = 5 });
        await seed.SaveChangesAsync();

        var resp = await svc.DeleteTucJob(contactId: 1, new IdRequest { Id = 10 });
        Assert.False(resp.Success);
    }

    // ---------------- SearchJobsForBulkComplete -----------------

    [Fact]
    public async Task SearchJobsForBulkComplete_Routed_MatchFound()
    {
        var svc = NewSvc(out var seed, out _);
        var speed = new TucJobType { UcjtId = 1, UcjtName = "SD" };
        var status = new TucJobStatus { UcjsId = 0, UcjsName = "Booked" };
        var courier = new TucCourier { UccrId = 1, Code = "CC", Active = true };
        seed.TucJobTypes.Add(speed);
        seed.TucJobStatuses.Add(status);
        seed.TucCouriers.Add(courier);
        seed.TblBulkJobs.Add(new TblBulkJob
        {
            BulkJobId = 1,
            JobNumber = "R1",
            ClientId = 5,
            BookDate = DateTime.Today,
            Done = false,
            Void = false,
            Speed = 1,
            SpeedNavigation = speed,
            JobStatus = 0,
            JobStatusNavigation = status,
            CourierId = 1,
            Courier = courier,
            FromAddress = "F",
            FromSuburb = "FS",
            ToAddress = "T",
            ToSuburb = "TS"
        });
        await seed.SaveChangesAsync();

        var req = new BulkJobSearchRequest
        {
            ClientId = 5,
            JobType = "routed",
            Jobs = new List<BulkJobSearchItem> { new() { JobNumber = "R1" } }
        };
        var resp = await svc.SearchJobsForBulkComplete(contactId: 1, req);

        Assert.True(resp.Success);
        Assert.Single(resp.FoundJobs);
        Assert.Empty(resp.NotFoundJobNumbers);
        Assert.True(resp.FoundJobs.Single().CanComplete);
    }

    [Fact]
    public async Task SearchJobsForBulkComplete_Routed_NotFound()
    {
        var svc = NewSvc(out _, out _);
        var req = new BulkJobSearchRequest
        {
            ClientId = 5,
            JobType = "routed",
            Jobs = new List<BulkJobSearchItem> { new() { JobNumber = "MissingJob" } }
        };
        var resp = await svc.SearchJobsForBulkComplete(contactId: 1, req);

        Assert.True(resp.Success);
        Assert.Empty(resp.FoundJobs);
        Assert.Equal(new[] { "MissingJob" }, resp.NotFoundJobNumbers.ToArray());
    }

    [Fact]
    public async Task SearchJobsForBulkComplete_Routed_ClientIdMismatch_NotFound()
    {
        var svc = NewSvc(out var seed, out _);
        seed.TblBulkJobs.Add(new TblBulkJob { BulkJobId = 1, JobNumber = "R1", ClientId = 999, BookDate = DateTime.Today, FromAddress = "", ToAddress = "" });
        await seed.SaveChangesAsync();

        var req = new BulkJobSearchRequest { ClientId = 5, JobType = "routed", Jobs = new List<BulkJobSearchItem> { new() { JobNumber = "R1" } } };
        var resp = await svc.SearchJobsForBulkComplete(contactId: 1, req);

        Assert.Empty(resp.FoundJobs);
        Assert.Single(resp.NotFoundJobNumbers);
    }

    [Fact]
    public async Task SearchJobsForBulkComplete_OnDemand_NotFound()
    {
        var svc = NewSvc(out _, out _);
        var req = new BulkJobSearchRequest
        {
            ClientId = 5,
            JobType = "ondemand",
            Jobs = new List<BulkJobSearchItem> { new() { JobNumber = "OD1" } }
        };
        var resp = await svc.SearchJobsForBulkComplete(contactId: 1, req);

        Assert.Empty(resp.FoundJobs);
        Assert.Equal(new[] { "OD1" }, resp.NotFoundJobNumbers.ToArray());
    }

    [Fact]
    public async Task SearchJobsForBulkComplete_DateFilterExcludesRow()
    {
        var svc = NewSvc(out var seed, out _);
        seed.TblBulkJobs.Add(new TblBulkJob { BulkJobId = 1, JobNumber = "R1", ClientId = 5, BookDate = DateTime.Today, FromAddress = "", ToAddress = "" });
        await seed.SaveChangesAsync();

        var req = new BulkJobSearchRequest
        {
            ClientId = 5,
            JobType = "routed",
            Jobs = new List<BulkJobSearchItem>
            {
                new() { JobNumber = "R1", DateTime = DateTime.Today.AddDays(-3) }
            }
        };
        var resp = await svc.SearchJobsForBulkComplete(contactId: 1, req);

        Assert.Single(resp.NotFoundJobNumbers);
    }

    // ---------------- BulkCompleteJobs -----------------

    [Fact]
    public async Task BulkCompleteJobs_Routed_NoMatchingRows_ReturnsNotFoundMessage()
    {
        var svc = NewSvc(out _, out _);
        var req = new BulkJobCompleteRequest
        {
            ClientId = 5,
            JobType = "routed",
            Jobs = new List<BulkJobCompleteItem> { new() { JobId = 999 } }
        };

        var resp = await svc.BulkCompleteJobs(contactId: 1, req);

        Assert.False(resp.Success);
        Assert.Contains(resp.Messages, m => m.Message == "No jobs found to complete.");
    }

    [Fact]
    public async Task BulkCompleteJobs_OnDemand_AlreadyDone_FailedAndCountZero()
    {
        var svc = NewSvc(out var seed, out _);
        seed.TucJobs.Add(new TucJob
        {
            UcjbId = 10,
            UcjbNumber = "N1",
            UcjbClientId = 5,
            UcjbJobDone = true,
            UcjbVoid = false
        });
        await seed.SaveChangesAsync();

        var req = new BulkJobCompleteRequest
        {
            ClientId = 5,
            JobType = "ondemand",
            Jobs = new List<BulkJobCompleteItem> { new() { JobId = 10, JobNumber = "N1" } }
        };
        var resp = await svc.BulkCompleteJobs(contactId: 1, req);

        // Nothing succeeded; failedJobs count is 1 (>= 1 == request.Jobs.Count),
        // so Success flips to false.
        Assert.False(resp.Success);
    }

    [Fact]
    public async Task BulkCompleteJobs_OnDemand_MissingJob_FailedWithNotFound()
    {
        var svc = NewSvc(out _, out _);
        var req = new BulkJobCompleteRequest
        {
            ClientId = 5,
            JobType = "ondemand",
            Jobs = new List<BulkJobCompleteItem> { new() { JobId = 999, JobNumber = "GHOST" } }
        };
        var resp = await svc.BulkCompleteJobs(contactId: 1, req);
        Assert.False(resp.Success);
        Assert.Contains(resp.Messages, m => m.Message?.Contains("GHOST: Not found") == true);
    }

    [Fact]
    public async Task BulkCompleteJobs_OnDemand_VoidJob_FailsAsCannotComplete()
    {
        var svc = NewSvc(out var seed, out _);
        seed.TucJobs.Add(new TucJob { UcjbId = 10, UcjbNumber = "N1", UcjbClientId = 5, UcjbVoid = true });
        await seed.SaveChangesAsync();

        var req = new BulkJobCompleteRequest
        {
            ClientId = 5,
            JobType = "ondemand",
            Jobs = new List<BulkJobCompleteItem> { new() { JobId = 10, JobNumber = "N1" } }
        };
        var resp = await svc.BulkCompleteJobs(contactId: 1, req);

        Assert.False(resp.Success);
        Assert.Contains(resp.Messages, m => m.Message?.Contains("Cannot complete void job") == true);
    }

    [Fact]
    public async Task BulkCompleteJobs_OnDemand_HappyPath_MarksJobDone()
    {
        var svc = NewSvc(out var seed, out _);
        seed.TucClientContacts.Add(new TucClientContact { UcctId = 1, Active = true, UcctFirstname = "F", UcctSurname = "S", UcctEmail = "a@b" });
        seed.TucJobs.Add(new TucJob { UcjbId = 10, UcjbNumber = "N1", UcjbClientId = 5, UcjbJobDone = false, UcjbVoid = false });
        await seed.SaveChangesAsync();

        var req = new BulkJobCompleteRequest
        {
            ClientId = 5,
            JobType = "ondemand",
            Jobs = new List<BulkJobCompleteItem> { new() { JobId = 10, JobNumber = "N1" } }
        };
        var resp = await svc.BulkCompleteJobs(contactId: 1, req);

        Assert.True(resp.Success);
        await seed.Entry(seed.TucJobs.Find(10)!).ReloadAsync();
        var job = seed.TucJobs.Find(10)!;
        Assert.True(job.UcjbJobDone);
        Assert.Equal(6, job.UcjbStatus);
        Assert.NotNull(job.UcjbNotes);
    }

    [Fact]
    public async Task BulkCompleteJobs_OnDemand_UnknownCourierCode_LogsAndContinues()
    {
        var svc = NewSvc(out var seed, out _);
        seed.TucJobs.Add(new TucJob { UcjbId = 10, UcjbNumber = "N1", UcjbClientId = 5, UcjbJobDone = false, UcjbVoid = false });
        await seed.SaveChangesAsync();

        var req = new BulkJobCompleteRequest
        {
            ClientId = 5,
            JobType = "ondemand",
            Jobs = new List<BulkJobCompleteItem> { new() { JobId = 10, JobNumber = "N1", CourierCode = "GHOST" } }
        };
        var resp = await svc.BulkCompleteJobs(contactId: 1, req);

        // Job still completes.
        Assert.True(resp.Success);
    }

    [Fact]
    public async Task BulkCompleteJobs_OnDemand_ChildJob_AlsoCompleted()
    {
        var svc = NewSvc(out var seed, out _);
        seed.TucJobs.AddRange(
            new TucJob { UcjbId = 10, UcjbNumber = "N1", UcjbClientId = 5 },
            new TucJob { UcjbId = 11, UcjbNumber = "N1c", UcjbClientId = 5, ParentId = 10 });
        await seed.SaveChangesAsync();

        var req = new BulkJobCompleteRequest
        {
            ClientId = 5,
            JobType = "ondemand",
            Jobs = new List<BulkJobCompleteItem> { new() { JobId = 10, JobNumber = "N1" } }
        };
        var resp = await svc.BulkCompleteJobs(contactId: 1, req);

        Assert.True(resp.Success);
        await seed.Entry(seed.TucJobs.Find(11)!).ReloadAsync();
        Assert.True(seed.TucJobs.Find(11)!.UcjbJobDone);
    }

    // ---------------- GetBulkJobs -----------------

    [Fact]
    public async Task GetBulkJobs_InternalUser_EmptyDb_SucceedsWithEmpty()
    {
        var svc = NewSvc(out _, out _, internalClaim: "True");
        var resp = await svc.GetBulkJobs(contactId: 1, Guid.NewGuid());
        Assert.True(resp.Success);
        Assert.Empty(resp.Jobs);
    }

    [Fact]
    public async Task GetBulkJobs_ExternalContact_EmptyDb_SucceedsWithEmpty()
    {
        var svc = NewSvc(out _, out _);
        var resp = await svc.GetBulkJobs(contactId: 1, Guid.NewGuid());
        Assert.True(resp.Success);
        Assert.Empty(resp.Jobs);
    }
}
