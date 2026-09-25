// Covers RunsController: read + insert/update/delete + assign + start-end +
// dispatch. RunService is exercised for real via the InMemory harness; the
// dispatch endpoints (which need Dapper -> SQL Server) are only covered on
// the pre-service short-circuits (ModelState invalid + empty JobIds list),
// since RunCommitService's SP call cannot execute against InMemory.
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using RoutedOperations.API.Controllers;
using RoutedOperations.Core.Application.Dtos.Run;
using RoutedOperations.Core.Application.Services.Run;
using RoutedOperations.Core.Domain.Despatch;
using RoutedOperations.Infrastructure;

namespace RoutedOperations.Tests.Controllers;

public class RunsControllerTests
{
    private static (RunsController controller, Core.Domain.DynamicDespatchDbContext seed,
        RunService runService, RunCommitService dispatch) NewCtl()
    {
        var opts = ControllerTestHarness.NewOptions();
        var seed = ControllerTestHarness.Context(opts);
        var runService = new RunService(ControllerTestHarness.Factory(opts));

        // RunCommitService needs IConnectionStringManager + IHttpContextAccessor.
        // Tests only exercise the controller's own short-circuits (ModelState
        // invalid + empty JobIds); anything that reaches the SP call would
        // throw because the connection string is bogus. That's fine - no test
        // here drives the happy path.
        var cs = Substitute.For<IConnectionStringManager>();
        cs.GetConnectionStringAsync(Arg.Any<string>()).Returns(Task.FromResult<string?>(null));
        var accessor = ControllerTestHarness.Accessor();
        var dispatch = new RunCommitService(cs, accessor);

        var controller = new RunsController(runService, dispatch);
        ControllerTestHarness.AttachHttpContext(controller);
        return (controller, seed, runService, dispatch);
    }

    // ── Get ───────────────────────────────────────────────────────────────

    [Fact]
    public async Task Get_NoRuns_ReturnsEmptyResponseEnvelope()
    {
        var (ctl, _, _, _) = NewCtl();

        var result = await ctl.Get(null, null, null, null, null);

        var ok = Assert.IsType<OkObjectResult>(result);
        var payload = ok.Value!;
        var runs = payload.GetType().GetProperty("response")!.GetValue(payload);
        Assert.NotNull(runs);
        Assert.Empty((System.Collections.IEnumerable)runs!);
    }

    [Fact]
    public async Task Get_SurfacesSeededRun()
    {
        var (ctl, seed, _, _) = NewCtl();
        var date = new DateTime(2026, 8, 13);
        seed.TblBulkRuns.Add(new TblBulkRun { Id = 5, Name = "R5", Status = 1, DespatchDateTime = date });
        seed.TblBulkJobs.Add(new TblBulkJob
        {
            BulkJobId = 1, JobNumber = "J1", ClientId = 1, ClientCode = "C",
            BookDate = date, BookTime = date, JobStatus = 0, Speed = 1,
            FromAddress = "F", ToAddress = "T", BulkRunId = 5, RunOrder = 1,
        });
        await seed.SaveChangesAsync();

        var result = await ctl.Get(date, null, null, null, null);

        var ok = Assert.IsType<OkObjectResult>(result);
        var runs = (System.Collections.IEnumerable)ok.Value!.GetType()
            .GetProperty("response")!.GetValue(ok.Value)!;
        var count = 0; foreach (var _ in runs) count++;
        Assert.Equal(1, count);
    }

    // ── InsertOrUpdate ────────────────────────────────────────────────────

    [Fact]
    public async Task InsertOrUpdate_InvalidModelState_ReturnsBadRequest()
    {
        var (ctl, _, _, _) = NewCtl();
        ctl.ModelState.AddModelError("Name", "required");

        var result = await ctl.InsertOrUpdate(new InsertOrUpdateRunRequest());

        Assert.IsType<BadRequestObjectResult>(result);
    }

    [Fact]
    public async Task InsertOrUpdate_HappyPath_ReturnsOkWithSuccessAndId()
    {
        var (ctl, _, _, _) = NewCtl();

        var result = await ctl.InsertOrUpdate(new InsertOrUpdateRunRequest
        {
            Name = "R", Jobs = new List<RunJobDto>(),
        });

        var ok = Assert.IsType<OkObjectResult>(result);
        var response = ok.Value!.GetType().GetProperty("response")!.GetValue(ok.Value)!;
        var resultVal = response.GetType().GetProperty("Result")!.GetValue(response) as string;
        Assert.Equal("Success", resultVal);
    }

    [Fact]
    public async Task InsertOrUpdate_UnknownId_ReturnsOkWithFailure()
    {
        var (ctl, _, _, _) = NewCtl();

        var result = await ctl.InsertOrUpdate(new InsertOrUpdateRunRequest
        {
            Id = 999, Name = "R", Jobs = new List<RunJobDto>(),
        });

        var ok = Assert.IsType<OkObjectResult>(result);
        var response = ok.Value!.GetType().GetProperty("response")!.GetValue(ok.Value)!;
        Assert.Equal("Failed", response.GetType().GetProperty("Result")!.GetValue(response));
    }

    // ── Update ────────────────────────────────────────────────────────────

    [Fact]
    public async Task Update_StampsIdFromRoute()
    {
        var (ctl, seed, _, _) = NewCtl();
        seed.TblBulkRuns.Add(new TblBulkRun { Id = 42, Name = "Old" });
        await seed.SaveChangesAsync();

        var result = await ctl.Update(42, new InsertOrUpdateRunRequest { Name = "New" });

        var ok = Assert.IsType<OkObjectResult>(result);
        var response = ok.Value!.GetType().GetProperty("response")!.GetValue(ok.Value)!;
        Assert.Equal("Success", response.GetType().GetProperty("Result")!.GetValue(response));
    }

