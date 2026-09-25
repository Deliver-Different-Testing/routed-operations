// Partial-class extension that adds the address-line, schedule-name,
// source-id, and other columns the ported BulkService writes into tblBulkJob.
// The base TblBulkJob.cs pre-dates the BulkImport port and only maps the
// columns the RunBuilder cockpit uses; keeping the extension separate leaves
// the base class stable for existing consumers.
#nullable disable

namespace RoutedOperations.Core.Domain.Despatch;

public partial class TblBulkJob
{
    public string PickupAddressLine1 { get; set; }
    public string PickupAddressLine2 { get; set; }
    public string PickupAddressLine3 { get; set; }
    public string PickupAddressLine4 { get; set; }
    public string PickupAddressLine5 { get; set; }
    public string PickupAddressLine6 { get; set; }
    public string PickupAddressLine7 { get; set; }
    public string PickupAddressLine8 { get; set; }

    public string DeliveryAddressLine1 { get; set; }
    public string DeliveryAddressLine2 { get; set; }
    public string DeliveryAddressLine3 { get; set; }
    public string DeliveryAddressLine4 { get; set; }
    public string DeliveryAddressLine5 { get; set; }
    public string DeliveryAddressLine6 { get; set; }
    public string DeliveryAddressLine7 { get; set; }
    public string DeliveryAddressLine8 { get; set; }

    public string ScheduleName { get; set; }
    public int? SourceId { get; set; }
    public int? LoggedInContactId { get; set; }
    public decimal? CourierPercentageOverride { get; set; }
    // Non-nullable to match the DB column (NOT NULL) and the legacy entity.
    // The three `new TblBulkJob()` sites in the RatingService (linehaul,
    // pickup, delivery legs) do not explicitly set this - the default `false`
    // keeps the INSERT valid. Legacy has the same three call sites; a
    // nullable declaration here would silently ship NULL into a NOT NULL
    // column and crash SaveChanges.
    public bool ContentsUnknownAtPickup { get; set; }

    public int? DropOffLocationId { get; set; }
    public int? StorageState { get; set; }
    public int? DeliveryState { get; set; }
    public int? LinehaulRunId { get; set; }

    // Nav properties used by ProcessRoutedJobs & GetBulkJobs projections.
    // Discovered by FK convention (SpeedID / CourierID / JobStatus columns).
    public virtual TucJobType SpeedNavigation { get; set; }
    public virtual TucCourier Courier { get; set; }
    public virtual TucJobStatus JobStatusNavigation { get; set; }
    public virtual BulkImportBatch Import { get; set; }
}
