using RoutedOperations.Core.Application.Services.Np;

namespace RoutedOperations.Tests.Np;

public class NpLabelScopeExceptionTests
{
    [Fact]
    public void ParameterlessConstructor_UsesDefaultMessage()
    {
        var ex = new NpLabelScopeException();
        Assert.Equal("Access denied: row is outside your NP scope.", ex.Message);
    }

    [Fact]
    public void MessageConstructor_ExposesMessageVerbatim()
    {
        var ex = new NpLabelScopeException("Custom denial message");
        Assert.Equal("Custom denial message", ex.Message);
    }

    [Fact]
    public void InnerConstructor_WrapsInner()
    {
        var inner = new InvalidOperationException("inner cause");
        var ex = new NpLabelScopeException("outer", inner);
        Assert.Equal("outer", ex.Message);
        Assert.Same(inner, ex.InnerException);
    }

    [Fact]
    public void IsAnException()
    {
        Assert.IsAssignableFrom<Exception>(new NpLabelScopeException());
    }
}
