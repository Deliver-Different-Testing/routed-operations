using System.Net;
using RoutedOperations.Core.Application.Services.Routing;
using RoutedOperations.Infrastructure;

namespace RoutedOperations.Tests.Services.Routing;

public class HereGeocodeServiceTests
{
    private static (HereGeocodeService Sut, TestHttpMessageHandler Handler) NewSut(string apiKey = "K")
    {
        var handler = new TestHttpMessageHandler();
        var client = new HttpClient(handler);
        var settings = new AppSettings { HereMapsApiKey = apiKey };
        return (new HereGeocodeService(client, settings), handler);
    }

    [Fact]
    public async Task GeocodeAsync_EmptyAddressReturnsNull()
    {
        var (sut, _) = NewSut();

        Assert.Null(await sut.GeocodeAsync(string.Empty));
        Assert.Null(await sut.GeocodeAsync("   "));
    }

    [Fact]
    public async Task GeocodeAsync_MissingApiKeyReturnsNull()
    {
        var (sut, _) = NewSut(apiKey: string.Empty);

        var r = await sut.GeocodeAsync("100 Queen Street");

        Assert.Null(r);
    }

    [Fact]
    public async Task GeocodeAsync_SuccessMapsFields()
    {
        var (sut, handler) = NewSut();
        handler.RespondJson(_ => true, """
        {"items":[{
            "position":{"lat":-36.85,"lng":174.76},
            "address":{"label":"100 Queen St","city":"Auckland","district":"CBD","postalCode":"1010","countryCode":"NZL"}
        }]}
        """);

        var r = await sut.GeocodeAsync("100 Queen Street");

        Assert.NotNull(r);
        Assert.Equal(-36.85, r!.Lat);
        Assert.Equal(174.76, r.Lng);
        Assert.Equal("100 Queen St", r.FormattedAddress);
        Assert.Equal("CBD", r.Suburb);
        Assert.Equal("1010", r.PostCode);
        Assert.Equal("NZL", r.CountryCode);
    }

    [Fact]
    public async Task GeocodeAsync_FallsBackToCityWhenNoDistrict()
    {
        var (sut, handler) = NewSut();
        handler.RespondJson(_ => true, """
        {"items":[{
            "position":{"lat":1,"lng":2},
            "address":{"label":"x","city":"CityFallback","postalCode":"9999","countryCode":"USA"}
        }]}
        """);

        var r = await sut.GeocodeAsync("x");

        Assert.Equal("CityFallback", r!.Suburb);
    }

    [Fact]
    public async Task GeocodeAsync_CountryCodeIsAppendedToUrl()
    {
        var (sut, handler) = NewSut();
        handler.RespondJson(_ => true, """{"items":[]}""");

        var _ = await sut.GeocodeAsync("addr", "USA");

        Assert.Contains("in=countryCode", handler.Requests[0].RequestUri!.ToString());
        Assert.Contains("USA", handler.Requests[0].RequestUri!.ToString());
    }

    [Fact]
    public async Task GeocodeAsync_NoItemsReturnsNull()
    {
        var (sut, handler) = NewSut();
        handler.RespondJson(_ => true, """{"items":[]}""");

        var r = await sut.GeocodeAsync("nowhere");

        Assert.Null(r);
    }

    [Fact]
    public async Task GeocodeAsync_HttpErrorReturnsNull()
    {
        var (sut, handler) = NewSut();
        handler.Respond(_ => true, new HttpResponseMessage(HttpStatusCode.BadGateway)
        {
            Content = new StringContent("upstream error"),
        });

        var r = await sut.GeocodeAsync("x");

        Assert.Null(r);
    }

    [Fact]
    public async Task GeocodeAsync_ExceptionReturnsNull()
    {
        var handler = new TestHttpMessageHandler();
        handler.Respond(_ => true, _ => throw new HttpRequestException("boom"));
        var client = new HttpClient(handler);
        var sut = new HereGeocodeService(client, new AppSettings { HereMapsApiKey = "K" });

        var r = await sut.GeocodeAsync("x");

        Assert.Null(r);
    }

    [Fact]
    public async Task ReverseGeocodeAsync_MissingApiKeyReturnsNull()
    {
        var (sut, _) = NewSut(apiKey: string.Empty);

        var r = await sut.ReverseGeocodeAsync(1, 2);

        Assert.Null(r);
    }

    [Fact]
    public async Task ReverseGeocodeAsync_MapsResponse()
    {
        var (sut, handler) = NewSut();
        handler.RespondJson(_ => true, """
        {"items":[{
            "position":{"lat":1.5,"lng":2.5},
            "address":{"label":"reverse addr","postalCode":"12345"}
        }]}
        """);

        var r = await sut.ReverseGeocodeAsync(1.5, 2.5, "USA");

        Assert.NotNull(r);
        Assert.Equal(1.5, r!.Lat);
        Assert.Equal("12345", r.PostCode);
    }

    [Fact]
    public async Task ReverseGeocodeAsync_NoItemsReturnsNull()
    {
        var (sut, handler) = NewSut();
        handler.RespondJson(_ => true, """{"items":[]}""");

        var r = await sut.ReverseGeocodeAsync(0, 0);

        Assert.Null(r);
    }

    [Fact]
    public async Task ReverseGeocodeAsync_HttpErrorReturnsNull()
    {
        var (sut, handler) = NewSut();
        handler.Respond(_ => true, new HttpResponseMessage(HttpStatusCode.InternalServerError)
        {
            Content = new StringContent("bad"),
        });

        var r = await sut.ReverseGeocodeAsync(1, 2);

        Assert.Null(r);
    }

    [Fact]
    public async Task ReverseGeocodeAsync_ExceptionReturnsNull()
    {
        var handler = new TestHttpMessageHandler();
        handler.Respond(_ => true, _ => throw new HttpRequestException("timeout"));
        var client = new HttpClient(handler);
        var sut = new HereGeocodeService(client, new AppSettings { HereMapsApiKey = "K" });

        var r = await sut.ReverseGeocodeAsync(1, 2);

        Assert.Null(r);
    }

    [Fact]
    public void HereGeocodeResult_PostCodeIntStripsZipPlus4()
    {
        var r = new HereGeocodeResult { PostCode = "02138-4137" };
        Assert.Equal(2138, r.PostCodeInt);
    }

    [Fact]
    public void HereGeocodeResult_PostCodeIntReturnsNullForNoDigits()
    {
        var r = new HereGeocodeResult { PostCode = "abc" };
        Assert.Null(r.PostCodeInt);
    }

    [Fact]
    public void HereGeocodeResult_PostCodeIntReturnsNullForEmpty()
    {
        var r = new HereGeocodeResult { PostCode = null };
        Assert.Null(r.PostCodeInt);
    }
}
