// Route Viewer label-render service.
//
// 2026-09-18: rewired off the legacy /Home/Labels/* HTTP proxy to a
// direct IAlertLabelService integration. RoutedOperations now owns
// label rendering the same way the legacy RunViewer does, via the
// DeliverDifferent.AlertLabel.Data NuGet package (GitLab project 809).
// The proxy pattern was a P14-interim stopgap; kicking it removes the
// "legacy has to be running for RoutedOps to print" landmine and lets
// George's Medical-Prod Print Run / Print Job Report flows work
// against the local backend once the operator hits the button. Body
// ported from RunViwer_Claude/RunViewer/Services/LabelService.cs.
//
// SendPodEmailAsync + GetLineHaulManifestCsvAsync are still proxy
// methods against the legacy backend - they call legacy /Home/SendPOD
// and /Home/Labels/LineHaulManifest respectively. Neither is part of
// the AlertLabel package (SendPOD wraps SES + email composition;
// LineHaulManifest is a Dapper-driven CSV). Porting each cleanly is
// a separate scope; leaving them as proxy keeps the operator-visible
// paths working when env var RunViewerLabelProxyUrl is set. Label PDF
// endpoints no longer need that env var.
using System.Data;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Dapper;
using DeliverDifferent.AlertLabel.Data.Models;
using DeliverDifferent.AlertLabel.Data.Services;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using RoutedOperations.Core.Application.Dtos.RouteViewer;
using RoutedOperations.Core.Application.Services.Np;
using RoutedOperations.Core.Domain;

namespace RoutedOperations.Core.Application.Services.RouteViewer;

