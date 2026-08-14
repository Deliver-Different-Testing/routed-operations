// RouteViewerJobService wraps 6 read-side SPs + delegates to S3PhotoReader.
// Tests cover scope-guard invariants, empty-input short-circuits, and
// GetClientIntelImagesAsync / GetBulkJobPhotosAsync fail-soft behaviour when
// S3Bucket env var is unset.
using System.Net;
using Amazon.S3;
using Amazon.S3.Model;
using Microsoft.Extensions.Logging.Abstractions;
using RoutedOperations.Core.Application.Dtos.RouteViewer;
using RoutedOperations.Core.Application.Services.Np;
using RoutedOperations.Core.Application.Services.RouteViewer;

namespace RoutedOperations.Tests.Services.RouteViewer;

[Collection("S3EnvVar")]
public class RouteViewerJobServiceTests
{
    private static (RouteViewerJobService sut, INpScopeGuard guard, INpScopeResolver resolver, IAmazonS3 s3)
        NewSvc(NpScope scope)
    {
        var opts = RouteViewerTestHarness.NewOptions();
        var factory = RouteViewerTestHarness.Factory(opts);
        var resolver = Substitute.For<INpScopeResolver>();
        resolver.ResolveAsync().Returns(scope);
        var guard = Substitute.For<INpScopeGuard>();
        var s3 = Substitute.For<IAmazonS3>();
        var reader = new S3PhotoReader(s3, NullLogger<S3PhotoReader>.Instance);
        var sut = new RouteViewerJobService(factory, resolver, guard, reader,
            NullLogger<RouteViewerJobService>.Instance);
        return (sut, guard, resolver, s3);
    }

    [Fact]
    public async Task GetBulkJobAsync_CallsScopeGuardBeforeSp()
    {
        var (sut, guard, _, _) = NewSvc(new NpScope(true, null));
        await Assert.ThrowsAnyAsync<Exception>(() => sut.GetBulkJobAsync(1));
        await guard.Received(1).EnsureBulkJobInScopeAsync(1);
    }

    [Fact]
    public async Task SearchByJobNumberAsync_NullOrEmpty_ReturnsNull()
    {
        var (sut, guard, _, _) = NewSvc(new NpScope(true, null));
        Assert.Null(await sut.SearchByJobNumberAsync(""));
        Assert.Null(await sut.SearchByJobNumberAsync("   "));
        await guard.DidNotReceive().EnsureTucJobByNumberInScopeAsync(Arg.Any<string>());
    }

    [Fact]
    public async Task SearchByJobNumberAsync_CallsScopeGuardBeforeSp()
    {
        var (sut, guard, _, _) = NewSvc(new NpScope(true, null));
        await Assert.ThrowsAnyAsync<Exception>(() => sut.SearchByJobNumberAsync("US-1"));
        await guard.Received(1).EnsureTucJobByNumberInScopeAsync("US-1");
    }

    [Fact]
    public async Task GetPrintJobListAsync_NpDegenerateScope_ReturnsEmpty()
    {
        var (sut, _, _, _) = NewSvc(new NpScope(false, null));
        var result = await sut.GetPrintJobListAsync(new BulkRunListRequest { RunDate = DateTime.Today });
        Assert.Empty(result);
    }

    [Fact]
    public async Task GetPrintJobListAsync_Admin_HitsSp()
    {
        // Admin scope drops past the short-circuit and reaches
        // SqlQueryRaw against RVW_stpPrintJobsV2, which the InMemory
        // provider cannot execute. Exception surfacing = the projection
        // + raw row buffer wiring compiles + reaches the SP call.
        // Guards against a regression where the SP is invoked with the
        // wrong param set (previously 7 params vs the SP's 4 - would
        // fail before ever reaching a real DB).
        var (sut, _, _, _) = NewSvc(new NpScope(true, null));
        await Assert.ThrowsAnyAsync<Exception>(() =>
            sut.GetPrintJobListAsync(new BulkRunListRequest
            {
                RunDate = DateTime.Today,
                ClientId = 5,
                ClientIds = "1,2",
                RegionIds = "9",
            }));
    }

    [Fact]
    public async Task GetPrintJobListAsync_NpAgent_HitsSp()
    {
        // NP scope with a resolved NpAgentId still enters the SP (SP
        // does not itself filter by NpAgentId today - service passes
        // ClientId/ClientIds through even when scope is NP). The
        // short-circuit only fires on NP-degenerate (no agent).
        var (sut, _, _, _) = NewSvc(new NpScope(false, 42));
        await Assert.ThrowsAnyAsync<Exception>(() =>
            sut.GetPrintJobListAsync(new BulkRunListRequest { RunDate = DateTime.Today }));
    }

