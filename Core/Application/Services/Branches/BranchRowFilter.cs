// In-memory form of the branch rule for one request: the set of client ids and
// courier ids the caller may see. Used by IBranchScopeGuard for row checks and
// by list endpoints to post-filter stored-procedure result sets (the RVW_* SPs
// take @NpAgentId but no branch list yet).

namespace RoutedOperations.Core.Application.Services.Branches;

public sealed class BranchRowFilter
{
    public static readonly BranchRowFilter Unrestricted = new(null, null, false);

    private readonly HashSet<int>? _clientIds;
    private readonly HashSet<int>? _courierIds;
    private readonly bool _jobVisibleViaCourier;

    private BranchRowFilter(HashSet<int>? clientIds, HashSet<int>? courierIds, bool jobVisibleViaCourier)
    {
        _clientIds = clientIds;
        _courierIds = courierIds;
        _jobVisibleViaCourier = jobVisibleViaCourier;
    }

    public static BranchRowFilter Restricted(
        IEnumerable<int> visibleClientIds, IEnumerable<int> visibleCourierIds, bool jobVisibleViaCourier) =>
        new(new HashSet<int>(visibleClientIds), new HashSet<int>(visibleCourierIds), jobVisibleViaCourier);

    public bool IsUnrestricted => _clientIds is null;

    /// <summary>Courier ids the caller may see, for SQL-side filters (empty
    /// when unrestricted; check IsUnrestricted first).</summary>
    public IReadOnlyCollection<int> VisibleCourierIds => (IReadOnlyCollection<int>?)_courierIds ?? Array.Empty<int>();

    public bool IsClientVisible(int? clientId) =>
        _clientIds is null || (clientId.HasValue && _clientIds.Contains(clientId.Value));

    public bool IsCourierVisible(int? courierId) =>
        _courierIds is null || (courierId.HasValue && _courierIds.Contains(courierId.Value));

    /// <summary>
    /// THE job rule. Option A: the job's client is visible. Option B (switch
    /// BranchVisibilityOptions.JobVisibleViaCourierBranch): or its courier is.
    /// A job with no client and no visible courier is not visible.
    /// </summary>
    public bool IsJobVisible(int? clientId, int? courierId) =>
        IsClientVisible(clientId) || (_jobVisibleViaCourier && courierId.HasValue && IsCourierVisible(courierId));

    /// <summary>Keeps the job rows the caller may see. Unrestricted returns the list as is.</summary>
    public List<T> FilterJobs<T>(List<T> rows, Func<T, int?> clientId, Func<T, int?> courierId) =>
        IsUnrestricted ? rows : rows.Where(r => IsJobVisible(clientId(r), courierId(r))).ToList();

    public List<T> FilterClients<T>(List<T> rows, Func<T, int?> clientId) =>
        IsUnrestricted ? rows : rows.Where(r => IsClientVisible(clientId(r))).ToList();

    public List<T> FilterCouriers<T>(List<T> rows, Func<T, int?> courierId) =>
        IsUnrestricted ? rows : rows.Where(r => IsCourierVisible(courierId(r))).ToList();
}
