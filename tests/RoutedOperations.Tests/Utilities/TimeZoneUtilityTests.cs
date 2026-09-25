using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using RoutedOperations.Core.Application.Utilities;

namespace RoutedOperations.Tests.Utilities;

public class TimeZoneUtilityTests
{
    private static IHttpContextAccessor AccessorWith(params Claim[] claims)
    {
        var accessor = Substitute.For<IHttpContextAccessor>();
        var http = new DefaultHttpContext();
        http.User = new ClaimsPrincipal(new ClaimsIdentity(claims));
        accessor.HttpContext.Returns(http);
        return accessor;
    }

    private static IHttpContextAccessor AccessorWithoutContext()
    {
        var accessor = Substitute.For<IHttpContextAccessor>();
        accessor.HttpContext.Returns((HttpContext?)null);
        return accessor;
    }

    // ---- GetTenantNow (accessor overload) ----

    [Fact]
    public void GetTenantNow_WithClaim_ReturnsTenantLocalTime()
    {
        var accessor = AccessorWith(new Claim("TimeZone", "Pacific/Auckland"));
        var tz = TimeZoneInfo.FindSystemTimeZoneById("Pacific/Auckland");
        var expected = TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, tz);

        var actual = TimeZoneUtility.GetTenantNow(accessor);

