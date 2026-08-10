// Courier read-side + GPS lookup service for Route Viewer. Wraps
// RVW_stpActiveCouriers / RVW_stpCourierActive + the three MAP_stpXxx
// GPS SPs. All five endpoints short-circuit to empty for NP users -
// per master Section 3.4, NP sessions do not see courier data at all
// (the NP portal client is not the courier's home tenant).
//
// KNOWN LANDMINE (T.7): RVW_stpCourierActive uses
// `ORDER BY CONVERT(int, Code)` which throws on any non-numeric
// courier code. Route Viewer preserves the SP contract verbatim; the
// Section Z decision on whether to patch the SP to TRY_CONVERT is a
// stakeholder call, not a service-layer one.
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using RoutedOperations.Core.Application.Dtos.RouteViewer;
using RoutedOperations.Core.Application.Services.Np;
using RoutedOperations.Core.Application.Services;
using RoutedOperations.Core.Domain;

namespace RoutedOperations.Core.Application.Services.RouteViewer;

public class RouteViewerCourierService(
    IDbContextFactory<DynamicDespatchDbContext> contextFactory,
    INpScopeResolver scopeResolver,
    ILogger<RouteViewerCourierService> logger) : BaseService(contextFactory)
{
    /// <summary>GET /api/runviewer/couriers?runDate= - all active
    /// couriers for the picker. SP result: courierID, courierCode,
    /// courierName, courier (combined), Fleet, ActiveJobs, Available.
    /// VehicleType is NOT returned by this SP - stays default on the
    /// public DTO.</summary>
    public async Task<List<CourierListDto>> GetActiveCouriersAsync(DateTime? runDate)
    {
        var scope = await scopeResolver.ResolveAsync();
        if (!scope.IsAdmin) return new List<CourierListDto>();

        var raw = await Context.Database.SqlQueryRaw<RawCourierRow>(
            @"EXEC dbo.RVW_stpActiveCouriers @RunDate = @RunDate",
            SpParam.Of("@RunDate", runDate))
            .ToListAsync();

        return raw.Select(MapCourier).ToList();
    }

    /// <summary>GET /api/runviewer/couriers/search?q= - typeahead
    /// search for the Top Up dialog + Assign Route dialog.
    /// KNOWN LANDMINE T.7: SP uses CONVERT(int, Code) in ORDER BY.</summary>
    public async Task<List<CourierListDto>> SearchActiveCouriersAsync(string? searchTerm)
    {
        var scope = await scopeResolver.ResolveAsync();
        if (!scope.IsAdmin) return new List<CourierListDto>();

        // Search SP has a DIFFERENT shape (returns just ID + Text - one
        // combined display string, no per-field breakdown). Different
        // row class avoids trying to bind ActiveJobs / Fleet / Available
        // which aren't returned here.
        var raw = await Context.Database.SqlQueryRaw<RawCourierSearchRow>(
            @"EXEC dbo.RVW_stpCourierActive @SearchTerm = @SearchTerm",
            SpParam.Of("@SearchTerm", searchTerm))
            .ToListAsync();

        return raw.Select(r => new CourierListDto
        {
            CourierId = r.ID,
            Name = r.Text,
        }).ToList();
    }

    private class RawCourierSearchRow
    {
        public int ID { get; set; }
        public string? Text { get; set; }
    }

    private static CourierListDto MapCourier(RawCourierRow r) => new()
    {
        CourierId = r.courierID,
        Code = r.courierCode,
        Name = r.courierName,
        Fleet = r.Fleet,
        ActiveJobs = r.ActiveJobs,
        IsAvailable = r.Available,
    };

    private class RawCourierRow
    {
        public int courierID { get; set; }
        public string? courierCode { get; set; }
        public string? courierName { get; set; }
        public string? courier { get; set; }
        public string? Fleet { get; set; }
        public int ActiveJobs { get; set; }
        public bool Available { get; set; }
    }

    /// <summary>GET /api/runviewer/couriers/position?jobId= - the
    /// current-job courier's last GPS ping today. Refreshed on the
    /// 25s poll.</summary>
    public async Task<CourierPositionDto?> GetCourierPositionAsync(int jobId)
    {
        var scope = await scopeResolver.ResolveAsync();
        if (!scope.IsAdmin) return null;

        return await Context.Database.SqlQueryRaw<CourierPositionDto>(
            @"EXEC dbo.MAP_stpCourierGPS_LastPositionToday_ByJobID @JobID",
            SpParam.Of("@JobID", jobId))
            .FirstOrDefaultAsync();
    }

    /// <summary>GET /api/runviewer/couriers/available?minLng&minLat&maxLng&maxLat
    /// All active courier positions inside the map viewport bounding
    /// box. Feeds the "All Couriers" map toggle. Refreshed on the 25s
    /// poll when the toggle is on.</summary>
    public async Task<List<AvailableCourierPositionDto>> GetAvailableCourierPositionsAsync(
        decimal minLng, decimal minLat, decimal maxLng, decimal maxLat)
    {
        var scope = await scopeResolver.ResolveAsync();
        if (!scope.IsAdmin) return new List<AvailableCourierPositionDto>();

        return await Context.Database.SqlQueryRaw<AvailableCourierPositionDto>(
            @"EXEC dbo.MAP_stpEnvelope @MinLng, @MinLat, @MaxLng, @MaxLat",
            SpParam.Of("@MinLng", minLng),
            SpParam.Of("@MinLat", minLat),
            SpParam.Of("@MaxLng", maxLng),
            SpParam.Of("@MaxLat", maxLat))
            .ToListAsync();
    }

    /// <summary>GET /api/runviewer/couriers/route?code&start&end - GPS
    /// trail for the Courier Route red polyline overlay. Typically
    /// called with start/end = podTime +/- 5 min. Note the SP is
    /// SET QUOTED_IDENTIFIER OFF (T.5) - do NOT add filtered indexes
    /// to tucCourierGPS without ALTERing the SP to QI ON first.</summary>
    public async Task<List<CourierRoutePointDto>> GetCourierRouteAsync(
        string courierCode, DateTime start, DateTime end)
    {
        var scope = await scopeResolver.ResolveAsync();
        if (!scope.IsAdmin) return new List<CourierRoutePointDto>();

        return await Context.Database.SqlQueryRaw<CourierRoutePointDto>(
            @"EXEC dbo.MAP_stpCourierGPS_CourierTimeTrace_New @Code, @Start, @End",
            SpParam.Of("@Code", courierCode),
            SpParam.Of("@Start", start),
            SpParam.Of("@End", end))
            .ToListAsync();
    }
}
