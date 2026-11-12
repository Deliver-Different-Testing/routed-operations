// Thrown by IBranchScopeGuard when a branch-limited staff user targets a job /
// bulk job / route / run outside their branches. Derives from
// NpLabelScopeException so every controller that already maps the NP guard's
// exception to HTTP 403 does the same for branches without a second catch.
using RoutedOperations.Core.Application.Services.Np;

namespace RoutedOperations.Core.Application.Services.Branches;

public class BranchScopeException : NpLabelScopeException
{
    public BranchScopeException() : base("Access denied: row is outside your branches.") { }

    public BranchScopeException(string message) : base(message) { }
}
