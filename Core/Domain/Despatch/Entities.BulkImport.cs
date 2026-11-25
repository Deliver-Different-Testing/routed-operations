// Partial-class extensions for the Despatch entities that the ported
// BulkService (BulkImportServiceV2 + JobFactory + RatingService partials)
// uses. Sibling to BulkImportEntityExtensions.cs and TucClient.BulkImport.cs
// / TblBulkJob.BulkImport.cs - properties this file adds are the extra ones
// the BulkService code path needs that the other two extension files did
// not already cover. Names use EF convention; explicit [Column] only where
// the DB column shape would not map by default.
#nullable disable

using System.ComponentModel.DataAnnotations.Schema;

namespace RoutedOperations.Core.Domain.Despatch;

// ---- TucJobType -----------------------------------------------------------

public partial class TucJobType
{
    public string SystemName { get; set; }
    public bool? ZoneRated { get; set; }
    public decimal? AddonPercentage { get; set; }
}

// ---- TblBulkRunSchedule ---------------------------------------------------
// CutoffHours + PostcodeGroupId already exist in BulkImportEntityExtensions.cs.
// This partial adds the pickup / delivery / linehaul knobs the RatingService
// and JobFactory partials need for splitting.

public partial class TblBulkRunSchedule
{
    public int? PickupDepotId { get; set; }
    public int? DropOffLocationId { get; set; }
    public int? StorageState { get; set; }
    public int? DeliveryState { get; set; }

    [ForeignKey(nameof(Region))]
    public virtual TblBulkRegion RegionNavigation { get; set; }
}

// ---- TblBulkScheduleLinehaul ---------------------------------------------

public partial class TblBulkScheduleLinehaul
{
    public int? FromDepotId { get; set; }
    public int? ToDepotId { get; set; }
    public int? LinehaulRunId { get; set; }
    public int? DropOffLocationId { get; set; }
    public int? DepartureAdvanceDays { get; set; }
    public string WeekDay { get; set; }
    public decimal? Amount { get; set; }
    public decimal? AmountPercentage { get; set; }
    public bool? ApplyDiscount { get; set; }
    public bool? FromClientAddress { get; set; }
}

// ---- TblBulkRegion --------------------------------------------------------
// FromCompany / FromAddress / AddressLine5/6/7 already exist in
// BulkImportEntityExtensions.cs. This partial adds the remaining columns
// the linehaul / pickup insert code needs.

public partial class TblBulkRegion
{
    public string FromSuburb { get; set; }
    public int FromPostCode { get; set; }
    public decimal? PickupLatitude { get; set; }
    public decimal? PickupLongitude { get; set; }
    public string AddressLine2 { get; set; }
    public string AddressLine3 { get; set; }
    public string AddressLine4 { get; set; }
    public string AddressLine8 { get; set; }
    // #1017: set by ops on depots (airline / rating-only) that must never
    // take postcodes in Bulk Import depot grouping. Column added by the DB
    // run's migration (bit NOT NULL DEFAULT 0).
    public bool ExcludeFromBulkGrouping { get; set; }
}

// ---- TblBulkSuburbAlias ---------------------------------------------------

// #333: a suburb fix the operator chose in Fix Suburbs, remembered so the
// same sheet value is not asked again. ClientId NULL = tenant-wide fallback.
// RawSuburb / RawPostCode are stored normalised (BulkSuburbAliases.Normalise
// / NormalisePostCode). Table added by the DB run's migration; the grant is
// SELECT, INSERT, DELETE only, so a changed fix is delete + insert.
public partial class TblBulkSuburbAlias
{
    public int SuburbAliasId { get; set; }
    public int? ClientId { get; set; }
    public string RawSuburb { get; set; }
    public string RawPostCode { get; set; }
    public int SuburbId { get; set; }
    public string CreatedBy { get; set; }
    public DateTime Created { get; set; }
}
