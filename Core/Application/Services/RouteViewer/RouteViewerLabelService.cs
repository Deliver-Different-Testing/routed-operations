// Route Viewer label-render service.
//
// Label rendering owns the QuestPDF composition + SSRS token resolution
// against REP_qryAlertTemplateCell. Legacy RunViewer consumes the
// internal `DeliverDifferent.AlertLabel.Data` NuGet package from an
// authenticated GitLab feed (`packages/projects/809`); wiring that
// package into this repo needs Kevin's GitLab credentials + a nuget
// source change.
//
// Rather than wait for the package auth to be plumbed, this service
// runs as an HTTP PROXY to Kevin's already-deployed legacy RunViewer
// label endpoints (`/Home/Labels/*`). The legacy app owns the
// AlertLabel package + SSRS credentials, so proxying takes zero
// additional infra. Kevin sets one env var:
//
//   RunViewerLabelProxyUrl = https://runviewer.deliverdifferent.com
//
// (or the tenant-scoped legacy URL) and every label endpoint here
// starts returning real PDFs. If the env var is missing, methods
// return a 501-shaped error with a clear message so operators know
// exactly what to configure.
//
// Long-term (P14): drop the proxy, install AlertLabel + wire
// IAlertLabelService directly. The controller surface + payload
// shapes are already stable so the swap is internal-only.
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Logging;
using RoutedOperations.Core.Application.Dtos.RouteViewer;

namespace RoutedOperations.Core.Application.Services.RouteViewer;

