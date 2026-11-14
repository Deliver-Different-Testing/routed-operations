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
    INpScopeGuard scopeGuard,
    ILogger<RouteViewerScanService> logger) : BaseService(contextFactory)
{
    /// <summary>GET /api/runviewer/scans - Bulk-mode Scan Manager grid.
    /// NP short-circuits to empty (Section 1 NP scope rule).</summary>
    public async Task<List<BulkScanJobDto>> GetBulkScanJobsAsync(BulkRunListRequest request)
    {
        var scope = await scopeResolver.ResolveAsync();
        if (!scope.IsAdmin) return new List<BulkScanJobDto>();

        // SP signature (verified 2026-08-11): 4 params.
        // SP output (verified via sp_describe_first_result_set):
        // ClientID, ClientCode, JobNumber, DeliveryDate (varchar),
        // ReadyTime, CompanyName, ToAddress, ToSuburb, JobStatus,
        // JobID, BulkJobID, SortScanned, RunScanned, PickScanned,
        // InvalidPickScanned, TransferScanned, TransitScanned, BookTime,
        // Speed, SpeedID, Items, Multibox, BulkParentID.
        // DTO has DateOnly? on DeliveryDate + missing columns - use a
        // raw row + client-side mapper.
        var rows = await Context.Database.SqlQueryRaw<RawBulkScanRow>(
            @"EXEC dbo.RVW_stpScanJobs
                @ClientID = @ClientID,
                @RunDate = @RunDate,
                @Regions = @Regions,
                @ClientIDs = @ClientIDs",
            SpParam.Of("@ClientID", request.ClientId),
            SpParam.Of("@RunDate", request.RunDate),
            SpParam.Of("@Regions", request.RegionIds),
            SpParam.Of("@ClientIDs", request.ClientIds))
            .ToListAsync();
        return rows.Select(r => new BulkScanJobDto
        {
            BulkJobId = r.BulkJobID,
            BulkParentId = r.BulkParentID,
            JobNumber = r.JobNumber,
            ClientCode = r.ClientCode,
            DeliveryDate = r.DeliveryDate,
            ReadyTime = r.ReadyTime,
            ToAddress = r.ToAddress,
            Items = r.Items ?? 0,
            SortScanned = (byte)(r.SortScanned ?? 0),
            RunScanned = (byte)(r.RunScanned ?? 0),
            PickScanned = (byte)(r.PickScanned ?? 0),
            InvalidPickScanned = (byte)(r.InvalidPickScanned ?? 0),
            TransferScanned = (byte)(r.TransferScanned ?? 0),
            TransitScanned = (byte)(r.TransitScanned ?? 0),
        }).ToList();
    }

    /// <summary>Exact column shape of RVW_stpScanJobs output.</summary>
    private class RawBulkScanRow
    {
        public int ClientID { get; set; }
        public string? ClientCode { get; set; }
        public string? JobNumber { get; set; }
        public string? DeliveryDate { get; set; }
        public string? ReadyTime { get; set; }
        public string? CompanyName { get; set; }
        public string? ToAddress { get; set; }
        public string? ToSuburb { get; set; }
        public string? JobStatus { get; set; }
        public int? JobID { get; set; }
        public int BulkJobID { get; set; }
        public int? SortScanned { get; set; }
        public int? RunScanned { get; set; }
        public int? PickScanned { get; set; }
        public int? InvalidPickScanned { get; set; }
        public int? TransferScanned { get; set; }
        public int? TransitScanned { get; set; }
        public DateTime BookTime { get; set; }
        public string? Speed { get; set; }
        public int? SpeedID { get; set; }
        public short? Items { get; set; }
        public bool? Multibox { get; set; }
        public int? BulkParentID { get; set; }
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

        // SP signature: @ClientID / @RunDate / @Regions / @ClientIDs /
        // @NpAgentId (added 2026-11-13, migration 20261113140200, NP leak K2).
        // NP sessions pass their agent; the SP keeps only shipments whose
        // ROOT tucJob.NpAgentId matches. Admin passes NULL = all.
        // SP output columns (verified via sp_describe_first_result_set):
        // ClientID, ClientCode, JobNumber, JobID, DeliveryDate, ReadyTime,
        // ToAddress, ToSuburb, Items, ScannedItems, ExpectedItems, Totes,
        // LinehaulRuns, ExceptionCount, OpenTaskCount, LatestScanTime,
        // LatestScanType, JobStatus, Legs, CurrentLeg, ItemCount, Stage,
        // IsDivergent, HasShort. DTO has BulkJobId + CompanyName + Suburb
        // which don't map - use a raw row + client-side mapper.
        var rows = await Context.Database.SqlQueryRaw<RawRoutedScanRow>(
            @"EXEC dbo.RVW_stpScanJobsRouted
                @ClientID = @ClientID,
                @RunDate = @RunDate,
                @Regions = @Regions,
                @ClientIDs = @ClientIDs,
                @NpAgentId = @NpAgentId",
            SpParam.Of("@ClientID", effectiveClientId),
            SpParam.Of("@RunDate", request.RunDate),
            SpParam.Of("@Regions", request.RegionIds),
            SpParam.Of("@ClientIDs", effectiveClientIds),
            // B2: branch scope (BranchIds) joins here once B2 lands.
            SpParam.Of("@NpAgentId", scope.IsAdmin ? null : scope.NpAgentId))
            .ToListAsync();
        return rows.Select(r => new RoutedScanJobDto
        {
            JobId = r.JobID,
            BulkJobId = 0, // SP doesn't project a BulkJobID column; caller derives from JobID via jobs endpoint
            JobNumber = r.JobNumber,
            ClientCode = r.ClientCode,
            ToAddress = r.ToAddress,
            Suburb = r.ToSuburb,
            CompanyName = null,
            Stage = r.Stage,
            CurrentLeg = r.CurrentLeg,
            ItemCount = r.ItemCount,
            ScannedItems = r.ScannedItems,
            ExpectedItems = r.ExpectedItems,
            Legs = r.Legs,
            HasShort = r.HasShort ?? false,
            IsDivergent = r.IsDivergent ?? false,
        }).ToList();
    }

    /// <summary>Exact column shape of RVW_stpScanJobsRouted output. Kept
    /// separate from the wire DTO so EF's strict FromSql column-match
    /// stays happy and the DTO can grow independent client-side aliases.</summary>
    private class RawRoutedScanRow
    {
        public int? ClientID { get; set; }
        public string? ClientCode { get; set; }
        public string? JobNumber { get; set; }
        public int JobID { get; set; }
        public string? DeliveryDate { get; set; }
        public string? ReadyTime { get; set; }
        public string? ToAddress { get; set; }
        public string? ToSuburb { get; set; }
        public short? Items { get; set; }
        public int ScannedItems { get; set; }
        public int ExpectedItems { get; set; }
        public string? Totes { get; set; }
        public string? LinehaulRuns { get; set; }
        public int? ExceptionCount { get; set; }
        public int? OpenTaskCount { get; set; }
        public DateTime? LatestScanTime { get; set; }
        public string? LatestScanType { get; set; }
        public string? JobStatus { get; set; }
        public string Legs { get; set; } = string.Empty;
        public string? CurrentLeg { get; set; }
        public int ItemCount { get; set; }
        public string? Stage { get; set; }
        public bool? IsDivergent { get; set; }
        public bool? HasShort { get; set; }
    }

    /// <summary>GET /api/runviewer/scans/routed-detail?rootJobId=&runDate=
    /// Full routed shipment detail (dead-code fallback drawer per Section
    /// Z). Returns 5 JSON-string columns for React to double-parse.
    /// </summary>
    public async Task<RoutedShipmentDetailDto?> GetRoutedShipmentDetailAsync(int rootJobId, DateTime? runDate)
    {
        var scope = await scopeResolver.ResolveAsync();
        if (!scope.IsAdmin && scope.NpAgentId == null) return null;

        // NP leak K3 (2026-11-13): the root job must be in the caller's NP
        // scope. Throws NpLabelScopeException -> 403; no-op for admin.
        // B2: branch scope check joins here once B2 lands.
        await scopeGuard.EnsureTucJobInScopeAsync(rootJobId);

        // EXEC is not composable, so FirstOrDefaultAsync (which wraps the
        // EXEC in a SELECT TOP 1) threw for every caller. Materialise first.
        var rows = await Context.Database.SqlQueryRaw<RawRoutedShipmentDetailRow>(
            @"EXEC dbo.RVW_stpRoutedShipmentDetail @RootJobID, @RunDate",
            SpParam.Of("@RootJobID", rootJobId),
            SpParam.Of("@RunDate", runDate))
            .ToListAsync();
        var r = rows.FirstOrDefault();
        if (r == null) return null;
        return new RoutedShipmentDetailDto
        {
            RootJobId = r.RootJobID,
            JobNumber = r.JobNumber,
            ClientCode = r.ClientCode,
            ToAddress = r.ToAddress,
            Totes = r.Totes,
            Mismatches = r.Mismatches,
            Legs = r.Legs,
            Exceptions = r.Exceptions,
            OpenTasks = r.OpenTasks,
        };
    }

    /// <summary>C# port of dbo.UTL_fncGetBulkJob_BaseJobNumber (the app DB
    /// login has no EXECUTE on the function): text before the first "LH",
    /// else before the first "DEL", else the whole string. Case-insensitive
    /// like PATINDEX under the default CI collation.</summary>
    public static string BaseJobNumber(string scan)
    {
        var lh = scan.IndexOf("LH", StringComparison.OrdinalIgnoreCase);
        if (lh >= 0) return scan[..lh];
        var del = scan.IndexOf("DEL", StringComparison.OrdinalIgnoreCase);
        if (del >= 0) return scan[..del];
        return scan;
    }

    /// <summary>Exact column shape of RVW_stpRoutedShipmentDetail.</summary>
    private class RawRoutedShipmentDetailRow
    {
        public int RootJobID { get; set; }
        public string? JobNumber { get; set; }
        public string? ClientCode { get; set; }
        public string? ToAddress { get; set; }
        public string? Totes { get; set; }
        public string? Mismatches { get; set; }
        public string? Legs { get; set; }
        public string? Exceptions { get; set; }
        public string? OpenTasks { get; set; }
    }

    /// <summary>GET /api/runviewer/scans/detail?runDate=&scan=&rootJobId=
    /// Scan Detail panel rows (Time / Scan / Location / By columns).
    /// Routed mode passes rootJobId; Bulk mode passes only scan. The
    /// Runs / Print Manager / Linehaul detail box passes bulkJobId, which
    /// resolves to (job number, book date) the way legacy
    /// homeControl.loadScanDetailForJob called it.</summary>
    public async Task<List<BulkScanDetailDto>> GetScanDetailAsync(DateTime? runDate, string? scan, int? rootJobId, int? bulkJobId = null)
    {
        var scope = await scopeResolver.ResolveAsync();
        if (!scope.IsAdmin && scope.NpAgentId == null) return new List<BulkScanDetailDto>();

        var scanFromBulkJob = false;
        if (bulkJobId is > 0)
        {
            // NP leak K4: the bulk job must be in scope (no-op for admin).
            await scopeGuard.EnsureBulkJobInScopeAsync(bulkJobId.Value);
            var bulk = await Context.TblBulkJobs
                .Where(b => b.BulkJobId == bulkJobId.Value)
                .Select(b => new { b.JobNumber, b.BookDate })
                .FirstOrDefaultAsync();
            if (bulk == null) return new List<BulkScanDetailDto>();
            scan = bulk.JobNumber;
            runDate ??= bulk.BookDate.Date;
            scanFromBulkJob = true;
        }

        if (!scope.IsAdmin)
        {
            // NP leak K4 (2026-11-13). RVW_stpScanDetail filters tblBulkScan
            // by the job number derived from @Scan and tblScan by the family
            // of @RootJobID, so both inputs must be in scope:
            //  - rootJobId: the root tucJob must belong to the NP;
            //  - scan (caller-supplied): the SP matches tblBulkScan.Scan
            //    LIKE base + '%', base = UTL_fncGetBulkJob_BaseJobNumber(scan).
            //    The base must be the exact job number of tucJob row(s) that
            //    all belong to the NP; anything else (partial prefix, item
            //    barcode, unknown) is refused. The RO UI never sends a raw
            //    scan (Scan Manager sends rootJobId, the detail box sends
            //    bulkJobId), so this only closes the direct-API path.
            //    A scan derived from bulkJobId above is already guarded.
            // B2: branch scope check joins here once B2 lands.
            if (string.IsNullOrWhiteSpace(scan)) scan = null;
            if (rootJobId == null && scan == null) return new List<BulkScanDetailDto>();
            if (rootJobId != null)
                await scopeGuard.EnsureTucJobInScopeAsync(rootJobId.Value);
            if (scan != null && !scanFromBulkJob)
            {
                var baseNumber = BaseJobNumber(scan);
                var exists = baseNumber.Length > 0
                    && await Context.TucJobs.AnyAsync(j => j.UcjbNumber == baseNumber);
                if (!exists)
                    throw new NpLabelScopeException("Scan is outside your NP scope.");
                await scopeGuard.EnsureTucJobByNumberInScopeAsync(baseNumber);
            }
        }

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

        // NP leak K5 (2026-11-13): root job must be in scope. No-op for admin.
        // B2: branch scope check joins here once B2 lands.
        await scopeGuard.EnsureTucJobInScopeAsync(rootJobId);

        // The SP emits RootJobID / ToteBarcode / LinehaulRunId, not the DTO's
        // JobId / Tote / ScanTime, so direct materialisation threw for every
        // caller. Map through the raw SP shape.
        var rows = await Context.Database.SqlQueryRaw<RawItemProgressRow>(
            @"EXEC dbo.RVW_stpScanManagerItemProgress @RootJobID",
            SpParam.Of("@RootJobID", rootJobId))
            .ToListAsync();
        return rows.Select(r => new RoutedItemProgressDto
        {
            JobId = r.RootJobID,
            ItemBarcode = r.ItemBarcode,
            Leg = r.Leg,
            State = r.State,
            Tote = r.ToteBarcode,
            IsCurrent = r.IsCurrent ?? false,
            ScanTime = null,
        }).ToList();
    }

    /// <summary>Exact column shape of RVW_stpScanManagerItemProgress.</summary>
    private class RawItemProgressRow
    {
        public int RootJobID { get; set; }
        public string? ItemBarcode { get; set; }
        public string? Leg { get; set; }
        public int? LinehaulRunId { get; set; }
        public string? State { get; set; }
        public string? ToteBarcode { get; set; }
        public bool? IsCurrent { get; set; }
    }

    /// <summary>POST /api/runviewer/scans/remove-missing - purges
    /// missing-scan LHP / DEL child rows for the given run-date + filter
    /// slice. Wraps legacy RVW_stpRemoveMissingScanJobs. Admin only per
    /// legacy behaviour - NP short-circuits (no missing-scan surface on
    /// the NP-scoped Scan Manager).</summary>
    public async Task<bool> RemoveMissingScanJobsAsync(RemoveMissingScanRequest request)
    {
        var scope = await scopeResolver.ResolveAsync();
        if (!scope.IsAdmin)
        {
            logger.LogWarning("RemoveMissingScanJobs blocked for NP session.");
            return false;
        }
        logger.LogInformation("RVW_stpRemoveMissingScanJobs runDate={RunDate} clientId={ClientId} clientIds={ClientIds} regions={Regions} speeds={Speeds}",
            request.RunDate, request.ClientId, request.ClientIds, request.RegionIds, request.SpeedIds);
        await Context.Database.ExecuteSqlRawAsync(
            @"EXEC dbo.RVW_stpRemoveMissingScanJobs
                @ClientID = @ClientID,
                @RunDate = @RunDate,
                @Regions = @Regions,
                @ClientIDs = @ClientIDs,
                @SpeedIDs = @SpeedIDs",
            SpParam.Of("@ClientID", request.ClientId),
            SpParam.Of("@RunDate", request.RunDate),
            SpParam.Of("@Regions", request.RegionIds),
            SpParam.Of("@ClientIDs", request.ClientIds),
            SpParam.Of("@SpeedIDs", request.SpeedIds));
        return true;
    }
}

public class RemoveMissingScanRequest
{
    public DateTime? RunDate { get; set; }
    public int? ClientId { get; set; }
    public string? ClientIds { get; set; }
    public string? RegionIds { get; set; }
    public string? SpeedIds { get; set; }
}
