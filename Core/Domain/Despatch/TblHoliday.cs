#nullable disable
using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace RoutedOperations.Core.Domain.Despatch;

/// <summary>
/// Holiday calendar row (per site + optional client / speed scope).
/// Legacy Despatch DB table already used by every booking flow via
/// <c>dbo.UTL_IsHoliday(@Date, @SiteID, 'local')</c>. Added to the EF
/// context on 2026-09-24 (Steve F19b, Kevin confirm) so F19b's
/// next-available-collection resolver can read the calendar directly
/// via EF instead of routing through the SP. Direct read, no wrapper.
///
/// Existing readers (unchanged):
///   - <c>UTL_IsHoliday</c> SF, called by every booking + prebook path.
///   - Rate + surcharge functions (Regional, Excelerator) - see
///     <c>nz-job-booking.md</c> "AfterHours / Holiday surcharge".
///
/// Interaction with per-booking <c>tucJobBooking.HolidayDeliveryOption</c>
/// (0 = Don't Book, 1 = Deliver Next Day): the calendar row says which
/// dates are holidays; the client's option says what to do when a booking
/// lands on one. F19b honours both - it does not override the option.
/// </summary>
[Table("tblHoliday")]
public class TblHoliday
{
    public int HolidayID { get; set; }

    [MaxLength(50)]
    public string Name { get; set; }

    public int SiteID { get; set; }

    [MaxLength(20)]
    public string JobEntryType { get; set; }

    public DateTime Date { get; set; }

    public DateTime StartTime { get; set; }

    public DateTime EndTime { get; set; }

    public int? CourierID { get; set; }

    public decimal Amount { get; set; }

    public bool CanBook { get; set; }

    [MaxLength(1000)]
    public string Message { get; set; }

    public DateTime Created { get; set; }

    [MaxLength(50)]
    public string CreatedBy { get; set; }

    public DateTime LastModified { get; set; }

    [MaxLength(50)]
    public string LastModifiedBy { get; set; }

    public string Notes { get; set; }

    public int? ClientID { get; set; }

    public int? SpeedID { get; set; }

    public bool AllSpeeds { get; set; }
}