public class RouteViewerLabelService(
    HttpClient httpClient,
    ILogger<RouteViewerLabelService> logger)
{
    private static string? ProxyBase => Environment.GetEnvironmentVariable("RunViewerLabelProxyUrl");
    private static string? ProxyToken => Environment.GetEnvironmentVariable("RunViewerLabelProxyToken");

    public Task<byte[]> GetSingleJobLabelAsync(int jobId)
        => ProxyGetPdfAsync($"/Home/Labels/Job?jobId={jobId}", "single-job");

    public Task<byte[]> GetLhpJobLabelAsync(int jobId)
        => ProxyGetPdfAsync($"/Home/Labels/LhpJob?jobId={jobId}", "lhp-job");

    public Task<byte[]> GetSingleBulkLabelAsync(int bulkJobId)
        => ProxyGetPdfAsync($"/Home/Labels/BulkJob?bulkJobId={bulkJobId}", "single-bulk");

    public Task<byte[]> GetBulkLabelsAsync(LabelRequest request)
        => ProxyPostPdfAsync("/Home/Labels/BulkJobs", request, "bulk-jobs");

    public Task<byte[]> GetBulkLabelsBySpeedAsync(LabelRequest request)
        => ProxyPostPdfAsync("/Home/Labels/BulkJobsBySpeed", request, "bulk-jobs-by-speed");

    public Task<byte[]> GetLineHaulLabelsAsync(LabelRequest request)
        => ProxyPostPdfAsync("/Home/Labels/LineHaulJobs", request, "linehaul-jobs");

    public async Task<string> GetLineHaulManifestCsvAsync(LabelRequest request)
    {
        var bytes = await ProxyGetBytesAsync(BuildManifestQuery(request), "linehaul-manifest",
            new MediaTypeWithQualityHeaderValue("text/csv"));
        return Encoding.UTF8.GetString(bytes);
    }

    /// <summary>Proxy the legacy `/Home/SendPOD?bulkJobId=&toEmail=`
    /// endpoint so operators can email a POD photo from the Route
    /// Viewer Detail pane. Legacy already owns the SES/SMTP transport
    /// + FromAddress env var + attachment composition; proxying keeps
    /// zero new infra here. Returns true on 200, false on any other
    /// status (caller surfaces via toast).</summary>
    public async Task<bool> SendPodEmailAsync(int bulkJobId, string toEmail)
    {
        var baseUrl = ProxyBase;
        if (string.IsNullOrWhiteSpace(baseUrl))
        {
            throw new InvalidOperationException(
                "Route Viewer SendPOD requires env var `RunViewerLabelProxyUrl` (same proxy the " +
                "label endpoints use). Set it to the deployed legacy RunViewer base URL.");
        }
        var qs = $"bulkJobId={bulkJobId}&toEmail={Uri.EscapeDataString(toEmail)}";
        var url = baseUrl.TrimEnd('/') + "/Home/SendPOD?" + qs;
        using var req = new HttpRequestMessage(HttpMethod.Get, url);
        AddAuth(req);
        logger.LogInformation("SendPOD proxy -> {Url}", url);
        var resp = await httpClient.SendAsync(req);
        if (!resp.IsSuccessStatusCode)
        {
            var body = await resp.Content.ReadAsStringAsync();
            logger.LogWarning("SendPOD proxy returned {Status}: {Body}", (int)resp.StatusCode, body);
        }
        return resp.IsSuccessStatusCode;
    }

    private static string BuildManifestQuery(LabelRequest r)
    {
        var qs = new List<string>();
        // Legacy manifest is keyed on BookDate (LabelRequest uses BookDate
        // for the delivery-window date; RunDate is a separate concept on
        // ReportRequest which the manifest doesn't share).
        if (r.BookDate.HasValue) qs.Add($"runDate={Uri.EscapeDataString(r.BookDate.Value.ToString("O"))}");
        if (!string.IsNullOrEmpty(r.RunName)) qs.Add($"runName={Uri.EscapeDataString(r.RunName)}");
        if (r.DepotId.HasValue) qs.Add($"depotId={r.DepotId}");
        if (!string.IsNullOrEmpty(r.ClientIds)) qs.Add($"clientIds={Uri.EscapeDataString(r.ClientIds)}");
        if (!string.IsNullOrEmpty(r.SpeedIds)) qs.Add($"speedIds={Uri.EscapeDataString(r.SpeedIds)}");
        return "/Home/Labels/LineHaulManifest?" + string.Join('&', qs);
    }

    private Task<byte[]> ProxyGetPdfAsync(string path, string tag)
        => ProxyGetBytesAsync(path, tag, new MediaTypeWithQualityHeaderValue("application/pdf"));

    private async Task<byte[]> ProxyGetBytesAsync(string path, string tag, MediaTypeWithQualityHeaderValue accept)
    {
        var baseUrl = ProxyBase;
        if (string.IsNullOrWhiteSpace(baseUrl))
        {
            throw new InvalidOperationException(
                "Route Viewer label proxy requires env var `RunViewerLabelProxyUrl` (set to the deployed " +
                "legacy RunViewer base URL). Once set, label endpoints proxy through and return the " +
                "AlertLabel-generated PDF verbatim. Long-term (P14) the proxy is dropped in favour of " +
                "adding the DeliverDifferent.AlertLabel.Data package directly.");
        }
        var url = baseUrl.TrimEnd('/') + path;
        using var req = new HttpRequestMessage(HttpMethod.Get, url);
        req.Headers.Accept.Add(accept);
        AddAuth(req);
        logger.LogInformation("Label proxy GET {Tag} -> {Url}", tag, url);
        var resp = await httpClient.SendAsync(req);
        return await ReadOrThrowAsync(resp, tag);
    }

    private async Task<byte[]> ProxyPostPdfAsync<T>(string path, T body, string tag)
    {
        var baseUrl = ProxyBase;
        if (string.IsNullOrWhiteSpace(baseUrl))
        {
            throw new InvalidOperationException(
                "Route Viewer label proxy requires env var `RunViewerLabelProxyUrl` (see comment on the " +
                "service). Set it to the deployed legacy RunViewer base URL to activate label rendering.");
        }
        var url = baseUrl.TrimEnd('/') + path;
        using var req = new HttpRequestMessage(HttpMethod.Post, url)
        {
            Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json"),
        };
        req.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/pdf"));
        AddAuth(req);
        logger.LogInformation("Label proxy POST {Tag} -> {Url}", tag, url);
        var resp = await httpClient.SendAsync(req);
        return await ReadOrThrowAsync(resp, tag);
    }

    private static void AddAuth(HttpRequestMessage req)
    {
        var token = ProxyToken;
        if (!string.IsNullOrEmpty(token))
        {
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        }
    }

    private static async Task<byte[]> ReadOrThrowAsync(HttpResponseMessage resp, string tag)
    {
        if (!resp.IsSuccessStatusCode)
        {
            var body = await resp.Content.ReadAsStringAsync();
            throw new InvalidOperationException(
                $"Label proxy {tag} returned {(int)resp.StatusCode}: {body}");
        }
        return await resp.Content.ReadAsByteArrayAsync();
    }
}
