// Covers RunViewerEventController: 9 endpoints under /api/runviewer/events.
// The RouteViewerEventService uses INpScopeResolver (short-circuits NP
// sessions to empty on read paths + false on mutations) and
// ExecuteSqlRawAsync / SqlQueryRaw (blows up under InMemory). Focus:
//   * NP short-circuit on GetEventList (returns empty response body)
//   * Controller-level guards on AddReply (blank Note -> BadRequest)
//   * Controller-level guards on UploadIntelPhoto (empty file / mobile
//     -> BadRequest) and its S3-failure 501 wrapper
//   * DeleteIntelPhoto blank key -> BadRequest, S3-failure 501 wrapper
//   * CloseEvent NP short-circuit -> NotFound
// Happy paths that hit SPs / S3 for real are covered by service tests + E2E.
using System.Text;
using Amazon.S3;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging.Abstractions;
using RoutedOperations.API.Controllers;
using RoutedOperations.Core.Application.Dtos.RouteViewer;
using RoutedOperations.Core.Application.Services.Np;
using RoutedOperations.Core.Application.Services.RouteViewer;

namespace RoutedOperations.Tests.Controllers;

public class RunViewerEventControllerTests : IDisposable
{
    public RunViewerEventControllerTests()
    {
        Environment.SetEnvironmentVariable("S3Bucket", "test-bucket");
    }

    public void Dispose()
    {
        Environment.SetEnvironmentVariable("S3Bucket", null);
        GC.SuppressFinalize(this);
    }

    private static (RunViewerEventController controller, INpScopeResolver resolver)
        NewCtl(bool isAdmin = true, int? npAgentId = null)
    {
        var opts = ControllerTestHarness.NewOptions();
        var factory = ControllerTestHarness.Factory(opts);
        var resolver = Substitute.For<INpScopeResolver>();
        resolver.ResolveAsync().Returns(new NpScope(isAdmin, npAgentId));
        var svc = new RouteViewerEventService(factory, resolver,
            NullLogger<RouteViewerEventService>.Instance);
        var controller = new RunViewerEventController(svc);
        ControllerTestHarness.AttachHttpContext(controller);
        return (controller, resolver);
    }

    private static S3PhotoReader NewS3Reader(IAmazonS3? s3 = null)
    {
        s3 ??= Substitute.For<IAmazonS3>();
        return new S3PhotoReader(s3, NullLogger<S3PhotoReader>.Instance);
    }

    // ── GetEventList ────────────────────────────────────────────────────

    [Fact]
    public async Task GetEventList_NpSession_ReturnsEmptyResponse()
    {
        var (ctl, _) = NewCtl(isAdmin: false, npAgentId: 42);

        var result = await ctl.GetEventList(new EventListRequest());

        var ok = Assert.IsType<OkObjectResult>(result);
        var payload = ControllerTestHarness.ExtractResponse(ok);
        var list = Assert.IsType<List<EventDto>>(payload);
        Assert.Empty(list);
    }

    // ── GetEventJobs ────────────────────────────────────────────────────

    [Fact]
    public async Task GetEventJobs_NpSession_ReturnsEmptyResponse()
    {
        var (ctl, _) = NewCtl(isAdmin: false, npAgentId: 42);

        var result = await ctl.GetEventJobs(clientId: 1, clientInternal: false);

        var ok = Assert.IsType<OkObjectResult>(result);
        var payload = ControllerTestHarness.ExtractResponse(ok);
        var list = Assert.IsType<List<EventJobDto>>(payload);
        Assert.Empty(list);
    }

    // ── CloseEvent ──────────────────────────────────────────────────────

    [Fact]
    public async Task CloseEvent_NpSession_ReturnsNotFound()
    {
        // Service short-circuits to false for NP -> controller maps false
        // to NotFound.
        var (ctl, _) = NewCtl(isAdmin: false, npAgentId: 42);

        var result = await ctl.CloseEvent(eventId: 1, new CloseEventRequest { ClosedBy = "kevin" });

        Assert.IsType<NotFoundObjectResult>(result);
    }

    // ── AddReply ────────────────────────────────────────────────────────

    [Fact]
    public async Task AddReply_BlankNote_ReturnsBadRequest()
    {
        var (ctl, _) = NewCtl();

        var result = await ctl.AddReply(eventId: 1, new AddEventReplyRequest { Note = "  " });

        Assert.IsType<BadRequestObjectResult>(result);
    }

    [Fact]
    public async Task AddReply_NpSession_ReturnsNotFound()
    {
        var (ctl, _) = NewCtl(isAdmin: false, npAgentId: 42);

        var result = await ctl.AddReply(eventId: 1,
            new AddEventReplyRequest { Note = "hi", UserName = "kevin" });

        Assert.IsType<NotFoundObjectResult>(result);
    }

    // ── UploadIntelPhoto ────────────────────────────────────────────────

    [Fact]
    public async Task UploadIntelPhoto_NullFile_ReturnsBadRequest()
    {
        var (ctl, _) = NewCtl();

        var result = await ctl.UploadIntelPhoto(file: null!, mobile: "0210000000",
            description: null, s3: NewS3Reader());

        Assert.IsType<BadRequestObjectResult>(result);
    }

    [Fact]
    public async Task UploadIntelPhoto_EmptyFile_ReturnsBadRequest()
    {
        var (ctl, _) = NewCtl();
        var file = new FormFile(new MemoryStream(Array.Empty<byte>()), 0, 0, "file", "empty.jpg");

        var result = await ctl.UploadIntelPhoto(file, mobile: "0210000000",
            description: null, s3: NewS3Reader());

        Assert.IsType<BadRequestObjectResult>(result);
    }

    [Fact]
    public async Task UploadIntelPhoto_BlankMobile_ReturnsBadRequest()
    {
        var (ctl, _) = NewCtl();
        var bytes = Encoding.UTF8.GetBytes("img");
        var file = new FormFile(new MemoryStream(bytes), 0, bytes.Length, "file", "a.jpg")
        {
            Headers = new HeaderDictionary(),
            ContentType = "image/jpeg",
        };

        var result = await ctl.UploadIntelPhoto(file, mobile: "  ",
            description: null, s3: NewS3Reader());

        Assert.IsType<BadRequestObjectResult>(result);
    }

    // ── DeleteIntelPhoto ────────────────────────────────────────────────

    [Fact]
    public async Task DeleteIntelPhoto_BlankKey_ReturnsBadRequest()
    {
        var (ctl, _) = NewCtl();

        var result = await ctl.DeleteIntelPhoto(key: "  ", s3: NewS3Reader());

        Assert.IsType<BadRequestObjectResult>(result);
    }

    [Fact]
    public async Task DeleteIntelPhoto_MissingBucketEnv_Returns501()
    {
        // Bucket env var reader throws InvalidOperationException when the
        // S3 delete path tries to compose the request; controller wraps
        // that as 501.
        Environment.SetEnvironmentVariable("S3Bucket", null);
        try
        {
            var (ctl, _) = NewCtl();
            var result = await ctl.DeleteIntelPhoto(key: "some-key", s3: NewS3Reader());

            var r = Assert.IsType<ObjectResult>(result);
            Assert.Equal(StatusCodes.Status501NotImplemented, r.StatusCode);
        }
        finally
        {
            Environment.SetEnvironmentVariable("S3Bucket", "test-bucket");
        }
    }
}
