#nullable disable
using System.ComponentModel.DataAnnotations.Schema;

namespace RoutedOperations.Core.Domain.Despatch;

/// <summary>
/// The single-row body of a collapsed schedule. One row per
/// tblBulkRunScheduleHeader, holding the payload that used to be stamped
/// identically onto every day row, plus a 7-character weekday mask.
///
/// Created by dbmigrationsv2 20261009171000. A header has a detail row only
/// once the schedule has been CONVERTED; an old-shape schedule has none, and
/// its payload still lives on its day rows. Both shapes read back the same
/// way through the dbo.tblBulkRunSchedule compatibility view, which
/// synthesises these columns onto each masked day for a converted schedule.
/// So:
///
///   detail row present -> new shape. The day rows are key rows carrying
///                         only Name, ClientId, ScheduleId, DayOfWeek.
///   detail row absent  -> old shape. Nothing here; read the day rows.
///
/// Writes go here, never to the view. See TblBulkRunScheduleDay for the
/// key rows and TblBulkRunSchedule for the read surface.
/// </summary>
[Table("tblBulkRunScheduleDetail")]
public class BulkRunScheduleDetail
{
    /// <summary>
    /// PK and FK in one: tblBulkRunScheduleHeader.ScheduleId. The 1:1 is
    /// enforced by the PK, not by a unique index, so a header cannot have
    /// two bodies.
    /// </summary>
    public int ScheduleId { get; set; }

    /// <summary>
    /// Which weekdays the schedule runs, as seven characters of '1' or '0',
    /// Monday first. CHAR(7) NOT NULL, so it is never null and never a
    /// different length; the migration's CK enforces the alphabet.
    ///
    /// Position 0 is Monday because DayOfWeek on the day rows is 1..7 with
    /// Monday = 1, which is NOT .NET's DayOfWeek enum (Sunday = 0). Index
    /// with (dayOfWeek - 1).
    /// </summary>
    public string WeekDays { get; set; }

    /// <summary>
    /// The one window the schedule runs in, applied to every masked day.
    /// TIME on every tenant: Urgent Prod and Medical Prod were both
    /// confirmed TIME on 6 and 7 Oct 2026, so the per-tenant DATETIME fork
    /// the old comment on TblBulkRunSchedule warned about is not needed.
    /// </summary>
    public TimeSpan? StartTime { get; set; }
    public TimeSpan? EndTime { get; set; }

    /// <summary>
    /// The cutoff as a RELATIVE rule, which is the whole point of the
    /// collapse: one rule covers every masked day instead of a per-day
    /// absolute pair.
    ///
    ///   CutoffDaysBefore  how many days before the run day
    ///   CutoffDayUnit     'W' counts working days, 'C' calendar days
    ///   CutoffTime        wall clock on the resolved day
    ///
    /// Read the first two together: 1 with 'C' is the previous calendar day
    /// (Monday's cutoff lands on Sunday), 1 with 'W' is the previous working
    /// day (Monday's lands on Friday). dbo.fnCutoffDayFor and
    /// dbo.fnCutoffHoursFor resolve the pair; the compatibility view calls
    /// them to emit the legacy CutoffDay and CutoffHours.
    ///
    /// Deriving this pair from the per-day absolute pairs the UI collects is
    /// NOT done in this application. dbo.uspScheduleConvert does it, trying
    /// 'W' then 'C' and refusing when neither expresses every day, and that
    /// procedure is the single implementation of the rule.
    /// </summary>
    public byte? CutoffDaysBefore { get; set; }

    /// <summary>'W' or 'C'. NOT NULL, defaulted to 'W' by the table.</summary>
    public string CutoffDayUnit { get; set; }

    public TimeSpan? CutoffTime { get; set; }

    /// <summary>
    /// How many upcoming runs of this schedule the booking page offers.
    /// NOT NULL, 1 to 14 (CK on the table). The converter writes the number
    /// of days in the mask, i.e. one week's worth. A per-client override
    /// lives on tblBulkRunScheduleOverride.OccurrencesAhead and wins over
    /// this value; dbo.fnScheduleForClient resolves the two.
    /// </summary>
    public byte OccurrencesAhead { get; set; }

    // ---- the lifted payload, one copy instead of one per day row --------

    public int? MaxJobs { get; set; }
    public int? Region { get; set; }
    public int? SpeedId { get; set; }
    public string Description { get; set; }
    public bool? AutoBook { get; set; }
    public int? PostcodeGroupId { get; set; }
    public bool? BookPickup { get; set; }
    public int? PickupDepotId { get; set; }
    public int? StorageState { get; set; }
    public int? DeliveryState { get; set; }
    public int? PickupRatingSpeed { get; set; }
    public int? PickupPostcodeGroupId { get; set; }
    public int? ParentSpeedId { get; set; }
    public int? PickupBoxDiscount { get; set; }

    /// <summary>Column is spelled DropOffLocationID in the database.</summary>
    [Column("DropOffLocationID")]
    public int? DropOffLocationId { get; set; }

    public bool? ApplyPickupCutoff { get; set; }
    public int? PickupCutoff { get; set; }
    public int? AutoBookScanAhead { get; set; }
    public bool? IsRecurringSchedule { get; set; }

    // ---- audit ---------------------------------------------------------

    public DateTime CreatedUtc { get; set; }
    public string CreatedBy { get; set; }
    public DateTime? UpdatedUtc { get; set; }
    public string UpdatedBy { get; set; }

    /// <summary>
    /// Nav to the header. Optional so EF does not eager-load it.
    /// </summary>
    public virtual BulkRunScheduleHeader Header { get; set; }

    /// <summary>
    /// True when <paramref name="dayOfWeek"/> (1..7, Monday = 1) is set in
    /// the mask. Returns false for a malformed or short mask rather than
    /// throwing, because a bad mask must not take a read path down.
    /// </summary>
    public bool RunsOn(int dayOfWeek)
    {
        if (string.IsNullOrEmpty(WeekDays) || dayOfWeek < 1 || dayOfWeek > 7) return false;
        return WeekDays.Length >= dayOfWeek && WeekDays[dayOfWeek - 1] == '1';
    }
}
