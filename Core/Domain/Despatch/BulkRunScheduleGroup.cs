#nullable disable
using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace RoutedOperations.Core.Domain.Despatch;

/// <summary>
/// A named bundle of schedules ("Dane's Schedule Groups"). Attaching a
/// client to a group writes one link row per non-default member
/// schedule. The group itself never holds clients - the link table
/// (tblScheduleClient) stays the sole record of who uses what.
/// Introduced 2026-09-14 by AddBaseScheduleIdAndScheduleGroupTables
/// (Steve's KEVIN-NEW-SCHEDULES-VIEW-MULTI-CLIENT-2026-09-08 brief).
/// </summary>
[Table("tblBulkRunScheduleGroup")]
public partial class BulkRunScheduleGroup
{
    public int GroupId { get; set; }

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
/// Group-to-schedule membership. One row per schedule per group.
/// FK ScheduleId targets tblBulkRunScheduleHeader.ScheduleId.
/// Cascading delete on the group side but not the schedule side -
/// retiring a schedule that belongs to groups is an operational
/// decision, not something the FK should silently do.
/// </summary>
[Table("tblBulkRunScheduleGroupMember")]
public partial class BulkRunScheduleGroupMember
{
    public int GroupId { get; set; }
    public int ScheduleId { get; set; }
}
