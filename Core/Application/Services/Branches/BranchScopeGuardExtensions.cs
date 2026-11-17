namespace RoutedOperations.Core.Application.Services.Branches;

// List helpers over IBranchScopeGuard for rows that come back from stored procedures (which take no branch parameter).
// Unrestricted callers get the list back untouched with no database access.
public static class BranchScopeGuardExtensions
{
    /// <summary>
    /// Keeps the rows whose job family is visible. A row with a tucJob id is judged by its family; a row with none (a bulk
    /// job that never became a tucJob) by its own client or courier.
    /// </summary>
    public static async Task<List<T>> FilterJobRowsAsync<T>(
        this IBranchScopeGuard guard, List<T> rows,
        Func<T, int?> tucJobId, Func<T, int?> clientId, Func<T, int?> courierId)
    {
        if (!guard.IsRestricted || rows.Count == 0) return rows;

        var jobIds = rows.Select(tucJobId).Where(i => i > 0).Select(i => i!.Value).Distinct().ToList();
        var jobs = jobIds.Count == 0 ? new HashSet<int>() : await guard.VisibleJobIdsAsync(jobIds);

        var clients = await guard.VisibleClientIdsAsync(
            rows.Where(r => !(tucJobId(r) > 0)).Select(clientId).Where(i => i > 0).Select(i => i!.Value).Distinct().ToList());
        var couriers = await guard.VisibleJobCourierIdsAsync(
            rows.Where(r => !(tucJobId(r) > 0)).Select(courierId).Where(i => i > 0).Select(i => i!.Value).Distinct().ToList());

        return rows.Where(r => tucJobId(r) > 0
            ? jobs.Contains(tucJobId(r)!.Value)
            : (clientId(r) is { } c && clients.Contains(c)) || (courierId(r) is { } k && couriers.Contains(k))).ToList();
    }

    /// <summary>Keeps the rows whose tblBulkJob the caller may see (see <see cref="IBranchScopeGuard.VisibleBulkJobIdsAsync"/>).</summary>
    public static async Task<List<T>> FilterBulkJobRowsAsync<T>(this IBranchScopeGuard guard, List<T> rows, Func<T, int> bulkJobId)
    {
        if (!guard.IsRestricted || rows.Count == 0) return rows;
        var visible = await guard.VisibleBulkJobIdsAsync(rows.Select(bulkJobId).Distinct().ToList());
        return rows.Where(r => visible.Contains(bulkJobId(r))).ToList();
    }

    public static async Task<List<T>> FilterRunRowsAsync<T>(this IBranchScopeGuard guard, List<T> rows, Func<T, int> runId)
    {
        if (!guard.IsRestricted || rows.Count == 0) return rows;
        var visible = await guard.VisibleRunIdsAsync(rows.Select(runId).Distinct().ToList());
        return rows.Where(r => visible.Contains(runId(r))).ToList();
    }

    public static async Task<List<T>> FilterCourierRowsAsync<T>(this IBranchScopeGuard guard, List<T> rows, Func<T, int?> courierId)
    {
        if (!guard.IsRestricted || rows.Count == 0) return rows;
        var visible = await guard.VisibleCourierIdsAsync(rows.Select(courierId).Where(i => i > 0).Select(i => i!.Value).Distinct().ToList());
        return rows.Where(r => courierId(r) is { } c && visible.Contains(c)).ToList();
    }

    public static async Task<List<T>> FilterClientRowsAsync<T>(this IBranchScopeGuard guard, List<T> rows, Func<T, int?> clientId)
    {
        if (!guard.IsRestricted || rows.Count == 0) return rows;
        var visible = await guard.VisibleClientIdsAsync(rows.Select(clientId).Where(i => i > 0).Select(i => i!.Value).Distinct().ToList());
        return rows.Where(r => clientId(r) is { } c && visible.Contains(c)).ToList();
    }
}
