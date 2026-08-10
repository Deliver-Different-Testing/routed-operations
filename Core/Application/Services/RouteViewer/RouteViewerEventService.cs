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
    /// grid. NP short-circuits to empty (T.1 SECURITY interim).</summary>
    public async Task<List<EventDto>> GetEventListAsync(EventListRequest request)
    {
        var scope = await scopeResolver.ResolveAsync();
        if (!scope.IsAdmin)
        {
            logger.LogWarning("EventList requested by NP session - short-circuit to empty (T.1).");
            return new List<EventDto>();
        }

        // Tenant SP (3 params, verified 2026-08-07): ClientID, EventDate,
        // IncludeClosed. NO @RunDate / @ClientInternal.
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
    /// - job typeahead for the create-event dialog. NP short-circuits.
    /// </summary>
    public async Task<List<EventJobDto>> GetEventJobsAsync(int? clientId, bool clientInternal)
    {
        var scope = await scopeResolver.ResolveAsync();
        if (!scope.IsAdmin) return new List<EventJobDto>();

        // Tenant SP (1 param, verified): @ClientID only. clientInternal
        // is a client-side concept - the SP result is filtered by whether
        // the caller passes their own ClientID (external) vs null (admin).
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
}
