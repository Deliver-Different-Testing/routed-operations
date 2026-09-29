// Route Viewer job-action service. Wraps 12 RVW_stp* mutation SPs
// behind a single service so RunViewerJobActionController stays thin.
// Every method:
//   1. Resolves NP scope + short-circuits when NP has no agent id
//   2. Resolves the current user's display name from claims
//      (FirstName + Surname, or Identity.Name / email fallback -
//      same logic Home page uses)
//   3. Guards the target job against cross-NP-scope access via
//      INpScopeGuard (throws NpLabelScopeException → 403 at controller)
//   4. Fires the SP via ExecuteSqlRawAsync (mutation, no result set)
//
// Sequential-per-item rate limiting is a FRONTEND concern - the
// service invokes SPs one call at a time. See useSequentialBulkAction
// on the client for the 150ms gap.
using System.Data;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.AspNetCore.Http;
using RoutedOperations.Core.Application.Dtos.RouteViewer;
using RoutedOperations.Core.Application.Services.Np;
using RoutedOperations.Core.Application.Services;
using RoutedOperations.Core.Domain;

namespace RoutedOperations.Core.Application.Services.RouteViewer;

public class RouteViewerJobActionService(
    IDbContextFactory<DynamicDespatchDbContext> contextFactory,
    INpScopeResolver scopeResolver,
    INpScopeGuard scopeGuard,
    IHttpContextAccessor httpContextAccessor,
    ILogger<RouteViewerJobActionService> logger) : BaseService(contextFactory)
{
    // -----------------------------------------------------------------
    // Job-status mutations (tucJob.ucjbStatus + audit trail)
    // -----------------------------------------------------------------

    public async Task ActivateAsync(int jobId)
    {
        await GuardByJobAsync(jobId);
        var userName = ResolveUserName();
        logger.LogInformation("RVW_stpActivateJob jobId={JobId} user={User}", jobId, userName);
        await Context.Database.ExecuteSqlRawAsync(
            "EXEC dbo.RVW_stpActivateJob @JobID = @JobID, @UserName = @UserName",
            SpParam.Of("@JobID", jobId),
            SpParam.Of("@UserName", userName));
    }

    public async Task PickupAsync(int jobId)
    {
        await GuardByJobAsync(jobId);
        logger.LogInformation("RVW_stpPickupJob jobId={JobId}", jobId);
        await Context.Database.ExecuteSqlRawAsync(
            "EXEC dbo.RVW_stpPickupJob @JobID = @JobID",
            SpParam.Of("@JobID", jobId));
    }

    public async Task MissingAsync(int jobId)
    {
        await GuardByJobAsync(jobId);
        var userName = ResolveUserName();
        logger.LogInformation("RVW_stpMissingJob jobId={JobId} user={User}", jobId, userName);
        await Context.Database.ExecuteSqlRawAsync(
            "EXEC dbo.RVW_stpMissingJob @JobID = @JobID, @UserName = @UserName",
            SpParam.Of("@JobID", jobId),
            SpParam.Of("@UserName", userName));
    }

    public async Task CompleteAsync(int jobId, string podName, DateTime? completedTime)
    {
        await GuardByJobAsync(jobId);
        var stamp = completedTime ?? DateTime.UtcNow;
        logger.LogInformation("RVW_stpCompleteJob jobId={JobId} podName={PodName}", jobId, podName);
        await Context.Database.ExecuteSqlRawAsync(
            "EXEC dbo.RVW_stpCompleteJob @JobID = @JobID, @PODName = @PODName, @CompletedTime = @CompletedTime",
            SpParam.Of("@JobID", jobId),
            SpParam.Of("@PODName", podName ?? string.Empty),
            SpParam.Of("@CompletedTime", stamp));
    }

    public async Task LmcAsync(int jobId, int bulkJobId, string fromCourierCode)
    {
        await GuardByJobAsync(jobId);
        logger.LogInformation("RVW_stpLMCJob jobId={JobId} bulkJobId={BulkJobId}", jobId, bulkJobId);
        await Context.Database.ExecuteSqlRawAsync(
            "EXEC dbo.RVW_stpLMCJob @JobID = @JobID, @BulkJobID = @BulkJobID, @FromCourierCode = @FromCourierCode",
            SpParam.Of("@JobID", jobId),
            SpParam.Of("@BulkJobID", bulkJobId),
            SpParam.Of("@FromCourierCode", fromCourierCode ?? string.Empty));
    }

    public async Task ReleaseAsync(int jobId)
    {
        await GuardByJobAsync(jobId);
        logger.LogInformation("RVW_stpReleaseJob jobId={JobId}", jobId);
        await Context.Database.ExecuteSqlRawAsync(
            "EXEC dbo.RVW_stpReleaseJob @JobID = @JobID",
            SpParam.Of("@JobID", jobId));
    }

    // -----------------------------------------------------------------
    // Courier ops
    // -----------------------------------------------------------------

    public async Task TransferJobAsync(int jobId, string fromCourierCode, string toCourierCode)
    {
        await GuardByJobAsync(jobId);
        logger.LogInformation("RVW_stpTransferJob jobId={JobId} from={From} to={To}",
            jobId, fromCourierCode, toCourierCode);
        await Context.Database.ExecuteSqlRawAsync(
            "EXEC dbo.RVW_stpTransferJob @JobID = @JobID, @FromCourierCode = @FromCourierCode, @ToCourierCode = @ToCourierCode",
            SpParam.Of("@JobID", jobId),
            SpParam.Of("@FromCourierCode", fromCourierCode ?? string.Empty),
            SpParam.Of("@ToCourierCode", toCourierCode ?? string.Empty));
    }

    public async Task SendSmsAsync(int jobId, string mobile, string message)
    {
        await GuardByJobAsync(jobId);
        logger.LogInformation("RVW_stpMessageJob jobId={JobId} mobileLen={MobileLen} msgLen={MsgLen}",
            jobId, mobile?.Length ?? 0, message?.Length ?? 0);
        await Context.Database.ExecuteSqlRawAsync(
            "EXEC dbo.RVW_stpMessageJob @JobID = @JobID, @Mobile = @Mobile, @Message = @Message",
            SpParam.Of("@JobID", jobId),
            SpParam.Of("@Mobile", mobile ?? string.Empty),
            SpParam.Of("@Message", message ?? string.Empty));
    }

    /// <summary>POST /api/runviewer/jobs/send-sms-run - send an SMS to
    /// every driver on the run. Wraps legacy RVW_stpMessageRun. Admin
    /// only; the SP takes the operator's UserName for audit.</summary>
    public async Task SendSmsToRunAsync(int runId, string message)
    {
        var userName = ResolveUserName();
        logger.LogInformation("RVW_stpMessageRun runId={RunId} msgLen={MsgLen} user={User}",
            runId, message?.Length ?? 0, userName);
        await Context.Database.ExecuteSqlRawAsync(
            "EXEC dbo.RVW_stpMessageRun @RunID = @RunID, @Message = @Message, @UserName = @UserName",
            SpParam.Of("@RunID", runId),
            SpParam.Of("@Message", message ?? string.Empty),
            SpParam.Of("@UserName", userName));
    }

    // -----------------------------------------------------------------
    // Bulk mutations (BulkJobID list)
    // -----------------------------------------------------------------

    public async Task CancelJobsAsync(int[] bulkJobIds)
    {
        if (bulkJobIds == null || bulkJobIds.Length == 0) return;
        foreach (var id in bulkJobIds) await GuardByBulkJobAsync(id);
        var csv = string.Join(',', bulkJobIds);
        var userName = ResolveUserName();
        logger.LogInformation("RVW_stpCancelJob count={Count} user={User}", bulkJobIds.Length, userName);
        await Context.Database.ExecuteSqlRawAsync(
            "EXEC dbo.RVW_stpCancelJob @BulkJobIDs = @BulkJobIDs, @UserName = @UserName",
            SpParam.Of("@BulkJobIDs", csv),
            SpParam.Of("@UserName", userName));
    }

    public async Task MoveJobsBackToRunBuilderAsync(int[] bulkJobIds, DateTime newDateTime, int newSpeed, bool voidOriginal)
    {
        if (bulkJobIds == null || bulkJobIds.Length == 0) return;
        foreach (var id in bulkJobIds) await GuardByBulkJobAsync(id);
        var csv = string.Join(',', bulkJobIds);
        logger.LogInformation(
            "RVW_stpMoveJobsBackToRunBuilder count={Count} newDateTime={Dt} newSpeed={Speed} void={Void}",
            bulkJobIds.Length, newDateTime, newSpeed, voidOriginal);
        await Context.Database.ExecuteSqlRawAsync(
            @"EXEC dbo.RVW_stpMoveJobsBackToRunBuilder
                @NewDateTime = @NewDateTime,
                @NewSpeed = @NewSpeed,
                @BulkJobIDs = @BulkJobIDs,
                @Void = @Void",
            SpParam.Of("@NewDateTime", newDateTime),
            SpParam.Of("@NewSpeed", newSpeed),
            SpParam.Of("@BulkJobIDs", csv),
            SpParam.Of("@Void", voidOriginal));
    }

    // -----------------------------------------------------------------
    // Notes
    // -----------------------------------------------------------------

    public async Task AddJobNoteAsync(int jobId, string notes)
    {
        await GuardByJobAsync(jobId);
        var userName = ResolveUserName();
        logger.LogInformation("RVW_stpAddJobNote jobId={JobId} user={User}", jobId, userName);
        await Context.Database.ExecuteSqlRawAsync(
            "EXEC dbo.RVW_stpAddJobNote @JobID = @JobID, @Notes = @Notes, @UserName = @UserName",
            SpParam.Of("@JobID", jobId),
            SpParam.Of("@Notes", notes ?? string.Empty),
            SpParam.Of("@UserName", userName));
    }

    // -----------------------------------------------------------------
    // GPS address update (Detail card right-click → Update GPS)
    // -----------------------------------------------------------------

    /// <summary>Update pickup OR delivery address + lat/lng on a
    /// tblBulkJob. Dispatches to `RVW_stpUpdateBulkJobPickupAddress`
    /// (14 params) or `RVW_stpUpdateBulkJobDeliveryAddress` (14 params)
    /// based on `leg`. Address lines 1-8 pass through as empty when
    /// the caller only has the flat address (map-drag scenario).</summary>
    public async Task UpdateGpsAsync(UpdateJobGpsRequest req)
    {
        await scopeGuard.EnsureBulkJobInScopeAsync(req.BulkJobId);

        // Ensure address lines has at least 8 slots so SP call doesn't
        // NRE on missing indices.
        var lines = req.AddressLines ?? Array.Empty<string>();
        string L(int i) => (i < lines.Length ? lines[i] : null) ?? string.Empty;

        var isPickup = string.Equals(req.Leg, "pickup", StringComparison.OrdinalIgnoreCase);
        logger.LogInformation(
            "RVW_stpUpdateBulkJob{Side}Address bulkJobId={BulkJobId} lat={Lat} lng={Lng}",
            isPickup ? "Pickup" : "Delivery", req.BulkJobId, req.Latitude, req.Longitude);

        if (isPickup)
        {
            await Context.Database.ExecuteSqlRawAsync(
                @"EXEC dbo.RVW_stpUpdateBulkJobPickupAddress
                    @BulkJobID = @BulkJobID,
                    @FromSuburb = @FromSuburb,
                    @FromPostCode = @FromPostCode,
                    @Address = @Address,
                    @PickupLatitude = @PickupLatitude,
                    @PickupLongitude = @PickupLongitude,
                    @AddressLine1 = @AddressLine1,
                    @AddressLine2 = @AddressLine2,
                    @AddressLine3 = @AddressLine3,
                    @AddressLine4 = @AddressLine4,
                    @AddressLine5 = @AddressLine5,
                    @AddressLine6 = @AddressLine6,
                    @AddressLine7 = @AddressLine7,
                    @AddressLine8 = @AddressLine8",
                SpParam.Of("@BulkJobID", req.BulkJobId),
                SpParam.Of("@FromSuburb", req.Suburb ?? string.Empty),
                SpParam.Of("@FromPostCode", req.PostCode ?? 0),
                SpParam.Of("@Address", req.Address ?? string.Empty),
                SpParam.Of("@PickupLatitude", req.Latitude),
                SpParam.Of("@PickupLongitude", req.Longitude),
                SpParam.Of("@AddressLine1", L(0)),
                SpParam.Of("@AddressLine2", L(1)),
                SpParam.Of("@AddressLine3", L(2)),
                SpParam.Of("@AddressLine4", L(3)),
                SpParam.Of("@AddressLine5", L(4)),
                SpParam.Of("@AddressLine6", L(5)),
                SpParam.Of("@AddressLine7", L(6)),
                SpParam.Of("@AddressLine8", L(7)));
        }
        else
        {
            await Context.Database.ExecuteSqlRawAsync(
                @"EXEC dbo.RVW_stpUpdateBulkJobDeliveryAddress
                    @BulkJobID = @BulkJobID,
                    @ToSuburb = @ToSuburb,
                    @ToPostCode = @ToPostCode,
                    @Address = @Address,
                    @DeliveryLatitude = @DeliveryLatitude,
                    @DeliveryLongitude = @DeliveryLongitude,
                    @AddressLine1 = @AddressLine1,
                    @AddressLine2 = @AddressLine2,
                    @AddressLine3 = @AddressLine3,
                    @AddressLine4 = @AddressLine4,
                    @AddressLine5 = @AddressLine5,
                    @AddressLine6 = @AddressLine6,
                    @AddressLine7 = @AddressLine7,
                    @AddressLine8 = @AddressLine8",
                SpParam.Of("@BulkJobID", req.BulkJobId),
                SpParam.Of("@ToSuburb", req.Suburb ?? string.Empty),
                SpParam.Of("@ToPostCode", req.PostCode ?? 0),
                SpParam.Of("@Address", req.Address ?? string.Empty),
                SpParam.Of("@DeliveryLatitude", req.Latitude),
                SpParam.Of("@DeliveryLongitude", req.Longitude),
                SpParam.Of("@AddressLine1", L(0)),
                SpParam.Of("@AddressLine2", L(1)),
                SpParam.Of("@AddressLine3", L(2)),
                SpParam.Of("@AddressLine4", L(3)),
                SpParam.Of("@AddressLine5", L(4)),
                SpParam.Of("@AddressLine6", L(5)),
                SpParam.Of("@AddressLine7", L(6)),
                SpParam.Of("@AddressLine8", L(7)));
        }
    }

    // -----------------------------------------------------------------
    // Text-field partial update (Route Viewer Detail click-to-edit)
    // -----------------------------------------------------------------

    /// <summary>Partial-update for editable text fields on the Detail
    /// pane (Quantity / Notes / Refs / OurRef).
    /// Wraps `dbo.WS_stpBulkJob_Update`.
    ///
    /// Three things about that SP that the previous version of this
    /// method got wrong, all verified against the live 11,550-char body
    /// on both staging tenants 2026-09-29:
    ///
    /// 1. It does NOT require all fields. Every input is `= NULL`
    ///    defaulted and each field is guarded `IF ISNULL(@X, '') &lt;&gt; ''`,
    ///    so omitting one is already a no-op.
    /// 2. It APPENDS rather than replaces:
    ///    `SET Notes = @Notes + CRLF + ISNULL(Notes, '')`, mirrored onto
    ///    `tucJob`. So the old "load current values and pass them
    ///    through unchanged" design prepended every currently non-empty
    ///    value to itself on every call - editing Ref A duplicated
    ///    Notes, Ref B and Our Ref as collateral. We now send only what
    ///    the patch actually set and let the guards no-op the rest.
    /// 3. `@Message` is an OUTPUT abort channel, not an SMS trigger (the
    ///    body contains no SMS logic at all). It is set and the
    ///    transaction ROLLBACKed, with no RAISERROR, when the job cannot
    ///    be found or has already been picked up (status 4-13 or 17).
    ///    The old call omitted OUTPUT, so those aborts surfaced to the
    ///    operator as HTTP 200 "ok" on an edit that was rolled back. We
    ///    now read it back and throw.
    ///
    /// ToAddress / ToSuburb are NOT handled here. The SP declares them
    /// but never reads them - each token appears exactly once in the
    /// whole body, in the parameter list - so those edits were silently
    /// discarded. Address changes go through UpdateGpsAsync, which calls
    /// RVW_stpUpdateBulkJobPickupAddress / ...DeliveryAddress and does
    /// persist them.</summary>
    public async Task UpdateTextFieldsAsync(int bulkJobId, UpdateJobTextFieldsRequest patch)
    {
        await scopeGuard.EnsureBulkJobInScopeAsync(bulkJobId);

        if (patch.ToAddress != null || patch.ToSuburb != null)
        {
            // Fail loud rather than report success on a write the SP drops.
            throw new ArgumentException(
                "WS_stpBulkJob_Update does not persist ToAddress or ToSuburb. "
                + "Use the address endpoint (UpdateGpsAsync) for address changes.");
        }

        // @ClientID and @JobNumber are the SP's only non-defaulted inputs and
        // form its lookup key, so they are the only values we still need to
        // read. Everything else is sent only when the patch set it.
        var current = await Context.TblBulkJobs
            .Where(b => b.BulkJobId == bulkJobId)
            .Select(b => new { b.ClientId, b.JobNumber })
            .FirstOrDefaultAsync();
        if (current == null) throw new ArgumentException($"BulkJob {bulkJobId} not found");

        var userName = ResolveUserName();
        logger.LogInformation(
            "WS_stpBulkJob_Update bulkJobId={BulkJobId} user={User} fields={Fields}",
            bulkJobId, userName,
            string.Join(',', new[] {
                patch.Quantity != null ? "quantity" : null,
                patch.Notes != null ? "notes" : null,
                patch.RefA != null ? "refA" : null,
                patch.RefB != null ? "refB" : null,
                patch.OurRef != null ? "ourRef" : null,
            }.Where(s => s != null)));

        var spMessage = new SqlParameter("@Message", SqlDbType.NVarChar, 1000)
        {
            Direction = ParameterDirection.Output,
        };

        await Context.Database.ExecuteSqlRawAsync(
            @"EXEC dbo.WS_stpBulkJob_Update
                @ClientID = @ClientID,
                @JobNumber = @JobNumber,
                @Quantity = @Quantity,
                @Notes = @Notes,
                @ClientRefA = @ClientRefA,
                @ClientRefB = @ClientRefB,
                @OurRef = @OurRef,
                @Message = @Message OUTPUT",
            SpParam.Of("@ClientID", current.ClientId),
            SpParam.Of("@JobNumber", current.JobNumber),
            // Unset fields go as NULL so the SP's own
            // IF ISNULL(@X, '') <> '' guards skip them. Sending the current
            // value instead is what made the SP append it to itself.
            SpParam.Of("@Quantity", patch.Quantity),
            SpParam.Of("@Notes", patch.Notes),
            SpParam.Of("@ClientRefA", patch.RefA),
            SpParam.Of("@ClientRefB", patch.RefB),
            SpParam.Of("@OurRef", patch.OurRef),
            spMessage);

        var abortReason = spMessage.Value as string;
        if (!string.IsNullOrWhiteSpace(abortReason))
        {
            // The SP ROLLBACKed and RETURNed without raising, so this is the
            // only signal that nothing was written.
            logger.LogWarning(
                "WS_stpBulkJob_Update aborted bulkJobId={BulkJobId} reason={Reason}",
                bulkJobId, abortReason);
            throw new InvalidOperationException(abortReason.Trim());
        }
    }

    public async Task AddBulkJobNoteAsync(int bulkJobId, string notes)
    {
        await GuardByBulkJobAsync(bulkJobId);
        var userName = ResolveUserName();
        logger.LogInformation("RVW_stpAddBulkJobNote bulkJobId={BulkJobId} user={User}", bulkJobId, userName);
        // OUTPUT param intentionally not read here - Route Viewer surface
        // does not need the composed audit-trail string; the SP writes it
        // to tblBulkJob.Notes directly.
        await Context.Database.ExecuteSqlRawAsync(
            @"DECLARE @ret nvarchar(max);
              EXEC dbo.RVW_stpAddBulkJobNote
                @BulkJobID = @BulkJobID,
                @Notes = @Notes,
                @UserName = @UserName,
                @ReturnNotes = @ret OUTPUT;",
            SpParam.Of("@BulkJobID", bulkJobId),
            SpParam.Of("@Notes", notes ?? string.Empty),
            SpParam.Of("@UserName", userName));
    }

    // -----------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------

    /// <summary>Resolve current operator display name from claims.
    /// Mirrors Home page composition: FirstName + Surname, else
    /// Identity.Name (typically the email), else "unknown".</summary>
    private string ResolveUserName()
    {
        var user = httpContextAccessor.HttpContext?.User;
        if (user == null) return "unknown";
        var first = user.Claims.FirstOrDefault(c => c.Type == "FirstName")?.Value;
        var surname = user.Claims.FirstOrDefault(c => c.Type == "Surname")?.Value;
        var composed = string.Join(" ", new[] { first, surname }.Where(s => !string.IsNullOrWhiteSpace(s)));
        if (!string.IsNullOrWhiteSpace(composed)) return composed;
        return user.Identity?.Name ?? "unknown";
    }

    /// <summary>Throws NpLabelScopeException if the tucJob row lives
    /// outside the caller's NP scope. No-op for admin sessions.</summary>
    private async Task GuardByJobAsync(int jobId)
    {
        var scope = await scopeResolver.ResolveAsync();
        if (scope.IsAdmin) return;
        // NP scope walks tucJob for the anchor; if the row is void /
        // out of scope the guard throws. Job actions on synthetic
        // negative ids (Route Runs) never reach here because the SPs
        // reject them.
        if (jobId <= 0) return;
        // The guard's TucJob check verifies NpAgentId. Existing
        // implementation is in NpScopeGuard.
        await scopeGuard.EnsureTucJobInScopeAsync(jobId);
    }

    private async Task GuardByBulkJobAsync(int bulkJobId)
    {
        var scope = await scopeResolver.ResolveAsync();
        if (scope.IsAdmin) return;
        if (bulkJobId <= 0) return;
        await scopeGuard.EnsureBulkJobInScopeAsync(bulkJobId);
    }
}
