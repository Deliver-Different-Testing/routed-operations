#nullable disable
using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace RoutedOperations.Core.Domain.Despatch;

/// <summary>
/// Schedule ↔ Client many-to-many binding. A schedule "group" (all
/// tblBulkRunSchedule rows sharing a Name) can attach to N clients via
/// this junction. Distinct from the legacy tblBulkRunSchedule.ClientId
/// column which was one-client-per-row; the junction is the new
/// canonical pattern. Backed by migration
/// 20260825120000_AddScheduleGroupJunctions.
/// </summary>
[Table("tblScheduleClient")]
public partial class ScheduleClient
{
    [MaxLength(200)]
    public string ScheduleName { get; set; }
    public int ClientId { get; set; }
    public DateTime CreatedUtc { get; set; }
    [MaxLength(100)]
    public string CreatedBy { get; set; }
}

/// <summary>
/// Schedule ↔ individual PostCode binding. Sits alongside
/// tblBulkRunSchedule.PostcodeGroupId (bulk default). Resolver union:
/// a schedule covers a postcode if it's in the bound group OR in this
/// junction.
/// </summary>
[Table("tblSchedulePostcode")]
public partial class SchedulePostcode
{
    [MaxLength(200)]
    public string ScheduleName { get; set; }
    public int PostCode { get; set; }
    public DateTime CreatedUtc { get; set; }
    [MaxLength(100)]
    public string CreatedBy { get; set; }
}

/// <summary>
/// Schedule ↔ Coverage Polygon binding. Extends Phase-5 polygon binding
/// (ZoneName + PostcodeGroup) with a third target: whole schedule
/// groups. FK on PolygonId cascades: deleting a polygon clears every
/// schedule binding automatically.
/// </summary>
[Table("tblSchedulePolygon")]
public partial class SchedulePolygon
{
    [MaxLength(200)]
    public string ScheduleName { get; set; }
    public int PolygonId { get; set; }
    public DateTime CreatedUtc { get; set; }
    [MaxLength(100)]
    public string CreatedBy { get; set; }
}
