namespace RoutedOperations.Core.Application.Services.Run;

/// <summary>
/// #1018 C4: the row locks a Route Builder assign takes, in place of the
/// Serializable transaction it used to run in. Serializable range-locked the
/// gap in the tblBulkJobRun BulkJobID index around every job it looked up, so
/// two operators assigning different jobs to different runs on the same day
/// (consecutive bulk job ids, one gap) waited on each other.
///
/// The assign now runs ReadCommitted and locks only its own rows, UPDLOCK,
/// ROWLOCK, held to the end of the caller's transaction: first the jobs'
/// tblBulkJobRun rows (the order the legacy MERGE ... HOLDLOCK path takes
/// them), then the tblBulkJob rows, which always exist and so also cover a
/// job that has no link row yet. A second assign of the same job queues on
/// those locks, so the optimistic fromRunId check reads what the first one
/// committed.
///
/// This order is new with C4: before it, the assign read tblBulkJob first and
/// tblBulkJobRun second. Checked 23 Nov 2026: the MERGE ... HOLDLOCK paths in
/// RunService and UTL_stpJob_tblBulkJobRun_InsertOrUpdate /
/// UTL_stpJob_InsertFromRunBuilder take the same order as the assign now
/// does, but EF SaveChanges (RemoveJobFromRunAsync, run delete,
/// VoidJobService) writes tblBulkJob first, as do several legacy procs
/// (RVW_stpMissingJob, RVW_stpLMCJob, UTL_stpJob_tblBulkJob_ReleaseByJobNumber
/// and others). C4 therefore adds a deadlock risk between those and an
/// assign of the same job; SQL Server picks a victim and that statement
/// fails, it does not hang.
///
/// The link rows are READ by the locking statement itself. A plain EF read of
/// tblBulkJobRun was free to scan the clustered index (it did on local NZ,
/// 124 rows) and then waited on the row another operator's assign had just
/// inserted, which brought the blocking straight back. A LOOP join alone was
/// not enough on a small table (the inner side was still a scan), so the
/// hint carries FORCESEEK. Every tenant has an index keyed on
/// tblBulkJobRun.BulkJobID (UX_tblBulkJobRun_BulkJobID plus two older ones,
/// checked on local NZ / US and Urgent, Medical, Cheetah, OTG prod 23 Nov
/// 2026), and tblBulkJob.BulkJobID is its primary key, so the seek always
/// has an index; without one SQL Server would refuse the statement (8622).
/// Public static so the opt-in SQL Server test runs the exact SQL the service
/// runs. SQL Server only.
/// </summary>
public static class RunAssignLocks
{
    /// <summary>Ids per command. SQL Server refuses more than 2100
    /// parameters in one command.</summary>
    public const int KeyBatchSize = 1000;

    /// <summary>Lock and return the jobs' tblBulkJobRun rows (all columns,
    /// for DbSet.FromSqlRaw).</summary>
    public static List<(string Sql, object[] Args)> LinkRowCommands(IEnumerable<int> bulkJobIds) =>
        Commands(bulkJobIds, "t.*", "dbo.tblBulkJobRun");

    /// <summary>Lock the jobs' tblBulkJob rows.</summary>
    public static List<(string Sql, object[] Args)> JobRowCommands(IEnumerable<int> bulkJobIds) =>
        Commands(bulkJobIds, "COUNT(*)", "dbo.tblBulkJob");

    /// <summary>Ids distinct and ascending, so two multi-job assigns cannot
    /// deadlock on order.</summary>
    private static List<(string Sql, object[] Args)> Commands(IEnumerable<int> bulkJobIds, string select, string table) =>
        bulkJobIds.Distinct().OrderBy(i => i).Chunk(KeyBatchSize)
            .Select(batch => (
                $"SELECT {select} FROM (VALUES {string.Join(",", batch.Select((_, i) => $"({{{i}}})"))}) AS v(Id) "
                + $"INNER LOOP JOIN {table} AS t WITH (UPDLOCK, ROWLOCK, FORCESEEK) ON t.BulkJobID = v.Id",
                batch.Cast<object>().ToArray()))
            .ToList();
}
