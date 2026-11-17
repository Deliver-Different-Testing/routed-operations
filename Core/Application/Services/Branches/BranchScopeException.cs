using RoutedOperations.Core.Application.Services.Np;

namespace RoutedOperations.Core.Application.Services.Branches;

/// <summary>
/// A row is outside the caller's branches. Derives from <see cref="NpLabelScopeException"/> so every controller that
/// already turns a network partner denial into a 403 does the same for a branch denial.
/// </summary>
public class BranchScopeException(string message) : NpLabelScopeException(message);
