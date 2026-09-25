// Route Viewer read-side run-list service. Wraps RVW_stpBulkRuns_2 +
// RVW_stpGetMissingJobRuns behind a single method that merges the two
// result sets into one BulkRunDto list, stamping IsMissing=true on rows
// from the missing branch. Threads @TenantTimeZone (post-2026-06-24 Track
// C Option B) + @NpAgentId (from INpScopeResolver) discipline captured
// in Runviewer-migration-tasktodo.md Sections 5 + T.
//
// Extends BaseService for the lazy DynamicDespatchDbContext. Serilog
// static logging per B.10 standard for parity with the rest of the
// codebase; only new Route Viewer services (P1+) adopt ILogger<T> DI.
// Actually per standards we use ILogger<T> going forward - swap on
// consolidation review; this service adopts it immediately.
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.AspNetCore.Http;
using RoutedOperations.Core.Application.Dtos.RouteViewer;
using RoutedOperations.Core.Application.Services.Np;
using RoutedOperations.Core.Application.Services;
using RoutedOperations.Core.Domain;

namespace RoutedOperations.Core.Application.Services.RouteViewer;

public class RouteViewerRunService(
    IDbContextFactory<DynamicDespatchDbContext> contextFactory,
    INpScopeResolver scopeResolver,
    SqlTimeZoneNormalizer tzNormalizer,
    IHttpContextAccessor httpContextAccessor,
    ILogger<RouteViewerRunService> logger) : BaseService(contextFactory)
{
    /// <summary>
    /// GET /api/runviewer/runs - primary read for the Route Viewer Home
    /// runList box. Returns the union of live bulk runs (RVW_stpBulkRuns_2)
    /// and missing-scan-only rows (RVW_stpGetMissingJobRuns), with
    /// IsMissing=true stamped on the latter branch. NP-scope is threaded
    /// via @NpAgentId; NP users receive rows filtered to their agent.
    /// Tenant TZ is normalised (Windows <-> IANA) so the SP's
    /// SYSUTCDATETIME() AT TIME ZONE conversion picks the right form for
    /// the SQL host platform.
    /// </summary>
    public async Task<List<BulkRunDto>> GetBulkRunListAsync(BulkRunListRequest request)
    {
        var scope = await scopeResolver.ResolveAsync();

        // Tenant TZ comes from the Hub-stamped TimeZone claim - same
        // source HomeController's AppUserBootstrap reads. Absent claim ->
        // null passed to SP, which reverts to server-local time (safe
        // fallback matching legacy).
        var tenantTz = httpContextAccessor.HttpContext?.User.Claims
            .FirstOrDefault(x => x.Type == "TimeZone")?.Value;
        var normalizedTz = await tzNormalizer.NormalizeAsync(tenantTz);

        logger.LogInformation(
            "GetBulkRunListAsync date={Date} clientId={ClientId} ClientIds={ClientIds} NpAgentId={NpAgentId} TZ={Tz}",
            request.RunDate, request.ClientId, request.ClientIds, scope.NpAgentId, normalizedTz);

        // NP-scoped session with no agent linkage returns empty (defence
        // in depth on top of the SP's own @NpAgentId=null branch).
        if (!scope.IsAdmin && scope.NpAgentId == null)
        {
            logger.LogWarning("NP scope without agent id - returning empty run list.");
            return new List<BulkRunDto>();
        }

        // NP-scoped sessions also null the client filter - the NP portal
        // client is not the customer client whose jobs they handle
        // (per master Section 1 NP scope rules).
        int? effectiveClientId = scope.IsAdmin ? request.ClientId : null;
        string? effectiveClientIds = scope.IsAdmin ? request.ClientIds : null;

        // Primary: RVW_stpBulkRuns_2. Tenant SP signature (verified 2026-08-07):
        // 7 params - RunDate, ClientID, Regions, ClientIDs, SpeedIDs,
        // NpAgentId, TenantTimeZone.
        var rawPrimary = await Context.Database.SqlQueryRaw<RawBulkRunRow>(
            @"EXEC dbo.RVW_stpBulkRuns_2
                @RunDate = @RunDate,
                @ClientID = @ClientID,
                @Regions = @Regions,
                @ClientIDs = @ClientIDs,
                @SpeedIDs = @SpeedIDs,
                @NpAgentId = @NpAgentId,
                @TenantTimeZone = @TenantTimeZone",
            SpParam.Of("@RunDate", request.RunDate),
            SpParam.Of("@ClientID", effectiveClientId),
            SpParam.Of("@Regions", request.RegionIds),
            SpParam.Of("@ClientIDs", effectiveClientIds),
            SpParam.Of("@SpeedIDs", request.SpeedIds),
            SpParam.Of("@NpAgentId", scope.NpAgentId),
            SpParam.Of("@TenantTimeZone", normalizedTz))
            .ToListAsync();

        // Missing branch: RVW_stpGetMissingJobRuns takes only @RunDate.
        // Result-set shape is a SUBSET of BulkRuns_2 (no TotalPickup /
        // IncompletePickup / FromCities / ToLocationName / AgentID /
        // AgentName / IsNpAgent columns) so a dedicated row class is
        // needed to satisfy EF's column-presence check.
        var rawMissing = await Context.Database.SqlQueryRaw<RawMissingRunRow>(
            @"EXEC dbo.RVW_stpGetMissingJobRuns @RunDate = @RunDate",
            SpParam.Of("@RunDate", request.RunDate))
            .ToListAsync();

        return rawPrimary
            .Select(r => MapBulkRun(r, isMissing: false))
            .Concat(rawMissing.Select(MapMissingRun))
            .ToList();
    }

    private static BulkRunDto MapMissingRun(RawMissingRunRow r) => new()
    {
        Id = int.TryParse(r.ID, out var i) ? i : 0,
        Name = r.Name,
        area = r.Area,
        Suburbs = r.Suburbs,
        Velocity = r.Velocity,
        Status = r.Status,
        Jobs = r.Total,
        IncompleteJobs = r.Incomplete,
        HasReturns = r.HasReturns,
        ReturnsTotal = r.ReturnsTotal,
        IsMissing = true,
        PreAssigned = r.PreAssigned,
        CourierName = r.CourierName,
        CourierCode = r.CourierCode,
        CourierPercentageFormatted = r.CourierPercentageFormatted,
        CourierOnlineStatus = r.CourierOnlineStatus,
        CourierOfflineMins = r.CourierOfflineMins,
    };

    private class RawMissingRunRow
    {
        public string? ID { get; set; }
        public string? Name { get; set; }
        public string? Area { get; set; }
        public string? Velocity { get; set; }
        public string? Status { get; set; }
        public int? CourierID { get; set; }
        public string? CourierName { get; set; }
        public string? CourierCode { get; set; }
        public string? CourierPercentageFormatted { get; set; }
        // tblBulkRun.Kms is float in the DB; projecting as int? throws
        // InvalidCastException in EF materialisation the moment any run
        // in the returned set has a non-null Kms (SqlDataReader.GetInt32
        // on a Double). Keep as double? so the whole endpoint does not
        // 500 on the first run with a real distance.
        public double? Kms { get; set; }
        public int? Mins { get; set; }
        public int PreAssigned { get; set; }
        public string? CourierOnlineStatus { get; set; }
        public string? CourierOfflineMins { get; set; }
        public string? Suburbs { get; set; }
        public int Total { get; set; }
        public int Incomplete { get; set; }
        public bool HasReturns { get; set; }
        public int ReturnsTotal { get; set; }
    }

    private static BulkRunDto MapBulkRun(RawBulkRunRow r, bool isMissing) => new()
    {
        Id = int.TryParse(r.ID, out var i) ? i : 0,
        Name = r.Name,
        area = r.Area,
        Suburbs = r.Suburbs,
        FromCities = r.FromCities,
        ToLocationName = r.ToLocationName,
        Velocity = r.velocity,
        Status = r.Status,
        Jobs = r.Total,
        IncompleteJobs = r.Incomplete,
        TotalPickup = r.TotalPickup,
        IncompletePickup = r.IncompletePickup,
        HasReturns = r.HasReturns,
        ReturnsTotal = r.ReturnsTotal,
        IsMissing = isMissing,
        PreAssigned = r.PreAssigned,
        CourierName = r.CourierName,
        CourierCode = r.CourierCode,
        CourierOnlineStatus = r.CourierOnlineStatus,
        CourierOfflineMins = r.CourierOfflineMins,
        AgentName = r.AgentName,
        IsNpAgent = r.IsNpAgent,
    };

    // Row shape matching what RVW_stpBulkRuns_2 + RVW_stpGetMissingJobRuns
    // actually return (verified via live EXEC 2026-08-07). Extras like
    // HashKey / IsActive / CourierPercentageFormatted from the master
    // list Section 16.6 are NOT emitted by the current SP; they land
    // when a future migration adds them SP-side.
    private class RawBulkRunRow
    {
        public string? velocity { get; set; }
        public string? Status { get; set; }
        public string? ID { get; set; }
        public string? Name { get; set; }
        public string? Area { get; set; }
        public int? Mins { get; set; }
        public int? CourierID { get; set; }
        public string? CourierName { get; set; }
        public string? CourierCode { get; set; }
        // See RawMissingRunRow.Kms - same float/int cast trap.
        public double? Kms { get; set; }
        public int PreAssigned { get; set; }
        public string? CourierOnlineStatus { get; set; }
        public string? CourierOfflineMins { get; set; }
        public int Total { get; set; }
        public int Incomplete { get; set; }
        public int TotalPickup { get; set; }
        public int IncompletePickup { get; set; }
        public string? Suburbs { get; set; }
        public string? FromCities { get; set; }
        public string? ToLocationName { get; set; }
        public int? AgentID { get; set; }
        public string? AgentName { get; set; }
        public bool IsNpAgent { get; set; }
        public bool HasReturns { get; set; }
        public int ReturnsTotal { get; set; }
    }

    /// <summary>
    /// GET /api/runviewer/runs/{runId}/jobs - inner runBuilder grid rows
    /// for a single run. `runDate` is REQUIRED even for positive runIds -
    /// the SP raises RAISERROR on missing date when RunID is a synthetic
    /// negative Route Run id.
    /// </summary>
    public async Task<List<BulkJobDto>> GetBulkRunJobsAsync(int runId, BulkRunJobsRequest request)
    {
        if (request.RunDate == null)
            throw new ArgumentException("RunDate is required for BulkRunJobs (SP raises on null date, synthetic-run safeguard).");

        var scope = await scopeResolver.ResolveAsync();
        if (!scope.IsAdmin && scope.NpAgentId == null) return new List<BulkJobDto>();

        int? effectiveClientId = scope.IsAdmin ? request.ClientId : null;
        string? effectiveClientIds = scope.IsAdmin ? request.ClientIds : null;

        logger.LogInformation(
            "GetBulkRunJobsAsync runId={RunId} date={Date} NpAgentId={NpAgentId}",
            runId, request.RunDate, scope.NpAgentId);

        // Tenant SP signature (9 params): RunID, ClientID, CourierID,
        // PreAssigned, SpeedIDs, ClientIDs, RunDate, Regions, NpAgentId.
        //
        // Column-shape note (P3 E2E fix): the SP does NOT emit the
        // tri-state scan-flag columns (SortScanned / RunScanned /
        // PickScanned / InvalidPickScanned / TransferScanned /
        // TransitScanned) or MultiBox. Those live on RVW_stpBulkJob (the
        // single-job SP) and RVW_stpPrintJobsV2 (Print Manager grid) but
        // are absent from the run-jobs SP because the runList grid does
        // not surface them. EF SqlQueryRaw is strict about column-shape
        // matching the target type, so we materialise into a per-SP raw
        // row and map to the public DTO with those fields defaulted.
        var raw = await Context.Database.SqlQueryRaw<RawBulkRunJobRow>(
            @"EXEC dbo.RVW_stpBulkRunJobs
                @RunID = @RunID,
                @ClientID = @ClientID,
                @CourierID = @CourierID,
                @PreAssigned = @PreAssigned,
                @SpeedIDs = @SpeedIDs,
                @ClientIDs = @ClientIDs,
                @RunDate = @RunDate,
                @Regions = @Regions,
                @NpAgentId = @NpAgentId",
            SpParam.Of("@RunID", runId),
            SpParam.Of("@ClientID", effectiveClientId),
            SpParam.Of("@CourierID", request.CourierId),
            SpParam.Of("@PreAssigned", request.PreAssigned),
            SpParam.Of("@SpeedIDs", request.SpeedIds),
            SpParam.Of("@ClientIDs", effectiveClientIds),
            SpParam.Of("@RunDate", request.RunDate),
            SpParam.Of("@Regions", request.RegionIds),
            SpParam.Of("@NpAgentId", scope.NpAgentId))
            .ToListAsync();

        return raw.Select(r => MapRawBulkJobRowToDto(r, r.BulkJobID ?? 0)).ToList();
    }

    /// <summary>Row → BulkJobDto mapping shared by GetBulkRunJobsAsync +
    /// GetJobSiblingsAsync. Both SPs (RVW_stpBulkRunJobs + RVW_stpJobSiblings)
    /// return the same wide-row shape - legacy binds both to
    /// `ViewModels/BulkJob.cs` per sp-reference/runviewer-overview.md
    /// line 121 ("BulkJob.cs for inner-grid + detail rows consumed by
    /// JobSiblings + BulkRunJobs"). Single mapper keeps the two call
    /// sites bit-identical.</summary>
    private static BulkJobDto MapRawBulkJobRowToDto(RawBulkRunJobRow r, int bulkJobIdOverride)
    {
        return new BulkJobDto
        {
            JobId = r.JobID,
            BulkJobId = bulkJobIdOverride,
            ParentJobId = r.ParentJobID,
            JobNumber = r.JobNumber,
            ClientCode = r.ClientCode,
            ClientId = r.ClientID,
            DeliveryDate = null,          // SP emits as varchar(103), not DateOnly
            ReadyTime = r.ReadyTime,
            PickupReadyTime = r.PickupReadyTime,
            PickupWindow = r.PickupWindow,
            PickupWindowStart = r.PickupWindowStart,
            PickupWindowEnd = r.PickupWindowEnd,
            DeliveryWindowStart = r.DeliveryWindowStart,
            DeliveryWindowEnd = r.DeliveryWindowEnd,
            FromAddress = r.FromAddress,
            ToAddress = r.ToAddress,
            FromSuburb = r.FromSuburb,
            ToSuburb = r.ToSuburb,
            PickUpLatitude = (decimal?)r.fromLat,
            PickUpLongitude = (decimal?)r.fromLng,
            ToLat = (decimal?)r.toLat,
            ToLng = (decimal?)r.toLng,
            PickupFromContact = r.PickupFromContact,
            PickupFromPhone = r.PickupFromPhone,
            PickupCompany = r.PickupCompany,
            ClientNotes = r.ClientNotes,
            InternalNotes = r.InternalNotes,
            Notes = r.Notes,
            PickedUpBy = r.PickedUpBy,
            PickedUpTime = r.PickedUpTime,
            DispatchedTime = r.DispatchedTime,
            CreatedDate = r.CreatedDate,
            PODName = r.PODName,
            PODTime = r.PODTime,
            Speed = r.Speed,
            SpeedID = r.SpeedID,
            CourierId = r.CourierID,
            CourierCode = r.CourierCode,
            CourierName = r.CourierName,
            CourierPhone = r.CourierPhone,
            AgentId = r.AgentID,
            AgentName = r.AgentName,
            IsNpAgent = r.IsNpAgent,
            RunOrder = r.RunOrder,
            Amount = r.Amount,
            Size = r.Size?.ToString(),
            Qty = r.Items,
            RefA = r.ClientRefa,
            RefB = r.ClientRefb,
            OurRef = r.OurRef,
            FromCompany = r.PickupCompany,
            ToCompany = r.CompanyName,
            DeliverToContact = r.ContactName,
            DeliverToPhone = null,          // SP doesn't emit; fall back client-side
            TrackingEmail = r.Email,
            ProofOfDeliveryMobile = r.Mobile,
            BookDate = r.DeliveryDate,
            BookTime = r.ReadyTime,
            FromPostCode = r.FromPostCode,
            ToPostCode = r.ToPostCode,
            FromCity = r.FromCity,
            ToCity = r.ToCity,
            JobStatus = r.JobStatus,
            Return = r.Return,
            ClientIntel = r.ClientIntel,
            TrackingLink = r.TrackingLink,
            PickupLocation = r.PickupLocation.HasValue ? (int)r.PickupLocation.Value : null,
        };
    }

    // Row shape emitted by dbo.RVW_stpBulkRunJobs (both synthetic-route
    // and real-bulk branches). Columns must line up 1:1 with the SP's
    // SELECT list or EF SqlQueryRaw throws "column X was not present"
    // at read time. When editing the SP, edit this class in the same
    // migration or the endpoint 500s until they match again.
    private class RawBulkRunJobRow
    {
        public int? ClientID { get; set; }
        public string? ClientCode { get; set; }
        public string? JobNumber { get; set; }
        public string? DeliveryDate { get; set; }
        public string? ReadyTime { get; set; }
        public string? CompanyName { get; set; }
        public string? ToAddress { get; set; }
        public string? ToSuburb { get; set; }
        public int? CourierID { get; set; }
        public string? FromAddress { get; set; }
        public string? FromSuburb { get; set; }
        public string? ContactName { get; set; }
        public decimal? Amount { get; set; }
        public string? Speed { get; set; }
        // Column-type note: tblBulkJob.Size / tucJob.ucjbSize are int in DB,
        // but the SP emits them as ints and BulkJobDto.Size is string. Read
        // as int? then map to string when handing back.
        public int? Size { get; set; }
        // tblBulkJob.Qty + tucJob.ucjbQty are BOTH smallint - EF's default
        // int marshaller throws InvalidCastException Int16 -> Int32. Use
        // short? to match the underlying SQL type.
        public short? Items { get; set; }
        public string? ClientRefa { get; set; }
        public string? ClientRefb { get; set; }
        public string? OurRef { get; set; }
        public bool? Ok_To_Leave { get; set; }
        public int? Location { get; set; }
        public string? Notes { get; set; }
        public string? Email { get; set; }
        public string? Mobile { get; set; }
        public double? fromLat { get; set; }
        public double? fromLng { get; set; }
        public double? toLat { get; set; }
        public double? toLng { get; set; }
        public string? JobStatus { get; set; }
        // tucJob.PickRunOrder is tinyint (byte); tblJob.PickRunOrder is also
        // byte. Same Int16/32 issue if left as int, one level down.
        public byte? RunOrder { get; set; }
        public int JobID { get; set; }
        public int? ParentJobID { get; set; }
        public string? PODName { get; set; }
        public DateTime? PODTime { get; set; }
        public int? AgentID { get; set; }
        public string? AgentName { get; set; }
        public bool IsNpAgent { get; set; }
        public string? CourierName { get; set; }
        public string? CourierPhone { get; set; }
        public string? CourierCode { get; set; }
        public int? BulkJobID { get; set; }
        public string? FromCity { get; set; }
        public string? ToCity { get; set; }
        public int? FromPostCode { get; set; }
        public int? ToPostCode { get; set; }
        public int? SpeedID { get; set; }
        public bool Return { get; set; }
        public bool ClientIntel { get; set; }
        public string? TrackingLink { get; set; }
        public string? PickupFromContact { get; set; }
        public string? PickupFromPhone { get; set; }
        public string? PickupCompany { get; set; }
        public string? ClientNotes { get; set; }
        public string? InternalNotes { get; set; }
        public string? PickupReadyTime { get; set; }
        public DateTime? DispatchedTime { get; set; }
        public DateTime? CreatedDate { get; set; }
        // tucJob.ucjbPickUpFrom is smallint - use short?.
        public short? PickupLocation { get; set; }
        public string? PickedUpBy { get; set; }
        public DateTime? PickedUpTime { get; set; }
        public DateTime? PickupWindowStart { get; set; }
        public DateTime? PickupWindowEnd { get; set; }
        public DateTime? DeliveryWindowStart { get; set; }
        public DateTime? DeliveryWindowEnd { get; set; }
        public string? PickupWindow { get; set; }
    }

    /// <summary>
    /// GET /api/runviewer/runs/linehaul - linehaul run list (cross-city
    /// trunk moves). Wraps RVW_stpLineHaulRuns; adds From/To region
    /// filters not present on the standard run list.
    /// </summary>
    public async Task<List<LinehaulRunDto>> GetLinehaulRunListAsync(LinehaulRunListRequest request)
    {
        var scope = await scopeResolver.ResolveAsync();
        if (!scope.IsAdmin && scope.NpAgentId == null) return new List<LinehaulRunDto>();

        int? effectiveClientId = scope.IsAdmin ? request.ClientId : null;
        string? effectiveClientIds = scope.IsAdmin ? request.ClientIds : null;

        // Tenant SP (7 params): RunDate, ClientID, FromRegions, Regions,
        // ClientIDs, SpeedIDs, NpAgentId. Result-set shape kept loose
        // via dynamic; strict-shape DTO lands when a linehaul-consuming
        // frontend phase (P11) needs precise field annotations.
        var raw = await Context.Database.SqlQueryRaw<RawLinehaulRunRow>(
            @"EXEC dbo.RVW_stpLineHaulRuns
                @RunDate = @RunDate,
                @ClientID = @ClientID,
                @FromRegions = @FromRegions,
                @Regions = @Regions,
                @ClientIDs = @ClientIDs,
                @SpeedIDs = @SpeedIDs,
                @NpAgentId = @NpAgentId",
            SpParam.Of("@RunDate", request.RunDate),
            SpParam.Of("@ClientID", effectiveClientId),
            SpParam.Of("@FromRegions", request.FromRegionIds),
            SpParam.Of("@Regions", request.RegionIds),
            SpParam.Of("@ClientIDs", effectiveClientIds),
            SpParam.Of("@SpeedIDs", request.SpeedIds),
            SpParam.Of("@NpAgentId", scope.NpAgentId))
            .ToListAsync();

        return raw.Select(r => new LinehaulRunDto
        {
            Id = r.LinehaulRunID,
            Name = r.Name,
            MasterJobNumber = r.MasterJobNumber,
            FromDepot = r.FromDepot,
            ToDepot = r.ToDepot,
            ToDepotId = r.ToDepotId,
            Jobs = r.TotalJobs,
            ScannedItems = r.ScannedItems,
            ExpectedItems = r.ExpectedItems,
            TransitScan = r.ScannedItems,
            Pallet = r.Pallet,
            CourierName = r.CourierName,
            CourierCode = r.CourierCode,
            AgentId = r.AgentID,
            AgentName = r.AgentName,
            IsNpAgent = r.IsNpAgent,
        }).ToList();
    }

    // Actual RVW_stpLineHaulRuns output columns (verified 2026-08-07
    // via OBJECT_DEFINITION inspection - the SP builds a #t1 temp
    // table from the CTE then SELECTs it). No Percent / class / CourierId
    // columns - those were speculative on the master DTO shape.
    private class RawLinehaulRunRow
    {
        public int ToDepotId { get; set; }
        public string? Name { get; set; }
        public string? FromDepot { get; set; }
        public string? ToDepot { get; set; }
        public int TotalJobs { get; set; }
        public int LinehaulRunID { get; set; }
        public int ScannedItems { get; set; }
        public int ExpectedItems { get; set; }
        public string? MasterJobNumber { get; set; }
        public string? Pallet { get; set; }
        public int? AgentID { get; set; }
        public string? AgentName { get; set; }
        public bool IsNpAgent { get; set; }
        public string? CourierCode { get; set; }
        public string? CourierName { get; set; }
    }

    /// <summary>
    /// GET /api/runviewer/runs/overview - region roll-up for Home
    /// overview box. NP-scoped via @NpAgentId. Client filter nulled for
    /// NP sessions (NP portal client isn't the customer client).
    /// </summary>
    public async Task<List<RegionOverviewDto>> GetRunRegionOverviewAsync(RegionOverviewRequest request)
    {
        var scope = await scopeResolver.ResolveAsync();
        if (!scope.IsAdmin && scope.NpAgentId == null) return new List<RegionOverviewDto>();

        string? effectiveClientIds = scope.IsAdmin ? request.ClientIds : null;

        // Tenant SP (4 params): RunDate, ClientIds, SpeedIds, NpAgentId.
        // Result: ID, Label, Active, SortScan, PickedUp, RunScan, ToDo,
        // Total, Percent, class (verified 2026-08-07). Home variant does
        // NOT emit Pallet; linehaul variant does (Section 9.3).
        var rows = await Context.Database.SqlQueryRaw<RawOverviewRow>(
            @"EXEC dbo.RVW_stpRunOverview
                @RunDate = @RunDate,
                @ClientIds = @ClientIds,
                @SpeedIds = @SpeedIds,
                @NpAgentId = @NpAgentId",
            SpParam.Of("@RunDate", request.RunDate),
            SpParam.Of("@ClientIds", effectiveClientIds),
            SpParam.Of("@SpeedIds", request.SpeedIds),
            SpParam.Of("@NpAgentId", scope.NpAgentId))
            .ToListAsync();

        return rows.Select(MapOverview).ToList();
    }

    private static RegionOverviewDto MapOverview(RawOverviewRow r) => new()
    {
        RegionId = r.ID,
        Region = r.Label,
        Total = r.Total,
        SortScan = r.SortScan,
        RunScan = r.RunScan,
        PickedUp = r.PickedUp,
        ToDo = r.ToDo,
        Percent = r.Percent,
        Class = r.@class,
        Active = r.Active,
        Pallet = null, // home variant does not carry Pallet
    };

    private class RawOverviewRow
    {
        public int ID { get; set; }
        public string? Label { get; set; }
        public bool Active { get; set; }
        public int SortScan { get; set; }
        public int PickedUp { get; set; }
        public int RunScan { get; set; }
        public int ToDo { get; set; }
        public int Total { get; set; }
        public decimal Percent { get; set; }
        // 'class' collides with the C# keyword; use verbatim identifier
        // via @class. EF binds by name; the @ prefix is a compile-time
        // escape only.
        public string? @class { get; set; }
    }

    // Linehaul overview has its OWN shape (verified 2026-08-07): no
    // SortScan / RunScan columns unlike the home variant. Standalone
    // (does NOT inherit RawOverviewRow) so EF's column-presence check
    // does not demand those columns.
    private class RawLinehaulOverviewRow
    {
        public int ID { get; set; }
        public string? Label { get; set; }
        public bool Active { get; set; }
        public int Total { get; set; }
        public int ToDo { get; set; }
        public int PickedUp { get; set; }
        public string? Pallet { get; set; }
        public decimal Percent { get; set; }
        public string? @class { get; set; }
    }

    /// <summary>
    /// GET /api/runviewer/runs/linehaul/overview - linehaul region
    /// roll-up. Includes Pallet column per Section 9.3.
    /// </summary>
    public async Task<List<RegionOverviewDto>> GetLinehaulRegionOverviewAsync(RegionOverviewRequest request)
    {
        var scope = await scopeResolver.ResolveAsync();
        if (!scope.IsAdmin && scope.NpAgentId == null) return new List<RegionOverviewDto>();

        string? effectiveClientIds = scope.IsAdmin ? request.ClientIds : null;

        // Tenant SP (6 params, verified 2026-08-07): RunDate, ClientIds,
        // SpeedIds, FromRegions, Regions, NpAgentId.
        var rows = await Context.Database.SqlQueryRaw<RawLinehaulOverviewRow>(
            @"EXEC dbo.RVW_stpLinehaulOverview
                @RunDate = @RunDate,
                @ClientIds = @ClientIds,
                @SpeedIds = @SpeedIds,
                @FromRegions = @FromRegions,
                @Regions = @Regions,
                @NpAgentId = @NpAgentId",
            SpParam.Of("@RunDate", request.RunDate),
            SpParam.Of("@ClientIds", effectiveClientIds),
            SpParam.Of("@SpeedIds", request.SpeedIds),
            SpParam.Of("@FromRegions", request.FromRegionIds),
            SpParam.Of("@Regions", request.RegionIds),
            SpParam.Of("@NpAgentId", scope.NpAgentId))
            .ToListAsync();

        return rows.Select(r => new RegionOverviewDto
        {
            RegionId = r.ID,
            Region = r.Label,
            Total = r.Total,
            SortScan = 0,   // not returned by linehaul variant
            RunScan = 0,    // not returned by linehaul variant
            PickedUp = r.PickedUp,
            ToDo = r.ToDo,
            Percent = r.Percent,
            Class = r.@class,
            Active = r.Active,
            Pallet = r.Pallet,
        }).ToList();
    }

    /// <summary>
    /// GET /api/runviewer/runs/job-siblings?jobId= - returns the family
    /// of related jobs for the Detail Related-tabs strip. NP-scoped -
    /// caller passes the anchor jobId and the SP returns siblings only
    /// within the same NP scope.
    /// </summary>
    public async Task<List<SiblingJobDto>> GetJobSiblingsAsync(int jobId)
    {
        var scope = await scopeResolver.ResolveAsync();
        if (!scope.IsAdmin && scope.NpAgentId == null) return new List<SiblingJobDto>();

        // SP signature is (@JobID) only - does NOT accept @NpAgentId.
        // NP scoping happens implicitly because the family is derived
        // from tucJob.ParentID/RootParentId, so an NP-owned anchor job
        // will only walk to NP-owned siblings.
        //
        // CRITICAL: @JobID here is tucJob.ucjbID (the LIVE job id),
        // NOT tblBulkJob.BulkJobID. If the caller passes 0 / negative /
        // an unknown id, the SP short-circuits with `IF @FamilyRoot IS
        // NULL RETURN;` and produces NO result set. EF's SqlQueryRaw
        // surfaces the empty reader as "column missing", not "0 rows",
        // so guard here rather than letting the raw exception bubble.
        if (jobId <= 0) return new List<SiblingJobDto>();

        // Both RVW_stpJobSiblings and RVW_stpBulkRunJobs return the SAME
        // wide-row shape (sp-reference/runviewer-overview.md line 121
        // "BulkJob.cs for inner-grid + detail rows consumed by
        // JobSiblings + BulkRunJobs"). Reuse RawBulkRunJobRow to
        // guarantee the mapping is bit-identical.
        List<RawBulkRunJobRow> raw;
        try
        {
            raw = await Context.Database.SqlQueryRaw<RawBulkRunJobRow>(
                @"EXEC dbo.RVW_stpJobSiblings @JobID = @JobID",
                SpParam.Of("@JobID", jobId))
                .ToListAsync();
        }
        catch (InvalidOperationException ex) when (ex.Message.Contains("was not present"))
        {
            // SP hit the early-return branch (job not in tucJob yet, or
            // family root missing). Empty family = no tabs to render.
            logger.LogDebug("JobSiblings early-return for jobId={JobId}: {Msg}", jobId, ex.Message);
            return new List<SiblingJobDto>();
        }

        // RVW_stpJobSiblings emits `CAST(NULL as int) AS BulkJobID` for
        // every row (SP is tucJob-centric and doesn't know about
        // tblBulkJob). But the frontend Related-tabs strip needs a real
        // BulkJobID to fire a subsequent `/api/runviewer/jobs/{bulkJobId}`
        // click. Resolve via a bulk lookup against tblBulkJob keyed on
        // tucJob.ucjbID = tblBulkJob.JobID. Missing rows fall back to 0
        // and get filtered from the tab strip on the client.
        var siblingJobIds = raw.Select(r => r.JobID).Where(id => id > 0).Distinct().ToList();
        var bulkLookup = siblingJobIds.Count == 0
            ? new Dictionary<int, int>()
            : (await Context.TblBulkJobs
                .Where(b => b.JobId != null && siblingJobIds.Contains(b.JobId!.Value))
                .Select(b => new { JobId = b.JobId!.Value, b.BulkJobId })
                .ToListAsync())
                .GroupBy(x => x.JobId)          // defensive - a tucJob CAN have multiple bulk rows historically
                .ToDictionary(g => g.Key, g => g.First().BulkJobId);

        return raw.Select(r =>
        {
            var bulkJobId = bulkLookup.TryGetValue(r.JobID, out var bid) ? bid : 0;
            return new SiblingJobDto
            {
                JobId = r.JobID,
                BulkJobId = bulkJobId,
                JobNumber = r.JobNumber,
                JobStatus = r.JobStatus,
                TabLabel = DeriveTabLabel(r.JobNumber),
                // Reuse the shared mapper so tab-click renders read
                // the same wide-row shape as the run-jobs grid.
                Job = MapRawBulkJobRowToDto(r, bulkJobId),
            };
        }).ToList();
    }

    // Family-tab label heuristic:
    //   ...LHP -> "*LHP"
    //   ...LH1..LHn -> "*LH1" (last 3-4 chars starting with LH)
    //   ...DEL -> "*DEL"
    //   otherwise -> the full jobNumber (parent row / DD prefix)
    private static string DeriveTabLabel(string? jobNumber)
    {
        if (string.IsNullOrWhiteSpace(jobNumber)) return "#";
        var trimmed = jobNumber.Trim().ToUpperInvariant();
        if (trimmed.EndsWith("LHP")) return "*LHP";
        if (trimmed.EndsWith("DEL")) return "*DEL";
        // LH1..LHn (n up to 2 digits)
        for (int digits = 2; digits >= 1; digits--)
        {
            if (trimmed.Length >= 2 + digits)
            {
                var tail = trimmed[^(2 + digits)..];
                if (tail.StartsWith("LH") && int.TryParse(tail[2..], out _))
                    return "*" + tail;
            }
        }
        return jobNumber;
    }

    // RawSiblingRow was removed 2026-08-10: siblings SP returns the
    // same shape as BulkRunJobs (see MapRawBulkJobRowToDto note), so
    // both call sites now reuse RawBulkRunJobRow.
}
