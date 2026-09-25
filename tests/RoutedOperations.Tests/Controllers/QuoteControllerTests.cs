// Covers QuoteController: sets list, upload, simulate, delete. Backed by
// a real QuoteService against the InMemory harness so the shadow-table
// CRUD path is exercised end-to-end.
using Microsoft.AspNetCore.Mvc;
using RoutedOperations.API.Controllers;
using RoutedOperations.Core.Application.Dtos.Quote;
using RoutedOperations.Core.Application.Services.Quote;
using RoutedOperations.Core.Domain.Despatch;

namespace RoutedOperations.Tests.Controllers;

public class QuoteControllerTests
{
    private static (QuoteController controller, Core.Domain.DynamicDespatchDbContext seed) NewCtl()
    {
        var opts = ControllerTestHarness.NewOptions();
        var seed = ControllerTestHarness.Context(opts);
        var svc = new QuoteService(ControllerTestHarness.Factory(opts));
        var controller = new QuoteController(svc);
        ControllerTestHarness.AttachHttpContext(controller);
        return (controller, seed);
    }

    // ── GetSets ───────────────────────────────────────────────────────────

    [Fact]
    public async Task GetSets_NoQuotes_ReturnsEmptyList()
    {
        var (ctl, _) = NewCtl();

        var result = await ctl.GetSets();

        var ok = Assert.IsType<OkObjectResult>(result);
        var list = (System.Collections.IEnumerable)ok.Value!.GetType()
            .GetProperty("response")!.GetValue(ok.Value)!;
        Assert.Empty(list);
    }

    [Fact]
    public async Task GetSets_ReturnsOnePerQuoteSetCode()
    {
        var (ctl, seed) = NewCtl();
        seed.TblQuoteJobs.AddRange(
            new TblQuoteJob { QuoteSetCode = "S1", CreatedUtc = DateTime.UtcNow.AddMinutes(-10) },
            new TblQuoteJob { QuoteSetCode = "S1", CreatedUtc = DateTime.UtcNow.AddMinutes(-5) },
            new TblQuoteJob { QuoteSetCode = "S2", CreatedUtc = DateTime.UtcNow });
        await seed.SaveChangesAsync();

        var result = await ctl.GetSets();

        var ok = Assert.IsType<OkObjectResult>(result);
        var list = (System.Collections.IEnumerable)ok.Value!.GetType()
            .GetProperty("response")!.GetValue(ok.Value)!;
        var count = 0; foreach (var _ in list) count++;
        Assert.Equal(2, count);
    }

    // ── Upload ────────────────────────────────────────────────────────────

    [Fact]
    public async Task Upload_MissingQuoteSetCode_ReturnsBadRequest()
    {
        var (ctl, _) = NewCtl();

        var result = await ctl.Upload(new QuoteUploadRequest("", new List<QuoteJobUploadRow>()));

        var bad = Assert.IsType<BadRequestObjectResult>(result);
        var msg = bad.Value!.GetType().GetProperty("message")!.GetValue(bad.Value) as string;
        Assert.Contains("QuoteSetCode", msg);
    }

    [Fact]
    public async Task Upload_WhitespaceQuoteSetCode_ReturnsBadRequest()
    {
        var (ctl, _) = NewCtl();

        var result = await ctl.Upload(new QuoteUploadRequest("   ", new List<QuoteJobUploadRow>()));

        Assert.IsType<BadRequestObjectResult>(result);
    }

    [Fact]
    public async Task Upload_HappyPath_ReturnsUploadResult()
    {
        var (ctl, seed) = NewCtl();

        var result = await ctl.Upload(new QuoteUploadRequest("S1", new List<QuoteJobUploadRow>
        {
            new(null, "A", "B", null, null, 1m, null, null, true),
        }));

        var ok = Assert.IsType<OkObjectResult>(result);
        var payload = ok.Value!.GetType().GetProperty("response")!.GetValue(ok.Value)
            as QuoteUploadResult;
        Assert.NotNull(payload);
        Assert.Equal("S1", payload!.QuoteSetCode);
        Assert.Equal(1, payload.RowsUploaded);
    }

    // ── Simulate ─────────────────────────────────────────────────────────

    [Fact]
    public async Task Simulate_EmptySetReturnsZeroDrivers()
    {
        var (ctl, _) = NewCtl();

        var result = await ctl.Simulate(new QuoteSimulateRequest("empty", "standard", "same-day", 10, 80));

        var ok = Assert.IsType<OkObjectResult>(result);
        var res = ok.Value!.GetType().GetProperty("response")!.GetValue(ok.Value)
            as QuoteSimulateResult;
        Assert.NotNull(res);
        Assert.Equal(0, res!.JobCount);
        Assert.Equal(0, res.DriversRequired);
    }

    // ── DeleteSet ────────────────────────────────────────────────────────

    [Fact]
    public async Task DeleteSet_UnknownCode_ReturnsZeroDeleted()
    {
        var (ctl, _) = NewCtl();

        var result = await ctl.DeleteSet("does-not-exist");

        var ok = Assert.IsType<OkObjectResult>(result);
        var payload = ok.Value!.GetType().GetProperty("response")!.GetValue(ok.Value)!;
        var deleted = payload.GetType().GetProperty("deleted")!.GetValue(payload);
        Assert.Equal(0, deleted);
    }

    [Fact]
    public async Task DeleteSet_KnownCode_ReportsRowsDeleted()
    {
        var (ctl, seed) = NewCtl();
        seed.TblQuoteJobs.AddRange(
            new TblQuoteJob { QuoteSetCode = "S1", CreatedUtc = DateTime.UtcNow },
            new TblQuoteJob { QuoteSetCode = "S1", CreatedUtc = DateTime.UtcNow });
        await seed.SaveChangesAsync();

        var result = await ctl.DeleteSet("S1");

        var ok = Assert.IsType<OkObjectResult>(result);
        var payload = ok.Value!.GetType().GetProperty("response")!.GetValue(ok.Value)!;
        Assert.Equal(2, payload.GetType().GetProperty("deleted")!.GetValue(payload));
    }
}
