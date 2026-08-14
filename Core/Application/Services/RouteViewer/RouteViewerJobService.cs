// Route Viewer read-side single-job service. Wraps:
// - RVW_stpBulkJob (single-job read - CS drill-down + Detail refresh)
// - RVW_stpBulkJob_ByJobNumber (job-number search - Home top-bar + CS)
// - RVW_stpPrintJobsV2 (Print Manager grid)
// - RVW_stpPrintJobChildren (multibox chevron expand)
// - RVW_stpJobItems (per-item barcode list)
//
// LANDMINE T.8: RVW_stpBulkJob (single-job SP) does NOT project the
// ParentJobID column that RVW_stpBulkRunJobs + RVW_stpJobSiblings do.
// This means opening a job by direct BulkJobID (deep-link, CS event
// drill-down) leaves currentJob.ParentJobID undefined - the client-side
// Related-tabs strip must fall back to the jobNumber-suffix heuristic
// when null (documented in BulkJobDto and Section 16 field-level notes).
// Service preserves the SP contract verbatim; frontend deals with the
// fallback.
//
// KNOWN CAVEAT: JobSearch's NP guard is via SP @NpAgentId only; the
// service does not additionally short-circuit for degenerate NP scope
// because the SP already returns empty in that case. Belt-and-braces
// added on the run/filter services matches legacy defence-in-depth.
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using RoutedOperations.Core.Application.Dtos.RouteViewer;
using RoutedOperations.Core.Application.Services.Np;
using RoutedOperations.Core.Application.Services;
using RoutedOperations.Core.Domain;

namespace RoutedOperations.Core.Application.Services.RouteViewer;

