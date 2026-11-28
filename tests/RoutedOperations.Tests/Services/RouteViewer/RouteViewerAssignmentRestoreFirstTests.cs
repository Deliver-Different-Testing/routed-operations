// Cheetah R1 (2026-11-28). Ruth re-assigned jobs from one courier to
// another in Routed Ops and the jobs stayed on the old phone: the courier
// assign only ran the despatch procs, never uspRestoreJob, so the old phone
// was never told to drop the job. These tests pin the order (restore BEFORE
// despatch, whenever the job has a courier, the target included: that is the
// same-courier resend), that completed jobs are
// never touched, and that a job that fails after its restore is named as
// now unassigned (fix round 1 F3). The route-run (RunId < 0) tests live in
// Controllers/RunViewerAssignmentRouteRunTests.cs.
//
// InMemory cannot run stored procedures, so a subclass replaces the
// two SP seams and records what would have run, in order.
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using RoutedOperations.Core.Application.Dtos.RouteViewer;
using RoutedOperations.Core.Application.Services.Np;
using RoutedOperations.Core.Application.Services.RouteViewer;
using RoutedOperations.Core.Domain;
using RoutedOperations.Core.Domain.Despatch;

namespace RoutedOperations.Tests.Services.RouteViewer;

public class RouteViewerAssignmentRestoreFirstTests
{
    // Courier ids vs codes are deliberately crossed, as on Cheetah
    // (CourierID 2 is code "1"): here id 2 = code "22", id 9 = code "2".
    // Test values only, not real couriers.
    private const int FromCourier = 2, Target = 9, Other = 5;

    private sealed class RecordingService(
        IDbContextFactory<DynamicDespatchDbContext> factory, INpScopeResolver resolver, INpScopeGuard guard)
        : RouteViewerAssignmentService(factory, resolver, guard,
            RoutedOperations.Tests.Branches.BranchTestDoubles.Unrestricted(),
            NullLogger<RouteViewerAssignmentService>.Instance)
    {
        public List<string> Calls { get; } = new();
        public HashSet<int> DespatchThrowsFor { get; } = new();

        protected override Task RestoreJobAsync(int jobId)
        {
            Calls.Add($"restore:{jobId}");
            return Task.CompletedTask;
        }

        protected override Task DespatchJobToCourierAsync(int jobId, int courierId)
        {
            if (DespatchThrowsFor.Contains(jobId)) throw new InvalidOperationException("despatch blew up");
            Calls.Add($"despatch:{jobId}->{courierId}");
            return Task.CompletedTask;
        }
    }

    private static (RecordingService svc, DynamicDespatchDbContext seed) NewSvc()
    {
        var opts = RouteViewerTestHarness.NewOptions();
        var seed = RouteViewerTestHarness.Context(opts);
        seed.TucCouriers.Add(new TucCourier { UccrId = FromCourier, Code = "22", Active = true });
        seed.TucCouriers.Add(new TucCourier { UccrId = Target, Code = "2", Active = true });
        seed.TucCouriers.Add(new TucCourier { UccrId = Other, Code = "77", Active = true });
        var resolver = Substitute.For<INpScopeResolver>();
        resolver.ResolveAsync().Returns(new NpScope(true, null));
        var svc = new RecordingService(RouteViewerTestHarness.Factory(opts), resolver, Substitute.For<INpScopeGuard>());
        return (svc, seed);
    }

    private static void Job(DynamicDespatchDbContext seed, int id, int? courierId, bool done = false, bool isVoid = false) =>
        seed.TucJobs.Add(new TucJob { UcjbId = id, UcjbNumber = $"J{id}", UcjbCourierId = courierId, UcjbJobDone = done, UcjbVoid = isVoid });

    private static BulkAssignRequest ToTarget(params int[] ids) =>
        new() { JobIds = ids.ToList(), TargetType = "Courier", TargetId = Target };

    // ---------------- R1: AssignAsync (Courier) ----------------

    [Fact]
    public async Task Job_on_another_courier_is_restored_before_it_is_despatched()
    {
        var (svc, seed) = NewSvc();
        Job(seed, 1, FromCourier);
        await seed.SaveChangesAsync();

        var result = await svc.AssignAsync(ToTarget(1));

        // Order is the bug: despatch first would leave the job on 22's phone.
        Assert.Equal(new[] { "restore:1", $"despatch:1->{Target}" }, svc.Calls);
        Assert.Equal(1, result.Succeeded);
        Assert.Equal(1, result.Moved);
        Assert.Equal(new[] { "22" }, result.FromCourierCodes);
        Assert.Equal("2", result.TargetCode);
    }

