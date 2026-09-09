#nullable disable
using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace RoutedOperations.Core.Domain.Despatch;

/// <summary>
/// Schedule ↔ Client many-to-many binding. A schedule header (one row per
/// group in tblBulkRunScheduleHeader) can attach to N clients via this
/// junction. Reshaped 2026-09-08 by AddScheduleHeaderAndIdKeyedLinks
/// from (ScheduleName, ClientId) to (BulkRunScheduleId, ClientId).
/// Column renamed to ScheduleId on 2026-09-09 by RenameScheduleId
/// ToClarifyKeySpace to remove the naming collision with
/// tblBulkRunSchedule.BulkRunScheduleId (which is the day-row PK).
/// This ScheduleId targets the header PK.
/// </summary>
[Table("tblScheduleClient")]
public partial class ScheduleClient
{
    public int ScheduleId { get; set; }
    public int ClientId { get; set; }
    public DateTime CreatedUtc { get; set; }
    [MaxLength(100)]
    public string CreatedBy { get; set; }

    /// <summary>
    /// Nav prop to the header. Lets the service assign a new
    /// BulkRunScheduleHeader that hasn't been saved yet - EF wires the
    /// ScheduleId FK when SaveChanges commits both together.
    /// </summary>
    public virtual BulkRunScheduleHeader Header { get; set; }
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