public class RouteViewerLabelService(
    IDbContextFactory<DynamicDespatchDbContext> contextFactory,
    IAlertLabelService alertLabelService,
    INpScopeResolver npScopeResolver,
    INpScopeGuard npScopeGuard,
    HttpClient httpClient,
    ILogger<RouteViewerLabelService> logger) : BaseService(contextFactory)
{
    private static string? ProxyBase => Environment.GetEnvironmentVariable("RunViewerLabelProxyUrl");
    private static string? ProxyToken => Environment.GetEnvironmentVariable("RunViewerLabelProxyToken");

    // The label package opens its own SqlConnection, so it needs the tenant
    // connection string. Non-relational providers (the EF InMemory store the
    // unit tests use) have none and GetConnectionString() throws there, so an
    // empty string is handed over instead. In the app the provider is always
    // SQL Server and this is exactly GetConnectionString().
    private string TenantConnectionString =>
        Context.Database.IsRelational() ? Context.Database.GetConnectionString()! : string.Empty;

    // ─────────────────────────────────────────────────────────────────
    // Label PDF endpoints (Mode 1, 2, 4/8, 5, 6). AlertLabel-backed.
    // ─────────────────────────────────────────────────────────────────

    public async Task<byte[]> GetSingleJobLabelAsync(int jobId)
    {
        await npScopeGuard.EnsureTucJobInScopeAsync(jobId);
        var templateId = await GetTemplateIdForJobAsync(jobId);
        return await alertLabelService.GeneratePdfAsync(new AlertLabelRequest
        {
            ConnectionString = TenantConnectionString,
            TemplateId       = templateId,
            JobId            = jobId,
            Mode             = 1,
        });
    }

    // LHP jobs live in tblJob with no tblBulkJob row. Use the bulk
    // template so the single-click PDF matches the page produced by
    // the bulk-form run print. Legacy: LabelService.GetLhpLabel.
    public async Task<byte[]> GetLhpJobLabelAsync(int jobId)
    {
        await npScopeGuard.EnsureTucJobInScopeAsync(jobId);
        var templateId = await GetDefaultBulkTemplateIdAsync();
        return await alertLabelService.GeneratePdfAsync(new AlertLabelRequest
        {
            ConnectionString = TenantConnectionString,
            TemplateId       = templateId,
            JobId            = jobId,
            Mode             = 1,
        });
    }

    public async Task<byte[]> GetSingleBulkLabelAsync(int bulkJobId)
    {
        await npScopeGuard.EnsureBulkJobInScopeAsync(bulkJobId);
        var templateId = await GetTemplateIdForBulkJobAsync(bulkJobId);
        return await alertLabelService.GeneratePdfAsync(new AlertLabelRequest
        {
            ConnectionString = TenantConnectionString,
            TemplateId       = templateId,
            JobId            = bulkJobId,
            Mode             = 2,
        });
    }

    public async Task<byte[]> GetBulkLabelsAsync(LabelRequest request)
    {
        await EnsureBulkLabelFlowSupportedForNpAsync();
        var templateId = await GetDefaultBulkTemplateIdAsync();
        var trimmedRun = request.RunName?.Trim();

        // Routed run -> Mode 8, otherwise Mode 4 (bulk-form run). Route Viewer
        // sends JobIds only for routed runs (the grid's tucJob ids), so their
        // presence settles it without the dbo.Routes lookup. Without JobIds a
        // run name found in dbo.Routes still selects Mode 8, which then
        // searches by route and leg number (the pre-#855 behaviour).
        var routed = NormalizeIdCsv(request.JobIds) is not null
            || (!string.IsNullOrEmpty(trimmedRun) && await IsRoutedRunAsync(trimmedRun));

        return await alertLabelService.GeneratePdfAsync(
            BuildBulkRunRequest(request, templateId, TenantConnectionString, routed));
    }

    /// <summary>Builds the label-package request for a Print Run: Mode 8 for
    /// a routed run, Mode 4 for a bulk-form run. Both carry the operator's
    /// Speed filter, the jobs on screen and the sort pick (ticket #855: all
    /// three were dropped on the routed path, and Speed plus jobs on the bulk
    /// path).</summary>
    public static AlertLabelRequest BuildBulkRunRequest(
        LabelRequest request, int templateId, string connectionString, bool routed)
    {
        var trimmedRun = request.RunName?.Trim();
        var bookDate   = request.BookDate ?? DateTime.Today;

        if (routed)
        {
            return new AlertLabelRequest
            {
                ConnectionString = connectionString,
                TemplateId       = templateId,
                Mode             = 8,
                BookDate         = bookDate.Date,
                ClientIds        = NullIfBlank(request.ClientIds),
                CourierIds       = NullIfBlank(request.CourierIds),
                RegionIds        = NullIfBlank(request.RegionIds),
                RunName          = trimmedRun,
                JobIds           = NormalizeIdCsv(request.JobIds),
                BulkJobIds       = NormalizeIdCsv(request.BulkJobIds),
                SpeedIds         = NormalizeIdCsv(request.SpeedIds),
                SortMode         = request.SortMode ?? 1,
                SortDir          = request.SortDir  ?? 1,
            };
        }

        return new AlertLabelRequest
        {
            ConnectionString = connectionString,
            TemplateId       = templateId,
            Mode             = 4,
            BookDate         = bookDate,
            ClientIds        = request.ClientIds,
            CourierIds       = request.CourierIds,
            RegionIds        = request.RegionIds,
            RunName          = trimmedRun,
            BulkJobIds       = NormalizeIdCsv(request.BulkJobIds),
            SpeedIds         = NormalizeIdCsv(request.SpeedIds),
            SortMode         = request.SortMode ?? 1,
            SortDir          = request.SortDir  ?? 1,
        };
    }

    /// <summary>Keeps only positive integer ids from a CSV, so the label
    /// package's CAST(value AS INT) never sees a blank or junk token. Null
    /// when nothing usable is left.</summary>
    public static string? NormalizeIdCsv(string? csv)
    {
        if (string.IsNullOrWhiteSpace(csv)) return null;
        var ids = csv.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(t => int.TryParse(t, out var n) ? n : 0)
            .Where(n => n > 0)
            .Distinct()
            .ToList();
        return ids.Count == 0 ? null : string.Join(',', ids);
    }

    public async Task<byte[]> GetBulkLabelsBySpeedAsync(LabelRequest request)
    {
        await EnsureBulkLabelFlowSupportedForNpAsync();
        var templateId = await GetDefaultBulkTemplateIdAsync();
        return await alertLabelService.GeneratePdfAsync(new AlertLabelRequest
        {
            ConnectionString = TenantConnectionString,
            TemplateId       = templateId,
            Mode             = 5,
            BookDate         = request.BookDate ?? DateTime.Today,
            ClientIds        = request.ClientIds,
            SpeedIds         = request.SpeedIds,
            RegionIds        = request.RegionIds,
            BulkJobIds       = request.BulkJobIds,
            SortMode         = request.SortMode ?? 1,
            SortDir          = request.SortDir  ?? 1,
        });
    }

    public async Task<byte[]> GetLineHaulLabelsAsync(LabelRequest request)
    {
        // Was missing: the two sibling bulk flows above both open with this
        // guard, and the controller doc comment already claimed "NP blocked".
        await EnsureBulkLabelFlowSupportedForNpAsync();
        var templateId = await GetDefaultBulkTemplateIdAsync();
        return await alertLabelService.GeneratePdfAsync(new AlertLabelRequest
        {
            ConnectionString = TenantConnectionString,
            TemplateId       = templateId,
            Mode             = 6,
            RunDate          = request.BookDate ?? DateTime.Today,
            RunName          = request.RunName?.Trim(),
            ToDepotId        = request.DepotId,
            ClientIds        = request.ClientIds,
            SpeedIds         = request.SpeedIds,
        });
    }

    // ─────────────────────────────────────────────────────────────────
    // Still-proxied endpoints (not part of the AlertLabel package).
    // ─────────────────────────────────────────────────────────────────

    public async Task<string> GetLineHaulManifestCsvAsync(LabelRequest request)
    {
        // Tenant-wide CSV proxied straight to legacy with no row filter of
        // any kind, so an NP must not reach it. Same guard as the bulk
        // label flows below.
        await EnsureBulkLabelFlowSupportedForNpAsync();
        var bytes = await ProxyGetBytesAsync(BuildManifestQuery(request), "linehaul-manifest",
            new MediaTypeWithQualityHeaderValue("text/csv"));
        return Encoding.UTF8.GetString(bytes);
    }

    /// <summary>Proxy the legacy `/Home/SendPOD?bulkJobId=&toEmail=`
    /// endpoint so operators can email a POD photo from the Route
    /// Viewer Detail pane. Legacy owns the SES/SMTP transport +
    /// attachment composition; porting that stack sits in a separate
    /// workstream. Env var `RunViewerLabelProxyUrl` still gates this
    /// method (labels no longer need it as of 2026-09-18).</summary>
    public async Task<bool> SendPodEmailAsync(int bulkJobId, string toEmail)
    {
        var baseUrl = ProxyBase;
        if (string.IsNullOrWhiteSpace(baseUrl))
        {
            throw new InvalidOperationException(
                "Route Viewer SendPOD requires env var `RunViewerLabelProxyUrl`. Set it to the deployed " +
                "legacy RunViewer base URL. (Label PDF endpoints no longer proxy - only SendPOD + " +
                "LineHaulManifest CSV still depend on legacy.)");
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

    // ─────────────────────────────────────────────────────────────────
    // Routed-run detection. A routed run is one whose name exists in
    // dbo.Routes.Name (synthetic-route system joining tucJob.RouteId ->
    // Routes.RouteId). dbo.Routes may not exist on older tenants; in
    // that case we return false so Mode 4 handles all bulk-form prints.
    // ─────────────────────────────────────────────────────────────────
    private async Task<bool> IsRoutedRunAsync(string runName)
    {
        await using var conn = new SqlConnection(TenantConnectionString);
        await conn.OpenAsync();

        const string sql = @"
            IF OBJECT_ID(N'[dbo].[Routes]', N'U') IS NULL
                SELECT 0;
            ELSE
                SELECT CASE WHEN EXISTS (
                    SELECT 1 FROM dbo.Routes
                    WHERE LTRIM(RTRIM(ISNULL([Name], ''))) = LTRIM(RTRIM(@RunName))
                ) THEN 1 ELSE 0 END;";

        return await conn.ExecuteScalarAsync<int>(sql, new { RunName = runName }) == 1;
    }

    private static string? NullIfBlank(string? s) => string.IsNullOrWhiteSpace(s) ? null : s;

    // -----------------------------------------------------------------
    // Template ID lookup. AlertTemplate.TemplateType: 1 = Job label,
    // 2 = Bulk label.
    //
    // Job chain:  speed LabelId -> DefaultJobLabelId -> first type-1
    //             -> DefaultBulkLabelId -> first template of any type
    // Bulk chain: speed LabelId -> DefaultBulkLabelId -> first type-2
    //             -> DefaultJobLabelId -> first template of any type
    //
    // The two cross-type steps log a warning. They exist because a tenant
    // with only one kind of template should still print (#855: Medical prod
    // has a single bulk-type template, so every speed without its own
    // LabelId, Will Call among them, returned 501 on single print). Only a
    // tenant with no AlertTemplate at all gets the 501.
    // -----------------------------------------------------------------
    private const int TemplateTypeJob  = 1;
    private const int TemplateTypeBulk = 2;

    private async Task<int> GetTemplateIdForJobAsync(int jobId)
    {
        var job = await Context.TucJobs
            .Where(j => !j.UcjbVoid && j.UcjbId == jobId)
            .Select(j => new { j.UcjbSpeed })
            .FirstOrDefaultAsync();

        return await GetTemplateIdForSpeedAsync(job?.UcjbSpeed, TemplateTypeJob);
    }

    private async Task<int> GetTemplateIdForBulkJobAsync(int bulkJobId)
    {
        var bj = await Context.TblBulkJobs
            .Where(j => !j.Void && j.BulkJobId == bulkJobId)
            .Select(j => new { j.Speed })
            .FirstOrDefaultAsync();

        return await GetTemplateIdForSpeedAsync(bj?.Speed, TemplateTypeBulk);
    }

    private async Task<int> GetTemplateIdForSpeedAsync(int? speedId, int templateType)
    {
        if (speedId is not null)
        {
            var labelId = await Context.TucJobTypes
                .Where(s => s.UcjtId == speedId)
                .Select(s => s.LabelId)
                .FirstOrDefaultAsync();
            if (labelId is not null && await Context.AlertTemplates.AnyAsync(a => a.Id == labelId))
                return labelId.Value;
        }

        return await GetDefaultTemplateIdAsync(templateType);
    }

    private Task<int> GetDefaultBulkTemplateIdAsync() => GetDefaultTemplateIdAsync(TemplateTypeBulk);

    // Reads the FK columns directly (not the nav properties) so a NULL FK
    // doesn't NRE - the nav-property load path was the cause of the
    // tenant-wide 500 on US medical-staging in the legacy.
    private async Task<int> GetDefaultTemplateIdAsync(int templateType)
    {
        var settings = await Context.TblSettings
            .Select(s => new { s.DefaultJobLabelId, s.DefaultBulkLabelId })
            .FirstOrDefaultAsync();

        var isBulk       = templateType == TemplateTypeBulk;
        var otherType    = isBulk ? TemplateTypeJob : TemplateTypeBulk;
        var sameDefault  = isBulk ? settings?.DefaultBulkLabelId : settings?.DefaultJobLabelId;
        var otherDefault = isBulk ? settings?.DefaultJobLabelId  : settings?.DefaultBulkLabelId;

        if (sameDefault is not null) return sameDefault.Value;

        var sameTypeId = await FirstTemplateIdAsync(templateType);
        if (sameTypeId is not null) return sameTypeId.Value;

        var crossId = otherDefault
            ?? await FirstTemplateIdAsync(otherType)
            ?? await FirstTemplateIdAsync(null);
        if (crossId is not null)
        {
            logger.LogWarning(
                "No {Wanted} label template configured; using AlertTemplate {TemplateId} instead. " +
                "Set tblSetting.{Setting} to choose one explicitly.",
                isBulk ? "bulk" : "job", crossId.Value,
                isBulk ? "DefaultBulkLabelId" : "DefaultJobLabelId");
            return crossId.Value;
        }

        throw new InvalidOperationException(
            "No label template is configured for this tenant, so labels cannot be printed. " +
            "Ask ops to set up a label (AlertTemplate) and set tblSetting.DefaultJobLabelId / DefaultBulkLabelId.");
    }

    private Task<int?> FirstTemplateIdAsync(int? templateType) =>
        Context.AlertTemplates
            .Where(a => templateType == null || a.TemplateType == templateType)
            .OrderBy(a => a.Id)
            .Select(a => (int?)a.Id)
            .FirstOrDefaultAsync();

    // Bulk-label flow gate. Single-job label scope checks live in
    // INpScopeGuard. Bulk-label flows route through AlertLabel whose SP
    // does not yet accept @NpAgentId - we cannot guarantee the rendered
    // PDF excludes other NPs' jobs, so block NP callers until the
    // package SP is extended.
    private async Task EnsureBulkLabelFlowSupportedForNpAsync()
    {
        var scope = await npScopeResolver.ResolveAsync();
        if (scope.IsAdmin) return;

        throw new NpLabelScopeException(
            "Bulk label print is not yet available for NP users. " +
            "Please print labels one at a time from the job detail panel.");
    }

    // ─────────────────────────────────────────────────────────────────
    // Legacy-proxy helpers (used only by SendPodEmailAsync +
    // GetLineHaulManifestCsvAsync). Preserved verbatim from the P14
    // interim proxy service so the two still-proxied endpoints keep
    // working when RunViewerLabelProxyUrl is set.
    // ─────────────────────────────────────────────────────────────────
    private static string BuildManifestQuery(LabelRequest r)
    {
        var qs = new List<string>();
        if (r.BookDate.HasValue) qs.Add($"runDate={Uri.EscapeDataString(r.BookDate.Value.ToString("O"))}");
        if (!string.IsNullOrEmpty(r.RunName)) qs.Add($"runName={Uri.EscapeDataString(r.RunName)}");
        if (r.DepotId.HasValue) qs.Add($"depotId={r.DepotId}");
        if (!string.IsNullOrEmpty(r.ClientIds)) qs.Add($"clientIds={Uri.EscapeDataString(r.ClientIds)}");
        if (!string.IsNullOrEmpty(r.SpeedIds)) qs.Add($"speedIds={Uri.EscapeDataString(r.SpeedIds)}");
        return "/Home/Labels/LineHaulManifest?" + string.Join('&', qs);
    }

    private async Task<byte[]> ProxyGetBytesAsync(string path, string tag, MediaTypeWithQualityHeaderValue accept)
    {
        var baseUrl = ProxyBase;
        if (string.IsNullOrWhiteSpace(baseUrl))
        {
            throw new InvalidOperationException(
                $"Route Viewer legacy proxy ({tag}) requires env var `RunViewerLabelProxyUrl`. Label " +
                "PDF endpoints no longer need this - only LineHaulManifest CSV + SendPOD still proxy.");
        }
        var url = baseUrl.TrimEnd('/') + path;
        using var req = new HttpRequestMessage(HttpMethod.Get, url);
        req.Headers.Accept.Add(accept);
        AddAuth(req);
        logger.LogInformation("Legacy proxy GET {Tag} -> {Url}", tag, url);
        var resp = await httpClient.SendAsync(req);
        if (!resp.IsSuccessStatusCode)
        {
            var body = await resp.Content.ReadAsStringAsync();
            throw new InvalidOperationException(
                $"Legacy proxy {tag} returned {(int)resp.StatusCode}: {body}");
        }
        return await resp.Content.ReadAsByteArrayAsync();
    }

    private static void AddAuth(HttpRequestMessage req)
    {
        var token = ProxyToken;
        if (!string.IsNullOrEmpty(token))
        {
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        }
    }
}
