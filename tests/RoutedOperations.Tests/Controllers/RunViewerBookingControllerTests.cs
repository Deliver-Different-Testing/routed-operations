// Covers RunViewerBookingController: 2 endpoints. NwShipBookingService is
// a concrete non-virtual class taking HttpClient + logger, so we back it
// with a captured-request HttpMessageHandler subclass (same approach as
// NwShipBookingServiceTests). The controller wraps the service in a
// try/catch that maps InvalidOperationException (missing env vars) to a
// 501 and inspects the NWShip response envelope for null (-> 502) /
// errors[] (-> 400). We focus on:
//   * Missing env var (WebAPIUrl / NWSHIP_API_TOKEN) surfaces as 501
//   * Missing top-up env var surfaces as 501 on the top-up endpoint
//   * Null NWShip response body maps to 502
//   * NWShip errors[] payload maps to 400 with the errors relayed
//   * Successful response passes through as Ok with the response envelope
// Happy-path NWShip transport wiring detail is covered exhaustively in
// NwShipBookingServiceTests; this file is the controller-level slice.
using System.Net;
using System.Text;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging.Abstractions;
using RoutedOperations.API.Controllers;
using RoutedOperations.Core.Application.Services.RouteViewer;

namespace RoutedOperations.Tests.Controllers;

public class RunViewerBookingControllerTests : IDisposable
{
    public RunViewerBookingControllerTests()
    {
        Environment.SetEnvironmentVariable("WebAPIUrl", "https://nwship.example.com");
        Environment.SetEnvironmentVariable("NWSHIP_API_TOKEN", "token-xyz");
        Environment.SetEnvironmentVariable("TopUpClientID", "111");
        Environment.SetEnvironmentVariable("ReDelClientID", "999");
    }

    public void Dispose()
    {
        Environment.SetEnvironmentVariable("WebAPIUrl", null);
        Environment.SetEnvironmentVariable("NWSHIP_API_TOKEN", null);
        Environment.SetEnvironmentVariable("TopUpClientID", null);
        Environment.SetEnvironmentVariable("ReDelClientID", null);
        GC.SuppressFinalize(this);
    }

    private sealed class StubHandler : HttpMessageHandler
    {
        public HttpResponseMessage Response { get; set; } = new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent("{}", Encoding.UTF8, "application/json"),
        };

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
            => Task.FromResult(Response);
    }

    private static (RunViewerBookingController controller, StubHandler handler) NewCtl(string? responseJson = null,
        HttpStatusCode status = HttpStatusCode.OK)
    {
        var handler = new StubHandler();
        if (responseJson != null)
        {
            handler.Response = new HttpResponseMessage(status)
            {
                Content = new StringContent(responseJson, Encoding.UTF8, "application/json"),
            };
        }
        var client = new HttpClient(handler);
        var svc = new NwShipBookingService(client, NullLogger<NwShipBookingService>.Instance);
        var controller = new RunViewerBookingController(svc);
        ControllerTestHarness.AttachHttpContext(controller, method: "POST", path: "/api/runviewer/booking/one-off");
        return (controller, handler);
    }

    // -- BookOneOff -----------------------------------------------------

    [Fact]
    public async Task BookOneOff_MissingWebApiUrl_Returns501()
    {
        Environment.SetEnvironmentVariable("WebAPIUrl", null);
        var (ctl, _) = NewCtl();

        var result = await ctl.BookOneOff(new NwShipRequest());

        var r = Assert.IsType<ObjectResult>(result);
        Assert.Equal(501, r.StatusCode);
    }

    [Fact]
    public async Task BookOneOff_MissingToken_Returns501()
    {
        Environment.SetEnvironmentVariable("NWSHIP_API_TOKEN", null);
        var (ctl, _) = NewCtl();

        var result = await ctl.BookOneOff(new NwShipRequest());

        var r = Assert.IsType<ObjectResult>(result);
        Assert.Equal(501, r.StatusCode);
    }

    [Fact]
    public async Task BookOneOff_TransportFailure_Returns502()
    {
        // Non-200 status -> NwShipBookingService returns null -> controller 502.
        var (ctl, _) = NewCtl(responseJson: "bad", status: HttpStatusCode.BadGateway);

        var result = await ctl.BookOneOff(new NwShipRequest());

        var r = Assert.IsType<ObjectResult>(result);
        Assert.Equal(502, r.StatusCode);
    }

    [Fact]
    public async Task BookOneOff_ErrorsInResponse_ReturnsBadRequest()
    {
        var (ctl, _) = NewCtl(responseJson:
            "{\"jobID\":0,\"errors\":[{\"property\":\"Delivery.Suburb\",\"message\":\"required\"}]}");

        var result = await ctl.BookOneOff(new NwShipRequest());

        Assert.IsType<BadRequestObjectResult>(result);
    }

    [Fact]
    public async Task BookOneOff_HappyPath_ReturnsOkWithEnvelope()
    {
        var (ctl, _) = NewCtl(responseJson: "{\"jobID\":42,\"jobNumber\":\"NW-42\"}");

        var result = await ctl.BookOneOff(new NwShipRequest());

        var ok = Assert.IsType<OkObjectResult>(result);
        var payload = ControllerTestHarness.ExtractResponse(ok);
        var resp = Assert.IsType<NwShipResponse>(payload);
        Assert.Equal(42, resp.JobID);
        Assert.Equal("NW-42", resp.JobNumber);
    }

    // -- BookTopUp ------------------------------------------------------

    [Fact]
    public async Task BookTopUp_MissingTopUpClientId_Returns501()
    {
        Environment.SetEnvironmentVariable("TopUpClientID", null);
        var (ctl, _) = NewCtl();

        var result = await ctl.BookTopUp(new NwShipRequest { PackageMap = 1 });

        var r = Assert.IsType<ObjectResult>(result);
        Assert.Equal(501, r.StatusCode);
    }

    [Fact]
    public async Task BookTopUp_HappyPath_ReturnsOkWithEnvelope()
    {
        var (ctl, _) = NewCtl(responseJson: "{\"jobID\":7,\"jobNumber\":\"NW-7\"}");

        var result = await ctl.BookTopUp(new NwShipRequest { PackageMap = 1 });

        var ok = Assert.IsType<OkObjectResult>(result);
        var payload = ControllerTestHarness.ExtractResponse(ok);
        var resp = Assert.IsType<NwShipResponse>(payload);
        Assert.Equal(7, resp.JobID);
    }
}
