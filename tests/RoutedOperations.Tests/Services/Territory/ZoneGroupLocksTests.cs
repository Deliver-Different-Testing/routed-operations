using RoutedOperations.Core.Application.Services.Territory;

namespace RoutedOperations.Tests.Services.Territory;

/// <summary>
/// The decisions behind the zone group locks that can be pinned without SQL
/// Server. The lock hints themselves only mean something on SQL Server; that
/// side is ZoneGroupLocksSqlServerTests (opt-in) and the two-session check in
/// FIX3-REPORT.
/// </summary>
public class ZoneGroupLocksTests
{
    [Fact]
    public void Ungrouped_and_repeated_group_ids_are_not_locked_and_the_rest_lock_in_ascending_order()
    {
        // Nit 6: an ungrouped row has no group row to lock, so no SELECT runs
        // for it. Ascending order is what stops two writers that each touch
        // two groups from deadlocking.
        Assert.Equal(new[] { 3, 7 }, ZoneGroupLocks.GroupIdsToLock(null, 7, 3, 7, null));
        Assert.Empty(ZoneGroupLocks.GroupIdsToLock(null, null));
    }

    [Fact]
    public void Member_keys_are_locked_by_primary_key_in_batches_under_the_parameter_limit()
    {
        // r3-1: a zone change by Id from outside Routed Operations touches
        // only the primary key, so the apply must lock that key, not just the
        // group index range. SQL Server refuses more than 2100 parameters in
        // one command, so a big group is locked in batches.
        var ids = Enumerable.Range(1, 2500).ToList();

        foreach (var us in new[] { false, true })
        {
            var batches = ZoneGroupLocks.MemberKeyLockCommands(ids, us);

            Assert.Equal(3, batches.Count);
            Assert.All(batches, b => Assert.True(b.Args.Length <= 1000));
            Assert.Equal(ids, batches.SelectMany(b => b.Args).Cast<int>());
            Assert.All(batches, b =>
            {
                Assert.Contains(us ? "dbo.ZoneZip" : "dbo.BulkZonePostcode", b.Sql);
                Assert.Contains(us ? ".ZoneZipId = v.Id" : ".Id = v.Id", b.Sql);
                Assert.Contains("UPDLOCK, HOLDLOCK", b.Sql);
                // A hint naming the group index would fail on a tenant that
                // has not run 20261120190500_ZoneGroupMemberIndexes yet.
                Assert.DoesNotContain("FORCESEEK", b.Sql);
                Assert.DoesNotContain("INDEX(", b.Sql.Replace(" ", ""));
            });
        }
        Assert.Empty(ZoneGroupLocks.MemberKeyLockCommands(new List<int>(), us: false));
    }

    [Fact]
    public async Task A_row_that_changed_group_before_the_lock_also_locks_its_new_group()
    {
        // Nit 5: the editor reads the row's group, then locks it. If another
        // writer moved the row in between, the lock is on the wrong group, so
        // the group is read again under the lock and the new one locked too.
        var reads = new Queue<int?>(new int?[] { 5, 6 });
        var locked = new List<int?[]>();

        var final = await ZoneGroupLocks.LockRowGroupAsync(
            () => Task.FromResult(reads.Dequeue()), 9, ids => { locked.Add(ids); return Task.CompletedTask; });

        Assert.Equal(6, final);
        Assert.Equal(new int?[] { 5, 9 }, locked[0]);
        Assert.Contains(locked.Skip(1), ids => ids.Contains(6));
    }

    [Fact]
    public async Task A_row_that_stayed_in_its_group_takes_one_lock()
    {
        var locked = new List<int?[]>();

        var final = await ZoneGroupLocks.LockRowGroupAsync(
            () => Task.FromResult<int?>(5), null, ids => { locked.Add(ids); return Task.CompletedTask; });

        Assert.Equal(5, final);
        Assert.Equal(new int?[] { 5, null }, Assert.Single(locked));
    }
}
