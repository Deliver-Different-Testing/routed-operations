// NwShipBookingService POSTs to /jobs and /jobs/topUp on the NWShip HTTP
// endpoint. Tests use a TestHttpMessageHandler subclass of HttpMessageHandler
// that captures the outbound HttpRequestMessage and returns a canned
// HttpResponseMessage so no real HTTP traffic occurs. Env vars WebAPIUrl,
// NWSHIP_API_TOKEN, TopUpClientID / TopUp2ClientID / TopUp3ClientID are set
// per test and cleared in Dispose.
using System.Net;
using System.Net.Http.Json;
using System.Text;
using Microsoft.Extensions.Logging.Abstractions;
using RoutedOperations.Core.Application.Services.RouteViewer;

namespace RoutedOperations.Tests.Services.RouteViewer;

public class NwShipBookingServiceTests : IDisposable
{
    public NwShipBookingServiceTests()
    {
        Environment.SetEnvironmentVariable("WebAPIUrl", "https://nwship.example.com");
        Environment.SetEnvironmentVariable("NWSHIP_API_TOKEN", "token-xyz");
        Environment.SetEnvironmentVariable("TopUpClientID", "111");
        Environment.SetEnvironmentVariable("TopUp2ClientID", "222");
        Environment.SetEnvironmentVariable("TopUp3ClientID", "333");
    }

    public void Dispose()
    {
        Environment.SetEnvironmentVariable("WebAPIUrl", null);
        Environment.SetEnvironmentVariable("NWSHIP_API_TOKEN", null);
        Environment.SetEnvironmentVariable("TopUpClientID", null);
        Environment.SetEnvironmentVariable("TopUp2ClientID", null);
        Environment.SetEnvironmentVariable("TopUp3ClientID", null);
        GC.SuppressFinalize(this);
    }

