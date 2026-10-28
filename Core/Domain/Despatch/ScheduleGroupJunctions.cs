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
///
/// Being re-keyed from ScheduleName onto ScheduleId, the same move
/// tblScheduleClient made on 2026-09-08, because a header rename
/// silently detached every binding and a name does not say which of
/// several definitions it meant. Steve's rule of 2026-10-16: a schedule
/// is identified by its id and never by its name.
///
/// ScheduleId is NULLABLE here only for the transition.
/// dbmigrationsv2 20261016165000 adds it nullable and backfills; this
/// build writes BOTH columns because ScheduleName is still half of the
/// database primary key; a later migration makes the column NOT NULL,
/// moves the key to (ScheduleId, PostCode) and drops the name. Once that
/// lands, ScheduleId becomes int and ScheduleName goes.
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

    /// <summary>Header PK. Nullable for the transition only.</summary>
    public int? ScheduleId { get; set; }

    /// <summary>
    /// Nav prop to the header, same trick as ScheduleClient.Header: it
    /// lets the service bind a header that has not been saved yet and EF
    /// fills ScheduleId when SaveChanges commits both together.
    /// </summary>
    public virtual BulkRunScheduleHeader Header { get; set; }
}
