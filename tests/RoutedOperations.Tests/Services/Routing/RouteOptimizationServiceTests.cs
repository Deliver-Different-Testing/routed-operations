using System.Net;
using RoutedOperations.Core.Application.Dtos.Route;
using RoutedOperations.Core.Application.Services.Routing;
using RoutedOperations.Infrastructure;

namespace RoutedOperations.Tests.Services.Routing;

public class RouteOptimizationServiceTests
{
    private static (RouteOptimizationService Sut, TestHttpMessageHandler Handler) NewSut(string appId = "id-1")
    {
        var handler = new TestHttpMessageHandler();
        var client = new HttpClient(handler);
        var settings = new AppSettings { RouteSavvyAppId = appId };
        return (new RouteOptimizationService(client, settings), handler);
    }

    [Fact]
    public async Task OptimizeAsync_WithoutAppId_Throws()
    {
        var (sut, _) = NewSut(appId: string.Empty);

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            sut.OptimizeAsync(new List<SavvyLocationDto>()));
    }

    [Fact]
    public async Task OptimizeAsync_SuccessMapsRouteLocationsToLatLng()
    {
        var (sut, handler) = NewSut();
        var body = """
        {"Message":"Success","OptimizedStops":[
          {"Name":"a","Index":0,"RouteLocation":{"Latitude":1.0,"Longitude":2.0}},
          {"Name":"b","Index":1,"RouteLocation":{"Latitude":3.0,"Longitude":4.0}}]}
        """;
        handler.RespondJson(_ => true, body);

        var res = await sut.OptimizeAsync(new List<SavvyLocationDto>
        {
            new() { Name = "a", Latitude = 1, Longitude = 2 }
        });

        Assert.Equal(2, res.Count);
        Assert.Equal(1.0, res[0].Lat);
        Assert.Equal(4.0, res[1].Lng);
    }

    [Fact]
    public async Task OptimizeAsync_NonSuccessMessageReturnsEmpty()
    {
        var (sut, handler) = NewSut();
        handler.RespondJson(_ => true,
            """{"Message":"Failure","OptimizedStops":[]}""");

        var res = await sut.OptimizeAsync(new List<SavvyLocationDto>());

        Assert.Empty(res);
    }

    [Fact]
    public async Task OptimizeAsync_NonSuccessHttpReturnsEmpty()
    {
        var (sut, handler) = NewSut();
        handler.Respond(_ => true, new HttpResponseMessage(HttpStatusCode.InternalServerError)
        {
            Content = new StringContent("boom"),
        });

        var res = await sut.OptimizeAsync(new List<SavvyLocationDto>());

        Assert.Empty(res);
    }

    [Fact]
    public async Task OptimizeAsync_UnparseableBodyReturnsEmpty()
    {
        var (sut, handler) = NewSut();
        handler.RespondJson(_ => true, "not-a-json-object");

        var res = await sut.OptimizeAsync(new List<SavvyLocationDto>());

        Assert.Empty(res);
    }

    [Fact]
    public async Task OptimizeWithNamesAsync_MapsNameThroughToLatLngDto()
    {
        var (sut, handler) = NewSut();
        handler.RespondJson(_ => true, """
        {"Message":"Success","OptimizedStops":[
          {"Name":"pickup","Index":0,"RouteLocation":{"Latitude":10.0,"Longitude":20.0}}]}
        """);

        var res = await sut.OptimizeWithNamesAsync(new List<SavvyLocationDto>());

        Assert.Single(res);
        Assert.Equal("pickup", res[0].Name);
        Assert.Equal(10.0, res[0].Lat);
        Assert.Equal(20.0, res[0].Lng);
    }

    [Fact]
    public async Task OptimizeWithNamesAsync_NonSuccessReturnsEmpty()
    {
        var (sut, handler) = NewSut();
        handler.RespondJson(_ => true, """{"Message":"Failure","OptimizedStops":[]}""");

        var res = await sut.OptimizeWithNamesAsync(new List<SavvyLocationDto>());

        Assert.Empty(res);
    }

    [Fact]
    public async Task OptimizeAsync_PostsWithConfiguredAppId()
    {
        var (sut, handler) = NewSut(appId: "specific-id");
        handler.RespondJson(_ => true, """{"Message":"Success","OptimizedStops":[]}""");

        await sut.OptimizeAsync(new List<SavvyLocationDto>
        {
            new() { Name = "wp", Latitude = 0, Longitude = 0 }
        });

        var req = handler.Requests.Single();
        var body = await req.Content!.ReadAsStringAsync();
        Assert.Contains("specific-id", body);
        Assert.Contains("Locations", body);
    }
}
