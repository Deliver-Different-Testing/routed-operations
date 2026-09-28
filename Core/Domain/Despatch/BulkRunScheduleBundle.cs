#nullable disable
using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace RoutedOperations.Core.Domain.Despatch;

/// <summary>
/// A named bundle of schedules ("Dane's Schedule Bundles"). Attaching a
/// client to a bundle writes one link row per non-default member
/// schedule. The bundle itself never holds clients - the link table
/// (tblScheduleClient) stays the sole record of who uses what.
/// Introduced 2026-09-14 by AddBaseScheduleIdAndScheduleGroupTables
/// (Steve's KEVIN-NEW-SCHEDULES-VIEW-MULTI-CLIENT-2026-09-08 brief).
/// Renamed 2026-09-22 by RenameScheduleGroupToBundle per Steve F18.
/// </summary>
[Table("tblBulkRunScheduleBundle")]
public partial class BulkRunScheduleBundle
{
    public int BundleId { get; set; }

    [MaxLength(200)]
    public string Name { get; set; }

    [MaxLength(500)]
    public string Description { get; set; }

    public bool IsActive { get; set; }

    public DateTime CreatedUtc { get; set; }

    [MaxLength(100)]
    public string CreatedBy { get; set; }
}

/// <summary>
/// Bundle-to-schedule membership. One row per schedule per bundle.
/// FK ScheduleId targets tblBulkRunScheduleHeader.ScheduleId.
/// Cascading delete on the bundle side but not the schedule side -
/// retiring a schedule that belongs to bundles is an operational
/// decision, not something the FK should silently do.
/// </summary>
[Table("tblBulkRunScheduleBundleMember")]
public partial class BulkRunScheduleBundleMember
{
    public int BundleId { get; set; }
    public int ScheduleId { get; set; }
}
