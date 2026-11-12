// List helpers over IBranchScopeGuard. Rows with a tucJob id are expanded to
// their job family (VisibleJobIdsAsync); rows without one fall back to the
// single-row rule (client or courier). Unrestricted callers get the list back
// untouched with no DB access.

namespace RoutedOperations.Core.Application.Services.Branches;

public static class BranchScopeGuardExtensions
{
    public static async Task<List<T>> FilterJobRowsAsync<T>(
        this IBranchScopeGuard guard,
        List<T> rows,
        Func<T, int?> tucJobId,
        Func<T, int?> clientId,
        Func<T, int?> courierId)
    {
        var filter = await guard.GetRowFilterAsync();
        if (filter.IsUnrestricted || rows.Count == 0) return rows;

        var ids = rows.Select(tucJobId).Where(i => i > 0).Select(i => i!.Value).Distinct().ToList();
        IReadOnlySet<int> visible = ids.Count == 0 ? new HashSet<int>() : await guard.VisibleJobIdsAsync(ids);

        return rows.Where(r =>
        {
            var id = tucJobId(r);
            return id > 0 ? visible.Contains(id.Value) : filter.IsJobVisible(clientId(r), courierId(r));
        }).ToList();
    }

    public static async Task<List<T>> FilterRunRowsAsync<T>(
        this IBranchScopeGuard guard, List<T> rows, Func<T, int> runId)
    {
        var filter = await guard.GetRowFilterAsync();
        if (filter.IsUnrestricted || rows.Count == 0) return rows;

        var visible = await guard.VisibleRunIdsAsync(rows.Select(runId).Distinct().ToList());
        return rows.Where(r => visible.Contains(runId(r))).ToList();
    }
}
