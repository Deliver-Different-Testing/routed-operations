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
    ///
    /// Retired-in-place 2026-09-22 (Steve F1): the delta model
    /// (tblBulkRunScheduleOverride) supersedes clone-based overrides.
    /// New override creates write to the delta table and leave
    /// BaseScheduleId NULL. Existing clone-headers with BaseScheduleId
    /// set continue to render until the fold script runs; only then
    /// is the property safe to drop from the entity.
    /// </summary>
    public int? BaseScheduleId { get; set; }

    /// <summary>
    /// Client-facing display name shown on booking / job pages. NULL
    /// falls back to Name. Added 2026-09-22 by
    /// AddDisplayNameToScheduleHeader (Steve F13).
    /// </summary>
    [MaxLength(200)]
    public string DisplayName { get; set; }

    /// <summary>
    /// Long-form description that pairs with DisplayName in the
    /// customer-facing booking page. Added 2026-09-22 (Steve F13).
    /// </summary>
    [MaxLength(500)]
    public string DisplayDescription { get; set; }

    /// <summary>
    /// True if this schedule can be booked at all. Separate from
    /// tblBulkRunSchedule.AutoBook (which means book-immediately, F21).
    /// Added 2026-09-22 by AddIsActiveToScheduleHeader. Default is
    /// true on every existing header (DF constraint).
    /// </summary>
    public bool IsActive { get; set; } = true;

    /// <summary>
    /// Number of client-specific overrides pointing at this header via
    /// tblBulkRunScheduleOverride. Maintained in the same transaction
    /// as override writes so booking-path callers can skip the override
    /// table entirely when this is 0 (which it will be for the vast
    /// majority of schedules). Added 2026-09-22 by
    /// AddClientOverrideDeltas (Steve F1).
    /// </summary>
    public int OverrideCount { get; set; }

    /// <summary>
    /// Where the chain starts: 'depot' (every schedule today) or 'client'
    /// when the goods begin at the client's own address and there is no
    /// collection job. Added 2026-10-07 by
    /// ScheduleOrigin_HeaderOriginTypeAndRegion (Steve's schedule-origin
    /// spec 5.1). Lands on the header because tblBulkRunScheduleDetail does
    /// not exist yet; moves there in collapse M1.
    ///
    /// Read by the write side only: the three single-job booking SPs decide
    /// whether to overwrite the booking's From address with the depot's by
    /// reading this column, never the section 5.2 derivation.
    /// </summary>
    [MaxLength(6)]
    public string OriginType { get; set; } = "depot";

    /// <summary>
    /// Origin branch for a client-origin schedule. This is the counterpart
    /// of tblBulkRunSchedule.PickupDepotId, NOT of Region: Region keeps
    /// coming from the Delivery leg and names the delivery branch, while
    /// this names the branch that owns the start of the chain. NULL for
    /// depot-origin schedules, required when OriginType = 'client'
    /// (CK_tblBulkRunScheduleHeader_ClientOriginHasRegion).
    /// </summary>
    public int? OriginRegionId { get; set; }

    /// <summary>
    /// SQL rowversion, ticks on any change to the header row or its
    /// override rows. App-side cache keyed on
    /// (ScheduleId, ClientId, OverridesVersion) survives across
    /// requests without a stale-read race. Added 2026-09-22 by
    /// AddClientOverrideDeltas (Steve F1).
    /// </summary>
    [Timestamp]
    public byte[] OverridesVersion { get; set; }
}
