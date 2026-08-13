// SqlTimeZoneNormalizer probes SERVERPROPERTY('HostPlatform') once per
// app lifetime and caches the answer statically. Tests here cover:
// - Null / whitespace input short-circuits to null (no probe).
// - Windows -> IANA and IANA -> Windows mappings on both host branches.
// - Unknown tz passes through verbatim.
// - Case-insensitivity of the map keys.
//
// The static cache is reset via reflection at the start of each test so the
// probe path can be re-exercised. Probing itself against an InMemory context
// throws because SqlQueryRaw + relational SQL isn't supported by that
// provider; the cache-reset + reflection strategy lets us seed _isLinuxSqlHost
// directly so NormalizeAsync exercises the mapping branches without touching
// the DB.
using System.Reflection;
using Microsoft.EntityFrameworkCore;
using RoutedOperations.Core.Application.Services.RouteViewer;
using RoutedOperations.Core.Domain;

namespace RoutedOperations.Tests.Services.RouteViewer;

public class SqlTimeZoneNormalizerTests
{
    private static void SetCachedHost(bool? value)
    {
        var field = typeof(SqlTimeZoneNormalizer)
            .GetField("_isLinuxSqlHost", BindingFlags.NonPublic | BindingFlags.Static)!;
        field.SetValue(null, value);
    }

    private static SqlTimeZoneNormalizer NewNormalizer()
    {
        var factory = RouteViewerTestHarness.Factory(RouteViewerTestHarness.NewOptions());
        return new SqlTimeZoneNormalizer(factory);
    }

    [Fact]
    public async Task NormalizeAsync_NullInput_ReturnsNull()
    {
        SetCachedHost(false);
        var sut = NewNormalizer();
        Assert.Null(await sut.NormalizeAsync(null));
    }

    [Fact]
    public async Task NormalizeAsync_EmptyInput_ReturnsNull()
    {
        SetCachedHost(false);
        var sut = NewNormalizer();
        Assert.Null(await sut.NormalizeAsync(string.Empty));
    }

    [Fact]
    public async Task NormalizeAsync_WhitespaceInput_ReturnsNull()
    {
        SetCachedHost(false);
        var sut = NewNormalizer();
        Assert.Null(await sut.NormalizeAsync("   "));
    }

    [Fact]
    public async Task NormalizeAsync_WindowsHost_WindowsIdPassesThrough()
    {
        SetCachedHost(false);
        var sut = NewNormalizer();
        Assert.Equal("Pacific Standard Time", await sut.NormalizeAsync("Pacific Standard Time"));
    }

    [Fact]
    public async Task NormalizeAsync_WindowsHost_IanaConvertsToWindows()
    {
        SetCachedHost(false);
        var sut = NewNormalizer();
        Assert.Equal("Pacific Standard Time", await sut.NormalizeAsync("America/Los_Angeles"));
    }

    [Fact]
    public async Task NormalizeAsync_WindowsHost_UnknownPassesThrough()
    {
        SetCachedHost(false);
        var sut = NewNormalizer();
        Assert.Equal("Zulu/Nowhere", await sut.NormalizeAsync("Zulu/Nowhere"));
    }

    [Fact]
    public async Task NormalizeAsync_LinuxHost_IanaPassesThrough()
    {
        SetCachedHost(true);
        var sut = NewNormalizer();
        Assert.Equal("Pacific/Auckland", await sut.NormalizeAsync("Pacific/Auckland"));
    }

    [Fact]
    public async Task NormalizeAsync_LinuxHost_WindowsConvertsToIana()
    {
        SetCachedHost(true);
        var sut = NewNormalizer();
        Assert.Equal("Pacific/Auckland", await sut.NormalizeAsync("New Zealand Standard Time"));
    }

    [Fact]
    public async Task NormalizeAsync_LinuxHost_UnknownPassesThrough()
    {
        SetCachedHost(true);
        var sut = NewNormalizer();
        Assert.Equal("Made/Up", await sut.NormalizeAsync("Made/Up"));
    }

    [Fact]
    public async Task NormalizeAsync_MapKeyLookupIsCaseInsensitive()
    {
        SetCachedHost(true);
        var sut = NewNormalizer();
        Assert.Equal("America/Chicago", await sut.NormalizeAsync("central standard TIME"));
    }

    [Fact]
    public async Task NormalizeAsync_UtcMapsBothDirections_Windows()
    {
        SetCachedHost(false);
        var sut = NewNormalizer();
        Assert.Equal("UTC", await sut.NormalizeAsync("Etc/UTC"));
    }

    [Fact]
    public async Task NormalizeAsync_UtcMapsBothDirections_Linux()
    {
        SetCachedHost(true);
        var sut = NewNormalizer();
        Assert.Equal("Etc/UTC", await sut.NormalizeAsync("UTC"));
    }

    [Fact]
    public async Task NormalizeAsync_CachedHost_DoesNotRequireFactoryCall()
    {
        SetCachedHost(false);
        // Feed a null factory - if the code hits it, the test blows up.
        var factory = Substitute.For<IDbContextFactory<DynamicDespatchDbContext>>();
        var sut = new SqlTimeZoneNormalizer(factory);

        var result = await sut.NormalizeAsync("America/Denver");

        Assert.Equal("Mountain Standard Time", result);
        await factory.DidNotReceive().CreateDbContextAsync(Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task NormalizeAsync_AllWindowsKeysConvertToIana_OnLinuxHost()
    {
        SetCachedHost(true);
        var sut = NewNormalizer();

        Assert.Equal("Pacific/Auckland", await sut.NormalizeAsync("New Zealand Standard Time"));
        Assert.Equal("Australia/Sydney", await sut.NormalizeAsync("AUS Eastern Standard Time"));
        Assert.Equal("America/Los_Angeles", await sut.NormalizeAsync("Pacific Standard Time"));
        Assert.Equal("America/Denver", await sut.NormalizeAsync("Mountain Standard Time"));
        Assert.Equal("America/Chicago", await sut.NormalizeAsync("Central Standard Time"));
        Assert.Equal("America/New_York", await sut.NormalizeAsync("Eastern Standard Time"));
    }
}
