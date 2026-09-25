// NP (Network Partner) authorization scope for the current request.
//
// - IsAdmin = true means the caller is tenant staff (or DF/UCL admin) and
//   sees every row. NpAgentId is ignored.
// - IsAdmin = false + NpAgentId not null means the caller is an NP user
//   restricted to rows carrying that NpAgentId. Every read SP takes an
//   optional @NpAgentId parameter that filters accordingly; write guards
//   enforce the same predicate at the row level via INpScopeGuard.
// - IsAdmin = false + NpAgentId null is a degenerate state (NP flag set
//   but no agent linkage found). Callers MUST return empty rather than
//   silently widening the query scope.

namespace RoutedOperations.Core.Application.Services.Np;

public record NpScope(bool IsAdmin, int? NpAgentId);
