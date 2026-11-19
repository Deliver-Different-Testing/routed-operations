// Customer Service event read + direct-link + POD-photo service.
// Wraps RVW_stpEvents / RVW_stpEventJobs / RVW_stpClientEventNotification.
//
// T.1 SECURITY interim: NP short-circuits to empty on EventList +
// EventJobs. Long-term fix (backfill NpAgentId on tblBulkEvent) is a
// Section Z decision.
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using RoutedOperations.Core.Application.Dtos.RouteViewer;
using RoutedOperations.Core.Application.Services.Np;
using RoutedOperations.Core.Application.Services.Branches;
using RoutedOperations.Core.Application.Services;
using RoutedOperations.Core.Domain;

namespace RoutedOperations.Core.Application.Services.RouteViewer;

public class RouteViewerEventService(
    IDbContextFactory<DynamicDespatchDbContext> contextFactory,
    INpScopeResolver scopeResolver,
    IBranchScopeGuard branchGuard,
    ILogger<RouteViewerEventService> logger) : BaseService(contextFactory)
{
    // NOTE: S3PhotoReader was injected here initially - dropped because
    // it forces AWS credential resolution at DI construction time, which
    // adds a 16-second startup penalty on any dev machine without live
    // AWS creds. POD-photo reads on events land in P12 via the
    // JobService.GetBulkJobPhotosAsync path instead.

    /// <summary>GET /api/runviewer/events - event list for the CS
    /// grid. NP short-circuits to empty (T.1 SECURITY interim, per
    /// tasktodo Section T.1 recommendation option (b)). Adding
    /// `@NpAgentId` scope to the SP + `tblBulkEvent` is option (a),
    /// flagged [?] pending Steve's decision - do NOT ship it
    /// unilaterally.</summary>
    public async Task<List<EventDto>> GetEventListAsync(EventListRequest request)
    {
        var scope = await scopeResolver.ResolveAsync();
        if (!scope.IsAdmin)
        {
            logger.LogWarning("EventList requested by NP session - short-circuit to empty (T.1).");
            return new List<EventDto>();
        }

        // Tenant SP (3 params, verified 2026-08-07): ClientID, EventDate,
        // IncludeClosed. NO @NpAgentId until Section T.1 stakeholder call.
        var raw = await Context.Database.SqlQueryRaw<RawEventRow>(
            @"EXEC dbo.RVW_stpEvents
                @ClientID = @ClientID,
                @EventDate = @EventDate,
                @IncludeClosed = @IncludeClosed",
            SpParam.Of("@ClientID", request.ClientId),
            SpParam.Of("@EventDate", request.RunDate),
            SpParam.Of("@IncludeClosed", request.IncludeClosed))
            .ToListAsync();

        // Branches B2: branch-limited staff see only the events of jobs (their whole family) or clients and couriers that are
        // theirs. Rows carry the bulk job id; the family rule needs the live tucJob id.
        var jobByBulk = await LiveJobIdsByBulkJobAsync(raw.Select(r => r.BulkJobID ?? 0));
        raw = await branchGuard.FilterJobRowsAsync(raw,
            r => r.BulkJobID.HasValue && jobByBulk.TryGetValue(r.BulkJobID.Value, out var j) ? j : null,
            r => r.ClientID, r => r.CourierID);

        return raw.Select(r => new EventDto
        {
            BulkEventId = r.BulkEventID,
            BulkJobId = r.BulkJobID,
            ClientId = r.ClientID,
            CourierId = r.CourierID,
            JobNumber = r.JobNumber,
            CourierCode = r.CourierCode,
            Notes = r.Notes,
            Internal = r.Internal,
            ClientCreated = r.ClientCreated,
            ClientFollowup = r.ClientFollowup,
            CreatedByName = r.Name,
            EventDate = r.EventDate,
            Created = r.Created,
            ClosedDate = r.ClosedDate,
            ClosedByName = r.ClosedByName,
        }).ToList();
    }

    // Best-effort event row shape - nullable everywhere so any missing
    // SP columns default. Refine when the CS module wires the frontend
    // (P12) and precise field annotations are needed.
    // Matches actual RVW_stpEvents output columns. NOTE the SP aliases
    // e.CreatedByName -> `Name`; and includes CourierName (not on original
    // DTO shape). No @NpAgentId param.
    private class RawEventRow
    {
        public int BulkEventID { get; set; }
        public int? BulkJobID { get; set; }
        public int? ClientID { get; set; }
        public int? CourierID { get; set; }
        public string? JobNumber { get; set; }
        public string? CourierCode { get; set; }
        public string? CourierName { get; set; }
        public string? Name { get; set; } // SP aliases e.CreatedByName -> Name
        public string? Notes { get; set; }
        public bool Internal { get; set; }
        public bool ClientCreated { get; set; }
        public bool ClientFollowup { get; set; }
        public DateOnly EventDate { get; set; }
        public DateTime? ClosedDate { get; set; }
        public string? ClosedByName { get; set; }
        public DateTime Created { get; set; }
    }

    /// <summary>GET /api/runviewer/events/jobs?clientId=
    /// - job typeahead for the create-event dialog. NP short-circuits
    /// to empty per T.1 interim (see GetEventListAsync).</summary>
    public async Task<List<EventJobDto>> GetEventJobsAsync(int? clientId)
    {
        var scope = await scopeResolver.ResolveAsync();
        if (!scope.IsAdmin) return new List<EventJobDto>();

        // Tenant SP (1 param, verified): @ClientID only.
        var rows = await Context.Database.SqlQueryRaw<EventJobDto>(
            @"EXEC dbo.RVW_stpEventJobs @ClientID = @ClientID",
            SpParam.Of("@ClientID", clientId))
            .ToListAsync();

        // Branches B2: the procedure row has no tucJob id or client, so they are read from tblBulkJob.
        if (!branchGuard.IsRestricted || rows.Count == 0) return rows;
        var bulkIds = rows.Select(r => r.BulkJobId).Distinct().ToList();
        var bulk = await Context.TblBulkJobs
            .Where(b => bulkIds.Contains(b.BulkJobId))
            .Select(b => new { b.BulkJobId, b.ClientId, b.JobId })
            .ToDictionaryAsync(b => b.BulkJobId);
        return await branchGuard.FilterJobRowsAsync(rows,
            r => bulk.TryGetValue(r.BulkJobId, out var b) ? b.JobId : null,
            r => bulk.TryGetValue(r.BulkJobId, out var b) ? b.ClientId : null,
            r => r.CourierId);
    }

    // tblBulkJob id -> live tucJob id, for the family rule. Empty (and no database access) for an unrestricted caller.
    private async Task<Dictionary<int, int?>> LiveJobIdsByBulkJobAsync(IEnumerable<int> bulkJobIds)
    {
        if (!branchGuard.IsRestricted) return new Dictionary<int, int?>();
        var ids = bulkJobIds.Where(i => i > 0).Distinct().ToList();
        if (ids.Count == 0) return new Dictionary<int, int?>();
        return await Context.TblBulkJobs
            .Where(b => ids.Contains(b.BulkJobId))
            .Select(b => new { b.BulkJobId, b.JobId })
            .ToDictionaryAsync(b => b.BulkJobId, b => b.JobId);
    }

    // Branches B2: is this event the caller's to touch? An event is attributed to a bulk job and / or a courier; it is the caller's when
    // that job (its family) or courier is. An event with neither cannot be attributed, so a branch-limited caller never touches it.
    private async Task<bool> EventVisibleAsync(int eventId)
    {
        if (!branchGuard.IsRestricted) return true;
        var row = await Context.TblBulkEvents.AsNoTracking()
            .Where(e => e.BulkEventId == eventId)
            .Select(e => new { e.BulkJobId, e.CourierId })
            .FirstOrDefaultAsync();
        if (row is null) return false;
        if (row.BulkJobId is { } jobId && (await branchGuard.VisibleBulkJobIdsAsync([jobId])).Contains(jobId)) return true;
        return row.CourierId is { } courierId && (await branchGuard.VisibleJobCourierIdsAsync([courierId])).Contains(courierId);
    }

    /// <summary>GET /api/runviewer/events/direct-link?eventId=&clientId=
    /// - signed URL for external clients ("Link Declined" for internal).
    /// </summary>
    public async Task<DirectLinkResponse> GenerateDirectLinkAsync(int eventId, int clientId)
    {
        // Branches B2: no link for a client outside the caller's branches.
        if (branchGuard.IsRestricted && !(await branchGuard.VisibleClientIdsAsync([clientId])).Contains(clientId))
            return new DirectLinkResponse { Url = "Link Declined" };

        // Branches B2: and the event must be one of theirs AND belong to that client (a caller's own client id with another branch's
        // event id must not yield that event's link).
        if (branchGuard.IsRestricted)
        {
            var eventClient = await (from e in Context.TblBulkEvents.AsNoTracking().Where(e => e.BulkEventId == eventId)
                                     join b in Context.TblBulkJobs on e.BulkJobId equals b.BulkJobId
                                     select (int?)b.ClientId).FirstOrDefaultAsync();
            if (eventClient != clientId || !await EventVisibleAsync(eventId))
                return new DirectLinkResponse { Url = "Link Declined" };
        }

        // Legacy reads RVW_stpClientEventNotification for the email +
        // internal flag. If internal -> "Link Declined". Otherwise
        // builds RunViewerUrl#/CS?eid={eventId}.
        var notification = await Context.Database.SqlQueryRaw<ClientNotificationRow>(
            @"EXEC dbo.RVW_stpClientEventNotification @ClientID",
            SpParam.Of("@ClientID", clientId))
            .FirstOrDefaultAsync();

        if (notification == null || notification.Internal)
            return new DirectLinkResponse { Url = "Link Declined" };

        var baseUrl = Environment.GetEnvironmentVariable("RunViewerUrl")
            ?? "https://runviewer.deliverdifferent.com";
        return new DirectLinkResponse { Url = $"{baseUrl}#/CS?eid={eventId}" };
    }

    private class ClientNotificationRow
    {
        public string? NotificationEmail { get; set; }
        public bool Internal { get; set; }
    }

    /// <summary>POST /api/runviewer/events - create a CS event via
    /// RVW_stpCreateBulkEvent (returns @BulkEventID output param).
    /// Wraps legacy BookController.CreateEventAsync. Email dispatch
    /// on Notify is deferred until the notification transport is
    /// wired at the tenant level.</summary>
    public async Task<int> CreateEventAsync(CreateEventRequest request)
    {
        var scope = await scopeResolver.ResolveAsync();
        if (!scope.IsAdmin) return 0;

        // #1003 / D2: resolve the bulk row from the tucJob id when the
        // caller has no bulk id (every synthetic route row on Medical).
        var bulkJobId = await ResolveBulkJobIdAsync(request);

        // Branches B2: a branch-limited caller can only raise an event against a job, courier or client that is theirs.
        // The job is judged by the RESOLVED bulk id, so a request carrying only a tucJob id is checked too.
        if (branchGuard.IsRestricted)
        {
            var attached = bulkJobId.HasValue || request.CourierId.HasValue || request.ClientId.HasValue;
            if (!attached
                || (bulkJobId is { } j && !(await branchGuard.VisibleBulkJobIdsAsync([j])).Contains(j))
                || (request.CourierId is { } c && !(await branchGuard.VisibleCourierIdsAsync([c])).Contains(c))
                || (request.ClientId is { } k && !(await branchGuard.VisibleClientIdsAsync([k])).Contains(k)))
                return 0;
        }

        // Uses SqlQuery with OUTPUT parameter binding via SqlParameter -
        // EF Core 8 SqlQueryRaw doesn't surface output params, so wrap
        // the call directly through the connection.
        using var connection = Context.Database.GetDbConnection();
        await connection.OpenAsync();
        using var cmd = connection.CreateCommand();
        cmd.CommandText = "[RVW_stpCreateBulkEvent]";
        cmd.CommandType = System.Data.CommandType.StoredProcedure;
        cmd.Parameters.Add(new Microsoft.Data.SqlClient.SqlParameter("@BulkJobID",
            bulkJobId.HasValue ? (object)bulkJobId.Value : DBNull.Value));
        cmd.Parameters.Add(new Microsoft.Data.SqlClient.SqlParameter("@CourierID",
            request.CourierId.HasValue ? (object)request.CourierId.Value : DBNull.Value));
        cmd.Parameters.Add(new Microsoft.Data.SqlClient.SqlParameter("@Notes", request.Notes ?? string.Empty));
        cmd.Parameters.Add(new Microsoft.Data.SqlClient.SqlParameter("@Name", request.Name ?? string.Empty));
        cmd.Parameters.Add(new Microsoft.Data.SqlClient.SqlParameter("@Internal", request.Internal));
        cmd.Parameters.Add(new Microsoft.Data.SqlClient.SqlParameter("@ClientCreated", request.ClientCreated));
        cmd.Parameters.Add(new Microsoft.Data.SqlClient.SqlParameter("@ClientFollowup", request.ClientFollowup));
        cmd.Parameters.Add(new Microsoft.Data.SqlClient.SqlParameter("@EventDate", request.EventDate.Date));
        var outParam = new Microsoft.Data.SqlClient.SqlParameter("@BulkEventID", System.Data.SqlDbType.Int)
        {
            Direction = System.Data.ParameterDirection.Output,
        };
        cmd.Parameters.Add(outParam);
        await cmd.ExecuteNonQueryAsync();
        return outParam.Value is int id ? id : 0;
    }

    /// <summary>The tblBulkJob.BulkJobID an event attaches to.
    /// tblBulkEvent.BulkJobID has an FK to tblBulkJob, and Route Viewer
    /// rows on synthetic route runs carry bulkJobId 0 (RVW_stpBulkRunJobs
    /// returns NULL for it), so sending that through failed on the FK.
    /// Rules:
    ///   - BulkJobId &gt; 0: used as-is (unchanged behaviour);
    ///   - else JobId &gt; 0: the bulk row whose JobID = tucJob.ucjbID
    ///     (highest BulkJobID if there were ever two; Medical prod has
    ///     none with two, checked 2026-11-09);
    ///   - JobId given but no bulk row, or BulkJobId = 0 with no JobId:
    ///     EventTargetNotFoundException with a per-job message;
    ///   - neither supplied (null): null, as before.</summary>
    public async Task<int?> ResolveBulkJobIdAsync(CreateEventRequest request)
    {
        if (request.BulkJobId is > 0) return request.BulkJobId;

        if (request.JobId is > 0)
        {
            var jobId = request.JobId.Value;
            var bulkId = await Context.TblBulkJobs
                .Where(b => b.JobId == jobId)
                .OrderByDescending(b => b.BulkJobId)
                .Select(b => (int?)b.BulkJobId)
                .FirstOrDefaultAsync();
            if (bulkId is null)
                throw new EventTargetNotFoundException(
                    $"Job {jobId} has no bulk job record, so an event cannot be attached to it.");
            return bulkId;
        }

        if (request.BulkJobId == 0)
            throw new EventTargetNotFoundException("No job was supplied for the event.");

        return null;
    }

    /// <summary>POST /api/runviewer/events/{id}/close - mark the event
    /// closed. EF SetProperty on ClosedDate / ClosedByName; matches
    /// legacy CSController.CloseEvent behaviour (no SP in the legacy
    /// path either).</summary>
    public async Task<bool> CloseEventAsync(int eventId, string closedBy)
    {
        var scope = await scopeResolver.ResolveAsync();
        // Admin only until T.1 SECURITY option (a) is signed off. NP
        // sessions can't see events (short-circuit above) so they
        // can't close them either.
        if (!scope.IsAdmin) return false;
        if (!await EventVisibleAsync(eventId)) return false;   // Branches B2
        var updated = await Context.TblBulkEvents
            .Where(e => e.BulkEventId == eventId)
            .ExecuteUpdateAsync(setters => setters
                .SetProperty(e => e.ClosedDate, DateTime.Now)
                .SetProperty(e => e.ClosedByName, closedBy));
        return updated > 0;
    }

    /// <summary>POST /api/runviewer/events/{id}/reply - prepend a note
    /// to the event's Notes field with a timestamp + user tag. Legacy
    /// stitches directly into the varchar so this matches format
    /// verbatim (`{note} - dd/MM/yy HH:mm via RunViewer user {who}`).
    /// </summary>
    public async Task<bool> AddEventReplyAsync(int eventId, string note, string userName)
    {
        var scope = await scopeResolver.ResolveAsync();
        // Admin only until T.1 SECURITY option (a) is signed off.
        if (!scope.IsAdmin) return false;
        if (!await EventVisibleAsync(eventId)) return false;   // Branches B2
        var current = await Context.TblBulkEvents
            .Where(e => e.BulkEventId == eventId)
            .Select(e => e.Notes)
            .FirstOrDefaultAsync();
        if (current == null) return false;
        var stamped = $"{note} - {DateTime.Now:dd/MM/yy HH:mm} via RunViewer user {userName}\n";
        var next = stamped + current;
        var updated = await Context.TblBulkEvents
            .Where(e => e.BulkEventId == eventId)
            .ExecuteUpdateAsync(setters => setters.SetProperty(e => e.Notes, next));
        return updated > 0;
    }

    /// <summary>POST /api/runviewer/jobs/client-intel - create or
    /// update a client-intel row. Wraps
    /// RVW_stpCreateClientIntel / RVW_stpUpdateClientIntel; file
    /// upload to S3 is deferred (interim behaviour: metadata only).</summary>
    public async Task CreateClientIntelAsync(ClientIntelRequest request)
    {
        var scope = await scopeResolver.ResolveAsync();
        if (!scope.IsAdmin) return;

        // Two SP variants (create vs update); pick one to keep the SQL
        // string literal so EF doesn't warn on interpolation.
        var sql = request.IsNew
            ? "EXEC dbo.RVW_stpCreateClientIntel @Mobile, @Dog, @HasPhoto, @Notes, @PhotoDescription"
            : "EXEC dbo.RVW_stpUpdateClientIntel @Mobile, @Dog, @HasPhoto, @Notes, @PhotoDescription";
        await Context.Database.ExecuteSqlRawAsync(
            sql,
            SpParam.Of("@Mobile", request.Mobile),
            SpParam.Of("@Dog", request.Dog),
            SpParam.Of("@HasPhoto", request.HasPhoto),
            SpParam.Of("@Notes", string.IsNullOrEmpty(request.Notes) ? (object?)null : request.Notes),
            SpParam.Of("@PhotoDescription",
                string.IsNullOrEmpty(request.PhotoDescription) ? (object?)null : request.PhotoDescription));
    }
}

/// <summary>The event's job has no tblBulkJob row. Mapped to 400 by
/// RunViewerEventController instead of surfacing an FK error.</summary>
public sealed class EventTargetNotFoundException(string message) : Exception(message);
