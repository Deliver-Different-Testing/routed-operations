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
using RoutedOperations.Core.Application.Services;
using RoutedOperations.Core.Domain;

namespace RoutedOperations.Core.Application.Services.RouteViewer;

public class RouteViewerEventService(
    IDbContextFactory<DynamicDespatchDbContext> contextFactory,
    INpScopeResolver scopeResolver,
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

    /// <summary>GET /api/runviewer/events/jobs?clientId=&clientInternal=
    /// - job typeahead for the create-event dialog. NP short-circuits
    /// to empty per T.1 interim (see GetEventListAsync).</summary>
    public async Task<List<EventJobDto>> GetEventJobsAsync(int? clientId, bool clientInternal)
    {
        var scope = await scopeResolver.ResolveAsync();
        if (!scope.IsAdmin) return new List<EventJobDto>();

        // Tenant SP (1 param, verified): @ClientID only. clientInternal
        // is a client-side concept.
        return await Context.Database.SqlQueryRaw<EventJobDto>(
            @"EXEC dbo.RVW_stpEventJobs @ClientID = @ClientID",
            SpParam.Of("@ClientID", clientId))
            .ToListAsync();
    }

    /// <summary>GET /api/runviewer/events/direct-link?eventId=&clientId=
    /// - signed URL for external clients ("Link Declined" for internal).
    /// </summary>
    public async Task<DirectLinkResponse> GenerateDirectLinkAsync(int eventId, int clientId)
    {
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

        // Uses SqlQuery with OUTPUT parameter binding via SqlParameter -
        // EF Core 8 SqlQueryRaw doesn't surface output params, so wrap
        // the call directly through the connection.
        using var connection = Context.Database.GetDbConnection();
        await connection.OpenAsync();
        using var cmd = connection.CreateCommand();
        cmd.CommandText = "[RVW_stpCreateBulkEvent]";
        cmd.CommandType = System.Data.CommandType.StoredProcedure;
        cmd.Parameters.Add(new Microsoft.Data.SqlClient.SqlParameter("@BulkJobID",
            request.BulkJobId.HasValue ? (object)request.BulkJobId.Value : DBNull.Value));
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
