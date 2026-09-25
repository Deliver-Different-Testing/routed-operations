// SpParam is the SqlParameter factory shared across every RouteViewer* SP
// invocation. Two rules under test: empty string coerces to DBNull (matches
// legacy IN-clause filter SP contract) + null value coerces to DBNull.
using Microsoft.Data.SqlClient;
using RoutedOperations.Core.Application.Services.RouteViewer;

namespace RoutedOperations.Tests.Services.RouteViewer;

public class SpParamTests
{
    [Fact]
    public void Of_EmptyString_CoercesToDbNull()
    {
        var p = SpParam.Of("@ClientIds", string.Empty);
        Assert.Equal("@ClientIds", p.ParameterName);
        Assert.Equal(DBNull.Value, p.Value);
    }

    [Fact]
    public void Of_NullValue_CoercesToDbNull()
    {
        var p = SpParam.Of("@X", (object?)null);
        Assert.Equal(DBNull.Value, p.Value);
    }

    [Fact]
    public void Of_NonEmptyString_PassesThrough()
    {
        var p = SpParam.Of("@Regions", "1,2,3");
        Assert.Equal("1,2,3", p.Value);
    }

    [Fact]
    public void Of_IntValue_PassesThrough()
    {
        var p = SpParam.Of("@Id", 42);
        Assert.Equal(42, p.Value);
    }

    [Fact]
    public void Of_DateTimeValue_PassesThrough()
    {
        var dt = new DateTime(2026, 8, 13);
        var p = SpParam.Of("@RunDate", dt);
        Assert.Equal(dt, p.Value);
    }

    [Fact]
    public void Of_NullableIntWithValue_PassesThrough()
    {
        int? n = 7;
        var p = SpParam.Of("@Id", n);
        Assert.Equal(7, p.Value);
    }

    [Fact]
    public void Of_ReturnsSqlParameterType()
    {
        var p = SpParam.Of("@Name", "x");
        Assert.IsType<SqlParameter>(p);
    }

    [Fact]
    public void Of_BoolValue_PassesThrough()
    {
        var p = SpParam.Of("@Flag", true);
        Assert.Equal(true, p.Value);
    }

    [Fact]
    public void Of_WhitespaceStringIsNotCoerced()
    {
        // Only zero-length string coerces to DBNull; a single space stays as-is
        // so callers who intentionally pass a space (rare) are not surprised.
        var p = SpParam.Of("@X", " ");
        Assert.Equal(" ", p.Value);
    }
}