        // Allow +/- 5s drift since UtcNow is captured at both sides.
        Assert.True(Math.Abs((actual - expected).TotalSeconds) < 5,
            $"Expected {expected:O}, got {actual:O}");
    }

    [Fact]
    public void GetTenantNow_MissingClaim_FallsBackToUtc()
    {
        var accessor = AccessorWith();
        var before = DateTime.UtcNow;
        var actual = TimeZoneUtility.GetTenantNow(accessor);
        var after = DateTime.UtcNow;

        Assert.True(actual >= before.AddSeconds(-1) && actual <= after.AddSeconds(1));
    }

    [Fact]
    public void GetTenantNow_NoHttpContext_FallsBackToUtc()
    {
        var accessor = AccessorWithoutContext();
        var before = DateTime.UtcNow;
        var actual = TimeZoneUtility.GetTenantNow(accessor);
        var after = DateTime.UtcNow;

        Assert.True(actual >= before.AddSeconds(-1) && actual <= after.AddSeconds(1));
    }

    // ---- GetTenantNow (string overload) ----

    [Fact]
    public void GetTenantNow_ByTimeZoneId_ReturnsExpected()
    {
        var actual = TimeZoneUtility.GetTenantNow("Pacific/Auckland");
        var expected = TimeZoneInfo.ConvertTimeFromUtc(
            DateTime.UtcNow,
            TimeZoneInfo.FindSystemTimeZoneById("Pacific/Auckland"));

        Assert.True(Math.Abs((actual - expected).TotalSeconds) < 5);
    }

    [Fact]
    public void GetTenantNow_InvalidTimeZoneId_FallsBackToUtc()
    {
        // Invalid TZ id should NOT throw; it falls back to UtcNow.
        var before = DateTime.UtcNow;
        var actual = TimeZoneUtility.GetTenantNow("Bogus/Zone");
        var after = DateTime.UtcNow;

        Assert.True(actual >= before.AddSeconds(-1) && actual <= after.AddSeconds(1));
    }

    // ---- ConvertToTenantTime (accessor overload) ----

    [Fact]
    public void ConvertToTenantTime_Utc_ConvertsToTenantOffset()
    {
        var accessor = AccessorWith(new Claim("TimeZone", "Pacific/Auckland"));
        var utc = new DateTime(2026, 8, 13, 12, 0, 0, DateTimeKind.Utc);
        var expected = TimeZoneInfo.ConvertTimeFromUtc(
            utc,
            TimeZoneInfo.FindSystemTimeZoneById("Pacific/Auckland"));

        var actual = TimeZoneUtility.ConvertToTenantTime(utc, accessor);

        Assert.Equal(expected, actual);
    }

    [Fact]
    public void ConvertToTenantTime_MissingClaim_ReturnsInputUnchanged()
    {
        var accessor = AccessorWith();
        var input = new DateTime(2026, 8, 13, 12, 0, 0, DateTimeKind.Utc);

        var actual = TimeZoneUtility.ConvertToTenantTime(input, accessor);

        Assert.Equal(input, actual);
    }

    [Fact]
    public void ConvertToTenantTime_NoHttpContext_ReturnsInputUnchanged()
    {
        var accessor = AccessorWithoutContext();
        var input = new DateTime(2026, 8, 13, 12, 0, 0, DateTimeKind.Utc);

        var actual = TimeZoneUtility.ConvertToTenantTime(input, accessor);

        Assert.Equal(input, actual);
    }

    // ---- ConvertToTenantTime (string overload) ----

    [Fact]
    public void ConvertToTenantTime_UtcKind_ConvertsFromUtc()
    {
        var utc = new DateTime(2026, 8, 13, 12, 0, 0, DateTimeKind.Utc);
        var expected = TimeZoneInfo.ConvertTimeFromUtc(
            utc,
            TimeZoneInfo.FindSystemTimeZoneById("Pacific/Auckland"));

        var actual = TimeZoneUtility.ConvertToTenantTime(utc, "Pacific/Auckland");

        Assert.Equal(expected, actual);
    }

    [Fact]
    public void ConvertToTenantTime_UnspecifiedKind_TreatsAsUtc()
    {
        // Unspecified is coerced to Utc then converted.
        var unspecified = new DateTime(2026, 8, 13, 12, 0, 0, DateTimeKind.Unspecified);
        var expected = TimeZoneInfo.ConvertTimeFromUtc(
            DateTime.SpecifyKind(unspecified, DateTimeKind.Utc),
            TimeZoneInfo.FindSystemTimeZoneById("Pacific/Auckland"));

        var actual = TimeZoneUtility.ConvertToTenantTime(unspecified, "Pacific/Auckland");

        Assert.Equal(expected, actual);
    }

    [Fact]
    public void ConvertToTenantTime_LocalKind_ReturnsInputUnchanged()
    {
        // Local kind is returned as-is (no conversion applied).
        var local = new DateTime(2026, 8, 13, 12, 0, 0, DateTimeKind.Local);

        var actual = TimeZoneUtility.ConvertToTenantTime(local, "Pacific/Auckland");

        Assert.Equal(local, actual);
    }

    [Fact]
    public void ConvertToTenantTime_InvalidTimeZoneId_ReturnsInputUnchanged()
    {
        // Invalid TZ id should not throw; the original datetime is returned.
        var utc = new DateTime(2026, 8, 13, 12, 0, 0, DateTimeKind.Utc);

        var actual = TimeZoneUtility.ConvertToTenantTime(utc, "Bogus/Zone");

        Assert.Equal(utc, actual);
    }

    // ---- GetTenantToday ----

    [Fact]
    public void GetTenantToday_ReturnsTenantNowDate()
    {
        var accessor = AccessorWith(new Claim("TimeZone", "Pacific/Auckland"));
        var expected = TimeZoneInfo.ConvertTimeFromUtc(
            DateTime.UtcNow,
            TimeZoneInfo.FindSystemTimeZoneById("Pacific/Auckland")).Date;

        var actual = TimeZoneUtility.GetTenantToday(accessor);

        Assert.Equal(expected, actual);
        Assert.Equal(TimeSpan.Zero, actual.TimeOfDay);
    }

    [Fact]
    public void GetTenantToday_MissingClaim_ReturnsUtcToday()
    {
        var accessor = AccessorWith();
        var expected = DateTime.UtcNow.Date;

        var actual = TimeZoneUtility.GetTenantToday(accessor);

        // Allow the utc-today boundary to shift by exactly one day mid-run.
        Assert.True(actual == expected || actual == expected.AddDays(1) || actual == expected.AddDays(-1));
    }
}
