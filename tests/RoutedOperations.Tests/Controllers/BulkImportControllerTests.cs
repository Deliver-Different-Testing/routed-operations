using System.Net.Http;
using System.Text;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;
using RoutedOperations.API.Controllers;
using RoutedOperations.Core.Application.Dtos.BulkImport.Bulk;
using RoutedOperations.Core.Application.Dtos.BulkImport.Common;
using RoutedOperations.Core.Application.Services.BulkImport;
using RoutedOperations.Core.Application.Services.Routing;
using RoutedOperations.Infrastructure;

namespace RoutedOperations.Tests.Controllers;

// Covers BulkImportController. All endpoints gated by [Authorize(RouteBuilder.Admin)]
// (declarative, not exercised). The controller uses a bespoke HandleBulkResponse
// with the sibling Dtos.BulkImport.Common.BaseResponse (not the shared one used
// by BaseController.HandleResponse). Focus of these tests:
//   - Success paths return 200 with a well-typed response body.
//   - ModelState invalid short-circuits produce 400 via HandleBulkInvalidModelState.
//   - StaffImport enforces the "Internal claim required" gate ahead of the service call.
//   - Upload rejects missing / unsupported files with 400 "Invalid file.".
public class BulkImportControllerTests
{
    private static (BulkImportController ctl, BulkImportServiceV2 svc) NewCtl(
        string? countryCode = null,
        string? internalClaim = null)
    {
        var opts = ControllerTestHarness.NewOptions();
        var accessor = ControllerTestHarness.Accessor(countryCode: countryCode, internalClaim: internalClaim, contactId: "3");
        var cache = ControllerTestHarness.Cache(accessor);
        var here = new HereGeocodeService(new HttpClient(), new AppSettings());
        var addressService = new AddressService(ControllerTestHarness.Factory(opts), accessor, here, cache);
        var httpClientFactory = Substitute.For<IHttpClientFactory>();
        httpClientFactory.CreateClient(Arg.Any<string>()).Returns(_ => new HttpClient());
        var svc = new BulkImportServiceV2(ControllerTestHarness.Factory(opts), httpClientFactory, accessor, addressService);
        var logger = Substitute.For<ILogger<BulkImportController>>();
        var ctl = new BulkImportController(svc, logger);
        ControllerTestHarness.AttachHttpContext(ctl,
            contactId: "3", countryCode: countryCode, internalClaim: internalClaim);
        return (ctl, svc);
    }

    // ── GET /jobs ──────────────────────────────────────────────────────────

    [Fact]
    public async Task GetBulkJobs_EmptyDb_ReturnsOkBulkJobsResponse()
    {
        var (ctl, _) = NewCtl();
        var ok = Assert.IsType<OkObjectResult>(await ctl.GetBulkJobs());
        var resp = Assert.IsType<BulkJobsResponse>(ok.Value!);
        Assert.True(resp.Success);
    }

    // ── POST /upload ──────────────────────────────────────────────────────

    [Fact]
    public async Task UploadFile_NullFile_ReturnsBadRequestInvalidFile()
    {
        var (ctl, _) = NewCtl();
        var bad = Assert.IsType<BadRequestObjectResult>(await ctl.UploadFile(null!));
        Assert.Equal("Invalid file.", bad.Value);
    }

    [Fact]
    public async Task UploadFile_UnsupportedExtension_ReturnsBadRequest()
    {
        var (ctl, _) = NewCtl();
        var file = Substitute.For<IFormFile>();
        file.FileName.Returns("readme.txt");
        file.OpenReadStream().Returns(_ => new MemoryStream(Encoding.UTF8.GetBytes("hi")));
        Assert.IsType<BadRequestObjectResult>(await ctl.UploadFile(file));
    }

    [Fact]
    public async Task UploadFile_MissingExtension_ReturnsBadRequest()
    {
        var (ctl, _) = NewCtl();
        var file = Substitute.For<IFormFile>();
        file.FileName.Returns("noext");
        file.OpenReadStream().Returns(_ => new MemoryStream());
        Assert.IsType<BadRequestObjectResult>(await ctl.UploadFile(file));
    }

    // ── POST /import ──────────────────────────────────────────────────────

