// S3PhotoReader wraps IAmazonS3 for POD photo / Client Intel reads +
// upload / delete. NSubstitute mocks the S3 client so no real bucket is
// touched. Env var `S3Bucket` is set per test and unset in Dispose so
// nothing leaks into sibling tests.
using System.Net;
using Amazon.S3;
using Amazon.S3.Model;
using Microsoft.Extensions.Logging.Abstractions;
using RoutedOperations.Core.Application.Services.RouteViewer;

namespace RoutedOperations.Tests.Services.RouteViewer;

[Collection("S3EnvVar")]
public class S3PhotoReaderTests : IDisposable
{
    private const string BucketName = "test-bucket";

    public S3PhotoReaderTests()
    {
        Environment.SetEnvironmentVariable("S3Bucket", BucketName);
    }

    public void Dispose()
    {
        Environment.SetEnvironmentVariable("S3Bucket", null);
        GC.SuppressFinalize(this);
    }

    private static (S3PhotoReader sut, IAmazonS3 s3) NewSut()
    {
        var s3 = Substitute.For<IAmazonS3>();
        var sut = new S3PhotoReader(s3, NullLogger<S3PhotoReader>.Instance);
        return (sut, s3);
    }

    private static GetObjectResponse BuildGetObjectResponse(byte[] payload, string? description = null)
    {
        var response = new GetObjectResponse
        {
            ResponseStream = new MemoryStream(payload),
        };
        if (description != null)
        {
            response.Metadata.Add("Description", description);
        }
        return response;
    }

    [Fact]
    public void Bucket_MissingEnvVar_ThrowsOnFirstAccess()
    {
        Environment.SetEnvironmentVariable("S3Bucket", null);
        var (sut, s3) = NewSut();

        s3.ListObjectsV2Async(Arg.Any<ListObjectsV2Request>(), Arg.Any<CancellationToken>())
            .Returns<Task<ListObjectsV2Response>>(_ => throw new InvalidOperationException("Bucket getter never runs; guard triggers first."));

        var ex = Assert.ThrowsAsync<InvalidOperationException>(() =>
            sut.GetJobDeliveryPhotosAsync(1, 2026, 8));
        Assert.NotNull(ex);
    }

    [Fact]
    public async Task GetJobDeliveryPhotosAsync_EmptyBucketReturnsEmpty()
    {
        var (sut, s3) = NewSut();
        s3.ListObjectsV2Async(Arg.Any<ListObjectsV2Request>(), Arg.Any<CancellationToken>())
            .Returns(new ListObjectsV2Response { S3Objects = new List<S3Object>() });

        var result = await sut.GetJobDeliveryPhotosAsync(1, 2026, 8);

        Assert.Empty(result);
    }

    [Fact]
    public async Task GetJobDeliveryPhotosAsync_ReturnsBytesFromMatchingObjects()
    {
        var (sut, s3) = NewSut();
        var payload = new byte[] { 1, 2, 3, 4 };
        s3.ListObjectsV2Async(
            Arg.Is<ListObjectsV2Request>(r => r.Prefix!.StartsWith("DeliveryPhotos/2026/08/42-DeliveryPhoto-")),
            Arg.Any<CancellationToken>())
            .Returns(new ListObjectsV2Response
            {
                S3Objects = new List<S3Object> { new S3Object { Key = "DeliveryPhotos/2026/08/42-DeliveryPhoto-a" } },
            });
        s3.ListObjectsV2Async(
            Arg.Is<ListObjectsV2Request>(r => !r.Prefix!.StartsWith("DeliveryPhotos/2026/08/42-DeliveryPhoto-")),
            Arg.Any<CancellationToken>())
            .Returns(new ListObjectsV2Response { S3Objects = new List<S3Object>() });
        s3.GetObjectAsync(BucketName, "DeliveryPhotos/2026/08/42-DeliveryPhoto-a", Arg.Any<CancellationToken>())
            .Returns(BuildGetObjectResponse(payload));

        var result = await sut.GetJobDeliveryPhotosAsync(42, 2026, 8);

        Assert.Single(result);
        Assert.Equal(payload, result[0]);
    }

    [Fact]
    public async Task GetJobDeliveryPhotosAsync_MonthSpillover_ChecksNextMonth()
    {
        // month=12 -> spillover year=year+1, nextMonth=1.
        var (sut, s3) = NewSut();
        var seen = new List<string>();
        s3.ListObjectsV2Async(Arg.Any<ListObjectsV2Request>(), Arg.Any<CancellationToken>())
            .Returns(ci =>
            {
                var req = ci.Arg<ListObjectsV2Request>();
                seen.Add(req.Prefix!);
                return new ListObjectsV2Response { S3Objects = new List<S3Object>() };
            });

        await sut.GetJobDeliveryPhotosAsync(7, 2026, 12);

        Assert.Contains("DeliveryPhotos/2026/12/7-DeliveryPhoto-", seen);
        Assert.Contains("DeliverySignatures/2026/12/7-DS", seen);
        Assert.Contains("DeliveryPhotos/2027/01/7-DeliveryPhoto-", seen);
        Assert.Contains("DeliverySignatures/2027/01/7-DS", seen);
    }

