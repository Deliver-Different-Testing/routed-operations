using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using RoutedOperations.Core.Application.Dtos.Diagnostics;
using RoutedOperations.Core.Domain;

namespace RoutedOperations.Core.Application.Services.Diagnostics;

/// <summary>
/// Read-only wrapper over dbo.RouteAutoAssignLog (populated by
/// UTL_stpRouteAutoAssign_ResolveOneSide / its callers). Powers the
/// Auto-Assign Log diagnostic page under `/auto-assign-log`. Never writes
/// to the table - the SPs own that.
/// </summary>
public class AutoAssignLogService(IDbContextFactory<DynamicDespatchDbContext> contextFactory)
    : BaseService(contextFactory)
{
    private const int MaxPageSize = 200;
    private const int DefaultWindowHours = 24;

    // Friendly names for the BookingKind tinyint discriminator. Mirrors the
    // enum used by the resolver callers - see migrations 20260612090100+.
    // Unknown fallback keeps future kinds visible without a code change.
    private static readonly IReadOnlyDictionary<byte, string> BookingKindNames = new Dictionary<byte, string>
    {
        [0] = "Unknown",
        [1] = "RecurringMaterialised",
        [2] = "RecurringSchedule",
        [3] = "NonRecurringSchedule",
        [4] = "LiveJob",
        [5] = "OneOffSchedule",
    };

    public async Task<RouteAutoAssignLogPageDto> GetLogAsync(RouteAutoAssignLogQuery query)
    {
        var pageSize = Math.Clamp(query.PageSize <= 0 ? 50 : query.PageSize, 1, MaxPageSize);
        var page = Math.Max(1, query.Page);
        var fromUtc = query.FromUtc ?? DateTime.UtcNow.AddHours(-DefaultWindowHours);
        var toUtc = query.ToUtc ?? DateTime.UtcNow;

        var q = Context.RouteAutoAssignLogs.AsNoTracking()
            .Where(r => r.CreatedAtUtc >= fromUtc && r.CreatedAtUtc <= toUtc);

        if (!string.IsNullOrWhiteSpace(query.Outcome))
            q = q.Where(r => r.Outcome == query.Outcome);
        if (!string.IsNullOrWhiteSpace(query.Side))
            q = q.Where(r => r.Side == query.Side);
        if (query.RouteId.HasValue)
            q = q.Where(r => r.ResolvedRouteId == query.RouteId.Value);

        var total = await q.CountAsync();
        var rows = await q
            .OrderByDescending(r => r.CreatedAtUtc)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .ToListAsync();

        // Batch-resolve route / courier / agent names in three follow-up
        // queries. Same pattern as RecurringRouteService.GetAllAsync so we
        // avoid N+1 nav-property loads.
        var routeIds = rows.Where(r => r.ResolvedRouteId.HasValue)
            .Select(r => r.ResolvedRouteId!.Value).Distinct().ToList();
        var routeNames = routeIds.Count == 0
            ? new Dictionary<int, string>()
            : await Context.Routes.AsNoTracking()
                .Where(x => routeIds.Contains(x.RouteId))
                .ToDictionaryAsync(x => x.RouteId, x => x.Name ?? string.Empty);

        var courierIds = rows.Where(r => r.ResolvedCourierId.HasValue)
            .Select(r => r.ResolvedCourierId!.Value).Distinct().ToList();
        var courierNames = courierIds.Count == 0
            ? new Dictionary<int, string>()
            : await Context.TucCouriers.AsNoTracking()
                .Where(c => courierIds.Contains(c.UccrId))
                .ToDictionaryAsync(c => c.UccrId, c => $"{c.Code} {c.UccrName}".Trim());

        var agentIds = rows
            .SelectMany(r => new[] { r.ResolvedAgentId, r.ResolvedNpAgentId })
            .Where(x => x.HasValue)
            .Select(x => x!.Value)
            .Distinct().ToList();
        var agentNames = agentIds.Count == 0
            ? new Dictionary<int, string>()
            : await Context.TucAgents.AsNoTracking()
                .Where(a => agentIds.Contains(a.UcagId))
                .ToDictionaryAsync(a => a.UcagId, a => a.UcagName ?? string.Empty);

        var entries = rows.Select(r => new RouteAutoAssignLogEntryDto(
            r.LogId, r.CreatedAtUtc,
            r.JobId, r.JobBookingId, r.SpeedId, r.PickupZip, r.PickupAtUtc,
            r.BookingKind,
            r.BookingKind.HasValue && BookingKindNames.TryGetValue(r.BookingKind.Value, out var bk)
                ? bk : (r.BookingKind.HasValue ? $"Kind {r.BookingKind.Value}" : "Unknown"),
            r.ResolvedRouteId,
            r.ResolvedRouteId.HasValue ? routeNames.GetValueOrDefault(r.ResolvedRouteId.Value) : null,
            r.ResolvedCourierId,
            r.ResolvedCourierId.HasValue ? courierNames.GetValueOrDefault(r.ResolvedCourierId.Value) : null,
            r.ResolvedAgentId,
            r.ResolvedAgentId.HasValue ? agentNames.GetValueOrDefault(r.ResolvedAgentId.Value) : null,
            r.ResolvedNpAgentId,
            r.ResolvedNpAgentId.HasValue ? agentNames.GetValueOrDefault(r.ResolvedNpAgentId.Value) : null,
            r.Outcome, r.TriggerSource,
            r.PriorRouteId, r.Side)).ToList();

        return new RouteAutoAssignLogPageDto(total, page, pageSize, entries);
    }

    /// <summary>Steve spec §827 diagnostic item #1 - active recurring booking
    /// templates on routed speeds that have no RouteId. Answers "which
    /// recurring bookings will land on the dispatch board unassigned when
    /// they materialise?" for pre-resolver-rollout templates the create-time
    /// resolver never touched.
    ///
    /// Uses raw SQL because RouteId is a real DB column but not on the
    /// auto-generated TucJobBooking EF entity, and because the diagnostic
    /// wants joins to tucJobType.Routed / tucClient / tblBulkRunSchedule -
    /// none of which are on the slim hand-written entities.</summary>
    public async Task<UnresolvedRecurringBookingPageDto> GetUnresolvedRecurringBookingsAsync(
        UnresolvedRecurringBookingQuery query)
    {
        var pageSize = Math.Clamp(query.PageSize <= 0 ? 50 : query.PageSize, 1, MaxPageSize);
        var page = Math.Max(1, query.Page);
        var offset = (page - 1) * pageSize;

        // Build the WHERE clause additively so untouched filters stay off the
        // query plan. All parameters bound; no string interpolation of user
        // input into the SQL. ucbkActive / ucbkOneOff use ISNULL because the
        // columns are nullable on tucJobBooking.
        var where = new System.Text.StringBuilder(@"
    ISNULL(jb.ucbkActive, 0) = 1
AND ISNULL(jb.ucbkOneOff, 0) = 0
AND jb.RouteId IS NULL
AND ISNULL(s.Routed, 0) = 1");

        var parameters = new List<SqlParameter>();
        if (query.ClientId.HasValue)
        {
            where.Append(" AND jb.ucbkClientID = @clientId");
            parameters.Add(new SqlParameter("@clientId", query.ClientId.Value));
        }
        if (query.ScheduleId.HasValue)
        {
            where.Append(" AND jb.ScheduleID = @scheduleId");
            parameters.Add(new SqlParameter("@scheduleId", query.ScheduleId.Value));
        }
        if (query.SpeedId.HasValue)
        {
            where.Append(" AND jb.ucbkSpeed = @speedId");
            parameters.Add(new SqlParameter("@speedId", query.SpeedId.Value));
        }
        if (query.MissingPickupCoords == true)
            where.Append(" AND (jb.PickUpLatitude IS NULL OR jb.PickUpLongitude IS NULL)");

        var countSql = $@"
SELECT COUNT_BIG(*) AS Value
FROM dbo.tucJobBooking jb
INNER JOIN dbo.tucJobType s ON s.ucjtID = jb.ucbkSpeed
WHERE {where}";

        // Use the same @param instances on both queries - EF resets them, so
        // we clone.
        var totalLong = await Context.Database
            .SqlQueryRaw<long>(countSql, parameters.Select(Clone).ToArray())
            .FirstAsync();
        var total = (int)Math.Min(totalLong, int.MaxValue);

        var pageSql = $@"
SELECT
    jb.ucbkID              AS UcbkId,
    jb.ucbkJobNumber       AS UcbkJobNumber,
    jb.ucbkClientID        AS UcbkClientId,
    c.ucclName             AS ClientName,
    jb.ucbkSpeed           AS UcbkSpeed,
    s.ucjtName             AS SpeedName,
    jb.ScheduleID          AS ScheduleId,
    jb.ScheduleName        AS ScheduleName,
    jb.PickupAddressLine7  AS PickupZip,
    jb.DeliveryAddressLine7 AS DeliveryZip,
    CAST(CASE WHEN jb.PickUpLatitude   IS NULL OR jb.PickUpLongitude   IS NULL THEN 1 ELSE 0 END AS bit) AS MissingPickupCoords,
    CAST(CASE WHEN jb.DeliveryLatitude IS NULL OR jb.DeliveryLongitude IS NULL THEN 1 ELSE 0 END AS bit) AS MissingDeliveryCoords,
    jb.ucbkNextDue         AS UcbkNextDue,
    jb.CreatedTime         AS CreatedTime
FROM dbo.tucJobBooking jb
INNER JOIN dbo.tucJobType s  ON s.ucjtID  = jb.ucbkSpeed
LEFT  JOIN dbo.tucClient  c  ON c.ucclID  = jb.ucbkClientID
WHERE {where}
ORDER BY ISNULL(jb.ucbkNextDue, jb.CreatedTime) ASC, jb.ucbkID ASC
OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY";

        var pageParams = parameters.Select(Clone).ToList();
        pageParams.Add(new SqlParameter("@offset", offset));
        pageParams.Add(new SqlParameter("@pageSize", pageSize));

        var entries = await Context.Database
            .SqlQueryRaw<UnresolvedRecurringBookingEntryDto>(pageSql, pageParams.ToArray())
            .ToListAsync();

        return new UnresolvedRecurringBookingPageDto(total, page, pageSize, entries);
    }

    // SqlParameter can only be attached to one command at a time. Clone so
    // the count + page queries can both bind the same logical value.
    private static SqlParameter Clone(SqlParameter p) =>
        new(p.ParameterName, p.Value) { SqlDbType = p.SqlDbType };
}
