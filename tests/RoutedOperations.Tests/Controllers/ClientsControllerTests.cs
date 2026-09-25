using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;
using RoutedOperations.API.Controllers;
using RoutedOperations.Core.Application.Dtos.BulkImport.Clients;
using RoutedOperations.Core.Application.Services.BulkImport;

namespace RoutedOperations.Tests.Controllers;

// Covers ClientsController. Controller-level [Authorize(RouteBuilder.Admin)]
// is declarative and not exercised. The controller wraps every ClientService
// call in the shared HandleBulkResponse (Success=200/else=400) after logging.
// Empty DB paths return Success=true, so the assertion is on the 200 status +
// response type.
public class ClientsControllerTests
{
    private static ClientsController NewCtl(string? countryCode = null, string? internalClaim = null)
    {
        var opts = ControllerTestHarness.NewOptions();
        var accessor = ControllerTestHarness.Accessor(countryCode: countryCode, internalClaim: internalClaim);
        var cache = ControllerTestHarness.Cache(accessor);
        var svc = new ClientService(ControllerTestHarness.Factory(opts), accessor, cache);
        var logger = Substitute.For<ILogger<ClientsController>>();
        var ctl = new ClientsController(svc, logger);
        // The controller's own claims come from its ControllerContext, so
        // attach a matching claim set (ContactID default = 5 is fine here;
        // empty DB means every scoped read returns Success=true regardless).
        ControllerTestHarness.AttachHttpContext(ctl,
            contactId: "5", countryCode: countryCode, internalClaim: internalClaim);
        return ctl;
    }

    [Fact]
    public async Task Get_EmptyDb_ExternalContact_ReturnsOkWithClientList()
    {
        var ctl = NewCtl();
        var ok = Assert.IsType<OkObjectResult>(await ctl.Get());
        var resp = Assert.IsType<ClientsResponse>(ok.Value!);
        Assert.True(resp.Success);
        Assert.Empty(resp.Clients);
    }

    [Fact]
    public async Task Get_EmptyDb_InternalUser_ReturnsIsInternal()
    {
        var ctl = NewCtl(internalClaim: "true");
        var ok = Assert.IsType<OkObjectResult>(await ctl.Get());
        var resp = Assert.IsType<ClientsResponse>(ok.Value!);
        Assert.True(resp.IsInternal);
    }

    [Fact]
    public async Task Search_EmptyDb_ReturnsOkWithClientList()
    {
        var ctl = NewCtl();
        var ok = Assert.IsType<OkObjectResult>(await ctl.Search("abc"));
        var resp = Assert.IsType<ClientsResponse>(ok.Value!);
        Assert.True(resp.Success);
        Assert.Empty(resp.Clients);
    }

    [Fact]
    public async Task Search_NullQuery_DoesNotThrow()
    {
        // Controller coalesces to string.Empty before delegating.
        var ctl = NewCtl();
        Assert.IsType<OkObjectResult>(await ctl.Search(null!));
    }

    [Fact]
    public async Task GetClientSettings_UnknownClient_ReturnsBadRequestWithErrorEnvelope()
    {
        var ctl = NewCtl();
        var bad = Assert.IsType<BadRequestObjectResult>(await ctl.GetClientSettings(999));
        var resp = Assert.IsType<ClientSettingsResponse>(bad.Value!);
        Assert.False(resp.Success);
        Assert.Contains(resp.Messages, m => m.Message == "Invalid client or contact.");
    }

    [Fact]
    public async Task GetSchedulesByBookDate_InvalidModelState_ReturnsBadRequest()
    {
        var ctl = NewCtl();
        ctl.ModelState.AddModelError("ClientId", "required");
        var req = new SchedulesByBookDateRequest { ClientId = 0, SpeedId = 1, DepotId = 1 };
        Assert.IsType<BadRequestObjectResult>(await ctl.GetSchedulesByBookDate(req));
    }

    [Fact]
    public async Task GetJobNumber_InvokesService_PropagatesInMemoryTransactionLimitation()
    {
        // Coverage for the controller's try/catch/log/rethrow branch: the
        // underlying ClientService.GetJobNumber wraps its read in a Serializable
        // transaction which the InMemory provider does not implement, so the
        // service throws. The controller logs the exception via ILogger and
        // rethrows - verifying the throw is our proxy for the "unhandled
        // exception path" that the outer host would wrap into a 500.
        var ctl = NewCtl();
        var req = new JobNumberRequest { JobNumberId = 1 };
        await Assert.ThrowsAnyAsync<Exception>(() => ctl.GetJobNumber(req));
    }
}