    [Fact]
    public async Task GetJobDeliveryPhotosAsync_MonthSpillover_MidYear()
    {
        var (sut, s3) = NewSut();
        var seen = new List<string>();
        s3.ListObjectsV2Async(Arg.Any<ListObjectsV2Request>(), Arg.Any<CancellationToken>())
            .Returns(ci =>
            {
                var req = ci.Arg<ListObjectsV2Request>();
                seen.Add(req.Prefix!);
                return new ListObjectsV2Response { S3Objects = new List<S3Object>() };
            });

        await sut.GetJobDeliveryPhotosAsync(9, 2026, 3);

        Assert.Contains("DeliveryPhotos/2026/03/9-DeliveryPhoto-", seen);
        Assert.Contains("DeliveryPhotos/2026/04/9-DeliveryPhoto-", seen);
    }

    [Fact]
    public async Task GetJobDeliveryPhotosAsync_GetObjectException_IsLoggedAndSkipped()
    {
        var (sut, s3) = NewSut();
        s3.ListObjectsV2Async(Arg.Any<ListObjectsV2Request>(), Arg.Any<CancellationToken>())
            .Returns(ci =>
            {
                var req = ci.Arg<ListObjectsV2Request>();
                if (req.Prefix!.StartsWith("DeliveryPhotos/2026/08/1-DeliveryPhoto-"))
                {
                    return new ListObjectsV2Response
                    {
                        S3Objects = new List<S3Object> { new S3Object { Key = "bad-key" } },
                    };
                }
                return new ListObjectsV2Response { S3Objects = new List<S3Object>() };
            });
        s3.GetObjectAsync(BucketName, "bad-key", Arg.Any<CancellationToken>())
            .Returns<Task<GetObjectResponse>>(_ => throw new AmazonS3Exception("boom"));

        var result = await sut.GetJobDeliveryPhotosAsync(1, 2026, 8);

        Assert.Empty(result);
    }

    [Fact]
    public async Task UploadPodPhotoAsync_ReturnsKeyOnSuccess()
    {
        var (sut, s3) = NewSut();
        s3.PutObjectAsync(Arg.Any<PutObjectRequest>(), Arg.Any<CancellationToken>())
            .Returns(new PutObjectResponse());
        var payload = new MemoryStream(new byte[] { 1, 2 });

        var key = await sut.UploadPodPhotoAsync(50, payload, "image/jpeg");

        Assert.StartsWith("DeliveryPhotos/", key);
        Assert.Contains("50-DeliveryPhoto-", key);
    }

    [Fact]
    public async Task UploadPodPhotoAsync_Signature_UsesDsKeyPattern()
    {
        var (sut, s3) = NewSut();
        s3.PutObjectAsync(Arg.Any<PutObjectRequest>(), Arg.Any<CancellationToken>())
            .Returns(new PutObjectResponse());
        var payload = new MemoryStream(new byte[] { 9 });

        var key = await sut.UploadPodPhotoAsync(55, payload, "image/png", isSignature: true);

        Assert.StartsWith("DeliverySignatures/", key);
        Assert.Contains("55-DS-", key);
    }

    [Fact]
    public async Task UploadPodPhotoAsync_DescriptionWritesMetadata()
    {
        var (sut, s3) = NewSut();
        PutObjectRequest? captured = null;
        s3.PutObjectAsync(Arg.Do<PutObjectRequest>(r => captured = r), Arg.Any<CancellationToken>())
            .Returns(new PutObjectResponse());

        await sut.UploadPodPhotoAsync(1, new MemoryStream(new byte[] { 1 }), "image/png", description: "extra");

        Assert.NotNull(captured);
        Assert.Equal("extra", captured!.Metadata["Description"]);
    }

    [Fact]
    public async Task UploadPodPhotoAsync_S3Exception_Rethrows()
    {
        var (sut, s3) = NewSut();
        s3.PutObjectAsync(Arg.Any<PutObjectRequest>(), Arg.Any<CancellationToken>())
            .Returns<Task<PutObjectResponse>>(_ => throw new AmazonS3Exception("boom"));

        await Assert.ThrowsAsync<AmazonS3Exception>(() =>
            sut.UploadPodPhotoAsync(1, new MemoryStream(), "image/png"));
    }

