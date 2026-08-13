using System.Net;

namespace RoutedOperations.Tests.Services.Routing;

/// <summary>
/// Minimal HttpMessageHandler for typed-HttpClient services.
/// Callers register (predicate, response) pairs; the first matching pair wins.
/// Falls back to 404 when nothing matches.
/// </summary>
internal sealed class TestHttpMessageHandler : HttpMessageHandler
{
    private readonly List<(Func<HttpRequestMessage, bool> Predicate, Func<HttpRequestMessage, HttpResponseMessage> Response)> _rules = new();
    public List<HttpRequestMessage> Requests { get; } = new();

    public TestHttpMessageHandler Respond(Func<HttpRequestMessage, bool> match, HttpResponseMessage response)
    {
        _rules.Add((match, _ => response));
        return this;
    }

    public TestHttpMessageHandler Respond(Func<HttpRequestMessage, bool> match, Func<HttpRequestMessage, HttpResponseMessage> factory)
    {
        _rules.Add((match, factory));
        return this;
    }

    public TestHttpMessageHandler RespondJson(Func<HttpRequestMessage, bool> match, string json,
        HttpStatusCode status = HttpStatusCode.OK)
    {
        _rules.Add((match, _ => new HttpResponseMessage(status)
        {
            Content = new StringContent(json, System.Text.Encoding.UTF8, "application/json"),
        }));
        return this;
    }

    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        Requests.Add(request);
        foreach (var (predicate, factory) in _rules)
        {
            if (predicate(request)) return Task.FromResult(factory(request));
        }
        return Task.FromResult(new HttpResponseMessage(HttpStatusCode.NotFound)
        {
            Content = new StringContent(string.Empty),
        });
    }
}