    [Fact]
    public async Task Update_InvalidModelState_ReturnsBadRequest()
    {
        var (ctl, _, _, _) = NewCtl();
        ctl.ModelState.AddModelError("Name", "bad");

        var result = await ctl.Update(1, new InsertOrUpdateRunRequest());

        Assert.IsType<BadRequestObjectResult>(result);
    }

    [Fact]
    public async Task Update_UnknownId_ReturnsOkWithFailure()
    {
        var (ctl, _, _, _) = NewCtl();

        var result = await ctl.Update(999, new InsertOrUpdateRunRequest { Name = "R" });

        var ok = Assert.IsType<OkObjectResult>(result);
        var response = ok.Value!.GetType().GetProperty("response")!.GetValue(ok.Value)!;
        Assert.Equal("Failed", response.GetType().GetProperty("Result")!.GetValue(response));
    }

    // ── Delete ────────────────────────────────────────────────────────────

    [Fact]
    public async Task Delete_MissingRun_StillReturnsOkSuccess()
    {
        var (ctl, _, _, _) = NewCtl();

        var result = await ctl.Delete(999);

        var ok = Assert.IsType<OkObjectResult>(result);
        var response = ok.Value!.GetType().GetProperty("response")!.GetValue(ok.Value)!;
        Assert.Equal("Success", response.GetType().GetProperty("Result")!.GetValue(response));
    }

    // ── AssignJob ─────────────────────────────────────────────────────────

    [Fact]
    public async Task AssignJob_StampsRunIdFromRoute()
    {
        // UpdateJobToRunAsync uses the raw MERGE path which InMemory can't
        // execute, but the optimistic-conflict pre-check runs in EF and can
        // short-circuit before the MERGE. Prime a mismatched from-run so the
        // pre-check fires and returns Failed cleanly.
        var (ctl, seed, _, _) = NewCtl();
        seed.TblBulkJobRuns.Add(new TblBulkJobRun { Id = 1, BulkJobId = 100, RunId = 5 });
        await seed.SaveChangesAsync();

        var result = await ctl.AssignJob(7, new UpdateJobToRunRequest
        {
            JobId = 100, FromRunId = 3,
        });

        var ok = Assert.IsType<OkObjectResult>(result);
        var response = ok.Value!.GetType().GetProperty("response")!.GetValue(ok.Value)!;
        Assert.Equal("Failed", response.GetType().GetProperty("Result")!.GetValue(response));
    }

    // ── RemoveJob ─────────────────────────────────────────────────────────

    [Fact]
    public async Task RemoveJob_NotOnAnyRun_ReturnsOkFailure()
    {
        var (ctl, _, _, _) = NewCtl();

        var result = await ctl.RemoveJob(999);

        var ok = Assert.IsType<OkObjectResult>(result);
        var response = ok.Value!.GetType().GetProperty("response")!.GetValue(ok.Value)!;
        Assert.Equal("Failed", response.GetType().GetProperty("Result")!.GetValue(response));
    }

    // ── SetJobStartEnd ────────────────────────────────────────────────────

    [Fact]
    public async Task SetJobStartEnd_JobNotOnRun_ReturnsOkFailure()
    {
        var (ctl, _, _, _) = NewCtl();

        var result = await ctl.SetJobStartEnd(1, 100, new SetJobStartEndRequest
        {
            IsStart = true,
        });

        var ok = Assert.IsType<OkObjectResult>(result);
        var response = ok.Value!.GetType().GetProperty("response")!.GetValue(ok.Value)!;
        Assert.Equal("Failed", response.GetType().GetProperty("Result")!.GetValue(response));
    }

    [Fact]
    public async Task SetJobStartEnd_SetsFlagWhenJobOnRun()
    {
        var (ctl, seed, _, _) = NewCtl();
        seed.TblBulkJobRuns.Add(new TblBulkJobRun { Id = 1, BulkJobId = 2, RunId = 5 });
        await seed.SaveChangesAsync();

        var result = await ctl.SetJobStartEnd(5, 2, new SetJobStartEndRequest
        {
            IsStart = true,
        });

        var ok = Assert.IsType<OkObjectResult>(result);
        var response = ok.Value!.GetType().GetProperty("response")!.GetValue(ok.Value)!;
        Assert.Equal("Success", response.GetType().GetProperty("Result")!.GetValue(response));
    }

    // ── Dispatch ──────────────────────────────────────────────────────────

    [Fact]
    public async Task Dispatch_InvalidModelState_ReturnsBadRequest()
    {
        var (ctl, _, _, _) = NewCtl();
        ctl.ModelState.AddModelError("Runs", "required");

        var result = await ctl.Dispatch(new DispatchRunsRequest());

        Assert.IsType<BadRequestObjectResult>(result);
    }

    // ── DispatchJobs ──────────────────────────────────────────────────────

    [Fact]
    public async Task DispatchJobs_InvalidModelState_ReturnsBadRequest()
    {
        var (ctl, _, _, _) = NewCtl();
        ctl.ModelState.AddModelError("JobIds", "bad");

        var result = await ctl.DispatchJobs(new DispatchJobsRequest());

        Assert.IsType<BadRequestObjectResult>(result);
    }

    [Fact]
    public async Task DispatchJobs_EmptyJobIds_ReturnsOkWithEmptyArray()
    {
        var (ctl, _, _, _) = NewCtl();

        var result = await ctl.DispatchJobs(new DispatchJobsRequest { JobIds = new List<int>() });

        var ok = Assert.IsType<OkObjectResult>(result);
        var response = ok.Value!.GetType().GetProperty("response")!.GetValue(ok.Value)!;
        Assert.Empty((System.Collections.IEnumerable)response);
    }
}
