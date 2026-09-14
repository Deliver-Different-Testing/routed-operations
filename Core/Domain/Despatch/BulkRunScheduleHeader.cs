#nullable disable
using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace RoutedOperations.Core.Domain.Despatch;

/// <summary>
/// Schedule "group" identity row (one per schedule). Introduced 2026-09-08
/// by AddScheduleHeaderAndIdKeyedLinks; PK column renamed from
/// BulkRunScheduleId to ScheduleId on 2026-09-09 by RenameScheduleId
/// ToClarifyKeySpace so it no longer collides with tblBulkRunSchedule.
/// BulkRunScheduleId (the day-row PK).
///
/// Naming (post-2026-09-09):
///   tblBulkRunScheduleHeader.ScheduleId     - PK, this class
///   tblBulkRunSchedule.ScheduleId           - FK to header (day-row -> header)
///   tblBulkRunSchedule.BulkRunScheduleId    - day-row PK (legacy, unchanged)
///   tblScheduleClient.ScheduleId            - FK to header
/// </summary>
[Table("tblBulkRunScheduleHeader")]
public partial class BulkRunScheduleHeader
{
    public int ScheduleId { get; set; }

    [MaxLength(200)]
    public string Name { get; set; }

    public bool IsDefault { get; set; }

    public int? LegacyClientId { get; set; }

    public DateTime CreatedUtc { get; set; }

    [MaxLength(100)]
    public string CreatedBy { get; set; }

    public DateTime? RetiredUtc { get; set; }

    [MaxLength(100)]
    public string RetiredBy { get; set; }

    /// <summary>
    /// Self-FK. On an override header, points at the base header this
    /// override refines. NULL on default and shared headers. Added
    /// 2026-09-14 by AddBaseScheduleIdAndScheduleGroupTables (Steve's
    /// KEVIN-NEW-SCHEDULES-VIEW-MULTI-CLIENT-2026-09-08 section 5).
    /// Renaming a schedule no longer breaks the override link because
    /// the base is resolved by id, not by name.
    /// </summary>
    public int? BaseScheduleId { get; set; }
}