    private sealed class TestHttpMessageHandler : HttpMessageHandler
    {
        public HttpRequestMessage? LastRequest;
        public string? LastBody;
        public HttpResponseMessage Response { get; set; } = new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent("{}", Encoding.UTF8, "application/json"),
        };
        public Exception? Throw { get; set; }

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            LastRequest = request;
            if (request.Content != null)
            {
                LastBody = await request.Content.ReadAsStringAsync(cancellationToken);
            }
            if (Throw != null) throw Throw;
            return Response;
        }
    }

    private static (NwShipBookingService sut, TestHttpMessageHandler handler) NewSut()
    {
        var handler = new TestHttpMessageHandler();
        var client = new HttpClient(handler);
        var sut = new NwShipBookingService(client, NullLogger<NwShipBookingService>.Instance);
        return (sut, handler);
    }

    [Fact]
    public async Task BookOneOffAsync_HappyPath_ReturnsDeserializedResponse()
    {
        var (sut, handler) = NewSut();
        handler.Response = new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent("{\"jobID\":42,\"jobNumber\":\"NW-42\"}", Encoding.UTF8, "application/json"),
        };

        var result = await sut.BookOneOffAsync(new NwShipRequest { ContactId = 5 });

        Assert.NotNull(result);
        Assert.Equal(42, result!.JobID);
        Assert.Equal("NW-42", result.JobNumber);
    }

    [Fact]
    public async Task BookOneOffAsync_PostsToJobsPath()
    {
        var (sut, handler) = NewSut();

        await sut.BookOneOffAsync(new NwShipRequest());

        Assert.NotNull(handler.LastRequest);
        Assert.Equal(HttpMethod.Post, handler.LastRequest!.Method);
        Assert.Equal("https://nwship.example.com/jobs", handler.LastRequest.RequestUri!.ToString());
    }

    [Fact]
    public async Task BookOneOffAsync_SendsBearerToken()
    {
        var (sut, handler) = NewSut();
        await sut.BookOneOffAsync(new NwShipRequest());
        Assert.Equal("Bearer", handler.LastRequest!.Headers.Authorization!.Scheme);
        Assert.Equal("token-xyz", handler.LastRequest.Headers.Authorization.Parameter);
    }

    [Fact]
    public async Task BookOneOffAsync_OverrideClientIdIsApplied()
    {
        var (sut, handler) = NewSut();
        var req = new NwShipRequest { ContactId = 1 };

        await sut.BookOneOffAsync(req, overrideClientId: 999);

        Assert.Contains("\"contactId\":999", handler.LastBody);
    }

    [Fact]
    public async Task BookOneOffAsync_HttpFailure_ReturnsNull()
    {
        var (sut, handler) = NewSut();
        handler.Response = new HttpResponseMessage(HttpStatusCode.BadRequest)
        {
            Content = new StringContent("bad", Encoding.UTF8, "text/plain"),
        };
        var result = await sut.BookOneOffAsync(new NwShipRequest());
        Assert.Null(result);
    }

    [Fact]
    public async Task BookOneOffAsync_TransportException_ReturnsNull()
    {
        var (sut, handler) = NewSut();
        handler.Throw = new HttpRequestException("boom");
        var result = await sut.BookOneOffAsync(new NwShipRequest());
        Assert.Null(result);
    }

    [Fact]
    public async Task BookOneOffAsync_MissingWebApiUrl_Throws()
    {
        Environment.SetEnvironmentVariable("WebAPIUrl", null);
        var (sut, _) = NewSut();

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            sut.BookOneOffAsync(new NwShipRequest()));
    }

    [Fact]
    public async Task BookOneOffAsync_MissingToken_Throws()
    {
        Environment.SetEnvironmentVariable("NWSHIP_API_TOKEN", null);
        var (sut, _) = NewSut();

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            sut.BookOneOffAsync(new NwShipRequest()));
    }

    [Fact]
    public async Task BookOneOffAsync_TrailingSlashInBaseUrl_IsTrimmed()
    {
        Environment.SetEnvironmentVariable("WebAPIUrl", "https://nwship.example.com/");
        var (sut, handler) = NewSut();
        await sut.BookOneOffAsync(new NwShipRequest());
        Assert.Equal("https://nwship.example.com/jobs", handler.LastRequest!.RequestUri!.ToString());
    }

    [Fact]
    public async Task BookTopUpAsync_PackageMap2_UsesTopUp2ClientID()
    {
        var (sut, handler) = NewSut();
        await sut.BookTopUpAsync(new NwShipRequest { PackageMap = 2 });
        Assert.Contains("\"contactId\":222", handler.LastBody);
        Assert.EndsWith("/jobs/topUp", handler.LastRequest!.RequestUri!.ToString());
    }

    [Fact]
    public async Task BookTopUpAsync_PackageMap3_UsesTopUp3ClientID()
    {
        var (sut, handler) = NewSut();
        await sut.BookTopUpAsync(new NwShipRequest { PackageMap = 3 });
        Assert.Contains("\"contactId\":333", handler.LastBody);
    }

    [Fact]
    public async Task BookTopUpAsync_PackageMap1_UsesTopUpClientID()
    {
        var (sut, handler) = NewSut();
        await sut.BookTopUpAsync(new NwShipRequest { PackageMap = 1 });
        Assert.Contains("\"contactId\":111", handler.LastBody);
    }

    [Fact]
    public async Task BookTopUpAsync_PackageMapZero_FallsBackToTopUpClientID()
    {
        var (sut, handler) = NewSut();
        await sut.BookTopUpAsync(new NwShipRequest { PackageMap = 0 });
        Assert.Contains("\"contactId\":111", handler.LastBody);
    }

    [Fact]
    public async Task BookTopUpAsync_UnknownPackageMap_FallsBackToTopUpClientID()
    {
        var (sut, handler) = NewSut();
        await sut.BookTopUpAsync(new NwShipRequest { PackageMap = 99 });
        Assert.Contains("\"contactId\":111", handler.LastBody);
    }

    [Fact]
    public async Task BookTopUpAsync_MissingEnvVar_Throws()
    {
        Environment.SetEnvironmentVariable("TopUpClientID", null);
        var (sut, _) = NewSut();
        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            sut.BookTopUpAsync(new NwShipRequest { PackageMap = 1 }));
    }

    [Fact]
    public async Task BookTopUpAsync_MalformedEnvVar_Throws()
    {
        Environment.SetEnvironmentVariable("TopUpClientID", "not-a-number");
        var (sut, _) = NewSut();
        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            sut.BookTopUpAsync(new NwShipRequest { PackageMap = 1 }));
    }

    [Fact]
    public async Task BookTopUpAsync_HappyPath_ReturnsResponse()
    {
        var (sut, handler) = NewSut();
        handler.Response = new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent("{\"jobID\":7}", Encoding.UTF8, "application/json"),
        };
        var result = await sut.BookTopUpAsync(new NwShipRequest { PackageMap = 1 });
        Assert.NotNull(result);
        Assert.Equal(7, result!.JobID);
    }

    [Fact]
    public void NwShipResponse_DefaultsAreSensible()
    {
        var resp = new NwShipResponse();
        Assert.Equal(0, resp.JobID);
        Assert.Null(resp.JobNumber);
        Assert.Null(resp.Errors);
    }

    [Fact]
    public void NwShipRequest_SourceIdDefaultsToEight()
    {
        var req = new NwShipRequest();
        Assert.Equal(8, req.SourceId);
    }
}