public class RouteViewerJobService(
    IDbContextFactory<DynamicDespatchDbContext> contextFactory,
    INpScopeResolver scopeResolver,
    INpScopeGuard scopeGuard,
    S3PhotoReader s3PhotoReader,
    ILogger<RouteViewerJobService> logger) : BaseService(contextFactory)
{
    /// <summary>
    /// GET /api/runviewer/jobs/{bulkJobId} - single job read. Feeds the
    /// Detail panel refresh + CS event drill-down. Note the T.8 gap:
    /// ParentJobID is NOT projected on this SP; client-side must fall
    /// back to jobNumber-suffix heuristic when null.
    /// </summary>
    public async Task<BulkJobDto?> GetBulkJobAsync(int bulkJobId)
    {
        // Row-level guard: NP scope must not see cross-scope jobs.
        // Currently throws for NP sessions pending TucJob.RouteViewer
        // NpAgentId projection (P0 TODO in NpScopeGuard). Admin scope
        // short-circuits to no-op.
        await scopeGuard.EnsureBulkJobInScopeAsync(bulkJobId);

        logger.LogInformation("GetBulkJobAsync bulkJobId={BulkJobId}", bulkJobId);

        // EF cannot compose over EXEC (`.FirstOrDefaultAsync()` tries to
        // add TOP 1 and blows up with "non-composable SQL"). Materialise
        // the row set, then take the first record. RVW_stpBulkJob returns
        // 0-or-1 rows so the cost of ToListAsync is trivial.
        //
        // Column-shape note: RVW_stpBulkJob is the *narrow* single-job
        // SP and does not project agent / scan-flag / window / notes
        // metadata that RVW_stpBulkRunJobs + RVW_stpPrintJobsV2 emit.
        // Materialise into a per-SP raw row and map to BulkJobDto with
        // sensible defaults for the absent fields; the Detail pane
        // frontend hides them when null.
        var raw = await Context.Database.SqlQueryRaw<RawSingleJobRow>(
            @"EXEC dbo.RVW_stpBulkJob @BulkJobID = @BulkJobID",
            SpParam.Of("@BulkJobID", bulkJobId))
            .ToListAsync();
        var r = raw.FirstOrDefault();
        if (r == null) return null;
        return new BulkJobDto
        {
            JobId = r.JobID,
            BulkJobId = r.BulkJobID ?? bulkJobId,
            JobNumber = r.JobNumber,
            ClientCode = r.ClientCode,
            ClientId = r.ClientID,
            ReadyTime = r.ReadyTime,
            FromAddress = r.FromAddress,
            ToAddress = r.ToAddress,
            FromSuburb = r.FromSuburb,
            ToSuburb = r.ToSuburb,
            PickUpLatitude = (decimal?)r.fromLat,
            PickUpLongitude = (decimal?)r.fromLng,
            ToLat = (decimal?)r.toLat,
            ToLng = (decimal?)r.toLng,
            Notes = r.Notes,
            PODName = r.PODName,
            PODTime = r.PODTime,
            Speed = r.Speed,
            CourierId = r.CourierID,
            CourierCode = r.CourierCode,
            CourierName = r.CourierName,
            CourierPhone = r.CourierPhone,
            RunOrder = r.RunOrder,
            JobStatus = r.JobStatus,
            TrackingLink = r.TrackingLink,
            // Detail-pane extras (2026-08-08): forward the fields the
            // Route Viewer JobDetail renders. Agent + scan / window
            // fields aren't projected by this narrow SP, so they stay
            // null (frontend hides on null).
            Amount = r.Amount,
            Size = r.Size?.ToString(),
            Qty = r.Items,
            RefA = r.ClientRefa,
            RefB = r.ClientRefb,
            OurRef = r.OurRef,
            ToCompany = r.CompanyName,
            DeliverToContact = r.ContactName,
            TrackingEmail = r.Email,
            ProofOfDeliveryMobile = r.Mobile,
            BookDate = r.DeliveryDate,
            BookTime = r.ReadyTime,
            FromPostCode = r.FromPostCode,
            ToPostCode = r.ToPostCode,
        };
    }

    // Row shape emitted by dbo.RVW_stpBulkJob (single-job read). Kept
    // separate from BulkJobDto because the SP omits the agent / scan /
    // window / notes columns that Bulk-run-jobs + Print-jobs SPs return.
    private class RawSingleJobRow
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
        public int? Size { get; set; }
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
        public byte? RunOrder { get; set; }
        public int JobID { get; set; }
        public string? PODName { get; set; }
        public DateTime? PODTime { get; set; }
        public string? CourierName { get; set; }
        public string? CourierPhone { get; set; }
        public string? CourierCode { get; set; }
        public int? BulkJobID { get; set; }
        public string? FromCity { get; set; }
        public string? ToCity { get; set; }
        public int? FromPostCode { get; set; }
        public int? ToPostCode { get; set; }
        public string? PODPhoto { get; set; }
        public string? DeliverySignature { get; set; }
        public string? TrackingLink { get; set; }
    }

    /// <summary>
    /// GET /api/runviewer/jobs/search?jobNumber= - job-number search
    /// for the Home top-bar + CS job-typeahead. Returns the matching
    /// BulkJobDto or null. NP-scoped via @NpAgentId inside the SP.
    /// </summary>
    public async Task<BulkJobDto?> SearchByJobNumberAsync(string jobNumber)
    {
        if (string.IsNullOrWhiteSpace(jobNumber)) return null;

        // Row-level guard by job number (throws for NP scope pending
        // TucJob NpAgentId projection).
        await scopeGuard.EnsureTucJobByNumberInScopeAsync(jobNumber);

        // RVW_stpBulkJob_ByJobNumber is a *lookup* SP that returns only
        // 4 columns: BulkJobID, BookDate, BulkRegionId, RunID. It does
        // NOT return a full BulkJobDto shape. Chain to GetBulkJobAsync
        // once we resolve the BulkJobID so the caller gets a fully
        // populated detail row for its deep-link jump. The lookup SP
        // takes only @JobNumber - no NP filter param.
        var hits = await Context.Database.SqlQueryRaw<BulkJobLookupRow>(
            @"EXEC dbo.RVW_stpBulkJob_ByJobNumber @JobNumber = @JobNumber",
            SpParam.Of("@JobNumber", jobNumber))
            .ToListAsync();
        var hit = hits.FirstOrDefault();
        if (hit == null || hit.BulkJobID == 0) return null;
        return await GetBulkJobAsync(hit.BulkJobID);
    }

    private class BulkJobLookupRow
    {
        public int BulkJobID { get; set; }
        public DateTime? BookDate { get; set; }
        public int? BulkRegionId { get; set; }
        public int? RunID { get; set; }
    }

    /// <summary>
    /// GET /api/runviewer/jobs/print-list - the Print Manager grid.
    /// Wraps RVW_stpPrintJobsV2. SP signature (verified 2026-08-14 via
    /// sys.parameters on both NZ + DFRNT tenants) is 4 params only:
    /// @ClientID, @RunDate, @Regions, @ClientIDs. NP short-circuit
    /// mirrors the other grid services.
    /// SP output columns (verified via OBJECT_DEFINITION):
    /// ClientID, ClientCode, JobNumber, DeliveryDate (varchar), ReadyTime,
    /// CompanyName, ContactName, ToAddress, ToSuburb, JobID, BulkJobID,
    /// Items, BookTime, ClientRefa, ClientRefb, Multibox, Email, Mobile,
    /// Notes, Speed, SpeedID, OurRef, PickUpLatitude, PickUpLongitude,
    /// DeliveryLatitude, DeliveryLongitude. Map into BulkJobDto via a
    /// raw-row buffer so the DTO can carry richer downstream fields
    /// without breaking EF's strict column-match.
    /// </summary>
    public async Task<List<BulkJobDto>> GetPrintJobListAsync(BulkRunListRequest request)
    {
        var scope = await scopeResolver.ResolveAsync();
        if (!scope.IsAdmin && scope.NpAgentId == null) return new List<BulkJobDto>();

        int? effectiveClientId = scope.IsAdmin ? request.ClientId : null;
        string? effectiveClientIds = scope.IsAdmin ? request.ClientIds : null;

        var rows = await Context.Database.SqlQueryRaw<RawPrintJobRow>(
            @"EXEC dbo.RVW_stpPrintJobsV2
                @ClientID = @ClientID,
                @RunDate = @RunDate,
                @Regions = @Regions,
                @ClientIDs = @ClientIDs",
            SpParam.Of("@ClientID", effectiveClientId),
            SpParam.Of("@RunDate", request.RunDate),
            SpParam.Of("@Regions", request.RegionIds),
            SpParam.Of("@ClientIDs", effectiveClientIds))
            .ToListAsync();

        return rows.Select(r => new BulkJobDto
        {
            JobId = r.JobID ?? 0,
            BulkJobId = r.BulkJobID,
            ClientId = r.ClientID,
            ClientCode = r.ClientCode,
            JobNumber = r.JobNumber,
            BookDate = r.DeliveryDate,
            BookTime = r.ReadyTime,
            ReadyTime = r.ReadyTime,
            ToCompany = r.CompanyName,
            DeliverToContact = r.ContactName,
            ToAddress = r.ToAddress,
            ToSuburb = r.ToSuburb,
            Qty = r.Items == null ? (short?)null : (short)r.Items.Value,
            RefA = r.ClientRefa,
            RefB = r.ClientRefb,
            MultiBox = r.Multibox ?? false,
            TrackingEmail = r.Email,
            ProofOfDeliveryEmail = r.Email,
            ProofOfDeliveryMobile = r.Mobile,
            DeliverToPhone = r.Mobile,
            Notes = r.Notes,
            Speed = r.Speed,
            SpeedID = r.SpeedID,
            OurRef = r.OurRef,
            PickUpLatitude = (decimal?)r.PickUpLatitude,
            PickUpLongitude = (decimal?)r.PickUpLongitude,
            ToLat = (decimal?)r.DeliveryLatitude,
            ToLng = (decimal?)r.DeliveryLongitude,
        }).ToList();
    }

    /// <summary>Exact column shape of RVW_stpPrintJobsV2 output. Kept
    /// separate from BulkJobDto so EF's strict FromSql column-match
    /// stays happy and the DTO can grow additional aliased fields.</summary>
    private class RawPrintJobRow
    {
        public int? ClientID { get; set; }
        public string? ClientCode { get; set; }
        public string? JobNumber { get; set; }
        public string? DeliveryDate { get; set; }
        public string? ReadyTime { get; set; }
        public string? CompanyName { get; set; }
        public string? ContactName { get; set; }
        public string? ToAddress { get; set; }
        public string? ToSuburb { get; set; }
        public int? JobID { get; set; }
        public int BulkJobID { get; set; }
        public int? Items { get; set; }
        public DateTime? BookTime { get; set; }
        public string? ClientRefa { get; set; }
        public string? ClientRefb { get; set; }
        public bool? Multibox { get; set; }
        public string? Email { get; set; }
        public string? Mobile { get; set; }
        public string? Notes { get; set; }
        public string? Speed { get; set; }
        public int? SpeedID { get; set; }
        public string? OurRef { get; set; }
        public double? PickUpLatitude { get; set; }
        public double? PickUpLongitude { get; set; }
        public double? DeliveryLatitude { get; set; }
        public double? DeliveryLongitude { get; set; }
    }

    /// <summary>
    /// GET /api/runviewer/jobs/print-children?runDate=&bulkJobId= -
    /// multibox chevron expand for Print Manager rows.
    /// </summary>
    public async Task<List<BulkJobDto>> GetPrintJobChildrenAsync(DateTime? runDate, int bulkJobId)
    {
        await scopeGuard.EnsureBulkJobInScopeAsync(bulkJobId);

        return await Context.Database.SqlQueryRaw<BulkJobDto>(
            @"EXEC dbo.RVW_stpPrintJobChildren @RunDate, @BulkJobID",
            SpParam.Of("@RunDate", runDate),
            SpParam.Of("@BulkJobID", bulkJobId))
            .ToListAsync();
    }

    /// <summary>GET /api/runviewer/jobs/items?bulkJobId=&runDate= -
    /// per-item barcode rows. Live/bulk source branch: BulkParentID
    /// resolves the parent, then chooses tucJobItems (live) vs
    /// tblBulkJobItems (not-yet-pushed) via Done=1 probe (per SP body).</summary>
    public async Task<List<JobItemDto>> GetJobItemsAsync(int bulkJobId, DateTime? runDate)
    {
        await scopeGuard.EnsureBulkJobInScopeAsync(bulkJobId);

        return await Context.Database.SqlQueryRaw<JobItemDto>(
            @"EXEC dbo.RVW_stpJobItems @BulkJobID, @RunDate",
            SpParam.Of("@BulkJobID", bulkJobId),
            SpParam.Of("@RunDate", runDate))
            .ToListAsync();
    }

    /// <summary>GET /api/runviewer/jobs/client-intel?mobile= - client
    /// intel record (dangerous-dog + notes) keyed by phone.</summary>
    public async Task<ClientIntelDto?> GetClientIntelAsync(string mobile)
    {
        if (string.IsNullOrWhiteSpace(mobile)) return null;

        return await Context.Database.SqlQueryRaw<ClientIntelDto>(
            @"EXEC dbo.RVW_stpClientIntel @Mobile",
            SpParam.Of("@Mobile", mobile))
            .FirstOrDefaultAsync();
    }

    /// <summary>GET /api/runviewer/jobs/client-intel-images?mobile= -
    /// intel photo carousel. Fetches from S3 prefix
    /// `{mobile}-ClientIntel*`.</summary>
    public async Task<List<ClientIntelImageDto>> GetClientIntelImagesAsync(string mobile)
    {
        if (string.IsNullOrWhiteSpace(mobile)) return new List<ClientIntelImageDto>();
        try
        {
            return await s3PhotoReader.GetClientIntelPhotosAsync(mobile);
        }
        catch (InvalidOperationException)
        {
            // S3Bucket env var not configured - return empty rather
            // than 500. Client Intel box renders "no photos" state.
            return new List<ClientIntelImageDto>();
        }
    }

    /// <summary>GET /api/runviewer/jobs/pod-photos?bulkJobId= - POD
    /// photos + delivery signatures for the Detail carousel + Email
    /// POD attachment. Reads S3 month-scoped path derived from the
    /// job's POD date; caller supplies bulkJobId only.</summary>
    public async Task<List<byte[]>> GetBulkJobPhotosAsync(int bulkJobId)
    {
        await scopeGuard.EnsureBulkJobInScopeAsync(bulkJobId);

        // Look up the JobID + POD year/month to build the S3 pattern.
        // POD time lives on tblJob.CompletedTime (NOT on tblBulkJob -
        // an earlier fabricated `TblBulkJob.PodTime` mapping broke
        // /api/runs with SqlException "Invalid column name 'PODTime'";
        // see TblBulkJob.RouteViewer.cs). tblJob has no EF entity here,
        // so join via raw SQL. Returns 0 rows when the job is not yet
        // completed - photo carousel renders empty in that case.
        var podRows = await Context.Database.SqlQueryRaw<PodLookupRow>(
            @"SELECT TOP 1 b.JobID AS JobId, j.CompletedTime AS PodTime
              FROM dbo.tblBulkJob b WITH (NOLOCK)
              LEFT JOIN dbo.tblJob j WITH (NOLOCK) ON j.JobID = b.JobID
              WHERE b.BulkJobID = @BulkJobID",
            SpParam.Of("@BulkJobID", bulkJobId))
            .ToListAsync();
        var podInfo = podRows.FirstOrDefault();
        if (podInfo == null || podInfo.JobId == null || podInfo.PodTime == null)
            return new List<byte[]>();

        try
        {
            return await s3PhotoReader.GetJobDeliveryPhotosAsync(
                podInfo.JobId.Value,
                podInfo.PodTime.Value.Year,
                podInfo.PodTime.Value.Month);
        }
        catch (InvalidOperationException)
        {
            // S3Bucket env var not set on this tenant / this dev box -
            // fail soft with an empty carousel rather than a 500 that
            // pollutes the console every time the JobDetail renders.
            return new List<byte[]>();
        }
    }

    private class PodLookupRow
    {
        public int? JobId { get; set; }
        public DateTime? PodTime { get; set; }
    }

    /// <summary>GET /api/runviewer/jobs/linehaul?depotId&name&runDate&...
    /// - linehaul jobs for a given depot + run name. NP-scoped via
    /// @NpAgentId inside the SP.</summary>
    public async Task<List<BulkJobDto>> GetLinehaulJobsAsync(
        int? depotId, string? name, BulkRunListRequest request)
    {
        var scope = await scopeResolver.ResolveAsync();
        if (!scope.IsAdmin && scope.NpAgentId == null) return new List<BulkJobDto>();

        int? effectiveClientId = scope.IsAdmin ? request.ClientId : null;
        string? effectiveClientIds = scope.IsAdmin ? request.ClientIds : null;

        return await Context.Database.SqlQueryRaw<BulkJobDto>(
            @"EXEC dbo.RVW_stpLinehaulJobs
                @DepotID, @Name, @RunDate, @ClientID,
                @SpeedIds, @ClientIds, @NpAgentId",
            SpParam.Of("@DepotID", depotId),
            SpParam.Of("@Name", name),
            SpParam.Of("@RunDate", request.RunDate),
            SpParam.Of("@ClientID", effectiveClientId),
            SpParam.Of("@SpeedIds", request.SpeedIds),
            SpParam.Of("@ClientIds", effectiveClientIds),
            SpParam.Of("@NpAgentId", scope.NpAgentId))
            .ToListAsync();
    }

    /// <summary>GET /api/runviewer/jobs/search-data - topbar search
    /// dataset. 90-second SP timeout (blocked for NP per Section 3.1).
    /// Returns flat search rows across the whole date's job pool.</summary>
    public async Task<List<BulkJobDto>> GetJobSearchDataAsync(BulkRunListRequest request)
    {
        var scope = await scopeResolver.ResolveAsync();
        if (!scope.IsAdmin) return new List<BulkJobDto>();

        // Override the command timeout for this one SP - 90s per legacy.
        var priorTimeout = Context.Database.GetCommandTimeout();
        Context.Database.SetCommandTimeout(90);
        try
        {
            return await Context.Database.SqlQueryRaw<BulkJobDto>(
                @"EXEC dbo.RVW_stpBulkJobSearchData
                    @RunDate, @Group, @ClientID, @ClientIds,
                    @RegionIds, @SpeedIds",
                SpParam.Of("@RunDate", request.RunDate),
                SpParam.Of("@Group", request.Group),
                SpParam.Of("@ClientID", request.ClientId),
                SpParam.Of("@ClientIds", request.ClientIds),
                SpParam.Of("@RegionIds", request.RegionIds),
                SpParam.Of("@SpeedIds", request.SpeedIds))
                .ToListAsync();
        }
        finally
        {
            Context.Database.SetCommandTimeout(priorTimeout);
        }
    }
}
