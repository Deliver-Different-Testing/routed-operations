// EF entity for dbo.tucManualMessage. Only the columns Driver Scheduling
// needs to write - the full table is 26 columns wide but the SMS-out
// path only fills 6 (Date, StaffID, Attempts, SendToMobile, Subject,
// Message). Column mappings match the legacy CourierManager entity.
//
// The DB has a trigger `tucManualMessage_Insert` (2018, Kevin) that
// silently DELETEs any insert whose ucmmMessage contains "which has
// been dispatched to Courier" - legacy WOOP spam filter. Driver
// Scheduling SMS templates do not contain that phrase, so the trigger
// is a no-op for our path.
#nullable disable
using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace RoutedOperations.Core.Domain.Despatch;

[Table("tucManualMessage")]
public class TucManualMessage
{
    [Key]
    [Column("ucmmID")]
    public int UcmmId { get; set; }

    [Column("ucmmDate")]
    public DateTime UcmmDate { get; set; }

    [Column("ucmmStaffID")]
    public int? UcmmStaffId { get; set; }

    [Column("SendToMobile")]
    public string SendToMobile { get; set; }

    [Column("Subject")]
    public string Subject { get; set; }

    [Column("ucmmMessage")]
    public string UcmmMessage { get; set; }

    [Column("ucmmSent")]
    public bool UcmmSent { get; set; }

    [Column("ucmmAttempts")]
    public int? UcmmAttempts { get; set; }

    [Column("Read")]
    public bool Read { get; set; }
}
