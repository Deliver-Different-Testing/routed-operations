// Scan Manager read-side service. Wraps:
// - RVW_stpScanJobs (Bulk mode)
// - RVW_stpScanJobsRouted (Routed mode)
// - RVW_stpRoutedShipmentDetail (fallback drawer)
// - RVW_stpScanDetail (Scan Detail panel)
// - RVW_stpScanManagerItemProgress (item-progression lazy fetch)
//
// SECURITY: RVW_stpScanJobs is NP-blocked at the endpoint level - NP
// short-circuits to empty. Consistent with legacy behaviour + Section 1
// NP scope rules.
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using RoutedOperations.Core.Application.Dtos.RouteViewer;
using RoutedOperations.Core.Application.Services.Np;
using RoutedOperations.Core.Application.Services;
using RoutedOperations.Core.Domain;

namespace RoutedOperations.Core.Application.Services.RouteViewer;

public class RouteViewerScanService(
    IDbContextFactory<DynamicDespatchDbContext> contextFactory,
    INpScopeResolver scopeResolver,
    ILogger<RouteViewerScanService> logger) : BaseService(contextFactory)
{
    /// <summary>GET /api/runviewer/scans - Bulk-mode Scan Manager grid.
    /// NP short-circuits to empty (Section 1 NP scope rule).</summary>
    public async Task<List<BulkScanJobDto>> GetBulkScanJobsAsync(BulkRunListRequest request)
    {
        var scope = await scopeResolver.ResolveAsync();
        if (!scope.IsAdmin) return new List<BulkScanJobDto>();

        return await Context.Database.SqlQueryRaw<BulkScanJobDto>(
            @"EXEC dbo.RVW_stpScanJobs
                @RunDate, @ClientID, @ClientInternal, @MultipleClients,
                @ClientIds, @RegionIds",
            SpParam.Of("@RunDate", request.RunDate),
            SpParam.Of("@ClientID", request.ClientId),
            SpParam.Of("@ClientInternal", request.ClientInternal),
            SpParam.Of("@MultipleClients", request.MultipleClients),
            SpParam.Of("@ClientIds", request.ClientIds),
            SpParam.Of("@RegionIds", request.RegionIds))
            .ToListAsync();
    }

    /// <summary>GET /api/runviewer/scans/routed - Routed-mode Scan
    /// Manager grid (US default per 2026-07-07). NP-scoped via
    /// @NpAgentId on the SP.</summary>
    public async Task<List<RoutedScanJobDto>> GetRoutedScanJobsAsync(BulkRunListRequest request)
    {
        var scope = await scopeResolver.ResolveAsync();
        if (!scope.IsAdmin && scope.NpAgentId == null) return new List<RoutedScanJobDto>();

        int? effectiveClientId = scope.IsAdmin ? request.ClientId : null;
        string? effectiveClientIds = scope.IsAdmin ? request.ClientIds : null;

        return await Context.Database.SqlQueryRaw<RoutedScanJobDto>(
            @"EXEC dbo.RVW_stpScanJobsRouted
                @RunDate, @ClientID, @ClientInternal, @MultipleClients,
                @ClientIds, @RegionIds, @NpAgentId",
            SpParam.Of("@RunDate", request.RunDate),
            SpParam.Of("@ClientID", effectiveClientId),
            SpParam.Of("@ClientInternal", request.ClientInternal),
            SpParam.Of("@MultipleClients", request.MultipleClients),
            SpParam.Of("@ClientIds", effectiveClientIds),
            SpParam.Of("@RegionIds", request.RegionIds),
            SpParam.Of("@NpAgentId", scope.NpAgentId))
            .ToListAsync();
    }

    /// <summary>GET /api/runviewer/scans/routed-detail?rootJobId=&runDate=
    /// Full routed shipment detail (dead-code fallback drawer per Section
    /// Z). Returns 5 JSON-string columns for React to double-parse.
    /// </summary>
    public async Task<RoutedShipmentDetailDto?> GetRoutedShipmentDetailAsync(int rootJobId, DateTime? runDate)
    {
        var scope = await scopeResolver.ResolveAsync();
        if (!scope.IsAdmin && scope.NpAgentId == null) return null;

        return await Context.Database.SqlQueryRaw<RoutedShipmentDetailDto>(
            @"EXEC dbo.RVW_stpRoutedShipmentDetail @RootJobID, @RunDate",
            SpParam.Of("@RootJobID", rootJobId),
            SpParam.Of("@RunDate", runDate))
            .FirstOrDefaultAsync();
    }

    /// <summary>GET /api/runviewer/scans/detail?runDate=&scan=&rootJobId=
    /// Scan Detail panel rows (Time / Scan / Location / By columns).
    /// Routed mode passes rootJobId; Bulk mode passes only scan.</summary>
    public async Task<List<BulkScanDetailDto>> GetScanDetailAsync(DateTime? runDate, string? scan, int? rootJobId)
    {
        var scope = await scopeResolver.ResolveAsync();
        if (!scope.IsAdmin && scope.NpAgentId == null) return new List<BulkScanDetailDto>();

        // Column-shape note: RVW_stpScanDetail emits BulkScanID (not
        // ScanId) and does NOT project IsNpAgent. Materialise into a
        // matching raw row + map with IsNpAgent defaulted false. The
        // extended context columns (Leg / Location / Tote / Run /
        // ItemLabels / Role) match the DTO 1:1 by name so they pass
        // through.
        var raw = await Context.Database.SqlQueryRaw<RawBulkScanDetailRow>(
            @"EXEC dbo.RVW_stpScanDetail @RunDate = @RunDate, @Scan = @Scan, @RootJobID = @RootJobID",
            SpParam.Of("@RunDate", runDate),
            SpParam.Of("@Scan", scan),
            SpParam.Of("@RootJobID", rootJobId))
            .ToListAsync();
        return raw.Select(r => new BulkScanDetailDto
        {
            ScanId = r.BulkScanID,
            ScanDateTime = r.ScanDateTime,
            ScanDetail = r.ScanDetail,
            Courier = r.Courier,
            IsNpAgent = false,
            Leg = r.Leg,
            Location = r.Location,
            Tote = r.Tote,
            Run = r.Run,
            ItemLabels = r.ItemLabels,
            Role = r.Role,
        }).ToList();
    }

    // Row shape emitted by dbo.RVW_stpScanDetail. The DTO surface uses
    // ScanId (canonical camelCase); the SP uses BulkScanID; and neither
    // branch of the SP projects IsNpAgent. Kept as a private class so
    // the mapping stays localised.
    private class RawBulkScanDetailRow
    {
        public int BulkScanID { get; set; }
        public DateTime? ScanDateTime { get; set; }
        public string? ScanDetail { get; set; }
        public string? Courier { get; set; }
        public string? Leg { get; set; }
        public string? Location { get; set; }
        public string? Tote { get; set; }
        public string? Run { get; set; }
        public string? ItemLabels { get; set; }
        public string? Role { get; set; }
    }

    /// <summary>GET /api/runviewer/scans/item-progress?rootJobId= -
    /// per-item leg-track lazy fetch inside a Routed-mode expanded row.
    /// </summary>
    public async Task<List<RoutedItemProgressDto>> GetItemProgressAsync(int rootJobId)
    {
        var scope = await scopeResolver.ResolveAsync();
        if (!scope.IsAdmin && scope.NpAgentId == null) return new List<RoutedItemProgressDto>();

        return await Context.Database.SqlQueryRaw<RoutedItemProgressDto>(
            @"EXEC dbo.RVW_stpScanManagerItemProgress @RootJobID",
            SpParam.Of("@RootJobID", rootJobId))
            .ToListAsync();
    }
}
