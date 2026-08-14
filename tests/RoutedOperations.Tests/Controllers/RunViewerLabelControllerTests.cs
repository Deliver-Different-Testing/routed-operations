// Covers RunViewerLabelController: 7 endpoints under /api/runviewer/labels.
// RouteViewerLabelService is a pure HTTP proxy to the legacy RunViewer
// label endpoints; when env var `RunViewerLabelProxyUrl` is unset every
// method throws InvalidOperationException which the controller wraps to
// 501 (label PDFs) or 501 (CSV manifest). Focus:
//   * Missing-env-var -> 501 wrapping on all 7 endpoints
// Happy paths that exercise the outbound proxy call are covered by
// RouteViewerLabelService tests + E2E.
using System.Net;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging.Abstractions;
using RoutedOperations.API.Controllers;
using RoutedOperations.Core.Application.Dtos.RouteViewer;
using RoutedOperations.Core.Application.Services.RouteViewer;

namespace RoutedOperations.Tests.Controllers;

[Collection("EnvVarMutating")]
public class RunViewerLabelControllerTests : IDisposable
{
    public RunViewerLabelControllerTests()
    {
        // Ensure the proxy URL is unset for every test so
        // InvalidOperationException fires from the service.
        Environment.SetEnvironmentVariable("RunViewerLabelProxyUrl", null);
    }

    public void Dispose()
    {
        Environment.SetEnvironmentVariable("RunViewerLabelProxyUrl", null);
        GC.SuppressFinalize(this);
    }

    private sealed class NoopHandler : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
            => Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK));
    }

    private static RunViewerLabelController NewCtl()
    {
        var client = new HttpClient(new NoopHandler());
        var svc = new RouteViewerLabelService(client, NullLogger<RouteViewerLabelService>.Instance);
        var controller = new RunViewerLabelController(svc);
        ControllerTestHarness.AttachHttpContext(controller);
        return controller;
    }

    // ── GetSingleJobLabel ───────────────────────────────────────────────

    [Fact]
    public async Task GetSingleJobLabel_NoProxyUrl_Returns501()
    {
        var ctl = NewCtl();

        var result = await ctl.GetSingleJobLabel(jobId: 1);

        var r = Assert.IsType<ObjectResult>(result);
        Assert.Equal(StatusCodes.Status501NotImplemented, r.StatusCode);
    }

    // ── GetLhpJobLabel ──────────────────────────────────────────────────

    [Fact]
    public async Task GetLhpJobLabel_NoProxyUrl_Returns501()
    {
        var ctl = NewCtl();

        var result = await ctl.GetLhpJobLabel(jobId: 1);

        var r = Assert.IsType<ObjectResult>(result);
        Assert.Equal(StatusCodes.Status501NotImplemented, r.StatusCode);
    }

    // ── GetSingleBulkLabel ──────────────────────────────────────────────

    [Fact]
    public async Task GetSingleBulkLabel_NoProxyUrl_Returns501()
    {
        var ctl = NewCtl();

        var result = await ctl.GetSingleBulkLabel(bulkJobId: 1);

        var r = Assert.IsType<ObjectResult>(result);
        Assert.Equal(StatusCodes.Status501NotImplemented, r.StatusCode);
    }

    // ── GetBulkLabels ───────────────────────────────────────────────────

    [Fact]
    public async Task GetBulkLabels_NoProxyUrl_Returns501()
    {
        var ctl = NewCtl();

        var result = await ctl.GetBulkLabels(new LabelRequest());

        var r = Assert.IsType<ObjectResult>(result);
        Assert.Equal(StatusCodes.Status501NotImplemented, r.StatusCode);
    }

    // ── GetBulkLabelsBySpeed ────────────────────────────────────────────

    [Fact]
    public async Task GetBulkLabelsBySpeed_NoProxyUrl_Returns501()
    {
        var ctl = NewCtl();

        var result = await ctl.GetBulkLabelsBySpeed(new LabelRequest());

        var r = Assert.IsType<ObjectResult>(result);
        Assert.Equal(StatusCodes.Status501NotImplemented, r.StatusCode);
    }

    // ── GetLineHaulLabels ───────────────────────────────────────────────

    [Fact]
    public async Task GetLineHaulLabels_NoProxyUrl_Returns501()
    {
        var ctl = NewCtl();

        var result = await ctl.GetLineHaulLabels(new LabelRequest());

        var r = Assert.IsType<ObjectResult>(result);
        Assert.Equal(StatusCodes.Status501NotImplemented, r.StatusCode);
    }

    // ── GetLineHaulManifest ─────────────────────────────────────────────

    [Fact]
    public async Task GetLineHaulManifest_NoProxyUrl_Returns501()
    {
        var ctl = NewCtl();

        var result = await ctl.GetLineHaulManifest(new LabelRequest());

        var r = Assert.IsType<ObjectResult>(result);
        Assert.Equal(StatusCodes.Status501NotImplemented, r.StatusCode);
    }
}
