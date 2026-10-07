// Feature 5.1 of Steve's "Linehaul Leg Fixes + Route Direction" spec
// (2026-09-25). Columns added by dbmigrationsv2 migration
// 20260930170000_Feature5_1_RoutesDirectionAndOrigin.
//
// Kept in a partial rather than folded into Route.cs on purpose. Route.cs is
// the scaffold ported from Configurator, which owns route CRUD through its
// own TenantRouteService against this same table. Configurator knows nothing
// about these eight columns and is out of scope (Kevin 2026-09-30), so
// keeping our additions in a separate file makes the divergence from that
// scaffold obvious to whoever reconciles the two next. Same reason
// TucJob.RecurringLinehaul.cs exists.
//
// DEPLOY ORDER: the migration must be applied to a tenant BEFORE this ships
// to it. EF projects every mapped property, so a Route read against a
// database without these columns fails outright.
#nullable disable
using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace RoutedOperations.Core.Domain.Despatch;

public partial class Route
{
    /// <summary>1 = first mile (collect from the customer), 2 = final mile
    /// (fan out from a single origin to the drop). Every pre-existing row is
    /// 1 by DF_Routes_Direction, so nothing changes until an operator sets a
    /// route to final mile.
    ///
    /// Initialised to 1 so the CLR default matches DF_Routes_Direction. Without
    /// it a newly constructed Route starts at 0, which CK_Routes_Direction
    /// rejects and which the database can therefore never contain - so any
    /// code or test that news up a Route and does not think about direction
    /// would be modelling a row that cannot exist. EF overwrites this when
    /// materialising from the database.</summary>
    public byte Direction { get; set; } = 1;

    /// <summary>Depot a final-mile route fans out from, into
    /// tblBulkRegion.BulkRegionId. NULL on a first-mile route, and NULL on a
    /// final-mile route whose origin is an address rather than a depot.
    ///
    /// Deliberately a bare scalar with NO navigation property. DespatchContext
    /// configures TblBulkRegion's relationships on the CHILD entity blocks
    /// precisely because declaring them twice makes EF generate a shadow
    /// "TblBulkRegionBulkRegionId" FK (see the comment in its Entity block).
    /// The depot name is resolved in RecurringRouteService with a lookup
    /// dictionary, the same way courier and agent names already are.</summary>
    public int? DepotId { get; set; }

    /// <summary>Operator-facing label for an address origin. Feature 5.4 needs
    /// it: the Route Viewer derives a synthetic run's from/to names only from
    /// rows whose job number ends in LHP, so a final-mile run built from DEL
    /// legs renders both ends blank without this to fall back on.</summary>
    [MaxLength(100)]
    public string OriginName { get; set; }

    /// <summary>Single-line address the operator entered and geocoded.</summary>
    [MaxLength(400)]
    public string OriginAddress { get; set; }

    /// <summary>Raw zip as entered. The resolver normalises to 5 characters
    /// itself via UTL_stpRouteAutoAssign_NormalizeZip; this keeps what was
    /// typed, matching ZipPolygon.Zip.</summary>
    [MaxLength(20)]
    public string OriginZip { get; set; }

    /// <summary>decimal(18,9) to match tblBulkRegion.PickupLatitude and
    /// tucJob.PickUpLatitude. The resolver's parameters are decimal(9,6), so a
    /// value already loses precision crossing into it; storing at (9,6) would
    /// round a second time for no benefit.</summary>
    [Column(TypeName = "decimal(18, 9)")]
    public decimal? OriginLatitude { get; set; }

    [Column(TypeName = "decimal(18, 9)")]
    public decimal? OriginLongitude { get; set; }

    /// <summary>Match radius in METRES. Metres because that is what
    /// geography::STDistance returns, so the resolver compares without
    /// converting. NULL means the resolver applies its documented 5000 m
    /// default; CK_Routes_Direction deliberately does not force a value.</summary>
    public int? OriginRadiusM { get; set; }
}
