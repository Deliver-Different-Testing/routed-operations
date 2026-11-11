// Two-step Transfer Route service. Ported from the legacy
// RouteTransferService. Backend for the transferRouteDialogService
// flow (P6).
//
// Step 1 (Pick):    GetTransferContextAsync - active routes + current-route badge.
// Step 2 (Confirm): GetTransferPreviewAsync - per-anchor preview rows.
// Step 3 (Submit):  TransferAsync - RVW_stpTransferRouteForFamilies + rollup.
//
// CRITICAL CASCADE: the "Also transfer recurring booking" opt-in must
// re-stamp RouteId on parent template + every child leg template. SP
// handles both via BookingParentID OR ParentID predicate (S.4 landmine).
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using RoutedOperations.Core.Application.Dtos.RouteViewer;
using RoutedOperations.Core.Application.Services.Np;
using RoutedOperations.Core.Application.Services;
using RoutedOperations.Core.Domain;

namespace RoutedOperations.Core.Application.Services.RouteViewer;

public class RouteViewerRouteTransferService(
    IDbContextFactory<DynamicDespatchDbContext> contextFactory,
    INpScopeResolver scopeResolver,
    INpScopeGuard scopeGuard,
    ILogger<RouteViewerRouteTransferService> logger) : BaseService(contextFactory)
{
    /// <summary>GET /api/runviewer/routes/active?anchorJobId= - Step 1
    /// pick + current-route badge.</summary>
    public async Task<RouteTransferContextResponse> GetTransferContextAsync(int? anchorJobId)
    {
        if (anchorJobId.HasValue)
            await scopeGuard.EnsureTucJobInScopeAsync(anchorJobId.Value);

        var routes = await Context.Routes
            .Where(r => r.Active)
            .OrderBy(r => r.Name)
            .Select(r => new RouteOptionDto
            {
                Id = r.RouteId,
                Name = r.Name,
                Area = r.Area,
            })
            .ToListAsync();

        var response = new RouteTransferContextResponse { Routes = routes };

        // Current-route badge from anchor's family root.
        if (anchorJobId.HasValue)
        {
            var currentRouteId = await Context.TucJobs
                .Where(j => j.UcjbId == anchorJobId.Value)
                .Select(j => j.RouteId)
                .FirstOrDefaultAsync();

            if (currentRouteId.HasValue)
            {
                response.CurrentRouteId = currentRouteId.Value;
                response.CurrentRouteName = routes.FirstOrDefault(r => r.Id == currentRouteId.Value)?.Name;
            }
        }

        return response;
    }

    /// <summary>GET /api/runviewer/jobs/transfer-preview?ids=CSV -
    /// per-anchor preview for Step 2 confirm banner + table.</summary>
    public async Task<TransferPreviewResponse> GetTransferPreviewAsync(string idsCsv)
    {
        var jobIds = ParseIdsCsv(idsCsv);
        foreach (var id in jobIds)
            await scopeGuard.EnsureTucJobInScopeAsync(id);

        var rows = await (from j in Context.TucJobs
                          where jobIds.Contains(j.UcjbId)
                          from r in Context.Routes.Where(rt => rt.RouteId == j.RouteId).DefaultIfEmpty()
                          select new TransferPreviewRow
                          {
                              JobId = j.UcjbId,
                              JobNumber = j.UcjbNumber,
                              FromAddress = j.UcjbFromAddr,
                              CurrentRouteId = j.RouteId,
                              CurrentRouteName = r == null ? null : r.Name,
                          }).ToListAsync();

        return new TransferPreviewResponse { Jobs = rows };
    }

    /// <summary>POST /api/runviewer/jobs/transfer-route - Step 3 submit.
    /// Executes RVW_stpTransferRouteForFamilies with the two opt-in
    /// flags; SP returns two result sets that we roll up into the
    /// response DTO.</summary>
    public async Task<TransferRouteResult> TransferAsync(TransferRouteRequest request)
    {
        foreach (var jobId in request.JobIds)
            await scopeGuard.EnsureTucJobInScopeAsync(jobId);
        await scopeGuard.EnsureRouteInScopeAsync(request.NewRouteId);

        var jobIdsCsv = string.Join(",", request.JobIds);

        logger.LogInformation(
            "TransferRoute jobIds={JobIds} newRouteId={RouteId} booking={Booking} zips={Zips}",
            jobIdsCsv, request.NewRouteId, request.AlsoTransferRecurringBooking,
            request.AlsoTransferZipCodes);

        // Two result sets: per-anchor report + zip move detail. Read both
        // with a plain reader (SqlQueryRaw only sees the first set) and
        // hand them to the pure rollup (TransferRouteRollup).
        var families = new List<TransferFamilyRow>();
        var zips = new List<TransferZipRow>();

        var conn = Context.Database.GetDbConnection();
        if (conn.State != System.Data.ConnectionState.Open) await conn.OpenAsync();
        try
        {
            using var cmd = conn.CreateCommand();
            cmd.CommandType = System.Data.CommandType.StoredProcedure;
            cmd.CommandText = "dbo.RVW_stpTransferRouteForFamilies";
            cmd.Parameters.Add(SpParam.Of("@JobIDs", jobIdsCsv));
            cmd.Parameters.Add(SpParam.Of("@NewRouteId", request.NewRouteId));
            cmd.Parameters.Add(SpParam.Of("@AlsoTransferBooking", request.AlsoTransferRecurringBooking));
            cmd.Parameters.Add(SpParam.Of("@AlsoTransferZipCodes", request.AlsoTransferZipCodes));

            using var reader = await cmd.ExecuteReaderAsync();
            while (await reader.ReadAsync())
            {
                families.Add(new TransferFamilyRow
                {
                    AnchorJobID = ReadInt(reader, "AnchorJobID") ?? 0,
                    FamilyRoot = ReadInt(reader, "FamilyRoot"),
                    FromRouteId = ReadInt(reader, "FromRouteId"),
                    RowsUpdated = ReadInt(reader, "RowsUpdated") ?? 0,
                    Status = ReadString(reader, "Status") ?? "",
                    BookingRootUcbkID = ReadInt(reader, "BookingRootUcbkID"),
                    BookingRowsUpdated = ReadInt(reader, "BookingRowsUpdated") ?? 0,
                    BookingStatus = ReadString(reader, "BookingStatus") ?? "",
                });
            }

            if (await reader.NextResultAsync())
            {
                while (await reader.ReadAsync())
                {
                    zips.Add(new TransferZipRow
                    {
                        FromRouteId = ReadInt(reader, "FromRouteId") ?? 0,
                        ZipPolygonId = ReadInt(reader, "ZipPolygonId") ?? 0,
                        Zip = ReadString(reader, "Zip"),
                        InsertedToDestination = ReadBool(reader, "InsertedToDestination"),
                        DeletedFromSource = ReadBool(reader, "DeletedFromSource"),
                    });
                }
            }
        }
        catch (Microsoft.Data.SqlClient.SqlException ex) when (ex.Number == 50000)
        {
            // RAISERROR from the proc's own validation (inactive route,
            // missing schema). Nothing was written, so surface it as a
            // request problem rather than a 500.
            logger.LogWarning(ex, "TransferRoute rejected by proc: {Message}", ex.Message);
            throw new RouteTransferRejectedException(ex.Message);
        }

        var newRouteName = await Context.Routes
            .Where(r => r.RouteId == request.NewRouteId)
            .Select(r => r.Name)
            .FirstOrDefaultAsync();

        return TransferRouteRollup.Build(families, zips, request, newRouteName);
    }

    private static int? ReadInt(System.Data.Common.DbDataReader r, string col)
    {
        var i = r.GetOrdinal(col);
        return r.IsDBNull(i) ? null : Convert.ToInt32(r.GetValue(i), System.Globalization.CultureInfo.InvariantCulture);
    }

    private static string? ReadString(System.Data.Common.DbDataReader r, string col)
    {
        var i = r.GetOrdinal(col);
        return r.IsDBNull(i) ? null : Convert.ToString(r.GetValue(i), System.Globalization.CultureInfo.InvariantCulture);
    }

    private static bool ReadBool(System.Data.Common.DbDataReader r, string col)
    {
        var i = r.GetOrdinal(col);
        return !r.IsDBNull(i) && Convert.ToBoolean(r.GetValue(i), System.Globalization.CultureInfo.InvariantCulture);
    }

    private static List<int> ParseIdsCsv(string? csv) =>
        (csv ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries)
            .Select(s => int.TryParse(s.Trim(), out var i) ? i : 0)
            .Where(i => i > 0)
            .ToList();
}
