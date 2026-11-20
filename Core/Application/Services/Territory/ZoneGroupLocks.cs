using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;

namespace RoutedOperations.Core.Application.Services.Territory;

/// <summary>
/// The SQL Server locks the zone group writers take (review m2, r2, r3-1).
/// Callers run these on SQL Server only, inside their own transaction; the
/// locks are held to the end of it. Public static, not private, so the opt-in
/// SQL Server test runs the exact code the service runs (review r3-4), the
/// same reason ScheduleService exposes pure helpers instead of using
/// InternalsVisibleTo.
/// </summary>
public static class ZoneGroupLocks
{
    /// <summary>Member keys per locking command. SQL Server refuses more than
    /// 2100 parameters in one command; a group today is about 150 rows.</summary>
    public const int KeyBatchSize = 1000;

    /// <summary>The group ids to lock: no null (an ungrouped row has no group
    /// row to lock, review nit 6), no repeats, ascending so two writers that
    /// each touch two groups cannot deadlock.</summary>
    public static IReadOnlyList<int> GroupIdsToLock(params int?[] groupIds) =>
        groupIds.Where(g => g.HasValue).Select(g => g!.Value).Distinct().OrderBy(g => g).ToList();

    /// <summary>
    /// Review r2: the lock every writer of a group's members takes before it
    /// reads the rows its write depends on, UPDLOCK, HOLDLOCK on the
    /// BulkZonePostcodeGroup row. A CSV apply holds the same lock, so a paste
    /// or a single-row edit queues behind it.
    /// </summary>
    public static async Task LockGroupRowsAsync(DatabaseFacade db, params int?[] groupIds)
    {
        foreach (var id in GroupIdsToLock(groupIds))
            await db.ExecuteSqlRawAsync(
                "SELECT COUNT(*) FROM dbo.BulkZonePostcodeGroup WITH (UPDLOCK, HOLDLOCK) WHERE Id = {0}", id);
    }

    /// <summary>
    /// The apply's lock, in three steps, and the member ids it locked:
    ///   1. the group row (LockGroupRowsAsync), so two applies, or an apply
    ///      and any Routed Operations writer, queue;
    ///   2. a key-range lock on the group's members, read in the same
    ///      statement, so no row can join or leave the group until the commit;
    ///   3. each member's primary key (review r3-1). With the index from
    ///      20261120190500_ZoneGroupMemberIndexes, step 2 locks only that
    ///      index, and a zone change by Id from a writer that skips the group
    ///      lock (a legacy admin screen) touches only the primary key, so it
    ///      would not wait without this step.
    /// No index hint names the group index, so this runs the same with or
    /// without the migration; without it, step 2 scans and range-locks the
    /// whole table (correct, just wide) and step 3 adds nothing.
    /// </summary>
    public static async Task<IReadOnlyList<int>> LockGroupForImportAsync(DatabaseFacade db, int groupId, bool us)
    {
        await LockGroupRowsAsync(db, groupId);
        var ids = await db.SqlQueryRaw<int>(us
                ? "SELECT ZoneZipId AS [Value] FROM dbo.ZoneZip WITH (UPDLOCK, HOLDLOCK) WHERE ZoneZipGroupId = {0}"
                : "SELECT Id AS [Value] FROM dbo.BulkZonePostcode WITH (UPDLOCK, HOLDLOCK) WHERE PostcodeGroupId = {0}",
                groupId)
            .ToListAsync();
        foreach (var (sql, args) in MemberKeyLockCommands(ids, us))
            await db.ExecuteSqlRawAsync(sql, args);
        return ids;
    }

    /// <summary>
    /// The step 3 commands: the ids as a VALUES list joined to the table by
    /// its primary key. LOOP JOIN keeps the plan a key seek per id whatever
    /// the batch size, where a long IN list can tip into a clustered scan,
    /// which would lock every group's rows. A join hint, unlike an index
    /// hint, never fails for a missing index.
    /// </summary>
    public static List<(string Sql, object[] Args)> MemberKeyLockCommands(IReadOnlyList<int> ids, bool us)
    {
        var (table, key) = us ? ("dbo.ZoneZip", "ZoneZipId") : ("dbo.BulkZonePostcode", "Id");
        return ids.Chunk(KeyBatchSize)
            .Select(batch => (
                $"SELECT COUNT(*) FROM (VALUES {string.Join(",", batch.Select((_, i) => $"({{{i}}})"))}) AS v(Id) "
                + $"INNER LOOP JOIN {table} AS m WITH (UPDLOCK, HOLDLOCK) ON m.{key} = v.Id",
                batch.Cast<object>().ToArray()))
            .ToList();
    }

    /// <summary>
    /// Review nit 5: a single-row editor learns the row's group before it can
    /// lock it, so another writer could move the row in between and the lock
    /// would sit on the wrong group. Lock what was read (plus the group the
    /// row is going to), read again under the lock, and lock the group found
    /// if it changed. Every Routed Operations writer that moves a row holds
    /// the row's old group, so once that group is held the row cannot move
    /// again and one re-read is enough. Returns the group the row is in.
    /// The re-lock of a changed group runs after {before, alsoLock}, so it can
    /// break the ascending order GroupIdsToLock gives. That only happens when
    /// the row moved in the gap; a deadlock with another multi-group writer
    /// then cancels one side as a plain 400 with nothing written.
    /// </summary>
    public static async Task<int?> LockRowGroupAsync(
        Func<Task<int?>> readGroup, int? alsoLock, Func<int?[], Task> lockGroups)
    {
        var before = await readGroup();
        await lockGroups(new[] { before, alsoLock });
        var after = await readGroup();
        if (after != before) await lockGroups(new[] { after });
        return after;
    }
}
