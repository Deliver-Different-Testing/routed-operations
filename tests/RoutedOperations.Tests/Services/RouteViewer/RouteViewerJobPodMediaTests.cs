// Cheetah R4 (2026-11-28). CAPS route jobs have no tblBulkJob row, so the
// Detail carousel (keyed on bulkJobId) never showed their POD photos. The
// new read goes by tucJob id and walks the job family the way DespatchWeb
// does: a parent brings its child legs, a child brings only itself, and a
// photo filed under two legs is shown once. InMemory cannot run the leg SQL
// and S3 is external, so both are replaced by seams.
using Amazon.S3;
using Microsoft.Extensions.Logging.Abstractions;
using RoutedOperations.Core.Application.Services.Np;
using RoutedOperations.Core.Application.Services.RouteViewer;
using static RoutedOperations.Core.Application.Services.RouteViewer.RouteViewerJobService;

namespace RoutedOperations.Tests.Services.RouteViewer;

public class RouteViewerJobPodMediaTests
{
    private const int Parent = 500, LegA = 501, LegB = 502, VoidLeg = 503;
    private static readonly DateTime Done = new(2026, 11, 27, 16, 10, 0);
    private static readonly DateTime PickedUp = new(2026, 11, 27, 8, 0, 0);

    private sealed class FakeReader() : S3PhotoReader(Substitute.For<IAmazonS3>(), NullLogger<S3PhotoReader>.Instance)
    {
        public Dictionary<int, List<PodMediaObject>> ByJob { get; } = new();
        public List<(int JobId, DateTime Delivery, DateTime Pickup)> Calls { get; } = new();
        public bool NoBucket { get; set; }

        public override Task<List<PodMediaObject>> GetLegPodMediaAsync(int jobId, DateTime deliveryReference, DateTime pickupReference)
        {
            if (NoBucket) throw new InvalidOperationException("Env var 'S3Bucket' is not set.");
            Calls.Add((jobId, deliveryReference, pickupReference));
            return Task.FromResult(ByJob.TryGetValue(jobId, out var list) ? list : new List<PodMediaObject>());
        }
    }

    private sealed class Svc(FakeReader reader, INpScopeGuard guard, List<PodLegRow> legs)
        : RouteViewerJobService(RouteViewerTestHarness.Factory(RouteViewerTestHarness.NewOptions()),
            Substitute.For<INpScopeResolver>(), guard, RoutedOperations.Tests.Branches.BranchTestDoubles.Unrestricted(),
            reader, NullLogger<RouteViewerJobService>.Instance)
    {
        protected override Task<List<PodLegRow>> LoadPodLegsAsync(int jobId) => Task.FromResult(legs);
    }

    private static List<PodLegRow> Family() =>
    [
        new() { JobId = Parent, JobNumber = "C100", ParentId = null, CompletedTime = Done, PickUpTime = PickedUp },
        new() { JobId = LegB, JobNumber = "C100-2", ParentId = Parent, CompletedTime = Done },
        new() { JobId = LegA, JobNumber = "C100-1", ParentId = Parent, CompletedTime = null, PickUpTime = PickedUp },
        new() { JobId = VoidLeg, JobNumber = "C100-3", ParentId = Parent, IsVoid = true, CompletedTime = Done },
    ];

    private static PodMediaObject Obj(string key, string kind) => new(key, kind, [1, 2, 3]);

    [Fact]
    public async Task Parent_job_shows_its_own_and_every_child_legs_photos_labelled_by_leg()
    {
        var reader = new FakeReader();
        reader.ByJob[Parent] = [Obj("PickupPhotos/2026/11/500-a.jpg", "Pickup photo")];
        reader.ByJob[LegA] = [Obj("PickupPhotos/2026/11/501-a.jpg", "Pickup photo")];
        reader.ByJob[LegB] = [Obj("DeliveryPhotos/2026/11/502-a.jpg", "Delivery photo"), Obj("DeliverySignatures/2026/11/502-DS.png", "Signature")];
        reader.ByJob[VoidLeg] = [Obj("DeliveryPhotos/2026/11/503-a.jpg", "Delivery photo")];
        var guard = Substitute.For<INpScopeGuard>();

        var media = await new Svc(reader, guard, Family()).GetJobPodMediaAsync(Parent);

        await guard.Received(1).EnsureTucJobInScopeAsync(Parent);
        Assert.Equal(
            new[] { "C100 Pickup photo", "C100-1 Pickup photo", "C100-2 Delivery photo", "C100-2 Signature" },
            media.Select(m => $"{m.JobNumber} {m.Kind}"));
        Assert.DoesNotContain(media, m => m.JobId == VoidLeg);   // a voided leg's photos are not POD
    }

    [Fact]
    public async Task Each_leg_is_looked_up_in_the_month_it_was_done_or_picked_up()
    {
        var reader = new FakeReader();

        await new Svc(reader, Substitute.For<INpScopeGuard>(), Family()).GetJobPodMediaAsync(Parent);

        Assert.Equal((Parent, Done, PickedUp), reader.Calls.Single(c => c.JobId == Parent));
        var legA = reader.Calls.Single(c => c.JobId == LegA);    // not completed yet: delivery folder falls back to today
        Assert.Equal((DateTime.Today, PickedUp), (legA.Delivery, legA.Pickup));
    }

    [Fact]
    public async Task The_same_photo_under_two_legs_is_shown_once()
    {
        var reader = new FakeReader();
        var shared = Obj("DeliverySignatures/2026/11/500-DS.png", "Signature");
        reader.ByJob[Parent] = [shared];
        reader.ByJob[LegB] = [shared];

        var media = await new Svc(reader, Substitute.For<INpScopeGuard>(), Family()).GetJobPodMediaAsync(Parent);

        Assert.Equal(Parent, Assert.Single(media).JobId);
    }

    [Fact]
    public async Task A_child_leg_shows_only_its_own_photos()
    {
        var reader = new FakeReader();
        reader.ByJob[Parent] = [Obj("DeliveryPhotos/2026/11/500-a.jpg", "Delivery photo")];
        reader.ByJob[LegB] = [Obj("DeliveryPhotos/2026/11/502-a.jpg", "Delivery photo")];
        var legs = new List<PodLegRow> { new() { JobId = LegB, JobNumber = "C100-2", ParentId = Parent, CompletedTime = Done } };

        var media = await new Svc(reader, Substitute.For<INpScopeGuard>(), legs).GetJobPodMediaAsync(LegB);

        Assert.Equal(LegB, Assert.Single(media).JobId);
        Assert.Equal(new[] { LegB }, reader.Calls.Select(c => c.JobId));
    }

    [Fact]
    public async Task Missing_bucket_unknown_job_or_no_job_gives_an_empty_carousel_not_an_error()
    {
        var noBucket = new FakeReader { NoBucket = true };
        Assert.Empty(await new Svc(noBucket, Substitute.For<INpScopeGuard>(), Family()).GetJobPodMediaAsync(Parent));
        Assert.Empty(await new Svc(new FakeReader(), Substitute.For<INpScopeGuard>(), []).GetJobPodMediaAsync(Parent));
        var guard = Substitute.For<INpScopeGuard>();
        Assert.Empty(await new Svc(new FakeReader(), guard, Family()).GetJobPodMediaAsync(0));
        await guard.DidNotReceiveWithAnyArgs().EnsureTucJobInScopeAsync(default);
    }
}
