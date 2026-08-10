// Hand-maintained partial for entities NOT in the EF Power Tools whitelist.
// New entities Route Viewer (or any future module) needs go here so a Power
// Tools regen of DespatchContext.cs cannot clobber them.
//
// Convention documented in RoutedOperations-standards.md B.6.1:
//   - Base scaffold entities + relationships -> DespatchContext.cs (auto-generated).
//   - Entities NOT in the efpt whitelist -> here (DespatchContext.Partial.cs).
//   - Runtime overrides + Route-Viewer-only fluent config -> DynamicDespatchDbContext.OnModelCreating.
//
// Existing hand-authored entities on DespatchContext.cs itself (TucAgent,
// Routes, ZipPolygon, BulkRunPolygon*, DispatchRouteRoster, TblQuoteJob/Run)
// pre-date this file and stay in place; new hand-authored entities are added
// here from 2026-08-07 onward.
using Microsoft.EntityFrameworkCore;
using RoutedOperations.Core.Domain.Despatch;

namespace RoutedOperations.Core.Domain;

public partial class DespatchContext
{
    // Route Viewer P0 additions (2026-08-07). Consumed by LabelService
    // template resolution + CS module event list. Read-side only in P0;
    // P7/P12 add write paths via RVW_stpCreateBulkEvent + RVW_stpCloseEvent.
    public virtual DbSet<AlertTemplate> AlertTemplates { get; set; }
    public virtual DbSet<AlertTemplatePageSize> AlertTemplatePageSizes { get; set; }
    public virtual DbSet<TblSetting> TblSettings { get; set; }
    public virtual DbSet<TblBulkEvent> TblBulkEvents { get; set; }
}
