namespace RoutedOperations.Core.Application.Services.Branches;

/// <summary>
/// Row-level branch guard for tenant staff (Branches programme, B2), modelled on <c>INpScopeGuard</c>. A caller who is not
/// branch limited short-circuits with no database access.
///
/// The rule (master spec 4.1, decided 12 Nov):
///   * a client is visible if its branch is theirs (NULL = the default branch), or it is a house account (tenant / internal /
///     DF Admin client type); a courier if its home branch is theirs (NULL = the default branch);
///   * a JOB FAMILY (the root, <c>RootParentId ?? ParentId ?? id</c>, plus every job whose ParentId or RootParentId is that
///     root) is visible when ANY leg has a visible client, a visible courier, or a pickup or delivery suburb whose site belongs
///     to one of their active branches. Once one leg is visible, the whole family is;
///   * a RUN is fully visible, and actionable, when its courier is visible or every job on it is. Otherwise it is listed if
///     ANY job on it is visible (and shows only those jobs).
/// A denial throws <see cref="BranchScopeException"/> (a 403 through the existing handler). A missing row also throws.
/// </summary>
public interface IBranchScopeGuard
{
    /// <summary>True when the caller is branch limited (so the list helpers have work to do).</summary>
    bool IsRestricted { get; }

    /// <summary>The caller's branch ids (empty when unrestricted). For callers that build SQL predicates synchronously.</summary>
    int[] BranchIds { get; }

    /// <summary>True when the default branch is one of the caller's (a client or courier with no branch belongs to it). One small
    /// synchronous read per request, only for a branch-limited caller; false when unrestricted.</summary>
    bool DefaultBranchInScope { get; }

    Task EnsureTucJobInScopeAsync(int jobId);
    /// <summary>Denies unless the bulk job is actionable (<see cref="ActionableBulkJobIdsAsync"/>): visible, or on a run whose courier is theirs.</summary>
    Task EnsureBulkJobInScopeAsync(int bulkJobId);
    Task EnsureTucJobByNumberInScopeAsync(string jobNumber);

    /// <summary>Whole-route check: the route's default courier is visible, or every non-void job on it is.</summary>
    Task EnsureRouteInScopeAsync(int routeId);

    /// <summary>Whole-run check (positive = tblBulkRun, negative = synthetic route run): see <see cref="IsRunFullyVisibleAsync"/>.</summary>
    Task EnsureRunInScopeAsync(int runId);

    /// <summary>Of the given tucJob ids, those whose family is visible. Every id when unrestricted.</summary>
    Task<IReadOnlySet<int>> VisibleJobIdsAsync(IReadOnlyCollection<int> jobIds);

    /// <summary>
    /// Of the given tblBulkJob ids, those the caller may see: a bulk job that became a tucJob follows that job's family; one that never
    /// did is judged by its own client and courier. Every id when unrestricted. (Route Builder works in bulk job ids.)
    /// </summary>
    Task<IReadOnlySet<int>> VisibleBulkJobIdsAsync(IReadOnlyCollection<int> bulkJobIds);

    /// <summary>
    /// Of the given tblBulkJob ids, those the caller may ACT on (dispatch, void): visible ones, plus any job sitting on a run that is
    /// fully theirs (the run's courier is theirs), so their own courier's run can be dispatched whole. Every id when unrestricted.
    /// A run is looked up once for the whole batch; a job pointing at a run that no longer exists gets nothing from it. The one rule for
    /// move, remove, dispatch, void and the Route Viewer bulk-job actions.
    /// </summary>
    Task<IReadOnlySet<int>> ActionableBulkJobIdsAsync(IReadOnlyCollection<int> bulkJobIds);

    /// <summary>Of the given client ids, those the caller may see. Every id when unrestricted.</summary>
    Task<IReadOnlySet<int>> VisibleClientIdsAsync(IReadOnlyCollection<int> clientIds);

    /// <summary>Of the given courier ids, those the caller may see. Every id when unrestricted.</summary>
    Task<IReadOnlySet<int>> VisibleCourierIdsAsync(IReadOnlyCollection<int> courierIds);

    /// <summary>
    /// As <see cref="VisibleCourierIdsAsync"/>, but for a courier used as the link that makes a JOB (or an event on one) visible: the
    /// parent-job placeholder courier (tblSetting.ParentJobCourierId, no branch) is dropped, so it never opens split families to the
    /// default branch. Use for job/event visibility; use the plain one for pickers, run couriers and assignment checks.
    /// </summary>
    Task<IReadOnlySet<int>> VisibleJobCourierIdsAsync(IReadOnlyCollection<int> courierIds);

    /// <summary>Of the given run ids, those listed for the caller: the run's courier is visible, or at least one job on it is.</summary>
    Task<IReadOnlySet<int>> VisibleRunIdsAsync(IReadOnlyCollection<int> runIds);

    /// <summary>Narrows a courier query to the caller's couriers IN SQL, so a paged or capped list (Take) is right. Unchanged when unrestricted.</summary>
    Task<IQueryable<RoutedOperations.Core.Domain.Despatch.TucCourier>> WhereCourierVisibleAsync(
        IQueryable<RoutedOperations.Core.Domain.Despatch.TucCourier> query);

    /// <summary>Narrows a client query to the caller's clients (and the house accounts) IN SQL, so a capped search is right. Unchanged when unrestricted.</summary>
    Task<IQueryable<RoutedOperations.Core.Domain.Despatch.TucClient>> WhereClientVisibleAsync(
        IQueryable<RoutedOperations.Core.Domain.Despatch.TucClient> query);

    /// <summary>True when the run's courier is visible or every job on it is (the whole-run rule). True when unrestricted.</summary>
    Task<bool> IsRunFullyVisibleAsync(int runId);
}
