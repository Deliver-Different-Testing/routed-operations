using RoutedOperations.Core.Application.Services.Run;

namespace RoutedOperations.Tests.Services.Run;

/// <summary>
/// #1018 C4: what can be pinned about the assign locks without SQL Server.
/// The lock behaviour itself is RunAssignConcurrencySqlServerTests (opt-in).
/// </summary>
public class RunAssignLocksTests
{
    [Fact]
    public void Each_id_is_locked_once_in_ascending_order_by_key_seek_under_the_parameter_limit()
    {
        // Ascending ids stop two multi-job assigns deadlocking; FORCESEEK keeps
        // every id a key seek, so the read cannot scan into another operator's
        // rows (it did without it); no HOLDLOCK, which would bring the range
        // locks back.
        var ids = Enumerable.Range(1, 1500).Reverse().Append(7).ToList();

        var links = RunAssignLocks.LinkRowCommands(ids);
        var jobs = RunAssignLocks.JobRowCommands(ids);

        Assert.All(links, c => Assert.StartsWith("SELECT t.* FROM", c.Sql));
        Assert.All(links, c => Assert.Contains("INNER LOOP JOIN dbo.tblBulkJobRun AS t", c.Sql));
        Assert.All(jobs, c => Assert.Contains("INNER LOOP JOIN dbo.tblBulkJob AS t", c.Sql));
        foreach (var commands in new[] { links, jobs })
        {
            Assert.Equal(2, commands.Count);
            Assert.Equal(Enumerable.Range(1, 1500), commands.SelectMany(c => c.Args).Cast<int>());
            Assert.All(commands, c =>
            {
                Assert.Contains("WITH (UPDLOCK, ROWLOCK, FORCESEEK) ON t.BulkJobID = v.Id", c.Sql);
                Assert.DoesNotContain("HOLDLOCK", c.Sql);
                Assert.True(c.Args.Length <= RunAssignLocks.KeyBatchSize);
            });
        }
        Assert.Empty(RunAssignLocks.LinkRowCommands([]));
    }
}
