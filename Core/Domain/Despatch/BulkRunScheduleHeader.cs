#nullable disable
using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace RoutedOperations.Core.Domain.Despatch;

/// <summary>
/// Schedule "group" identity row (one per schedule). Introduced 2026-09-08
/// by AddScheduleHeaderAndIdKeyedLinks. Day rows in tblBulkRunSchedule
/// reference the header via BulkRunScheduleGroupId; link rows in
/// tblScheduleClient reference it via BulkRunScheduleId (matches this
/// PK name because same semantic).
///
/// Naming quirk: two columns named BulkRunScheduleId exist in the schema.
/// The one here is the header PK (identity, one per schedule group). The
/// one on tblBulkRunSchedule is the day-row PK (one per day-of-week
/// variant). They are NOT the same value; day rows join to headers via
/// tblBulkRunSchedule.BulkRunScheduleGroupId = BulkRunScheduleHeader.BulkRunScheduleId.
/// </summary>
[Table("tblBulkRunScheduleHeader")]
public partial class BulkRunScheduleHeader
{
    [Column("BulkRunScheduleId")]
    public int BulkRunScheduleId { get; set; }

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
}
