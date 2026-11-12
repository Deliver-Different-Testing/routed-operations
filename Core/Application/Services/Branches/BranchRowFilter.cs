// In-memory form of the branch rule for one request: the client ids, courier
// ids and site ids the caller may see.
//   client  -> its BranchId (NULL = default branch), plus tenant / internal types
//   courier -> its home BranchId (NULL = default branch)
//   site    -> tblBranch.SiteId of the caller's ACTIVE branches; a leg's pickup /
//              delivery suburb (tucSuburb.SiteId) on such a site is in branch
// Job visibility across a job family needs the DB, so it lives in
// IBranchScopeGuard.VisibleJobIdsAsync; IsLegVisible here is the one per-leg
// predicate it applies, and IsJobVisible the fallback for a row with no tucJob
// id to expand (no addresses known).

namespace RoutedOperations.Core.Application.Services.Branches;

public sealed class BranchRowFilter
{
    public static readonly BranchRowFilter Unrestricted = new(null, null, null);

    private readonly HashSet<int>? _clientIds;
    private readonly HashSet<int>? _courierIds;
    private readonly HashSet<int>? _siteIds;

    private BranchRowFilter(HashSet<int>? clientIds, HashSet<int>? courierIds, HashSet<int>? siteIds)
    {
        _clientIds = clientIds;
        _courierIds = courierIds;
        _siteIds = siteIds;
    }

    public static BranchRowFilter Restricted(
        IEnumerable<int> visibleClientIds, IEnumerable<int> visibleCourierIds, IEnumerable<int>? visibleSiteIds = null) =>
        new(new HashSet<int>(visibleClientIds), new HashSet<int>(visibleCourierIds),
            new HashSet<int>(visibleSiteIds ?? Array.Empty<int>()));

    public bool IsUnrestricted => _clientIds is null;

    /// <summary>Courier ids the caller may see, for SQL-side filters (empty
    /// when unrestricted; check IsUnrestricted first).</summary>
    public IReadOnlyCollection<int> VisibleCourierIds => (IReadOnlyCollection<int>?)_courierIds ?? Array.Empty<int>();

    public bool IsClientVisible(int? clientId) =>
        _clientIds is null || (clientId.HasValue && _clientIds.Contains(clientId.Value));

    public bool IsCourierVisible(int? courierId) =>
        _courierIds is null || (courierId.HasValue && _courierIds.Contains(courierId.Value));

    public bool IsSiteVisible(int? siteId) =>
        _siteIds is null || (siteId.HasValue && _siteIds.Contains(siteId.Value));

    /// <summary>
    /// THE per-leg rule (master spec section 4.1, Steve 12 Nov): a leg makes its
    /// whole job family visible when its client's branch, its courier's home
    /// branch, or the branch of its pickup or delivery suburb's site is one of
    /// the user's.
    /// </summary>
    public bool IsLegVisible(int? clientId, int? courierId, int? fromSiteId, int? toSiteId) =>
        IsClientVisible(clientId)
        || (courierId.HasValue && IsCourierVisible(courierId))
        || (fromSiteId.HasValue && IsSiteVisible(fromSiteId))
        || (toSiteId.HasValue && IsSiteVisible(toSiteId));

    /// <summary>Fallback for a row with no tucJob id: client or courier only.</summary>
    public bool IsJobVisible(int? clientId, int? courierId) => IsLegVisible(clientId, courierId, null, null);

    public List<T> FilterClients<T>(List<T> rows, Func<T, int?> clientId) =>
        IsUnrestricted ? rows : rows.Where(r => IsClientVisible(clientId(r))).ToList();

    public List<T> FilterCouriers<T>(List<T> rows, Func<T, int?> courierId) =>
        IsUnrestricted ? rows : rows.Where(r => IsCourierVisible(courierId(r))).ToList();
}