    [Fact]
    public async Task Job_already_on_the_target_is_restored_then_despatched_again_as_a_resend()
    {
        var (svc, seed) = NewSvc();
        Job(seed, 1, Target);
        await seed.SaveChangesAsync();

        var result = await svc.AssignAsync(ToTarget(1));

        // Kevin 2026-11-28: re-assign to the same courier is how ops resend a job
        // the phone missed. Despatch alone leaves ucjbMobileSend = 1, so Mars
        // never sends it again; only the restore resets it.
        Assert.Equal(new[] { "restore:1", $"despatch:1->{Target}" }, svc.Calls);
        Assert.Equal(1, result.Succeeded);
        Assert.Equal(0, result.Moved);
        Assert.Empty(result.FromCourierCodes);
    }

    [Fact]
    public async Task Unassigned_job_is_despatched_without_a_restore()
    {
        var (svc, seed) = NewSvc();
        Job(seed, 1, null);
        await seed.SaveChangesAsync();

        var result = await svc.AssignAsync(ToTarget(1));

        Assert.Equal(new[] { $"despatch:1->{Target}" }, svc.Calls);
        Assert.Equal(0, result.Moved);
    }

    [Fact]
    public async Task Completed_job_is_never_restored_or_moved_and_is_reported_as_rejected()
    {
        var (svc, seed) = NewSvc();
        Job(seed, 1, FromCourier, done: true);
        await seed.SaveChangesAsync();

        var result = await svc.AssignAsync(ToTarget(1));

        Assert.Empty(svc.Calls);
        var rejected = Assert.Single(result.Rejected);
        Assert.Equal(1, rejected.JobId);
        Assert.Equal("J1", rejected.JobNumber);
        Assert.Equal("Job is already completed.", rejected.Reason);
        // Rejected is not a failure: an all-completed selection must not 500.
        Assert.Equal(0, result.Failed);
    }

    [Fact]
    public async Task Void_done_job_is_not_treated_as_completed()
    {
        var (svc, seed) = NewSvc();
        Job(seed, 1, FromCourier, done: true, isVoid: true);
        await seed.SaveChangesAsync();

        var result = await svc.AssignAsync(ToTarget(1));

        Assert.Equal(new[] { "restore:1", $"despatch:1->{Target}" }, svc.Calls);
        Assert.Empty(result.Rejected);
    }

    [Fact]
    public async Task One_failing_job_is_counted_and_the_rest_still_move()
    {
        var (svc, seed) = NewSvc();
        Job(seed, 1, FromCourier);
        Job(seed, 2, FromCourier);
        Job(seed, 3, Other);
        Job(seed, 4, null, done: true);
        await seed.SaveChangesAsync();
        svc.DespatchThrowsFor.Add(2);

        var result = await svc.AssignAsync(ToTarget(1, 2, 3, 4, 404));

        Assert.Equal(2, result.Succeeded);
        Assert.Equal(1, result.Failed);
        Assert.Contains(result.Errors, e => e.StartsWith("Job J2:"));
        // F3: J2 was restored off 22 and then the despatch failed, so it is
        // on nobody's phone; the toast must name it and say so.
        var failed = Assert.Single(result.FailedJobs);
        Assert.Equal(2, failed.JobId);
        Assert.Equal("J2", failed.JobNumber);
        Assert.True(failed.NowUnassigned);
        Assert.Equal(2, result.Moved);
        Assert.Equal(new[] { "22", "77" }, result.FromCourierCodes);
        Assert.Equal(new[] { 4, 404 }, result.Rejected.Select(r => r.JobId));
        Assert.Equal("Job not found (it may have been archived).", result.Rejected[1].Reason);
        Assert.Equal(new[] { "restore:1", $"despatch:1->{Target}", "restore:2", "restore:3", $"despatch:3->{Target}" }, svc.Calls);
    }

    [Fact]
    public async Task Three_jobs_from_22_report_the_toast_numbers()
    {
        var (svc, seed) = NewSvc();
        Job(seed, 1, FromCourier);
        Job(seed, 2, FromCourier);
        Job(seed, 3, FromCourier);
        await seed.SaveChangesAsync();

        var result = await svc.AssignAsync(ToTarget(1, 2, 3));

        // "Moved 3 jobs from 22 to 2"
        Assert.Equal(3, result.Moved);
        Assert.Equal(new[] { "22" }, result.FromCourierCodes);
        Assert.Equal("2", result.TargetCode);
    }
}
