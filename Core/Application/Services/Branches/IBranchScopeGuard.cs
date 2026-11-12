// Row-level branch guard for tenant staff (Branches programme B2), modelled on
// INpScopeGuard (same five Ensure* methods). Unrestricted callers (no BranchIds
// claim, non-staff, NP, system work) short-circuit with no DB access. A denial
// throws BranchScopeException (an NpLabelScopeException, so controllers return
// 403). A missing row throws, as the NP guard does.
//
// Visibility rule (master spec section 4.1, Steve 12 Nov 2026):
//   * A job FAMILY is visible when, on ANY leg, the client's branch, the
//     courier's home branch (NULL = default), or the branch of the pickup or
//     delivery suburb's site (tucSuburb.SiteId -> active tblBranch.SiteId) is
//     in the user's branches, or any leg sits on a tblBulkRun whose courier
//     is. Once visible, the whole family is: parent / master job, every leg incl. the pickup leg, and its notes and
//     events. Family = the root (RootParentId ?? ParentId ?? ucjbID) plus every
//     tucJob whose ParentID or RootParentId is that root (RVW_stpJobSiblings
//     uses the same ParentID link).
//   * A RUN is fully visible and actionable when its courier is in the user's
//     branches (tblBulkRun.CourierId; for a synthetic route run, the route's
//     DefaultCourierId or the courier on any of its live jobs), OR every job
//     on it is visible. Otherwise a run is listed if ANY job on it is visible,
//     and shows only those jobs.
//
// Every INpScopeGuard call also runs this guard: INpScopeGuard is registered
// as NpAndBranchScopeGuard (Program.cs). List endpoints use the extension
// helpers in BranchScopeGuardExtensions.

namespace RoutedOperations.Core.Application.Services.Branches;

public interface IBranchScopeGuard
{
    Task EnsureTucJobInScopeAsync(int jobId);

    Task EnsureBulkJobInScopeAsync(int bulkJobId);

    Task EnsureTucJobByNumberInScopeAsync(string jobNumber);

    /// <summary>Whole-route check: route courier visible OR every non-void job visible.</summary>
    Task EnsureRouteInScopeAsync(int routeId);

    /// <summary>Whole-run check: run courier visible OR every job visible.
    /// Negative ids are synthetic route runs.</summary>
    Task EnsureRunInScopeAsync(int runId);

    /// <summary>The caller's visible client / courier sets. Unrestricted for
    /// unrestricted callers (no DB access). Cached for the request.</summary>
    Task<BranchRowFilter> GetRowFilterAsync();

    /// <summary>Of the given tucJob ids, those whose family is visible.
    /// Every id when unrestricted.</summary>
    Task<IReadOnlySet<int>> VisibleJobIdsAsync(IReadOnlyCollection<int> jobIds);

    /// <summary>Of the given run ids (negative = synthetic route run), those
    /// with a visible courier or at least one visible job. Every id when
    /// unrestricted.</summary>
    Task<IReadOnlySet<int>> VisibleRunIdsAsync(IReadOnlyCollection<int> runIds);

    /// <summary>True when the run's courier is visible or every job on it is
    /// (the whole-run rule). True when unrestricted.</summary>
    Task<bool> IsRunFullyVisibleAsync(int runId);
}
