// Small S3 read helper for POD photos + Client Intel images. Two
// distinct patterns:
//
// - POD photos live at DeliveryPhotos/{yyyy}/{MM}/{jobId}-DeliveryPhoto-...
//   and DeliverySignatures/{yyyy}/{MM}/{jobId}-DS...
//   Month-boundary spillover: if the request lands on the 1st of a
//   month and finds nothing, also check the prior month.
//
// - Client Intel images live at {mobile}-ClientIntel-{yyyyMMddHHmmss}
//   Description stored in S3 object metadata under "Description" key.
//
// Reads only; write paths (SaveIntelFile upload, DeleteIntelFile) land
// with the P7 book flow.
using Amazon.S3;
using Amazon.S3.Model;
using Microsoft.Extensions.Logging;
using RoutedOperations.Core.Application.Dtos.RouteViewer;

namespace RoutedOperations.Core.Application.Services.RouteViewer;

public class S3PhotoReader(
    IAmazonS3 s3Client,
    ILogger<S3PhotoReader> logger)
{
    private static string Bucket => Environment.GetEnvironmentVariable("S3Bucket")
        ?? throw new InvalidOperationException("Env var 'S3Bucket' is not set.");

    /// <summary>Fetches POD photos + delivery signatures for a job.
    /// Legacy month-scoped path. Returns raw byte[] rows for the
    /// frontend carousel to render as data URLs.</summary>
    public async Task<List<byte[]>> GetJobDeliveryPhotosAsync(int jobId, int year, int month)
    {
        var results = new List<byte[]>();

        // Two prefix patterns; walk both. Month-boundary spillover -
        // also check the next month in case the SP's date came from a
        // job just barely into the next window.
        var patterns = new[]
        {
            $"DeliveryPhotos/{year:0000}/{month:00}/{jobId}-DeliveryPhoto-",
            $"DeliverySignatures/{year:0000}/{month:00}/{jobId}-DS",
        };
        var nextMonth = month == 12 ? 1 : month + 1;
        var nextYear  = month == 12 ? year + 1 : year;
        var spillover = new[]
        {
            $"DeliveryPhotos/{nextYear:0000}/{nextMonth:00}/{jobId}-DeliveryPhoto-",
            $"DeliverySignatures/{nextYear:0000}/{nextMonth:00}/{jobId}-DS",
        };

        foreach (var prefix in patterns.Concat(spillover))
        {
            var listResp = await s3Client.ListObjectsV2Async(new ListObjectsV2Request
            {
                BucketName = Bucket,
                Prefix = prefix,
            });
            foreach (var obj in listResp.S3Objects ?? new List<S3Object>())
            {
                try
                {
                    using var getResp = await s3Client.GetObjectAsync(Bucket, obj.Key);
                    using var ms = new MemoryStream();
                    await getResp.ResponseStream.CopyToAsync(ms);
                    results.Add(ms.ToArray());
                }
                catch (Exception ex)
                {
                    logger.LogWarning(ex, "Failed to read S3 object {Key}", obj.Key);
                }
            }
        }

        return results;
    }

    /// <summary>Fetches all Client Intel photos for a mobile number.
    /// Reads S3 metadata Description key for each.</summary>
    public async Task<List<ClientIntelImageDto>> GetClientIntelPhotosAsync(string mobile)
    {
        var results = new List<ClientIntelImageDto>();
        var prefix = $"{mobile}-ClientIntel";

        var listResp = await s3Client.ListObjectsV2Async(new ListObjectsV2Request
        {
            BucketName = Bucket,
            Prefix = prefix,
        });

        foreach (var obj in listResp.S3Objects ?? new List<S3Object>())
        {
            try
            {
                using var getResp = await s3Client.GetObjectAsync(Bucket, obj.Key);
                using var ms = new MemoryStream();
                await getResp.ResponseStream.CopyToAsync(ms);
                var description = getResp.Metadata["Description"];
                results.Add(new ClientIntelImageDto
                {
                    Key = obj.Key,
                    Photo = ms.ToArray(),
                    Description = description,
                });
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "Failed to read S3 client-intel object {Key}", obj.Key);
            }
        }

        return results;
    }
}
