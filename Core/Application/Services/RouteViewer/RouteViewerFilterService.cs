// Route Viewer filter-dropdown service. The 5 lookup SPs the Home
// module hits on initial page load + when the date filter changes:
// ClientList, SpeedList, RegionList, SuburbList, TopUpList.
//
// SECURITY NOTE (T.2): the three filter SPs (RVW_stpBulkClients /
// RVW_stpBulkSpeeds / RVW_stpBulkRegions) are NOT NpAgentId-scoped -
// NP users see the full catalogue across tenants using their portal.
// This is a documented Section Z stakeholder decision (dropdown
// catalogues are metadata; less severe than the T.1 event-visibility
// leak but still crosses NP scope). Route Viewer preserves legacy
// behaviour pending Kevin/George decision on whether to filter.
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.AspNetCore.Http;
using RoutedOperations.Core.Application.Dtos.RouteViewer;
using RoutedOperations.Core.Application.Services.Np;
using RoutedOperations.Core.Application.Services;
using RoutedOperations.Core.Domain;

namespace RoutedOperations.Core.Application.Services.RouteViewer;

public class RouteViewerFilterService(
    IDbContextFactory<DynamicDespatchDbContext> contextFactory,
    INpScopeResolver scopeResolver,
    IHttpContextAccessor httpContextAccessor,
    ILogger<RouteViewerFilterService> logger) : BaseService(contextFactory)
{
    /// <summary>
    /// GET /api/runviewer/filters/clients - client dropdown for the
    /// filter panel + client-scope switcher. Passes contactId + the
    /// multipleClients flag through to the SP; SP handles the tenant /
    /// external / multi-account branching internally.
    /// </summary>
    public async Task<List<LookupDto>> GetClientListAsync(DateTime? runDate, bool multipleClients, int? contactId)
    {
        // Tenant SP (2 params, verified 2026-08-07): RunDate, ContactID.
        // No MultipleClients param on the SP itself; caller uses the
        // result-set count client-side to derive multi-account state.
        // Result columns: ClientID, ClientCode -> map to LookupDto.
        logger.LogInformation("GetClientListAsync date={Date} contact={Contact}", runDate, contactId);

        var raw = await Context.Database.SqlQueryRaw<RawClientRow>(
            @"EXEC dbo.RVW_stpBulkClients @RunDate = @RunDate, @ContactID = @ContactID",
            SpParam.Of("@RunDate", runDate),
            SpParam.Of("@ContactID", contactId))
            .ToListAsync();

        return raw.Select(r => new LookupDto { id = r.ClientID, label = r.ClientCode }).ToList();
    }

    /// <summary>GET /api/runviewer/filters/speeds - service-level
    /// dropdown scoped to the current date. SP returns SpeedId, Name.
    /// </summary>
    public async Task<List<LookupDto>> GetSpeedListAsync(DateTime? runDate)
    {
        var raw = await Context.Database.SqlQueryRaw<RawSpeedRow>(
            @"EXEC dbo.RVW_stpBulkSpeeds @RunDate = @RunDate",
            SpParam.Of("@RunDate", runDate))
            .ToListAsync();

        return raw.Select(r => new LookupDto { id = r.SpeedId, label = r.Name }).ToList();
    }

    /// <summary>GET /api/runviewer/filters/regions - region dropdown.
    /// SP returns siteID, Name, Active. Frontend filters on Active for
    /// the "Active Regions Only" checkbox; we surface the flag in the
    /// LookupDto's label via naming convention (id + label only for now;
    /// consumer that needs Active reads /api/runviewer/runs/overview
    /// which carries the flag).</summary>
    public async Task<List<LookupDto>> GetRegionListAsync(DateTime? runDate)
    {
        var raw = await Context.Database.SqlQueryRaw<RawRegionRow>(
            @"EXEC dbo.RVW_stpBulkRegions @RunDate = @RunDate",
            SpParam.Of("@RunDate", runDate))
            .ToListAsync();

        return raw.Select(r => new LookupDto { id = r.siteID, label = r.Name }).ToList();
    }

    // Per-SP raw result rows. Property names MUST match SP result-set
    // column names (case-insensitive) so EF's SqlQueryRaw row-mapper
    // binds correctly. Extra columns SP returns are ignored.
    private class RawClientRow { public int ClientID { get; set; } public string? ClientCode { get; set; } }
    private class RawSpeedRow  { public int SpeedId { get; set; }  public string? Name { get; set; } }
    private class RawRegionRow { public int siteID { get; set; }   public string? Name { get; set; } public bool Active { get; set; } }
    private class RawTopUpRow  { public int TopUpServiceID { get; set; } public string? TopUpServiceName { get; set; } }

    /// <summary>GET /api/runviewer/filters/suburbs - full suburb list
    /// for the GPS-form Select2 picker (Print Manager) and the
    /// address-fuzzy-match backing store. EF read over the tucSuburb
    /// entity (no SP - the target already has the entity registered
    /// on the base DespatchContext).</summary>
    public async Task<List<SuburbLookupDto>> GetSuburbListAsync()
    {
        return await Context.TucSuburbs
            .Select(s => new SuburbLookupDto
            {
                id = s.UcsuId,
                label = s.UcsuName,
                alias = s.GoogleSuburbAlias
            })
            .ToListAsync();
    }

    /// <summary>GET /api/runviewer/filters/topup-services - TopUp
    /// service dropdown for the Book Top Up dialog.</summary>
    public async Task<List<LookupDto>> GetTopUpListAsync()
    {
        var raw = await Context.Database.SqlQueryRaw<RawTopUpRow>(
            @"EXEC dbo.RVW_stpTopUpServices")
            .ToListAsync();

        return raw.Select(r => new LookupDto { id = r.TopUpServiceID, label = r.TopUpServiceName }).ToList();
    }
}
