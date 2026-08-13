using RoutedOperations.Core.Application.Services.Np;

namespace RoutedOperations.Tests.Np;

public class NpScopeTests
{
    [Fact]
    public void AdminScope_HasIsAdminTrueAndNullAgentId()
    {
        var scope = new NpScope(IsAdmin: true, NpAgentId: null);
        Assert.True(scope.IsAdmin);
        Assert.Null(scope.NpAgentId);
    }

    [Fact]
    public void NpScope_CapturesAgentId()
    {
        var scope = new NpScope(IsAdmin: false, NpAgentId: 42);
        Assert.False(scope.IsAdmin);
        Assert.Equal(42, scope.NpAgentId);
    }

    [Fact]
    public void RecordEquality_IsValueBased()
    {
        var a = new NpScope(IsAdmin: false, NpAgentId: 7);
        var b = new NpScope(IsAdmin: false, NpAgentId: 7);
        var c = new NpScope(IsAdmin: false, NpAgentId: 8);
        Assert.Equal(a, b);
        Assert.NotEqual(a, c);
    }

    [Fact]
    public void DegenerateScope_IsAdminFalseAndNullAgentId()
    {
        // The "NP flag set but no agent linkage" case per NpScopeResolver
        // rule 4. Callers MUST return empty; the shape itself is legal.
        var scope = new NpScope(IsAdmin: false, NpAgentId: null);
        Assert.False(scope.IsAdmin);
        Assert.Null(scope.NpAgentId);
    }
}