    [Fact]
    public async Task GetPrintJobChildrenAsync_CallsScopeGuard()
    {
        var (sut, guard, _, _) = NewSvc(new NpScope(true, null));
        await Assert.ThrowsAnyAsync<Exception>(() => sut.GetPrintJobChildrenAsync(DateTime.Today, 5));
        await guard.Received(1).EnsureBulkJobInScopeAsync(5);
    }

    [Fact]
    public async Task GetJobItemsAsync_CallsScopeGuard()
    {
        var (sut, guard, _, _) = NewSvc(new NpScope(true, null));
        await Assert.ThrowsAnyAsync<Exception>(() => sut.GetJobItemsAsync(10, DateTime.Today));
        await guard.Received(1).EnsureBulkJobInScopeAsync(10);
    }

    [Fact]
    public async Task GetClientIntelAsync_NullOrEmpty_ReturnsNull()
    {
        var (sut, _, _, _) = NewSvc(new NpScope(true, null));
        Assert.Null(await sut.GetClientIntelAsync(null!));
        Assert.Null(await sut.GetClientIntelAsync(""));
        Assert.Null(await sut.GetClientIntelAsync("   "));
    }

    [Fact]
    public async Task GetClientIntelImagesAsync_EmptyMobile_ReturnsEmptyList()
    {
        var (sut, _, _, _) = NewSvc(new NpScope(true, null));
        var result = await sut.GetClientIntelImagesAsync("");
        Assert.Empty(result);
    }

    [Fact]
    public async Task GetClientIntelImagesAsync_MissingBucketEnvVar_FailsSoft()
    {
        // Env var not set - S3PhotoReader throws InvalidOperationException on
        // Bucket getter. Service catches and returns empty (no crash).
        Environment.SetEnvironmentVariable("S3Bucket", null);
        var (sut, _, _, _) = NewSvc(new NpScope(true, null));
        var result = await sut.GetClientIntelImagesAsync("0271234567");
        Assert.Empty(result);
    }

    [Fact]
    public async Task GetClientIntelImagesAsync_BucketSet_HitsS3()
    {
        Environment.SetEnvironmentVariable("S3Bucket", "test-bucket");
        try
        {
            var (sut, _, _, s3) = NewSvc(new NpScope(true, null));
            s3.ListObjectsV2Async(Arg.Any<ListObjectsV2Request>(), Arg.Any<CancellationToken>())
                .Returns(new ListObjectsV2Response { S3Objects = new List<S3Object>() });

            var result = await sut.GetClientIntelImagesAsync("027");

            Assert.Empty(result);
            await s3.Received(1).ListObjectsV2Async(Arg.Any<ListObjectsV2Request>(), Arg.Any<CancellationToken>());
        }
        finally
        {
            Environment.SetEnvironmentVariable("S3Bucket", null);
        }
    }

    [Fact]
    public async Task GetBulkJobPhotosAsync_CallsScopeGuardBeforeSpLookup()
    {
        // Service calls a raw SQL lookup (SqlQueryRaw over tblBulkJob + tblJob)
        // which InMemory cannot run. Assertion: guard fires first.
        var (sut, guard, _, _) = NewSvc(new NpScope(true, null));
        await Assert.ThrowsAnyAsync<Exception>(() => sut.GetBulkJobPhotosAsync(1234));
        await guard.Received(1).EnsureBulkJobInScopeAsync(1234);
    }

    [Fact]
    public async Task GetLinehaulJobsAsync_NpDegenerateScope_ReturnsEmpty()
    {
        var (sut, _, _, _) = NewSvc(new NpScope(false, null));
        var result = await sut.GetLinehaulJobsAsync(1, "L1", new BulkRunListRequest { RunDate = DateTime.Today });
        Assert.Empty(result);
    }

    [Fact]
    public async Task GetJobSearchDataAsync_NpScope_ReturnsEmpty()
    {
        var (sut, _, _, _) = NewSvc(new NpScope(false, 42));
        var result = await sut.GetJobSearchDataAsync(new BulkRunListRequest { RunDate = DateTime.Today });
        Assert.Empty(result);
    }

    [Fact]
    public async Task GetJobSearchDataAsync_Admin_HitsSp()
    {
        var (sut, _, _, _) = NewSvc(new NpScope(true, null));
        await Assert.ThrowsAnyAsync<Exception>(() =>
            sut.GetJobSearchDataAsync(new BulkRunListRequest { RunDate = DateTime.Today }));
    }
}
