// RunViewerLabelController error mapping. The PDF happy path is a
// FileContentResult; these cover what the operator sees when label
// generation fails (ticket #855 showed only "HTTP 500" for months).
// The real RouteViewerLabelService runs on the EF InMemory store with the
// label package substituted, so the controller sees the exceptions the
// package would raise.
using DeliverDifferent.AlertLabel.Data.Models;
using DeliverDifferent.AlertLabel.Data.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging.Abstractions;
using RoutedOperations.API.Controllers;
using RoutedOperations.Core.Application.Dtos.RouteViewer;
using RoutedOperations.Core.Application.Services.Np;
using RoutedOperations.Core.Application.Services.RouteViewer;
using RoutedOperations.Core.Domain;
using RoutedOperations.Core.Domain.Despatch;

namespace RoutedOperations.Tests.Controllers;

public class RunViewerLabelControllerTests
{
    private static RunViewerLabelController NewCtl(IAlertLabelService alert, bool seedTemplate = true)
    {
        var opts = ControllerTestHarness.NewOptions();
        if (seedTemplate)
        {
            using var ctx = ControllerTestHarness.Context(opts);
            ctx.AlertTemplates.Add(new AlertTemplate { Id = 1, Name = "Label", TemplateType = 2, PageSizeId = 4 });
            ctx.TblSettings.Add(new TblSetting { SettingId = 1 });
            ctx.SaveChanges();
        }
        var resolver = Substitute.For<INpScopeResolver>();
        resolver.ResolveAsync().Returns(new NpScope(true, null));
        var svc = new RouteViewerLabelService(
            ControllerTestHarness.Factory(opts), alert, resolver,
            Substitute.For<INpScopeGuard>(), new HttpClient(),
            NullLogger<RouteViewerLabelService>.Instance);
        var ctl = new RunViewerLabelController(svc);
        ControllerTestHarness.AttachHttpContext(ctl, method: "POST", path: "/api/runviewer/labels/bulk-jobs");
        return ctl;
    }

    private static string? Message(ObjectResult r) =>
        r.Value?.GetType().GetProperty("message")?.GetValue(r.Value) as string;

    [Fact]
    public async Task BulkJobs_Pdf_ReturnsFile()
    {
        var alert = Substitute.For<IAlertLabelService>();
        alert.GeneratePdfAsync(Arg.Any<AlertLabelRequest>()).Returns(new byte[] { 37, 80, 68, 70 });

        var result = await NewCtl(alert).GetBulkLabels(new LabelRequest { BookDate = new DateTime(2026, 11, 4) });

        var file = Assert.IsType<FileContentResult>(result);
        Assert.Equal("application/pdf", file.ContentType);
    }

    [Fact]
    public async Task BulkJobs_NoTemplate_Returns501WithMessage()
    {
        var result = await NewCtl(Substitute.For<IAlertLabelService>(), seedTemplate: false)
            .GetBulkLabels(new LabelRequest { BookDate = new DateTime(2026, 11, 4) });

        var obj = Assert.IsType<ObjectResult>(result);
        Assert.Equal(StatusCodes.Status501NotImplemented, obj.StatusCode);
        Assert.False(string.IsNullOrWhiteSpace(Message(obj)));
    }

    [Fact]
    public async Task BulkJobs_NothingToPrint_Returns422WithPlainMessage()
    {
        // #855: a run that selects no jobs used to come back as
        // "DocumentDrawingException: An exception occured during document
        // drawing." with HTTP 500. The package now says there is nothing to
        // print, and the operator sees that in plain words.
        var alert = Substitute.For<IAlertLabelService>();
        alert.GeneratePdfAsync(Arg.Any<AlertLabelRequest>())
            .Returns<Task<byte[]>>(_ => throw new NoLabelsException(8, new DateTime(2026, 11, 3), "Burbank to Lab"));

        var result = await NewCtl(alert).GetBulkLabels(new LabelRequest
        {
            BookDate = new DateTime(2026, 11, 3), RunName = "Burbank to Lab", JobIds = "1",
        });

        var obj = Assert.IsType<ObjectResult>(result);
        Assert.Equal(StatusCodes.Status422UnprocessableEntity, obj.StatusCode);
        Assert.Equal("No labels to print for this run (Burbank to Lab, 3 Nov 2026).", Message(obj));
    }

    [Fact]
    public async Task BulkJobs_NothingToPrint_NoRunOrDate_Returns422_NotThe501ItsBaseTypeGets()
    {
        var alert = Substitute.For<IAlertLabelService>();
        alert.GeneratePdfAsync(Arg.Any<AlertLabelRequest>())
            .Returns<Task<byte[]>>(_ => throw new NoLabelsException(4, null, null));

        var result = await NewCtl(alert).GetBulkLabels(new LabelRequest());

        var obj = Assert.IsType<ObjectResult>(result);
        Assert.Equal(StatusCodes.Status422UnprocessableEntity, obj.StatusCode);
        Assert.Equal("No labels to print for this run.", Message(obj));
    }

    [Fact]
    public async Task BulkJobs_RendererFails_Returns500WithTypeAndMessage()
    {
        // 1de3414: any other failure keeps surfacing its real cause.
        var alert = Substitute.For<IAlertLabelService>();
        alert.GeneratePdfAsync(Arg.Any<AlertLabelRequest>())
            .Returns<Task<byte[]>>(_ => throw new FormatException("boom"));

        var result = await NewCtl(alert).GetBulkLabels(new LabelRequest { BookDate = new DateTime(2026, 11, 4) });

        var obj = Assert.IsType<ObjectResult>(result);
        Assert.Equal(StatusCodes.Status500InternalServerError, obj.StatusCode);
        Assert.Equal("FormatException: boom", Message(obj));
    }
}
