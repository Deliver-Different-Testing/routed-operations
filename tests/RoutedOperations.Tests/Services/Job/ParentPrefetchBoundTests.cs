using System.Data.Common;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using RoutedOperations.Core.Application.Services.Job;
using RoutedOperations.Core.Application.Services.Run;
using RoutedOperations.Core.Domain;
using RoutedOperations.Core.Domain.Despatch;

namespace RoutedOperations.Tests.Services.Job;

/// <summary>
/// #1018 Route Builder speed. Both cockpit reads (GET jobs + GET runs) hide
/// parent jobs, the pickup leg of a parent/child family. They used to find the
/// parents by pulling EVERY ParentID ever written to tblBulkJob (123,235 ids on
/// Urgent prod) on every load, twice per save, and JobService then sent the
/// whole set back to SQL Server as a parameter list.
///
/// Two things matter and each has its own test:
///   1. The lists the operator sees are unchanged: a parent stays hidden,
///      including when its child is booked on another day or is already Done,
///      and a run that holds only a parent still shows up in the run list.
///   2. Neither read asks the database for parent ids it has no use for: no
///      command reads ParentID across the whole table without bounding it to
///      the jobs being shown.
/// </summary>
public class ParentPrefetchBoundTests
{
    private static readonly DateTime Day = new(2026, 11, 16);

    private sealed class SqlCapture : DbCommandInterceptor
    {
        public List<string> Commands { get; } = new();

        public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(
            DbCommand command, CommandEventData eventData, InterceptionResult<DbDataReader> result,
            CancellationToken cancellationToken = default)
        {
            lock (Commands) Commands.Add(command.CommandText);
            return base.ReaderExecutingAsync(command, eventData, result, cancellationToken);
        }
    }

    private static TblBulkJob Job(int id, DateTime date, int? parentId = null, int? runId = null,
        bool done = false)
        => new()
        {
            BulkJobId = id, JobNumber = "J" + id, ClientId = 1, ClientCode = "CLI",
            BookDate = date, BookTime = date, JobStatus = 0, Speed = 1,
            FromAddress = "F", ToAddress = "T", ParentId = parentId, BulkRunId = runId,
            Done = done,
        };

    private static (DbContextOptions<DespatchContext> Opts, DbConnection Keeper, SqlCapture Sql) Seeded()
    {
        var (baseOpts, keeper) = CockpitTestHarness.NewSqliteOptions();
        using (var seed = CockpitTestHarness.Context(baseOpts))
        {
            seed.TucClients.Add(new TucClient { UcclId = 1, UcclCode = "CLI", MaxJobsPerRun = 20 });
            seed.TblBulkRuns.AddRange(
                new TblBulkRun { Id = 1, Name = "R1", Status = 0, DespatchDateTime = Day },
                new TblBulkRun { Id = 2, Name = "R2", Status = 0, DespatchDateTime = Day },
                // Holds nothing but a parent job. Listed today because the run
                // list is built from every job in a run, parents included.
                new TblBulkRun { Id = 3, Name = "R3", Status = 1, DespatchDateTime = Day });
            seed.TblBulkJobs.AddRange(
                // Same-day family: parent 10, children 11 and 12.
                Job(10, Day, runId: 1),
                Job(11, Day, parentId: 10, runId: 1),
                Job(12, Day, parentId: 10, runId: 2),
                // Parent 20 today, its only child booked tomorrow.
                Job(20, Day, runId: 1),
                Job(21, Day.AddDays(1), parentId: 20),
                // Parent 30 today, its only child already Done.
                Job(30, Day, runId: 3),
                Job(31, Day, parentId: 30, done: true),
                // A plain job, unassigned.
                Job(40, Day),
                // History: families from a month ago, all Done. Their parent
                // ids are exactly what the old prefetch dragged back.
                Job(100, Day.AddDays(-30), done: true),
                Job(101, Day.AddDays(-30), parentId: 100, done: true),
                Job(102, Day.AddDays(-31), done: true),
                Job(103, Day.AddDays(-31), parentId: 102, done: true));
            seed.SaveChanges();
        }
        var sql = new SqlCapture();
        var opts = new DbContextOptionsBuilder<DespatchContext>(baseOpts).AddInterceptors(sql).Options;
        return (opts, keeper, sql);
    }

    [Fact]
    public async Task Jobs_and_runs_lists_hide_the_same_parents_as_before()
    {
        var (opts, keeper, _) = Seeded();
        using var _k = keeper;

        var jobs = await new JobService(CockpitTestHarness.Factory(opts))
            .GetBulkJobsAsync(Day, null, null, null, null);
        var runs = await new RunService(CockpitTestHarness.Factory(opts))
            .GetBulkRunsAsync(Day, null, null, null, null);

        // Parents 10, 20 and 30 never show, whichever day or state the child is in.
        Assert.Equal(new[] { 11, 12, 40 }, jobs.Select(j => j.BulkJobId).OrderBy(i => i).ToArray());

        // Run 3 holds only parent 30: still listed, with no visible jobs.
        Assert.Equal(new[] { 1, 2, 3 }, runs.Select(r => r.Id).ToArray());
        Assert.Equal(new[] { 11 }, runs.Single(r => r.Id == 1).Jobs.Select(j => j.BulkJobId).ToArray());
        Assert.Equal(new[] { 12 }, runs.Single(r => r.Id == 2).Jobs.Select(j => j.BulkJobId).ToArray());
        Assert.Empty(runs.Single(r => r.Id == 3).Jobs);
    }

    // An unbounded prefetch is a SELECT of ParentID from tblBulkJob whose only
    // predicate is "ParentID IS NOT NULL": it reads every family ever booked.
    private static readonly Regex UnboundedParentPrefetch = new(
        @"SELECT DISTINCT ""\w+""\.""ParentID""\s+FROM ""tblBulkJob"" AS ""\w+""\s+WHERE ""\w+""\.""ParentID"" IS NOT NULL\s*$",
        RegexOptions.IgnoreCase);

    [Fact]
    public async Task Jobs_read_does_not_fetch_every_parent_id_in_the_table()
    {
        var (opts, keeper, sql) = Seeded();
        using var _k = keeper;

        await new JobService(CockpitTestHarness.Factory(opts)).GetBulkJobsAsync(Day, null, null, null, null);

        Assert.DoesNotContain(sql.Commands, c => UnboundedParentPrefetch.IsMatch(c.Trim()));
    }

    [Fact]
    public async Task Runs_read_does_not_fetch_every_parent_id_in_the_table()
    {
        var (opts, keeper, sql) = Seeded();
        using var _k = keeper;

        await new RunService(CockpitTestHarness.Factory(opts)).GetBulkRunsAsync(Day, null, null, null, null);

        Assert.DoesNotContain(sql.Commands, c => UnboundedParentPrefetch.IsMatch(c.Trim()));
    }
}