    [Fact]
    public async Task Import_InvalidModelState_ReturnsBadRequest()
    {
        var (ctl, _) = NewCtl();
        ctl.ModelState.AddModelError("ClientId", "required");
        var req = new BulkImportRequest { ClientId = 0, SpeedId = 1, BookDate = DateTime.UtcNow };
        Assert.IsType<BadRequestObjectResult>(await ctl.Import(req));
    }

    // ── POST /staff-import ────────────────────────────────────────────────

    [Fact]
    public async Task StaffImport_NonInternalCaller_Returns403WithBaseResponse()
    {
        // No "Internal" claim => the auth gate returns 403 before the
        // service is called (spec: only internal staff can direct-insert).
        var (ctl, _) = NewCtl(countryCode: "NZ", internalClaim: null);
        var req = new StaffImportRequest();
        var result = await ctl.StaffImport(req);
        var status = Assert.IsType<ObjectResult>(result);
        Assert.Equal(StatusCodes.Status403Forbidden, status.StatusCode);
        var body = Assert.IsType<BaseResponse>(status.Value!);
        Assert.Single(body.Messages);
    }

    [Fact]
    public async Task StaffImport_InvalidModelState_ReturnsBadRequestFirst()
    {
        var (ctl, _) = NewCtl(internalClaim: "true");
        ctl.ModelState.AddModelError("Jobs", "required");
        var req = new StaffImportRequest();
        Assert.IsType<BadRequestObjectResult>(await ctl.StaffImport(req));
    }

    // ── POST /import-google-drive ─────────────────────────────────────────

    [Fact]
    public async Task ImportFromGoogleDrive_InvalidModelState_ReturnsBadRequest()
    {
        var (ctl, _) = NewCtl();
        ctl.ModelState.AddModelError("FileId", "required");
        var req = new GoogleDriveImportRequest();
        Assert.IsType<BadRequestObjectResult>(await ctl.ImportFromGoogleDrive(req));
    }

    // ── POST /pickup-rate + /book-pickup ──────────────────────────────────

    [Fact]
    public async Task GetPickupRate_InvalidModelState_ReturnsBadRequest()
    {
        var (ctl, _) = NewCtl();
        ctl.ModelState.AddModelError("ClientId", "required");
        var req = new PickupJobRequest();
        Assert.IsType<BadRequestObjectResult>(await ctl.GetPickupRate(req));
    }

    [Fact]
    public async Task BookPickup_InvalidModelState_ReturnsBadRequest()
    {
        var (ctl, _) = NewCtl();
        ctl.ModelState.AddModelError("ClientId", "required");
        var req = new PickupJobRequest();
        Assert.IsType<BadRequestObjectResult>(await ctl.BookPickup(req));
    }

    // ── DELETE /jobs/{id} + /tuc-jobs/{id} ────────────────────────────────

    [Fact]
    public async Task DeleteBulkJob_InvalidModelState_ReturnsBadRequest()
    {
        var (ctl, _) = NewCtl();
        ctl.ModelState.AddModelError("Id", "required");
        var req = new IdRequest { Id = null };
        Assert.IsType<BadRequestObjectResult>(await ctl.DeleteBulkJob(req));
    }

    [Fact]
    public async Task DeleteTucJob_InvalidModelState_ReturnsBadRequest()
    {
        var (ctl, _) = NewCtl();
        ctl.ModelState.AddModelError("Id", "required");
        var req = new IdRequest { Id = null };
        Assert.IsType<BadRequestObjectResult>(await ctl.DeleteTucJob(req));
    }

    // ── POST /search-for-complete + /bulk-complete ────────────────────────

    [Fact]
    public async Task SearchJobsForBulkComplete_InvalidModelState_ReturnsBadRequest()
    {
        var (ctl, _) = NewCtl();
        ctl.ModelState.AddModelError("JobNumbers", "required");
        var req = new BulkJobSearchRequest();
        Assert.IsType<BadRequestObjectResult>(await ctl.SearchJobsForBulkComplete(req));
    }

    [Fact]
    public async Task BulkCompleteJobs_InvalidModelState_ReturnsBadRequest()
    {
        var (ctl, _) = NewCtl();
        ctl.ModelState.AddModelError("Jobs", "required");
        var req = new BulkJobCompleteRequest();
        Assert.IsType<BadRequestObjectResult>(await ctl.BulkCompleteJobs(req));
    }
}
