using System.Net;
using RoutedOperations.Core.Application.Dtos.Route;
using RoutedOperations.Core.Application.Services.Routing;
using RoutedOperations.Infrastructure;

namespace RoutedOperations.Tests.Services.Routing;

public class HereMapServiceTests
{
    private static (HereMapService Sut, TestHttpMessageHandler Handler) NewSut(string apiKey = "K")
    {
        var handler = new TestHttpMessageHandler();
        var client = new HttpClient(handler);
        var settings = new AppSettings { HereMapsApiKey = apiKey };
        return (new HereMapService(client, settings), handler);
    }

    [Fact]
    public async Task SequenceAsync_MissingApiKeyThrows()
    {
        var (sut, _) = NewSut(apiKey: string.Empty);

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            sut.SequenceAsync(new HereMapSequenceRequest { RequestData = "&x=y" }));
    }

    [Fact]
    public async Task SequenceAsync_SuccessReturnsDeserializedJson()
    {
        var (sut, handler) = NewSut();
        handler.RespondJson(_ => true, """{"result":"ok"}""");

        var r = await sut.SequenceAsync(new HereMapSequenceRequest { RequestData = "&x=y" });

        Assert.NotNull(r);
    }

    [Fact]
    public async Task SequenceAsync_HttpErrorReturnsNull()
    {
        var (sut, handler) = NewSut();
        handler.Respond(_ => true, new HttpResponseMessage(HttpStatusCode.BadRequest)
        {
            Content = new StringContent("bad"),
        });

        var r = await sut.SequenceAsync(new HereMapSequenceRequest { RequestData = "" });

        Assert.Null(r);
    }

    [Fact]
    public async Task SequenceTypedAsync_NoDestinationsReturnsZeroTotal()
    {
        var (sut, _) = NewSut();
        var req = new HereSequenceRequestTyped
        {
            Start = new HereSequenceStop { Name = "S", Lat = 0, Lng = 0 },
            Destinations = new List<HereSequenceStop>(),
        };

        var r = await sut.SequenceTypedAsync(req);

        Assert.NotNull(r);
        Assert.Equal(0, r!.TotalMinutes);
    }

    [Fact]
    public async Task SequenceTypedAsync_MissingApiKeyThrows()
    {
        var (sut, _) = NewSut(apiKey: string.Empty);
        var req = new HereSequenceRequestTyped
        {
            Start = new HereSequenceStop { Name = "S", Lat = 0, Lng = 0 },
            Destinations = new List<HereSequenceStop> { new() { Name = "A", Lat = 1, Lng = 1 } },
        };

        await Assert.ThrowsAsync<InvalidOperationException>(() => sut.SequenceTypedAsync(req));
    }

    [Fact]
    public async Task SequenceTypedAsync_ParsesResponseAndBuildsOrderedNames()
    {
        var (sut, handler) = NewSut();
        handler.RespondJson(_ => true, """
        {"results":[{
          "time":"600",
          "waypoints":[
            {"id":"start","sequence":0},
            {"id":"destination0","sequence":1},
            {"id":"destination1","sequence":2}
          ],
          "interconnections":[
            {"fromWaypoint":"start","toWaypoint":"destination0","time":180},
            {"fromWaypoint":"destination0","toWaypoint":"destination1","time":420}
          ]
        }]}
        """);
        var req = new HereSequenceRequestTyped
        {
            Start = new HereSequenceStop { Name = "S", Lat = 0, Lng = 0 },
            Destinations = new List<HereSequenceStop>
            {
                new() { Name = "A", Lat = 1, Lng = 1 },
                new() { Name = "B", Lat = 2, Lng = 2 },
            },
        };

        var r = await sut.SequenceTypedAsync(req);

        Assert.NotNull(r);
        Assert.Equal(new[] { "S", "A", "B" }, r!.OrderedNames.ToArray());
        Assert.Equal(10, r.TotalMinutes);
        Assert.Equal(new[] { 0.0, 3.0, 7.0 }, r.LegMinutes.ToArray());
    }

    [Fact]
    public async Task SequenceTypedAsync_ReturnToStartAppendsEndEqualsStart()
    {
        var (sut, handler) = NewSut();
        handler.RespondJson(_ => true, """
        {"results":[{"time":"0","waypoints":[{"id":"start","sequence":0},{"id":"end","sequence":1}],"interconnections":[]}]}
        """);
        var req = new HereSequenceRequestTyped
        {
            Start = new HereSequenceStop { Name = "HQ", Lat = 0, Lng = 0 },
            Destinations = new List<HereSequenceStop> { new() { Name = "A", Lat = 1, Lng = 1 } },
            ReturnToStart = true,
        };

        var r = await sut.SequenceTypedAsync(req);

        Assert.NotNull(r);
        Assert.Contains("HQ", r!.OrderedNames);
        Assert.Contains("end=", handler.Requests[0].RequestUri!.ToString());
    }

    [Fact]
    public async Task SequenceTypedAsync_FinishAtNamePinsAsEnd()
    {
        var (sut, handler) = NewSut();
        handler.RespondJson(_ => true, """
        {"results":[{"time":"0","waypoints":[{"id":"start","sequence":0},{"id":"destination0","sequence":1},{"id":"end","sequence":2}],"interconnections":[]}]}
        """);
        var req = new HereSequenceRequestTyped
        {
            Start = new HereSequenceStop { Name = "S", Lat = 0, Lng = 0 },
            Destinations = new List<HereSequenceStop>
            {
                new() { Name = "A", Lat = 1, Lng = 1 },
                new() { Name = "B", Lat = 2, Lng = 2 },
            },
            FinishAtName = "B",
        };

        var r = await sut.SequenceTypedAsync(req);

        Assert.NotNull(r);
        Assert.Equal("B", r!.OrderedNames.Last());
    }

    [Fact]
    public async Task SequenceTypedAsync_HttpErrorReturnsNull()
    {
        var (sut, handler) = NewSut();
        handler.Respond(_ => true, new HttpResponseMessage(HttpStatusCode.BadRequest)
        {
            Content = new StringContent("bad"),
        });
        var req = new HereSequenceRequestTyped
        {
            Start = new HereSequenceStop { Name = "S", Lat = 0, Lng = 0 },
            Destinations = new List<HereSequenceStop> { new() { Name = "A", Lat = 1, Lng = 1 } },
        };

        var r = await sut.SequenceTypedAsync(req);

        Assert.Null(r);
    }

    [Fact]
    public async Task SequenceTypedAsync_EmptyResultsListReturnsNull()
    {
        var (sut, handler) = NewSut();
        handler.RespondJson(_ => true, """{"results":[]}""");
        var req = new HereSequenceRequestTyped
        {
            Start = new HereSequenceStop { Name = "S", Lat = 0, Lng = 0 },
            Destinations = new List<HereSequenceStop> { new() { Name = "A", Lat = 1, Lng = 1 } },
        };

        var r = await sut.SequenceTypedAsync(req);

        Assert.Null(r);
    }

    [Fact]
    public async Task RoutePolylineAsync_MissingApiKeyThrows()
    {
        var (sut, _) = NewSut(apiKey: string.Empty);

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            sut.RoutePolylineAsync(new List<HereSequenceStop>
            {
                new() { Lat = 0, Lng = 0 },
                new() { Lat = 1, Lng = 1 },
            }));
    }

    [Fact]
    public async Task RoutePolylineAsync_LessThanTwoStopsReturnsNull()
    {
        var (sut, _) = NewSut();

        Assert.Null(await sut.RoutePolylineAsync(new List<HereSequenceStop>()));
        Assert.Null(await sut.RoutePolylineAsync(new List<HereSequenceStop> { new() { Lat = 1, Lng = 1 } }));
        Assert.Null(await sut.RoutePolylineAsync(null!));
    }

    [Fact]
    public async Task RoutePolylineAsync_HttpErrorReturnsNull()
    {
        var (sut, handler) = NewSut();
        handler.Respond(_ => true, new HttpResponseMessage(HttpStatusCode.BadGateway)
        {
            Content = new StringContent("bad"),
        });

        var r = await sut.RoutePolylineAsync(new List<HereSequenceStop>
        {
            new() { Lat = 0, Lng = 0 },
            new() { Lat = 1, Lng = 1 },
        });

        Assert.Null(r);
    }

    [Fact]
    public async Task RoutePolylineAsync_NoSectionsReturnsNull()
    {
        var (sut, handler) = NewSut();
        handler.RespondJson(_ => true, """{"routes":[{"sections":[]}]}""");

        var r = await sut.RoutePolylineAsync(new List<HereSequenceStop>
        {
            new() { Lat = 0, Lng = 0 },
            new() { Lat = 1, Lng = 1 },
        });

        Assert.Null(r);
    }

    [Fact]
    public async Task RoutePolylineAsync_ValidPolylineDecodes()
    {
        var (sut, handler) = NewSut();
        // Known-good flexible-polyline for (52.5199,13.4110)+(52.5326,13.3762)+(52.5219,13.4132).
        // Encoded example from the HERE reference doc.
        var encoded = "BFoz5xJ67i1B1B7PzIhaxL7Y";
        handler.RespondJson(_ => true,
            $$"""{"routes":[{"sections":[{"polyline":"{{encoded}}"}]}]}""");

        var r = await sut.RoutePolylineAsync(new List<HereSequenceStop>
        {
            new() { Lat = 52.5, Lng = 13.4 },
            new() { Lat = 52.5, Lng = 13.5 },
        });

        Assert.NotNull(r);
        Assert.NotEmpty(r!);
    }

    [Fact]
    public async Task RoutePolylineAsync_EmptyPolylineStringReturnsNull()
    {
        var (sut, handler) = NewSut();
        handler.RespondJson(_ => true, """{"routes":[{"sections":[{"polyline":""}]}]}""");

        var r = await sut.RoutePolylineAsync(new List<HereSequenceStop>
        {
            new() { Lat = 0, Lng = 0 },
            new() { Lat = 1, Lng = 1 },
        });

        // No decoded points -> total points 0 -> null
        Assert.Null(r);
    }
}
