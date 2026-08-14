// RouteViewerLabelService HTTP-proxies to the legacy RunViewer label
// endpoints. Tests use a TestHttpMessageHandler to capture the outbound
// request + return canned bytes. Env vars set/unset per test.
using System.Net;
using System.Net.Http.Headers;
using System.Text;
using Microsoft.Extensions.Logging.Abstractions;
using RoutedOperations.Core.Application.Dtos.RouteViewer;
using RoutedOperations.Core.Application.Services.RouteViewer;

namespace RoutedOperations.Tests.Services.RouteViewer;

[Collection("EnvVarMutating")]
public class RouteViewerLabelServiceTests : IDisposable
{
    public RouteViewerLabelServiceTests()
    {
        Environment.SetEnvironmentVariable("RunViewerLabelProxyUrl", "https://legacy.example.com");
        Environment.SetEnvironmentVariable("RunViewerLabelProxyToken", "proxy-token");
    }

    public void Dispose()
    {
        Environment.SetEnvironmentVariable("RunViewerLabelProxyUrl", null);
        Environment.SetEnvironmentVariable("RunViewerLabelProxyToken", null);
        GC.SuppressFinalize(this);
    }

    private sealed class TestHttpMessageHandler : HttpMessageHandler
    {
        public HttpRequestMessage? LastRequest;
        public string? LastBody;
        public HttpResponseMessage Response { get; set; } = new(HttpStatusCode.OK)
        {
            Content = new ByteArrayContent(new byte[] { 1, 2, 3 }),
        };

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            LastRequest = request;
            if (request.Content != null) LastBody = await request.Content.ReadAsStringAsync(cancellationToken);
            return Response;
        }
    }

    private static (RouteViewerLabelService sut, TestHttpMessageHandler handler) NewSut()
    {
        var handler = new TestHttpMessageHandler();
        var client = new HttpClient(handler);
        var sut = new RouteViewerLabelService(client, NullLogger<RouteViewerLabelService>.Instance);
        return (sut, handler);
    }

    [Fact]
    public async Task GetSingleJobLabelAsync_ReturnsBytesFromProxy()
    {
        var (sut, handler) = NewSut();
        handler.Response = new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new ByteArrayContent(new byte[] { 9, 8 }),
        };

        var result = await sut.GetSingleJobLabelAsync(1234);

        Assert.Equal(new byte[] { 9, 8 }, result);
        Assert.Equal("https://legacy.example.com/Home/Labels/Job?jobId=1234", handler.LastRequest!.RequestUri!.ToString());
        Assert.Equal(HttpMethod.Get, handler.LastRequest.Method);
    }

    [Fact]
    public async Task GetSingleJobLabelAsync_AttachesBearerToken()
    {
        var (sut, handler) = NewSut();
        await sut.GetSingleJobLabelAsync(1);
        Assert.Equal("Bearer", handler.LastRequest!.Headers.Authorization!.Scheme);
        Assert.Equal("proxy-token", handler.LastRequest.Headers.Authorization.Parameter);
    }

    [Fact]
    public async Task GetSingleJobLabelAsync_NoProxyToken_NoAuthHeader()
    {
        Environment.SetEnvironmentVariable("RunViewerLabelProxyToken", null);
        var (sut, handler) = NewSut();
        await sut.GetSingleJobLabelAsync(1);
        Assert.Null(handler.LastRequest!.Headers.Authorization);
    }

    [Fact]
    public async Task GetSingleJobLabelAsync_MissingProxyUrl_Throws()
    {
        Environment.SetEnvironmentVariable("RunViewerLabelProxyUrl", null);
        var (sut, _) = NewSut();
        await Assert.ThrowsAsync<InvalidOperationException>(() => sut.GetSingleJobLabelAsync(1));
    }

    [Fact]
    public async Task GetSingleJobLabelAsync_ProxyFailure_ThrowsWithBodyInMessage()
    {
        var (sut, handler) = NewSut();
        handler.Response = new HttpResponseMessage(HttpStatusCode.InternalServerError)
        {
            Content = new StringContent("proxy blew up", Encoding.UTF8, "text/plain"),
        };
        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() => sut.GetSingleJobLabelAsync(1));
        Assert.Contains("500", ex.Message);
    }

    [Fact]
    public async Task GetLhpJobLabelAsync_UsesLhpJobPath()
    {
        var (sut, handler) = NewSut();
        await sut.GetLhpJobLabelAsync(88);
        Assert.EndsWith("/Home/Labels/LhpJob?jobId=88", handler.LastRequest!.RequestUri!.ToString());
    }

    [Fact]
    public async Task GetSingleBulkLabelAsync_UsesBulkJobPath()
    {
        var (sut, handler) = NewSut();
        await sut.GetSingleBulkLabelAsync(77);
        Assert.EndsWith("/Home/Labels/BulkJob?bulkJobId=77", handler.LastRequest!.RequestUri!.ToString());
    }

    [Fact]
    public async Task GetBulkLabelsAsync_PostsJsonBody()
    {
        var (sut, handler) = NewSut();
        var request = new LabelRequest { ClientIds = "1,2", BookDate = new DateTime(2026, 8, 13) };
        await sut.GetBulkLabelsAsync(request);
        Assert.Equal(HttpMethod.Post, handler.LastRequest!.Method);
        Assert.EndsWith("/Home/Labels/BulkJobs", handler.LastRequest.RequestUri!.ToString());
        Assert.NotNull(handler.LastBody);
        Assert.Contains("1,2", handler.LastBody);
    }

    [Fact]
    public async Task GetBulkLabelsAsync_MissingProxyUrl_Throws()
    {
        Environment.SetEnvironmentVariable("RunViewerLabelProxyUrl", null);
        var (sut, _) = NewSut();
        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            sut.GetBulkLabelsAsync(new LabelRequest()));
    }

    [Fact]
    public async Task GetBulkLabelsBySpeedAsync_UsesBySpeedPath()
    {
        var (sut, handler) = NewSut();
        await sut.GetBulkLabelsBySpeedAsync(new LabelRequest());
        Assert.EndsWith("/Home/Labels/BulkJobsBySpeed", handler.LastRequest!.RequestUri!.ToString());
    }

    [Fact]
    public async Task GetLineHaulLabelsAsync_UsesLineHaulPath()
    {
        var (sut, handler) = NewSut();
        await sut.GetLineHaulLabelsAsync(new LabelRequest());
        Assert.EndsWith("/Home/Labels/LineHaulJobs", handler.LastRequest!.RequestUri!.ToString());
    }

    [Fact]
    public async Task GetLineHaulManifestCsvAsync_ReturnsCsvString()
    {
        var (sut, handler) = NewSut();
        handler.Response = new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new ByteArrayContent(Encoding.UTF8.GetBytes("h1,h2\nv1,v2\n")),
        };
        var csv = await sut.GetLineHaulManifestCsvAsync(new LabelRequest { RunName = "R1" });
        Assert.Contains("h1,h2", csv);
        Assert.Contains("runName=R1", handler.LastRequest!.RequestUri!.ToString());
    }

    [Fact]
    public async Task GetLineHaulManifestCsvAsync_IncludesDepotAndDate()
    {
        var (sut, handler) = NewSut();
        var d = new DateTime(2026, 8, 13, 0, 0, 0, DateTimeKind.Utc);
        await sut.GetLineHaulManifestCsvAsync(new LabelRequest { BookDate = d, DepotId = 5, ClientIds = "1", SpeedIds = "9" });
        var uri = handler.LastRequest!.RequestUri!.ToString();
        Assert.Contains("depotId=5", uri);
        Assert.Contains("clientIds=1", uri);
        Assert.Contains("speedIds=9", uri);
        Assert.Contains("runDate=", uri);
    }

    [Fact]
    public async Task GetLineHaulManifestCsvAsync_MissingProxy_Throws()
    {
        Environment.SetEnvironmentVariable("RunViewerLabelProxyUrl", null);
        var (sut, _) = NewSut();
        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            sut.GetLineHaulManifestCsvAsync(new LabelRequest()));
    }

    [Fact]
    public async Task SendPodEmailAsync_TrueOn200()
    {
        var (sut, handler) = NewSut();
        handler.Response = new HttpResponseMessage(HttpStatusCode.OK);
        var ok = await sut.SendPodEmailAsync(42, "test@example.com");
        Assert.True(ok);
    }

    [Fact]
    public async Task SendPodEmailAsync_FalseOnNon200()
    {
        var (sut, handler) = NewSut();
        handler.Response = new HttpResponseMessage(HttpStatusCode.BadGateway)
        {
            Content = new StringContent("nope", Encoding.UTF8, "text/plain"),
        };
        var ok = await sut.SendPodEmailAsync(42, "test@example.com");
        Assert.False(ok);
    }

    [Fact]
    public async Task SendPodEmailAsync_UrlEncodesEmail()
    {
        var (sut, handler) = NewSut();
        await sut.SendPodEmailAsync(1, "user+tag@example.com");
        Assert.Contains("toEmail=user%2Btag%40example.com", handler.LastRequest!.RequestUri!.ToString());
    }

    [Fact]
    public async Task SendPodEmailAsync_MissingProxy_Throws()
    {
        Environment.SetEnvironmentVariable("RunViewerLabelProxyUrl", null);
        var (sut, _) = NewSut();
        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            sut.SendPodEmailAsync(1, "x@y.com"));
    }

    [Fact]
    public async Task GetSingleJobLabelAsync_AcceptHeaderIsPdf()
    {
        var (sut, handler) = NewSut();
        await sut.GetSingleJobLabelAsync(1);
        Assert.Contains(new MediaTypeWithQualityHeaderValue("application/pdf"),
            handler.LastRequest!.Headers.Accept);
    }

    [Fact]
    public async Task GetBulkLabelsAsync_SendsPdfAcceptHeader()
    {
        var (sut, handler) = NewSut();
        await sut.GetBulkLabelsAsync(new LabelRequest());
        Assert.Contains(new MediaTypeWithQualityHeaderValue("application/pdf"),
            handler.LastRequest!.Headers.Accept);
    }
}
