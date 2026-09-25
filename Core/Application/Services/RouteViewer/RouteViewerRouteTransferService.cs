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

        // Two result sets: family report + zip move detail. We roll up
        // succeeded/failed counts + distinct booking roots + distinct
        // zips into the response DTO.
        var families = await Context.Database.SqlQueryRaw<FamilyReportRow>(
            @"EXEC dbo.RVW_stpTransferRouteForFamilies
                @JobIDs, @NewRouteId, @AlsoTransferBooking, @AlsoTransferZipCodes",
            SpParam.Of("@JobIDs", jobIdsCsv),
            SpParam.Of("@NewRouteId", request.NewRouteId),
            SpParam.Of("@AlsoTransferBooking", request.AlsoTransferRecurringBooking),
            SpParam.Of("@AlsoTransferZipCodes", request.AlsoTransferZipCodes))
            .ToListAsync();

        // TODO: NextResultAsync round-trip for the second result set
        // (zip move detail). Deferred until the SP surfaces the extra
        // columns to a mapped DTO. Fallback: rollup from the first set.

        var newRouteName = await Context.Routes
            .Where(r => r.RouteId == request.NewRouteId)
            .Select(r => r.Name)
            .FirstOrDefaultAsync();

        return new TransferRouteResult
        {
            Succeeded = families.Count(f => f.Ok),
            Failed = families.Count(f => !f.Ok),
            RowsUpdated = families.Sum(f => f.RowsUpdated),
            Families = families.Select(f => f.FamilyRoot ?? "").ToList(),
            NewRouteId = request.NewRouteId,
            NewRouteName = newRouteName,
            AlsoTransferredRecurringBooking = request.AlsoTransferRecurringBooking,
            AlsoTransferredZipCodes = request.AlsoTransferZipCodes,
        };
    }

    private static List<int> ParseIdsCsv(string? csv) =>
        (csv ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries)
            .Select(s => int.TryParse(s.Trim(), out var i) ? i : 0)
            .Where(i => i > 0)
            .ToList();

    private class FamilyReportRow
    {
        public string? FamilyRoot { get; set; }
        public bool Ok { get; set; }
        public int RowsUpdated { get; set; }
    }
}