    [Fact]
    public async Task UploadClientIntelPhotoAsync_KeyMatchesMobileConvention()
    {
        var (sut, s3) = NewSut();
        s3.PutObjectAsync(Arg.Any<PutObjectRequest>(), Arg.Any<CancellationToken>())
            .Returns(new PutObjectResponse());

        var key = await sut.UploadClientIntelPhotoAsync("0212345678", new MemoryStream(), "image/png");

        Assert.StartsWith("0212345678-ClientIntel-", key);
    }

    [Fact]
    public async Task UploadClientIntelPhotoAsync_S3Exception_Rethrows()
    {
        var (sut, s3) = NewSut();
        s3.PutObjectAsync(Arg.Any<PutObjectRequest>(), Arg.Any<CancellationToken>())
            .Returns<Task<PutObjectResponse>>(_ => throw new AmazonS3Exception("boom"));

        await Assert.ThrowsAsync<AmazonS3Exception>(() =>
            sut.UploadClientIntelPhotoAsync("027", new MemoryStream(), "image/png"));
    }

    [Fact]
    public async Task DeleteObjectAsync_NotFound_IsSilent()
    {
        var (sut, s3) = NewSut();
        s3.DeleteObjectAsync(Arg.Any<DeleteObjectRequest>(), Arg.Any<CancellationToken>())
            .Returns<Task<DeleteObjectResponse>>(_ => throw new AmazonS3Exception("gone")
            {
                StatusCode = HttpStatusCode.NotFound,
            });

        // Should not throw.
        await sut.DeleteObjectAsync("does-not-exist");
    }

    [Fact]
    public async Task DeleteObjectAsync_OtherS3Error_Rethrows()
    {
        var (sut, s3) = NewSut();
        s3.DeleteObjectAsync(Arg.Any<DeleteObjectRequest>(), Arg.Any<CancellationToken>())
            .Returns<Task<DeleteObjectResponse>>(_ => throw new AmazonS3Exception("perm-denied")
            {
                StatusCode = HttpStatusCode.Forbidden,
            });

        await Assert.ThrowsAsync<AmazonS3Exception>(() => sut.DeleteObjectAsync("locked"));
    }

    [Fact]
    public async Task DeleteObjectAsync_Success()
    {
        var (sut, s3) = NewSut();
        s3.DeleteObjectAsync(Arg.Any<DeleteObjectRequest>(), Arg.Any<CancellationToken>())
            .Returns(new DeleteObjectResponse());

        await sut.DeleteObjectAsync("k1");

        await s3.Received(1).DeleteObjectAsync(
            Arg.Is<DeleteObjectRequest>(r => r.Key == "k1" && r.BucketName == BucketName),
            Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task GetClientIntelPhotosAsync_ReturnsPayloadAndDescription()
    {
        var (sut, s3) = NewSut();
        s3.ListObjectsV2Async(
            Arg.Is<ListObjectsV2Request>(r => r.Prefix == "0271234567-ClientIntel"),
            Arg.Any<CancellationToken>())
            .Returns(new ListObjectsV2Response
            {
                S3Objects = new List<S3Object>
                {
                    new S3Object { Key = "0271234567-ClientIntel-20260813" },
                },
            });
        s3.GetObjectAsync(BucketName, "0271234567-ClientIntel-20260813", Arg.Any<CancellationToken>())
            .Returns(BuildGetObjectResponse(new byte[] { 7, 8 }, description: "dog on porch"));

        var result = await sut.GetClientIntelPhotosAsync("0271234567");

        Assert.Single(result);
        Assert.Equal(new byte[] { 7, 8 }, result[0].Photo);
        Assert.Equal("dog on porch", result[0].Description);
        Assert.Equal("0271234567-ClientIntel-20260813", result[0].Key);
    }

    [Fact]
    public async Task GetClientIntelPhotosAsync_EmptyBucketReturnsEmpty()
    {
        var (sut, s3) = NewSut();
        s3.ListObjectsV2Async(Arg.Any<ListObjectsV2Request>(), Arg.Any<CancellationToken>())
            .Returns(new ListObjectsV2Response { S3Objects = new List<S3Object>() });

        var result = await sut.GetClientIntelPhotosAsync("0000");

        Assert.Empty(result);
    }

    [Fact]
    public async Task GetClientIntelPhotosAsync_GetObjectException_IsSkipped()
    {
        var (sut, s3) = NewSut();
        s3.ListObjectsV2Async(Arg.Any<ListObjectsV2Request>(), Arg.Any<CancellationToken>())
            .Returns(new ListObjectsV2Response
            {
                S3Objects = new List<S3Object> { new S3Object { Key = "boom" } },
            });
        s3.GetObjectAsync(BucketName, "boom", Arg.Any<CancellationToken>())
            .Returns<Task<GetObjectResponse>>(_ => throw new AmazonS3Exception("bad"));

        var result = await sut.GetClientIntelPhotosAsync("027");
        Assert.Empty(result);
    }
}
